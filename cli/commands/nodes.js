const chalk = require("chalk");
const { load, requireAuth, currentNodeId, hasExtension } = require("../config");
const { getChildren, findChild, parseDate, getApi } = require("../helpers");

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

function addTypeFlags(cmd) {
  return cmd
    .option("--type <type>", "Set node type (any string)")
    .option("--goal", "Set type to goal")
    .option("--plan", "Set type to plan")
    .option("--task", "Set type to task")
    .option("--knowledge", "Set type to knowledge")
    .option("--resource", "Set type to resource")
    .option("--identity", "Set type to identity");
}

module.exports = (program) => {
  const cfg = load();

  addTypeFlags(
  program
    .command("mkdir [name...]")
    .description("Create child node(s). Comma-separate for multiple: mkdir foo, bar, baz")
  ).action(async (parts, opts) => {
      if (!parts || !parts.length) return console.log(chalk.yellow("Usage: mkdir <name>"));
      const raw = parts.join(" ");
      const names = raw.split(",").map(n => n.trim()).filter(Boolean);
      const cfg = requireAuth();
      if (!cfg.activeRootId)
        return console.log(chalk.yellow("No tree selected. Run: use <name>, roots, or mkroot <name>"));
      const api = getApi(cfg);
      const type = resolveType(opts);
      try {
        const nodeId = currentNodeId(cfg);
        for (const name of names) {
          const data = await api.createChild(nodeId, name, type);
          const id = data.node?._id || data._id || "";
          const typeHint = type ? chalk.dim(` (${type})`) : "";
          console.log(chalk.green(`✓ Created "${name}"`) + typeHint + "  " + chalk.dim(id));
        }
      } catch (e) {
        console.error(chalk.red(e.message));
      }
    });

  program
    .command("rm [nameOrId]")
    .description("Delete a child node by name or ID. -f skip confirmation")
    .option("-f, --force", "Skip confirmation")
    .action(async (name, { force }) => {
      if (!name) return console.log(chalk.yellow("Usage: rm <name> -f"));
      const cfg = requireAuth();
      if (!cfg.activeRootId)
        return console.log(chalk.yellow("No tree selected. Run: use <name>, roots, or mkroot <name>"));
      const api = getApi(cfg);
      try {
        const nodeId = currentNodeId(cfg);
        const data = await api.getNode(nodeId);
        const children = getChildren(data);
        const target = findChild(children, name);
        if (!target) return;

        if (!force) {
          console.log(
            chalk.yellow(
              `Delete "${name}" (${target._id})? This is a soft delete. Pass -f to confirm.`,
            ),
          );
          return;
        }

        await api.deleteNode(target._id);
        console.log(chalk.green(`✓ Deleted "${name}"`));
      } catch (e) {
        console.error(chalk.red(e.message));
      }
    });

  program
    .command("mv [nameOrId] [destNodeId]")
    .description("Move a child node to a new parent")
    .action(async (nodeName, destNodeId) => {
      if (!nodeName || !destNodeId) return console.log(chalk.yellow("Usage: mv <name> <destNodeId>"));
      const cfg = requireAuth();
      if (!cfg.activeRootId)
        return console.log(chalk.yellow("No tree selected. Run: use <name>, roots, or mkroot <name>"));
      const api = getApi(cfg);
      try {
        const nodeId = currentNodeId(cfg);
        const data = await api.getNode(nodeId);
        const children = getChildren(data);
        const target = findChild(children, nodeName);
        if (!target) return;

        await api.moveNode(target._id, destNodeId);
        console.log(chalk.green(`✓ Moved "${nodeName}" → ${destNodeId}`));
      } catch (e) {
        console.error(chalk.red(e.message));
      }
    });

  program
    .command("rename [nameOrId] [newName]")
    .description("Rename a child node")
    .action(async (oldName, newName) => {
      if (!oldName || !newName) return console.log(chalk.yellow("Usage: rename <name> <newName>"));
      const cfg = requireAuth();
      if (!cfg.activeRootId)
        return console.log(chalk.yellow("No tree selected. Run: use <name>, roots, or mkroot <name>"));
      const api = getApi(cfg);
      try {
        const nodeId = currentNodeId(cfg);
        const data = await api.getNode(nodeId);
        const children = getChildren(data);
        const target = findChild(children, oldName);
        if (!target) return;

        await api.renameNode(target._id, newName);
        console.log(chalk.green(`✓ Renamed "${oldName}" → "${newName}"`));
      } catch (e) {
        console.error(chalk.red(e.message));
      }
    });

  program
    .command("what")
    .alias("node")
    .description("Show details of the current node")
    .action(async () => {
      const cfg = requireAuth();
      if (!cfg.activeRootId)
        return console.log(chalk.yellow("No tree selected. Run: use <name>, roots, or mkroot <name>"));
      const api = getApi(cfg);
      try {
        const nodeId = currentNodeId(cfg);
        const data = await api.getNode(nodeId);
        const node = data.node || data;
        // Flat schema: status on node, values/goals/schedule in metadata
        const meta = node.metadata || {};
        const values = meta.values || node.values || {};
        const goals = meta.goals || node.goals || {};

        console.log(chalk.bold(node.name));
        console.log(chalk.dim("ID:       ") + node._id);
        console.log(chalk.dim("Type:     ") + (node.type || "none"));
        console.log(chalk.dim("Status:   ") + (node.status || "active"));

        if (meta.schedule) {
          console.log(chalk.dim("Schedule: ") + new Date(meta.schedule).toLocaleString());
          if (meta.reeffectTime) console.log(chalk.dim("Reeffect: ") + meta.reeffectTime + "h");
        }
        const valKeys = Object.keys(values);
        if (valKeys.length > 0) {
          console.log(chalk.dim("\nValues:"));
          for (const k of valKeys) {
            const goal = goals?.[k];
            const line = `  ${k}: ${values[k]}` + (goal !== undefined ? ` / ${goal}` : "");
            console.log(line);
          }
        }

        const children = getChildren(data);
        if (children.length > 0) {
          console.log(chalk.dim(`\nChildren: ${children.length}`));
          for (const c of children.slice(0, 10)) {
            console.log(`  ${c.name || c._id}`);
          }
          if (children.length > 10) console.log(chalk.dim(`  ... and ${children.length - 10} more`));
        }
      } catch (e) {
        console.error(chalk.red(e.message));
      }
    });

  program
    .command("type [newType]")
    .description("Set or clear the current node's type (goal, plan, task, knowledge, resource, identity, or custom)")
    .action(async (newType) => {
      const cfg = requireAuth();
      if (!cfg.activeRootId)
        return console.log(chalk.yellow("No tree selected. Run: use <name>, roots, or mkroot <name>"));
      const api = getApi(cfg);
      try {
        const nodeId = currentNodeId(cfg);
        if (!newType) {
          // Show current type
          const data = await api.getNode(nodeId);
          const node = data.node || data;
          console.log(node.type ? chalk.green(node.type) : chalk.dim("none"));
          return;
        }
        const typeVal = newType === "none" || newType === "null" || newType === "clear" ? null : newType;
        await api.post(`/node/${nodeId}/editType`, { type: typeVal });
        console.log(chalk.green(`✓ Type ${typeVal ? `set to "${typeVal}"` : "cleared"}`));
      } catch (e) {
        console.error(chalk.red(e.message));
      }
    });

  // ── Deleted/Revive (extension: deleted-revive) ──
  if (hasExtension(cfg, "deleted-revive")) {
  program
    .command("deleted")
    .description("List your deleted branches")
    .action(async () => {
      const cfg = requireAuth();
      const api = getApi(cfg);
      try {
        const data = await api.getDeleted(cfg.userId);
        const branches = data.deleted || [];
        if (!Array.isArray(branches) || branches.length === 0) {
          return console.log(chalk.dim("No deleted branches."));
        }
        for (const b of branches) {
          console.log(chalk.yellow(b.name || "unnamed") + "  " + chalk.dim(b._id));
        }
      } catch (e) {
        console.error(chalk.red(e.message));
      }
    });

  program
    .command("revive [deletedId] [target]")
    .description("Revive a deleted branch. Target is a parent node ID, or 'root' to make it a new tree.")
    .action(async (deletedId, target) => {
      if (!deletedId || !target) return console.log(chalk.yellow("Usage: revive <deletedId> <parentNodeId>  or  revive <deletedId> root"));
      const cfg = requireAuth();
      const api = getApi(cfg);
      try {
        if (target === "root") {
          await api.reviveAsRoot(cfg.userId, deletedId);
          console.log(chalk.green("✓ Revived as new tree"));
        } else {
          await api.revive(cfg.userId, deletedId, target);
          console.log(chalk.green(`✓ Revived under ${target}`));
        }
      } catch (e) {
        console.error(chalk.red(e.message));
      }
    });
  } // end deleted-revive extension

  for (const [cmd, stat] of [["complete", "completed"], ["activate", "active"], ["trim", "trimmed"]]) {
    program
      .command(cmd)
      .description(`Set current node and all children to ${stat}`)
      .action(async () => {
        const cfg = requireAuth();
        if (!cfg.activeRootId)
          return console.log(chalk.yellow("No tree selected. Run: use <name>, roots, or mkroot <name>"));
        const api = getApi(cfg);
        try {
          const nodeId = currentNodeId(cfg);
          await api.setStatus(nodeId, stat);
          console.log(chalk.green(`✓ ${stat} (recursive)`));
        } catch (e) {
          console.error(chalk.red(e.message));
        }
      });
  }

  // ── Schedule (extension: schedules) ──
  if (hasExtension(cfg, "schedules")) {
  program
    .command("schedule [args...]")
    .description("Set schedule on the current node (e.g. 1/11/2025 3, 1/11/2025 11:45pm 5, or 'clear')")
    .action(async (args) => {
      if (!args || !args.length) return console.log(chalk.yellow("Usage: schedule <date> [time] [reeffect] or schedule clear"));
      const raw = args.join(" ");
      const cfg = requireAuth();
      if (!cfg.activeRootId)
        return console.log(chalk.yellow("No tree selected. Run: use <name>, roots, or mkroot <name>"));
      const api = getApi(cfg);
      try {
        const nodeId = currentNodeId(cfg);
        if (raw === "clear") {
          await api.setSchedule(nodeId, null, 0);
          return console.log(chalk.green("✓ Schedule cleared"));
        }

        let reeffect = 0;
        const last = args[args.length - 1];
        const dateParts = [...args];
        if (/^\d+$/.test(last) && args.length > 1) {
          reeffect = Number(dateParts.pop());
        }

        const schedule = parseDate(dateParts.join(" "));
        await api.setSchedule(nodeId, schedule, reeffect);
        console.log(
          chalk.green(`✓ Scheduled for ${new Date(schedule).toLocaleString()}`) +
            (reeffect ? chalk.dim(` (reeffect: ${reeffect}h)`) : ""),
        );
      } catch (e) {
        console.error(chalk.red(e.message));
      }
    });
  } // end schedules extension

  // ── Prestige (extension: prestige) ──
  if (hasExtension(cfg, "prestige")) {
  program
    .command("prestige")
    .description("Prestige the node you are in (create a new version)")
    .action(async () => {
      const cfg = requireAuth();
      if (!cfg.activeRootId)
        return console.log(chalk.yellow("No tree selected. Run: use <name>, roots, or mkroot <name>"));
      const api = getApi(cfg);
      try {
        const nodeId = currentNodeId(cfg);
        const data = await api.prestige(nodeId);
        console.log(chalk.green("✓ Prestiged"));
      } catch (e) {
        console.error(chalk.red(e.message));
      }
    });
  } // end prestige extension
};
