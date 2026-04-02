const chalk = require("chalk");
const TreeAPI = require("../api");
const { load, save, requireAuth } = require("../config");
const { findChild } = require("../helpers");
const { printTable } = require("../display");

function resolveType(opts) {
  if (opts.type) return opts.type;
  if (opts.goal) return "goal";
  if (opts.plan) return "plan";
  if (opts.task) return "task";
  if (opts.knowledge) return "knowledge";
  if (opts.resource) return "resource";
  if (opts.identity) return "identity";
  return null;
}

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
        printTable(
          roots.map((r) => ({
            name: r.name,
            visibility: r.visibility === "public" ? "public" : "private",
            _id: r._id,
          })),
          [
            { key: "name", label: "Name", width: 24 },
            { key: "visibility", label: "Visibility", width: 10 },
            { key: "_id", label: "ID", width: 28 },
          ],
        );
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
        const root = await findChild(roots, nameOrId);
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
        const root = await findChild(roots, nameOrId);
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
    .option("--type <type>", "Set node type (any string)")
    .option("--goal", "Set type to goal")
    .option("--plan", "Set type to plan")
    .option("--task", "Set type to task")
    .option("--knowledge", "Set type to knowledge")
    .option("--resource", "Set type to resource")
    .option("--identity", "Set type to identity")
    .action(async (parts, opts) => {
      if (!parts || !parts.length) return console.log(chalk.yellow("Usage: mkroot <name>"));
      const name = parts.join(" ");
      const cfg = requireAuth();
      const api = new TreeAPI(cfg.apiKey);
      const type = resolveType(opts);
      try {
        const data = await api.createRoot(cfg.userId, name, type);
        const typeHint = type ? chalk.dim(` (${type})`) : "";
        console.log(
          chalk.green(`✓ Created tree "${name}"`) + typeHint + "  " +
            chalk.dim(data.root?._id || ""),
        );
      } catch (e) {
        console.error(chalk.red(e.message));
      }
    });

  program
    .command("retire [nameOrId...]")
    .alias("leave")
    .description("Leave a shared tree, or delete if you are the sole owner. -f skip confirmation")
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
          const root = await findChild(roots, nameOrId);
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
    .description("Go to /~ (your trees across all lands)")
    .action(() => {
      const cfg = requireAuth();
      cfg.activeRootId = null;
      cfg.activeRootName = null;
      cfg.pathStack = [];
      cfg.isSystemRoot = false;
      cfg.remoteDomain = null;
      cfg.atHome = true;
      save(cfg);
      console.log(chalk.green("~ home"));
    });
};
