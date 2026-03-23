export default {
  name: "console",
  version: "1.0.0",
  description: "Formatted log output with three severity levels for clean server monitoring",

  needs: {},

  optional: {},

  provides: {
    models: {},
    routes: false,
    tools: false,
    jobs: false,
    env: [
      { key: "LOG_LEVEL", required: false, default: "2", description: "Log severity: 1=info, 2=verbose, 3=debug" },
    ],
    cli: [
      { command: "log-level <level>", description: "Set log level (1=info, 2=verbose, 3=debug)", method: "POST", endpoint: "/land/log-level", body: ["level"] },
    ],
  },
};
