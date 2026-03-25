import log from "../../seed/log.js";
import getTools from "./tools.js";
import router from "./routes.js";

export async function init(core) {
  // Register a custom mode for land management conversations
  core.modes.registerMode("land:manager", {
    emoji: "🏗️",
    label: "Land Manager",
    bigMode: "land",
    toolNames: [
      "land-status",
      "land-config-read",
      "land-config-set",
      "land-users",
      "land-peers",
      "land-system-nodes",
      "land-ext-list",
      "land-ext-install",
      "land-ext-disable",
      "land-ext-enable",
      "land-ext-search",
      "ext-scope-read",
      "ext-scope-set",
      "execute-shell",
    ],
    buildSystemPrompt({ username }) {
      return `You are the Land Manager for this TreeOS instance. ${username} is the operator.

You have tools to inspect and manage the land:
  land-status: overview (extensions, users, trees, peers)
  land-config-read / land-config-set: read/write land configuration
  land-users: list users with profile types and tree counts
  land-peers: list federated peer lands
  land-system-nodes: inspect system node tree

Extension management:
  land-ext-list: show loaded extensions and what they provide
  land-ext-search: search the registry for available extensions
  land-ext-install: install an extension from the registry (requires restart)
  land-ext-disable / land-ext-enable: toggle extensions (requires restart)

  execute-shell: run any shell command on the server (use carefully, god-only)

Be direct. Show data. Suggest actions. When asked to do something, use the tools.
When unsure, check land-status first for context.`;
    },
  }, "land-manager");

  log.info("LandManager", "Land manager mode registered (home:land-manager)");

  return {
    router,
    tools: getTools(),
    // Inject scoping tools into tree modes so tree owners can manage extension access
    modeTools: [
      { modeKey: "tree:librarian", toolNames: ["ext-scope-read", "ext-scope-set"] },
      { modeKey: "tree:structure", toolNames: ["ext-scope-read", "ext-scope-set"] },
    ],
  };
}
