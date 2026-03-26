// TreeOS Seed . AGPL-3.0 . https://treeos.ai
/**
 * LLM assignment resolution.
 *
 * Reads assignment slots from node/user metadata and returns a flat
 * { slotName: connectionId } map. The resolution chain in conversation.js
 * uses these to pick which LLM connection handles each mode.
 *
 * Security: metadata is untrusted (extensions write to it). Slots are
 * sanitized to prevent prototype pollution and type confusion.
 */

/**
 * Sanitize slot entries from metadata. Only string values (connection IDs)
 * and null are valid. Reject __proto__, constructor, prototype keys.
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

/**
 * Get LLM assignments for a tree root node.
 * Core field: node.llmDefault (the tree-wide default connection).
 * Extension slots: metadata.llm.slots (registered by extensions).
 *
 * Returns { default: connectionId|null, [slotName]: connectionId|null }
 */
export function getLlmAssignments(node) {
  if (!node) return { default: null };

  const meta = node.metadata instanceof Map ? node.metadata.get("llm") : node.metadata?.llm;
  const slots = sanitizeSlots(meta?.slots);

  // Core default is authoritative. Metadata slots cannot override it.
  const result = { ...slots };
  result.default = (typeof node.llmDefault === "string" && node.llmDefault.length <= 100)
    ? node.llmDefault
    : null;

  return result;
}

/**
 * Get LLM assignments for a user.
 * Core field: user.llmDefault (the user-wide default connection).
 * Extension slots: metadata.userLlm.assignments (registered by extensions).
 *
 * Returns { main: connectionId|null, [slotName]: connectionId|null }
 */
export function getUserLlmAssignments(user) {
  if (!user) return { main: null };

  const meta = user.metadata instanceof Map ? user.metadata.get("userLlm") : user.metadata?.userLlm;
  const assignments = sanitizeSlots(meta?.assignments);

  // Core main is authoritative. Metadata assignments cannot override it.
  const result = { ...assignments };
  result.main = (typeof user.llmDefault === "string" && user.llmDefault.length <= 100)
    ? user.llmDefault
    : null;

  return result;
}
