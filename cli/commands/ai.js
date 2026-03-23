const chalk = require("chalk");
const { save, load, requireAuth, currentNodeId, hasExtension } = require("../config");
const { getApi } = require("../helpers");
const { printChats } = require("../display");

module.exports = (program) => {
  const cfg = load();
  program
    .command("chats [scope]")
    .description("List AI chats. In home: your chats. In tree: node chats. 'chats tree' = whole tree. -l limit")
    .option("-l, --limit [n]", "Limit results")
    .action(async (scope, { limit }) => {
      const cfg = requireAuth();
      const api = getApi(cfg);
      try {
        let data;
        if (!cfg.activeRootId) {
          data = await api.listUserChats(cfg.userId);
        } else if (scope === "tree" || scope === "all") {
          data = await api.listRootChats(cfg.activeRootId);
        } else {
          const nodeId = currentNodeId(cfg);
          data = await api.listNodeChats(nodeId);
        }
        const sessions = data.chats || data.sessions || data || [];
        const max = parseInt(limit, 10) || 10;
        const list = Array.isArray(sessions) ? sessions.slice(0, max) : [];
        printChats(list);
      } catch (e) {
        console.error(chalk.red(e.message));
      }
    });

  program
    .command("chat [message...]")
    .description("Chat with AI. In a tree: about the branch. At land root: land management.")
    .action(async (parts) => {
      if (!parts || !parts.length) return console.log(chalk.yellow("Usage: chat <message>"));
      const message = parts.join(" ");
      const cfg = requireAuth();
      const api = getApi(cfg);

      // Ctrl+C aborts the request but stays in the shell
      const abort = new AbortController();
      const existingSigint = process.listeners("SIGINT").slice();
      const onSigint = () => {
        abort.abort();
        console.log(chalk.dim("\nCancelled."));
      };
      process.removeAllListeners("SIGINT");
      process.on("SIGINT", onSigint);

      try {
        if (!cfg.activeRootId || cfg.isSystemRoot) {
          console.log(chalk.dim("Land Manager…"));
          const data = await api.post("/land/chat", { message }, { signal: abort.signal });
          console.log(chalk.bold("\nLand:") + " " + (data.answer || "No response."));
        } else {
          console.log(chalk.dim("Thinking…"));
          const nodeId = currentNodeId(cfg);
          const data = await api.chat(nodeId, message, { signal: abort.signal });
          console.log(chalk.bold("\nTree:") + " " + (data.answer || "No response."));
        }
      } catch (e) {
        if (e.name === "AbortError") return;
        console.error(chalk.red(e.message));
      } finally {
        process.removeListener("SIGINT", onSigint);
        for (const fn of existingSigint) process.on("SIGINT", fn);
      }
    });

  program
    .command("place [message...]")
    .description("AI-place a message into the branch you are in")
    .action(async (parts) => {
      if (!parts || !parts.length) return console.log(chalk.yellow("Usage: place <message>"));
      const message = parts.join(" ");
      const cfg = requireAuth();
      if (!cfg.activeRootId)
        return console.log(chalk.yellow("No tree selected. Run: use <name>, roots, or mkroot <name>"));
      console.log(chalk.dim("Placing…"));
      const api = getApi(cfg);
      try {
        const nodeId = currentNodeId(cfg);
        const data = await api.place(nodeId, message);
        if (data.targetPath)
          console.log(chalk.green(`✓ Placed under: ${data.targetPath}`));
        else console.log(chalk.green("✓ Placed"));
      } catch (e) {
        console.error(chalk.red(e.message));
      }
    });

  program
    .command("query [message...]")
    .description("Query AI about the branch you are in (read-only)")
    .action(async (parts) => {
      if (!parts || !parts.length) return console.log(chalk.yellow("Usage: query <message>"));
      const message = parts.join(" ");
      const cfg = requireAuth();
      if (!cfg.activeRootId)
        return console.log(chalk.yellow("No tree selected. Run: use <name>, roots, or mkroot <name>"));
      console.log(chalk.dim("Thinking…"));
      const api = getApi(cfg);
      try {
        const nodeId = currentNodeId(cfg);
        const data = await api.query(nodeId, message);
        console.log(
          chalk.bold("\nTree:") + " " + (data.answer || "No response."),
        );
      } catch (e) {
        console.error(chalk.red(e.message));
      }
    });

  // ── Raw Ideas (extension: raw-ideas) ──
  if (hasExtension(cfg, "raw-ideas")) {

  program
    .command("ideas")
    .description("List raw ideas. -p pending, -r processing, -s stuck, -d done, -a all, -q search, -l limit")
    .option("-p, --pending", "Show pending ideas")
    .option("-r, --processing", "Show processing ideas")
    .option("-s, --stuck", "Show stuck ideas")
    .option("-d, --done", "Show succeeded ideas")
    .option("-a, --all", "Show all ideas regardless of status")
    .option("-q, --query [query]", "Search raw ideas")
    .option("-l, --limit [n]", "Limit results")
    .action(async ({ pending, processing, stuck, done, all, query, limit }) => {
      const cfg = requireAuth();
      const api = getApi(cfg);
      try {
        const flaggedStatuses = [
          pending && "pending",
          processing && "processing",
          stuck && "stuck",
          done && "succeeded",
        ].filter(Boolean);

        const data = await api.listRawIdeas(cfg.userId, { status: "all", q: query, limit });
        let ideas = data.rawIdeas || data.ideas || data || [];

        if (flaggedStatuses.length) {
          ideas = ideas.filter(r => flaggedStatuses.includes(r.status));
        } else if (!all) {
          ideas = ideas.filter(r => ["pending", "stuck", "processing", "failed"].includes(r.status));
        }

        if (!Array.isArray(ideas) || !ideas.length)
          return console.log(chalk.dim("  (no ideas)"));

        const statusColor = (s) => {
          if (s === "succeeded") return chalk.green(`[${s}]`);
          if (s === "processing") return chalk.blue(`[${s}]`);
          if (s === "stuck" || s === "failed") return chalk.red(`[${s}]`);
          return chalk.yellow(`[${s}]`);
        };

        ideas.forEach((idea, i) => {
          const ts = idea.createdAt ? chalk.dim(new Date(idea.createdAt).toLocaleString()) : "";
          const st = idea.status ? " " + statusColor(idea.status) : "";
          console.log(`  ${chalk.cyan(i + 1 + ".")} ${chalk.dim(idea._id)}${st}  ${ts}`);
          if (idea.content) console.log(`     ${idea.content.slice(0, 120)}`);
        });
      } catch (e) {
        console.error(chalk.red(e.message));
      }
    });

  program
    .command("idea-store [message...]")
    .description("Save a raw idea for later without processing")
    .action(async (parts) => {
      if (!parts || !parts.length) return console.log(chalk.yellow("Usage: idea-store <message>"));
      const content = parts.join(" ");
      const cfg = requireAuth();
      const api = getApi(cfg);
      try {
        const data = await api.createRawIdea(cfg.userId, content);
        const id = data.rawIdea?._id || data._id || "";
        console.log(chalk.green("✓ Raw idea saved") + "  " + chalk.dim(id));
      } catch (e) {
        console.error(chalk.red(e.message));
      }
    });

  program
    .command("rm-idea [rawIdeaId]")
    .description("Delete a raw idea. -f skip confirmation")
    .option("-f, --force", "Skip confirmation")
    .action(async (rawIdeaId, { force }) => {
      if (!rawIdeaId) return console.log(chalk.yellow("Usage: rm-idea <id> -f"));
      const cfg = requireAuth();
      if (!force)
        return console.log(chalk.yellow(`Delete raw idea ${rawIdeaId}? Pass -f to confirm.`));
      const api = getApi(cfg);
      try {
        await api.deleteRawIdea(cfg.userId, rawIdeaId);
        console.log(chalk.green("✓ Raw idea deleted"));
      } catch (e) {
        console.error(chalk.red(e.message));
      }
    });

  program
    .command("idea-place [input...]")
    .description("AI-place an idea (fire-and-forget). Pass a rawIdeaId or just type your idea directly")
    .action(async (parts) => {
      if (!parts || !parts.length) return console.log(chalk.yellow("Usage: idea-place <rawIdeaId or message>"));
      const input = parts.join(" ");
      const cfg = requireAuth();
      console.log(chalk.dim("Placing…"));
      const api = getApi(cfg);
      try {
        const isId = /^[0-9a-f-]{36}$/i.test(input);
        const data = isId
          ? await api.rawIdeaPlace(cfg.userId, input)
          : await api.rawIdeaPlaceContent(cfg.userId, input);
        console.log(chalk.green("✓ Placement started (background)"));
        if (data.rawIdeaId) console.log(chalk.dim(`  Raw idea: ${data.rawIdeaId}`));
      } catch (e) {
        console.error(chalk.red(e.message));
      }
    });

  program
    .command("idea [message...]")
    .description("Send an idea from anywhere — AI places it in the right tree and navigates you there")
    .action(async (parts) => {
      if (!parts || !parts.length) return console.log(chalk.yellow("Usage: idea <message>"));
      const input = parts.join(" ");
      const cfg = requireAuth();
      console.log(chalk.dim("Thinking…"));
      const api = getApi(cfg);
      try {
        const isId = /^[0-9a-f-]{36}$/i.test(input);
        const data = isId
          ? await api.rawIdeaChat(cfg.userId, input)
          : await api.rawIdeaChatContent(cfg.userId, input);
        if (!data.success) return console.log(chalk.red(data.error || "Failed"));
        console.log(chalk.bold("\nAnswer:\n") + (data.answer || ""));
        if (data.rootName) console.log(chalk.dim(`\nPlaced in tree: ${data.rootName}`));
        if (data.targetNodeId && data.rootId) {
          cfg.activeRootId = data.rootId;
          cfg.activeRootName = data.rootName || data.rootId;
          if (data.targetNodePath && data.targetNodePath.length) {
            cfg.pathStack = data.targetNodePath.map(n => ({ id: n._id, name: n.name }));
          } else if (data.targetNodeName) {
            cfg.pathStack = [{ id: data.targetNodeId, name: data.targetNodeName }];
          } else {
            save(cfg);
            console.log(chalk.green(`✓ Placed in tree: ${data.rootName || data.rootId}`));
            return;
          }
          save(cfg);
          const pathStr = cfg.pathStack.map(n => n.name).join("/");
          console.log(chalk.green(`✓ Navigated to ${data.rootName || data.rootId} › ${pathStr}`));
        }
      } catch (e) {
        console.error(chalk.red(e.message));
      }
    });

  program
    .command("idea-transfer [rawIdeaId] [nodeId]")
    .description("Manually transfer a raw idea to a specific node")
    .action(async (rawIdeaId, nodeId) => {
      if (!rawIdeaId || !nodeId) return console.log(chalk.yellow("Usage: idea-transfer <rawIdeaId> <nodeId>"));
      const cfg = requireAuth();
      const api = getApi(cfg);
      try {
        await api.transferRawIdea(cfg.userId, rawIdeaId, nodeId);
        console.log(chalk.green(`✓ Transferred raw idea to node ${nodeId}`));
      } catch (e) {
        console.error(chalk.red(e.message));
      }
    });

  program
    .command("idea-auto [toggle]")
    .description("Toggle auto-placement of pending raw ideas every 15 min (on/off). Requires Standard plan+")
    .action(async (toggle) => {
      const cfg = requireAuth();
      const api = getApi(cfg);
      try {
        if (!toggle) {
          const data = await api.getUser(cfg.userId);
          const enabled = data.user?.autoPlaceIdeas ?? data.autoPlaceIdeas;
          console.log(`Auto-placement: ${enabled ? chalk.green("on") : chalk.dim("off")}`);
          return;
        }
        const enabled = toggle === "on" || toggle === "true" || toggle === "1";
        const data = await api.rawIdeaAutoPlace(cfg.userId, enabled);
        console.log(`Auto-placement: ${data.enabled ? chalk.green("on") : chalk.dim("off")}`);
      } catch (e) {
        console.error(chalk.red(e.message));
      }
    });

  } // end raw-ideas extension

  // ── Understanding (extension: understanding) ──
  if (hasExtension(cfg, "understanding")) {

  program
    .command("understand [perspective...]")
    .description("Start an understanding run from the node you are in. -i incremental (only new/changed nodes)")
    .option("-i, --incremental", "Only process new/changed nodes")
    .action(async (parts, { incremental }) => {
      const perspective = parts.length ? parts.join(" ") : "";
      const cfg = requireAuth();
      if (!cfg.activeRootId)
        return console.log(chalk.yellow("No tree selected. Run: use <name>, roots, or mkroot <name>"));
      const api = getApi(cfg);
      try {
        const nodeId = currentNodeId(cfg);
        console.log(chalk.dim("Creating understanding run…"));
        const data = await api.createUnderstanding(
          nodeId,
          perspective || "",
          !!incremental,
        );
        const runId =
          data.understandingRunId || data.run?._id || data.runId || data._id || "";
        console.log(chalk.green("✓ Understanding run created") + "  " + chalk.dim(runId));
        if (data.perspective)
          console.log(chalk.dim(`  Perspective: ${data.perspective}`));
        if (data.nodeCount != null)
          console.log(chalk.dim(`  Nodes to process: ${data.nodeCount}`));

        if (runId) {
          console.log(chalk.dim("Orchestrating… (this may take a while)"));
          const orch = await api.orchestrateUnderstanding(nodeId, runId);
          console.log(chalk.green("✓ Orchestration complete"));
          if (orch.nodesProcessed != null)
            console.log(chalk.dim(`  Nodes processed: ${orch.nodesProcessed}`));
          if (orch.rootEncoding)
            console.log(chalk.bold("\nEncoding:\n") + orch.rootEncoding);
        }
      } catch (e) {
        console.error(chalk.red(e.message));
      }
    });

  program
    .command("understandings")
    .description("List understanding runs for the node you are in")
    .action(async () => {
      const cfg = requireAuth();
      if (!cfg.activeRootId)
        return console.log(chalk.yellow("No tree selected. Run: use <name>, roots, or mkroot <name>"));
      const api = getApi(cfg);
      try {
        const nodeId = currentNodeId(cfg);
        const data = await api.listUnderstandings(nodeId);
        const runs = data.understandings || data.runs || data || [];
        if (!Array.isArray(runs) || !runs.length)
          return console.log(chalk.dim("  (no understanding runs)"));
        runs.forEach((run, i) => {
          const id = run._id || run.runId || "";
          const perspective = run.perspective ? chalk.white(run.perspective) : chalk.dim("(default)");
          const status = run.status ? chalk.yellow(` [${run.status}]`) : "";
          const ts = run.createdAt
            ? chalk.dim(new Date(run.createdAt).toLocaleString())
            : "";
          console.log(`  ${chalk.cyan(i + 1 + ".")} ${chalk.dim(id)}${status}  ${ts}`);
          console.log(`     Perspective: ${perspective}`);
          if (run.nodesProcessed != null && run.nodeCount != null)
            console.log(chalk.dim(`     Progress: ${run.nodesProcessed}/${run.nodeCount} nodes`));
        });
      } catch (e) {
        console.error(chalk.red(e.message));
      }
    });

  program
    .command("understand-status [runId]")
    .description("Check status of an understanding run")
    .action(async (runId) => {
      if (!runId) return console.log(chalk.yellow("Usage: understand-status <runId>"));
      const cfg = requireAuth();
      if (!cfg.activeRootId)
        return console.log(chalk.yellow("No tree selected. Run: use <name>, roots, or mkroot <name>"));
      const api = getApi(cfg);
      try {
        const data = await api.getUnderstandingRun(currentNodeId(cfg), runId);
        const run = data.run || data;
        console.log(chalk.dim(`Run ID: ${run._id || runId}`));
        if (run.status) console.log(`Status: ${chalk.yellow(run.status)}`);
        if (run.perspective) console.log(`Perspective: ${run.perspective}`);
        if (run.nodesProcessed != null && run.nodeCount != null)
          console.log(`Progress: ${run.nodesProcessed}/${run.nodeCount} nodes`);
        if (run.rootEncoding)
          console.log(chalk.dim(`Encoding: ${run.rootEncoding.slice(0, 80)}…`));
      } catch (e) {
        console.error(chalk.red(e.message));
      }
    });

  program
    .command("understand-stop [runId]")
    .description("Stop a running understanding run")
    .action(async (runId) => {
      if (!runId) return console.log(chalk.yellow("Usage: understand-stop <runId>"));
      const cfg = requireAuth();
      if (!cfg.activeRootId)
        return console.log(chalk.yellow("No tree selected. Run: use <name>, roots, or mkroot <name>"));
      const api = getApi(cfg);
      try {
        await api.stopUnderstanding(currentNodeId(cfg), runId);
        console.log(chalk.green("✓ Understanding run stopped"));
      } catch (e) {
        console.error(chalk.red(e.message));
      }
    });

  } // end understanding extension
};
