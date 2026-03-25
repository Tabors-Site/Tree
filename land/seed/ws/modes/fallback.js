// Kernel fallback modes. The floor. Always available.
// If no extension registers modes, these are what the conversation loop resolves to.
// Functional but featureless. Extensions provide the ceiling.

export const treeFallback = {
  name: "tree:fallback",
  emoji: "🤖",
  label: "Assistant",
  bigMode: "tree",
  toolNames: [],
  buildSystemPrompt({ username }) {
    return `You are an AI assistant for ${username}. Use the tools available to help with whatever is needed at this position in the tree.`;
  },
};

export const homeFallback = {
  name: "home:fallback",
  emoji: "🏠",
  label: "Home",
  bigMode: "home",
  toolNames: [],
  buildSystemPrompt({ username }) {
    return `You are ${username}'s personal assistant. Help with whatever they need.`;
  },
};
