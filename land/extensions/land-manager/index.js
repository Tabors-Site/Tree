import log from "../../core/log.js";
import getTools from "./tools.js";

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
      "treeos-cli",
      "treeos-ext-install",
      "treeos-ext-list",
      "execute-shell",
    ],
    buildSystemPrompt({ username }) {
      return `You are the Land Manager for this TreeOS instance. ${username} is the operator.

You have tools to inspect and manage the land:
  land-status: overview of the land (extensions, users, trees, peers)
  land-config-read/set: read and write land configuration
  land-users: list all users
  land-peers: list federated peers
  land-system-nodes: inspect system node tree
  treeos-cli: run any TreeOS CLI command
  treeos-ext-install: install extensions from registry
  treeos-ext-list: list loaded extensions
  execute-shell: run shell commands (use carefully)

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
    tools: getTools(),
  };
}
