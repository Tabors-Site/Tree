const chalk = require("chalk");
const TreeAPI = require("../api");
const { load, save, requireAuth, currentNodeId, currentPath } = require("../config");

module.exports = (program) => {
  program
    .command("login")
    .description("Authenticate with your API key")
    .requiredOption("--key <apiKey>", "Your Tree API key")
    .action(async ({ key }) => {
      try {
        const api = new TreeAPI(key);
        const me = await api.me();
        const cfg = load();
        cfg.apiKey = key;
        cfg.userId = me.userId;
        cfg.username = me.username;
        cfg.plan = me.profileType || null;
        cfg.planExpiresAt = me.planExpiresAt || null;
        cfg.shareToken = me.shareToken || null;
        cfg.energy = me.energy || null;
        cfg.pathStack = [];
        cfg.activeRootId = null;
        cfg.activeRootName = null;
        save(cfg);
        console.log(chalk.green(`✓ Logged in as ${me.username}`));
        if (me.profileType) console.log(chalk.dim(`  Plan: ${me.profileType}`));
        const data = await api.getUser(me.userId);
        const roots = data.roots || data.user?.roots || [];
        if (roots.length) {
          console.log(chalk.dim("\nYour trees:"));
          roots.forEach((r) =>
            console.log(`  ${chalk.cyan(r.name)}  ${chalk.dim(r._id)}`),
          );
          console.log(chalk.dim(`\nRun: use "<tree name>" to select one`));
        }
      } catch (e) {
        console.error(chalk.red("Login failed:"), e.message);
      }
    });

  program
    .command("logout")
    .description("Clear stored credentials")
    .action(() => {
      const cfg = load();
      cfg.apiKey = null;
      cfg.userId = null;
      cfg.pathStack = [];
      cfg.activeRootId = null;
      save(cfg);
      console.log(chalk.green("Logged out."));
    });

  program
    .command("whoami")
    .description("Show current login and active tree")
    .action(async () => {
      const cfg = load();
      if (!cfg.apiKey) return console.log(chalk.yellow("Not logged in."));
      try {
        const api = new TreeAPI(cfg.apiKey);
        const me = await api.me();
        cfg.username = me.username;
        cfg.plan = me.profileType || null;
        cfg.planExpiresAt = me.planExpiresAt || null;
        cfg.shareToken = me.shareToken || null;
        cfg.energy = me.energy || null;
        save(cfg);
      } catch (_) {}
      console.log(`User:  ${chalk.cyan(cfg.username || cfg.userId)}`);
      if (cfg.plan) console.log(`Plan:  ${chalk.cyan(cfg.plan)}${cfg.planExpiresAt ? chalk.dim(" (expires " + new Date(cfg.planExpiresAt).toLocaleDateString() + ")") : ""}`);
      if (cfg.energy) console.log(`Energy: ${chalk.cyan(cfg.energy.available)} available  ${chalk.dim(cfg.energy.additional + " additional · " + cfg.energy.total + " total")}`);
      console.log(`Tree:  ${chalk.cyan(cfg.activeRootName || chalk.dim("(none)"))}  ${chalk.dim(cfg.activeRootId || "")}`);
      console.log(`Path:  ${chalk.cyan(currentPath(cfg))}`);
    });
};
