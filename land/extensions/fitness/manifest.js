export default {
  name: "fitness",
  version: "1.0.0",
  description: "Personal fitness coaching, workout programming, and exercise tracking via tree structure",

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
        command: "fitness [message...]",
        description: "Talk to your fitness coach. Plans workouts, logs exercises, tracks progress.",
        method: "POST",
        endpoint: "/root/:rootId/fitness",
        body: ["message"],
      },
    ],
  },
};
