const chalk = require("chalk");
const TreeAPI = require("../api");
const { load, save, requireAuth } = require("../config");
const { findChild } = require("../helpers");
const { printTable } = require("../display");

module.exports = (program) => {
  program
    .command("roots")
    .description("List all your root trees")
    .action(async () => {
      const cfg = requireAuth();
      const api = new TreeAPI(cfg.apiKey);
      try {
        const data = await api.getUser(cfg.userId);
        const roots = data.roots || data.user?.roots || [];
        if (!roots.length)
          return console.log(chalk.dim("No trees yet. Run: tree mkroot <name>"));
        printTable(roots, [
          { key: "name", label: "Name", width: 24 },
          { key: "_id", label: "ID", width: 28 },
        ]);
      } catch (e) {
        console.error(chalk.red(e.message));
      }
    });

  program
    .command("use [nameOrId...]")
    .description("Switch active root tree by name or ID")
    .action(async (parts) => {
      if (!parts || !parts.length) return console.log(chalk.yellow("Usage: use <tree name>"));
      const nameOrId = parts.join(" ");
      const cfg = requireAuth();
      const api = new TreeAPI(cfg.apiKey);
      try {
        const data = await api.getUser(cfg.userId);
        const roots = data.roots || data.user?.roots || [];
        const root = findChild(roots, nameOrId);
        if (!root) return;
        cfg.activeRootId = root._id;
        cfg.activeRootName = root.name;
        cfg.pathStack = [];
        save(cfg);
        console.log(chalk.green(`✓ Switched to "${root.name}"`));
      } catch (e) {
        console.error(chalk.red(e.message));
      }
    });

  program
    .command("root [nameOrId...]")
    .description("Switch active root tree by name or ID (alias for use)")
    .action(async (parts) => {
      if (!parts || !parts.length) return console.log(chalk.yellow("Usage: root <tree name>"));
      const nameOrId = parts.join(" ");
      const cfg = requireAuth();
      const api = new TreeAPI(cfg.apiKey);
      try {
        const data = await api.getUser(cfg.userId);
        const roots = data.roots || data.user?.roots || [];
        const root = findChild(roots, nameOrId);
        if (!root) return;
        cfg.activeRootId = root._id;
        cfg.activeRootName = root.name;
        cfg.pathStack = [];
        save(cfg);
        console.log(chalk.green(`✓ Switched to "${root.name}"`));
      } catch (e) {
        console.error(chalk.red(e.message));
      }
    });

  program
    .command("mkroot [name...]")
    .description("Create a new root tree")
    .action(async (parts) => {
      if (!parts || !parts.length) return console.log(chalk.yellow("Usage: mkroot <name>"));
      const name = parts.join(" ");
      const cfg = requireAuth();
      const api = new TreeAPI(cfg.apiKey);
      try {
        const data = await api.createRoot(cfg.userId, name);
        console.log(
          chalk.green(`✓ Created tree "${name}"  `) +
            chalk.dim(data.root?._id || ""),
        );
      } catch (e) {
        console.error(chalk.red(e.message));
      }
    });

  program
    .command("retire [nameOrId...]")
    .alias("leave")
    .description("Leave a shared tree, or delete if you are the sole owner. Name optional if inside a tree")
    .option("-f, --force", "Skip confirmation")
    .action(async (parts, opts) => {
      const cfg = requireAuth();
      const api = new TreeAPI(cfg.apiKey);
      try {
        let rootId, rootName;
        if (parts && parts.length) {
          const nameOrId = parts.join(" ");
          const data = await api.getUser(cfg.userId);
          const roots = data.roots || data.user?.roots || [];
          const root = findChild(roots, nameOrId);
          if (!root) return;
          rootId = root._id;
          rootName = root.name;
        } else if (cfg.activeRootId) {
          rootId = cfg.activeRootId;
          rootName = cfg.activeRootName || rootId;
        } else {
          return console.log(chalk.yellow("Specify a tree name, or enter a tree first."));
        }
        if (!opts.force) {
          return console.log(
            chalk.yellow(`Are you sure? Run: retire ${rootName} -f`),
          );
        }
        await api.retireRoot(rootId);
        console.log(chalk.green(`✓ Retired "${rootName}"`));
        if (cfg.activeRootId === rootId) {
          cfg.activeRootId = null;
          cfg.activeRootName = null;
          cfg.pathStack = [];
          save(cfg);
        }
      } catch (e) {
        console.error(chalk.red(e.message));
      }
    });

  program
    .command("home")
    .description("Leave the current tree and go back to user home")
    .action(() => {
      const cfg = requireAuth();
      cfg.activeRootId = null;
      cfg.activeRootName = null;
      cfg.pathStack = [];
      save(cfg);
      console.log(chalk.green("✓ Back at home (no tree selected)"));
    });
};
