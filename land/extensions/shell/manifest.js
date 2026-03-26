export default {
  name: "shell",
  version: "1.0.0",
  description:
    "Gives the AI direct shell access to the land server. The execute-shell tool runs " +
    "any command through Node.js child_process with a 30 second timeout and 8KB output " +
    "cap. Admin-only: the handler checks user.isAdmin before every execution and rejects " +
    "all non-admin callers. A regex blocklist prevents the most destructive patterns " +
    "(rm -rf, fork bombs, disk writes, firewall flushes, pipe-to-shell curls, password " +
    "changes, service shutdowns) even for admins. Everything else is allowed. The AI can " +
    "inspect logs, restart processes, check disk usage, run database queries, install " +
    "packages, or do anything the server user can do. Every command is logged with the " +
    "user ID. Confined scope by default: must be explicitly allowed on nodes where you " +
    "want it. A DevOps branch might allow shell while the rest of the tree never sees it. " +
    "This is the escape hatch. When the extension system is not enough, shell is.",

  needs: {
    models: ["User"],
  },

  optional: {},

  provides: {
    models: {},
    routes: false,
    tools: true,
    jobs: false,
    orchestrator: false,
    energyActions: {},
    sessionTypes: {},
    cli: [],
  },
};
