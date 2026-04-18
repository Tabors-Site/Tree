export default {
  name: "swarm",
  version: "0.1.0",
  builtFor: "TreeOS",
  description:
    "Parallel inquiry as a primitive. Swarm dispatches a compound task into " +
    "N child branches that each run as their own session, tracks their " +
    "status, retries failures, resumes interrupted work. The pattern applies " +
    "anywhere a goal decomposes into independent sub-investigations that " +
    "later reconverge: code projects, research papers, book chapters, data " +
    "pipelines, curriculum modules, scientific protocols. " +
    "\n\n" +
    "Mechanism, not policy. Swarm owns no conversation modes. Each branch " +
    "runs in whichever mode the architect names (or inherits from the closest " +
    "extension's -plan mode via the standard resolution chain). Domain " +
    "extensions (code-workspace, research-workspace, etc.) subscribe to " +
    "swarm's lifecycle hooks to run domain-specific validators and formatters " +
    "on top. " +
    "\n\n" +
    "Tree-authoritative. The tree node graph is ground truth; subPlan is a " +
    "cache. Every dispatch and resume runs `reconcileProject` first, which " +
    "walks the actual tree children and merges them with subPlan: new " +
    "children become pending entries, deleted children drop, renamed or " +
    "rewritten specs refresh from node metadata. A user can reimport a " +
    "project after two weeks of offline edits and swarm adopts reality. " +
    "\n\n" +
    "Siblings are legible. readSiblingBranches returns a read-only snapshot " +
    "of every sibling branch's state + descendant notes, domain-neutral. " +
    "Domain extensions render it however they want: code-workspace as a " +
    "file tree, book-workspace as chapter summaries. Branches stop building " +
    "blind to each other. " +
    "\n\n" +
    "State lives at metadata.swarm on each swarm-aware node: subPlan (branch " +
    "list + statuses), inbox (lateral signals between siblings), contracts " +
    "(invariants every branch respects), aggregatedDetail (rolled-up " +
    "descendant state), events (flat audit log), masterPlan (top-level " +
    "orchestration state), role (project/branch). Signal payloads are " +
    "opaque to swarm — domain extensions define their own kinds.",

  territory: "parallel branch dispatch, multi-component projects, compound tasks",

  needs: {
    services: ["hooks", "metadata"],
    models: ["Node"],
  },

  optional: {
    services: ["llm", "orchestrator", "session"],
    extensions: [],
  },

  provides: {
    models: {},
    routes: false,
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
      fires: [
        "swarm:afterProjectInit",
        "swarm:beforeBranchRun",
        "swarm:afterBranchComplete",
        "swarm:afterAllBranchesComplete",
        "swarm:branchRetryNeeded",
      ],
      listens: [],
    },
  },
};
