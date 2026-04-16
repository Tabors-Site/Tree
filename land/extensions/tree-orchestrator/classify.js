// TreeOS Tree Orchestrator . classify.js
// All grammar/classification functions extracted from orchestrator.js.
// Regex constants, tense parsing, pronoun resolution, causality detection,
// voice detection, quantifiers, conditionals, adjectives, prepositions,
// temporal scope parsing, local intent classification, behavioral extraction,
// and mode resolution.

import Node from "../../seed/models/node.js";
import { resolveMode } from "../../seed/modes/registry.js";
import { buildCurrentPath as _buildCurrentPath, getPronounState } from "./state.js";

// ─────────────────────────────────────────────────────────────────────────
// LOCAL CLASSIFY
// ─────────────────────────────────────────────────────────────────────────

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

// ─────────────────────────────────────────────────────────────────────────
// BEHAVIORAL EXTRACTION
// ─────────────────────────────────────────────────────────────────────────

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

// ─────────────────────────────────────────────────────────────────────────
// PRONOUN PARSER
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
// ─────────────────────────────────────────────────────────────────────────

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
// ─────────────────────────────────────────────────────────────────────────

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
// EXPORTS
// ─────────────────────────────────────────────────────────────────────────

export {
  localClassify,
  extractBehavioral,
  resolveModeForNode,
  parseTense,
  parsePronouns,
  detectCausality,
  detectVoice,
  parseQuantifier,
  parseConditional,
  parseAdjectives,
  parsePreposition,
  parseTemporalScope,
  // Regex constants (backward-compat)
  REVIEW_PATTERN,
  COACH_PATTERN,
  PLAN_PATTERN,
  // Raw tense patterns (for grammar debugger or tests)
  TENSE_PAST,
  TENSE_FUTURE,
  TENSE_IMPERATIVE,
  SENTENCE_START_IMPERATIVE,
  NEGATION,
};
