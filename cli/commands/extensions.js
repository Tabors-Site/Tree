const chalk = require("chalk");
const TreeAPI = require("../api");
const { requireAuth } = require("../config");

function getApi() {
  const cfg = requireAuth();
  return new TreeAPI(cfg.apiKey);
}

module.exports = (program) => {
  const ext = program
    .command("ext")
    .description("Manage land extensions")
    .action(() => {
      ext.outputHelp();
    });

  ext
    .command("list")
    .alias("ls")
    .description("List all loaded extensions")
    .action(async () => {
      try {
        const api = getApi();
        const data = await api.getExtensions();

        if (!data.loaded || data.loaded.length === 0) {
          console.log(chalk.dim("No extensions loaded."));
          return;
        }

        console.log(chalk.bold(`Extensions (${data.count} loaded)\n`));

        for (const ext of data.loaded) {
          const parts = [];
          if (ext.provides.routes) parts.push("routes");
          if (ext.provides.tools) parts.push("tools");
          if (ext.provides.jobs) parts.push("jobs");
          if (ext.provides.models.length) parts.push(`${ext.provides.models.length} models`);

          const badges = parts.length ? chalk.dim(` [${parts.join(", ")}]`) : "";
          console.log(`  ${chalk.cyan(ext.name)} ${chalk.dim("v" + ext.version)}${badges}`);
          console.log(`  ${chalk.dim(ext.description)}`);

          if (ext.needs.extensions?.length) {
            console.log(`  ${chalk.dim("depends on:")} ${ext.needs.extensions.join(", ")}`);
          }
          console.log();
        }

        if (data.disabled.length > 0) {
          console.log(chalk.yellow("Disabled:"), data.disabled.join(", "));
        }
      } catch (err) {
        console.error(chalk.red("Error:"), err.message);
      }
    });

  ext
    .command("info <name>")
    .description("Show details for an extension")
    .action(async (name) => {
      try {
        const api = getApi();
        const data = await api.getExtension(name);

        if (!data.manifest) {
          console.log(chalk.red(`Extension "${name}" not found.`));
          return;
        }

        const m = data.manifest;
        console.log(chalk.bold(m.name), chalk.dim("v" + m.version));
        console.log(m.description);
        console.log();

        if (m.needs) {
          console.log(chalk.bold("Requires:"));
          if (m.needs.services?.length) console.log(`  services: ${m.needs.services.join(", ")}`);
          if (m.needs.models?.length) console.log(`  models: ${m.needs.models.join(", ")}`);
          if (m.needs.extensions?.length) console.log(`  extensions: ${m.needs.extensions.join(", ")}`);
          console.log();
        }

        if (m.optional?.services?.length || m.optional?.extensions?.length) {
          console.log(chalk.bold("Optional:"));
          if (m.optional.services?.length) console.log(`  services: ${m.optional.services.join(", ")}`);
          if (m.optional.extensions?.length) console.log(`  extensions: ${m.optional.extensions.join(", ")}`);
          console.log();
        }

        if (m.provides) {
          console.log(chalk.bold("Provides:"));
          if (m.provides.routes) console.log("  routes");
          if (m.provides.models && Object.keys(m.provides.models).length) {
            console.log(`  models: ${Object.keys(m.provides.models).join(", ")}`);
          }
          if (m.provides.energyActions && Object.keys(m.provides.energyActions).length) {
            console.log(`  energy actions: ${Object.keys(m.provides.energyActions).join(", ")}`);
          }
          if (m.provides.sessionTypes && Object.keys(m.provides.sessionTypes).length) {
            console.log(`  session types: ${Object.keys(m.provides.sessionTypes).join(", ")}`);
          }
        }
      } catch (err) {
        console.error(chalk.red("Error:"), err.message);
      }
    });

  ext
    .command("disable <name>")
    .description("Disable an extension (takes effect on restart)")
    .action(async (name) => {
      try {
        const api = getApi();
        const data = await api.disableExtension(name);
        console.log(chalk.yellow(`Disabled: ${name}`));
        console.log(chalk.dim("Restart the land for this to take effect."));
        if (data.disabledExtensions?.length) {
          console.log(chalk.dim("Currently disabled:"), data.disabledExtensions.join(", "));
        }
      } catch (err) {
        console.error(chalk.red("Error:"), err.message);
      }
    });

  ext
    .command("enable <name>")
    .description("Re-enable a disabled extension (takes effect on restart)")
    .action(async (name) => {
      try {
        const api = getApi();
        const data = await api.enableExtension(name);
        console.log(chalk.green(`Enabled: ${name}`));
        console.log(chalk.dim("Restart the land for this to take effect."));
      } catch (err) {
        console.error(chalk.red("Error:"), err.message);
      }
    });
};
