const chalk = require("chalk");
const TreeAPI = require("../api");
const { createProxyApi } = require("../api");
const { load, save, requireAuth, currentNodeId, currentPath, currentLand, hasExtension } = require("../config");
const { getChildren, flattenTree, findChild } = require("../helpers");
const { printNode, printTable } = require("../display");

/** Return an API that auto-proxies when inside a remote tree */
function getApi(cfg) {
  return cfg.remoteDomain
    ? createProxyApi(cfg.apiKey, cfg.remoteDomain)
    : new TreeAPI(cfg.apiKey);
}

/** Clear session and go to land level (/) */
function goLand(cfg) {
  cfg.activeRootId = null;
  cfg.activeRootName = null;
  cfg.pathStack = [];
  cfg.isSystemRoot = false;
  cfg.remoteDomain = null;
  cfg.atHome = false;
}

/** Clear session and go to user home (/~) */
function goHome(cfg) {
  cfg.activeRootId = null;
  cfg.activeRootName = null;
  cfg.pathStack = [];
  cfg.isSystemRoot = false;
  cfg.remoteDomain = null;
  cfg.atHome = true;
}

module.exports = (program) => {
  const cfg = load();

  program
    .command("land")
    .description("Go to land root (/)")
    .action(() => {
      const cfg = requireAuth();
      goLand(cfg);
      save(cfg);
    });

  program
    .command("pwd")
    .description("Print current path")
    .action(() => {
      const cfg = requireAuth();
      console.log(chalk.cyan(currentPath(cfg)));
    });

  program
    .command("ls")
    .description("List contents (/ = land, /~ = your trees, inside tree = children). -l long format")
    .option("-l", "Long format with IDs and status")
    .action(async ({ l }) => {
      const cfg = requireAuth();
      const api = getApi(cfg);

      if (!cfg.activeRootId) {
        if (cfg.remoteDomain) {
          // At remote land root — proxy getLandRoot to see the same view as local /
          try {
            const proxyApi = createProxyApi(cfg.apiKey, cfg.remoteDomain);
            const landData = await proxyApi.getLandRoot();
            const children = landData.children || [];

            if (!children.length) return console.log(chalk.dim(`  (empty)`));

            if (l) {
              printTable(
                children.map((c) => ({
                  name: c.name,
                  type: c.isSystem ? "system" : (c.isOwned ? "owned" : c.isPublic ? "public" : "shared"),
                  _id: c._id,
                })),
                [
                  { key: "name", label: "Name", width: 28 },
                  { key: "type", label: "Type", width: 10 },
                  { key: "_id", label: "ID", width: 28 },
                ],
              );
            } else {
              const names = children.map((c) => {
                if (c.isSystem) return chalk.dim(c.name);
                if (c.isOwned) return chalk.cyan(c.name);
                if (c.isPublic) return chalk.white(c.name);
                return chalk.cyan(c.name);
              });
              console.log(names.join(chalk.dim("  ·  ")));
            }
          } catch (e) {
            console.error(chalk.red(e.message));
          }
          return;
        }
        if (cfg.atHome) {
          // At /~ — show user's own roots (local + remote)
          try {
            const data = await api.getUser(cfg.userId);
            const roots = data.roots || data.user?.roots || [];
            const remoteRoots = data.remoteRoots || [];

            if (!roots.length && !remoteRoots.length) return console.log(chalk.dim("  (no trees yet. Run: mkroot <name>)"));

            if (l) {
              const rows = [
                ...roots.map((r) => ({ name: r.name, visibility: r.visibility === "public" ? "public" : "private", land: "local", _id: r._id })),
                ...remoteRoots.map((r) => ({ name: r.rootName, visibility: "", land: `@${r.landDomain}`, _id: r.rootId })),
              ];
              printTable(rows, [
                { key: "name", label: "Name", width: 24 },
                { key: "visibility", label: "Visibility", width: 10 },
                { key: "land", label: "Land", width: 20 },
                { key: "_id", label: "ID", width: 28 },
              ]);
            } else {
              const localNames = roots.map((r) =>
                r.visibility === "public" ? chalk.white(r.name) : chalk.cyan(r.name)
              );
              const remoteNames = remoteRoots.map((r) => chalk.cyan(r.rootName) + chalk.dim(` @${r.landDomain}`));
              const all = [...localNames, ...remoteNames];
              console.log(all.join(chalk.dim("  ·  ")));
            }
          } catch (e) {
            console.error(chalk.red(e.message));
          }
        } else {
          // At / — show land roots (public + your private + system)
          try {
            const landData = await api.getLandRoot();
            const children = landData.children || [];

            if (!children.length) return console.log(chalk.dim("  (empty)"));

            if (l) {
              printTable(
                children.map((c) => ({
                  name: c.name,
                  type: c.isSystem ? "system" : (c.isOwned ? "owned" : c.isPublic ? "public" : "shared"),
                  _id: c._id,
                })),
                [
                  { key: "name", label: "Name", width: 28 },
                  { key: "type", label: "Type", width: 10 },
                  { key: "_id", label: "ID", width: 28 },
                ],
              );
            } else {
              const names = children.map((c) => {
                if (c.isSystem) return chalk.dim(c.name);
                if (c.isOwned) return chalk.cyan(c.name);
                if (c.isPublic) return chalk.white(c.name);
                return chalk.cyan(c.name);
              });
              console.log(names.join(chalk.dim("  ·  ")));
            }
          } catch (e) {
            console.error(chalk.red(e.message));
          }
        }
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
    .description('Navigate by name, ID, ~, /, @domain/tree. Supports .., -r (search whole tree), path chaining (A/B/C)')
    .option("-r, --recursive", "Search entire tree, not just direct children")
    .action(async (parts, opts) => {
      if (!parts || !parts.length) return console.log(chalk.yellow("Usage: cd <name or id> | cd @domain/tree"));
      const name = parts.join(" ");
      const cfg = requireAuth();

      // ── cd @domain/treename or cd @domain ──
      if (name.startsWith("@")) {
        const slashIdx = name.indexOf("/");
        const hasTree = slashIdx > 0;
        const domain = hasTree ? name.slice(1, slashIdx) : name.slice(1);
        const rest = hasTree ? name.slice(slashIdx + 1) : null;
        if (!domain) return console.log(chalk.yellow("Usage: cd @domain or cd @domain/treename"));

        // Detect if this is the user's own land — treat as local
        const ownLand = currentLand(cfg);
        const domainLower = domain.toLowerCase();
        const isOwnLand = domainLower === ownLand.toLowerCase() || domainLower === cfg.landUrl?.replace(/^https?:\/\//, "").replace(/\/+$/, "").toLowerCase();

        if (hasTree && !rest) return console.log(chalk.yellow("Usage: cd @domain/treename"));

        if (hasTree) {
          // cd @domain/treename
          try {
            const api = isOwnLand ? new TreeAPI(cfg.apiKey) : createProxyApi(cfg.apiKey, domain);
            const landData = await api.getLandRoot();
            const children = landData.children || [];
            const target = findChild(children, rest);
            if (!target) return;

            cfg.remoteDomain = isOwnLand ? null : domain;
            cfg.activeRootId = target._id;
            cfg.activeRootName = target.name;
            cfg.pathStack = [];
            cfg.isSystemRoot = !!target.isSystem;
            cfg.atHome = false;
            save(cfg);
            if (isOwnLand) {
              console.log(chalk.green(`Entered ${target.name}`));
            } else {
              console.log(chalk.green(`Entered ${target.name} on ${chalk.dim(`@${domain}`)}`));
            }
          } catch (e) {
            console.error(chalk.red(e.message));
          }
        } else {
          // cd @domain
          if (isOwnLand) {
            // Already on this land, just go to land root
            goLand(cfg);
            save(cfg);
            return;
          }
          cfg.remoteDomain = domain;
          cfg.activeRootId = null;
          cfg.activeRootName = null;
          cfg.pathStack = [];
          cfg.isSystemRoot = false;
          cfg.atHome = false;
          save(cfg);
          console.log(chalk.green(`Entered @${domain}. Run ls to see trees.`));
        }
        return;
      }

      const api = getApi(cfg);

      // ── cd ~ — go to user home ──
      if (name === "~") {
        goHome(cfg);
        save(cfg);
        return;
      }

      // ── cd / — go to tree root if deep in tree, go to land if at tree root ──
      if (name === "/") {
        if (cfg.activeRootId && cfg.pathStack.length > 0) {
          // Inside a tree past root — go back to tree root
          cfg.pathStack = [];
        } else if (cfg.activeRootId) {
          // At tree root — go to land
          goLand(cfg);
        }
        else if (cfg.atHome) {
          // At /~ — go to land
          goLand(cfg);
        }
        // Already at land — no-op
        save(cfg);
        return;
      }


      // ── At top level (/ or /~), no tree selected ──
      if (!cfg.activeRootId) {
        if (name === "..") {
          if (cfg.remoteDomain) {
            // At remote land root -> go back to local land root /
            goLand(cfg);
            save(cfg);
          } else if (cfg.atHome) {
            // /~ -> / (go up to land)
            goLand(cfg);
            save(cfg);
          } else {
            console.log(chalk.dim("Already at /"));
          }
          return;
        }

        if (cfg.remoteDomain) {
          // At remote land root — cd into a tree by name via proxied land root
          try {
            const proxyApi = createProxyApi(cfg.apiKey, cfg.remoteDomain);
            const landData = await proxyApi.getLandRoot();
            const children = landData.children || [];
            const target = findChild(children, name);
            if (!target) return;
            cfg.activeRootId = target._id;
            cfg.activeRootName = target.name;
            cfg.pathStack = [];
            cfg.isSystemRoot = !!target.isSystem;
            save(cfg);
            console.log(chalk.green(`Entered ${target.name} on ${chalk.dim(`@${cfg.remoteDomain}`)}`));
          } catch (e) {
            console.error(chalk.red(e.message));
          }
          return;
        }

        if (cfg.atHome) {
          // At /~ — cd into one of your roots (local or remote) by name
          try {
            const data = await api.getUser(cfg.userId);
            const roots = data.roots || data.user?.roots || [];
            const remoteRoots = data.remoteRoots || [];

            // Try local roots first
            const localTarget = findChild(roots, name);
            if (localTarget) {
              cfg.activeRootId = localTarget._id;
              cfg.activeRootName = localTarget.name;
              cfg.pathStack = [];
              cfg.isSystemRoot = false;
              save(cfg);
              return;
            }

            // Try remote roots
            const remoteTarget = findChild(
              remoteRoots.map((r) => ({ _id: r.rootId, name: r.rootName, landDomain: r.landDomain })),
              name,
            );
            if (remoteTarget) {
              cfg.remoteDomain = remoteTarget.landDomain;
              cfg.activeRootId = remoteTarget._id;
              cfg.activeRootName = remoteTarget.name;
              cfg.pathStack = [];
              cfg.isSystemRoot = false;
              save(cfg);
              console.log(chalk.green(`Entered ${remoteTarget.name} on ${chalk.dim(`@${remoteTarget.landDomain}`)}`));
              return;
            }

            console.log(chalk.yellow(`No tree matching "${name}"`));
          } catch (e) {
            console.error(chalk.red(e.message));
          }
        } else {
          // At / — cd into land root children
          try {
            const landData = await api.getLandRoot();
            const children = landData.children || [];
            const target = findChild(children, name);
            if (!target) return;
            cfg.activeRootId = target._id;
            cfg.activeRootName = target.name;
            cfg.pathStack = [];
            cfg.isSystemRoot = !!target.isSystem;
            save(cfg);
          } catch (e) {
            console.error(chalk.red(e.message));
          }
        }
        return;
      }

      // ── cd .. ──
      if (name === "..") {
        if (cfg.pathStack.length === 0) {
          // At tree root — go back to land level (keep remoteDomain if on a remote land)
          cfg.activeRootId = null;
          cfg.activeRootName = null;
          cfg.isSystemRoot = false;
          save(cfg);
          return;
        }
        cfg.pathStack.pop();
        save(cfg);
        return;
      }

      // ── cd ~/TreeName — shortcut to home then into tree ──
      if (name.startsWith("~/")) {
        goHome(cfg);
        const rest = name.slice(2);
        if (rest) {
          try {
            const data = await api.getUser(cfg.userId);
            const roots = data.roots || data.user?.roots || [];
            const target = findChild(roots, rest);
            if (!target) { save(cfg); return; }
            cfg.activeRootId = target._id;
            cfg.activeRootName = target.name;
            cfg.pathStack = [];
            cfg.isSystemRoot = false;
          } catch (e) {
            console.error(chalk.red(e.message));
          }
        }
        save(cfg);
        return;
      }

      // ── cd with / chaining: cd Health/Workouts/Pushups ──
      if (name.includes("/")) {
        const segments = name.split("/").filter(Boolean);
        for (const seg of segments) {
          if (seg === "..") {
            if (cfg.pathStack.length === 0) {
              cfg.activeRootId = null;
              cfg.activeRootName = null;
              cfg.isSystemRoot = false;
              cfg.remoteDomain = null;
              save(cfg);
              return;
            }
            cfg.pathStack.pop();
            save(cfg);
            continue;
          }
          try {
            const nodeId = currentNodeId(cfg);
            const data = await api.getNode(nodeId);
            const children = getChildren(data);
            const target = findChild(children, seg);
            if (!target) {
              console.log(chalk.yellow(`Stopped at ${currentPath(cfg)} — no child matching "${seg}"`));
              break;
            }
            cfg.pathStack.push({ id: target._id, name: target.name });
            save(cfg);
          } catch (e) {
            console.error(chalk.red(e.message));
            break;
          }
        }
        return;
      }

      // ── Standard cd into child ──
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
    .description("Render the subtree from the node you are in. -a active, -c completed, -t trimmed")
    .option("-a, --active", "Show only active nodes")
    .option("-c, --completed", "Show only completed nodes")
    .option("-t, --trimmed", "Show only trimmed nodes")
    .action(async (opts) => {
      const cfg = requireAuth();
      if (!cfg.activeRootId)
        return console.log(chalk.yellow("Enter a tree first. Run: cd <name>"));
      const api = getApi(cfg);
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

  // ── Schedules (extension: schedules) ──
  if (hasExtension(cfg, "schedules")) {
  program
    .command("calendar")
    .description("Show scheduled dates across the tree. -m month (1-12 or name), -y year")
    .option("-m, --month [month]", "Filter by month (1-12 or name, e.g. 3, mar, march)")
    .option("-y, --year [year]", "Filter by year")
    .action(async ({ month, year }) => {
      const cfg = requireAuth();
      if (!cfg.activeRootId)
        return console.log(chalk.yellow("Enter a tree first. Run: cd <name>"));
      const api = getApi(cfg);
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
  } // end schedules extension

  // ── Dreams (extension: dreams) ──
  if (hasExtension(cfg, "dreams")) {
  program
    .command("dream-time [time...]")
    .description("Set nightly dream scheduling time (e.g. 9:30pm, 21:30, or 'clear')")
    .action(async (parts) => {
      if (!parts || !parts.length) return console.log(chalk.yellow("Usage: dream-time <time> (e.g. 9:30pm, 21:30, or clear)"));
      const input = parts.join(" ").trim();
      const cfg = requireAuth();
      if (!cfg.activeRootId)
        return console.log(chalk.yellow("No tree selected. Run: use <name>, roots, or mkroot <name>"));
      const api = getApi(cfg);
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
  } // end dreams extension

  program
    .command("recent")
    .description("Show recently visited trees")
    .action(async () => {
      const cfg = requireAuth();
      const api = getApi(cfg);
      try {
        const data = await api.getUser(cfg.userId);
        const recents = data.recentRoots || [];
        if (recents.length === 0) {
          return console.log(chalk.dim("  No recently visited trees."));
        }
        console.log(chalk.bold("Recent trees:"));
        for (const r of recents) {
          const ago = r.lastVisitedAt ? chalk.dim(" " + timeAgo(new Date(r.lastVisitedAt))) : "";
          console.log(`  ${chalk.cyan(r.name || r.rootName || r.rootId)}${ago}`);
        }
      } catch (e) {
        console.error(chalk.red(e.message));
      }
    });

  function timeAgo(date) {
    const ms = Date.now() - date.getTime();
    const mins = Math.floor(ms / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    return `${days}d ago`;
  }
};
