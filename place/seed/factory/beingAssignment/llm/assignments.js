// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// The rules for which voice this moment uses. I read assignment
// data off space and being qualities and return it in a
// normalized shape; llmClient.js's resolveLlmConnection walks
// both ancestor chains and applies a four-layer policy on top to
// pick the voice for any given moment.
//
// Security: qualities is untrusted (extensions write into it). I
// sanitize slot names to prevent prototype pollution and type
// confusion before any lookup.
//
// Assignment data carries two kinds of fields:
//
//   Connection fields (which LLM):
//     `default` / `main`  — the primary connection
//     `[slotName]`        — role-specific overrides (e.g. "reflect",
//                           "scout")
//
//   Authority flags (who decides):
//     `enforced`   lock IN this assignment for descendants. Space
//                  enforcement wins over being enforcement when both
//                  apply; both override being.preferOwn.
//     `locked`     lock OUT all LLM usage for descendants. Mirrors
//                  space.llmDefault === "none"; sovereign — stops
//                  the resolver entirely.
//     `preferOwn`  (being only) invert the chain so the being's own
//                  LLM ranks above the position's.

const DANGEROUS_KEYS = new Set([
  "__proto__",
  "constructor",
  "prototype",
  "hasOwnProperty",
  "toString",
  "valueOf",
]);
const MAX_SLOTS = 50;

function sanitizeSlots(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  // Handle Mongoose Maps that weren't converted to plain objects
  const entries = raw instanceof Map ? [...raw.entries()] : Object.entries(raw);
  const clean = {};
  let count = 0;
  for (const [key, value] of entries) {
    if (count >= MAX_SLOTS) break;
    if (typeof key !== "string" || DANGEROUS_KEYS.has(key)) continue;
    if (value === null || (typeof value === "string" && value.length <= 100)) {
      clean[key] = value;
      count++;
    }
  }
  return clean;
}

function asBool(v) {
  return v === true;
}

/**
 * Get LLM assignments for a space.
 *
 * Reads:
 *   - `space.llmDefault` (kernel field; "none" sentinel = lockdown)
 *   - `space.qualities.llm.slots` (role-specific overrides at this space)
 *   - `space.qualities.llm.enforced` (lock IN for descendants)
 *
 * Returns `{ default, [slot]: connId, enforced }`.
 *
 * Symmetric with `getBeingLlmAssignments`. Both feed
 * `resolveLlmConnection` in llmClient.js.
 */
export function getSpaceLlmAssignments(space) {
  if (!space) return { default: null, enforced: false };

  const meta =
    space.qualities instanceof Map
      ? space.qualities.get("llm")
      : space.qualities?.llm;
  const slots = sanitizeSlots(meta?.slots);

  const result = { ...slots };
  result.default =
    typeof space.llmDefault === "string" && space.llmDefault.length <= 100
      ? space.llmDefault
      : null;
  result.enforced = asBool(meta?.enforced);

  return result;
}

/**
 * Get LLM assignments for a being.
 *
 * Reads:
 *   - `being.llmDefault` (kernel field; the being's personal default)
 *   - `being.qualities.beingLlm.slots` (role-specific overrides for this being)
 *   - `being.qualities.beingLlm.enforced` (lock IN for descendants in being-tree)
 *   - `being.qualities.beingLlm.locked`   (lockdown for descendants in being-tree)
 *   - `being.qualities.beingLlm.preferOwn` (invert resolution chain order)
 *
 * Returns `{ main, [slot]: connId, enforced, locked, preferOwn }`.
 */
export function getBeingLlmAssignments(being) {
  if (!being)
    return { main: null, enforced: false, locked: false, preferOwn: false };

  const meta =
    being.qualities instanceof Map
      ? being.qualities.get("beingLlm")
      : being.qualities?.beingLlm;
  const slots = sanitizeSlots(meta?.slots);

  const result = { ...slots };
  result.main =
    typeof being.llmDefault === "string" && being.llmDefault.length <= 100
      ? being.llmDefault
      : null;
  result.enforced = asBool(meta?.enforced);
  result.locked = asBool(meta?.locked);
  result.preferOwn = asBool(meta?.preferOwn);

  return result;
}
