// orchestrators/tree.js
// A compiler + runtime for executing structured intent across domain state systems.
// Extensions are state + tools + context. Modes are execution templates inside graph nodes.
// Natural language compiles into execution graphs. The runtime walks them.

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
async function localClassify(message, currentNodeId, rootId, userId = null) {
  const lower = message.toLowerCase().trim();
  const base = { summary: message.slice(0, 100), responseHint: "" };

  // ── Personal vocabulary (Layer 3) ──
  // Per-user vocabulary loaded from misroute extension's personalVocab module.
  // Cached in-process per user with a 5-minute TTL. Falls back to {} if the
  // misroute extension isn't loaded or the user has no personal vocab.
  let personalVocabAll = null;
  if (userId) {
    try {
      const { getExtension } = await import("../loader.js");
      const misroute = getExtension("misroute");
      if (misroute?.exports?.getPersonalVocabularyForUser) {
        personalVocabAll = await misroute.exports.getPersonalVocabularyForUser(userId);
      }
    } catch {}
  }

  // ── Routing index (fast path, scored with locality + personal vocab) ──
  // One Map scan. Scores every candidate extension by POS (nouns 3x, verbs 2x,
  // adjectives 1x) with a 4x locality bonus when the user is inside the
  // extension's subtree. Personal vocab patterns merge in at score time and
  // contribute to both the score and the locality multiplier. The highest
  // total score wins.
  if (rootId && currentNodeId) {
    try {
      const { queryIndexScored } = await import("./routingIndex.js");
      const currentPath = await _buildCurrentPath(currentNodeId);
      const scored = queryIndexScored(rootId, message, currentPath, personalVocabAll);
      if (scored?.winner) {
        return {
          intent: "extension",
          mode: scored.winner.mode,
          targetNodeId: scored.winner.targetNodeId,
          confidence: scored.winner.confidence,
          posMatches: scored.winner.matches,
          posScore: scored.winner.score,
          posLocality: scored.winner.locality,
          posAllScores: scored.all.map(s => ({ extName: s.extName, score: s.score, locality: s.locality })),
          ...base,
        };
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
import { setChatContext, startChainStep, finalizeChat } from "../../seed/llm/chatTracker.js";
import { getModesOwnedBy as _getModesOwnedBy } from "../../seed/tree/extensionScope.js";
import {
  parsePlan,
  setPendingPlan,
  getPendingPlan,
  clearPendingPlan,
  isAffirmative,
} from "./pendingPlan.js";
import { parseBranches, runBranchSwarm, validateBranches, parseContracts } from "./swarm.js";
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
// Five orthogonal axes decompose every message:
//
//   DOMAIN (what thing)         noun, pronoun, preposition
//   SCOPE (how much/when)       quantifiers, temporal scope
//   INTENT (what action)        tense, conditionals
//   INTERPRETATION (how)        adjectives, voice
//   EXECUTION (runtime shape)   dispatch, sequence, fork
//
// The pipeline:
//
// 1. Parse noun        — routing index identifies territory
// 1a Parse pronouns    — resolve "it", "that", "same" from state
// 1b Parse prepositions — "under recovery" shifts target node
// 1c Parse quantifiers — "all", "top 3", "this week" set scope
// 1d Parse conditionals — "if", "when", "unless" branching logic
// 1e Parse temporal    — "yesterday", "last week", "since January" data window
// 2. Parse tense       — review / coach / plan / log
// 2b Confidence check  — if grammar uncertain, escalate to LLM
// 3. Parse adjectives  — quality/focus ("high protein", "ready for")
// 3b Detect voice      — active (execute) vs passive (observe)
// 4. Build graph       — compile intent into dispatch / sequence / fork
// 5. Execute graph     — walk the graph, evaluate forks, run modes
//
// LLM is only used in two places:
//   1. Semantic evaluation (condition checking in forks)
//   2. Generation (the actual mode response)
//
// Everything else is deterministic compilation.
// ─────────────────────────────────────────────────────────────────────────

// Tense patterns. These conjugate the verb (extension) into the right mode.
// Past tense (review):           reflecting on what happened
// Future/subjunctive (coach):    guidance, questions, corrections, conversation
// Imperative (plan):             structural commands, building, modifying
// Negation (coach):              cancels the default action, routes to conversation
// Present tense (log):           recording facts, stating actions (default)

// Past tense (review): looking backwards at what happened.
// Questions about state, progress, history. "How is" / "show me" phrasings.
const TENSE_PAST = /\b(how am i|how did i|how have i|how is|how's|how are|how's my|hows my|show me|check my|check on|look at|looking|where am i|where are we|am i on track|on track|update me|catch me up|give me|tell me how|my progress|progress|status|review|daily|weekly|monthly|stats|streak|history|trend|trends|so far|pattern|patterns|doing|summary|recap|compare|average|averages|report|results|track record|overview|breakdown|analytics|performance)\b/i;

// Future tense (coach): asking for guidance, suggestions, opinions.
// Conditional/subjunctive phrasings. Questions that seek advice, not facts.
const TENSE_FUTURE = new RegExp([
  // Asking for guidance
  "what should i", "should i", "help me", "recommend", "recommendations?",
  "suggest", "suggestions?", "advice", "advise", "guide", "guidance",
  "what do i", "what can i", "tell me what", "tell me how to",
  "coach me", "what next", "whats next", "what'?s next", "next up", "ready for",
  "prepare", "warm up", "ideas?", "options?", "thoughts?", "opinion",
  "any tips", "any advice", "walk me through", "what would",
  // Corrections and clarifications
  "supposed to be", "should be", "actually is", "i meant", "correction",
  "wrong", "mistake", "fix that", "update that", "not right", "oops",
  // Conversational and exploratory
  "why", "explain", "tell me about", "what is", "what are", "how does",
  "how do i", "can you", "do you", "is it", "are there", "would it",
  "could i", "could we", "might i", "is this", "am i ready", "do i need",
  "when should", "where should", "how often", "how much should",
  // Greetings and small talk
  "^hi$", "^hey$", "^hello$", "^yo$", "^sup$", "^whats up$", "^what's up$",
].map(p => `(?:${p})`).join("|"), "i");

// Imperative tense (plan): commanding a structural change. Building, creating, modifying.
const TENSE_IMPERATIVE = /\b(plan|build|create|make|setup|set up|set\s+.*\b(?:goal|target|weight|value)|structure|organize|define|add|modify|remove|delete|restructure|program|taper|schedule|adjust|change|update|curriculum|configure|redesign|rebuild|swap|replace|rename|initialize|start tracking|stop tracking|enable|disable|turn on|turn off|fix|correct|revise|repair|edit)\b/i;

// Sentence-start imperative: when a message begins with a classic
// build/action verb, it's always imperative regardless of other matches.
// Catches "Make a tinder app..." / "Build me a server..." / "Write a
// function that..." which could otherwise be mis-classified as present
// indicative when the grammar pipeline is being cautious.
const SENTENCE_START_IMPERATIVE = /^\s*(please\s+)?(make|build|create|write|scaffold|generate|add|fix|edit|modify|refactor|delete|remove|rename|replace|update|install|setup|set\s+up|implement|design|ship|publish)\b/i;

// Negation: cancels the default action. "Don't do the thing."
// Includes undo intent, course corrections, explicit cancel words.
const NEGATION = /\b(don'?t|do not|not|no|skip|stop|cancel|ignore|forget it|forget that|never mind|nevermind|undo|take.*back|that'?s wrong|wasn'?t|isn'?t|aren'?t|won'?t|hold on|wait|scratch that|scrap that|disregard)\b/i;

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

    // Sentence-start imperative short-circuit: "Make a tinder app",
    // "Build me a server", "Write a function" — these are unambiguously
    // commands. Skip the full compound-match scoring and commit to plan.
    if (SENTENCE_START_IMPERATIVE.test(lower)) {
      const planMode = find("plan");
      if (planMode) {
        return { mode: planMode, tense: "imperative", pattern: "plan-anchored" };
      }
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

    // Default: present tense, route to log/tell. But first check if the message
    // actually contains domain content. If the user is at a food node but the
    // message has zero food classifier hints (no ingestion verbs, no food nouns),
    // it is meta conversation, not a log entry. Route to coach instead.
    const logMode = find("log", "tell");
    if (logMode) {
      try {
        const { getClassifierHintsForMode } = await import("../loader.js");
        const hints = getClassifierHintsForMode(logMode);
        if (hints && hints.length > 0) {
          const anyHintMatches = hints.some(re => re.test(message));
          if (!anyHintMatches) {
            // Message at this position but no domain content. Meta conversation.
            return { mode: find("coach") || logMode, tense: "present", pattern: "conversational" };
          }
        }
      } catch {}
      return { mode: logMode, tense: "present", pattern: "default" };
    }
    return { mode: baseMode, tense: "present", pattern: "default" };
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

// ─────────────────────────────────────────────────────────────────────────
// LAST ROUTING STATE (for misroute detection)
//
// Stores the most recent routing decision per visitor so that extensions
// like `misroute` can check whether the NEXT message from the same visitor
// is a correction of this one. Keyed by visitorId (same as pronoun state).
//
// Keeps a tiny ring of the last few decisions so a user correcting two
// messages back still has something to attach to.
// ─────────────────────────────────────────────────────────────────────────

const _lastRouting = new Map(); // visitorId -> [{ message, extName, mode, targetNodeId, currentNodeId, rootId, posMatches, posScore, posLocality, ts }, ...]
const LAST_ROUTING_RING = 3;

// Active request context per visitor. Set on entry to orchestrateTreeRequest,
// cleared on exit. Lets extensions like misroute look up the websocket and
// session info needed to fire a follow-up orchestration call on the same
// channel without going through the websocket layer themselves.
const _activeRequests = new Map(); // visitorId -> { socket, sessionId, signal, slot, rootChatId, username, userId, rootId }

function recordRoutingDecision(visitorId, decision) {
  if (!visitorId || !decision) return;
  const existing = _lastRouting.get(visitorId) || [];
  existing.unshift({ ...decision, ts: Date.now() });
  while (existing.length > LAST_ROUTING_RING) existing.pop();
  _lastRouting.set(visitorId, existing);
}

export function getLastRouting(visitorId) {
  const ring = _lastRouting.get(visitorId);
  return ring?.[0] || null;
}

export function getLastRoutingRing(visitorId) {
  return _lastRouting.get(visitorId) || [];
}

export function clearLastRouting(visitorId) {
  _lastRouting.delete(visitorId);
}

// Active request context lifecycle. Used by misroute extension to redispatch
// the original message at the correct mode after detecting a named correction.
//
// Stored with a timestamp. The getter only returns entries within the TTL,
// which avoids the need for a try/finally wrapper around the entire (very
// large) orchestrateTreeRequest function. Stale entries get overwritten by
// the next request from the same visitor or expire on read.
const ACTIVE_REQUEST_TTL_MS = 30 * 1000;

function setActiveRequest(visitorId, ctx) {
  if (!visitorId) return;
  _activeRequests.set(visitorId, { ...ctx, _ts: Date.now() });
}

export function getActiveRequest(visitorId) {
  if (!visitorId) return null;
  const entry = _activeRequests.get(visitorId);
  if (!entry) return null;
  if (Date.now() - entry._ts > ACTIVE_REQUEST_TTL_MS) {
    _activeRequests.delete(visitorId);
    return null;
  }
  return entry;
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
const CONDITIONAL_ELSE = /(?:,?\s*(?:otherwise|else|if not|or else)\s+)(.+)$/i;

/**
 * Parse conditionals: detect branching logic in natural language.
 * Returns { type, keyword, condition, action, elseAction } or null.
 *
 * type:
 *   "if"      — evaluate condition, then act
 *   "when"    — temporal trigger, act when condition is met
 *   "unless"  — act unless condition is true (negated if)
 *
 * action:      the "then" part (text after condition separator)
 * elseAction:  text after "otherwise"/"else" if present, or null
 */
function parseConditional(message) {
  const lower = message.toLowerCase().trim();

  // Build-imperative bailout. When the user says "build me a tinder app
  // that has X when Y", the "when Y" is describing app runtime behavior
  // — part of the spec, not a control-flow condition for the orchestrator.
  // We only want to treat conditionals as runtime forks when the matrix
  // verb is something like "log this when I finish" or "fix it if tests
  // pass" — not when the verb is "build/scaffold/create" and the rest
  // of the sentence is describing what to construct.
  //
  // Same rule used elsewhere in this file: if the sentence opens with
  // a build/scaffold imperative, the message is a SPEC, not a runtime
  // workflow. Skip conditional parsing entirely.
  if (SENTENCE_START_IMPERATIVE.test(lower)) {
    return null;
  }

  let match;
  let condEnd = 0;

  // Try each pattern in priority order
  let type, keyword, condition;
  if ((match = CONDITIONAL_IF.exec(lower))) {
    type = "if"; keyword = match[1]; condition = match[2].trim();
    condEnd = match.index + match[0].length;
  } else if ((match = CONDITIONAL_UNLESS.exec(lower))) {
    type = "unless"; keyword = match[1]; condition = match[2].trim();
    condEnd = match.index + match[0].length;
  } else if ((match = CONDITIONAL_WHEN.exec(lower))) {
    type = "when"; keyword = match[1]; condition = match[2].trim();
    condEnd = match.index + match[0].length;
  } else if ((match = CONDITIONAL_SHORT.exec(lower))) {
    const kw = match[1].toLowerCase();
    type = kw === "unless" ? "unless" : (kw === "when" || kw === "once" || kw === "after") ? "when" : "if";
    keyword = match[1]; condition = match[2].trim();
    return { type, keyword, condition, action: null, elseAction: null };
  }

  if (!type) return null;

  // Extract action and else clause from remainder
  const remainder = lower.slice(condEnd).trim();
  const elseMatch = CONDITIONAL_ELSE.exec(remainder);
  let action = remainder;
  let elseAction = null;
  if (elseMatch) {
    action = remainder.slice(0, elseMatch.index).trim();
    elseAction = elseMatch[1].trim();
  }

  return { type, keyword, condition, action: action || null, elseAction };
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

/**
 * Parse prepositions: extract spatial modifiers from the message.
 * Returns { targetOverride, preposition, raw } or null if none found.
 *
 * Spatial: "under recovery" -> resolves "recovery" to a node in the routing index
 * Temporal parsing moved to parseTemporalScope (Step 1d).
 */
async function parsePreposition(message, rootId) {
  const lower = message.toLowerCase();
  const result = { targetOverride: null, preposition: null, raw: null };
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

  return found ? result : null;
}

// ─────────────────────────────────────────────────────────────────────────
// TEMPORAL SCOPE PARSER (Step 1d)
//
// Time is not tense. Tense = intent (review, log, coach, plan).
// Time = data scope (which window of data the mode operates on).
//
// "How did I do last week" has tense=past (review mode) AND time=last week.
// "Log my meal yesterday" has tense=present (log mode) AND time=yesterday.
// "Compare January to February" has tense=past (review) AND time=range.
//
// Four categories:
//   relative:  "yesterday", "last week", "3 days ago", "recently"
//   absolute:  "January", "March 5", "2026-01-15", days of the week
//   duration:  "over 3 months", "the past 2 weeks", "for a year"
//   range:     "from Monday to Friday", "between January and March"
//
// The parsed scope is injected as [Time Scope] so the AI constrains
// its data queries to the specified window.
// ─────────────────────────────────────────────────────────────────────────

// Relative: "yesterday", "last week", "3 days ago", "recently", "lately"
const TEMPORAL_RELATIVE = /\b(yesterday|today|tonight|this morning|last night|recently|lately|just now)\b|\b(last|past|previous|this|next)\s+(week|month|day|year|session|workout|meal|quarter)\b|\b(\d+)\s+(days?|weeks?|months?|years?|hours?)\s+ago\b/i;

// Absolute: "January", "March 5", "Monday", "the 15th", ISO dates
const TEMPORAL_ABSOLUTE = /\b(january|february|march|april|may|june|july|august|september|october|november|december)\s*(\d{1,2})?\b|\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b|\b(\d{4}-\d{2}-\d{2})\b|\bthe\s+(\d{1,2})(st|nd|rd|th)\b/i;

// Duration: "over 3 months", "for the past 2 weeks", "in the last month"
const TEMPORAL_DURATION = /\b(?:over|for|during|in|within)\s+(?:the\s+)?(?:past|last|next)?\s*(\d+)?\s*(days?|weeks?|months?|years?|hours?)\b/i;

// Range: "from X to Y", "between X and Y", "X through Y"
const TEMPORAL_RANGE = /\b(?:from|between)\s+(.+?)\s+(?:to|and|through|until)\s+(.+?)(?:\s*$|\s*[,.])/i;

// "Since": open-ended start point
const TEMPORAL_SINCE = /\b(?:since|starting|beginning)\s+(.+?)(?:\s*$|\s*[,.])/i;

/**
 * Parse temporal scope: extract the data window from the message.
 * Returns { type, raw, ...details } or null.
 *
 * type:
 *   "relative"  — "yesterday", "last week", "3 days ago"
 *   "absolute"  — "January", "March 5", "Monday"
 *   "duration"  — "over 3 months", "the past 2 weeks"
 *   "range"     — "from Monday to Friday"
 *   "since"     — "since January", open-ended
 */
function parseTemporalScope(message) {
  const lower = message.toLowerCase().trim();
  let match;

  // Range first (most specific)
  if ((match = TEMPORAL_RANGE.exec(lower))) {
    return { type: "range", raw: match[0].trim(), from: match[1].trim(), to: match[2].trim() };
  }

  // Since (open-ended range)
  if ((match = TEMPORAL_SINCE.exec(lower))) {
    return { type: "since", raw: match[0].trim(), from: match[1].trim() };
  }

  // Duration
  if ((match = TEMPORAL_DURATION.exec(lower))) {
    return { type: "duration", raw: match[0].trim(), count: match[1] ? parseInt(match[1]) : 1, unit: match[2] };
  }

  // Relative (high frequency: "yesterday", "last week", "3 days ago")
  if ((match = TEMPORAL_RELATIVE.exec(lower))) {
    const raw = match[0].trim();
    if (match[4] && match[5]) {
      // "3 days ago" pattern
      return { type: "relative", raw, count: parseInt(match[4]), unit: match[5], direction: "ago" };
    }
    if (match[2] && match[3]) {
      // "last week" / "this month" pattern
      return { type: "relative", raw, direction: match[2], unit: match[3] };
    }
    // Simple: "yesterday", "today", "recently"
    return { type: "relative", raw };
  }

  // Absolute (named month, day of week, ISO date)
  if ((match = TEMPORAL_ABSOLUTE.exec(lower))) {
    return { type: "absolute", raw: match[0].trim() };
  }

  return null;
}

// ─────────────────────────────────────────────────────────────────────────
// LAYER 4: EXECUTION GRAPH
//
// Three primitives:
//   DISPATCH  - run one mode (wraps runModeAndReturn)
//   SEQUENCE  - run steps in order (wraps runChain)
//   FORK      - evaluate condition, pick path (three-valued: true/false/unknown)
//   FANOUT    - set expansion (reserved, not built)
//
// The grammar compiles intent into graph nodes.
// The runtime walks the graph and executes.

// -- Phase A: Evaluate condition (pure) --
// No knowledge of graph nodes, execution, or modes.
// Returns three-valued result with confidence.

const CONDITION_EVAL_PROMPT = `Evaluate a condition against data. Output ONLY this JSON, nothing else:
{"result":true,"confidence":0.9,"reasoning":"short sentence"}
or
{"result":false,"confidence":0.9,"reasoning":"short sentence"}
If data is missing, set confidence under 0.5. No thinking, no preamble, just JSON.`;

const CONDITION_CONFIDENCE_THRESHOLD = 0.7;

function serializeContextForEval(context) {
  const parts = [];
  if (context.name) parts.push(`Node: ${context.name}`);
  if (context.status) parts.push(`Status: ${context.status}`);

  // Extension-injected data (enrichContext results)
  for (const [key, val] of Object.entries(context)) {
    if (["id", "name", "status", "isRoot", "dateCreated", "type", "noteCount", "notes", "parent", "children", "siblings"].includes(key)) continue;
    if (val === null || val === undefined) continue;
    if (typeof val === "object") {
      try { parts.push(`${key}: ${JSON.stringify(val)}`); } catch {}
    } else {
      parts.push(`${key}: ${val}`);
    }
  }
  return parts.join("\n");
}

async function evaluateCondition(conditionText, { rootId, nodeId, userId, signal, slot }) {
  try {
    const { getContextForAi } = await import("../../seed/tree/treeFetch.js");
    const context = await getContextForAi(nodeId, { userId });
    const contextStr = serializeContextForEval(context);

    if (!contextStr || contextStr.length < 10) {
      return { result: "unknown", confidence: 0, reasoning: "no data available at this position" };
    }

    const { parseJsonSafe } = await import("../../seed/orchestrators/helpers.js");

    // Get LLM client (reuse existing resolution chain)
    const modeConnectionId = await resolveRootLlmForMode(rootId, "tree:librarian");
    const clientInfo = await getClientForUser(userId, slot, modeConnectionId);
    if (clientInfo.noLlm) {
      return { result: "unknown", confidence: 0, reasoning: "no LLM configured" };
    }

    const response = await clientInfo.client.chat.completions.create(
      {
        model: clientInfo.model,
        messages: [
          { role: "system", content: CONDITION_EVAL_PROMPT },
          { role: "user", content: `Data:\n${contextStr}\n\nCondition: "${conditionText}"\n\nOutput JSON now.` },
        ],
        max_tokens: 4000,
        response_format: { type: "json_object" },
      },
      signal ? { signal } : {},
    );

    const choice = response.choices?.[0];
    let raw = choice?.message?.content;

    // Reasoning model fallback: some models (qwen, deepseek-r1) put output in a
    // separate `reasoning` field if they didn't finish thinking. Try to extract JSON from there.
    if (!raw && choice?.message?.reasoning) {
      const reasoningText = choice.message.reasoning;
      const jsonMatch = reasoningText.match(/\{[^{}]*"result"[^{}]*\}/);
      if (jsonMatch) raw = jsonMatch[0];
    }

    if (!raw) {
      log.info("Grammar", `Condition eval empty. model=${clientInfo.model} finish_reason=${choice?.finish_reason} full_choice=${JSON.stringify(choice || {}).slice(0, 500)}`);
      return { result: "unknown", confidence: 0, reasoning: "empty LLM response" };
    }

    const parsed = parseJsonSafe(raw);
    if (!parsed || typeof parsed.result !== "boolean") {
      return { result: "unknown", confidence: 0, reasoning: "unparseable evaluation response" };
    }

    const confidence = Math.max(0, Math.min(1, parsed.confidence ?? 0.5));
    const reasoning = parsed.reasoning || "";

    // Three-valued: confidence below threshold -> unknown
    if (confidence < CONDITION_CONFIDENCE_THRESHOLD) {
      return { result: "unknown", confidence, reasoning: reasoning || "insufficient confidence" };
    }

    return { result: parsed.result ? "true" : "false", confidence, reasoning };
  } catch (err) {
    log.debug("Grammar", `Condition evaluation failed: ${err.message}`);
    return { result: "unknown", confidence: 0, reasoning: `evaluation error: ${err.message}` };
  }
}

// -- Phase B: Resolve fork (pure) --
// No side effects. Pure branch selection.

function resolveFork(forkNode, evaluation) {
  if (evaluation.result === "true") return forkNode.truePath;
  if (evaluation.result === "false") return forkNode.falsePath;
  return forkNode.unknownPath;
}

// -- Set resolver (for FANOUT) --
// Resolves quantifier + domain into concrete items with enriched context.
// Extensions can override with exports.resolveSet for precision.

const MAX_FANOUT_ITEMS = 20;

async function resolveSet({ extName, rootId, quantifier, temporalScope, nodeId, userId, message }) {
  try {
    // Check if extension provides a custom resolver.
    // The extension is the authority on what "all my X" means inside its domain.
    // We pass the message so the extension can inspect keywords and decide which
    // subtree, metadata bucket, or note collection represents the set.
    const { getExtension } = await import("../loader.js");
    const ext = extName ? getExtension(extName) : null;
    if (ext?.exports?.resolveSet) {
      const custom = await ext.exports.resolveSet({ quantifier, temporalScope, rootId, userId, message });
      if (custom?.length > 0) return custom.slice(0, MAX_FANOUT_ITEMS);
    }

    // Generic: get children of the extension's node in this tree
    const { getIndexForRoot } = await import("./routingIndex.js");
    const index = rootId ? getIndexForRoot(rootId) : null;
    const entry = extName && index ? index.get(extName) : null;
    const targetId = nodeId || entry?.nodeId;
    if (!targetId) return [];

    const Node = (await import("../../seed/models/node.js")).default;
    const parent = await Node.findById(targetId).select("children").lean();
    if (!parent?.children?.length) return [];

    const children = await Node.find({
      _id: { $in: parent.children },
      systemRole: null,
    }).select("_id name metadata").lean();

    if (children.length === 0) return [];

    // Enrich each child's context (runs enrichContext hooks, gets real data)
    const { getContextForAi } = await import("../../seed/tree/treeFetch.js");
    const items = [];
    for (const child of children.slice(0, MAX_FANOUT_ITEMS)) {
      try {
        const ctx = await getContextForAi(child._id, { userId });
        items.push({ nodeId: String(child._id), name: child.name, context: ctx });
      } catch {
        // Skip nodes that fail enrichment
        items.push({ nodeId: String(child._id), name: child.name, context: { name: child.name } });
      }
    }

    // Apply quantifier filter
    if (quantifier?.type === "numeric") {
      return items.slice(0, quantifier.count);
    }
    // universal, superlative, comparative: return all, let synthesis handle ranking
    return items;
  } catch (err) {
    log.debug("Grammar", `Set resolution failed: ${err.message}`);
    return [];
  }
}

// -- Graph builder (pure) --
// Takes parse results, returns graph node. No side effects, no LLM calls.

function makeDispatch(mode, extName, targetNodeId, modifiers = {}) {
  return {
    type: "dispatch",
    mode: mode || "tree:converse",
    extName: extName || null,
    targetNodeId: targetNodeId || null,
    tense: modifiers.tense || "present",
    modifiers: {
      adjectives: modifiers.adjectives || null,
      quantifiers: modifiers.quantifiers || null,
      temporalScope: modifiers.temporalScope || null,
      voice: modifiers.voice || "active",
      readOnly: modifiers.readOnly || false,
      treeCapabilities: modifiers.treeCapabilities || null,
    },
  };
}

function makeFanout(mode, extName, targetNodeId, modifiers = {}) {
  return {
    type: "fanout",
    mode: mode || "tree:converse",
    extName: extName || null,
    targetNodeId: targetNodeId || null,
    itemResolver: {
      extName: extName || null,
      quantifier: modifiers.quantifiers?.[0] || null,
      temporalScope: modifiers.temporalScope || null,
    },
    modifiers: {
      adjectives: modifiers.adjectives || null,
      temporalScope: modifiers.temporalScope || null,
      voice: modifiers.voice || "active",
      readOnly: true, // fanout is always read
      treeCapabilities: modifiers.treeCapabilities || null,
    },
  };
}

function buildExecutionGraph({
  resolvedMode, tenseInfo, conditional, adjectives, quantifiers,
  temporalScope, voice, causal, classification, behavioral, currentNodeId, rootId,
  extName,
}) {
  const mods = {
    adjectives: adjectives?.length > 0 ? adjectives : null,
    quantifiers,
    temporalScope,
    voice,
    readOnly: behavioral === "query",
  };

  // Priority 1: Conditional -> FORK
  if (conditional) {
    // The action dispatch: what happens when the condition is met (if/when) or not met (unless)
    const actionDispatch = makeDispatch(resolvedMode, extName, classification?.targetNodeId || currentNodeId, {
      ...mods, tense: tenseInfo?.tense || "present",
    });

    // The alternative dispatch: coach mode for graceful handling.
    // Resolve via the mode registry (getModesOwnedBy) instead of
    // string-concatenating `${extName}-coach`. Extension name and mode
    // prefix don't always match — code-workspace owns tree:code-coach,
    // not tree:code-workspace-coach. Asking the registry for the
    // extension's modes and finding the one that ends in -coach is the
    // correct lookup. Falls back to the action mode if no coach exists,
    // so a fork against an extension without a coach mode just runs
    // the same dispatch on both branches (degenerate but safe).
    let altMode = resolvedMode;
    if (extName) {
      try {
        const ownedModes = _getModesOwnedBy(extName) || [];
        const coachMode = ownedModes.find((m) => m.endsWith("-coach"));
        if (coachMode) altMode = coachMode;
      } catch {}
    }
    const altDispatch = makeDispatch(altMode || resolvedMode, extName, classification?.targetNodeId || currentNodeId, {
      ...mods, tense: "future",
    });

    // Unknown path: coach with "couldn't determine" context
    const unknownDispatch = makeDispatch(altMode || resolvedMode, extName, classification?.targetNodeId || currentNodeId, {
      ...mods, tense: "future",
      adjectives: [...(mods.adjectives || []), { type: "condition-unknown", qualifier: "data insufficient to evaluate condition", subject: conditional.condition }],
    });

    // For "unless": invert. truePath = don't act (condition IS true), falsePath = act.
    if (conditional.type === "unless") {
      return {
        type: "fork",
        condition: { text: conditional.condition, type: conditional.type, keyword: conditional.keyword },
        truePath: altDispatch,
        falsePath: actionDispatch,
        unknownPath: unknownDispatch,
        source: "conditional",
      };
    }

    // For "if"/"when": truePath = act, falsePath = don't act
    return {
      type: "fork",
      condition: { text: conditional.condition, type: conditional.type, keyword: conditional.keyword },
      truePath: actionDispatch,
      falsePath: altDispatch,
      unknownPath: unknownDispatch,
      source: "conditional",
    };
  }

  // Priority 2: Quantifier + analytical mode -> FANOUT
  // Quantifiers on review/coach modes mean "resolve the set, bundle context, synthesize."
  // Quantifiers on log/plan modes stay as annotation (you log ONE thing, not a set).
  // TEMPORAL quantifiers alone ("this week", "last month") are time windows, not set selectors.
  // FANOUT only fires when there's a non-temporal quantifier (universal, numeric, superlative, comparative).
  if (quantifiers?.length > 0 && extName) {
    const hasSetQuantifier = quantifiers.some(q => q.type !== "temporal");
    const analyticTenses = ["past", "future", "negated"];
    const isAnalytic = analyticTenses.includes(tenseInfo?.tense) || behavioral === "query";
    if (hasSetQuantifier && isAnalytic) {
      return makeFanout(resolvedMode, extName, classification?.targetNodeId || currentNodeId, mods);
    }
  }

  // Priority 3: Compound tense -> SEQUENCE
  if (tenseInfo?.compound && tenseInfo.compound.length > 1) {
    return {
      type: "sequence",
      steps: tenseInfo.compound.map(step => makeDispatch(step.mode, step.extName, step.targetNodeId, {
        ...mods, tense: step.tense,
      })),
      source: "compound",
    };
  }

  // Priority 3: Causal -> single dispatch to effect domain's coach
  if (causal) {
    return makeDispatch(causal.effectMode, causal.effect, causal.effectNodeId, {
      ...mods,
      adjectives: [...(mods.adjectives || []), {
        type: "causal",
        qualifier: `${causal.cause} ${causal.connector}`,
        subject: causal.effect,
      }],
      voice: "passive",
      tense: "future",
    });
  }

  // Priority 4: Single dispatch
  return makeDispatch(resolvedMode, extName, classification?.targetNodeId || currentNodeId, {
    ...mods, tense: tenseInfo?.tense || "present",
  });
}

// -- Graph executor (runtime) --
// Recursive walker. The only place with side effects.

async function executeGraph(node, message, visitorId, opts) {
  if (!node) return { success: false, answer: "No execution path resolved." };

  if (node.type === "dispatch") {
    return runModeAndReturn(visitorId, node.mode, message, {
      socket: opts.socket,
      username: opts.username,
      userId: opts.userId,
      rootId: opts.rootId,
      signal: opts.signal,
      slot: opts.slot,
      currentNodeId: node.targetNodeId || opts.currentNodeId,
      readOnly: node.modifiers.readOnly,
      clearHistory: opts.clearHistory || false,
      onToolLoopCheckpoint: opts.onToolLoopCheckpoint,
      modesUsed: opts.modesUsed,
      targetNodeId: node.targetNodeId,
      adjectives: node.modifiers.adjectives,
      quantifiers: node.modifiers.quantifiers,
      temporalScope: node.modifiers.temporalScope,
      voice: node.modifiers.voice,
      treeCapabilities: node.modifiers.treeCapabilities || null,
      reroutePrefix: opts.reroutePrefix || null,
      sessionId: opts.sessionId,
      rootChatId: opts.rootChatId,
    });
  }

  if (node.type === "sequence") {
    const chain = node.steps.map(s => ({
      mode: s.mode,
      extName: s.extName,
      targetNodeId: s.targetNodeId,
      tense: s.tense || "present",
    }));
    return runChain(chain, message, visitorId, {
      socket: opts.socket,
      username: opts.username,
      userId: opts.userId,
      rootId: opts.rootId,
      signal: opts.signal,
      slot: opts.slot,
      onToolLoopCheckpoint: opts.onToolLoopCheckpoint,
      modesUsed: opts.modesUsed,
    });
  }

  if (node.type === "fork") {
    emitStatus(opts.socket, "evaluating", node.condition.text);
    const evaluation = await evaluateCondition(node.condition.text, {
      rootId: opts.rootId,
      nodeId: opts.currentNodeId,
      userId: opts.userId,
      signal: opts.signal,
      slot: opts.slot,
    });
    const selected = resolveFork(node, evaluation);

    // Inject evaluation reasoning so the AI knows WHY this branch was taken
    if (selected.type === "dispatch" && evaluation.reasoning) {
      selected.modifiers.adjectives = [
        ...(selected.modifiers.adjectives || []),
        { type: "condition-result", qualifier: evaluation.reasoning, subject: node.condition.text },
      ];
    }

    log.info("Grammar", `FORK: "${node.condition.text}" -> ${evaluation.result} (conf=${evaluation.confidence.toFixed(2)}) -> ${selected.mode || selected.type} | ${evaluation.reasoning}`);
    return executeGraph(selected, message, visitorId, opts);
  }

  if (node.type === "fanout") {
    emitStatus(opts.socket, "resolving", "Gathering data...");

    // Phase 1: Resolve the set
    const items = await resolveSet({
      extName: node.itemResolver.extName,
      rootId: opts.rootId,
      quantifier: node.itemResolver.quantifier,
      temporalScope: node.itemResolver.temporalScope,
      nodeId: node.targetNodeId || opts.currentNodeId,
      userId: opts.userId,
      message,
    });

    if (items.length === 0) {
      log.info("Grammar", `FANOUT: ${node.extName} -> 0 items resolved, falling back to dispatch`);
      // No items found: fall back to normal dispatch with quantifier annotation
      return runModeAndReturn(visitorId, node.mode, message, {
        socket: opts.socket,
        username: opts.username,
        userId: opts.userId,
        rootId: opts.rootId,
        signal: opts.signal,
        slot: opts.slot,
        currentNodeId: node.targetNodeId || opts.currentNodeId,
        readOnly: true,
        clearHistory: opts.clearHistory || false,
        onToolLoopCheckpoint: opts.onToolLoopCheckpoint,
        modesUsed: opts.modesUsed,
        adjectives: node.modifiers.adjectives,
        voice: node.modifiers.voice,
        treeCapabilities: node.modifiers.treeCapabilities || null,
      });
    }

    // Phase 2: Bundle all item contexts into one prompt
    const itemLines = items.map((item, i) => {
      const ctx = item.context || {};
      // Serialize enriched context per item
      const dataLines = [];
      for (const [key, val] of Object.entries(ctx)) {
        if (["id", "isRoot", "dateCreated", "type", "noteCount", "parent", "siblings"].includes(key)) continue;
        if (val === null || val === undefined) continue;
        if (typeof val === "object") {
          try { dataLines.push(`  ${key}: ${JSON.stringify(val)}`); } catch {}
        } else {
          dataLines.push(`  ${key}: ${val}`);
        }
      }
      return `Item ${i + 1} - ${item.name}:\n${dataLines.join("\n")}`;
    });

    const fanoutBlock = `[Fanout: ${items.length} items resolved]\n${itemLines.join("\n\n")}\n\nThe user asked about ${items.length} items. Analyze each and synthesize a complete response.`;

    log.info("Grammar", `FANOUT: ${node.extName} -> ${items.length} items resolved -> ${node.mode}`);

    // Phase 3: Single dispatch with bundled context (synthesis)
    return runModeAndReturn(visitorId, node.mode, message, {
      socket: opts.socket,
      username: opts.username,
      userId: opts.userId,
      rootId: opts.rootId,
      signal: opts.signal,
      slot: opts.slot,
      currentNodeId: node.targetNodeId || opts.currentNodeId,
      readOnly: true,
      clearHistory: opts.clearHistory || false,
      onToolLoopCheckpoint: opts.onToolLoopCheckpoint,
      modesUsed: opts.modesUsed,
      targetNodeId: node.targetNodeId,
      adjectives: node.modifiers.adjectives,
      temporalScope: node.modifiers.temporalScope,
      voice: node.modifiers.voice,
      treeCapabilities: node.modifiers.treeCapabilities || null,
      fanoutContext: fanoutBlock,
    });
  }

  return { success: false, answer: "Unknown graph node type." };
}

function describeGraph(node) {
  if (!node) return "null";
  if (node.type === "dispatch") return `dispatch ${node.mode}`;
  if (node.type === "sequence") return `sequence ${node.steps.map(s => s.mode).join(" -> ")}`;
  if (node.type === "fork") return `fork(${node.condition.type} "${node.condition.text}") true=${describeGraph(node.truePath)} / false=${describeGraph(node.falsePath)} / unknown=${describeGraph(node.unknownPath)}`;
  if (node.type === "fanout") return `fanout ${node.extName} -> ${node.mode}`;
  return node.type;
}

// GRAMMAR DEBUGGER (standalone, called from every path)
// ─────────────────────────────────────────────────────────────────────────

function logParseTree(message, { noun, nounSource, nounConf, tense, tensePattern, tenseConf, resolvedMode, negated, compound, pronoun, quantifiers, adjectives, voice, preposition, prepTarget, temporal, conditional, forcedMode, graph, posMatches, posScore, posLocality, posAllScores }) {
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
  if (graph) debugLines.push(`   graph: ${describeGraph(graph)}`);

  // Per-POS routing matches: which words hit which extension's vocabulary,
  // including the locality bonus applied to the winner.
  if (posMatches && (posMatches.verbs.length > 0 || posMatches.nouns.length > 0 || posMatches.adjectives.length > 0)) {
    const parts = [];
    if (posMatches.nouns.length > 0) parts.push(`n:${posMatches.nouns.join(",")}`);
    if (posMatches.verbs.length > 0) parts.push(`v:${posMatches.verbs.join(",")}`);
    if (posMatches.adjectives.length > 0) parts.push(`a:${posMatches.adjectives.join(",")}`);
    const locTag = posLocality ? " LOCALITY" : "";
    debugLines.push(`   matched: score=${posScore || 0}${locTag} [${parts.join(" ")}]`);
  }
  if (posAllScores && posAllScores.length > 1) {
    const rivals = posAllScores.slice(1).map(s => `${s.extName}=${s.score}${s.locality ? "(loc)" : ""}`).join(" ");
    debugLines.push(`   rivals: ${rivals}`);
  }

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
// Expand a captured plan into a sequence of independent chat turns.
// Each item becomes its own Chat record (new chainIndex inside the same
// session) so the frontend renders them as sibling steps under the
// affirmative's root chat. Runs sequentially; any failure or abort stops
// the chain but leaves prior items written.
//
// Each item dispatches through code-plan at the current tree position.
// The mode's own tool cap + the runSteppedMode continuation loop already
// handle per-item work bounding.
async function runPendingPlan(pending, triggerMessage, visitorId, {
  socket, username, userId, signal, sessionId,
  rootId, rootChatId, slot, onToolLoopCheckpoint,
}) {
  emitStatus(socket, "intent", `Applying ${pending.items.length} planned fixes...`);

  const items = pending.items;
  // Always execute through code-plan — it's the imperative builder mode.
  // Plans can be captured by any mode (review, coach, ask), but applying
  // them means writing files, and code-plan is the one wired to do that.
  // Using the capture mode would run items through an audit-only prompt
  // that explicitly says "don't write", and the model would respect it.
  const mode = "tree:code-plan";
  const results = [];
  const appliedLines = [];

  // Ensure we're in the plan mode for the whole sequence. Cheap: switchMode
  // short-circuits when already in the target mode.
  await switchMode(visitorId, mode, {
    username, userId, rootId,
    currentNodeId: getCurrentNodeId(visitorId) || rootId,
    clearHistory: false,
  });

  for (let i = 0; i < items.length; i++) {
    if (signal?.aborted) {
      log.info("Tree Orchestrator", `⏹  Plan aborted after ${i}/${items.length}`);
      break;
    }

    const item = items[i];
    const itemMessage =
      `Apply plan item ${i + 1} of ${items.length}: ${item}\n\n` +
      `You previously produced this plan and the user confirmed it. ` +
      `Make the change now via workspace-edit-file or workspace-add-file. ` +
      `Report one short line when done. Do not ask for confirmation.`;

    emitStatus(socket, "intent", `Fix ${i + 1}/${items.length}: ${item.slice(0, 60)}`);

    // Dispatch the item. runSteppedMode creates its own chain steps via
    // rt.beginChainStep — including a first-call step whose input is
    // itemMessage. Each write-nudge retry and each continuation step
    // also gets its own chain step. No need to wrap with a parent item
    // header — the chain records speak for themselves.
    let itemResult;
    try {
      itemResult = await runSteppedMode(visitorId, mode, itemMessage, {
        username, userId, rootId, signal, slot,
        readOnly: false, onToolLoopCheckpoint, socket,
        parentChatId: rootChatId || null,
        dispatchOrigin: "plan-expand",
      });
    } catch (err) {
      log.error("Tree Orchestrator", `Plan item ${i + 1} failed: ${err.message}`);
      appliedLines.push(`${i + 1}. ❌ ${item} — ${err.message}`);
      continue;
    }

    results.push(itemResult);
    appliedLines.push(`${i + 1}. ✓ ${item}`);
  }

  // Restore context to the root chat record so the upstream finalize
  // (in runOrchestration) writes the final answer on the trigger chat.
  if (rootChatId && sessionId) {
    setChatContext(visitorId, sessionId, rootChatId);
  }

  const summary = appliedLines.length === items.length
    ? `Applied all ${items.length} planned fixes:\n${appliedLines.join("\n")}`
    : `Applied ${appliedLines.length}/${items.length} planned fixes:\n${appliedLines.join("\n")}`;

  emitStatus(socket, "done", "");
  if (summary) pushMemory(visitorId, triggerMessage, summary);

  return {
    success: true,
    answer: summary,
    modeKey: mode,
    modesUsed: [mode],
    rootId,
  };
}

// Run processMessage for a mode, but split the tool-call work across
// chainIndex steps. The first call reuses the rootChat created upstream.
// If processMessage signals _continue (the mode's maxToolCallsPerStep cap
// was hit), we open a fresh chainIndex step via startChainStep, swap the
// active chat context to it so new tool calls land on the new record,
// and re-enter processMessage with continuation: true. Finalize each
// sub-step's chat as we go, restore the root chat context at the end so
// the upstream orchestrator can still write the final answer to it.
async function runSteppedMode(visitorId, mode, message, {
  username, userId, rootId, signal, slot,
  readOnly, onToolLoopCheckpoint, socket,
  parentChatId = null, dispatchOrigin = null,
  sessionId: sessionIdParam = null,
  rootChatId: rootChatIdParam = null,
}) {
  const active = getActiveRequest(visitorId) || {};
  const sessionId = sessionIdParam || active.sessionId;
  const rootChatId = rootChatIdParam || active.rootChatId;
  const rt = active.rt; // shared OrchestratorRuntime with rt.chainIndex counter

  // Helper to begin a chain step (live chat context for tool calls) using
  // rt.beginChainStep. Falls back to a direct startChainStep + local counter
  // only if rt is somehow missing (non-orchestrator caller path).
  //
  // IMPORTANT: stamp the chat step's treeContext.targetNodeId with the
  // CURRENT node (which swarm dispatch moves to the branch node via
  // setCurrentNodeId), NOT with rootId. Prior behavior stamped every
  // branch's chat chain under the project root, making per-node chat
  // pages empty for every branch. This is the load-bearing fix that
  // makes per-node drill-in work.
  let fallbackChainIndex = 0;
  const beginStep = async (stepModeKey, stepInput) => {
    const currentNodeId = getCurrentNodeId(visitorId) || rootId;
    log.info("Tree Orchestrator",
      `📍 beginChainStep ${stepModeKey} targetNodeId=${currentNodeId?.slice?.(0, 8)} (rootId=${rootId?.slice?.(0, 8)}, dispatchOrigin=${dispatchOrigin || "continuation"}, parentChatId=${parentChatId ? parentChatId.slice(0, 8) : "null"}, rt=${rt && !rt._cleaned ? "live" : "fallback"})`,
    );
    if (rt && !rt._cleaned) {
      const step = await rt.beginChainStep(stepModeKey, stepInput, {
        treeContext: currentNodeId ? { targetNodeId: currentNodeId } : undefined,
        parentChatId: parentChatId || null,
        dispatchOrigin: dispatchOrigin || "continuation",
      });
      if (step?.chatId) {
        setChatContext(visitorId, sessionId, step.chatId);
      }
      return step;
    }
    // Fallback: rt is null or cleaned (common for branch dispatches
    // where the shared runtime has progressed past this branch).
    // Create the chat record directly so treeContext is stamped.
    try {
      const { startChainStep } = await import("../../seed/llm/chatTracker.js");
      if (!sessionId || !userId) {
        log.warn("Tree Orchestrator", `beginStep fallback: missing sessionId=${!!sessionId} userId=${!!userId}`);
      }
      const chat = await startChainStep({
        userId,
        sessionId,
        chainIndex: fallbackChainIndex++,
        rootChatId: rootChatId || null,
        modeKey: stepModeKey,
        source: "branch",
        input: stepInput,
        treeContext: currentNodeId ? { targetNodeId: currentNodeId } : undefined,
        parentChatId: parentChatId || null,
        dispatchOrigin: dispatchOrigin || "branch-swarm",
      });
      if (chat?._id) {
        log.info("Tree Orchestrator", `📍 fallback chat created: ${chat._id.slice(0, 8)} target=${currentNodeId?.slice(0, 8)}`);
        setChatContext(visitorId, sessionId, chat._id);
        return { chatId: chat._id, chainIndex: fallbackChainIndex - 1 };
      }
      log.warn("Tree Orchestrator", `beginStep fallback: startChainStep returned null`);
    } catch (err) {
      log.warn("Tree Orchestrator", `beginStep fallback failed: ${err.message}`);
    }
    return null;
  };

  const finishStep = async (step, outputText, stopped = false) => {
    if (!step?.chatId) return;
    if (rt && !rt._cleaned) {
      await rt.finishChainStep(step.chatId, {
        output: outputText,
        stopped,
        modeKey: mode,
      });
    } else {
      await finalizeChat({
        chatId: step.chatId,
        content: outputText,
        stopped,
        modeKey: mode,
      }).catch(() => {});
    }
  };

  // Modes that are expected to produce file writes. A turn that ends with
  // reads only is suspicious for these — the model is probably claiming
  // completion without actually doing the work. We'll force a retry below.
  const WRITE_EXPECTED_MODES = new Set([
    "tree:code-plan",
    "tree:code-log",
    "tree:code-coach",
  ]);
  const expectsWrites = WRITE_EXPECTED_MODES.has(mode);

  // Tool-call audit for this whole runSteppedMode invocation. We flag each
  // call as read-only or write via isToolReadOnly(). If a plan-mode turn
  // finishes with pureReadCount > 0 and writeCount === 0, we inject a
  // nudge and force one more step.
  let writeCount = 0;
  let readCount = 0;
  const { isToolReadOnly } = await import("../../seed/tree/extensionScope.js");

  const onToolResults = (results) => {
    if (signal?.aborted) return;
    for (const r of results) {
      socket.emit(WS.TOOL_RESULT, r);
      if (r?.tool) {
        if (isToolReadOnly(r.tool)) readCount++;
        else writeCount++;
      }
    }
  };

  const pmCtx = {
    username, userId, rootId, signal, slot,
    readOnly,
    onToolLoopCheckpoint,
    onToolResults,
    meta: { internal: false },
  };

  // Markers the model can emit to signal status to the orchestrator.
  // Stripped from visible text before it reaches the user AND before we
  // write the OUT to the chain step's chat record.
  //   [[NO-WRITE: reason]]  — this turn intentionally has no write, skip retry
  //   [[DONE]]              — the entire task is complete, stop continuing
  const NO_WRITE_RE = /\[\[\s*no[\s-]?write(?::\s*([^\]]*))?\s*\]\]/i;
  const DONE_RE = /\[\[\s*done\s*\]\]/i;
  const stripMarkers = (r) => {
    if (!r?.content) return { noWrite: null, done: false };
    let txt = r.content;
    let noWrite = null;
    const mNW = txt.match(NO_WRITE_RE);
    if (mNW) {
      noWrite = (mNW[1] || "no change needed").trim();
      txt = txt.replace(NO_WRITE_RE, "").trim();
    }
    const done = DONE_RE.test(txt);
    if (done) txt = txt.replace(DONE_RE, "").trim();
    if (txt !== r.content) {
      r.content = txt;
      r.answer = txt;
    }
    return { noWrite, done };
  };

  // ─── First call: always gets its own chain step ────────────────────
  // Even the very first runSteppedMode call (top-level message) opens a
  // fresh chain step so every LLM call is a distinct, visible substep.
  // chainIndex 0 stays reserved for the root (user's message + final
  // aggregated answer), set up upstream by runOrchestration.
  let firstStep = await beginStep(mode, message || "(empty)");
  let result;
  const allContent = []; // accumulate content across continuation turns
  try {
    result = await processMessage(visitorId, message, pmCtx);
    if (result?.content) allContent.push(result.content);
  } catch (err) {
    await finishStep(firstStep, `Error: ${err.message}`, true);
    if (rootChatId && sessionId) setChatContext(visitorId, sessionId, rootChatId);
    throw err;
  }

  let noWriteReason = null;
  {
    const { noWrite, done } = stripMarkers(result);
    if (noWrite) {
      noWriteReason = noWrite;
      log.info("Tree Orchestrator", `🟡 ${mode} declared no-write: ${noWrite}`);
    }
    if (done) {
      log.info("Tree Orchestrator", `✅ ${mode} declared done`);
      result._taskDone = true;
    }
  }

  // Finalize the first step with its real OUT
  await finishStep(
    firstStep,
    result?.content || result?.answer || "(no text)",
    signal?.aborted || false,
  );

  // No-write guardrail. If the mode was supposed to write files but the
  // turn ended with only reads AND no escape hatch was declared, the
  // model is claiming completion it didn't earn. Force one retry with a
  // nudge. After one retry it either writes, or declares no-write, or
  // we accept whatever it said (don't loop forever lying to the user).
  let noWriteRetries = 0;
  const MAX_NO_WRITE_RETRIES = 1;
  const needsWriteRetry = () =>
    expectsWrites
    && !readOnly
    && !result?._continue
    && !noWriteReason
    && readCount > 0
    && writeCount === 0
    && noWriteRetries < MAX_NO_WRITE_RETRIES;

  if (needsWriteRetry()) {
    noWriteRetries++;
    log.warn("Tree Orchestrator",
      `⚠️  ${mode} finished with ${readCount} reads, 0 writes. Injecting write nudge and retrying.`,
    );
    const nudge =
      `You read files but did not call workspace-add-file or workspace-edit-file. ` +
      `You must either (a) apply the change now via a write tool, or ` +
      `(b) explain why no write is needed and end your response with ` +
      `[[NO-WRITE: <one-line reason>]]. Do not respond with "Done" unless ` +
      `you actually wrote something in this turn.`;

    const retryStep = await beginStep(mode, nudge);
    try {
      result = await processMessage(visitorId, nudge, pmCtx);
    } catch (err) {
      await finishStep(retryStep, `Error: ${err.message}`, true);
      if (rootChatId && sessionId) setChatContext(visitorId, sessionId, rootChatId);
      throw err;
    }
    const afterRetry = stripMarkers(result);
    if (afterRetry.noWrite) {
      noWriteReason = afterRetry.noWrite;
      log.info("Tree Orchestrator", `🟡 ${mode} declared no-write on retry`);
    }
    if (afterRetry.done) result._taskDone = true;
    await finishStep(
      retryStep,
      result?.content || result?.answer || "(no text)",
      signal?.aborted || false,
    );
  }

  // Per-mode continuation budget. Plan mode ships with maxSteppedRuns=20
  // so it can run 20 short LLM calls back-to-back without hitting the
  // default 8-step cap. Modes that don't declare it keep the default.
  let maxSteps = 8;
  try {
    const { resolveMode } = await import("../../seed/modes/registry.js");
    const modeObj = resolveMode(mode);
    if (modeObj?.maxSteppedRuns && Number.isFinite(modeObj.maxSteppedRuns)) {
      maxSteps = Math.max(1, Math.min(Math.floor(modeObj.maxSteppedRuns), 40));
    }
  } catch {}

  // Continuation loop. Two triggers:
  //  (a) result._continue is true — the tool cap was hit mid-generation
  //      and we should re-enter with the same session to keep going.
  //  (b) result._taskDone is NOT set AND writes happened — the model
  //      stopped on its own but didn't explicitly declare done. Force
  //      another step and ask "anything else, or [[DONE]]?" so a lazy
  //      "package.json written, I'll do the rest later" becomes actual
  //      completion.
  //
  // Stops when: _taskDone is true, or signal is aborted, or maxSteps
  // cap is reached. chainIndex is tracked by rt.chainIndex (via
  // beginChainStep), not a local counter.
  let continuationCount = 0;
  let idleTurns = 0;
  let lastWriteCount = writeCount;
  const MAX_IDLE_TURNS = 4;
  const shouldContinue = () => {
    if (signal?.aborted) return false;
    if (result?._taskDone) return false;
    if (continuationCount >= maxSteps) return false;
    // Track idle turns (no writes) across BOTH _continue and
    // force-continue paths. Without this, _continue from read-only
    // tool calls burns unlimited turns.
    if (writeCount > lastWriteCount) {
      idleTurns = 0;
      lastWriteCount = writeCount;
    } else {
      idleTurns++;
    }
    if (idleTurns >= MAX_IDLE_TURNS && !result?._continue) return false;
    if (idleTurns >= MAX_IDLE_TURNS * 2) return false; // hard cap even for _continue
    if (result?._continue) return true;
    if (expectsWrites && writeCount > 0) return true;
    return false;
  };

  while (shouldContinue()) {
    continuationCount++;

    // Active cascade nudge check — between turns, see if any other
    // session wrote a signal targeting this session's subtree while
    // we were waiting on the last LLM call. If yes, log it so the
    // operator knows the feature fired; the actual "fresh banner"
    // injection happens naturally on the next enrichContext run.
    // Guard with try/catch so a nudge failure never breaks the loop.
    try {
      const { getExtension: _getExt } = await import("../loader.js");
      const cwExt = _getExt("code-workspace")?.exports;
      if (cwExt?.maybeApplyCascadeNudge) {
        await cwExt.maybeApplyCascadeNudge({ sessionId, visitorId });
      }
      // DEBUG_ENRICH_CONTEXT=1 dumps what the AI sees before each
      // processMessage call. One operator switch for deep inspection
      // without touching the prompt path.
      if (process.env.DEBUG_ENRICH_CONTEXT === "1" && cwExt?.dumpContextForSession) {
        try {
          const dump = await cwExt.dumpContextForSession(sessionId, core, { dryRun: true });
          log.debug(
            "Tree Orchestrator",
            `[DEBUG_ENRICH_CONTEXT] sid=${sessionId?.slice?.(0, 8)}\n${JSON.stringify(dump?.context || {}, null, 2).slice(0, 4000)}`,
          );
        } catch {}
      }
    } catch (nudgeErr) {
      log.warn(
        "Tree Orchestrator",
        `maybeApplyCascadeNudge failed: ${nudgeErr.message}`,
      );
    }

    // Pick the nudge based on which trigger fired:
    //   - tool cap hit:  empty message, just re-enter the loop
    //   - missing done:  explicit "what's next, or emit [[DONE]]" prompt
    const nudgeMessage = result?._continue
      ? "[continue]"
      : `Anything else to do for this task? ` +
        `If yes: call the next write tool now (one per turn). ` +
        `If no: end your response with [[DONE]] on its own line. ` +
        `Do not describe what you "will do next" — either do it, or emit [[DONE]].`;

    const useContinuation = result?._continue; // only true for empty-message re-entry
    const stepChat = await beginStep(mode, nudgeMessage);

    try {
      result = await processMessage(visitorId, result?._continue ? "" : nudgeMessage, {
        ...pmCtx,
        continuation: useContinuation,
      });
      if (result?.content) allContent.push(result.content);
    } catch (err) {
      await finishStep(stepChat, `Error: ${err.message}`, true);
      if (rootChatId && sessionId) setChatContext(visitorId, sessionId, rootChatId);
      throw err;
    }

    // Strip markers from continuation responses too
    const stripped = stripMarkers(result);
    if (stripped.done) result._taskDone = true;
    if (stripped.noWrite) result._taskDone = true; // no-write on a continuation = done

    await finishStep(
      stepChat,
      result?.content || result?.answer || "(no text)",
      signal?.aborted || false,
    );
  }

  // Restore context to the root chat so any subsequent writes (final answer,
  // contributions, upstream finalizeChat) target chainIndex 0.
  if (rootChatId && sessionId) {
    setChatContext(visitorId, sessionId, rootChatId);
  }

  // Attach accumulated content from all continuation turns so the
  // caller can detect [[CONTRACTS]]/[[BRANCHES]] blocks that appeared
  // in earlier turns but were overwritten by later continuations.
  if (result && allContent.length > 1) {
    result._allContent = allContent.join("\n");
  }

  return result;
}

async function runModeAndReturn(visitorId, mode, message, {
  socket, username, userId, rootId, signal, slot,
  currentNodeId, readOnly = false, clearHistory = false,
  onToolLoopCheckpoint, modesUsed,
  targetNodeId = null,
  sessionId = null, rootChatId = null,
  treeCapabilities = null,
  adjectives = null,
  quantifiers = null,
  temporalScope = null,
  fanoutContext = null,
  reroutePrefix = null,
  voice = "active",
}) {
  modesUsed.push(mode);
  emitStatus(socket, "intent", "");

  // Build conversation memory + grammar modifier injections.
  let memory = formatMemoryContext(visitorId);

  // Reroute prefix injection: when the orchestrator intercepted a correction
  // and substituted the message, tell the AI to open its response with a
  // brief note explaining the reroute. This keeps the chat history readable:
  // the user sees their correction in the history, then the AI's response
  // starts with "↪ Rerouted your previous message to food: ...". Without
  // this, the chat looks like the AI ignored the correction and answered a
  // random question, which is confusing.
  if (reroutePrefix) {
    const rerouteBlock = `[Rerouted] This message was rerouted from another extension. ` +
      `Your response MUST begin with EXACTLY this line on its own, followed by a blank line, ` +
      `then your normal response to the message:\n\n${reroutePrefix}\n\nDo not paraphrase the ` +
      `reroute line. Copy it exactly as shown above.`;
    memory = (memory ? memory + "\n\n" : "") + rerouteBlock;
  }

  // Temporal scope injection: constrains the data window the AI operates on.
  // Time is not tense. Tense = intent. Time = which data to look at.
  if (temporalScope) {
    let timeDesc;
    if (temporalScope.type === "range") timeDesc = `from ${temporalScope.from} to ${temporalScope.to}`;
    else if (temporalScope.type === "since") timeDesc = `since ${temporalScope.from}`;
    else if (temporalScope.type === "duration") timeDesc = `${temporalScope.raw}`;
    else timeDesc = temporalScope.raw;
    const timeBlock = `[Time Scope] The user is asking about a specific time window: ${timeDesc}. ` +
      `Constrain your data queries and analysis to this period. Do not include data outside this window unless comparing.`;
    memory = (memory ? memory + "\n\n" : "") + timeBlock;
  }

  // Voice injection: passive voice means the user is observing, not commanding.
  // The AI should acknowledge, reflect, and suggest rather than execute.
  if (voice === "passive") {
    const voiceBlock = `[Voice: passive] The user is describing something that happened or a state they noticed. ` +
      `Observe and acknowledge. Reflect on what it means. Suggest next steps if relevant. ` +
      `Do not treat this as a command to log or execute.`;
    memory = (memory ? memory + "\n\n" : "") + voiceBlock;
  }

  // Fanout injection: pre-resolved set data replaces generic selection annotation.
  // When FANOUT executed, items are already resolved with real enriched context.
  // When no fanout, fall back to annotation telling the AI to query the set itself.
  if (fanoutContext) {
    memory = (memory ? memory + "\n\n" : "") + fanoutContext;
  } else if (quantifiers && quantifiers.length > 0) {
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

  const result = await runSteppedMode(visitorId, mode, message, {
    username, userId, rootId, signal, slot,
    readOnly, onToolLoopCheckpoint, socket,
    sessionId, rootChatId,
  });

  emitStatus(socket, "done", "");
  let answer = result?._allContent || result?.content || result?.answer || null;

  // Branch swarm detection. If the mode emitted a [[BRANCHES]]...[[/BRANCHES]]
  // block, parse it and dispatch each branch as its own sequence of
  // plan-mode runs at a dedicated child node. This is how a compound
  // project request ("make a tinder app with backend and frontend") turns
  // into a tree of chats that each build one component. The branch runner
  // is sequential in phase 1; the `slot` field on each branch is preserved
  // for when we flip to parallel (per-slot LLM routing).
  if (answer) {
    // Parse contracts FIRST so parseBranches sees the cleaned text
    // (the [[CONTRACTS]] block is stripped before parseBranches runs).
    // Contracts are optional — a simple single-branch build doesn't
    // need them — but when present they become the authoritative wire
    // protocol all branches must implement.
    const contractsParse = parseContracts(answer);
    let parsedContracts = contractsParse.contracts;
    if (parsedContracts.length > 0) {
      answer = contractsParse.cleaned;
      if (result) {
        result.content = contractsParse.cleaned;
        result.answer = contractsParse.cleaned;
      }
      log.info("Tree Orchestrator",
        `📜 Architect declared ${parsedContracts.length} contract(s): ${parsedContracts.map((c) => `${c.kind} ${c.name}`).join(", ")}`,
      );
    }

    log.info("Tree Orchestrator", `🔍 parseBranches input: ${answer?.length || 0} chars, has [[BRANCHES]]: ${answer?.includes?.("[[BRANCHES]]") || false}`);
    const branchParse = parseBranches(answer);
    log.info("Tree Orchestrator", `🔍 parseBranches result: ${branchParse.branches.length} branches`);
    if (branchParse.branches.length > 0) {
      answer = branchParse.cleaned;
      if (result) {
        result.content = branchParse.cleaned;
        result.answer = branchParse.cleaned;
      }
      log.info("Tree Orchestrator",
        `🌿 Detected ${branchParse.branches.length} branches from ${mode}: ${branchParse.branches.map((b) => b.name).join(", ")}`,
      );

      // Resolve the current project root node so the swarm runner knows
      // where to hang branch children. We look up by the current position
      // walking the metadata.code-workspace.role chain to find "project".
      // If no project exists yet (common: user is at a fresh tree root,
      // no files written), auto-initialize the tree root as a workspace
      // project so the swarm has somewhere to hang branches.
      try {
        const { getExtension } = await import("../loader.js");
        const cwExt = getExtension("code-workspace");
        // Walk from current position to find the project root
        let projectNode = null;
        const searchNodeId = currentNodeId || targetNodeId || rootId;
        const NodeModel = (await import("../../seed/models/node.js")).default;
        if (searchNodeId) {
          let cursor = String(searchNodeId);
          for (let i = 0; i < 64 && cursor; i++) {
            const n = await NodeModel.findById(cursor).select("_id name parent metadata").lean();
            if (!n) break;
            const meta = n.metadata instanceof Map ? n.metadata.get("code-workspace") : n.metadata?.["code-workspace"];
            if (meta?.role === "project" && meta?.initialized) {
              projectNode = n;
              break;
            }
            if (!n.parent) break;
            cursor = String(n.parent);
          }
        }

        // Auto-init fallback. If the user is at a tree root with no
        // existing project metadata, treat the tree root as the project
        // and initialize it via code-workspace's initProject export.
        // Mirrors the ensureProject auto-init that runs on first file
        // write, but fires before the swarm dispatch so branches have a
        // parent to hang under.
        if (!projectNode && rootId && cwExt?.exports?.initProject) {
          log.info("Tree Orchestrator", `Swarm: no project at position, auto-initializing tree root ${rootId}`);
          try {
            const rootNode = await NodeModel.findById(rootId).lean();
            if (rootNode) {
              await cwExt.exports.initProject({
                projectNodeId: rootId,
                name: rootNode.name || "workspace",
                description: "Auto-initialized by swarm dispatch.",
                userId,
              });
              projectNode = await NodeModel.findById(rootId).select("_id name parent metadata").lean();
            }
          } catch (initErr) {
            log.error("Tree Orchestrator", `Swarm auto-init failed: ${initErr.message}`);
          }
        }

        if (!projectNode) {
          log.warn("Tree Orchestrator", "Swarm: no project root found at current position; branches will not run.");
        } else {
          // Persist the architect's declared contracts on the project
          // root BEFORE the swarm dispatches, so each branch session's
          // enrichContext walks into them via readProjectContracts and
          // injects them into the branch's system prompt from turn 1.
          // This is how the architect's design flows to every
          // implementing branch without a separate distribution step.
          if (parsedContracts && parsedContracts.length > 0) {
            try {
              const { setProjectContracts } = await import("../code-workspace/swarmEvents.js");
              await setProjectContracts({
                projectNodeId: projectNode._id,
                contracts: parsedContracts,
                core: { metadata: { setExtMeta: async (node, ns, data) => {
                  const NodeModel = (await import("../../seed/models/node.js")).default;
                  await NodeModel.updateOne({ _id: node._id }, { $set: { [`metadata.${ns}`]: data } });
                } } },
              });
              log.info("Tree Orchestrator",
                `📜 Contracts stored on project root ${String(projectNode._id).slice(0, 8)}`,
              );
            } catch (ctxErr) {
              log.warn("Tree Orchestrator", `Failed to store contracts: ${ctxErr.message}`);
            }
          }

          // Validate the architect's branch paths against the seam
          // rules (no path may equal the project name, all paths must
          // be unique, every branch must have a path). If any branch
          // is broken, reject the whole block, skip the swarm dispatch,
          // and append an error message to the answer so the next turn
          // forces the architect to re-emit a corrected [[BRANCHES]]
          // block. Without this, a bad branch plan (like two branches
          // both using path=ProjectName) silently collapses the whole
          // swarm into one subdirectory with empty branch nodes.
          const validation = validateBranches(branchParse.branches, projectNode?.name);
          if (validation.errors.length > 0) {
            log.warn("Tree Orchestrator",
              `🚫 Swarm: rejecting branch plan with ${validation.errors.length} validation error(s):\n  - ${validation.errors.join("\n  - ")}`,
            );
            const errorBlock = [
              "",
              "⚠️ BRANCH PLAN REJECTED — the [[BRANCHES]] block violated the seam rules:",
              ...validation.errors.map((e) => `  • ${e}`),
              "",
              "Re-emit the [[BRANCHES]] block with valid paths and [[DONE]] your turn again.",
            ].join("\n");
            answer = (answer || "") + "\n" + errorBlock;
            if (result) {
              result.content = answer;
              result.answer = answer;
            }
            return { success: true, answer, modeKey: mode, modesUsed, rootId, targetNodeId: targetNodeId || currentNodeId };
          }

          const _swarmActive = getActiveRequest(visitorId) || {};
          const swarmResult = await runBranchSwarm({
            branches: branchParse.branches,
            rootProjectNode: projectNode,
            rootChatId,
            sessionId,
            visitorId,
            userId,
            username,
            rootId,
            signal,
            slot,
            socket,
            onToolLoopCheckpoint,
            userRequest: message,
            rt: _swarmActive.rt,
            core: { metadata: { setExtMeta: async (node, ns, data) => {
              // Safe fallback via direct Node update if core services aren't available here
              const NodeModel = (await import("../../seed/models/node.js")).default;
              await NodeModel.updateOne({ _id: node._id }, { $set: { [`metadata.${ns}`]: data } });
            } } },
            emitStatus,
            runBranch: async ({ mode: branchMode, message: branchMessage, branchNodeId, slot: branchSlot, ...rest }) => {
              // Position the session at the branch node + clear history so
              // each branch starts fresh at its own tree position.
              log.info("Tree Orchestrator",
                `🌿 runBranch dispatching: mode=${branchMode} branchNodeId=${branchNodeId?.slice?.(0, 8)} (was currentNodeId=${getCurrentNodeId(visitorId)?.slice?.(0, 8)})`,
              );
              setCurrentNodeId(visitorId, branchNodeId);
              // Refresh the active request so the branch's
              // runSteppedMode can read sessionId/userId/rt.
              // The 30s TTL on getActiveRequest expires during
              // long builds; re-stamp with the values captured
              // at swarm start (line 2497) so they survive.
              setActiveRequest(visitorId, {
                socket, username, userId, signal,
                sessionId,
                rootId,
                rootChatId,
                slot, onToolLoopCheckpoint,
                rt: (getActiveRequest(visitorId) || {}).rt,
              });
              await switchMode(visitorId, branchMode, {
                username, userId, rootId,
                currentNodeId: branchNodeId,
                clearHistory: true,
              });
              log.info("Tree Orchestrator",
                `🌿 runBranch post-switch: currentNodeId=${getCurrentNodeId(visitorId)?.slice?.(0, 8)} (expected ${branchNodeId?.slice?.(0, 8)})`,
              );
              // Stamp dispatch lineage on the branch's chat chain so
              // the operator can walk from the orchestrator's root
              // step down to each branch and back. parentChatId points
              // at the orchestrator's root chat (active.rootChatId);
              // dispatchOrigin tells the renderer "this is a swarm
              // branch spawn" so the labels are right.
              return runSteppedMode(visitorId, branchMode, branchMessage, {
                username, userId, rootId, signal, slot: branchSlot,
                readOnly: false, onToolLoopCheckpoint, socket,
                sessionId, rootChatId,
                parentChatId: rootChatId || null,
                dispatchOrigin: "branch-swarm",
              });
            },
          });

          // Replace the answer with the swarm summary so the user sees the
          // full picture. Original architect text + swarm result.
          answer = [answer, "", swarmResult.summary].filter(Boolean).join("\n");
          if (result) {
            result.content = answer;
            result.answer = answer;
          }

          // Restore position to the original project root
          if (projectNode?._id) setCurrentNodeId(visitorId, String(projectNode._id));
        }
      } catch (err) {
        log.error("Tree Orchestrator", `Swarm dispatch failed: ${err.message}`);
        log.error("Tree Orchestrator", err.stack?.split("\n").slice(0, 5).join("\n"));
      }
    }
  }

  // Plan capture: if the mode emitted a [[PLAN]]...[[/PLAN]] block, strip it
  // from the visible answer and stash it for the next turn. The next
  // affirmative from this visitor will expand the plan into N sequential
  // runs, one chat per item. Non-affirmative next message clears it.
  if (answer) {
    const { items, cleaned } = parsePlan(answer);
    if (items.length > 0) {
      setPendingPlan(visitorId, items, mode);
      answer = cleaned;
      if (result) {
        result.content = cleaned;
        result.answer = cleaned;
      }
      log.info("Tree Orchestrator",
        `📋 Captured plan: ${items.length} items from ${mode}. Say an affirmative to expand.`,
      );
    }
  }

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
  forceMode = null, // misroute reroute uses this to bypass classification
}) {
  if (signal?.aborted) return null;

  const rootId = rootIdParam ?? getRootId(visitorId);

  // Create the OrchestratorRuntime EARLY — before pending-plan expand,
  // misroute intercept, or classification — so every code path that
  // writes chain-step Chat records can use the same rt.chainIndex as
  // the single source of truth. runPendingPlan, runSteppedMode,
  // runBranchSwarm, the classifier step tracker — all of them read rt
  // from getActiveRequest(visitorId).rt.
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
  rt.attach({ sessionId, mainChatId: rootChatId, llmProvider, signal, chainIndex: 1 });

  // Stash the active request context so extensions (like misroute) can
  // redispatch on the same socket if they detect a correction. Cleared in
  // a finally below so we never leak state across requests. Includes rt
  // so downstream helpers can read/increment the shared chain counter.
  setActiveRequest(visitorId, {
    socket, username, userId, signal, sessionId, rootId,
    rootChatId, slot, sourceType, sourceId, onToolLoopCheckpoint,
    rt,
  });

  // Ensure AI contribution context is set so MCP tool calls get chatId/sessionId
  if (rootChatId) {
    setChatContext(visitorId, sessionId, rootChatId);
  }

  // ── Resumable swarm intercept ──
  // When the user is inside (or at) a code-workspace project with a
  // masterPlan that has ANY non-done branches, AND this message looks
  // like a continuation ("continue", "finish", "keep going", or any
  // short imperative at the project), skip the classifier/architect
  // entirely and dispatch runBranchSwarm directly with the pending /
  // paused / failed branches.
  //
  // This is the "TreeOS knows what it already built" behavior: the
  // tree is the authoritative state, AI chats are ephemeral. Any new
  // message at a project automatically sees its state and picks up
  // where it left off — no re-architecting, no duplicate branches.
  if (!forceMode && message && rootId) {
    try {
      // Use the session's current tree position if set, otherwise the
      // tree root. `currentNodeId` is NOT a destructured param on this
      // function — a previous version referenced it as an undeclared
      // local which silently ReferenceError'd every call and left the
      // whole resume intercept inert. Read it off the session instead.
      const searchNodeId = getCurrentNodeId(visitorId) || rootId;
      const { findProjectForNode, detectResumableSwarm } = await import("../code-workspace/swarmEvents.js");
      const projectNode = await findProjectForNode(searchNodeId);
      if (projectNode) {
        const resumable = await detectResumableSwarm(projectNode._id);
        if (resumable && resumable.resumable.length > 0) {
          // At least one non-done branch exists. Should we intercept?
          // Intercept if:
          //   - message is an affirmative / continuation word, OR
          //   - message is short + imperative (user said "build it" or "go" at an in-progress project)
          // Skip intercept if message is long and clearly describes a new task
          // (user will get the architect path to produce fresh branches).
          const RESUME_CONTINUATION_RE = /^\s*(continue|keep\s+going|resume|finish(\s+it)?(\s+up)?|pick(\s+up)?|retry|again|go|go\s+ahead|proceed|keep\s+building|build|make\s+it|do\s+it|complete(\s+it)?|the\s+rest|what('|')?s\s+left|where\s+were\s+we)\b/i;
          const shortImperative = message.length < 60 && RESUME_CONTINUATION_RE.test(message);

          if (shortImperative) {
            log.info("Tree Orchestrator",
              `▶️  Resume intercept: ${resumable.resumable.length} of ${resumable.total} branches non-done under "${resumable.projectName}" (${JSON.stringify(resumable.statusCounts)}). Skipping classifier, dispatching runBranchSwarm in resume mode.`,
            );
            emitStatus(socket, "intent", `Resuming ${resumable.resumable.length} branch(es) from prior run...`);

            const swarmResult = await runBranchSwarm({
              branches: resumable.resumable,
              rootProjectNode: projectNode,
              rootChatId,
              sessionId,
              visitorId,
              userId,
              username,
              rootId,
              signal,
              slot,
              socket,
              onToolLoopCheckpoint,
              userRequest: resumable.systemSpec || message,
              rt,
              resumeMode: true,
              core: {
                metadata: {
                  setExtMeta: async (node, ns, data) => {
                    const NodeModel = (await import("../../seed/models/node.js")).default;
                    await NodeModel.updateOne({ _id: node._id }, { $set: { [`metadata.${ns}`]: data } });
                  },
                },
              },
              emitStatus,
              runBranch: async ({ mode: branchMode, message: branchMessage, branchNodeId, slot: branchSlot }) => {
                setCurrentNodeId(visitorId, branchNodeId);
                await switchMode(visitorId, branchMode, {
                  username, userId, rootId,
                  currentNodeId: branchNodeId,
                  clearHistory: true,
                });
                return runSteppedMode(visitorId, branchMode, branchMessage, {
                  username, userId, rootId, signal, slot: branchSlot,
                  readOnly: false, onToolLoopCheckpoint, socket,
                  parentChatId: rootChatId || null,
                  dispatchOrigin: "branch-swarm",
                });
              },
            });

            emitStatus(socket, "done", "");
            return {
              success: swarmResult.success,
              answer: swarmResult.summary,
              modeKey: "tree:code-plan",
              modesUsed: ["tree:code-plan"],
              rootId,
              targetNodeId: String(projectNode._id),
            };
          }
        }
      }
    } catch (err) {
      log.debug("Tree Orchestrator", `Resume intercept skipped: ${err.message}`);
    }
  }

  // ── Pending-plan expand ──
  // If a prior review/audit stashed a structured plan and this message is
  // a clear affirmative ("ok", "fix it", "do them all"), expand the plan
  // into a sequence of runs. Each item becomes its own chat turn. Non-
  // affirmative input clears the stashed plan — the user moved on and
  // shouldn't get their unrelated message silently expanded.
  if (!forceMode && message) {
    const pending = getPendingPlan(visitorId);
    if (pending) {
      if (isAffirmative(message)) {
        log.info("Tree Orchestrator",
          `▶️  Expanding pending plan: ${pending.items.length} items (mode=${pending.mode || "?"})`,
        );
        clearPendingPlan(visitorId);
        return runPendingPlan(pending, message, visitorId, {
          socket, username, userId, signal, sessionId,
          rootId, rootChatId, slot, onToolLoopCheckpoint,
        });
      } else {
        // User said something else — they moved on. Drop the stash.
        clearPendingPlan(visitorId);
      }
    }
  }

  // ── Early misroute intercept ──
  // Before classification runs, ask the misroute extension if the current
  // message is a correction of the previous routing. If yes and the user
  // named a target, substitute the original message and forceMode the
  // correct extension. This produces ONE orchestration call (the rerouted
  // one) instead of two and the user only sees one response.
  //
  // Skipped when forceMode is already set (which means we ARE the rerouted
  // call, prevents loops) or when misroute extension isn't loaded.
  let reroutePrefix = null;
  if (!forceMode && message) {
    try {
      const { getExtension } = await import("../loader.js");
      const misroute = getExtension("misroute");
      if (misroute?.exports?.checkForCorrectionReroute) {
        const reroute = await misroute.exports.checkForCorrectionReroute({
          message, visitorId, userId, rootId,
        });
        if (reroute) {
          log.info("Tree Orchestrator",
            `🔄 Correction intercept: substituting "${reroute.rerouteMessage.slice(0, 50)}" forceMode=${reroute.forceMode}`,
          );
          // Substitute message and force mode for the rest of this orchestration
          message = reroute.rerouteMessage;
          forceMode = reroute.forceMode;
          // Build the prefix the AI should use to open its response. Makes
          // the chat history read clearly: user sees their correction, then
          // "↪ Rerouted ... : " followed by the actual answer from the
          // correct extension. Without this prefix the chat looks like the
          // AI ignored the correction and answered a random question.
          const origMessage = reroute.rerouteMessage.length > 60
            ? reroute.rerouteMessage.slice(0, 60) + "…"
            : reroute.rerouteMessage;
          reroutePrefix = `↪ Rerouted your previous message to ${reroute.correctExtension}: "${origMessage}"`;
        }
      }
    } catch (err) {
      log.debug("Tree Orchestrator", `Misroute intercept skipped: ${err.message}`);
    }
  }

  // rt / llmProvider / setActiveRequest already created above before the
  // pending-plan and misroute intercepts. Reuse them here.
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

  // ────────────────────────────────────────────────────────
  // STEP 0: forceMode bypass. When set (by misroute reroute), skip
  // classification entirely and dispatch directly to the requested mode.
  // The extension owner is derived from the mode key for downstream noun
  // resolution. This is the entry point for active rerouting.
  // ────────────────────────────────────────────────────────
  if (forceMode) {
    const forcedExt = (typeof getModeOwner === "function" ? getModeOwner(forceMode) : null) || "?";
    classification = {
      intent: "extension",
      mode: forceMode,
      targetNodeId: null,
      confidence: 1.0,
      summary: message.slice(0, 100),
      responseHint: "",
    };
    log.info("Tree Orchestrator", `🔄 forceMode override: ${forceMode} (ext=${forcedExt})`);
  }

  // Check if current position has a mode override (extension node).
  // Skipped entirely when forceMode is set so the override actually wins.
  if (!forceMode) {
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
        classification = await localClassify(message, departed ? rootId : (getCurrentNodeId(visitorId) || rootId), rootId, userId);
      }
    } else {
      // Default: local classification. Zero LLM calls.
      classification = await localClassify(message, departed ? rootId : (getCurrentNodeId(visitorId) || rootId), rootId, userId);
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
              // Resolve coach mode via registry, NOT string concatenation.
              // Extension name and mode prefix don't always match
              // (code-workspace owns tree:code-coach, not tree:code-workspace-coach).
              const extCoachModes = getModesOwnedBy(extName).filter((m) => m.endsWith("-coach"));
              const resolvedMode = decision?.mode || extCoachModes[0] || null;
              if (!resolvedMode) {
                log.warn("Tree Orchestrator", `BE mode: ${extName} has no coach mode registered, skipping`);
                continue;
              }
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
            const extCoachModes = extModes.filter((m) => m.endsWith("-coach"));
            if (extCoachModes.length === 0) continue;

            const targetId = entry.nodeId || entry.nodes?.[0]?.nodeId;
            log.verbose("Tree Orchestrator", `  BE mode: routing to closest extension ${extName} at ${targetId}`);
            setCurrentNodeId(visitorId, targetId);
            emitStatus(socket, "intent", "");
            try {
              const decision = await ext.exports.handleMessage("be", {
                userId, username, rootId, targetNodeId: targetId,
              });
              // Use the first registered -coach mode for this extension.
              // Extension name ≠ mode prefix in general (code-workspace
              // owns tree:code-coach), so we look up via the registry.
              const resolvedMode = decision?.mode || extCoachModes[0];
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

        // ── Causality check: is this cause -> effect, not sequential chain? ──
        const causal = detectCausality(message, allMatches);
        if (causal) {
          const effectMatch = allMatches.find(m => m.extName === causal.effect);
          if (effectMatch) {
            // Resolve the effect domain's coach mode
            const effectMode = await (async () => {
              const { getModesOwnedBy: gmo } = await import("../../seed/tree/extensionScope.js");
              const modes = gmo(causal.effect);
              return modes.find(m => m.endsWith("-coach")) || modes.find(m => m.endsWith("-review")) || effectMatch.mode;
            })();

            logParseTree(message, {
              noun: `${causal.cause}->${causal.effect}`, nounSource: "causal", nounConf: 0.85,
              tense: "future", tensePattern: "coach-causal", tenseConf: 0.9,
              resolvedMode: effectMode, adjectives: parseAdjectives(message), voice: "passive",
              conditional: parseConditional(message),
            });
            log.info("Grammar", `CAUSAL: ${causal.cause} -[${causal.connector}]-> ${causal.effect}`);

            const causalGraph = buildExecutionGraph({
              resolvedMode: effectMode, tenseInfo: { tense: "future", pattern: "coach-causal" },
              conditional: parseConditional(message),
              adjectives: parseAdjectives(message), quantifiers: null,
              temporalScope: parseTemporalScope(message), voice: "passive",
              causal: { cause: causal.cause, effect: causal.effect, connector: causal.connector, effectMode, effectNodeId: effectMatch.targetNodeId },
              classification, behavioral, currentNodeId: effectMatch.targetNodeId, rootId,
              extName: causal.effect,
            });
            log.verbose("Grammar", `Graph: ${describeGraph(causalGraph)}`);
            return executeGraph(causalGraph, message, visitorId, {
              socket, username, userId, rootId, signal, slot,
              currentNodeId: effectMatch.targetNodeId,
              onToolLoopCheckpoint, modesUsed,
            });
          }
        }

        // Not causal: run as sequential chain via graph
        log.verbose("Tree Orchestrator", `  Chain detected: ${allMatches.map(m => m.extName).join(" -> ")}`);
        const chainGraph = {
          type: "sequence",
          steps: allMatches.map(m => makeDispatch(m.mode, m.extName, m.targetNodeId, { tense: "present" })),
          source: "multi-extension",
        };
        return executeGraph(chainGraph, message, visitorId, { socket, username, userId, rootId, signal, slot, onToolLoopCheckpoint, modesUsed });
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

    // ── Step 1e: Parse temporal scope (data window) ──
    const temporalScope = parseTemporalScope(message);

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

    // ── Layer 4: Build execution graph ──
    const graph = buildExecutionGraph({
      resolvedMode, tenseInfo, conditional, adjectives, quantifiers,
      temporalScope, voice, causal: null, classification, behavioral, currentNodeId, rootId,
      extName: noun,
    });

    // ── Grammar debugger ──
    logParseTree(message, {
      noun, nounSource: classification.targetNodeId ? "position-hold" : "classification",
      nounConf, tense: tenseInfo.tense, tensePattern: tenseInfo.pattern, tenseConf,
      resolvedMode, negated: tenseInfo.tense === "negated",
      compound: tenseInfo.compound ? tenseInfo.compound.map(s => s.tense) : null,
      pronoun: pronounInfo?.pronoun || null, quantifiers,
      adjectives: adjectives.length > 0 ? adjectives : null,
      voice, preposition: prepInfo?.preposition || null,
      prepTarget: prepInfo?.raw || null,
      temporal: temporalScope ? temporalScope.raw : null,
      conditional, forcedMode: forcedMode || null,
      graph,
      posMatches: classification.posMatches,
      posScore: classification.posScore,
      posLocality: classification.posLocality,
      posAllScores: classification.posAllScores,
    });

    // ── Update pronoun state for next message ──
    updatePronounState(visitorId, {
      active: classification.targetNodeId || currentNodeId,
      lastNoun: noun,
      lastMode: resolvedMode,
      lastMessage: message.slice(0, 200),
    });

    // ── Record the routing decision so misroute extension can check
    //    whether the NEXT message from this visitor is a correction. ──
    recordRoutingDecision(visitorId, {
      message: message.slice(0, 500),
      extName: noun,
      mode: resolvedMode,
      targetNodeId: classification.targetNodeId || null,
      currentNodeId,
      rootId,
      posMatches: classification.posMatches || null,
      posScore: classification.posScore || 0,
      posLocality: classification.posLocality || false,
      tense: tenseInfo.tense,
      tensePattern: tenseInfo.pattern,
      confidence: classification.confidence || 0,
    });

    // ── Execute ──
    return executeGraph(graph, message, visitorId, {
      socket, username, userId, rootId, signal, slot,
      currentNodeId: classification.targetNodeId || currentNodeId,
      onToolLoopCheckpoint, modesUsed,
      reroutePrefix, // null unless misroute intercept fired above
      sessionId, rootChatId,
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
        const converseGraph = buildExecutionGraph({
          resolvedMode: singleTense.mode, tenseInfo: singleTense,
          conditional: singleCond, adjectives: parseAdjectives(message),
          quantifiers: parseQuantifier(message), temporalScope: parseTemporalScope(message),
          voice: detectVoice(message),
          causal: null, classification: { targetNodeId: single.targetNodeId },
          behavioral, currentNodeId: single.targetNodeId, rootId,
          extName: single.extName,
        });
        log.verbose("Grammar", `Graph: ${describeGraph(converseGraph)}`);
        return executeGraph(converseGraph, message, visitorId, {
          socket, username, userId, rootId, signal, slot,
          currentNodeId: single.targetNodeId, clearHistory: true,
          onToolLoopCheckpoint, modesUsed,
        });
      }

      if (indexMatches.length > 1) {
        log.verbose("Tree Orchestrator", `  Chain detected: ${indexMatches.map(m => m.extName).join(" -> ")}`);
        const converseChainGraph = {
          type: "sequence",
          steps: indexMatches.map(m => makeDispatch(m.mode, m.extName, m.targetNodeId, { tense: "present" })),
          source: "converse-multi",
        };
        return executeGraph(converseChainGraph, message, visitorId, { socket, username, userId, rootId, signal, slot, onToolLoopCheckpoint, modesUsed });
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

  // Fallback: converse mode. If conditional detected, route through graph for evaluation.
  // Otherwise direct dispatch (no graph overhead for simple messages).
  if (fallbackCond) {
    const fallbackGraph = buildExecutionGraph({
      resolvedMode: "tree:converse", tenseInfo: { tense: "present", pattern: "default" },
      conditional: fallbackCond, adjectives: parseAdjectives(message),
      quantifiers: null, temporalScope: parseTemporalScope(message),
      voice: detectVoice(message),
      causal: null, classification: {}, behavioral, currentNodeId, rootId,
      extName: null,
    });
    // Inject treeCapabilities into graph nodes
    if (fallbackGraph.type === "dispatch") fallbackGraph.modifiers.treeCapabilities = treeCapabilities;
    else if (fallbackGraph.type === "fork") {
      fallbackGraph.truePath.modifiers.treeCapabilities = treeCapabilities;
      fallbackGraph.falsePath.modifiers.treeCapabilities = treeCapabilities;
      fallbackGraph.unknownPath.modifiers.treeCapabilities = treeCapabilities;
    }
    log.verbose("Grammar", `Graph: ${describeGraph(fallbackGraph)}`);
    return executeGraph(fallbackGraph, message, visitorId, {
      socket, username, userId, rootId, signal, slot,
      currentNodeId, clearHistory: true,
      onToolLoopCheckpoint, modesUsed,
    });
  }

  return runModeAndReturn(visitorId, "tree:converse", message, {
    socket, username, userId, rootId, signal, slot,
    currentNodeId, clearHistory: true,
    onToolLoopCheckpoint, modesUsed,
    treeCapabilities,
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
