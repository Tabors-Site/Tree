export default {
  name: "raw-ideas",
  version: "1.0.0",
  description: "Quick capture of unstructured ideas with automatic tree placement",

  needs: {
    services: ["llm", "session", "chat", "orchestrator"],
    models: ["Node", "User"],
  },

  optional: {
    services: ["energy"],
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
      { command: "ideas", description: "List raw ideas", method: "GET", endpoint: "/user/:userId/raw-ideas" },
    ],
  },
};
