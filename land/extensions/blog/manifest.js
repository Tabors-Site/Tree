export default {
  name: "blog",
  version: "1.0.0",
  description: "Publish blog posts on your land",

  needs: {
    models: ["User"],
  },

  optional: {},

  provides: {
    models: { BlogPost: "./model.js" },
    routes: "./routes.js",
    tools: false,
    jobs: false,
    orchestrator: false,
    energyActions: {},
    sessionTypes: {},
    cli: [
      { command: "blogs", description: "List blog posts", method: "GET", endpoint: "/blog/posts" },
      { command: "blog <slug>", description: "Read a blog post", method: "GET", endpoint: "/blog/posts/:slug" },
    ],
  },
};
