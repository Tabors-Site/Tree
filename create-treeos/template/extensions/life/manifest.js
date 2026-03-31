export default {
  name: "life",
  version: "1.0.0",
  builtFor: "TreeOS",
  description:
    "Choose your domains. The tree builds itself. A one-time scaffolder that asks " +
    "what you care about, creates the tree structure, sets goals, wires channels " +
    "between related domains, and hands off. Life doesn't manage extensions after " +
    "setup. It plants the seeds. The extensions are the trees.",

  needs: {
    models: ["Node"],
    services: ["hooks", "llm", "metadata"],
  },

  optional: {
    extensions: ["food", "fitness", "study", "recovery", "kb", "channels"],
  },

  provides: {
    models: {},
    routes: "./routes.js",
    tools: false,
    jobs: false,

    cli: [
      {
        command: "life [domains...]",
        scope: ["home"],
        description: "Set up your life tree. e.g. life food fitness study",
        method: "POST",
        endpoint: "/life/setup",
        body: ["domains"],
        subcommands: {
          add: {
            method: "POST",
            endpoint: "/life/setup",
            description: "Add a domain to your Life tree. e.g. life add recovery",
            args: ["domain"],
          },
        },
      },
    ],
  },
};
