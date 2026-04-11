export default {
  name: "book",
  version: "1.0.1",
  builtFor: "TreeOS",
  description:
    "Trees store knowledge as scattered notes across dozens or hundreds of nodes. Reading " +
    "a tree means navigating branch by branch, node by node. That works for the AI and " +
    "for the person who built it. It does not work when you need to hand someone a single " +
    "document that contains everything from a branch. Book compiles a subtree's notes into " +
    "one coherent, readable output. " +
    "\n\n" +
    "Starting from any node, Book walks the entire subtree depth-first, collecting notes " +
    "from every descendant. The result preserves the tree's hierarchy: each node becomes " +
    "a section, children become subsections, notes become content blocks within their " +
    "section. The structure of the tree becomes the structure of the document. " +
    "\n\n" +
    "Filters control what appears in the output. latestVersionOnly shows only the most " +
    "recent version of each note. lastNoteOnly shows only the last note per node. " +
    "leafNotesOnly includes notes only from leaf nodes, skipping intermediate branches. " +
    "filesOnly and textOnly filter by content type. Status filters (active, completed) " +
    "control which nodes are included based on their current status. Nodes that fail the " +
    "status filter are excluded unless they have children that pass. " +
    "\n\n" +
    "Books can be shared. The generate endpoint creates a persistent Book record with a " +
    "unique share ID and a hash of the filter settings. If someone generates the same " +
    "book with the same settings, the existing share ID is reused rather than creating a " +
    "duplicate. The share URL is publicly accessible without authentication. Anyone with " +
    "the link sees the compiled output. " +
    "\n\n" +
    "If html-rendering is installed, both the private book view and the shared link render " +
    "as styled HTML pages with a table of contents, filter controls, and section navigation. " +
    "Without html-rendering, the API returns raw JSON with the full nested structure.",

  needs: {
    models: ["Node", "Note"],
  },

  optional: {
    extensions: ["html-rendering", "treeos-base"],
  },

  provides: {
    models: {
      Book: "./model.js",
    },
    routes: "./routes.js",
    tools: false,
    jobs: false,
    orchestrator: false,
    energyActions: {},
    sessionTypes: {},
    cli: [
      { command: "book", scope: ["tree"], description: "View compiled notes for current tree", method: "GET", endpoint: "/root/:rootId/book" },
    ],
  },
};
