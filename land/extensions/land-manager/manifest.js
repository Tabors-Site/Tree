export default {
  name: "land-manager",
  version: "1.0.2",
  builtFor: "TreeOS",
  description:
    "The administrative AI for the entire land. Registers the land:manager mode, which is the " +
    "conversation mode activated when an admin navigates to the land root (/). The mode gives " +
    "the AI a comprehensive set of tools for inspecting and managing the land: land-status for " +
    "a full overview of extensions, users, trees, and federation peers; land-config-read and " +
    "land-config-set for reading and writing land configuration; land-users and land-peers for " +
    "listing users and federated peer lands; and land-system-nodes for inspecting the system " +
    "node tree (.identity, .config, .peers, .extensions).\n\n" +
    "Extension management is a core capability. land-ext-list shows all loaded extensions with " +
    "version numbers and what they provide (routes, tools, jobs, modes). land-ext-search queries " +
    "the Horizon registry at horizon.treeos.ai for available extensions. land-ext-install " +
    "downloads an extension from the registry into the extensions directory. land-ext-disable " +
    "and land-ext-enable toggle extensions on and off. All write operations are admin-only and " +
    "require a land restart to take effect.\n\n" +
    "The extension also provides spatial scoping tools (ext-scope-read, ext-scope-set) that are " +
    "injected into tree modes (librarian and structure) so tree owners can control which extensions " +
    "are active on their branches. ext-scope-read shows the inheritance chain of blocked and " +
    "restricted extensions at any node. ext-scope-set writes blocking or restriction rules that " +
    "inherit to all children. The shell extension's execute-shell tool is included in the land " +
    "manager mode when available, giving admins direct server access through conversation. Routes " +
    "expose land-status, land-users, and a chat endpoint for CLI and HTTP access.",

  needs: {
    models: ["Node", "User"],
  },

  optional: {
    extensions: ["shell"],
  },

  provides: {
    routes: "./routes.js",
    tools: "./tools.js",
    jobs: false,

    cli: [
      { command: "land-status", scope: ["land"], description: "Show land overview (extensions, users, trees, peers)", method: "GET", endpoint: "/land/status" },
      { command: "land-users", scope: ["land"], description: "List all users on this land", method: "GET", endpoint: "/land/users" },
    ],
  },
};
