export default {
  name: "navigation",
  version: "2.0.0",
  description:
    "Owns the user's tree navigation state. Every user has two lists stored in metadata.nav: " +
    "roots (the complete list of trees they own or contribute to) and recentRoots (the last 5 " +
    "trees they visited, ordered by recency with timestamps). These lists drive the tree picker " +
    "in the client and the CLI's navigation commands.\n\n" +
    "The roots list is maintained automatically through three hooks. afterNodeCreate adds the " +
    "new tree root to the creating user's list when they create a tree. afterOwnershipChange " +
    "handles all contributor and ownership mutations: addContributor adds the root, " +
    "removeContributor checks whether the user still has any access (owner or contributor on " +
    "any node) before removing, setOwner and transferOwnership both add the root for the new " +
    "owner. The logic is careful about edge cases. A user who contributes to multiple trees " +
    "and is removed from one keeps their root if they still have access elsewhere.\n\n" +
    "The recentRoots list is maintained by the afterNavigate hook, which fires every time a " +
    "user navigates to a tree root. It pushes the visited tree to the front of the list, " +
    "deduplicates, and trims to the 5 most recent entries. Each entry stores the rootId, " +
    "rootName, and lastVisitedAt timestamp. After updating, the hook pushes the new recent " +
    "roots list to the user's WebSocket connection via the recentRoots event, so the client " +
    "updates in real time. A getRecentRoots socket handler lets clients request the list on " +
    "connect. At boot, a one-time migration copies the old User.roots schema field to " +
    "metadata.nav.roots for lands upgrading from the pre-metadata schema. The extension " +
    "exports addRoot, removeRoot, getUserRoots, getUserRootsWithNames, and " +
    "getRecentRootsWithNames for other extensions to consume.",

  needs: {
    services: ["websocket"],
    models: ["User", "Node"],
  },

  optional: {},

  provides: {
    routes: false,
    tools: false,
    modes: false,
    jobs: false,
    orchestrator: false,
    energyActions: {},
    sessionTypes: {},
    cli: [],
  },
};
