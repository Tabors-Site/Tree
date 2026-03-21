const chalk = require("chalk");
const { requireAuth, currentNodeId } = require("../config");
const { getChildren, findChild, parseDate, getApi } = require("../helpers");

module.exports = (program) => {
  program
    .command("mkdir [name...]")
    .description("Create child node(s). Comma-separate for multiple: mkdir foo, bar, baz")
    .action(async (parts) => {
      if (!parts || !parts.length) return console.log(chalk.yellow("Usage: mkdir <name>"));
      const raw = parts.join(" ");
      const names = raw.split(",").map(n => n.trim()).filter(Boolean);
      const cfg = requireAuth();
      if (!cfg.activeRootId)
        return console.log(chalk.yellow("No tree selected. Run: use <name>, roots, or mkroot <name>"));
      const api = getApi(cfg);
      try {
        const nodeId = currentNodeId(cfg);
        for (const name of names) {
          const data = await api.createChild(nodeId, name);
          const id = data.node?._id || data._id || "";
          console.log(chalk.green(`✓ Created "${name}"`) + "  " + chalk.dim(id));
        }
      } catch (e) {
        console.error(chalk.red(e.message));
      }
    });

  program
    .command("rm [nameOrId]")
    .description("Delete a child node by name or ID")
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

        await api.renameNode(target._id, "latest", newName);
        console.log(chalk.green(`✓ Renamed "${oldName}" → "${newName}"`));
      } catch (e) {
        console.error(chalk.red(e.message));
      }
    });

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
          await api.setStatus(nodeId, "latest", stat);
          console.log(chalk.green(`✓ ${stat} (recursive)`));
        } catch (e) {
          console.error(chalk.red(e.message));
        }
      });
  }

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
          await api.setSchedule(nodeId, "latest", null, 0);
          return console.log(chalk.green("✓ Schedule cleared"));
        }

        let reeffect = 0;
        const last = args[args.length - 1];
        const dateParts = [...args];
        if (/^\d+$/.test(last) && args.length > 1) {
          reeffect = Number(dateParts.pop());
        }

        const schedule = parseDate(dateParts.join(" "));
        await api.setSchedule(nodeId, "latest", schedule, reeffect);
        console.log(
          chalk.green(`✓ Scheduled for ${new Date(schedule).toLocaleString()}`) +
            (reeffect ? chalk.dim(` (reeffect: ${reeffect}h)`) : ""),
        );
      } catch (e) {
        console.error(chalk.red(e.message));
      }
    });

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
        const ver = data.version ?? data.newVersion ?? "";
        console.log(chalk.green(`✓ Prestiged`) + (ver !== "" ? `  ${chalk.dim("version " + ver)}` : ""));
      } catch (e) {
        console.error(chalk.red(e.message));
      }
    });
};
