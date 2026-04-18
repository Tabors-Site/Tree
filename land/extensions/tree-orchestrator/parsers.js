// TreeOS Tree Orchestrator . parsers.js
//
// Grammar parsers. Each function consumes the grammar tables in grammar.js
// and extracts one axis of meaning from the message: tense, pronouns,
// causality, voice, quantifiers, conditionals, adjectives, prepositions,
// temporal scope.
//
// Purity: most parsers are pure functions of (message). parseTense and
// parsePreposition are async because they touch the extension registry
// and the routing index respectively; the rest are synchronous.

import Node from "../../seed/models/node.js";
import { getPronounState } from "./state.js";
import {
  TENSE_PAST,
  TENSE_FUTURE,
  TENSE_IMPERATIVE,
  SENTENCE_START_IMPERATIVE,
  NEGATION,
  CONJUNCTION,
  CAUSAL_CONNECTORS,
  PASSIVE_VOICE,
  QUANTIFIER_UNIVERSAL,
  QUANTIFIER_NUMERIC,
  QUANTIFIER_SUPERLATIVE,
  QUANTIFIER_COMPARATIVE,
  QUANTIFIER_TEMPORAL,
  CONDITIONAL_IF,
  CONDITIONAL_WHEN,
  CONDITIONAL_UNLESS,
  CONDITIONAL_SHORT,
  CONDITIONAL_ELSE,
  QUALITY_ADJ,
  STATE_ADJ,
  COMPARATIVE_ADJ,
  PREPOSITION_PATTERN,
  TEMPORAL_RELATIVE,
  TEMPORAL_ABSOLUTE,
  TEMPORAL_DURATION,
  TEMPORAL_RANGE,
  TEMPORAL_SINCE,
} from "./grammar.js";

// ─────────────────────────────────────────────────────────────────────────
// TENSE PARSER
//
// Parse tense: which conjugation of the verb (extension) handles this message.
// Called ONCE per message after the noun (extension territory) is identified.
// Returns the resolved mode key for the identified tense.
// ─────────────────────────────────────────────────────────────────────────

export async function parseTense(baseMode, message, behavioral) {
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
    // "Build me a server", "Write a function" . these are unambiguously
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

// ─────────────────────────────────────────────────────────────────────────
// PRONOUN PARSER
//
// Pronouns resolve "it", "this", "that", "the same" to concrete nodes.
// Three slots tracked per visitor:
//   active    . the node the user is currently at (currentNodeId)
//   lastMod   . the last node modified by a tool call (updated by afterToolCall)
//   lastNoun  . the last extension territory the parser resolved
//
// "Do that again" . lastMod tells us what "that" was.
// "Log it" . active tells us what "it" is.
// "The same" . lastNoun tells us which extension to reuse.
// ─────────────────────────────────────────────────────────────────────────

export function parsePronouns(message, visitorId) {
  const lower = message.toLowerCase().trim();
  const state = getPronounState(visitorId);
  const result = { resolvedNode: null, resolvedNoun: null, resolvedMode: null, pronoun: null };
  let found = false;

  // "that", "the same", "again", "repeat", "same thing" . refers to last modified/last action
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

  // "it", "this" . refers to current active node
  if (/\b(^it$|^this$|this one|right here)\b/i.test(lower) && state.active) {
    result.resolvedNode = state.active;
    result.pronoun = "it/this (active)";
    found = true;
  }

  return found ? result : null;
}

// ─────────────────────────────────────────────────────────────────────────
// CAUSAL CONNECTOR
//
// Detect cross-domain causal relationships. Only fires when 2+ extensions
// match AND a causal connector is present. Cause appears before the
// connector, effect appears after.
// ─────────────────────────────────────────────────────────────────────────

export function detectCausality(message, matchedExtensions) {
  if (!matchedExtensions || matchedExtensions.length < 2) return null;

  const connectorMatch = CAUSAL_CONNECTORS.exec(message.toLowerCase());
  if (!connectorMatch) return null;

  const connectorPos = connectorMatch.index;

  const sorted = [...matchedExtensions].sort((a, b) => {
    const aPos = a.pos != null ? a.pos : message.length;
    const bPos = b.pos != null ? b.pos : message.length;
    return aPos - bPos;
  });

  let cause = null;
  let effect = null;
  for (const ext of sorted) {
    const extPos = ext.pos != null ? ext.pos : 0;
    if (extPos < connectorPos && !cause) cause = ext.extName;
    else if (extPos >= connectorPos || cause) { if (!effect) effect = ext.extName; }
  }

  if (!cause && sorted.length >= 1) cause = sorted[0].extName;
  if (!effect && sorted.length >= 2) effect = sorted[1].extName;

  if (cause && effect && cause !== effect) {
    return { cause, effect, connector: connectorMatch[0] };
  }

  return null;
}

// ─────────────────────────────────────────────────────────────────────────
// VOICE DETECTOR
// ─────────────────────────────────────────────────────────────────────────

export function detectVoice(message) {
  if (PASSIVE_VOICE.test(message.toLowerCase())) return "passive";
  return "active";
}

// ─────────────────────────────────────────────────────────────────────────
// QUANTIFIER PARSER
// ─────────────────────────────────────────────────────────────────────────

export function parseQuantifier(message) {
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
// ─────────────────────────────────────────────────────────────────────────

export function parseConditional(message) {
  const lower = message.toLowerCase().trim();

  // Build-imperative bailout. When the user says "build me a tinder app
  // that has X when Y", the "when Y" is describing app runtime behavior
  // . part of the spec, not a control-flow condition for the orchestrator.
  // If the sentence opens with a build/scaffold imperative, the message
  // is a SPEC, not a runtime workflow. Skip conditional parsing entirely.
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
// ─────────────────────────────────────────────────────────────────────────

export function parseAdjectives(message) {
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
// Resolve "under recovery" -> a node in the routing index or tree children.
// Temporal parsing handled separately in parseTemporalScope.
// ─────────────────────────────────────────────────────────────────────────

export async function parsePreposition(message, rootId) {
  const lower = message.toLowerCase();
  const result = { targetOverride: null, preposition: null, raw: null };
  let found = false;

  const spatialMatch = PREPOSITION_PATTERN.exec(lower);
  if (spatialMatch && rootId) {
    const targetName = spatialMatch[1].trim();
    try {
      const { getIndexForRoot } = await import("./routingIndex.js");
      const index = getIndexForRoot(rootId);
      if (index) {
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
// TEMPORAL SCOPE PARSER
// ─────────────────────────────────────────────────────────────────────────

export function parseTemporalScope(message) {
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
