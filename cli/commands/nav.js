const chalk = require("chalk");
const TreeAPI = require("../api");
const { load, save, requireAuth, currentNodeId, currentPath } = require("../config");
const { getChildren, flattenTree, findChild } = require("../helpers");
const { printNode, printTable } = require("../display");

module.exports = (program) => {
  program
    .command("pwd")
    .description("Print current path")
    .action(() => {
      const cfg = requireAuth();
      if (!cfg.activeRootId)
        return console.log(
          chalk.yellow("No tree selected. Run: use <name>, roots, or mkroot <name>"),
        );
      console.log(chalk.cyan(currentPath(cfg)));
    });

  program
    .command("ls")
    .description("List children of the node you are in")
    .option("-l", "Long format with IDs and status")
    .action(async ({ l }) => {
      const cfg = requireAuth();
      const api = new TreeAPI(cfg.apiKey);
      if (!cfg.activeRootId) {
        // At home — list roots
        try {
          const data = await api.getUser(cfg.userId);
          const roots = data.roots || data.user?.roots || [];
          if (!roots.length) return console.log(chalk.dim("No trees yet. Run: mkroot <name>"));
          if (l) {
            printTable(roots, [
              { key: "name", label: "Name", width: 28 },
              { key: "_id", label: "ID", width: 28 },
            ]);
          } else {
            console.log(roots.map((r) => chalk.cyan(r.name)).join(chalk.dim("  ·  ")));
          }
        } catch (e) { console.error(chalk.red(e.message)); }
        return;
      }
      try {
        const nodeId = currentNodeId(cfg);
        const data = await api.getNode(nodeId);
        const children = getChildren(data);

        if (!children.length) return console.log(chalk.dim("  (empty)"));

        if (l) {
          printTable(children, [
            { key: "name", label: "Name", width: 28 },
            { key: "status", label: "Status", width: 12 },
            { key: "_id", label: "ID", width: 28 },
          ]);
        } else {
          const names = children.map((c) => {
            const color =
              c.status === "completed"
                ? chalk.gray
                : c.status === "trimmed"
                  ? chalk.dim
                  : chalk.cyan;
            return color(c.name);
          });
          console.log(names.join(chalk.dim("  ·  ")));
        }
      } catch (e) {
        console.error(chalk.red(e.message));
      }
    });

  program
    .command("cd [nameOrId...]")
    .description('Navigate by name or ID. Supports "..", "/", -r (whole tree), and path chaining (Health/Workouts)')
    .option("-r, --recursive", "Search entire tree, not just direct children")
    .action(async (parts, opts) => {
      if (!parts || !parts.length) return console.log(chalk.yellow("Usage: cd <name or id>"));
      const name = parts.join(" ");
      const cfg = requireAuth();
      if (!cfg.activeRootId) {
        // At home — treat cd as entering a root
        const api = new TreeAPI(cfg.apiKey);
        try {
          const data = await api.getUser(cfg.userId);
          const roots = data.roots || data.user?.roots || [];
          const root = findChild(roots, name);
          if (!root) return;
          cfg.activeRootId = root._id;
          cfg.activeRootName = root.name;
          cfg.pathStack = [];
          save(cfg);
        } catch (e) { console.error(chalk.red(e.message)); }
        return;
      }

      if (name === "..") {
        if (cfg.pathStack.length === 0)
          return console.log(chalk.dim("Already at root."));
        cfg.pathStack.pop();
        save(cfg);
        return;
      }

      if (name === "/") {
        cfg.pathStack = [];
        save(cfg);
        return;
      }

      // Handle / chaining: cd Health/Workouts/Pushups
      if (name.includes("/")) {
        const segments = name.split("/").filter(Boolean);
        const api = new TreeAPI(cfg.apiKey);
        for (const seg of segments) {
          if (seg === "..") {
            if (cfg.pathStack.length === 0) {
              console.log(chalk.dim("Already at root."));
              break;
            }
            cfg.pathStack.pop();
            save(cfg);
            continue;
          }
          try {
            const nodeId = currentNodeId(cfg);
            const data = await api.getNode(nodeId);
            const children = getChildren(data);
            const q = seg.toLowerCase();
            const hasMatch = children.some((c) =>
              c._id === seg || c._id.startsWith(seg) ||
              (c.name && (c.name.toLowerCase() === q || c.name.toLowerCase().startsWith(q) || c.name.toLowerCase().includes(q)))
            );
            if (!hasMatch) {
              console.log(chalk.yellow(`Stopped at ${currentPath(cfg)} — no child matching "${seg}"`));
              break;
            }
            const target = findChild(children, seg);
            if (!target) break;
            cfg.pathStack.push({ id: target._id, name: target.name });
            save(cfg);
          } catch (e) {
            console.error(chalk.red(e.message));
            break;
          }
        }
        return;
      }

      const api = new TreeAPI(cfg.apiKey);
      try {
        if (opts.recursive) {
          const rootData = await api.getRoot(cfg.activeRootId);
          const rootNode = rootData.root || rootData;
          const all = flattenTree(rootNode);
          const q = name.toLowerCase();

          const matches = all.filter(({ node }) =>
            node.name && (
              node._id === name ||
              node._id.startsWith(name) ||
              node.name.toLowerCase() === q ||
              node.name.toLowerCase().startsWith(q) ||
              node.name.toLowerCase().includes(q)
            )
          );

          if (!matches.length) {
            return console.log(chalk.yellow(`No node matching "${name}"`));
          }
          if (matches.length === 1) {
            cfg.pathStack = matches[0].pathStack.slice(1);
            save(cfg);
            return;
          }
          console.log(chalk.yellow(`Multiple matches for "${name}" — use a more specific name or cd <id> directly:`));
          matches.forEach(({ node, pathStack }) => {
            const fullPath = "/" + pathStack.map(n => n.name).join("/");
            console.log(`  ${chalk.cyan(fullPath)}  ${chalk.dim(node._id)}`);
          });
          return;
        }

        const nodeId = currentNodeId(cfg);
        const data = await api.getNode(nodeId);
        const children = getChildren(data);
        const target = findChild(children, name);

        if (!target) {
          const looksLikeId = /^[0-9a-f-]{8,}$/i.test(name);
          if (!looksLikeId) {
            console.log(chalk.dim(`  (tip: use "cd ${name} -r" to search the whole tree)`));
            return;
          }
          const rootData = await api.getRoot(cfg.activeRootId);
          const rootNode = rootData.root || rootData;
          const all = flattenTree(rootNode);
          const match = all.find(({ node }) => node._id === name || node._id.startsWith(name));
          if (!match) return console.log(chalk.yellow(`No node with ID "${name}"`));
          cfg.pathStack = match.pathStack.slice(1);
          save(cfg);
          return;
        }

        cfg.pathStack.push({ id: target._id, name: target.name });
        save(cfg);
      } catch (e) {
        console.error(chalk.red(e.message));
      }
    });

  program
    .command("tree")
    .description("Render the subtree from the node you are in")
    .option("-a, --active", "Show only active nodes")
    .option("-c, --completed", "Show only completed nodes")
    .option("-t, --trimmed", "Show only trimmed nodes")
    .action(async (opts) => {
      const cfg = requireAuth();
      if (!cfg.activeRootId)
        return console.log(chalk.yellow("No tree selected. Run: use <name>, roots, or mkroot <name>"));
      const api = new TreeAPI(cfg.apiKey);
      try {
        const nodeId = currentNodeId(cfg);
        const filter = {};
        if (opts.active) { filter.active = true; filter.completed = false; filter.trimmed = false; }
        else if (opts.completed) { filter.active = false; filter.completed = true; filter.trimmed = false; }
        else if (opts.trimmed) { filter.active = false; filter.completed = false; filter.trimmed = true; }
        const data = await api.getRoot(nodeId, filter);
        const node = data.root || data;
        printNode(node);
      } catch (e) {
        console.error(chalk.red(e.message));
      }
    });

  program
    .command("calendar")
    .description("Show scheduled dates across the tree")
    .option("-m, --month [month]", "Filter by month (1-12 or name, e.g. 3, mar, march)")
    .option("-y, --year [year]", "Filter by year")
    .action(async ({ month, year }) => {
      const cfg = requireAuth();
      if (!cfg.activeRootId)
        return console.log(chalk.yellow("No tree selected. Run: use <name>, roots, or mkroot <name>"));
      const api = new TreeAPI(cfg.apiKey);
      try {
        const opts = {};
        if (month != null) {
          const monthNames = ["jan","feb","mar","apr","may","jun","jul","aug","sep","oct","nov","dec"];
          const m = String(month).toLowerCase();
          const nameIdx = monthNames.findIndex(n => m === n || n.startsWith(m) || m.startsWith(n));
          if (nameIdx >= 0) {
            opts.month = nameIdx;
          } else {
            opts.month = parseInt(m, 10) - 1; // user says 1=Jan, API wants 0=Jan
          }
        }
        if (year) opts.year = year;
        const data = await api.getCalendar(currentNodeId(cfg), opts);
        const events = data.calendar || data.events || data || [];
        if (!Array.isArray(events) || !events.length)
          return console.log(chalk.dim("  (no scheduled items)"));
        events.forEach((e, i) => {
          const date = e.schedule || e.date || e.scheduledDate || "";
          const ts = date ? chalk.yellow(new Date(date).toLocaleString()) : "";
          const name = e.name || e.nodeName || "";
          const id = e._id || e.nodeId || "";
          console.log(`  ${chalk.cyan(i + 1 + ".")} ${name}  ${ts}  ${chalk.dim(id)}`);
        });
      } catch (e) {
        console.error(chalk.red(e.message));
      }
    });

  program
    .command("dream-time [time...]")
    .description("Set nightly dream scheduling time (e.g. 9:30pm, 21:30, or 'clear')")
    .action(async (parts) => {
      if (!parts || !parts.length) return console.log(chalk.yellow("Usage: dream-time <time> (e.g. 9:30pm, 21:30, or clear)"));
      const input = parts.join(" ").trim();
      const cfg = requireAuth();
      if (!cfg.activeRootId)
        return console.log(chalk.yellow("No tree selected. Run: use <name>, roots, or mkroot <name>"));
      const api = new TreeAPI(cfg.apiKey);
      try {
        if (input === "clear") {
          await api.setDreamTime(cfg.activeRootId, null);
          return console.log(chalk.green("✓ Dream time cleared"));
        }
        const m = input.match(/^(\d{1,2}):(\d{2})\s*(am|pm)?$/i);
        if (!m) return console.log(chalk.red(`Invalid time "${input}". Use formats like 9:30pm, 21:30, or clear`));
        let hour = parseInt(m[1], 10);
        const min = m[2];
        const ampm = m[3];
        if (ampm) {
          const ap = ampm.toLowerCase();
          if (ap === "pm" && hour < 12) hour += 12;
          if (ap === "am" && hour === 12) hour = 0;
        }
        if (hour > 23 || parseInt(min, 10) > 59)
          return console.log(chalk.red("Invalid time value"));
        const dreamTime = `${String(hour).padStart(2, "0")}:${min}`;
        await api.setDreamTime(cfg.activeRootId, dreamTime);
        const h12 = hour % 12 || 12;
        const label = hour >= 12 ? "PM" : "AM";
        console.log(chalk.green(`✓ Dream time set to ${h12}:${min} ${label}`));
      } catch (e) {
        console.error(chalk.red(e.message));
      }
    });
};
