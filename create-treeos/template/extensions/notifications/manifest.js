export default {
  name: "notifications",
  version: "1.0.2",
  builtFor: "TreeOS",
  description:
    "The notification infrastructure for the entire extension ecosystem. Owns the Notification " +
    "model, a Mongoose schema with userId, rootId, type, title, content, dreamSessionIds, and " +
    "createdAt fields, indexed by userId and createdAt for fast reverse-chronological queries. " +
    "This extension does not generate notifications itself. It provides the storage layer and " +
    "query API that other extensions use to create and retrieve notifications.\n\n" +
    "Extensions like dreams, gateway, and any custom extension create notifications by importing " +
    "the Notification model from this extension's exports and writing documents directly. The " +
    "type field is a freeform string owned by the creating extension (e.g., 'dream-summary', " +
    "'dream-thought'), allowing each extension to define its own notification taxonomy. The " +
    "rootId field ties every notification to a specific tree, so notifications can be scoped " +
    "per-tree or queried globally for a user.\n\n" +
    "The query function getNotifications supports filtering by userId (required), rootId " +
    "(optional), and sinceDays (only return notifications from the last N days). Pagination " +
    "is handled through limit (default 50, max 100) and offset parameters. The GET " +
    "/user/:userId/notifications route exposes this query function over HTTP with optional " +
    "authentication, so both authenticated clients and public consumers can access notifications " +
    "where permitted. Results include the notification array and total count for pagination. " +
    "The extension exports both getNotifications and the Notification model for direct use by " +
    "other extensions.",

  npm: ["web-push@^3.6.7"],

  needs: {
    models: ["Node"],
  },

  optional: {
    extensions: ["html-rendering", "treeos-base"],
  },

  provides: {
    models: {
      Notification: "./model.js",
    },
    routes: "./routes.js",
    tools: false,
    jobs: false,
    orchestrator: false,
    energyActions: {},
    sessionTypes: {},
  },
};
