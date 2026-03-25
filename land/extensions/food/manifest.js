export default {
  name: "food",
  version: "1.0.0",
  description: "Calorie and macro tracking, meal planning, and nutritional coaching via tree structure",

  needs: {
    models: ["Node"],
  },

  optional: {
    services: ["llm"],
    extensions: ["values", "prestige", "schedules"],
  },

  provides: {
    routes: "./routes.js",
    tools: false,
    jobs: false,

    hooks: {
      fires: [],
      listens: ["enrichContext"],
    },

    cli: [
      {
        command: "food [message...]",
        description: "Talk to your food coach. Logs meals, tracks macros, plans nutrition.",
        method: "POST",
        endpoint: "/root/:rootId/food",
        body: ["message"],
      },
    ],
  },
};
