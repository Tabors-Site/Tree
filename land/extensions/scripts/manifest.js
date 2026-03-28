export default {
  name: "scripts",
  version: "1.0.0",
  builtFor: "TreeOS",
  scope: "confined",
  description:
    "Sandboxed JavaScript execution on tree nodes. Scripts are stored in node metadata as named " +
    "code blocks (max 2000 characters each) and executed in a Node.js vm context with a 5-second " +
    "timeout. The sandbox provides a frozen snapshot of the node, a capped console.log (200 lines), " +
    "and a set of safe mutation functions. Scripts cannot access the filesystem, network (except " +
    "through getApi), process, or require. They run in an async IIFE, so await is available.\n\n" +
    "The safe functions are the scripting API. setValueForNode and setGoalForNode write to the " +
    "values extension's metadata. editStatusForNode changes node status with optional inheritance " +
    "to children. addPrestigeForNode prestiges the node through the prestige extension. " +
    "updateScheduleForNode sets schedule timestamps and reeffect intervals through the schedules " +
    "extension. getApi performs outbound GET requests with a blocklist that prevents SSRF attacks " +
    "against localhost, private IPs, and the land's own domain. All mutation functions are " +
    "serialized through a per-node queue so concurrent scripts on the same node execute their " +
    "mutations in order.\n\n" +
    "The AI interacts with scripts through four MCP tools. javascript-scripting-orchestrator " +
    "establishes intent before any action (create, modify, or execute). node-script-runtime-" +
    "environment returns documentation of the sandbox API so the AI can write correct code. " +
    "update-node-script creates or edits a script. execute-node-script runs a script after " +
    "confirmation. The enrichContext hook injects the script list into AI context so the model " +
    "knows what scripts exist on the current node. Every script creation, edit, and execution " +
    "is logged as a contribution with full audit trail. Energy metering charges for both edits " +
    "and executions when the energy extension is installed. CLI commands expose script listing, " +
    "viewing, and execution without going through the AI.",

  npm: ["axios@^1.12.2"],

  needs: {
    services: ["contributions", "hooks"],
    models: ["Node", "Contribution"],
  },

  optional: {
    services: ["energy"],
    extensions: ["values", "prestige", "schedules", "html-rendering"],
  },

  provides: {
    models: {},
    routes: "./routes.js",
    tools: true,
    jobs: false,
    orchestrator: false,
    energyActions: {
      script: { cost: 2 },
    },
    sessionTypes: {},
    schemaVersion: 1,
    migrations: "./migrations.js",
    cli: [
      { command: "scripts", description: "List scripts on current node", method: "GET", endpoint: "/node/:nodeId/scripts/help" },
      { command: "script <id>", description: "View a script", method: "GET", endpoint: "/node/:nodeId/script/:id" },
      { command: "run <id>", description: "Execute a script", method: "POST", endpoint: "/node/:nodeId/script/:id/execute" },
    ],
    hooks: {
      fires: [],
      listens: ["enrichContext"],
    },
  },
};
