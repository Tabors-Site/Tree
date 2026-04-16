/**
 * Pending-plan store.
 *
 * When a mode responds with a structured plan block, we stash it keyed by
 * visitorId. The next message is checked: if it's an affirmative and a
 * plan is still warm, the orchestrator expands it into N sequential turns,
 * each running as its own chat. If the user says anything else, the plan
 * is cleared — they moved on.
 *
 * Structured block shape (modes opt in by emitting this at the end):
 *
 *     [[PLAN]]
 *     high:1: Remove unused express dependency from package.json
 *     high:2: Add userId query parameter to the 6 API endpoints in server.js
 *     high:3: Change fs.writeFileSync to async fs.writeFile in saveData
 *     [[/PLAN]]
 *
 * Each line is a single actionable item. The block is stripped from the
 * visible response before the user sees it (keeps the report clean).
 *
 * This is the list-expansion primitive the grammar pipeline lacked: a
 * review produces a plan, an affirmative executes it, and the orchestrator
 * walks the items as a sequence. Same philosophy as conjunctions-as-
 * pipelines, but the "and" is implicit in the plan instead of the sentence.
 */

import log from "../../seed/log.js";

// visitorId -> { items: string[], createdAt: number, mode: string }
const _pendingPlans = new Map();

// How long a plan stays warm waiting for approval. A user who types "fix it"
// an hour later shouldn't have it expand — that plan is stale. 10 minutes
// gives enough room for coffee + thought without opening a footgun.
const PLAN_TTL_MS = 10 * 60 * 1000;

// Block markers. Loose regex to tolerate whitespace / case / fence drift.
const PLAN_BLOCK = /\[\[\s*plan\s*\]\]([\s\S]*?)\[\[\s*\/\s*plan\s*\]\]/i;

// Affirmatives that mean "run the plan". Conservative list — we don't want
// a casual "ok" mid-conversation to trigger a batch. These are all short
// clear commits. Verbs that also appear in plan items (like "fix") are
// matched as STANDALONE confirmations only when they match anchored.
const AFFIRMATIVE = new RegExp(
  "^\\s*(" +
    "yes|yea|yeah|yep|yup|" +
    "ok|okay|sure|" +
    "do\\s+it|do\\s+them|do\\s+them\\s+all|do\\s+all|do\\s+everything|" +
    "fix\\s+it|fix\\s+them|fix\\s+them\\s+all|fix\\s+all|fix\\s+everything|" +
    "apply|apply\\s+it|apply\\s+them|apply\\s+all|apply\\s+them\\s+all|apply\\s+everything|" +
    "go|go\\s+ahead|proceed|execute|run\\s+it|run\\s+them|" +
    "1\\s*,\\s*2\\s*,\\s*3|all\\s+of\\s+them|everything" +
  ")[\\s!.]*$",
  "i",
);

/**
 * Parse a response string for a plan block. Returns { items, cleaned } where
 * `items` is the extracted list (one string per line) and `cleaned` is the
 * response with the block stripped so the user never sees the raw marker.
 *
 * An empty items array means no block — caller should pass the response
 * through unchanged and not stash anything.
 */
export function parsePlan(responseText) {
  if (typeof responseText !== "string" || !responseText) {
    return { items: [], cleaned: responseText };
  }
  const match = responseText.match(PLAN_BLOCK);
  if (!match) return { items: [], cleaned: responseText };

  const body = match[1] || "";
  const items = body
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    // Strip leading list markers the model commonly prepends: "1.", "-", "*"
    .map((line) => line.replace(/^(?:[-*]|\d+[.)])\s*/, ""));

  const cleaned = responseText.replace(PLAN_BLOCK, "").trimEnd();
  return { items, cleaned };
}

/**
 * Stash a plan for a visitor. Overwrites any previous plan — the newest
 * one wins. Also clears stale plans as a side effect.
 */
export function setPendingPlan(visitorId, items, mode) {
  if (!visitorId || !Array.isArray(items) || items.length === 0) return;
  _pendingPlans.set(visitorId, {
    items: items.slice(0, 20), // hard cap — nobody batches more than 20 fixes
    createdAt: Date.now(),
    mode: mode || null,
  });
  log.debug("PendingPlan", `Stashed ${items.length} items for ${visitorId} (mode=${mode || "?"})`);
}

/**
 * Read the pending plan for a visitor if one exists and hasn't expired.
 * Does not clear the plan — caller must call clearPendingPlan after
 * consuming it.
 */
export function getPendingPlan(visitorId) {
  if (!visitorId) return null;
  const entry = _pendingPlans.get(visitorId);
  if (!entry) return null;
  if (Date.now() - entry.createdAt > PLAN_TTL_MS) {
    _pendingPlans.delete(visitorId);
    return null;
  }
  return entry;
}

export function clearPendingPlan(visitorId) {
  if (!visitorId) return;
  _pendingPlans.delete(visitorId);
}

/**
 * Affirmative test. Returns true if the message is a clear "yes, do it"
 * that should trigger plan expansion. Short-circuits expensive classify.
 */
export function isAffirmative(message) {
  if (typeof message !== "string") return false;
  const trimmed = message.trim();
  if (!trimmed) return false;
  if (trimmed.length > 60) return false; // too long to be a pure affirmative
  return AFFIRMATIVE.test(trimmed);
}
