// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
/**
 * LLM assignment resolution.
 *
 * Reads LLM assignment data from node/being metadata and returns a
 * normalized shape. `resolveLlmConnection` in llmClient.js walks the
 * node ancestor chain AND the being ancestor chain and applies a
 * four-layer resolution policy. See that function's doc comment for the
 * full chain.
 *
 * Security: metadata is untrusted (extensions write to it). Slots are
 * sanitized to prevent prototype pollution and type confusion.
 *
 * Assignment data carries two kinds of fields:
 *
 *   Connection fields (which LLM):
 *     - `default` / `main` — the primary connection
 *     - `[slotName]`       — role-specific overrides (e.g. "reflect", "scout")
 *
 *   Authority flags (who decides):
 *     - `enforced`  — lock IN this assignment for descendants
 *                     (overrides being.preferOwn; node enforcement
 *                     wins over being enforcement when both apply)
 *     - `locked`    — lock OUT all LLM usage for descendants
 *                     (mirrors node.llmDefault === "none"; sovereign,
 *                     stops the resolver entirely → null)
 *     - `preferOwn` — (being only) invert the chain so the being's
 *                     own LLM ranks above the position's
 */

const DANGEROUS_KEYS = new Set(["__proto__", "constructor", "prototype", "hasOwnProperty", "toString", "valueOf"]);
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

function asBool(v) { return v === true; }

/**
 * Get LLM assignments for a node.
 *
 * Reads:
 *   - `node.llmDefault` (kernel field; "none" sentinel = lockdown)
 *   - `node.metadata.llm.slots` (role-specific overrides at this node)
 *   - `node.metadata.llm.enforced` (lock IN for descendants)
 *
 * Returns `{ default, [slot]: connId, enforced }`.
 *
 * Symmetric with `getBeingLlmAssignments`. Both feed
 * `resolveLlmConnection` in llmClient.js.
 */
export function getNodeLlmAssignments(node) {
  if (!node) return { default: null, enforced: false };

  const meta = node.metadata instanceof Map ? node.metadata.get("llm") : node.metadata?.llm;
  const slots = sanitizeSlots(meta?.slots);

  const result = { ...slots };
  result.default = (typeof node.llmDefault === "string" && node.llmDefault.length <= 100)
    ? node.llmDefault
    : null;
  result.enforced = asBool(meta?.enforced);

  return result;
}

/**
 * Get LLM assignments for a being.
 *
 * Reads:
 *   - `being.llmDefault` (kernel field; the being's personal default)
 *   - `being.metadata.userLlm.slots` (role-specific overrides for this being)
 *   - `being.metadata.userLlm.enforced` (lock IN for descendants in being-tree)
 *   - `being.metadata.userLlm.locked`   (lockdown for descendants in being-tree)
 *   - `being.metadata.userLlm.preferOwn` (invert resolution chain order)
 *
 * Returns `{ main, [slot]: connId, enforced, locked, preferOwn }`.
 */
export function getBeingLlmAssignments(being) {
  if (!being) return { main: null, enforced: false, locked: false, preferOwn: false };

  const meta = being.metadata instanceof Map ? being.metadata.get("userLlm") : being.metadata?.userLlm;
  const slots = sanitizeSlots(meta?.slots);

  const result = { ...slots };
  result.main = (typeof being.llmDefault === "string" && being.llmDefault.length <= 100)
    ? being.llmDefault
    : null;
  result.enforced  = asBool(meta?.enforced);
  result.locked    = asBool(meta?.locked);
  result.preferOwn = asBool(meta?.preferOwn);

  return result;
}
