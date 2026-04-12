// orchestrators/tree.js
// Position determines reality.
// Extension at this position? Route to its mode.
// No extension? tree:converse. The AI reads what's here and talks.

import log from "../../seed/log.js";
import { WS } from "../../seed/protocol.js";
import {
  switchMode,
  processMessage,
  getRootId,
  getCurrentNodeId,
  setCurrentNodeId,
  getClientForUser,
  resolveRootLlmForMode,
} from "../../seed/llm/conversation.js";
import { classify } from "./translator.js";
import { getLandConfigValue } from "../../seed/landConfig.js";

/**
 * Local intent classification. Zero LLM calls.
 *
 * Two jobs:
 * 1. Extension routing: if a mode override is set at the current node AND
 *    the message matches that extension's classifierHints, route directly
 *    to the extension mode. One LLM call. No librarian.
 * 2. Intent classification: greetings/questions → query, destructive → destructive,
 *    action commands → place, everything else → place (librarian decides).
 */
async function localClassify(message, currentNodeId, rootId) {
  const lower = message.toLowerCase().trim();
  const base = { summary: message.slice(0, 100), responseHint: "" };

  // ── Routing index (fast path) ──
  // One Map scan. No DB queries. Catches deep extensions that Level 1-3 miss.
  if (rootId && currentNodeId) {
    try {
      const { queryIndex } = await import("./routingIndex.js");
      const currentPath = await _buildCurrentPath(currentNodeId);
      const match = queryIndex(rootId, message, currentPath);
      if (match) {
        return { intent: "extension", mode: match.mode, targetNodeId: match.targetNodeId, confidence: match.confidence, ...base };
      }
    } catch {}
  }

  // ── Extension routing (Path 2, fallback) ──
  // Level-by-level DB walk. Kept as backup for unindexed trees.
  if (currentNodeId) {
    try {
      const { getClassifierHintsForMode } = await import("../loader.js");
      const currentNode = await Node.findById(currentNodeId).select("metadata children").lean();

      // Level 1: current node has a mode override.
      // If hints match, route with high confidence. If not, still route to the
      // extension but the mode must handle generic messages (status, review, etc).
      const modes = currentNode?.metadata instanceof Map
        ? currentNode.metadata.get("modes")
        : currentNode?.metadata?.modes;
      if (modes?.respond) {
        const hints = getClassifierHintsForMode(modes.respond);
        if (!hints || hints.some(re => re.test(message))) {
          return { intent: "extension", mode: modes.respond, targetNodeId: String(currentNodeId), confidence: 0.95, ...base };
        }
        // No hint match but we're at an extension node. Still route here
        // because the librarian doesn't understand extension data models.
        return { intent: "extension", mode: modes.respond, targetNodeId: String(currentNodeId), confidence: 0.8, ...base };
      }

      // Level 2: direct children (do any of my children claim this message?)
      if (currentNode?.children?.length > 0) {
        const children = await Node.find({ _id: { $in: currentNode.children } })
          .select("_id name metadata").lean();
        for (const child of children) {
          const childModes = child.metadata instanceof Map
            ? child.metadata.get("modes")
            : child.metadata?.modes;
          if (!childModes?.respond) continue;
          const hints = getClassifierHintsForMode(childModes.respond);
          if (hints?.some(re => re.test(message))) {
            return {
              intent: "extension",
              mode: childModes.respond,
              targetNodeId: String(child._id),
              confidence: 0.85,
              ...base,
            };
          }
        }
      }

      // Level 3: siblings (does a sibling of the current node claim this message?)
      if (currentNode?.parent) {
        const parentNode = await Node.findById(currentNode.parent).select("children").lean();
        if (parentNode?.children?.length > 1) {
          const siblingIds = parentNode.children
            .map(id => String(id))
            .filter(id => id !== String(currentNodeId));
          if (siblingIds.length > 0) {
            const siblings = await Node.find({ _id: { $in: siblingIds } })
              .select("_id name metadata").lean();
            for (const sib of siblings) {
              const sibModes = sib.metadata instanceof Map
                ? sib.metadata.get("modes")
                : sib.metadata?.modes;
              if (!sibModes?.respond) continue;
              const hints = getClassifierHintsForMode(sibModes.respond);
              if (hints?.some(re => re.test(message))) {
                return {
                  intent: "extension",
                  mode: sibModes.respond,
                  targetNodeId: String(sib._id),
                  confidence: 0.8,
                  ...base,
                };
              }
            }
          }
        }
      }
    } catch {}
  }

  // ── No extension claimed this message ──
  // Position determines reality. The AI at this position has all the tools
  // it needs (read, write, navigate, delete). Let it decide what to do.
  // No regex. No guessing. Just converse.
  return { intent: "converse", confidence: 0.8, ...base };
}

/**
 * Extract the behavioral constraint from the source type.
 * Four commands constrain what happens at any position.
 *
 *   query  →  tools: read-only    response: full       writes: blocked
 *   place  →  tools: all          response: minimal    writes: allowed
 *   chat   →  tools: all          response: full       writes: allowed
 *   be     →  tools: all          response: guided     writes: allowed
 */
function extractBehavioral(sourceType) {
  if (sourceType === "query" || sourceType.endsWith("-query")) return "query";
  if (sourceType === "place" || sourceType.endsWith("-place")) return "place";
  if (sourceType === "be" || sourceType.endsWith("-be")) return "be";
  return "chat"; // default
}
import { setChatContext } from "../../seed/llm/chatTracker.js";
import { isActiveNavigator } from "../../seed/ws/sessionRegistry.js";

import {
  getContextForAi,
  getNavigationContext,
  buildDeepTreeSummary,
} from "../../seed/tree/treeFetch.js";
import mongoose from "mongoose";
import Node from "../../seed/models/node.js";
import { OrchestratorRuntime } from "../../seed/orchestrators/runtime.js";
import { resolveMode } from "../../seed/modes/registry.js";

// ─────────────────────────────────────────────────────────────────────────
// PATH RESOLUTION (for routing index scope check)
// ─────────────────────────────────────────────────────────────────────────

const _pathCache = new Map(); // nodeId -> { path, ts }
const PATH_TTL = 30000;

async function _buildCurrentPath(nodeId) {
  const cached = _pathCache.get(String(nodeId));
  if (cached && Date.now() - cached.ts < PATH_TTL) return cached.path;

  const parts = [];
  let current = await Node.findById(nodeId).select("name parent rootOwner").lean();
  let depth = 0;
  while (current && depth < 20) {
    parts.unshift(current.name || String(current._id));
    if (current.rootOwner || !current.parent) break;
    current = await Node.findById(current.parent).select("name parent rootOwner").lean();
    depth++;
  }
  const path = "/" + parts.join("/");

  _pathCache.set(String(nodeId), { path, ts: Date.now() });
  // Cap cache
  if (_pathCache.size > 500) {
    const oldest = [..._pathCache.entries()].sort((a, b) => a[1].ts - b[1].ts);
    for (let i = 0; i < 100; i++) _pathCache.delete(oldest[i][0]);
  }
  return path;
}

// ─────────────────────────────────────────────────────────────────────────
// INTELLIGENCE BRIEF (cached per tree, 60s TTL)
// Collects signals from installed extensions so the librarian sees the
// tree's living state, not just its skeleton.
// ─────────────────────────────────────────────────────────────────────────

const briefCache = new Map(); // rootId -> { brief, timestamp }
const BRIEF_TTL = 60000;
const BRIEF_CACHE_MAX = 100;

async function getIntelligenceBrief(rootId, userId) {
  const cached = briefCache.get(rootId);
  if (cached && Date.now() - cached.timestamp < BRIEF_TTL) return cached.brief;

  const brief = await buildIntelligenceBrief(rootId, userId);

  // Evict oldest if at capacity
  if (briefCache.size >= BRIEF_CACHE_MAX && !briefCache.has(rootId)) {
    const oldest = briefCache.keys().next().value;
    briefCache.delete(oldest);
  }
  briefCache.set(rootId, { brief, timestamp: Date.now() });
  return brief;
}

async function buildIntelligenceBrief(rootId, userId) {
  let getExtension;
  try {
    ({ getExtension } = await import("../loader.js"));
  } catch { return null; }

  const sections = [];

  // Competence: what the tree knows and doesn't know
  try {
    const comp = getExtension("competence");
    if (comp?.exports?.getCompetence) {
      const data = await comp.exports.getCompetence(rootId);
      if (data?.totalQueries >= 10) {
        const strong = (data.strongTopics || []).slice(0, 5).join(", ");
        const weak = (data.weakTopics || []).slice(0, 5).join(", ");
        if (strong || weak) {
          sections.push(`Competence: answers well on [${strong || "unknown"}]. Weak on [${weak || "unknown"}]. Answer rate: ${Math.round((data.answerRate || 0) * 100)}%.`);
        }
      }
    }
  } catch {}

  // Explore: last exploration map at root
  try {
    const exp = getExtension("explore");
    if (exp?.exports?.getExploreMap) {
      const map = await exp.exports.getExploreMap(rootId);
      if (map && map.confidence > 0) {
        const findings = (map.map || []).slice(0, 3).map(f => f.nodeName || f.nodeId).join(", ");
        const gaps = (map.gaps || []).slice(0, 2).join("; ");
        sections.push(`Explored: ${map.coverage} coverage, ${map.nodesExplored} nodes checked. Key areas: ${findings || "none"}.${gaps ? " Gaps: " + gaps : ""}`);
      }
    }
  } catch {}

  // Contradiction: unresolved conflicts
  try {
    const con = getExtension("contradiction");
    if (con?.exports?.getUnresolved) {
      const unresolved = await con.exports.getUnresolved(rootId);
      if (Array.isArray(unresolved) && unresolved.length > 0) {
        const top = unresolved.slice(0, 2).map(c => `"${c.claim}" vs "${c.conflictsWith}"`).join("; ");
        sections.push(`Contradictions: ${unresolved.length} unresolved. ${top}`);
      }
    }
  } catch {}

  // Purpose: thesis and coherence
  try {
    const pur = getExtension("purpose");
    if (pur) {
      const root = await Node.findById(rootId).select("metadata").lean();
      const meta = root?.metadata instanceof Map ? root.metadata.get("purpose") : root?.metadata?.purpose;
      if (meta?.thesis) {
        const coherence = meta.recentCoherence != null ? ` Coherence: ${Math.round(meta.recentCoherence * 100)}%.` : "";
        sections.push(`Purpose: "${meta.thesis}"${coherence}`);
      }
    }
  } catch {}

  // Evolution: dormant branches
  try {
    const evo = getExtension("evolution");
    if (evo?.exports?.getDormant) {
      const dormant = await evo.exports.getDormant(rootId);
      if (Array.isArray(dormant) && dormant.length > 0) {
        const names = dormant.slice(0, 3).map(d => d.name || d.nodeName).join(", ");
        sections.push(`Dormant: ${dormant.length} branch${dormant.length > 1 ? "es" : ""}. ${names}.`);
      }
    }
  } catch {}

  // Remember: recent departures
  try {
    const rem = getExtension("remember");
    if (rem) {
      const root = await Node.findById(rootId).select("metadata").lean();
      const meta = root?.metadata instanceof Map ? root.metadata.get("remember") : root?.metadata?.remember;
      if (meta?.departed?.length > 0) {
        const recent = meta.departed.slice(-3).map(d => `${d.name} (${d.note})`).join("; ");
        sections.push(`Departed: ${recent}`);
      }
    }
  } catch {}

  if (sections.length === 0) return null;
  return "Intelligence:\n" + sections.map(s => "  " + s).join("\n");
}

// ─────────────────────────────────────────────────────────────────────────
// MODE RESOLUTION HELPER
// ─────────────────────────────────────────────────────────────────────────

/**
 * Resolve mode key for an intent at a node. Checks per-node overrides.
 * Falls back to default tree:{intent} mode.
 */
async function resolveModeForNode(intent, nodeId) {
  if (!nodeId) return `tree:${intent}`;
  try {
    const node = await Node.findById(nodeId).select("metadata").lean();
    return resolveMode(intent, "tree", node?.metadata);
  } catch {
    return `tree:${intent}`;
  }
}

// ─────────────────────────────────────────────────────────────────────────
// PENDING OPERATIONS (confirmation flow)
// ─────────────────────────────────────────────────────────────────────────
// CONVERSATION MEMORY (survives mode switches)
// ─────────────────────────────────────────────────────────────────────────

// visitorId → [{ role: "user"|"assistant", content }]
const orchestratorMemory = new Map();
const MAX_MEMORY_TURNS = 10; // 5 exchanges (user + assistant each)

function getMemory(visitorId) {
  return orchestratorMemory.get(visitorId) || [];
}

function pushMemory(visitorId, userMessage, assistantResponse) {
  const mem = getMemory(visitorId);
  mem.push(
    { role: "user", content: userMessage },
    { role: "assistant", content: assistantResponse },
  );
  // Keep only the last N turns
  while (mem.length > MAX_MEMORY_TURNS) mem.shift();
  orchestratorMemory.set(visitorId, mem);
}

function clearMemory(visitorId) {
  orchestratorMemory.delete(visitorId);
}

export { clearMemory };

/**
 * Format memory as context string for injection into mode messages.
 */
function formatMemoryContext(visitorId) {
  const mem = getMemory(visitorId);
  if (mem.length === 0) return "";
  const lines = mem.map((m) =>
    m.role === "user" ? `User: ${m.content}` : `Assistant: ${m.content}`,
  );
  return `\n\nRecent conversation:\n${lines.join("\n")}`;
}

// ─────────────────────────────────────────────────────────────────────────
// ORCHESTRATOR
// ─────────────────────────────────────────────────────────────────────────

/**
 * Emit a status event to the frontend.
 */
function emitStatus(socket, phase, text) {
  socket.emit("executionStatus", { phase, text });
}

/**
 * Emit an internal mode result to the chat so the user can see what's happening.
 */
function emitModeResult(socket, modeKey, result) {
  // Strip internal tracking fields before sending to client
  let sanitized = result;
  if (result && typeof result === "object") {
    const { _llmProvider, _raw, ...rest } = result;
    sanitized = rest;
  }
  socket.emit("orchestratorStep", {
    modeKey,
    result:
      typeof sanitized === "string"
        ? sanitized
        : JSON.stringify(sanitized, null, 2),
    timestamp: Date.now(),
  });
}

// ─────────────────────────────────────────────────────────────────────────
// SHARED: RESOLVE LLM PROVIDER
// ─────────────────────────────────────────────────────────────────────────

async function resolveLlmProvider(userId, rootId, modeKey, slot) {
  try {
    const modeConnectionId = await resolveRootLlmForMode(rootId, modeKey);
    const clientInfo = await getClientForUser(userId, slot, modeConnectionId);
    return {
      isCustom: clientInfo.isCustom,
      model: clientInfo.model,
      connectionId: clientInfo.connectionId || null,
    };
  } catch {
    return { isCustom: false, model: null, connectionId: null };
  }
}

// ─────────────────────────────────────────────────────────────────────────
// SUFFIX CONVENTION ROUTING (one function, one place)
// ─────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────
// THE GRAMMAR
//
// The tree has a grammar. You speak naturally. The system parses.
//
//   Nouns        = Nodes (things with identity, position, relationships)
//   Verbs        = Extensions (ways of acting: food tracks, fitness logs)
//   Tense        = Modes (how the verb conjugates for this message)
//   Adjectives   = Metadata (values, goals, status that describe nouns)
//   Adverbs      = Instructions (modify how the verb behaves)
//   Prepositions = Tree structure + scoping (under, above, blocked at)
//   Pronouns     = Position (currentNodeId, rootId, "here", "this")
//   Articles     = Existence (THE bench press = route, A bench press = create)
//
// The pipeline parses every message through four layers:
//
// Layer 1: RESOLUTION (where + domain)
//   Parse noun        — routing index identifies territory
//   Parse pronouns    — resolve "it", "that", "same" from state
//   Parse prepositions — "under recovery" shifts target node
//   Determines: which extension, which node, which scope.
//
// Layer 2: INTENT (what action + control flow)
//   Parse tense       — review / coach / plan / log
//   Detect negation   — cancel default, reroute to coach
//   Detect compound   — sequential chaining via conjunctions
//   Confidence check  — if grammar uncertain, escalate to LLM
//   Determines: which mode fires, whether to chain.
//
// Layer 3: QUALIFICATION (how to interpret + constrain)
//   Parse adjectives  — quality/focus ("high protein", "ready for")
//   Detect voice      — active (execute) vs passive (observe)
//   Inject adverbs    — instructions ("be concise", "use kg")
//   Inject boundaries — extension scope limits
//   Inject persona    — identity and tone
//   Determines: framing, focus, constraints.
//
// Layer 4: PLANNING + EXECUTION
//   Single            — runModeAndReturn
//   Chain             — runChain (sequential compound)
//   Causal            — cross-domain routing (effect from cause)
//   Determines: what actually runs.
//
// Three orthogonal axes, each evolves independently:
//   WHERE — noun + preposition + pronoun
//   WHAT  — tense + negation + compound
//   HOW   — adjectives + adverbs + voice + boundaries
//
// Guiding principle: don't ask "what system feature is missing?"
// Ask "what human expression currently breaks or feels unnatural?"
// Map it to: noun, verb, tense, modifier, structure.
// That becomes the roadmap.
// ─────────────────────────────────────────────────────────────────────────

// Tense patterns. These conjugate the verb (extension) into the right mode.
// Past tense (review):           reflecting on what happened
// Future/subjunctive (coach):    guidance, questions, corrections, conversation
// Imperative (plan):             structural commands, building, modifying
// Negation (coach):              cancels the default action, routes to conversation
// Present tense (log):           recording facts, stating actions (default)

const TENSE_PAST = /\b(how am i|how did i|how have i|progress|status|review|daily|weekly|stats|streak|history|trend|so far|pattern|doing|summary|recap|compare|average|report|results|track record)\b/i;

const TENSE_FUTURE = new RegExp([
  // Asking for guidance
  "what should i", "should i", "help me", "recommend", "suggest",
  "advice", "advise", "guide", "what do i", "what can i", "tell me what",
  "coach", "what next", "whats next", "next up", "ready for",
  "prepare", "warm up", "ideas?", "options?", "thoughts?", "opinion",
  // Corrections and clarifications (not data, just conversation)
  "supposed to be", "should be", "actually is", "i meant", "correction",
  "wrong", "mistake", "fix that", "update that", "not right", "oops",
  // Conversational (not logging, just talking)
  "why", "explain", "tell me about", "what is", "what are", "how does",
  "can you", "do you", "is it", "are there", "would it",
  // Greetings and small talk (stay in coach, don't try to log "hi")
  "^hi$", "^hey$", "^hello$", "^yo$", "^sup$", "^whats up$",
].map(p => `(?:${p})`).join("|"), "i");

const TENSE_IMPERATIVE = /\b(plan|build|create|setup|set up|structure|organize|add|modify|remove|delete|restructure|program|taper|schedule|adjust|set.*goal|change|curriculum|configure|redesign|rebuild|swap|replace|rename)\b/i;

// Negation: cancels the default action. The user is saying "don't do the thing."
// Routes to coach (conversation) instead of log (action).
// This is the seed of the constraint layer: undo, permissions, conditions.
const NEGATION = /\b(don'?t|do not|not|no|skip|stop|cancel|ignore|forget it|never mind|undo|that'?s wrong|wasn'?t|isn'?t|aren'?t|won'?t)\b/i;

/**
 * Parse tense: which conjugation of the verb (extension) handles this message.
 *
 * Called ONCE per message after the noun (extension territory) is identified.
 * Returns the resolved mode key for the identified tense.
 */
async function parseTense(baseMode, message, behavioral) {
  try {
    const { getModeOwner, getModesOwnedBy } = await import("../../seed/tree/extensionScope.js");
    const extName = getModeOwner(baseMode);
    if (!extName) return { mode: baseMode, tense: "present", pattern: "none" };

    const extModes = getModesOwnedBy(extName);
    if (extModes.length <= 1) return { mode: baseMode, tense: "present", pattern: "single-mode" };

    const find = (...suffixes) => {
      for (const s of suffixes) {
        const match = extModes.find(m => m.endsWith(`-${s}`));
        if (match) return match;
      }
      return null;
    };
    const lower = message.toLowerCase().trim();

    if (behavioral === "be" || lower === "be") {
      return { mode: find("coach") || baseMode, tense: "imperative-guided", pattern: "be" };
    }

    // Detect all matching tenses for compound intent detection
    const matches = [];
    if (TENSE_PAST.test(lower)) matches.push({ tense: "past", mode: find("review", "ask"), pattern: "review" });
    if (TENSE_FUTURE.test(lower)) matches.push({ tense: "future", mode: find("coach"), pattern: "coach" });
    if (TENSE_IMPERATIVE.test(lower)) matches.push({ tense: "imperative", mode: find("plan"), pattern: "plan" });

    // Compound intent: multiple tenses in one message ("log lunch and then review my week")
    // Conjunction words signal sequencing: "and then", "then", "after that", "also"
    const CONJUNCTION = /\b(and then|then|after that|afterwards|also|and also|followed by|next)\b/i;
    if (matches.length > 1 && CONJUNCTION.test(lower)) {
      const steps = matches.filter(m => m.mode).map(m => ({
        mode: m.mode,
        tense: m.tense,
        extName: extName,
        targetNodeId: null,
      }));
      // Add the default log tense as the first step if not already present
      // (user probably wants to DO the thing, then review/plan/coach)
      const hasPresent = matches.some(m => m.tense === "present");
      if (!hasPresent && steps.length > 0) {
        const logMode = find("log", "tell");
        if (logMode) steps.unshift({ mode: logMode, tense: "present", extName, targetNodeId: null });
      }
      return {
        mode: steps[0].mode || baseMode,
        tense: steps[0].tense,
        pattern: "compound",
        compound: steps,
      };
    }

    // Single tense match: return the first (highest priority)
    if (matches.length > 0) {
      const m = matches[0];
      return { mode: m.mode || baseMode, tense: m.tense, pattern: m.pattern };
    }

    // Negation: cancels the default action. Route to coach for conversation.
    if (NEGATION.test(lower)) {
      return { mode: find("coach") || baseMode, tense: "negated", pattern: "negation" };
    }

    return { mode: find("log", "tell") || baseMode, tense: "present", pattern: "default" };
  } catch {
    return { mode: baseMode, tense: "present", pattern: "error" };
  }
}

// Backward-compat aliases (extensions or tests that import these names)
const REVIEW_PATTERN = TENSE_PAST;
const COACH_PATTERN = TENSE_FUTURE;
const PLAN_PATTERN = TENSE_IMPERATIVE;

// ─────────��────────────────────���───────────────────────��──────────────────
// PRONOUN STATE (reference memory)
//
// Pronouns resolve "it", "this", "that", "the same" to concrete nodes.
// Three slots tracked per visitor:
//   active    — the node the user is currently at (currentNodeId)
//   lastMod   — the last node modified by a tool call (updated by afterToolCall)
//   lastNoun  — the last extension territory the parser resolved
//
// "Do that again" → lastMod tells us what "that" was.
// "Log it" → active tells us what "it" is.
// "The same" → lastNoun tells us which extension to reuse.
// ──��──────────────────────────────────────────────────────────────────────

const _pronounState = new Map(); // visitorId -> { active, lastMod, lastNoun, lastMode, lastMessage }

function getPronounState(visitorId) {
  return _pronounState.get(visitorId) || { active: null, lastMod: null, lastNoun: null, lastMode: null, lastMessage: null };
}

export function updatePronounState(visitorId, updates) {
  const current = getPronounState(visitorId);
  _pronounState.set(visitorId, { ...current, ...updates });
}

/**
 * Parse pronouns: detect references in the message and resolve them
 * using the pronoun state. Returns resolved context or null if no pronouns found.
 */
function parsePronouns(message, visitorId) {
  const lower = message.toLowerCase().trim();
  const state = getPronounState(visitorId);
  const result = { resolvedNode: null, resolvedNoun: null, resolvedMode: null, pronoun: null };
  let found = false;

  // "that", "the same", "again", "repeat", "same thing" → refers to last modified/last action
  if (/\b(that|the same|same thing|again|repeat|redo|one more|another)\b/i.test(lower)) {
    if (state.lastMod) {
      result.resolvedNode = state.lastMod;
      result.pronoun = "that/same (lastMod)";
      found = true;
    }
    if (state.lastNoun) {
      result.resolvedNoun = state.lastNoun;
      found = true;
    }
    if (state.lastMode) {
      result.resolvedMode = state.lastMode;
      found = true;
    }
  }

  // "it", "this" → refers to current active node
  if (/\b(^it$|^this$|this one|right here)\b/i.test(lower) && state.active) {
    result.resolvedNode = state.active;
    result.pronoun = "it/this (active)";
    found = true;
  }

  return found ? result : null;
}

// ─────────────────────────────────────────────────────────────────────────
// CAUSAL CONNECTOR (cross-domain grammar)
//
// Detects cause → effect relationships between two domains.
// "Eating poorly is affecting my workouts" = food(cause) → fitness(effect)
// "Not sleeping enough is hurting my diet" = recovery(cause) → food(effect)
//
// Causal messages don't chain sequentially. They gather context from the
// CAUSE domain and inject it into the EFFECT domain's response. The AI
// at the effect domain sees what's happening in the cause domain and can
// reason about the relationship.
// ──────────────────────────────────────────────────────────��──────────────

const CAUSAL_CONNECTORS = /\b(is affecting|affects|affected|causing|caused|because of|due to|led to|leading to|hurting|helping|impacting|influenced by|thanks to|ruining|improving|messing with)\b/i;

/**
 * Detect cross-domain causal relationships in a message.
 * Returns { cause: extName, effect: extName, connector } or null.
 *
 * Only fires when 2+ extensions match AND a causal connector is present.
 * The cause domain is whichever appears BEFORE the connector in the message.
 * The effect domain is whichever appears AFTER.
 */
function detectCausality(message, matchedExtensions) {
  if (!matchedExtensions || matchedExtensions.length < 2) return null;

  const connectorMatch = CAUSAL_CONNECTORS.exec(message.toLowerCase());
  if (!connectorMatch) return null;

  const connectorPos = connectorMatch.index;

  // Sort extensions by their position in the message
  const sorted = [...matchedExtensions].sort((a, b) => {
    const aPos = a.pos != null ? a.pos : message.length;
    const bPos = b.pos != null ? b.pos : message.length;
    return aPos - bPos;
  });

  // Cause = extension mentioned before the connector, Effect = after
  let cause = null;
  let effect = null;
  for (const ext of sorted) {
    const extPos = ext.pos != null ? ext.pos : 0;
    if (extPos < connectorPos && !cause) cause = ext.extName;
    else if (extPos >= connectorPos || cause) { if (!effect) effect = ext.extName; }
  }

  // Fallback: first = cause, second = effect
  if (!cause && sorted.length >= 1) cause = sorted[0].extName;
  if (!effect && sorted.length >= 2) effect = sorted[1].extName;

  if (cause && effect && cause !== effect) {
    return { cause, effect, connector: connectorMatch[0] };
  }

  return null;
}

// ─────────────────────────────────────────────────────────────────────────
// VOICE DETECTOR
//
// Active voice: user commands action. "Log this." "Add exercise." "Review my week."
// Passive voice: user observes state. "Bench increased." "Protein was low." "Weight went up."
//
// Active = default (execute). Passive = observe, acknowledge, suggest.
// Voice doesn't change routing. It changes response framing.
// Injected as a modifier so the AI knows whether to act or reflect.
// ─────────────────────────────────────────────────────────────────────────

// Passive indicators: state changes, observations, third-person descriptions
const PASSIVE_VOICE = /\b(increased|decreased|went up|went down|dropped|rose|fell|changed|improved|worsened|got better|got worse|was high|was low|is high|is low|seems|feels|been|is affecting|is hurting|is helping|is impacting|is ruining|is improving|has been|have been|getting worse|getting better)\b/i;

function detectVoice(message) {
  if (PASSIVE_VOICE.test(message.toLowerCase())) return "passive";
  return "active";
}

// ─────────────────────────────────────────────────────────────────────────
// QUANTIFIER / SELECTOR PARSER
//
// Quantifiers scope the noun from "one node" to "a set of nodes."
// They bridge the gap between routing (find one target) and querying
// (find many targets, filter, compare, aggregate).
//
// "All workouts this week" = universal + temporal
// "Last three meals" = numeric + recency
// "Top exercises by volume" = superlative + metric
// "Compare my runs" = comparative (implies set)
//
// Without quantifiers: prepositions get overloaded, adjectives get misused.
// With quantifiers: querying, filtering, grouping, analytics.
// ─────────────────────────────────────────────────────────────────────────

const QUANTIFIER_UNIVERSAL = /\b(all|every|each|entire|whole)\b/i;
const QUANTIFIER_NUMERIC = /\b(last|first|past|recent|next)\s+(\d+|three|four|five|six|seven|eight|nine|ten|few|couple)\b/i;
const QUANTIFIER_SUPERLATIVE = /\b(best|worst|highest|lowest|most|least|top|bottom)\s+(\w+)/i;
const QUANTIFIER_COMPARATIVE = /\b(compare|versus|vs\.?|between|difference)\b/i;
const QUANTIFIER_TEMPORAL = /\b(this|last|past|next)\s+(week|month|day|year|session|workout|meal)\b/i;

/**
 * Parse quantifiers: detect selection scope from the message.
 * Returns { type, value, scope } or null if no quantifier found.
 */
function parseQuantifier(message) {
  const lower = message.toLowerCase();
  const quantifiers = [];
  let match;

  if ((match = QUANTIFIER_NUMERIC.exec(lower))) {
    const numMap = { three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, few: 3, couple: 2 };
    const count = numMap[match[2]] || parseInt(match[2]) || 3;
    quantifiers.push({ type: "numeric", direction: match[1], count });
  }

  if (QUANTIFIER_UNIVERSAL.test(lower)) {
    quantifiers.push({ type: "universal" });
  }

  if ((match = QUANTIFIER_SUPERLATIVE.exec(lower))) {
    quantifiers.push({ type: "superlative", qualifier: match[1], subject: match[2] });
  }

  if (QUANTIFIER_COMPARATIVE.test(lower)) {
    quantifiers.push({ type: "comparative" });
  }

  if ((match = QUANTIFIER_TEMPORAL.exec(lower))) {
    quantifiers.push({ type: "temporal", direction: match[1], unit: match[2] });
  }

  return quantifiers.length > 0 ? quantifiers : null;
}

// ─────────────────────────────────────────────────────────────────────────
// CONDITIONAL PARSER
//
// Conditionals are branching logic in natural language.
// "If protein is low, suggest high-protein foods" = condition -> action.
// "When I finish this set, log it" = temporal trigger -> action.
// "Unless I'm fasting, log breakfast" = negated condition -> action.
//
// Three types:
//   if/when    — condition that gates the action (evaluate first, then act)
//   unless     — negated condition (act UNLESS this is true)
//   after/once — temporal trigger (act when condition becomes true)
//
// Conditionals don't change routing. They inject [Conditional] context
// so the mode knows to evaluate the condition before executing.
// The AI checks the condition against current state and decides.
// ─────────────────────────────────────────────────────────────────────────

const CONDITIONAL_IF = /\b(if|in case|assuming|provided|given that|suppose|supposing)\b\s+(.+?)(?:\s*[,;]\s*|\s+then\s+)/i;
const CONDITIONAL_WHEN = /\b(when|whenever|once|after|as soon as|the moment|next time)\b\s+(.+?)(?:\s*[,;]\s*|\s+then\s+)/i;
const CONDITIONAL_UNLESS = /\b(unless|except if|except when|if not|only if not)\b\s+(.+?)(?:\s*[,;]\s*)/i;
// Fallback: "if X" at the start of the message without a comma (short form)
const CONDITIONAL_SHORT = /^(if|when|unless|once|after)\s+(.+?)(?:\s*$)/i;

/**
 * Parse conditionals: detect branching logic in natural language.
 * Returns { type, keyword, condition, action } or null.
 *
 * type:
 *   "if"      — evaluate condition, then act
 *   "when"    — temporal trigger, act when condition is met
 *   "unless"  — act unless condition is true (negated if)
 */
function parseConditional(message) {
  const lower = message.toLowerCase().trim();
  let match;

  // Try each pattern in priority order
  if ((match = CONDITIONAL_IF.exec(lower))) {
    return { type: "if", keyword: match[1], condition: match[2].trim() };
  }
  if ((match = CONDITIONAL_UNLESS.exec(lower))) {
    return { type: "unless", keyword: match[1], condition: match[2].trim() };
  }
  if ((match = CONDITIONAL_WHEN.exec(lower))) {
    return { type: "when", keyword: match[1], condition: match[2].trim() };
  }

  // Short form: "if protein is low" (no comma, no then)
  // Only match if the message starts with a conditional keyword
  if ((match = CONDITIONAL_SHORT.exec(lower))) {
    const kw = match[1].toLowerCase();
    const type = kw === "unless" ? "unless" : (kw === "when" || kw === "once" || kw === "after") ? "when" : "if";
    return { type, keyword: match[1], condition: match[2].trim() };
  }

  return null;
}

// ─────────────────────────────────────────────────────────────────────────
// ADJECTIVE PARSER
//
// Adjectives modify the noun by describing quality, state, or focus.
// They don't change routing. They change what the mode pays attention to.
// "High protein" = focus on protein. "Ready for progression" = evaluate state.
// "Low calorie" = constrain suggestions. "Best workout" = superlative filter.
//
// Adjectives become: filters, evaluators, triggers, focus constraints.
// Injected into the mode context so the AI knows what aspect matters.
// ─────────────────────────────────────────────────────────────────────────

// Pre-noun: "high protein", "bad diet". Post-noun: "eating poorly", "sleeping badly".
const QUALITY_ADJ = /\b(high|low|good|bad|poor|strong|weak|heavy|light|best|worst|top|most|least)\s+(\w+)|\b(\w+)\s+(poorly|badly|well|terribly|great|consistently|inconsistently)\b/gi;
const STATE_ADJ = /\b(ready for|due for|behind on|ahead on|struggling with|improving|declining|stalled|consistent|overtrained|undertrained|sore|tired|fatigued|energized)\s*(\w*)/gi;
const COMPARATIVE_ADJ = /\b(more|less|too much|too little|not enough|enough|plenty of|lacking)\s+(\w+)/gi;

/**
 * Parse adjectives: extract quality modifiers that focus the mode's response.
 * Returns an array of { type, qualifier, subject } or empty array.
 */
function parseAdjectives(message) {
  const adjectives = [];
  const lower = message.toLowerCase();
  let match;

  QUALITY_ADJ.lastIndex = 0;
  while ((match = QUALITY_ADJ.exec(lower)) !== null) {
    if (match[1] && match[2]) {
      // Pre-noun: "high protein"
      adjectives.push({ type: "quality", qualifier: match[1], subject: match[2] });
    } else if (match[3] && match[4]) {
      // Post-noun: "eating poorly"
      adjectives.push({ type: "quality", qualifier: match[4], subject: match[3] });
    }
  }

  STATE_ADJ.lastIndex = 0;
  while ((match = STATE_ADJ.exec(lower)) !== null) {
    if (match[2]) adjectives.push({ type: "state", qualifier: match[1], subject: match[2] });
    else adjectives.push({ type: "state", qualifier: match[1], subject: null });
  }

  COMPARATIVE_ADJ.lastIndex = 0;
  while ((match = COMPARATIVE_ADJ.exec(lower)) !== null) {
    adjectives.push({ type: "comparative", qualifier: match[1], subject: match[2] });
  }

  return adjectives;
}

// ─────────────────────────────────────────────────────────────────────────
// PREPOSITION PARSER
//
// Prepositions alter WHERE an action happens without changing WHAT happens.
// "Log this under recovery" = verb is log, noun shifts to recovery.
// "Compare this with last week" = verb is review, scope shifts to temporal.
// "Move this into finance" = verb is plan, target shifts to finance.
//
// Prepositions turn the tree into a navigable semantic space.
// ─────────────────────────────────────────────────────────────────────────

// Spatial prepositions that redirect the target node
const PREPOSITION_PATTERN = /\b(?:under|in|into|at|to|from|for|on|within)\s+([a-zA-Z][\w\s-]{1,40}?)(?:\s*$|\s*(?:and|then|,|\.))/i;

// Temporal prepositions that modify the query scope
const TEMPORAL_PREPOSITION = /\b(?:from|since|after|before|during|last|this|past)\s+(week|month|day|yesterday|today|monday|tuesday|wednesday|thursday|friday|saturday|sunday|\d+\s*days?)/i;

/**
 * Parse prepositions: extract spatial and temporal modifiers from the message.
 * Returns { targetOverride, temporal, preposition, raw } or null if none found.
 *
 * Spatial: "under recovery" -> resolves "recovery" to a node in the routing index
 * Temporal: "from last week" -> passes time scope to the mode
 */
async function parsePreposition(message, rootId) {
  const lower = message.toLowerCase();
  const result = { targetOverride: null, temporal: null, preposition: null, raw: null };
  let found = false;

  // Spatial preposition: resolve the target name to a node via routing index
  const spatialMatch = PREPOSITION_PATTERN.exec(lower);
  if (spatialMatch && rootId) {
    const targetName = spatialMatch[1].trim();
    try {
      const { getIndexForRoot } = await import("./routingIndex.js");
      const index = getIndexForRoot(rootId);
      if (index) {
        // Search routing index for a matching extension or node name
        for (const [extName, entry] of index) {
          if (extName.toLowerCase() === targetName ||
              entry.name?.toLowerCase() === targetName ||
              entry.path?.toLowerCase().includes(targetName)) {
            result.targetOverride = entry.nodeId;
            result.preposition = spatialMatch[0].trim();
            result.raw = targetName;
            found = true;
            break;
          }
        }
      }
      // If not in routing index, search tree children by name
      if (!result.targetOverride) {
        const Node = (await import("../../seed/models/node.js")).default;
        const children = await Node.find({ parent: rootId }).select("_id name").lean();
        for (const child of children) {
          if (child.name?.toLowerCase() === targetName ||
              child.name?.toLowerCase().includes(targetName)) {
            result.targetOverride = String(child._id);
            result.preposition = spatialMatch[0].trim();
            result.raw = targetName;
            found = true;
            break;
          }
        }
      }
    } catch {}
  }

  // Temporal preposition: extract time scope
  const temporalMatch = TEMPORAL_PREPOSITION.exec(lower);
  if (temporalMatch) {
    result.temporal = temporalMatch[0].trim();
    found = true;
  }

  return found ? result : null;
}

// ─────────────────────────────────────────────────────────────────────────
// GRAMMAR DEBUGGER (standalone, called from every path)
// ─────────────────────────────────────────────────────────────────────────

function logParseTree(message, { noun, nounSource, nounConf, tense, tensePattern, tenseConf, resolvedMode, negated, compound, pronoun, quantifiers, adjectives, voice, preposition, prepTarget, temporal, conditional, forcedMode }) {
  const debugLines = [];
  debugLines.push(`📖 Parse: "${(message || "").slice(0, 80)}"`);
  debugLines.push(`   noun: ${noun || "?"} (${nounSource || "?"}, conf=${(nounConf || 0).toFixed(2)})`);
  debugLines.push(`   tense: ${tense || "?"} (${tensePattern || "?"}, conf=${(tenseConf || 0).toFixed(2)})`);
  if (negated) debugLines.push(`   negation: YES`);
  if (compound) debugLines.push(`   compound: ${compound.join(" -> ")}`);
  if (pronoun) debugLines.push(`   pronoun: ${pronoun}`);
  if (quantifiers && quantifiers.length > 0) debugLines.push(`   quantifiers: ${quantifiers.map(q => q.type === "numeric" ? `${q.direction} ${q.count}` : q.type === "temporal" ? `${q.direction} ${q.unit}` : q.type === "superlative" ? `${q.qualifier} ${q.subject}` : q.type).join(", ")}`);
  if (adjectives && adjectives.length > 0) debugLines.push(`   adjectives: ${adjectives.map(a => `${a.qualifier} ${a.subject || ""}`).join(", ")}`);
  if (voice === "passive") debugLines.push(`   voice: passive`);
  if (preposition) debugLines.push(`   preposition: "${preposition}" -> ${prepTarget}`);
  if (temporal) debugLines.push(`   temporal: ${temporal}`);
  if (conditional) debugLines.push(`   conditional: ${conditional.type} (${conditional.keyword}) "${conditional.condition}"`);
  if (forcedMode) debugLines.push(`   forced: ${forcedMode}`);
  const compositeConf = ((nounConf || 0.5) * 0.6) + ((tenseConf || 0.5) * 0.4);
  debugLines.push(`   confidence: ${compositeConf.toFixed(2)}${compositeConf < 0.65 ? " (LOW)" : ""}`);
  debugLines.push(`   dispatch: ${resolvedMode || "?"}`);
  for (const line of debugLines) log.info("Grammar", line);
}

// ─────────────────────────────────────────────────────────────────────────
// RUN MODE AND RETURN (eliminates copy-pasted switchMode/processMessage)
// ─────────────────────────────────────────────────────────────────────────

/**
 * Switch to a mode, run processMessage, handle memory and status events,
 * return the standard response shape. Every exit path that runs a mode
 * should call this instead of inlining the same 20 lines.
 */
async function runModeAndReturn(visitorId, mode, message, {
  socket, username, userId, rootId, signal, slot,
  currentNodeId, readOnly = false, clearHistory = false,
  onToolLoopCheckpoint, modesUsed,
  targetNodeId = null,
  treeCapabilities = null,
  adjectives = null,
  quantifiers = null,
  conditional = null,
  voice = "active",
}) {
  modesUsed.push(mode);
  emitStatus(socket, "intent", "");

  // Build conversation memory + grammar modifier injections.
  let memory = formatMemoryContext(visitorId);

  // Voice injection: passive voice means the user is observing, not commanding.
  // The AI should acknowledge, reflect, and suggest rather than execute.
  if (voice === "passive") {
    const voiceBlock = `[Voice: passive] The user is describing something that happened or a state they noticed. ` +
      `Observe and acknowledge. Reflect on what it means. Suggest next steps if relevant. ` +
      `Do not treat this as a command to log or execute.`;
    memory = (memory ? memory + "\n\n" : "") + voiceBlock;
  }

  // Quantifier injection: tells the AI to query a set, not act on one node.
  if (quantifiers && quantifiers.length > 0) {
    const qDescs = quantifiers.map(q => {
      if (q.type === "numeric") return `${q.direction} ${q.count}`;
      if (q.type === "temporal") return `${q.direction} ${q.unit}`;
      if (q.type === "superlative") return `${q.qualifier} ${q.subject}`;
      if (q.type === "comparative") return "compare/contrast";
      if (q.type === "universal") return "all/every";
      return q.type;
    });
    const qBlock = `[Selection] The user is asking about a SET, not a single item: ${qDescs.join(", ")}. Query and aggregate across multiple entries. Do not respond about just the current/latest value.`;
    memory = (memory ? memory + "\n\n" : "") + qBlock;
  }

  // Adjective injection: focus constraints from the parsed message.
  if (adjectives && adjectives.length > 0) {
    const focusLines = adjectives.map(a => {
      const subject = a.subject ? ` ${a.subject}` : "";
      return `${a.qualifier}${subject}`;
    });
    const focusBlock = `[Focus] The user's message emphasizes: ${focusLines.join(", ")}. Prioritize this in your response.`;
    memory = (memory ? memory + "\n\n" : "") + focusBlock;
  }

  // Conditional injection: tells the AI to evaluate a condition before acting.
  if (conditional) {
    const condBlock = conditional.type === "unless"
      ? `[Conditional: unless] Evaluate this condition: "${conditional.condition}". If the condition is TRUE, do NOT perform the action. If FALSE, proceed normally.`
      : conditional.type === "when"
      ? `[Conditional: when] The user wants this to happen when a condition is met: "${conditional.condition}". Check if the condition is currently true. If yes, proceed. If not, acknowledge and explain what needs to happen first.`
      : `[Conditional: if] Evaluate this condition first: "${conditional.condition}". Check it against current data. If true, proceed with the action. If false, explain why and what the current state is.`;
    memory = (memory ? memory + "\n\n" : "") + condBlock;
  }
  try {
    const { getModeOwner } = await import("../../seed/tree/extensionScope.js");
    const extOwner = getModeOwner(mode);
    // Only inject boundary for extension-owned modes (not kernel modes like tree:converse)
    if (extOwner && !mode.startsWith("tree:converse") && !mode.startsWith("tree:fallback")) {
      const { getIndexForRoot } = await import("./routingIndex.js");
      const index = rootId ? getIndexForRoot(rootId) : null;
      const otherDomains = [];
      if (index) {
        for (const [ext, entry] of index) {
          if (ext !== extOwner) otherDomains.push(`${ext} (${entry.path})`);
        }
      }
      const boundary = `[Boundary] You are the ${extOwner} extension. You ONLY handle ${extOwner}. ` +
        `Do not offer to set up, manage, or advise on other domains. ` +
        `You have only ${extOwner}-specific tools.` +
        (otherDomains.length > 0
          ? ` Other domains in this tree: ${otherDomains.join(", ")}. ` +
            `For those, tell the user to navigate there or talk about it at the tree root.`
          : "");
      memory = (memory ? memory + "\n\n" : "") + boundary;
    }
  } catch {}

  await switchMode(visitorId, mode, {
    username, userId, rootId,
    currentNodeId: currentNodeId || targetNodeId,
    conversationMemory: memory,
    clearHistory,
    treeCapabilities,
  });

  const result = await processMessage(visitorId, message, {
    username, userId, rootId, signal, slot,
    readOnly,
    onToolLoopCheckpoint,
    meta: { internal: false },
    onToolResults(results) {
      if (signal?.aborted) return;
      for (const r of results) socket.emit(WS.TOOL_RESULT, r);
    },
  });

  emitStatus(socket, "done", "");
  const answer = result?.content || result?.answer || null;
  if (answer) pushMemory(visitorId, message, answer);
  return { success: true, answer, modeKey: mode, modesUsed, rootId, targetNodeId: targetNodeId || currentNodeId };
}

// ─────────────────────────────────────────────────────────────────────────
// RUN CHAIN (eliminates duplicated chain execution logic)
// ─────────────────────────────────────────────────────────────────────────

/**
 * Execute a multi-extension chain. Each step runs in its own mode,
 * results pass forward as context.
 */
async function runChain(chain, message, visitorId, {
  socket, username, userId, rootId, signal, slot,
  onToolLoopCheckpoint, modesUsed,
}) {
  emitStatus(socket, "intent", "Chaining extensions...");

  let context = message;
  const chainModes = [];

  for (let i = 0; i < chain.length; i++) {
    const step = chain[i];
    const isLast = i === chain.length - 1;

    const stepNodeId = step.targetNodeId || getCurrentNodeId(visitorId) || rootId;
    await switchMode(visitorId, step.mode, {
      username, userId, rootId,
      currentNodeId: stepNodeId,
      conversationMemory: context,
      clearHistory: true,
    });

    const stepResult = await processMessage(visitorId,
      isLast ? context : `${context}\n\nDo this step and return what you produced.`, {
        username, userId, rootId, signal, slot,
        onToolLoopCheckpoint,
        onToolResults(results) {
          if (signal?.aborted) return;
          for (const r of results) socket.emit(WS.TOOL_RESULT, r);
        },
      });

    if (signal?.aborted) return null;

    const stepAnswer = stepResult?.content || stepResult?.answer || "";
    chainModes.push(step.mode);

    if (!isLast) {
      context = `Original request: ${message}\n\nPrevious step (${step.extName}) result:\n${stepAnswer}`;
    } else {
      context = stepAnswer;
    }
  }

  emitStatus(socket, "done", "");
  if (context) pushMemory(visitorId, message, context);
  return { success: true, answer: context, modeKey: chainModes[chainModes.length - 1], modesUsed: [...modesUsed, ...chainModes], rootId };
}

// ─────────────────────────────────────────────────────────────────────────
// ORCHESTRATE TREE REQUEST
// ─────────────────────────────────────────────────────────────────────────

// NOTE: respondToCompletion, executePlanSteps, runQueryFlow, runLibrarianFlow,
// executePendingOperation, scoutExistingStructure, fetchMoveCounterparts
// were removed. The orchestrator now routes to tree:converse for all
// non-extension messages. The AI has all tools at its position.

export async function orchestrateTreeRequest({
  visitorId,
  message,
  socket,
  username,
  userId,
  signal,
  sessionId,
  rootId: rootIdParam,
  skipRespond = false,
  forceQueryOnly = false,
  slot,
  rootChatId = null,
  sourceType = null,
  sourceId = null,
  onToolLoopCheckpoint = null,
}) {
  if (signal?.aborted) return null;

  const rootId = rootIdParam ?? getRootId(visitorId);

  // Create an attached runtime (reuses the websocket's session, MCP, Chat)
  const rt = new OrchestratorRuntime({
    rootId,
    userId,
    username,
    visitorId,
    sessionType: "tree-chat",
    description: message,
    modeKeyForLlm: "tree:librarian",
    slot,
  });

  const llmProvider = await resolveLlmProvider(userId, rootId, "tree:librarian", slot);

  // Attach to the existing websocket session
  rt.attach({ sessionId, mainChatId: rootChatId, llmProvider, signal, chainIndex: 1 });

  // Ensure AI contribution context is set so MCP tool calls get chatId/sessionId
  if (rootChatId) {
    setChatContext(visitorId, sessionId, rootChatId);
  }

  const meta = { username, userId, rootId, slot, llmProvider };
  const modesUsed = []; // Track full chain for Chat

  // ────────────────────────────────────────────────────────
  // QUERY FAST PATH — converse in read-only mode
  // ────────────────────────────────────────────────────────

  if (forceQueryOnly) {
    return runModeAndReturn(visitorId, "tree:converse", message, {
      socket, username, userId, rootId, signal, slot,
      readOnly: true, clearHistory: true, onToolLoopCheckpoint, modesUsed,
    });
  }

  // ────────────────────────────────────────────────────────
  // CONTINUATION CHECK — short replies continue the previous mode
  // "ok", "yes", "do it", "go ahead" etc. continue the conversation
  // instead of re-classifying and switching modes.
  // ────────────────────────────────────────────────────────

  const CONTINUE_WORDS = /^(ok|okay|yes|yeah|yep|y|go|do it|go ahead|sure|continue|proceed|next|keep going|and|then)\s*[.!?]?$/i;
  if (CONTINUE_WORDS.test(message.trim())) {
    const { getCurrentMode } = await import("../../seed/llm/conversation.js");
    const currentMode = getCurrentMode(visitorId);
    if (currentMode && currentMode !== "tree:converse" && currentMode !== "tree:fallback") {
      log.verbose("Tree Orchestrator", `  Continuation in ${currentMode}: "${message}"`);
      // Don't switchMode. Stay in current mode, just process.
      modesUsed.push(currentMode);
      emitStatus(socket, "intent", "");
      const result = await processMessage(visitorId, message, {
        username, userId, rootId, signal, slot, onToolLoopCheckpoint,
        onToolResults(results) { if (signal?.aborted) return; for (const r of results) socket.emit(WS.TOOL_RESULT, r); },
      });
      emitStatus(socket, "done", "");
      const answer = result?.content || result?.answer || null;
      if (answer) pushMemory(visitorId, message, answer);
      return { success: true, answer, modeKey: currentMode, modesUsed, rootId };
    }
  }

  // ────────────────────────────────────────────────────────
  // FAST PATH: Position hold. If the current node is an extension node,
  // route directly. No tree summary, no routing index scan, no classification.
  // This is the common case for follow-up messages in a conversation.
  // ────────────────────────────────────────────────────────

  const currentNodeId = getCurrentNodeId(visitorId) || rootId;
  let classification;
  let treeSummary = null;
  let classifyStart = new Date();
  let departed = false;

  // Check if current position has a mode override (extension node)
  {
    const posNode = await Node.findById(currentNodeId).select("metadata").lean();
    const posModes = posNode?.metadata instanceof Map
      ? posNode.metadata.get("modes")
      : posNode?.metadata?.modes;
    if (posModes?.respond) {
      // Check for departure: does the message match a DIFFERENT extension's hints
      // but NOT the current extension's hints? If so, skip position hold.
      let isDeparture = false;
      try {
        const { getClassifierHintsForMode } = await import("../loader.js");
        const { getModeOwner } = await import("../../seed/tree/extensionScope.js");
        const currentExt = getModeOwner(posModes.respond);
        const currentHints = getClassifierHintsForMode(posModes.respond);
        const matchesCurrent = currentHints?.some(re => re.test(message));

        // Only check departure if the message doesn't match current extension
        if (!matchesCurrent && rootId) {
          const { queryAllMatches } = await import("./routingIndex.js");
          const otherMatches = queryAllMatches(rootId, message, null)
            .filter(m => m.extName !== currentExt);
          if (otherMatches.length > 0) {
            isDeparture = true;
            departed = true;
            log.verbose("Tree Orchestrator",
              `🎯 Departure from ${currentExt}: message matches ${otherMatches.map(m => m.extName).join(", ")}`);
          }
        }
      } catch (err) {
        log.debug("Tree Orchestrator", `Departure check error: ${err.message}`);
      }

      if (!isDeparture) {
        // Stay at this extension node. No suffix routing here.
        // The extension routing path (below) handles suffix resolution once.
        classification = {
          intent: "extension",
          mode: posModes.respond,
          targetNodeId: String(currentNodeId),
          confidence: 0.95,
          summary: message.slice(0, 100),
          responseHint: "",
        };
        const holdExt = typeof getModeOwner === "function" ? getModeOwner(classification.mode) : "?";
        log.verbose("Grammar", `🎯 noun=${holdExt || "?"} source=position-hold conf=0.95`);
      }
    }
  }

  // ────────────────────────────────────────────────────────
  // STEP 1: CLASSIFY (only if position hold didn't match)
  // ────────────────────────────────────────────────────────

  if (!classification) {
    emitStatus(socket, "intent", "Understanding request…");

    const classificationMode = getLandConfigValue("classificationMode") || "local";

    // Only build tree summary for LLM classification (local classification doesn't use it)
    if (classificationMode === "llm" && rootId) {
      try {
        let encodingMap = null;
        try {
          const { getExtension } = await import("../loader.js");
          const uExt = getExtension("understanding");
          if (uExt?.exports?.getEncodingMap) encodingMap = await uExt.exports.getEncodingMap(rootId);
        } catch {}
        treeSummary = await buildDeepTreeSummary(rootId, { encodingMap });

        const brief = await getIntelligenceBrief(rootId, userId);
        if (brief) treeSummary += "\n\n" + brief;

        log.verbose("Tree Orchestrator", " treeSummary for librarian:\n", treeSummary);
      } catch (err) {
        log.error("Tree Orchestrator", " Pre-fetch tree summary failed:", err.message);
      }
    }

    if (classificationMode === "llm") {
      // Opt-in LLM classification (old behavior)
      try {
        classification = await classify({
          message,
          userId,
          conversationMemory: formatMemoryContext(visitorId),
          treeSummary,
          signal,
          slot,
          rootId,
        });
      } catch (err) {
        if (signal?.aborted) return null;
        if (err.message === "NO_LLM") {
          throw new Error(
            "No LLM connection configured. Set one up at /setup or assign one to this tree.",
          );
        }
        log.error("Tree Orchestrator", " Classification failed:", err.message);
        classification = await localClassify(message, departed ? rootId : (getCurrentNodeId(visitorId) || rootId), rootId);
      }
    } else {
      // Default: local classification. Zero LLM calls.
      classification = await localClassify(message, departed ? rootId : (getCurrentNodeId(visitorId) || rootId), rootId);
    }
  }
  const classifyEnd = new Date();

  if (signal?.aborted) return null;

  const confidence = classification.confidence ?? 0.5;

 log.verbose("Tree Orchestrator", 
    `🎯 noun=${classification.intent} source=classify conf=${confidence}`,
  );
  emitModeResult(socket, "intent", {
    intent: classification.intent,
    responseHint: classification.responseHint,
    summary: classification.summary,
    confidence,
  });

  // Track classification step (after override so logs reflect actual intent used)
  modesUsed.push("classifier");
  rt.trackStep("classifier", {
    input: message,
    output: (({ llmProvider: _, ...rest }) => rest)(classification),
    startTime: classifyStart,
    endTime: classifyEnd,
    llmProvider: classification.llmProvider || llmProvider,
  });

  // ────────────────────────────────────────────────────────
  // NO_FIT CHECK — tree rejects this idea
  // ────────────────────────────────────────────────────────

  if (classification.intent === "no_fit") {
    let reason = classification.summary || "Idea does not fit this tree.";

    // Suggest go if the message might match an extension in another tree
    try {
      const { getExtension } = await import("../loader.js");
      const goExt = getExtension("go");
      if (goExt?.exports?.findDestination) {
        const goResult = await goExt.exports.findDestination(message, userId);
        if (goResult?.found && !goResult.ambiguous && goResult.destination) {
          reason += ` Try: go ${goResult.destination.name || goResult.destination.path}`;
        }
      }
    } catch {}

    log.verbose("Tree Orchestrator", ` No fit: ${reason}`);

    emitStatus(socket, "done", "");

    return {
      success: false,
      noFit: true,
      confidence,
      reason,
      summary: classification.summary,
      modeKey: "classifier",
      rootId,
      modesUsed,
    };
  }

  // ────────────────────────────────────────────────────────
  // SHORT-MEMORY CHECK — explicit defer or vague placements
  // ────────────────────────────────────────────────────────

  // Only explicit "defer" intent triggers deferral (user said "hold this"/"park this").
  // Normal "place" intents always flow to the librarian.
  let deferDecision = { defer: false };
  if (classification.intent === "defer") {
    deferDecision = { defer: true, reason: "User explicitly requested deferral" };
    classification.intent = "place"; // treat as place for the defer path
  }
  if (deferDecision.defer) {
 log.verbose("Tree Orchestrator", ` Deferred to short memory: ${deferDecision.reason}`);

    const ShortMemory = mongoose.models.ShortMemory;
    if (!ShortMemory) throw new Error("Dreams extension required for short memory deferral");
    const memoryItem = await ShortMemory.create({
      rootId,
      userId,
      content: message,
      deferReason: deferDecision.reason,
      classificationAxes: classification.placementAxes,
      sourceType: sourceType || "tree-chat",
      sourceId: sourceId || null,
      sessionId,
    });

    rt.trackStep("short-memory:defer", {
      input: message,
      output: {
        deferReason: deferDecision.reason,
        memoryItemId: memoryItem._id,
      },
      llmProvider,
    });

    if (!skipRespond) {
      const response = await runRespond({
        visitorId,
        socket,
        signal,
        username,
        userId,
        rootId,
        originalMessage: message,
        responseHint:
          classification.responseHint ||
          "Acknowledge the idea naturally. Do not mention deferral, memory, or holding.",
        stepSummaries: [],
        slot,
      });

      return {
        ...response,
        success: true,
        deferred: true,
        memoryItemId: memoryItem._id,
        modeKey: "short-memory:defer",
        modesUsed: [...modesUsed, "short-memory"],
      };
    }

    return {
      success: true,
      deferred: true,
      memoryItemId: memoryItem._id,
      modeKey: "short-memory:defer",
      modesUsed,
      rootId,
    };
  }

  // ────────────────────────────────────────────────────────
  // BEHAVIORAL CONSTRAINT (chat/place/query)
  // ────────────────────────────────────────────────────────

  const behavioral = extractBehavioral(sourceType);

  // ────────────────────────────────────────────────────────
  // BE: GUIDED MODE — the tree leads, the user follows
  // Skip classification. Find the guided mode at this position.
  // ────────────────────────────────────────────────────────

  if (behavioral === "be") {
    // Tier 1: Current node has an extension. Delegate to its handleMessage or coach mode.
    let beHandled = false;
    try {
      const { getLoadedExtensionNames, getExtension } = await import("../loader.js");
      const { getModesOwnedBy } = await import("../../seed/tree/extensionScope.js");
      const nodeDoc = currentNodeId ? await Node.findById(currentNodeId).select("metadata").lean() : null;
      if (nodeDoc) {
        const meta = nodeDoc.metadata instanceof Map ? Object.fromEntries(nodeDoc.metadata) : (nodeDoc.metadata || {});
        for (const extName of getLoadedExtensionNames()) {
          if (meta[extName]?.role || meta[extName]?.initialized) {
            const ext = getExtension(extName);
            if (ext?.exports?.handleMessage) {
              log.verbose("Tree Orchestrator", `  BE mode: delegating to ${extName}.handleMessage`);
              emitStatus(socket, "intent", "");
              const decision = await ext.exports.handleMessage("be", {
                userId, username, rootId, targetNodeId: String(currentNodeId),
              });
              const resolvedMode = decision?.mode || `tree:${extName}-coach`;
              modesUsed.push(resolvedMode);

              if (decision?.answer) {
                emitStatus(socket, "done", "");
                pushMemory(visitorId, message, decision.answer);
                return { success: true, answer: decision.answer, modeKey: resolvedMode, modesUsed, rootId, targetNodeId: String(currentNodeId) };
              }

              await switchMode(visitorId, resolvedMode, { username, userId, rootId, currentNodeId: String(currentNodeId), conversationMemory: formatMemoryContext(visitorId), clearHistory: decision?.setup || false });
              const result = await processMessage(visitorId, decision?.message || message, { username, userId, rootId, signal, slot, onToolLoopCheckpoint, onToolResults(results) { if (signal?.aborted) return; for (const r of results) socket.emit(WS.TOOL_RESULT, r); } });
              emitStatus(socket, "done", "");
              const answer = result?.content || result?.answer || null;
              if (answer) pushMemory(visitorId, message, answer);
              return { success: true, answer, modeKey: resolvedMode, modesUsed, rootId, targetNodeId: String(currentNodeId) };
            }
            const extModes = getModesOwnedBy(extName);
            const coachMode = extModes.find(m => m.endsWith("-coach")) || null;
            if (coachMode) {
              log.verbose("Tree Orchestrator", `  BE mode: switching to ${coachMode}`);
              await switchMode(visitorId, coachMode, { username, userId, rootId, conversationMemory: formatMemoryContext(visitorId), clearHistory: true });
              const result = await processMessage(visitorId, message, { username, userId, rootId, signal, socket, sessionId });
              modesUsed.push(coachMode);
              return { success: true, answer: result?.content || "", modeKey: coachMode, modesUsed, rootId };
            }
            break;
          }
        }
      }
    } catch (err) {
      log.debug("Tree Orchestrator", `BE Tier 1 failed: ${err.message}`);
    }

    // Tier 2: Not at an extension node. Find closest extension via routing index.
    // If the message matches an extension's hints, route there. Otherwise pick the first.
    if (!beHandled && rootId) {
      try {
        const { getExtension } = await import("../loader.js");
        const { getModesOwnedBy } = await import("../../seed/tree/extensionScope.js");
        const { queryAllMatches, getIndexForRoot } = await import("./routingIndex.js");
        const index = getIndexForRoot(rootId);
        if (index && index.size > 0) {
          // Check if the message matches any extension's hints
          const hintMatches = queryAllMatches(rootId, message, null);
          // Use hint match if found, otherwise fall through to first extension
          const entries = hintMatches.length > 0
            ? hintMatches.map(m => [m.extName, index.get(m.extName)]).filter(([, e]) => e)
            : [...index.entries()];

          for (const [extName, entry] of entries) {
            const ext = getExtension(extName);
            if (!ext?.exports?.handleMessage) continue;
            const extModes = getModesOwnedBy(extName);
            if (!extModes.some(m => m.endsWith("-coach"))) continue;

            const targetId = entry.nodeId || entry.nodes?.[0]?.nodeId;
            log.verbose("Tree Orchestrator", `  BE mode: routing to closest extension ${extName} at ${targetId}`);
            setCurrentNodeId(visitorId, targetId);
            emitStatus(socket, "intent", "");
            try {
              const decision = await ext.exports.handleMessage("be", {
                userId, username, rootId, targetNodeId: targetId,
              });
              const resolvedMode = decision?.mode || `tree:${extName}-coach`;
              modesUsed.push(resolvedMode);

              if (decision?.answer) {
                emitStatus(socket, "done", "");
                pushMemory(visitorId, message, decision.answer);
                return { success: true, answer: decision.answer, modeKey: resolvedMode, modesUsed, rootId, targetNodeId: targetId };
              }

              await switchMode(visitorId, resolvedMode, { username, userId, rootId, currentNodeId: targetId, conversationMemory: formatMemoryContext(visitorId), clearHistory: decision?.setup || false });
              const result = await processMessage(visitorId, decision?.message || message, { username, userId, rootId, signal, slot, onToolLoopCheckpoint, onToolResults(results) { if (signal?.aborted) return; for (const r of results) socket.emit(WS.TOOL_RESULT, r); } });
              emitStatus(socket, "done", "");
              const answer = result?.content || result?.answer || null;
              if (answer) pushMemory(visitorId, message, answer);
              return { success: true, answer, modeKey: resolvedMode, modesUsed, rootId, targetNodeId: targetId };
            } catch (err) {
              log.error("Tree Orchestrator", `BE routing failed for ${extName}: ${err.message}`);
            }
          }
        }
      } catch {}
    }

    // Tier 3: No extensions found. Generic tree:be.
    log.verbose("Tree Orchestrator", `  BE mode: switching to tree:be`);
    await switchMode(visitorId, "tree:be", { username, userId, rootId, conversationMemory: formatMemoryContext(visitorId), clearHistory: true });
    const result = await processMessage(visitorId, message, { username, userId, rootId, signal, socket, sessionId });
    modesUsed.push("tree:be");
    return { success: true, answer: result?.content || "", modeKey: "tree:be", modesUsed, rootId };
  }

  // ────────────────────────────────────────────────────────
  // PATH 2: EXTENSION DETECTED — hand off to the extension
  //
  // Three tiers:
  // 1. handleMessage override: extension exports a full handler. It decides everything.
  // 2. Suffix convention: orchestrator resolves mode by naming convention.
  //    :coach (be), :review (questions), :plan (building), :log (default).
  // 3. modes.respond fallback: whatever the node declared.
  // ────────────────────────────────────────────────────────

  if (classification.intent === "extension" && classification.mode) {
    const { getModeOwner } = await import("../../seed/tree/extensionScope.js");
    const { getExtension, getExtensionManifest } = await import("../loader.js");

    // ── Chain check: does the message match 2+ extensions? ──
    try {
      const primaryExt = getModeOwner(classification.mode);
      const { queryAllMatches } = await import("./routingIndex.js");
      const allTreeMatches = queryAllMatches(rootId, message, null);
      const seenExts = new Set([primaryExt]);
      const otherMatches = [];

      let primaryPos = 0;
      const primaryManifest = getExtensionManifest(primaryExt);
      if (Array.isArray(primaryManifest?.classifierHints)) {
        for (const re of primaryManifest.classifierHints) {
          const m = re.exec(message);
          if (m) { primaryPos = m.index; break; }
        }
      }

      for (const match of allTreeMatches) {
        if (seenExts.has(match.extName)) continue;
        seenExts.add(match.extName);
        const manifest = getExtensionManifest(match.extName);
        let matchPos = -1;
        if (Array.isArray(manifest?.classifierHints)) {
          for (const re of manifest.classifierHints) {
            const m = re.exec(message);
            if (m) { matchPos = matchPos === -1 ? m.index : Math.min(matchPos, m.index); }
          }
        }
        if (matchPos === -1) matchPos = message.length;
        otherMatches.push({ mode: match.mode, targetNodeId: match.targetNodeId, extName: match.extName, pos: matchPos });
      }

      log.verbose("Tree Orchestrator", `  Chain: ${otherMatches.length} other matches: ${otherMatches.map(m => m.extName).join(", ") || "none"}`);

      if (otherMatches.length > 0) {
        const allMatches = [
          { mode: classification.mode, targetNodeId: classification.targetNodeId || currentNodeId, extName: primaryExt, pos: primaryPos },
          ...otherMatches,
        ].sort((a, b) => a.pos - b.pos);

        // ── Causality check: is this cause → effect, not sequential chain? ──
        const causal = detectCausality(message, allMatches);
        if (causal) {
          // Route to the EFFECT domain's coach mode with cause context injected.
          const effectMatch = allMatches.find(m => m.extName === causal.effect);
          if (effectMatch) {
            logParseTree(message, {
              noun: `${causal.cause}->${causal.effect}`, nounSource: "causal", nounConf: 0.85,
              tense: "future", tensePattern: "coach-causal", tenseConf: 0.9,
              resolvedMode: null, // set below
              adjectives: parseAdjectives(message), voice: "passive",
              conditional: parseConditional(message),
            });
            log.info("Grammar", `📖 CAUSAL: ${causal.cause} -[${causal.connector}]-> ${causal.effect}`);

            // Prefer coach mode for causal reasoning (reflective, not logging)
            const effectMode = await (async () => {
              const { getModesOwnedBy: gmo } = await import("../../seed/tree/extensionScope.js");
              const modes = gmo(causal.effect);
              return modes.find(m => m.endsWith("-coach")) || modes.find(m => m.endsWith("-review")) || effectMatch.mode;
            })();

            return runModeAndReturn(visitorId, effectMode, message, {
              socket, username, userId, rootId, signal, slot,
              currentNodeId: effectMatch.targetNodeId,
              onToolLoopCheckpoint, modesUsed,
              targetNodeId: effectMatch.targetNodeId,
              adjectives: [{
                type: "causal",
                qualifier: `${causal.cause} ${causal.connector}`,
                subject: causal.effect,
              }],
              voice: "passive",
            });
          }
        }

        // Not causal: run as sequential chain
        log.verbose("Tree Orchestrator", `  Chain detected: ${allMatches.map(m => m.extName).join(" -> ")}`);
        return runChain(allMatches, message, visitorId, { socket, username, userId, rootId, signal, slot, onToolLoopCheckpoint, modesUsed });
      }
    } catch (err) {
      log.debug("Tree Orchestrator", `Chain check failed: ${err.message}`);
    }

    const extName = getModeOwner(classification.mode);
    const ext = extName ? getExtension(extName) : null;

    log.verbose("Tree Orchestrator",
      `  Verb: ${extName || "?"} (mode: ${classification.mode}, behavioral: ${behavioral})`);

    // ── Data handler: extension pre-processing ──
    // Extensions can return:
    //   { answer }       - short-circuit, send this answer directly
    //   { mode }         - force a specific mode, skip suffix routing
    //   { answer, mode } - short-circuit with mode tagging
    //   null/undefined   - proceed to normal suffix routing
    let forcedMode = null;
    if (ext?.exports?.handleMessage) {
      if (classification.targetNodeId) setCurrentNodeId(visitorId, classification.targetNodeId);
      try {
        const decision = await ext.exports.handleMessage(message, {
          userId, username, rootId, targetNodeId: classification.targetNodeId,
        });
        if (decision?.answer) {
          emitStatus(socket, "done", "");
          pushMemory(visitorId, message, decision.answer);
          modesUsed.push(decision.mode || classification.mode);
          return { success: true, answer: decision.answer, modeKey: decision.mode || classification.mode, modesUsed, rootId, targetNodeId: classification.targetNodeId };
        }
        if (decision?.mode) {
          forcedMode = decision.mode;
          log.verbose("Tree Orchestrator", `  handleMessage forced mode: ${forcedMode}`);
        }
      } catch (err) {
        log.error("Tree Orchestrator", `Extension handleMessage failed: ${err.message}`);
      }
    }

    // ── Step 1a: Parse pronouns (resolve "it", "that", "same") ──
    const pronounInfo = parsePronouns(message, visitorId);
    if (pronounInfo?.resolvedNode && !classification.targetNodeId) {
      classification.targetNodeId = pronounInfo.resolvedNode;
      setCurrentNodeId(visitorId, pronounInfo.resolvedNode);
    }

    // ── Step 1c: Parse quantifiers (scope from one node to a set) ──
    const quantifiers = parseQuantifier(message);

    // ── Step 1d: Parse conditionals (if/when/unless branching logic) ──
    const conditional = parseConditional(message);

    // ── Step 1b: Parse preposition (where in the tree?) ──
    let prepInfo = null;
    try {
      prepInfo = await parsePreposition(message, rootId);
      if (prepInfo?.targetOverride) {
        classification.targetNodeId = prepInfo.targetOverride;
        setCurrentNodeId(visitorId, prepInfo.targetOverride);
      }
    } catch {}

    // ── Step 2: Parse tense (which conjugation of this verb?) ──
    let resolvedMode;
    let tenseInfo = { tense: "present", pattern: "forced" };
    if (forcedMode) {
      resolvedMode = forcedMode;
      tenseInfo.pattern = "forced-by-handler";
    } else {
      tenseInfo = await parseTense(classification.mode, message, behavioral);
      resolvedMode = tenseInfo.mode;
    }
    const noun = getModeOwner(classification.mode) || "converse";

    // ── Step 2b: Semantic confidence check ──
    // Composite confidence from noun + tense. If low, escalate to LLM classifier.
    // Grammar = fast deterministic layer. LLM = fallback disambiguation.
    const CONFIDENCE_THRESHOLD = 0.65;
    const nounConf = classification.confidence || 0.5;
    const tenseConf = tenseInfo.pattern === "default" ? 0.6 : // fell to log by default
                      tenseInfo.pattern === "error" ? 0.3 :
                      tenseInfo.pattern === "single-mode" ? 0.7 :
                      tenseInfo.pattern === "none" ? 0.4 :
                      0.9; // explicit pattern match
    const compositeConf = (nounConf * 0.6) + (tenseConf * 0.4);

    if (compositeConf < CONFIDENCE_THRESHOLD && !forcedMode && rootId) {
      try {
        const { classify } = await import("./translator.js");
        const { buildDeepTreeSummary } = await import("../../seed/tree/treeFetch.js");
        const treeSummary = await buildDeepTreeSummary(rootId);
        const llmResult = await classify({
          message, userId,
          conversationMemory: formatMemoryContext(visitorId),
          treeSummary, signal, slot, rootId,
        });
        if (llmResult && llmResult.mode && llmResult.confidence > compositeConf) {
          log.info("Grammar", `📖 LOW CONFIDENCE (${compositeConf.toFixed(2)}) -> LLM escalation -> noun=${llmResult.intent} mode=${llmResult.mode} conf=${llmResult.confidence}`);
          classification.intent = llmResult.intent;
          classification.mode = llmResult.mode;
          classification.confidence = llmResult.confidence;
          classification.targetNodeId = llmResult.targetNodeId || classification.targetNodeId;
          // Re-parse tense with the new mode
          tenseInfo = await parseTense(classification.mode, message, behavioral);
          resolvedMode = tenseInfo.mode;
        }
      } catch (err) {
        log.debug("Grammar", `LLM escalation failed: ${err.message}`);
      }
    }

    // ── Step 3: Parse adjectives + voice ──
    const adjectives = parseAdjectives(message);
    const voice = detectVoice(message);

    // ── Grammar debugger ──
    logParseTree(message, {
      noun, nounSource: classification.targetNodeId ? "position-hold" : "classification",
      nounConf, tense: tenseInfo.tense, tensePattern: tenseInfo.pattern, tenseConf,
      resolvedMode, negated: tenseInfo.tense === "negated",
      compound: tenseInfo.compound ? tenseInfo.compound.map(s => s.tense) : null,
      pronoun: pronounInfo?.pronoun || null, quantifiers,
      adjectives: adjectives.length > 0 ? adjectives : null,
      voice, preposition: prepInfo?.preposition || null,
      prepTarget: prepInfo?.raw || null, temporal: prepInfo?.temporal || null,
      conditional, forcedMode: forcedMode || null,
    });

    // ── Update pronoun state for next message ──
    updatePronounState(visitorId, {
      active: classification.targetNodeId || currentNodeId,
      lastNoun: noun,
      lastMode: resolvedMode,
      lastMessage: message.slice(0, 200),
    });

    // ── Compound dispatch: multi-tense chain ──
    if (tenseInfo.compound && tenseInfo.compound.length > 1) {
      return runChain(tenseInfo.compound, message, visitorId, {
        socket, username, userId, rootId, signal, slot, onToolLoopCheckpoint, modesUsed,
      });
    }

    // ── Single dispatch ──
    return runModeAndReturn(visitorId, resolvedMode, message, {
      socket, username, userId, rootId, signal, slot,
      currentNodeId: classification.targetNodeId || currentNodeId,
      readOnly: behavioral === "query",
      onToolLoopCheckpoint, modesUsed,
      targetNodeId: classification.targetNodeId,
      adjectives: adjectives.length > 0 ? adjectives : null,
      quantifiers,
      conditional,
      voice,
    });
  }


  // ────────────────────────────────────────────────────────
  // CONVERSE PATH — check routing index for implicit matches
  // ────────────────────────────────────────────────────────

  if (rootId && classification.intent === "converse") {
    try {
      const { queryAllMatches } = await import("./routingIndex.js");
      const indexMatches = queryAllMatches(rootId, message, null);

      log.verbose("Tree Orchestrator", `  Converse check: ${indexMatches.length} matches: ${indexMatches.map(m => m.extName).join(", ") || "none"}`);

      if (indexMatches.length === 1) {
        const single = indexMatches[0];
        const singleTense = await parseTense(single.mode, message, behavioral);
        const singleCond = parseConditional(message);
        logParseTree(message, {
          noun: single.extName, nounSource: "converse-implicit", nounConf: 0.75,
          tense: singleTense.tense, tensePattern: singleTense.pattern, tenseConf: 0.8,
          resolvedMode: singleTense.mode, adjectives: parseAdjectives(message),
          voice: detectVoice(message), conditional: singleCond,
        });
        return runModeAndReturn(visitorId, singleTense.mode, message, {
          socket, username, userId, rootId, signal, slot,
          currentNodeId: single.targetNodeId, clearHistory: true,
          onToolLoopCheckpoint, modesUsed, targetNodeId: single.targetNodeId,
          conditional: singleCond,
        });
      }

      if (indexMatches.length > 1) {
        log.verbose("Tree Orchestrator", `  Chain detected: ${indexMatches.map(m => m.extName).join(" -> ")}`);
        return runChain(indexMatches, message, visitorId, { socket, username, userId, rootId, signal, slot, onToolLoopCheckpoint, modesUsed });
      }
    } catch (err) {
      log.debug("Tree Orchestrator", `Converse check failed: ${err.message}`);
    }
  }

  // ────────────────────────────────────────────────────────
  // FALLBACK — tree:converse
  // Build tree capabilities from the routing index so converse
  // knows what extensions exist in this tree even when nothing matched.
  // ────────────────────────────────────────────────────────

  let treeCapabilities = null;
  if (rootId) {
    try {
      const { getIndexForRoot } = await import("./routingIndex.js");
      const { getExtensionManifest } = await import("../loader.js");
      const index = getIndexForRoot(rootId);
      if (index && index.size > 0) {
        const lines = [];
        for (const [extName, entry] of index) {
          const manifest = getExtensionManifest(extName);
          const territory = manifest?.territory || extName;
          lines.push(`  ${extName}: ${entry.path} (${territory})`);
        }
        treeCapabilities = lines.join("\n");
      }
    } catch {}
  }

  const fallbackCond = parseConditional(message);
  logParseTree(message, {
    noun: "converse", nounSource: "fallback", nounConf: 0.5,
    tense: "present", tensePattern: "default", tenseConf: 0.5,
    resolvedMode: "tree:converse",
    adjectives: parseAdjectives(message), voice: detectVoice(message),
    conditional: fallbackCond,
  });

  return runModeAndReturn(visitorId, "tree:converse", message, {
    socket, username, userId, rootId, signal, slot,
    currentNodeId, clearHistory: true,
    onToolLoopCheckpoint, modesUsed,
    treeCapabilities,
    conditional: fallbackCond,
  });
}
// ─────────────────────────────────────────────────────────────────────────
// RESPOND (final user-facing output)
// ─────────────────────────────────────────────────────────────────────────

async function runRespond({
  visitorId,
  socket,
  signal,
  username,
  userId,
  rootId,
  nodeContext,
  operationContext,
  confirmNeeded = false,
  originalMessage = null,
  responseHint = "",
  stepSummaries = [],
  librarianContext = null,
  slot,
}) {
  emitStatus(socket, "respond", "");

  // Include conversation memory so respond can reference prior exchanges
  const memCtx = formatMemoryContext(visitorId);

  // Build a combined context: memory + step summaries + operation details
  const summaryCtx = formatStepSummaries(stepSummaries);

  // Strip librarianContext to only the fields respond needs (skip plan array, nodeIds, etc.)
  let strippedLibCtx = null;
  if (librarianContext) {
    strippedLibCtx = {
      summary: librarianContext.summary || null,
      responseHint: librarianContext.responseHint || null,
      confidence: librarianContext.confidence ?? null,
    };
  }

  const respondMode = await resolveModeForNode("respond", getCurrentNodeId(visitorId) || rootId);
  await switchMode(visitorId, respondMode, {
    username,
    userId,
    rootId,
    nodeContext: nodeContext || null,
    operationContext: operationContext || null,
    conversationMemory: memCtx || null,
    stepSummaries: !operationContext ? summaryCtx || null : null,
    responseHint: responseHint || null,
    confirmNeeded,
    librarianContext: strippedLibCtx,
    clearHistory: true,
  });

  // Build trigger with responseHint for tone/content guidance
  let trigger;
  if (confirmNeeded) {
    trigger = "Present the pending operation and ask for confirmation.";
  } else if (librarianContext) {
    trigger = responseHint
      ? `Respond naturally based on what you know. Guidance: ${responseHint}`
      : "Respond naturally based on the context provided.";
  } else if (operationContext) {
    trigger = responseHint
      ? `Summarize what was done. Tone guidance: ${responseHint}`
      : "Summarize what was done.";
  } else {
    trigger = responseHint
      ? `Respond to the user. Guidance: ${responseHint}`
      : "Respond to the user based on the provided context.";
  }

  const response = await processMessage(visitorId, trigger, {
    username,
    userId,
    rootId,
    slot,
    signal,
    onToolResults(results) {
      if (signal?.aborted) return;
      for (const r of results) {
        socket.emit(WS.TOOL_RESULT, r);
      }
    },
  });

  emitStatus(socket, "done", "");

  // Save this exchange to memory for future turns
  if (originalMessage && response?.answer) {
    pushMemory(visitorId, originalMessage, response.answer);
  }

  return response;
}

// ─────────────────────────────────────────────────────────────────────────
// SHORT-MEMORY DECISION
// ─────────────────────────────────────────────────────────────────────────

/**
 * CURRENTLY UNUSED. No classifier (local or LLM) provides placementAxes.
 * The defer decision is handled inline: only explicit "defer" intent triggers
 * deferral. This function is preserved for a future classifier that returns
 * { placementAxes: { pathConfidence, domainNovelty, relationalComplexity } }.
 * Until then, it always returns { defer: false } and should not be wired in.
 *
 * @returns {{ defer: boolean, reason?: string }}
 */
