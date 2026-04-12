export default {
  name: "code-forge",
  version: "0.1.0",
  builtFor: "TreeOS",
  scope: "confined",
  description:
    "Trees author TreeOS extensions from inside themselves. Forge scaffolds a fresh extension " +
    "directory under land/extensions/<name>/, lets the AI write manifest.js, index.js, tools, " +
    "and tests via tool calls, runs the tests with Node's built-in runner, validates the " +
    "package the same way Horizon will, and either installs the result on the host land " +
    "(restart required) or dry-run-publishes to a Horizon registry. " +
    "\n\n" +
    "This is the showcase of the suite. The user says 'scaffold me an extension that counts " +
    "vowels in note content, write a test, install it, and dry-run publish' and forge-ship " +
    "mode drives the whole sequence end to end. " +
    "\n\n" +
    "Confined scope: inactive everywhere until an operator runs `ext-allow code-forge` at a " +
    "tree root. Once allowed at a root, spatial scoping propagates routing access to every " +
    "node below it. Forge needs confined scope because it writes into land/extensions/ and " +
    "can publish to Horizon.",

  territory: "building extensions, scaffolding tools, shipping code, publishing to horizon",

  // Routing vocabulary. The tree-orchestrator picks this up via the loader's
  // getVocabularyForExtension() and weights matches in the routing index.
  // Locality bonus kicks in once the user navigates into a forge node.
  vocabulary: {
    nouns: [
      /\b(extension|extensions|manifest|tool|tools|hook|hooks|mode|modes|slot|slots|route|routes)\b/i,
      /\b(horizon|registry|package|scaffold|skeleton|template|forge)\b/i,
      /\b(index\.js|manifest\.js|package\.json|readme|vitest|test\.js)\b/i,
    ],
    verbs: [
      /\b(scaffold|forge|ship|publish|register|install|bootstrap|generate)\b/i,
      /\b(write\s+an?\s+(?:new\s+)?extension|build\s+an?\s+(?:new\s+)?extension|author\s+an?\s+extension|make\s+an?\s+extension)\b/i,
      /\b(dry[- ]run|validate|lint|check)\s+(?:the\s+)?(?:manifest|extension|package|publish)\b/i,
    ],
    adjectives: [
      /\b(confined|base|standalone|draft|published|ready|validated)\b/i,
    ],
  },

  classifierHints: [
    /\b(scaffold|forge|publish)\s+(?:me\s+)?an?\s+(?:treeos\s+)?extension\b/i,
    /\b(new|fresh)\s+extension\b/i,
    /\b(ship|install|register)\s+(?:this|the|my)\s+extension\b/i,
  ],

  needs: {
    services: ["hooks", "metadata", "tree"],
    models: ["Node", "Note"],
    extensions: ["code-workspace"],
  },

  optional: {
    services: ["llm"],
    extensions: ["codebase", "approve"],
  },

  provides: {
    models: {},
    routes: false,
    tools: true,
    jobs: false,
    orchestrator: false,
    energyActions: {},
    sessionTypes: {},
    env: [],
    cli: [],

    hooks: {
      fires: [],
      listens: ["enrichContext"],
    },

    modes: [
      {
        key: "tree:forge-ship",
        handler: "./modes/forge-ship.js",
        assignmentSlot: "forge-ship",
      },
    ],
  },
};
