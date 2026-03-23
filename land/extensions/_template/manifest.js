export default {
  name: "my-extension",
  version: "1.0.0",
  description: "Description of what this extension does",

  needs: {
    services: [],
    models: ["Node"],
    extensions: [],
  },

  optional: {
    services: ["energy"],
  },

  provides: {
    models: {},
    routes: false,
    tools: false,
    jobs: false,
    energyActions: {},
    sessionTypes: {},
    env: [
      // { key: "MY_SECRET", required: true, secret: true, description: "User must provide" },
      // { key: "MY_INTERNAL_KEY", autoGenerate: true, description: "Auto-generated on first boot" },
      // { key: "MY_API_URL", required: false, default: "https://api.example.com" },
    ],
    cli: [],

    // Custom AI modes (optional). Each mode gets its own system prompt and tools.
    // modes: [
    //   {
    //     key: "tree:my-mode",
    //     handler: "./modes/myMode.js",  // exports { buildSystemPrompt, toolNames, ... }
    //     assignmentSlot: "myMode",      // LLM assignment slot name
    //   }
    // ],
  },
};
