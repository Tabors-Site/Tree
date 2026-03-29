export default {
  name: "treeos",
  version: "1.0.0",
  builtFor: "TreeOS",
  description:
    "The reference implementation of how the AI thinks inside a tree. Ten modes, thirty-plus " +
    "MCP tools, and a navigation hook that keeps the frontend synchronized with every operation " +
    "the AI performs. This is the foundation that every tree conversation builds on. " +
    "\n\n" +
    "Eight tree modes define what the AI can do at each position. Navigate is a silent engine " +
    "that resolves natural language references to specific nodes using keyword search and " +
    "tree traversal. Librarian walks branches, reads notes, and produces execution plans for " +
    "placement or gathers context for queries. Structure creates, moves, and deletes nodes " +
    "with strict naming conventions and type assignment. Edit modifies node fields: names, " +
    "types, statuses, values, schedules, prestige. Notes reads and writes note content with " +
    "full line-range editing, transfers, and deduplication checking. Respond synthesizes " +
    "everything that happened in a turn into a natural language answer. Get Context is a " +
    "silent reader that fetches node data with configurable scope. Be mode is focused, " +
    "present, guided work on one step at a time, walking the execution frontier of a tree " +
    "and sitting with the user inside each task until it completes. " +
    "\n\n" +
    "Two home modes handle the space outside of trees. Home Default is a warm, conversational " +
    "landing assistant that loads tree awareness silently and helps the user decide what to " +
    "work on. Home Reflect lets the user review notes, contributions, tags, and raw ideas " +
    "across all their trees for pattern recognition and cross-tree insight. " +
    "\n\n" +
    "The tools are the full MCP surface for tree operations. Reading: get-tree, get-node, " +
    "get-node-notes, get-node-contributions, get-tree-context, navigate-tree, search, " +
    "get-active-leaf-execution-frontier. Writing: create-node, create-tree, create-node-branch, " +
    "create-node-version-note, edit-node-note, edit-node-name, edit-node-type, " +
    "edit-node-or-branch-status, delete-node-branch, delete-node-note, transfer-node-note, " +
    "update-node-branch-parent-relationship. User queries: notes by user, search, tags, " +
    "contributions, raw ideas, root nodes. Understanding: list, create, process. " +
    "\n\n" +
    "The navigation hook fires afterToolCall and emits a WebSocket navigate event that " +
    "synchronizes the HTML frontend with the AI's actions. When the AI creates a node, the " +
    "browser navigates to it. When it writes a note, the browser shows the notes view. When " +
    "it fetches a tree, the browser renders it. Every tool maps to a URL pattern. Share " +
    "tokens are resolved per user so the navigation works for both authenticated sessions " +
    "and public share links. " +
    "\n\n" +
    "An intent detection system scores messages against signal dictionaries for structure, " +
    "edit, reflect, navigate, and be mode. Phrase matches score high, word matches score low, " +
    "negation guards prevent false positives. The system routes to the correct mode without " +
    "an LLM call for unambiguous requests. " +
    "\n\n" +
    "Every mode and tool is replaceable. Extensions can register custom modes that override " +
    "the defaults at any node via per-node mode metadata. The kernel resolves modes at " +
    "runtime. Remove this extension and the tree has no AI behavior. Install it and the " +
    "tree thinks, navigates, structures, edits, reads, writes, and responds.",

  needs: {
    services: ["websocket", "llm"],
    models: ["Node", "User", "Note", "Contribution"],
  },

  optional: {
    extensions: ["html-rendering"],
  },

  provides: {
    routes: false,
    tools: true,
    modes: true,
    jobs: false,
    orchestrator: false,
    energyActions: {},
    sessionTypes: {},
    cli: [],
  },
};
