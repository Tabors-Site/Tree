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
        return console.log(chalk.yellow("Enter a tree first."));
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
        return console.log(chalk.yellow("Enter a tree first."));
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
        return console.log(chalk.yellow("Enter a tree first."));
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
        return console.log(chalk.yellow("Enter a tree first."));
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
        return console.log(chalk.yellow("Enter a tree first."));
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

        if (node.llmDefault) {
          console.log(chalk.dim("LLM:      ") + node.llmDefault);
        }

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

        // Show tool config if any
        try {
          const toolData = await api.get(`/node/${nodeId}/tools`);
          if (toolData.added?.length || toolData.blocked?.length) {
            console.log(chalk.dim("\nAI Tools:"));
            if (toolData.added?.length) console.log(`  ${chalk.green("+ " + toolData.added.join(", "))}`);
            if (toolData.blocked?.length) console.log(`  ${chalk.red("- " + toolData.blocked.join(", "))}`);
          }
        } catch {}

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
        return console.log(chalk.yellow("Enter a tree first."));
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
          return console.log(chalk.yellow("Enter a tree first."));
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
        return console.log(chalk.yellow("Enter a tree first."));
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
        return console.log(chalk.yellow("Enter a tree first."));
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

  // ── AI Tools (core) ──
  program
    .command("tools")
    .description("Show AI tools available at the current node (effective = base + added - blocked)")
    .action(async () => {
      const cfg = requireAuth();
      if (!cfg.activeRootId) return console.log(chalk.yellow("Enter a tree first."));
      const api = getApi(cfg);
      try {
        const nodeId = currentNodeId(cfg);
        const data = await api.get(`/node/${nodeId}/tools`);

        console.log(chalk.bold("Effective tools:"));
        for (const t of data.effective || []) {
          const isAdded = (data.added || []).includes(t);
          console.log(`  ${isAdded ? chalk.green("+ " + t) : chalk.dim(t)}`);
        }

        if (data.blocked?.length) {
          console.log(chalk.bold("\nBlocked:"));
          for (const t of data.blocked) console.log(`  ${chalk.red("- " + t)}`);
        }

        if (data.chain?.length) {
          console.log(chalk.bold("\nInheritance:"));
          for (const c of data.chain) {
            const parts = [];
            if (c.allowed?.length) parts.push(chalk.green("+" + c.allowed.join(", +")));
            if (c.blocked?.length) parts.push(chalk.red("-" + c.blocked.join(", -")));
            if (parts.length) console.log(`  ${chalk.dim(c.name)}: ${parts.join("  ")}`);
          }
        }
      } catch (e) {
        console.error(chalk.red(e.message));
      }
    });

  program
    .command("tools-allow [toolNames...]")
    .description("Add AI tools to the current node. Comma or space separated.")
    .action(async (parts) => {
      if (!parts?.length) return console.log(chalk.yellow("Usage: tools-allow <tool1> <tool2> or tools-allow tool1,tool2"));
      const cfg = requireAuth();
      if (!cfg.activeRootId) return console.log(chalk.yellow("Enter a tree first."));
      const api = getApi(cfg);
      try {
        const nodeId = currentNodeId(cfg);
        const tools = parts.join(",").split(",").map(s => s.trim()).filter(Boolean);
        // Get existing config and merge
        const current = await api.get(`/node/${nodeId}/tools`);
        const existingAllowed = [];
        const existingBlocked = [];
        for (const c of current.chain || []) {
          if (c.nodeId === nodeId) {
            existingAllowed.push(...(c.allowed || []));
            existingBlocked.push(...(c.blocked || []));
          }
        }
        const allowed = [...new Set([...existingAllowed, ...tools])];
        await api.post(`/node/${nodeId}/tools`, { allowed, blocked: existingBlocked });
        console.log(chalk.green(`✓ Allowed: ${tools.join(", ")}`));
      } catch (e) {
        console.error(chalk.red(e.message));
      }
    });

  program
    .command("tools-block [toolNames...]")
    .description("Block AI tools at the current node. Comma or space separated.")
    .action(async (parts) => {
      if (!parts?.length) return console.log(chalk.yellow("Usage: tools-block <tool1> <tool2> or tools-block tool1,tool2"));
      const cfg = requireAuth();
      if (!cfg.activeRootId) return console.log(chalk.yellow("Enter a tree first."));
      const api = getApi(cfg);
      try {
        const nodeId = currentNodeId(cfg);
        const tools = parts.join(",").split(",").map(s => s.trim()).filter(Boolean);
        const current = await api.get(`/node/${nodeId}/tools`);
        const existingAllowed = [];
        const existingBlocked = [];
        for (const c of current.chain || []) {
          if (c.nodeId === nodeId) {
            existingAllowed.push(...(c.allowed || []));
            existingBlocked.push(...(c.blocked || []));
          }
        }
        const blocked = [...new Set([...existingBlocked, ...tools])];
        await api.post(`/node/${nodeId}/tools`, { allowed: existingAllowed, blocked });
        console.log(chalk.green(`✓ Blocked: ${tools.join(", ")}`));
      } catch (e) {
        console.error(chalk.red(e.message));
      }
    });

  program
    .command("tools-clear")
    .description("Clear all tool config on the current node (inherit from parent only)")
    .action(async () => {
      const cfg = requireAuth();
      if (!cfg.activeRootId) return console.log(chalk.yellow("Enter a tree first."));
      const api = getApi(cfg);
      try {
        const nodeId = currentNodeId(cfg);
        await api.post(`/node/${nodeId}/tools`, { allowed: [], blocked: [] });
        console.log(chalk.green("✓ Tools cleared. Inheriting from parent."));
      } catch (e) {
        console.error(chalk.red(e.message));
      }
    });

  // ── Spatial extension scoping ──
  program
    .command("ext-scope")
    .description("Show which extensions are active/blocked at the current position. -t tree view")
    .option("-t, --tree", "Show block map across the entire tree")
    .action(async ({ tree: showTree }) => {
      const cfg = requireAuth();
      if (!cfg.activeRootId) return console.log(chalk.yellow("Enter a tree first."));
      const api = getApi(cfg);
      try {
        if (showTree) {
          // Tree-wide view from root
          const data = await api.get(`/root/${cfg.activeRootId}/extensions?tree=true`);
          console.log(chalk.bold(`Extension scope for ${data.rootName || cfg.activeRootId}`));
          console.log();
          if (data.active?.length) {
            console.log(chalk.green("Active:"));
            console.log(`  ${data.active.join(", ")}`);
          }
          if (data.blocked?.length) {
            console.log(chalk.red("\nBlocked (tree-wide):"));
            for (const name of data.blocked) console.log(`  ${chalk.red("x")} ${name}`);
          }
          if (data.tree?.length) {
            console.log(chalk.dim("\nPer-branch blocks:"));
            for (const node of data.tree) {
              const indent = "  ".repeat(node.depth + 1);
              console.log(`${indent}${chalk.bold(node.name)}: ${chalk.red(node.blocked.join(", "))}`);
            }
          }
          if (!data.blocked?.length && !data.tree?.length) {
            console.log(chalk.dim("  All extensions active everywhere in this tree."));
          }
        } else {
          // Current node view
          const nodeId = currentNodeId(cfg);
          const data = await api.get(`/node/${nodeId}/extensions`);
          console.log(chalk.bold(`Extension scope at ${data.nodeName || nodeId}`));

          // Global extensions (active unless blocked)
          if (data.global?.length) {
            console.log(chalk.dim("\nGlobal extensions (active unless blocked):"));
            for (const ext of data.global) {
              const color = ext.status === "active" ? chalk.green : ext.status === "blocked" ? chalk.red : chalk.yellow;
              console.log(`  ${color(ext.name)}  ${chalk.dim(ext.status)}`);
            }
          }

          // Confined extensions (inactive unless allowed)
          if (data.confined?.length) {
            console.log(chalk.dim("\nConfined extensions (inactive unless allowed):"));
            for (const ext of data.confined) {
              const color = ext.status === "allowed" ? chalk.green : ext.status === "blocked" ? chalk.red : chalk.dim;
              console.log(`  ${color(ext.name)}  ${chalk.dim(ext.status)}`);
            }
          }

          // Inheritance chain
          if (data.chain?.length) {
            console.log(chalk.dim("\nInheritance:"));
            for (const c of data.chain) {
              const parts = [];
              if (c.blocked?.length) parts.push(chalk.red(`blocked: ${c.blocked.join(", ")}`));
              if (c.allowed?.length) parts.push(chalk.green(`allowed: ${c.allowed.join(", ")}`));
              if (parts.length) console.log(chalk.dim(`  ${c.name}: `) + parts.join("  "));
            }
          }
        }
      } catch (e) {
        console.error(chalk.red(e.message));
      }
    });

  program
    .command("ext-block [extNames...]")
    .description("Block extensions at the current node. Their tools, hooks, and modes won't work here or below.")
    .action(async (parts) => {
      if (!parts?.length) return console.log(chalk.yellow("Usage: ext-block <ext1> <ext2>"));
      const cfg = requireAuth();
      if (!cfg.activeRootId) return console.log(chalk.yellow("Enter a tree first."));
      const api = getApi(cfg);
      try {
        const nodeId = currentNodeId(cfg);
        const names = parts.join(",").split(",").map(s => s.trim()).filter(Boolean);
        // Get existing config and merge
        const current = await api.get(`/node/${nodeId}/extensions`);
        const existing = [];
        for (const c of current.chain || []) {
          if (c.nodeId === nodeId) existing.push(...(c.blocked || []));
        }
        const blocked = [...new Set([...existing, ...names])];
        await api.post(`/node/${nodeId}/extensions`, { blocked });
        console.log(chalk.green(`Blocked: ${names.join(", ")}`));
        console.log(chalk.dim("Their tools, hooks, modes, and metadata are now inactive at this position and all children."));
      } catch (e) {
        console.error(chalk.red(e.message));
      }
    });

  program
    .command("ext-allow [extNames...]")
    .description("Allow extensions at this position. Unblocks global extensions. Activates confined extensions.")
    .action(async (parts) => {
      if (!parts?.length) return console.log(chalk.yellow("Usage: ext-allow <ext1> <ext2>"));
      const cfg = requireAuth();
      if (!cfg.activeRootId) return console.log(chalk.yellow("Enter a tree first."));
      const api = getApi(cfg);
      try {
        const nodeId = currentNodeId(cfg);
        const names = new Set(parts.join(",").split(",").map(s => s.trim()).filter(Boolean));
        const current = await api.get(`/node/${nodeId}/extensions`);

        // Remove from blocked (unblock global extensions)
        const existingBlocked = current.localBlocked || [];
        const blocked = existingBlocked.filter(n => !names.has(n));

        // Add to allowed (activate confined extensions)
        const existingAllowed = current.localAllowed || [];
        const allowed = [...new Set([...existingAllowed, ...names])];

        await api.post(`/node/${nodeId}/extensions`, { blocked, allowed });
        console.log(chalk.green(`Allowed: ${[...names].join(", ")}`));
        console.log(chalk.dim("Global extensions unblocked. Confined extensions activated at this position."));
      } catch (e) {
        console.error(chalk.red(e.message));
      }
    });

  program
    .command("ext-unallow [extNames...]")
    .description("Remove confined extensions from the allowed list. They go dark at this position.")
    .action(async (parts) => {
      if (!parts?.length) return console.log(chalk.yellow("Usage: ext-unallow <ext1> <ext2>"));
      const cfg = requireAuth();
      if (!cfg.activeRootId) return console.log(chalk.yellow("Enter a tree first."));
      const api = getApi(cfg);
      try {
        const nodeId = currentNodeId(cfg);
        const names = new Set(parts.join(",").split(",").map(s => s.trim()).filter(Boolean));
        const current = await api.get(`/node/${nodeId}/extensions`);
        const existingAllowed = current.localAllowed || [];
        const allowed = existingAllowed.filter(n => !names.has(n));
        const blocked = current.localBlocked || [];
        await api.post(`/node/${nodeId}/extensions`, { blocked, allowed });
        console.log(chalk.green(`Removed from allowed: ${[...names].join(", ")}`));
        console.log(chalk.dim("Confined extensions are now inactive at this position."));
      } catch (e) {
        console.error(chalk.red(e.message));
      }
    });

  program
    .command("ext-restrict <extName> [access]")
    .description("Restrict an extension to read-only at the current node. Usage: ext-restrict food read")
    .action(async (extName, access) => {
      if (!extName) return console.log(chalk.yellow("Usage: ext-restrict <ext> [read]"));
      const cfg = requireAuth();
      if (!cfg.activeRootId) return console.log(chalk.yellow("Enter a tree first."));
      const api = getApi(cfg);
      try {
        const nodeId = currentNodeId(cfg);
        const mode = access || "read";
        const current = await api.get(`/node/${nodeId}/extensions`);
        const existing = {};
        for (const c of current.chain || []) {
          if (c.nodeId === nodeId && c.restricted) Object.assign(existing, c.restricted);
        }
        existing[extName] = mode;
        // Get existing blocked too
        const existingBlocked = [];
        for (const c of current.chain || []) {
          if (c.nodeId === nodeId) existingBlocked.push(...(c.blocked || []));
        }
        await api.post(`/node/${nodeId}/extensions`, { blocked: existingBlocked, restricted: existing });
        console.log(chalk.green(`Restricted ${extName} to ${mode} at this node.`));
        console.log(chalk.dim("Its write tools are filtered. Read tools and hooks still work."));
      } catch (e) {
        console.error(chalk.red(e.message));
      }
    });

  // ── Per-node mode overrides ──
  program
    .command("modes")
    .description("Show mode overrides and available modes at the current node")
    .action(async () => {
      const cfg = requireAuth();
      if (!cfg.activeRootId) return console.log(chalk.yellow("Enter a tree first."));
      const api = getApi(cfg);
      try {
        const nodeId = currentNodeId(cfg);
        const data = await api.get(`/node/${nodeId}/modes`);

        const modes = data.modes || {};
        const keys = Object.keys(modes);

        if (keys.length === 0) {
          console.log(chalk.dim("No mode overrides. Using defaults."));
        } else {
          console.log(chalk.bold("Mode overrides:"));
          for (const [intent, modeKey] of Object.entries(modes)) {
            console.log(`  ${chalk.cyan(intent)} -> ${chalk.green(modeKey)}`);
          }
        }

        if (data.availableModes?.length) {
          console.log(chalk.bold("\nAvailable modes:"));
          for (const m of data.availableModes) {
            console.log(`  ${chalk.dim(m)}`);
          }
        }
      } catch (e) {
        console.error(chalk.red(e.message));
      }
    });

  program
    .command("mode-set [intent] [modeKey]")
    .description("Override mode for an intent at this node (e.g. mode-set respond custom:formal)")
    .action(async (intent, modeKey) => {
      if (!intent || !modeKey) return console.log(chalk.yellow("Usage: mode-set <intent> <modeKey>\n  e.g. mode-set respond custom:formal\n  Run 'modes' to see available modes and intents."));
      const cfg = requireAuth();
      if (!cfg.activeRootId) return console.log(chalk.yellow("Enter a tree first."));
      const api = getApi(cfg);
      try {
        const nodeId = currentNodeId(cfg);
        await api.post(`/node/${nodeId}/modes`, { intent, modeKey });
        console.log(chalk.green(`✓ ${intent} -> ${modeKey}`));
      } catch (e) {
        console.error(chalk.red(e.message));
      }
    });

  program
    .command("mode-clear [intent]")
    .description("Clear mode override(s) at this node. Omit intent to clear all.")
    .action(async (intent) => {
      const cfg = requireAuth();
      if (!cfg.activeRootId) return console.log(chalk.yellow("Enter a tree first."));
      const api = getApi(cfg);
      try {
        const nodeId = currentNodeId(cfg);
        await api.post(`/node/${nodeId}/modes`, { intent: intent || null, clear: true });
        console.log(chalk.green(intent ? `✓ Cleared ${intent} override` : "✓ All mode overrides cleared"));
      } catch (e) {
        console.error(chalk.red(e.message));
      }
    });
};
