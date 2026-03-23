// cli/commands/dynamic.js
// Auto-registers CLI commands from extension manifest declarations.
// These are thin API callers. No remote code execution.

const chalk = require("chalk");
const TreeAPI = require("../api");
const { load, requireAuth, currentNodeId, getProtocolCli } = require("../config");

function getApi() {
  const cfg = requireAuth();
  return new TreeAPI(cfg.apiKey);
}

/**
 * Resolve endpoint placeholders like :nodeId, :version, :id
 * with values from the current CLI context and command args.
 */
function resolveEndpoint(endpoint, args, cfg) {
  let resolved = endpoint;

  // Replace :nodeId with current node
  if (resolved.includes(":nodeId")) {
    const nodeId = currentNodeId(cfg);
    if (!nodeId) throw new Error("Not in a tree. Navigate to a node first.");
    resolved = resolved.replace(":nodeId", nodeId);
  }

  // Replace :version with "latest"
  if (resolved.includes(":version")) {
    resolved = resolved.replace(":version", "latest");
  }

  // Replace :rootId with active root
  if (resolved.includes(":rootId")) {
    if (!cfg.activeRootId) throw new Error("Not in a tree. Navigate to a tree first.");
    resolved = resolved.replace(":rootId", cfg.activeRootId);
  }

  // Replace :userId with logged-in user
  if (resolved.includes(":userId")) {
    if (!cfg.userId) throw new Error("Not logged in.");
    resolved = resolved.replace(":userId", cfg.userId);
  }

  // Replace remaining params with positional args
  const paramPattern = /:([a-zA-Z]+)/g;
  let match;
  let argIndex = 0;
  while ((match = paramPattern.exec(resolved)) !== null) {
    if (args[argIndex] !== undefined) {
      resolved = resolved.replace(match[0], encodeURIComponent(args[argIndex]));
      argIndex++;
    }
  }

  return resolved;
}

/**
 * Pretty-print a JSON response.
 */
function printResponse(data) {
  if (typeof data === "string") {
    console.log(data);
    return;
  }

  // If it has a clear display field, show it
  if (data.answer) {
    console.log(data.answer);
    return;
  }

  // If it's an array, show as list
  if (Array.isArray(data)) {
    for (const item of data) {
      const name = item.name || item.title || item._id || "";
      const desc = item.description || item.summary || item.status || "";
      console.log(`  ${chalk.cyan(name)}${desc ? chalk.dim("  " + desc) : ""}`);
    }
    return;
  }

  // If it has a list-like field, show that
  for (const key of Object.keys(data)) {
    if (Array.isArray(data[key]) && data[key].length > 0) {
      console.log(chalk.bold(key) + ":");
      for (const item of data[key]) {
        if (typeof item === "string") {
          console.log(`  ${item}`);
        } else {
          const name = item.name || item.title || item._id || "";
          const desc = item.description || item.summary || item.status || "";
          console.log(`  ${chalk.cyan(name)}${desc ? chalk.dim("  " + desc) : ""}`);
        }
      }
      return;
    }
  }

  // Fallback: show key-value pairs
  for (const [key, val] of Object.entries(data)) {
    if (key === "success") continue;
    if (val === null || val === undefined) continue;
    if (typeof val === "object") {
      console.log(`${chalk.bold(key)}: ${JSON.stringify(val)}`);
    } else {
      console.log(`${chalk.bold(key)}: ${val}`);
    }
  }
}

/**
 * Register dynamic commands from cached protocol CLI declarations.
 * Called after all hardcoded commands are registered.
 *
 * Skips commands that match already-registered command names
 * (hardcoded commands take priority).
 */
module.exports = (program) => {
  const cfg = load();
  const cliDeclarations = getProtocolCli(cfg);

  if (!cliDeclarations || Object.keys(cliDeclarations).length === 0) return;

  // Collect existing command names to avoid conflicts
  const existing = new Set();
  for (const cmd of program.commands) {
    existing.add(cmd.name());
    for (const alias of cmd.aliases()) {
      existing.add(alias);
    }
  }

  for (const [extName, commands] of Object.entries(cliDeclarations)) {
    for (const decl of commands) {
      // Parse command name (first word before any <args>)
      const cmdName = decl.command.split(/\s+/)[0];

      // Skip if a hardcoded command already handles this
      if (existing.has(cmdName)) continue;

      // Extract arg names from the command pattern
      const argMatches = decl.command.match(/<[^>]+>/g) || [];
      const argNames = argMatches.map((a) => a.replace(/[<>]/g, ""));

      program
        .command(decl.command)
        .description(`${decl.description} ${chalk.dim(`[${extName}]`)}`)
        .action(async (...actionArgs) => {
          try {
            const api = getApi();
            const cfg = load();

            // Commander passes args then the Command object
            const args = actionArgs.slice(0, argNames.length);

            const endpoint = resolveEndpoint(decl.endpoint, args, cfg);
            const method = (decl.method || "GET").toUpperCase();

            // Build request body from manifest's body field mapping
            let body = {};
            if (decl.body && Array.isArray(decl.body)) {
              for (let i = 0; i < decl.body.length; i++) {
                if (args[i] !== undefined) {
                  body[decl.body[i]] = args[i];
                }
              }
            }

            let data;
            if (method === "GET") {
              data = await api.get(endpoint);
            } else if (method === "POST") {
              data = await api.post(endpoint, body);
            } else if (method === "PUT") {
              data = await api.put(endpoint, body);
            } else if (method === "DELETE") {
              data = await api.del(endpoint);
            } else {
              data = await api.get(endpoint);
            }

            printResponse(data);
          } catch (err) {
            console.error(chalk.red("Error:"), err.message);
          }
        });

      existing.add(cmdName);
    }
  }
};
