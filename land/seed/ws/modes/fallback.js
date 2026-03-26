// TreeOS Seed . AGPL-3.0 . https://treeos.ai
// Kernel fallback modes. The floor. Always available.
// If no extension registers modes, these are what the conversation loop resolves to.
// Functional but featureless. Extensions provide the ceiling.

// Sanitize username for prompt injection safety. Strip characters that could be
// interpreted as instructions or delimiters by the LLM.
function safeUsername(username) {
  if (!username || typeof username !== "string") return "User";
  // Keep only alphanumeric, hyphens, underscores. Truncate to 32 chars.
  return username.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 32) || "User";
}

export const treeFallback = {
  name: "tree:fallback",
  emoji: "🤖",
  label: "Assistant",
  bigMode: "tree",
  toolNames: [],
  buildSystemPrompt({ username }) {
    return `You are an AI assistant for ${safeUsername(username)}. Use the tools available to help with whatever is needed at this position in the tree.`;
  },
};

export const homeFallback = {
  name: "home:fallback",
  emoji: "🏠",
  label: "Home",
  bigMode: "home",
  toolNames: [],
  buildSystemPrompt({ username }) {
    return `You are ${safeUsername(username)}'s personal assistant. Help with whatever they need.`;
  },
};
