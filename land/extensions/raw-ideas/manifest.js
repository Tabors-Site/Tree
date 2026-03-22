export default {
  name: "raw-ideas",
  version: "1.0.0",
  description: "Quick capture and auto-placement of unstructured ideas into trees",

  needs: {
    services: ["llm", "session", "aiChat", "orchestrator"],
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
    tools: false,
    jobs: "../../jobs/rawIdeaAutoPlace.js",
    orchestrator: "../../orchestrators/pipelines/rawIdea.js",
    energyActions: {
      rawIdeaPlacement: { cost: 2 },
    },
    sessionTypes: {
      RAW_IDEA_ORCHESTRATE: "raw-idea-orchestrate",
    },
    cli: [
      { command: "ideas", description: "List raw ideas", method: "GET", endpoint: "/user/:userId/raw-ideas" },
    ],
  },
};
