export default {
  name: "swarm",
  version: "0.2.0",
  builtFor: "TreeOS",
  description:
    "Parallel branch execution engine. Swarm takes a plan that already " +
    "carries branch steps (drafted by governing's Planner, ratified by " +
    "governing's Ruler) and runs those branches in parallel as their own " +
    "sessions. It tracks status, retries failures, detects resumable work " +
    "across sessions, and surfaces sibling state so each branch can see " +
    "what its peers have produced. The pattern applies anywhere a goal " +
    "decomposes into independent sub-investigations that later reconverge: " +
    "code projects, research papers, book chapters, data pipelines, " +
    "curriculum modules, scientific protocols. " +
    "\n\n" +
    "Mechanism, not policy. Swarm doesn't draft plans. Swarm doesn't " +
    "ratify contracts. Swarm doesn't decide who gets what work. Those are " +
    "governing's job. Swarm reads governing's emissions and runs the " +
    "branches the plan named, in the modes the plan declared, under the " +
    "contracts in force. Each branch dispatches as a sub Ruler turn " +
    "(governing's recursive primitive), where the branch's own Ruler " +
    "drives its full lifecycle (Planner, Contractor, dispatch) before " +
    "settling. Workspace extensions (code-workspace, book-workspace, etc.) " +
    "subscribe to swarm's lifecycle hooks to run domain-specific validators " +
    "and formatters on top of the produced artifacts. " +
    "\n\n" +
    "Tree-authoritative. The tree node graph is ground truth; subPlan is " +
    "a cache. Every dispatch and resume runs `reconcileProject` first, " +
    "which walks the actual tree children and merges them with subPlan: " +
    "new children become pending entries, deleted children drop, renamed " +
    "or rewritten specs refresh from node metadata. A user can reimport " +
    "a project after two weeks of offline edits and swarm adopts reality. " +
    "\n\n" +
    "Siblings are legible. readSiblingBranches returns a read-only " +
    "snapshot of every sibling branch's state plus descendant notes, " +
    "domain-neutral. Domain extensions render it however they want: " +
    "code-workspace as a file tree, book-workspace as chapter summaries. " +
    "Branches stop building blind to each other. " +
    "\n\n" +
    "Resume detection across sessions. detectResumableSwarm walks a " +
    "project's tree to find branches still in pending or running state, " +
    "even if the original session that started them is long dead. The " +
    "Foreman (governing's call-stack manager) reads the resumable set " +
    "and decides whether to redispatch them. Pause markers and frame " +
    "anchors written by the Foreman survive session refresh; swarm honors " +
    "them on the next dispatch attempt. " +
    "\n\n" +
    "Branch decomposition state lives in metadata.plan, owned by " +
    "governing. Each branch is a step with kind=branch in plan.steps. " +
    "Swarm reads the plan, dispatches branches, writes branch-step " +
    "status; governing owns plan emission and contract ratification. " +
    "Swarm's own namespace (metadata.swarm) holds execution bookkeeping: " +
    "role, parentProjectId, aggregatedDetail, inbox, events. Signal " +
    "payloads are opaque to swarm; domain extensions define their own kinds.",

  territory: "parallel branch dispatch, branch status tracking, tree reconciliation, resume detection",

  needs: {
    services: ["hooks", "metadata"],
    models: ["Node"],
    extensions: ["governing"],
  },

  optional: {
    services: ["llm", "orchestrator", "session"],
    extensions: [],
  },

  provides: {
    models: {},
    routes: "./routes.js",
    tools: false,
    jobs: false,
    energyActions: {},
    sessionTypes: {},
    env: [],
    cli: [],
    modes: [],

    hooks: {
      // Swarm emits custom lifecycle events as `swarm:<name>`. Extensions
      // that listen declare these strings in their own listens array.
      // Plan-lifecycle events (proposed, updated, archived) used to live
      // here in v0.1; they moved to governing in v0.2 since governing
      // owns plan emission. The events that remain are dispatch and
      // branch-status mechanics, which swarm still owns.
      fires: [
        "swarm:afterProjectInit",
        "swarm:beforeBranchRun",
        "swarm:afterBranchComplete",
        "swarm:afterAllBranchesComplete",
        "swarm:branchRetryNeeded",
        "swarm:runScouts",
      ],
      listens: ["afterMetadataWrite"],
    },
  },
};
