export default {
  name: "treeos-intelligence",
  version: "1.0.0",
  type: "bundle",
  builtFor: "seed",
  description:
    "Self-awareness. Fourteen extensions that teach the tree to know itself. " +
    "\n\n" +
    "Tree-compress monitors density and consolidates structure. Contradiction detects " +
    "conflicting truths across branches. Inverse-tree builds a model of the user from " +
    "interaction patterns. Evolution tracks which organizational patterns survive and " +
    "which get reverted. Intent synthesizes all signals into autonomous actions. " +
    "\n\n" +
    "Embed provides semantic vectors. Scout triangulates across the tree with five " +
    "parallel search strategies. Explore navigates downward through branches like " +
    "Claude Code navigates a codebase. Trace follows a single concept chronologically " +
    "through every node it touched. Boundary detects where branches blur into each other. " +
    "Competence tracks which queries found answers and which found silence. Reflect notices " +
    "how the conversation is going and adjusts the AI's approach. Evolve watches what users " +
    "do that no extension handles, proposes existing extensions or generates specs for new ones. " +
    "Rings takes monthly cross-sections of the entire tree and compresses them into annual " +
    "character portraits. The further back, the less detail, but the character persists. " +
    "\n\n" +
    "Without this bundle, the tree holds data. With it, the tree understands its own data. " +
    "\n\n" +
    "Install: treeos ext install treeos-intelligence",

  includes: [
    "tree-compress", "contradiction", "inverse-tree", "evolution", "intent", "embed",
    "scout", "explore", "trace", "boundary", "competence", "reflect", "evolve", "rings",
  ],

  needs: {
    extensions: [
      "tree-compress", "contradiction", "inverse-tree", "evolution", "intent", "embed",
      "scout", "explore", "trace", "boundary", "competence", "reflect", "evolve", "rings",
    ],
  },

  optional: {},

  provides: {
    models: {},
    routes: false,
    tools: false,
    jobs: false,
    orchestrator: false,
    energyActions: {},
    sessionTypes: {},
  },
};
