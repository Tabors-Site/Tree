const chalk = require("chalk");
const TreeAPI = require("../api");
const { load, save, requireAuth, currentNodeId, currentZone } = require("../config");
const { registerDynamic } = require("./dynamic");

function getApi() {
  const cfg = requireAuth();
  return new TreeAPI(cfg.apiKey);
}

async function showConfig() {
  const api = getApi();
  const data = await api.getLandConfig();
  const config = data.config || {};
  const keys = Object.keys(config);

  if (!keys.length) {
    console.log(chalk.dim("No config values set."));
    return;
  }

  console.log(chalk.bold("Land Configuration\n"));
  for (const key of keys.sort()) {
    const val = config[key];
    const display = val === null ? chalk.dim("(not set)") : String(val);
    console.log(`  ${chalk.cyan(key)}  ${display}`);
  }
}

function printAllByZone(program) {
  const PAD = 30;
  const RULE = chalk.dim("-".repeat(55));
  const zone = currentZone(load());

  const zoneLabel = { land: "Land", home: "Home", tree: "Tree" };
  const zoneColor = { land: chalk.yellow, home: chalk.blue, tree: chalk.green };
  const groups = { land: [], home: [], tree: [], all: [] };

  for (const cmd of program.commands) {
    const scope = cmd._scope;
    if (!scope) {
      groups.all.push(cmd);
    } else {
      for (const z of scope) {
        if (groups[z]) groups[z].push(cmd);
      }
    }
  }

  const fmtLine = (c) => {
    const usage = (c.name() + " " + c.usage()).replace(/ \[options\]/g, "").trim();
    const desc = c.description().replace(/\s*\[.*?\]\s*$/, "").trim();
    const padded = usage.length < PAD ? usage + " ".repeat(PAD - usage.length) : usage + "  ";
    return `  ${padded}${chalk.dim(desc)}`;
  };

  console.log(chalk.bold("All commands by zone") + chalk.dim(`  (you are at ${zone})`));
  console.log("");

  for (const z of ["land", "home", "tree", "all"]) {
    const cmds = groups[z];
    if (cmds.length === 0) continue;
    const color = zoneColor[z] || chalk.white;
    const label = z === "all" ? "Everywhere" : `${zoneLabel[z]} (${z === "land" ? "/" : z === "home" ? "/~" : "/tree"})`;
    const marker = z === zone ? " <-- you are here" : "";
    console.log(color.bold(label) + chalk.dim(marker));
    cmds.sort((a, b) => a.name().localeCompare(b.name()));
    for (const c of cmds) console.log(fmtLine(c));
    console.log(RULE);
  }
}

module.exports = (program) => {
  // Top-level connect command — first thing a user runs
  program
    .command("connect [url]")
    .description("Set the Land URL to connect to (e.g. http://localhost:3000)")
    .action(async (url) => {
      if (!url) return console.log(chalk.yellow("Usage: connect <url>  (e.g. connect http://localhost:3000)"));
      try {
        const cfg = load();
        cfg.landUrl = url.replace(/\/+$/, "");
        if (!/^https?:\/\//i.test(cfg.landUrl)) cfg.landUrl = `https://${cfg.landUrl}`;

        // Fetch land protocol info
        try {
          const res = await fetch(`${cfg.landUrl}/api/v1/protocol`);
          if (res.ok) {
            const raw = await res.json();
            const protocol = raw.data || raw;
            cfg.landProtocol = protocol;
            console.log(
              chalk.green(`Connected to ${cfg.landUrl}`) +
              chalk.dim(` (${protocol.name || "TreeOS"} v${protocol.version || "?"}, ${(protocol.capabilities || []).length} capabilities, ${(protocol.extensions || []).length} extensions)`)
            );
          } else {
            cfg.landProtocol = null;
            console.log(chalk.green(`Connected to ${cfg.landUrl}`));
            console.log(chalk.dim("  Land does not serve /protocol"));
          }
        } catch {
          cfg.landProtocol = null;
          console.log(chalk.green(`Connected to ${cfg.landUrl}`));
        }

        save(cfg);
        if (!cfg.apiKey) {
          console.log(chalk.dim("Next: treeos register or treeos login"));
        } else {
          console.log(chalk.dim(`  Logged in as ${cfg.username || "unknown"}`));
        }
        if (cfg.landProtocol?.cli && Object.keys(cfg.landProtocol.cli).length > 0) {
          const cmdCount = Object.keys(cfg.landProtocol.cli).reduce((n, k) => n + cfg.landProtocol.cli[k].length, 0);
          registerDynamic(program, cfg);
          console.log(chalk.dim(`  ${cmdCount} extension commands loaded.`));
        }
      } catch (e) {
        console.error(chalk.red("Error:"), e.message);
      }
    });

  // Shared: fetch and cache protocol from land
  async function refreshProtocol() {
    const cfg = load();
    let landUrl = cfg.landUrl || "https://treeOS.ai";
    if (!/^https?:\/\//i.test(landUrl)) landUrl = `https://${landUrl}`;
    const nodeId = currentNodeId(cfg);
    const qs = nodeId ? `?nodeId=${encodeURIComponent(nodeId)}` : "";
    const res = await fetch(`${landUrl}/api/v1/protocol${qs}`);
    if (!res.ok) return null;
    const raw = await res.json();
    const protocol = raw.data || raw;
    cfg.landProtocol = protocol;
    save(cfg);
    return { cfg, landUrl, protocol };
  }

  // help: silently refresh protocol, then show normal program help
  // help --all: show every command grouped by zone
  program
    .command("help")
    .option("-a, --all", "Show all commands grouped by zone")
    .description("Refresh available commands and show help.")
    .action(async (opts) => {
      try {
        await refreshProtocol();
      } catch {}
      if (opts.all) {
        printAllByZone(program);
      } else {
        program.outputHelp();
      }
    });

  // protocol: full protocol details (capabilities, extensions, command count)
  program
    .command("protocol")
    .description("Show land protocol details. Capabilities, extensions, node types, command count.")
    .action(async () => {
      try {
        const result = await refreshProtocol();
        if (!result) {
          return console.log(chalk.yellow("Could not reach land protocol endpoint."));
        }
        const { landUrl, protocol } = result;

        console.log(chalk.bold(`${protocol.name || "TreeOS"} v${protocol.version || "?"}`));
        console.log(chalk.dim(`Land: ${landUrl}\n`));

        if (protocol.capabilities?.length) {
          console.log(chalk.bold("Capabilities:"));
          console.log("  " + protocol.capabilities.join(", "));
        }

        if (protocol.nodeTypes?.length) {
          console.log(chalk.bold("\nNode Types:"));
          console.log("  " + protocol.nodeTypes.join(", "));
        }

        if (protocol.extensions?.length) {
          console.log(chalk.bold(`\nExtensions${protocol.position ? " (at this position)" : ""}:`));
          console.log("  " + protocol.extensions.join(", "));
        }

        if (protocol.cli) {
          const cmdCount = Object.values(protocol.cli).reduce((sum, cmds) => sum + cmds.length, 0);
          console.log(chalk.bold(`\nCLI Commands: ${cmdCount}`));
        }
      } catch (e) {
        console.error(chalk.red(e.message));
      }
    });

  // Config subcommand for Land runtime settings
  const configCmd = program
    .command("config [action]")
    .description("View and manage Land runtime configuration")
    .action(async (action) => {
      if (action) {
        // Unknown subcommand
        console.log(chalk.yellow(`Unknown config action "${action}". Try: config show, config get, config set`));
        return;
      }
      try {
        const cfg = load();
        console.log(chalk.dim(`Land URL: ${cfg.landUrl || "https://treeOS.ai"}\n`));
        await showConfig();
      } catch (e) {
        console.error(chalk.red("Error:"), e.message);
      }
    });

  configCmd
    .command("show")
    .description("Show all Land config values")
    .action(async () => {
      try {
        await showConfig();
      } catch (e) {
        console.error(chalk.red("Error:"), e.message);
      }
    });

  configCmd
    .command("get [key]")
    .description("Get a single config value")
    .action(async (key) => {
      if (!key) return console.log(chalk.yellow("Usage: config get <key>  (e.g. config get LAND_NAME)"));
      try {
        const api = getApi();
        const data = await api.getLandConfigValue(key);
        const val = data.value;
        if (val === null || val === undefined) {
          console.log(chalk.dim(`${key} is not set`));
        } else {
          console.log(`${chalk.cyan(key)}  ${val}`);
        }
      } catch (e) {
        console.error(chalk.red("Error:"), e.message);
      }
    });

  configCmd
    .command("set [key] [value]")
    .description("Set a config value (admin only)")
    .action(async (key, value) => {
      if (!key || !value) return console.log(chalk.yellow("Usage: config set <key> <value>  (e.g. config set LAND_NAME \"My Land\")"));
      try {
        const api = getApi();
        await api.setLandConfig(key, value);
        console.log(chalk.green(`Set ${key} = ${value}`));
      } catch (e) {
        console.error(chalk.red("Error:"), e.message);
      }
    });
};
