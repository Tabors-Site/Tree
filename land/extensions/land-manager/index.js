import log from "../../core/log.js";
import getTools from "./tools.js";
import router from "./routes.js";

export async function init(core) {
  // Register a custom mode for land management conversations
  core.modes.registerMode("home:land-manager", {
    emoji: "🏗️",
    label: "Land Manager",
    bigMode: "home",
    toolNames: [
      "land-status",
      "land-config-read",
      "land-config-set",
      "land-users",
      "land-peers",
      "land-system-nodes",
      "execute-shell",
    ],
    buildSystemPrompt({ username }) {
      return `You are the Land Manager for this TreeOS instance. ${username} is the operator.

You have tools to inspect and manage the land:
  land-status: overview (extensions, users, trees, peers)
  land-config-read: read configuration values
  land-config-set: write configuration values
  land-users: list all users with profile types
  land-peers: list federated peer lands
  land-system-nodes: inspect system node tree (.identity, .config, .peers, .extensions)
  execute-shell: run any shell command on the server (use carefully)

You help the operator:
  Install, update, disable, or remove extensions
  Configure the land (name, domain, settings)
  Monitor health (users, trees, peers, errors)
  Manage federation (add/remove peers)
  Debug issues (read logs, check config, run diagnostics)

Be direct. Show data. Suggest actions. When asked to do something, use the tools.
When unsure, check land-status first for context.`;
    },
  }, "land-manager");

  log.info("LandManager", "Land manager mode registered (home:land-manager)");

  return {
    router,
    tools: getTools(),
  };
}
