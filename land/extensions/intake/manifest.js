export default {
  name: "intake",
  version: "0.1.0",
  builtFor: "TreeOS",
  scope: "confined",
  description:
    "The drone role in the swarm. One job: take arbitrary human input " +
    "(URL, file reference, long brain dump, voice transcript, brief " +
    "premise) and produce a domain-neutral [[PREMISE]] block that a " +
    "domain architect (book-plan, code-plan, research-plan) can shape " +
    "into contracts + branches. " +
    "\n\n" +
    "Intake does NOT decompose into branches, does NOT emit contracts, " +
    "does NOT choose a depth. It distills. It translates messy input " +
    "into structured premise. The architect that runs AFTER intake uses " +
    "the premise as its input instead of the user's raw message. " +
    "\n\n" +
    "Why this exists as a distinct role: small models degrade fast on " +
    "multi-concern turns. Asking one LLM call to fetch a URL, extract " +
    "content, infer a premise, establish characters, lock pronouns, " +
    "decompose into chapters, and validate branch paths is seven " +
    "concerns. Splitting intake from architecture means each stage has " +
    "one concern, each prompt is shorter, each turn focused. The bee " +
    "colony analogue: drones gather pollen, workers build the comb. " +
    "\n\n" +
    "Domain-neutral. code-workspace, book-workspace, research-workspace, " +
    "curriculum-workspace, and anything else with a plan-mode can all " +
    "invoke tree:intake as their first stage when the caller's input " +
    "looks raw (contains URLs, exceeds some length threshold, references " +
    "external sources). The caller's dispatch layer decides when to run " +
    "intake; intake itself is stateless and domain-neutral.",

  territory: "raw input translation, premise distillation, URL ingestion",

  needs: {
    services: ["hooks"],
    models: ["Node"],
  },

  optional: {
    services: ["llm"],
  },

  provides: {
    models: {},
    routes: false,
    tools: true,
    jobs: false,
    energyActions: {},
    sessionTypes: {},
    env: [],
    cli: [],
    modes: [
      { key: "tree:intake", handler: "./modes/intake.js", assignmentSlot: "intake" },
    ],
    hooks: {
      fires: [],
      listens: [],
    },
  },
};
