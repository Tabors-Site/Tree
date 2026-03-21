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
  const configCmd = program
    .command("config")
    .description("View and manage Land configuration");

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
    .command("get <key>")
    .description("Get a single config value")
    .action(async (key) => {
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
    .command("set <key> <value>")
    .description("Set a config value (admin only)")
    .action(async (key, value) => {
      try {
        const api = getApi();
        await api.setLandConfig(key, value);
        console.log(chalk.green(`Set ${key} = ${value}`));
      } catch (e) {
        console.error(chalk.red("Error:"), e.message);
      }
    });

  configCmd
    .command("connect <url>")
    .description("Set the Land URL to connect to")
    .action((url) => {
      try {
        const cfg = load();
        cfg.landUrl = url.replace(/\/+$/, "");
        save(cfg);
        console.log(chalk.green(`Connected to ${cfg.landUrl}`));
      } catch (e) {
        console.error(chalk.red("Error:"), e.message);
      }
    });

  // Default action when just `treeos config` is run (no subcommand)
  configCmd.action(async () => {
    try {
      const cfg = load();
      console.log(chalk.dim(`Land URL: ${cfg.landUrl || "https://treeOS.ai"}\n`));
      await showConfig();
    } catch (e) {
      console.error(chalk.red("Error:"), e.message);
    }
  });
};
