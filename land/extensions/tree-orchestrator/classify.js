// TreeOS Tree Orchestrator . classify.js
//
// Classification orchestration. Takes a message and returns a routing
// decision: which extension, which mode, which target node. Wraps the
// routing index, per-node mode overrides, and tree-walking fallbacks.
//
// Grammar tables (regex constants) live in ./grammar.js.
// Pure parsers (tense, pronouns, conditionals, etc.) live in ./parsers.js.
// This file keeps only the DB-touching, extension-registry-touching glue.

import Node from "../../seed/models/node.js";
import { resolveMode } from "../../seed/modes/registry.js";
import { buildCurrentPath as _buildCurrentPath } from "./state.js";
import { SENTENCE_START_IMPERATIVE } from "./grammar.js";
import { getModesOwnedBy } from "../../seed/tree/extensionScope.js";

// Re-export grammar tables and parsers so existing imports from classify.js
// keep working. Consumers that want a narrower surface can import from
// grammar.js or parsers.js directly.
export * from "./grammar.js";
export * from "./parsers.js";

// ─────────────────────────────────────────────────────────────────────────
// MODE UPGRADE FOR COMPOUND IMPERATIVES
//
// After the routing index picks an extension, we sometimes want to
// upgrade its default mode (usually a -log / -tell receiver) to the
// extension's architect mode (-plan) when the message structure
// says "this is a multi-part build / design request", not a single
// log entry. The signal is purely structural — imperative verb +
// a list of 2+ named parts — so it generalises across any
// extension with a plan mode, no domain vocab involved.
//
// Triggers the upgrade ONLY when ALL of:
//   1. Message starts with a build-class imperative verb (reuses
//      SENTENCE_START_IMPERATIVE from grammar.js).
//   2. Message contains >=2 list items after a connector ("with",
//      "that has", "including", "plus", colon, or bare commas).
//   3. The extension owns a -plan mode distinct from the mode the
//      router picked. If it already picked -plan, nothing changes.
//
// No keywords (frontend/backend/api/etc) are hardcoded. Works for
// code-workspace, book-workspace, or anything else that follows
// the suffix convention.
// ─────────────────────────────────────────────────────────────────────────

function _isBuildImperative(message) {
  // SENTENCE_START_IMPERATIVE covers make / build / create / write /
  // scaffold / generate / design / implement / … at the start.
  return SENTENCE_START_IMPERATIVE.test(message || "");
}

function _listItemCount(message) {
  if (typeof message !== "string" || !message) return 0;
  // Prefer the connector-anchored tail: "… with X, Y, and Z" or
  // "… including X, Y, Z" — only count items AFTER that connector so
  // prose commas ("Hey, can you, like, help?") don't count.
  const anchor = /(?:\bwith\b|\bthat has\b|\bincluding\b|\bplus\b|:)/i;
  const m = message.match(anchor);
  const tail = m ? message.slice(m.index + m[0].length) : message;
  // Split on commas AND " and " / " & " joiners, keep non-empty items.
  const parts = tail
    .split(/,|\band\b|&/i)
    .map(s => s.trim())
    .filter(s => s.length > 0 && s.length < 80);
  // Single-word items or very short phrases count — this is list
  // STRUCTURE, not semantic richness.
  return parts.length;
}

function _upgradeModeForCompoundImperative(message, currentMode, extName) {
  try {
    if (!currentMode || !extName) return null;
    // Already an architect / plan mode? Nothing to upgrade.
    if (/-plan$|-architect$/.test(currentMode)) return null;
    if (!_isBuildImperative(message)) return null;
    // Need a connector anchor for the list count to be meaningful.
    // Without it, we fall back to bare-comma counting and require ≥3
    // items so the bar for ambiguous prose stays high.
    const hasAnchor = /(?:\bwith\b|\bthat has\b|\bincluding\b|\bplus\b|:)/i.test(message);
    const items = _listItemCount(message);
    const threshold = hasAnchor ? 2 : 3;
    if (items < threshold) return null;

    // Does the extension actually own a -plan mode? If not, keep
    // the original — we never invent a mode the tree doesn't have.
    const modes = getModesOwnedBy(extName);
    const planMode =
      modes.find(m => m.endsWith("-plan")) ||
      modes.find(m => m.endsWith("-architect")) ||
      null;
    if (!planMode || planMode === currentMode) return null;

    return planMode;
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────
// LOCAL CLASSIFY
//
// Zero LLM calls. Two jobs:
//   1. Extension routing: if a mode override is set at the current node AND
//      the message matches that extension's classifierHints, route directly
//      to the extension mode.
//   2. Intent classification: anything the routing index or tree walk
//      doesn't claim falls through to "converse". Position determines
//      reality; the AI at this position has the tools it needs.
// ─────────────────────────────────────────────────────────────────────────

export async function localClassify(message, currentNodeId, rootId, userId = null) {
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
        // Mode upgrade for compound / multi-part imperatives.
        // The routing index returns the extension's node-default mode
        // (often the -log / -tell receiver). When the message is both
        // IMPERATIVE and LIST-STRUCTURED — meaning the user is asking
        // to build / create / plan something with multiple named
        // parts joined by commas, "and", "with" — the architect
        // (-plan / -architect suffix) fits better than the default
        // receiver. This is a purely structural signal — no domain
        // vocabulary, no hardcoded keywords — so it generalises
        // across every code-* / book-* / any-* workspace extension.
        const upgraded = _upgradeModeForCompoundImperative(
          message,
          scored.winner.mode,
          scored.winner.extName,
        );
        return {
          intent: "extension",
          mode: upgraded || scored.winner.mode,
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
//
// Extract the behavioral constraint from the source type.
// Four commands constrain what happens at any position:
//
//   query  . tools: read-only   response: full      writes: blocked
//   place  . tools: all         response: minimal   writes: allowed
//   chat   . tools: all         response: full      writes: allowed
//   be     . tools: all         response: guided    writes: allowed
// ─────────────────────────────────────────────────────────────────────────

export function extractBehavioral(sourceType) {
  if (!sourceType || typeof sourceType !== "string") return "chat"; // default for null/missing callers (background, room-agent, cron)
  if (sourceType === "query" || sourceType.endsWith("-query")) return "query";
  if (sourceType === "place" || sourceType.endsWith("-place")) return "place";
  if (sourceType === "be" || sourceType.endsWith("-be")) return "be";
  return "chat"; // default
}

// ─────────────────────────────────────────────────────────────────────────
// MODE RESOLUTION HELPER
// ─────────────────────────────────────────────────────────────────────────

// Resolve mode key for an intent at a node. Checks per-node overrides.
// Falls back to default tree:{intent} mode.
export async function resolveModeForNode(intent, nodeId) {
  if (!nodeId) return `tree:${intent}`;
  try {
    const node = await Node.findById(nodeId).select("metadata").lean();
    return resolveMode(intent, "tree", node?.metadata);
  } catch {
    return `tree:${intent}`;
  }
}
