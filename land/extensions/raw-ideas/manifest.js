export default {
  name: "raw-ideas",
  version: "1.0.0",
  builtFor: "TreeOS",
  description:
    "Thoughts do not arrive organized. They arrive in the shower, on a walk, in the middle of " +
    "something else. The raw ideas inbox is a capture layer that sits outside the tree. Text " +
    "or file, no structure required. Drop it in and keep moving. The idea sits in your inbox " +
    "with status pending until you or the AI decides where it belongs." +
    "\n\n" +
    "Placement is a multi-phase AI orchestration pipeline. Phase one: the LLM reads the raw " +
    "idea content alongside deep summaries of every tree the user owns. It picks the best-fit " +
    "tree with a confidence score. Below 0.35 confidence the idea is marked stuck because " +
    "forcing bad placement is worse than waiting. Phase two: the selected tree's orchestrator " +
    "takes over. It navigates the tree structure, finds the right branch and node, creates " +
    "child nodes if needed, and writes the idea as a note at the correct position. Phase three: " +
    "the raw idea is marked succeeded with a timestamp and the full path from root to target " +
    "node is recorded in the contribution log." +
    "\n\n" +
    "Three entry points for placement. Manual: the user picks a node and transfers the idea " +
    "themselves via the CLI or API. Interactive: the place endpoint runs the full pipeline and " +
    "returns a conversational response explaining where it landed and why. Background: the " +
    "auto-place job runs every 15 minutes, picks up the latest pending text idea for each " +
    "eligible user who is offline, and fires the pipeline silently. Users toggle auto-place " +
    "on or off. The job skips users who are currently online because they can trigger it " +
    "themselves." +
    "\n\n" +
    "Ideas can be deferred to short-term memory when the tree orchestrator determines the idea " +
    "needs more context before placement. Status lifecycle: pending, processing, succeeded, " +
    "stuck, deferred, deleted. @mentions in text ideas resolve to real users. File ideas " +
    "support upload with storage tracking. Search supports exact phrase matching, word boundary " +
    "matching, and hyphenated term matching across the inbox.",

  needs: {
    services: ["llm", "session", "chat", "orchestrator", "contributions", "hooks"],
    models: ["Node", "User", "Note"],
  },

  optional: {
    services: ["energy"],
    extensions: ["html-rendering", "treeos-base"],
  },

  provides: {
    models: {
      RawIdea: "./model.js",
    },
    routes: "./routes.js",
    tools: true,
    jobs: "./autoPlaceJob.js",
    orchestrator: "./pipeline.js",
    energyActions: {
      rawIdeaPlacement: { cost: 2 },
    },
    sessionTypes: {
      RAW_IDEA_ORCHESTRATE: "raw-idea-orchestrate",
      RAW_IDEA_CHAT: "raw-idea-chat",
      SCHEDULED_RAW_IDEA: "scheduled-raw-idea",
    },
    cli: [
      { command: "ideas", scope: ["home"], description: "List raw ideas (-p pending, -a all, -q search)", method: "GET", endpoint: "/user/:userId/raw-ideas" },
      { command: "idea <message...>", scope: ["home"], description: "AI places idea in the right tree", method: "POST", endpoint: "/user/:userId/raw-ideas/place", bodyMap: { content: 0 } },
      { command: "idea-store <message...>", scope: ["home"], description: "Save idea without processing", method: "POST", endpoint: "/user/:userId/raw-ideas", bodyMap: { content: 0 } },
      { command: "idea-place <rawIdeaId>", scope: ["home"], description: "Process a stored idea", method: "POST", endpoint: "/user/:userId/raw-ideas/:rawIdeaId/place" },
      { command: "idea-transfer <rawIdeaId> <nodeId>", scope: ["home"], description: "Manually transfer idea to a node", method: "POST", endpoint: "/user/:userId/raw-ideas/:rawIdeaId/transfer", bodyMap: { nodeId: 1 } },
      { command: "idea-auto <toggle>", scope: ["home"], description: "Toggle auto-placement (on/off)", method: "POST", endpoint: "/user/:userId/raw-ideas/auto", bodyMap: { enabled: 0 } },
      { command: "rm-idea <id>", scope: ["home"], description: "Delete a raw idea", method: "DELETE", endpoint: "/user/:userId/raw-ideas/:id" },
    ],
  },
};
