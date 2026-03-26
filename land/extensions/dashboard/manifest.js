export default {
  name: "dashboard",
  version: "1.0.0",
  description:
    "The real-time operations panel for TreeOS. Every active session, every tree, every " +
    "conversation happening on the land is visible in one place. The dashboard does not " +
    "use HTTP polling. It registers WebSocket event handlers that push state changes to " +
    "connected clients the instant they happen. " +
    "\n\n" +
    "Four socket handlers power the dashboard. getDashboardSessions returns all sessions " +
    "for the current user with the active navigator session highlighted. getDashboardRoots " +
    "lists all trees owned by the user with child counts. getDashboardTree loads a full " +
    "tree structure recursively, populating all children depth-first and simplifying each " +
    "node to id, name, status, and children. getDashboardChats retrieves the conversation " +
    "history for a specific session so the user can review what the AI said and did. " +
    "\n\n" +
    "Session changes are pushed automatically. The extension hooks into afterSessionCreate " +
    "and afterSessionEnd. Whenever any session starts or ends, the dashboard emits an " +
    "updated session list to all of that user's connected sockets. The user never has to " +
    "refresh. New sessions appear, ended sessions disappear, and the active navigator " +
    "indicator updates in real time. " +
    "\n\n" +
    "The dashboard is infrastructure for frontends. It provides the data layer and the " +
    "real-time transport. The React app, the HTML rendering extension, or any custom " +
    "client can connect via WebSocket and receive the same structured events. No routes. " +
    "No REST endpoints. Pure socket communication.",

  needs: {
    services: ["websocket", "session"],
    models: ["Node"],
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
