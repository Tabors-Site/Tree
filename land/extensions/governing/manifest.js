export default {
  name: "governing",
  version: "0.1.0",
  builtFor: "TreeOS",
  description:
    "The coordination glue of TreeOS. Governing is what makes a tree a " +
    "tree — the substrate that turns a node with sub-work into a " +
    "coordinated domain, and a workspace extension into something that " +
    "can handle projects requiring multiple branches working together. " +
    "Without governing, a tree is a folder structure; with governing, " +
    "every Ruler scope is an addressable being with judgment, plans, " +
    "contracts, and execution discipline. " +
    "\n\n" +
    "Workspace extensions (code-workspace, book-workspace, design- " +
    "workspace, civilization-workspace, etc.) consume governing rather than reimplementing " +
    "coordination for their domain. They specialize the Worker base " +
    "mode for their content type and supply domain-specific validators; " +
    "the rest — planning, contracting, execution ordering, role " +
    "lifecycle — comes from governing uniformly. This is how a single " +
    "TreeOS instance can host code projects, books, designs, towns, " +
    "research collaboratives in the same substrate without each " +
    "extension reinventing how branches coordinate. " +
    "\n\n" +
    "Governing is also the seam manager. Where two branches meet — " +
    "where their work has to align on shared identifiers, shared " +
    "contracts, shared assumptions — governing is the layer that makes " +
    "the seam hold. Contracts get emitted at the Lowest Common Ancestor " +
    "of the branches that depend on them, so scope cannot leak across " +
    "coordination boundaries. The Foreman watches execution as a call " +
    "stack — step N+1 cannot start until step N's entire subtree " +
    "settles, cancellation unwinds cleanly, pause and resume preserve " +
    "frame position. The Ruler hears every user message at its scope " +
    "and decides what to do: hire a Planner, route to the Foreman, " +
    "respond directly, revise, pause, escalate. " +
    "\n\n" +
    "The role taxonomy. Five roles, each with distinct judgment and " +
    "tools, composing into a uniform governance pattern at every depth. " +
    "Ruler — the addressable being at a scope, holds authority for the " +
    "domain, makes routing decisions, ratifies plans and contracts, " +
    "convenes courts. Planner (tree:governing-planner) — transient, " +
    "drafts a plan with reasoning when the Ruler hires it, presents to " +
    "the Ruler, exits. Contractor (tree:governing-contractor) — " +
    "transient, drafts contracts shaped around the approved plan, " +
    "validates LCA correctness, hands back to the Ruler for ratification, " +
    "exits. Foreman (tree:governing-foreman) — call-stack manager, " +
    "watches execution, decides retry vs escalate vs pause vs freeze " +
    "vs cancel-subtree based on stack state. Worker (tree:governing-worker) — " +
    "executes leaf work under contracts in force; workspace extensions " +
    "extend this base for domain-specific tools and validators. " +
    "\n\n" +
    "Self-promotion lifecycle. A node promotes itself to Ruler when it " +
    "takes responsibility for a domain. Three uniform call sites: root " +
    "node on user request arrival, branch node on sub-Ruler dispatch, " +
    "Worker mid-build on scope undershoot (the work turned out compound, " +
    "the Worker emits sub-branches and its own node retroactively " +
    "becomes a Ruler). Same function, same metadata write, same " +
    'lifecycle event at every depth. metadata.governing.role = "ruler" ' +
    "plus an acceptedAt ISO timestamp. Approval ledgers " +
    "(planApprovals, contractApprovals, executionApprovals) accumulate " +
    "as the Ruler makes decisions across its life. " +
    "\n\n" +
    "LCA correctness on contracts. Every contract MUST have scope = " +
    "global | shared:[X,Y] | local:[X], where the Lowest Common Ancestor " +
    "of the named consumers is at or above the Contractor's emission " +
    "position. A Contractor at the project root may emit a " +
    "shared:[frontend,backend] contract because root is the LCA of " +
    "those branches. A Contractor at frontend may not — that scope " +
    "reaches outside frontend's domain. Contracts with wider scope are " +
    "rejected at parse time; the Contractor re-emits with a scope it " +
    "actually owns. This is what keeps coordination boundaries honest " +
    "as trees grow deep. " +
    "\n\n" +
    "Substrate for future passes. Every action accumulates evidence " +
    "future passes will read. Court records (Pass 2) will adjudicate " +
    "the cases governing surfaces. Reputation (Pass 3) will read " +
    "branchSignatures and outcome metrics across the substrate. " +
    "Structural remedies (Pass 4) will modify plans through court " +
    "authority. Economic coordination (Pass 5) will route resources " +
    "through the budget primitives governing already maintains. " +
    "Governing is the foundation; the rest is layered consumers.",

  territory: "coordination roles plans contracts rulers planners workers",

  needs: {
    services: ["hooks", "metadata", "tree", "modes"],
    models: ["Node"],
    extensions: [],
  },

  optional: {
    services: ["llm"],
    extensions: ["swarm"],
  },

  provides: {
    models: {},
    routes: "./routes.js",
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
      // Generic Worker stays registered for backward compatibility:
      // older plans without a workerType field resolve here. The
      // mode delegates to Build (the default cognitive shape).
      {
        key: "tree:governing-worker",
        handler: "./modes/worker.js",
        assignmentSlot: "governing-worker",
      },
      // The four typed Workers. Workers are typed by the cognitive
      // shape of the work, not by domain — Build creates new
      // artifacts, Refine improves existing ones, Review judges
      // without modifying, Integrate ties sibling outputs together.
      // Workspaces may register per-type specializations via
      // provides.workerTypes; absent that, dispatch routes to these
      // governing base modes directly.
      {
        key: "tree:governing-worker-build",
        handler: "./modes/workerBuild.js",
        assignmentSlot: "governing-worker-build",
      },
      {
        key: "tree:governing-worker-refine",
        handler: "./modes/workerRefine.js",
        assignmentSlot: "governing-worker-refine",
      },
      {
        key: "tree:governing-worker-review",
        handler: "./modes/workerReview.js",
        assignmentSlot: "governing-worker-review",
      },
      {
        key: "tree:governing-worker-integrate",
        handler: "./modes/workerIntegrate.js",
        assignmentSlot: "governing-worker-integrate",
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
      //
      // Per-terminal-status execution hooks fire on freezeExecutionRecord
      // transitions so Pass 2 courts and Pass 3 reputation can
      // discriminate cleanly: cancelled (decided-not-to-finish) is
      // semantically different from failed (tried-and-couldn't),
      // and downstream consumers should never collapse them. Distinct
      // hook names enforce that distinction at the subscription
      // surface — a court that listens for "executionFailed" simply
      // won't fire on cancellation; no risk of a downstream consumer
      // forgetting to switch on a status field.
      //
      // governing:courtConvened is the Pass 1 stub fired by the
      // Ruler's convene-court tool. Pass 2 court reasoning lands on
      // top of this hook.
      fires: [
        "governing:rulerPromoted",
        "governing:contractRatified",
        "governing:roleAssigned",
        "governing:planRatified",
        "governing:executionRatified",
        "governing:executionCompleted",
        "governing:executionFailed",
        "governing:executionCancelled",
        "governing:executionPaused",
        "governing:executionSuperseded",
        "governing:courtConvened",
      ],
      listens: [],
    },
  },
};
