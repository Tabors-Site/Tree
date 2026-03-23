/**
 * Reconstruct llmAssignments from a lean node result.
 * Lean queries don't have virtuals, so we read from llmDefault + metadata.llm.slots.
 */
export function getLlmAssignments(node) {
  if (!node) return { default: null };
  // If virtuals are present (non-lean), use them
  if (node.llmAssignments && typeof node.llmAssignments === "object" && !node.llmDefault) {
    return node.llmAssignments;
  }
  const meta = node.metadata instanceof Map ? node.metadata.get("llm") : node.metadata?.llm;
  const slots = meta?.slots || {};
  return { default: node.llmDefault || null, ...slots };
}

/**
 * Reconstruct user llmAssignments from lean result.
 */
export function getUserLlmAssignments(user) {
  if (!user) return { main: null, rawIdea: null };
  if (user.llmAssignments && typeof user.llmAssignments === "object" && user.llmAssignments.main !== undefined) {
    return user.llmAssignments;
  }
  const meta = user.metadata instanceof Map ? user.metadata.get("userLlm") : user.metadata?.userLlm;
  return meta?.assignments || { main: null, rawIdea: null };
}
