// TreeOS Seed . AGPL-3.0 . https://treeos.ai
/**
 * Get LLM assignments for a node from metadata.
 * Core field: node.llmDefault (the tree-wide default).
 * Extension slots: metadata.llm.slots (registered by extensions).
 */
export function getLlmAssignments(node) {
  if (!node) return { default: null };
  const meta = node.metadata instanceof Map ? node.metadata.get("llm") : node.metadata?.llm;
  const slots = meta?.slots || {};
  return { default: node.llmDefault || null, ...slots };
}

/**
 * Get LLM assignments for a user from metadata.
 * Core field: user.llmDefault (the user-wide default).
 * Extension slots: metadata.userLlm.assignments (registered by extensions).
 */
export function getUserLlmAssignments(user) {
  if (!user) return { main: null };
  const meta = user.metadata instanceof Map ? user.metadata.get("userLlm") : user.metadata?.userLlm;
  const assignments = meta?.assignments || {};
  return { main: user.llmDefault || null, ...assignments };
}
