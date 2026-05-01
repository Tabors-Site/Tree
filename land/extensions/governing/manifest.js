export default {
  name: "governing",
  version: "0.1.0",
  builtFor: "TreeOS",
  description:
    "Coordination primitive. Owns the role taxonomy (Ruler, Planner, " +
    "Contractor, Worker) as composable pieces with sensible defaults so " +
    "the extension is functional standalone. Workspace extensions " +
    "(code-workspace, book-workspace, etc.) consume governing for " +
    "coordination and specialize the Worker base mode for their domain. " +
    "\n\n" +
    "Three modes. Planner (tree:governing-planner) drafts a plan and " +
    "presents it to the Ruler. Contractor (tree:governing-contractor) " +
    "drafts contracts shaped around an approved plan, validating that " +
    "every contract scope sits at or above the LCA of its named " +
    "consumers. Worker (tree:governing-worker) executes leaf work under " +
    "the contracts in force. Workspaces extend Worker for their domain. " +
    "\n\n" +
    "Self-promotion lifecycle. A node promotes itself to Ruler when it " +
    "takes responsibility for a domain. Three uniform call sites: root " +
    "node on user request arrival, branch node on sub-Ruler dispatch, " +
    "Worker mid-build on scope undershoot. metadata.governing.role = " +
    "\"ruler\" plus an acceptedAt ISO timestamp. Future court hearings " +
    "(Pass 2) will read these timestamps and role transitions. " +
    "\n\n" +
    "LCA correctness on contracts. Every contract MUST have scope = " +
    "global | shared:[X,Y] | local:[X], where the LCA of the named " +
    "consumers is at or above the Contractor's emission position. " +
    "Contracts with wider scope are rejected at parse time and the " +
    "Contractor re-emits.",

  territory: "coordination roles plans contracts rulers planners workers",

  needs: {
    services: ["hooks", "metadata", "tree", "modes"],
    models: ["Node"],
    extensions: ["plan"],
  },

  optional: {
    services: ["llm"],
    extensions: ["swarm"],
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
      {
        key: "tree:governing-planner",
        handler: "./modes/planner.js",
        assignmentSlot: "governing-planner",
      },
      {
        key: "tree:governing-contractor",
        handler: "./modes/contractor.js",
        assignmentSlot: "governing-contractor",
      },
      {
        key: "tree:governing-worker",
        handler: "./modes/worker.js",
        assignmentSlot: "governing-worker",
      },
      {
        key: "tree:governing-foreman",
        handler: "./modes/foreman.js",
        assignmentSlot: "governing-foreman",
      },
    ],

    hooks: {
      // Lifecycle events workspaces and future courts subscribe to.
      // governing:rulerPromoted fires when a node self-promotes via
      // promoteToRuler at any depth (root, sub-Ruler, leaf-becoming-
      // compound). governing:contractRatified fires when a Ruler
      // ratifies the Contractor's emission. governing:roleAssigned
      // fires when a transient role (Planner, Contractor, Worker) is
      // dispatched at a scope.
      fires: [
        "governing:rulerPromoted",
        "governing:contractRatified",
        "governing:roleAssigned",
      ],
      listens: [],
    },
  },
};
