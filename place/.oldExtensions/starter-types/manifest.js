export default {
  name: "starter-types",
  version: "1.0.1",
  builtFor: "TreeOS",
  description:
    "When the AI creates a node it needs to assign a type. Without guidance it guesses, and " +
    "every land ends up with a different vocabulary. One land calls them tasks, another calls " +
    "them action-items, a third uses todos. Starter types injects a consistent set of " +
    "suggested node types into every AI context via enrichContext: goal, plan, task, " +
    "knowledge, resource, identity. These are suggestions, not constraints. The AI can still " +
    "use custom types when the situation calls for it. But the defaults give every tree on " +
    "the land a shared structural vocabulary from day one." +
    "\n\n" +
    "Land operators override the default list through land config. Set starterTypes to an " +
    "array of strings and every tree on that land inherits the custom vocabulary. A software " +
    "shop might use epic, story, bug, spike, doc. A school might use course, lesson, " +
    "assignment, reading, project. The types are loaded once at boot and injected into every " +
    "enrichContext call. The get-available-types tool lets the AI query the current list at " +
    "runtime. No models, no routes, no jobs. Pure context injection. The lightest extension " +
    "in the system, but it shapes every tree that grows on the land.",

  needs: {
    services: ["hooks"],
  },

  optional: {
    extensions: ["treeos-base"],
  },

  provides: {
    models: {},
    routes: false,
    tools: true,
    modes: false,
    jobs: false,
    orchestrator: false,
    energyActions: {},
    sessionTypes: {},
    cli: [],
  },
};
