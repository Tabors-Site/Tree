const chalk = require("chalk");
const { load, requireAuth, hasExtension } = require("../config");
const { getApi } = require("../helpers");

module.exports = (program) => {
  const cfg = load();
  if (!hasExtension(cfg, "api-keys")) return;

  program
    .command("api-keys [action] [args...]")
    .description("Manage API keys: list, create [name], revoke <id>")
    .action(async (action, args) => {
      const cfg = requireAuth();
      const api = getApi(cfg);

      // Default: list
      if (!action || action === "list" || action === "ls") {
        try {
          const keys = await api.listApiKeys(cfg.userId);
          const list = Array.isArray(keys) ? keys : keys.apiKeys || [];
          if (!list.length) {
            console.log(chalk.dim("No API keys. Run 'api-keys create' to make one."));
            return;
          }
          console.log(chalk.bold(`API Keys (${list.length})\n`));
          for (const k of list) {
            const status = k.revoked ? chalk.red(" (revoked)") : chalk.green(" (active)");
            const usage = k.usageCount ? chalk.dim(` ${k.usageCount} uses`) : "";
            console.log(`  ${chalk.cyan(k.name || "Unnamed")}${status}${usage}`);
            console.log(`    ${chalk.dim("id:")} ${k.id || k._id}`);
            if (k.createdAt) console.log(`    ${chalk.dim("created:")} ${new Date(k.createdAt).toLocaleDateString()}`);
            console.log();
          }
        } catch (e) {
          console.error(chalk.red(e.message));
        }
        return;
      }

      if (action === "create" || action === "new") {
        const name = args.length ? args.join(" ") : "CLI Key";
        try {
          const data = await api.createApiKey(cfg.userId, name);
          console.log(chalk.green(`Created: ${name}`));
          const key = data.apiKey || data.key;
          if (key) {
            console.log(chalk.bold("\nYour API key (shown once, save it now):"));
            console.log(`  ${chalk.cyan(key)}\n`);
          }
        } catch (e) {
          console.error(chalk.red(e.message));
        }
        return;
      }

      if (action === "revoke" || action === "rm" || action === "delete") {
        const keyId = args[0];
        if (!keyId) return console.log(chalk.yellow("Usage: api-keys revoke <keyId>. Run 'api-keys' to see IDs."));
        try {
          await api.deleteApiKey(cfg.userId, keyId);
          console.log(chalk.green("Key revoked."));
        } catch (e) {
          console.error(chalk.red(e.message));
        }
        return;
      }

      console.log(chalk.yellow(`Unknown action: ${action}. Run 'api-keys' for help.`));
    });
};
