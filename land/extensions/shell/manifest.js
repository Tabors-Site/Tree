export default {
  name: "shell",
  version: "1.0.1",
  builtFor: "TreeOS",
  scope: "confined",
  description:
    "Gives the AI direct shell access to the land server. The execute-shell tool runs " +
    "any command through Node.js child_process with a 30 second timeout and 8KB output " +
    "cap. Three security layers. Layer 1: confined scope. Shell is inactive everywhere by " +
    "default. Operators explicitly allow it at specific nodes with ext-allow shell. A DevOps " +
    "branch gets shell. The rest of the tree never sees it. Layer 2: admin-only. The handler " +
    "checks user.isAdmin before every execution and rejects all non-admin callers. Layer 3: " +
    "energy metering. Each execution costs energy to prevent rapid-fire abuse. A regex " +
    "blocklist catches the most destructive patterns (rm -rf, fork bombs, disk writes, " +
    "firewall flushes, pipe-to-shell curls, password changes, service shutdowns, command " +
    "substitution) even for admins. The blocklist prevents common accidents. It is not a " +
    "sandbox. Shell access is real shell access. Confine it to positions where that is " +
    "acceptable. Every command is logged with the user ID.",

  needs: {
    models: ["User"],
  },

  optional: {
    services: ["energy"],
  },

  provides: {
    models: {},
    routes: false,
    tools: true,
    jobs: false,
    orchestrator: false,
    energyActions: {
      shellExecute: { cost: 5 },
    },
    sessionTypes: {},
    cli: [],
  },
};
