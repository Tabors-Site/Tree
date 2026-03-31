export default {
  name: "rings",
  version: "1.0.0",
  builtFor: "TreeOS",
  description:
    "The tree remembers every age it has been. Once per month, rings takes a cross-section " +
    "of the entire tree: structure, vitals, and an AI-generated character portrait. Monthly " +
    "rings keep full detail for two years. Then they compress into annual rings. The annual " +
    "ring absorbs twelve monthlies into one denser summary. Annual rings persist forever.\n\n" +
    "Each ring captures what every installed extension knows: evolution metrics, thesis " +
    "coherence, contradiction resolution, codebook vocabulary, prune history, phase ratios, " +
    "cascade signal counts, and topic clusters. One LLM call synthesizes a character portrait " +
    "and a one-sentence essence. The AI at any position knows the tree's age, its current " +
    "character, and what came before.\n\n" +
    "The further back, the less detail, but the character persists. Like tree rings. Like " +
    "human memory. Yesterday is vivid. Last month is a summary. Five years ago is a feeling " +
    "and a few key moments. But each period shaped who the tree is.",

  needs: {
    services: ["hooks", "llm", "metadata"],
    models: ["Node", "Note"],
  },

  optional: {
    extensions: [
      "evolution", "purpose", "contradiction", "codebook",
      "prune", "remember", "changelog", "phase",
      "inverse-tree", "embed", "explore", "breath",
    ],
  },

  provides: {
    tools: true,
    routes: "./routes.js",
    llmSlots: ["rings"],
    cli: [
      { command: "rings", scope: ["tree"], description: "Show tree ring history (annual + recent monthly)", method: "GET", endpoint: "/root/:rootId/rings" },
      { command: "rings current", scope: ["tree"], description: "Current month character assembled from live data", method: "GET", endpoint: "/root/:rootId/rings/current" },
    ],
  },
};
