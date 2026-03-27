export default {
  name: "tree-orchestrator",
  version: "1.0.0",
  builtFor: "TreeOS",
  description:
    "The brain that turns a sentence into tree operations. Every message that enters a tree " +
    "passes through this orchestrator. It does not talk to the user. It classifies, plans, " +
    "executes, and responds. The user types a sentence. The orchestrator decides what it means. " +
    "\n\n" +
    "The classifier is an LLM call that reads the message, the tree summary, and recent " +
    "conversation memory. It returns an intent: place (store information), query (read and " +
    "answer), destructive (delete, move, merge, reorganize), defer (save for later), or " +
    "no_fit (unrelated to this tree). Each intent routes to a different execution path. " +
    "\n\n" +
    "Place and query go through the librarian. The librarian navigates the tree with search, " +
    "reads node context, and for placement builds a multi-step execution plan: which nodes " +
    "to create, which notes to write, where to put them. For queries it gathers relevant " +
    "content across branches and returns what it found. The librarian is read-only. It never " +
    "modifies the tree directly. It produces a plan that the orchestrator executes. " +
    "\n\n" +
    "Destructive operations go through the translator. The translator takes the message and " +
    "tree structure, produces a concrete plan with specific operations: delete node X, move " +
    "branch Y under Z, merge duplicates. Destructive steps pause for user confirmation before " +
    "executing. The user sees what will happen and says yes or no. " +
    "\n\n" +
    "Plan execution is a loop. Each step: navigate to the target node, read context, resolve " +
    "the correct mode for that node (respecting per-node mode overrides), switch modes, " +
    "execute, summarize. A scout pass inspects existing structure before creating new nodes, " +
    "so the orchestrator adapts notes into existing branches instead of duplicating them. " +
    "Move operations fetch counterpart context. Merge operations collect ambiguous candidates. " +
    "Deep context fetches child details for restructure operations. " +
    "\n\n" +
    "Conversation memory survives across mode switches within a single orchestration chain. " +
    "The user says something, the orchestrator classifies it, the librarian navigates three " +
    "branches, the structure mode creates a node, the notes mode writes content, and the " +
    "respond mode tells the user what happened. All in one turn. The respond mode sees step " +
    "summaries from every phase and produces a natural language answer with no exposed " +
    "internals. " +
    "\n\n" +
    "This is the reference tree orchestrator. It ships with every land. Replace it entirely " +
    "by registering a custom orchestrator for bigMode tree. The kernel dispatches to whatever " +
    "orchestrator is registered. The conversation system, mode registry, and tool resolution " +
    "all work the same regardless of which orchestrator drives them.",

  needs: {
    services: ["llm", "session", "chat", "mcp", "websocket", "hooks", "orchestrator"],
    models: ["Node"],
  },

  provides: {
    routes: false,
    tools: false,
    jobs: false,
    orchestrator: { bigMode: "tree" },
  },
};
