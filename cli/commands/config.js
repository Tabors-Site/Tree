const chalk = require("chalk");
const TreeAPI = require("../api");
const { load, save, requireAuth } = require("../config");

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
            const protocol = await res.json();
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
        }
      } catch (e) {
        console.error(chalk.red("Error:"), e.message);
      }
    });

  program
    .command("protocol")
    .description("Fetch and display the connected land's protocol info")
    .action(async () => {
      try {
        const cfg = load();
        let landUrl = cfg.landUrl || "https://treeOS.ai";
        if (!/^https?:\/\//i.test(landUrl)) landUrl = `https://${landUrl}`;
        const res = await fetch(`${landUrl}/api/v1/protocol`);
        if (!res.ok) {
          return console.log(chalk.yellow(`Land at ${landUrl} does not serve /protocol (HTTP ${res.status})`));
        }
        const protocol = await res.json();

        // Cache it
        cfg.landProtocol = protocol;
        save(cfg);

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
          console.log(chalk.bold("\nExtensions:"));
          console.log("  " + protocol.extensions.join(", "));
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
