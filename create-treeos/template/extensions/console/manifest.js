export default {
  name: "console",
  version: "1.0.0",
  builtFor: "TreeOS",
  description:
    "Replaces the kernel's default log output with color-coded, timestamped, human-readable " +
    "server logs. Without this extension, log calls go to bare console output. With it, " +
    "every line gets a timestamp, a severity indicator, and a colored tag identifying the " +
    "source system. " +
    "\n\n" +
    "Three severity levels. Level 1 (info): bold green tags, white messages. The important " +
    "events. Extension loaded, server listening, migration complete. Level 2 (verbose): " +
    "cyan tags, normal weight. The operational detail. Route registered, hook fired, session " +
    "created. Level 3 (debug): dim text, everything. LLM call payloads, metadata writes, " +
    "cache hits. Errors and warnings always print regardless of level, in red and yellow " +
    "respectively. " +
    "\n\n" +
    "The log level is configurable at boot via the LOG_LEVEL environment variable and " +
    "adjustable at runtime through the HTTP endpoint or CLI command. Set it to 1 in " +
    "production for clean, quiet output. Set it to 3 when debugging a hook chain or " +
    "tracing an orchestrator flow. The change takes effect immediately without restart. " +
    "\n\n" +
    "This extension replaces the kernel's log formatter function at init. It does not " +
    "wrap or proxy. It provides the formatter that the kernel's log module calls on every " +
    "output. Remove this extension and the land falls back to unformatted console output. " +
    "Replace it with your own formatter for structured JSON logs, remote log shipping, or " +
    "any output format your infrastructure requires.",

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
      { command: "log-level <level>", scope: ["land"], description: "Set log level (1=info, 2=verbose, 3=debug)", method: "POST", endpoint: "/land/log-level", body: ["level"] },
    ],
  },
};
