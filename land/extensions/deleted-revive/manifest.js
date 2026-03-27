export default {
  name: "deleted-revive",
  version: "1.0.0",
  builtFor: "TreeOS",
  description:
    "Deletion in TreeOS is permanent by default. When a branch is deleted, its nodes are " +
    "marked with a special parent value that removes them from the live tree. The data " +
    "stays in the database but becomes invisible and inaccessible. This extension makes " +
    "that recoverable. " +
    "\n\n" +
    "The deleted list endpoint finds all nodes owned by a user whose parent is set to the " +
    "DELETED sentinel value. These are the root nodes of deleted branches. Each entry shows " +
    "the node's name, when it was created, and its ID. The user sees everything they've " +
    "deleted and can decide what to bring back. " +
    "\n\n" +
    "Two revival paths are available. Revive as branch reattaches the deleted subtree under " +
    "a specified parent node in an existing tree. The user picks where it goes. The entire " +
    "branch, with all its children, notes, and metadata, comes back exactly as it was. " +
    "Revive as root promotes the deleted branch to a standalone tree. The node becomes a " +
    "new root owned by the user. Useful when a branch outgrew its original tree or when " +
    "the parent tree no longer exists. " +
    "\n\n" +
    "Both operations call kernel functions (reviveNodeBranch and reviveNodeBranchAsRoot) " +
    "that handle parent pointer updates, contributor lists, and tree integrity. The " +
    "extension only provides the user-facing routes and authorization checks. If " +
    "html-rendering is installed, the deleted list renders as a browsable HTML page with " +
    "revival actions. The CLI exposes a 'deleted' command that lists soft-deleted branches " +
    "for the current user.",

  needs: {
    models: ["Node"],
  },

  optional: {},

  provides: {
    models: {},
    routes: "./routes.js",
    tools: false,
    jobs: false,
    orchestrator: false,
    energyActions: {},
    sessionTypes: {},
    cli: [
      { command: "deleted", description: "List soft-deleted branches", method: "GET", endpoint: "/user/:userId/deleted" },
    ],
  },
};
