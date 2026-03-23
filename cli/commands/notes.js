const chalk = require("chalk");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { load, requireAuth, currentNodeId, hasExtension } = require("../config");
const { getApi } = require("../helpers");
const { printNotes, printContributions, printBook } = require("../display");

module.exports = (program) => {
  const cfg = load();

  program
    .command("note [content...]")
    .description("Post a note on the node you are in")
    .action(async (parts) => {
      if (!parts || !parts.length) return console.log(chalk.yellow("Usage: note <content> or note ./file.pdf"));
      const content = parts.join(" ");
      const cfg = requireAuth();
      if (!cfg.activeRootId)
        return console.log(chalk.yellow("No tree selected. Run: use <name>, roots, or mkroot <name>"));
      const api = getApi(cfg);
      try {
        const nodeId = currentNodeId(cfg);

        // File upload: path starts with ./ or / or ~/
        if (content.startsWith("./") || content.startsWith("/") || content.startsWith("~/")) {
          const filePath = content.startsWith("~/")
            ? path.join(os.homedir(), content.slice(2))
            : path.resolve(content);
          if (!fs.existsSync(filePath)) {
            return console.log(chalk.red(`File not found: ${filePath}`));
          }
          if (fs.statSync(filePath).isDirectory()) {
            return console.log(chalk.red("Cannot upload a directory. Provide a file path."));
          }
          await api.uploadNote(nodeId, filePath);
          console.log(chalk.green("✓ File uploaded") + "  " + chalk.dim(path.basename(filePath)));
          return;
        }

        // Text note
        const data = await api.createNote(nodeId, content);
        console.log(
          chalk.green("✓ Note saved") + "  " + chalk.dim(data._id || ""),
        );
      } catch (e) {
        console.error(chalk.red(e.message));
      }
    });

  program
    .command("notes")
    .description("List notes (user notes at home, node notes in a tree). -l limit, -q search, -v version")
    .option("-l, --limit [n]", "Limit results")
    .option("-q, --query [query]", "Search notes")
    .option("-v, --version [n]", "Specific prestige version (default: latest)")
    .action(async ({ limit, query, version }) => {
      const cfg = requireAuth();
      const api = getApi(cfg);
      try {
        let notes;
        if (!cfg.activeRootId) {
          const data = await api.listUserNotes(cfg.userId, { limit, q: query });
          notes = data.notes || data || [];
        } else {
          const nodeId = currentNodeId(cfg);
          const opts = { limit, q: query };
          if (version != null) opts.version = Number(version);
          const data = await api.listNotes(nodeId, opts);
          notes = data.notes || data || [];
        }
        printNotes(Array.isArray(notes) ? notes : []);
      } catch (e) {
        console.error(chalk.red(e.message));
      }
    });

  program
    .command("tags")
    .alias("mail")
    .description("List notes where you've been @tagged by other users")
    .action(async () => {
      const cfg = requireAuth();
      const api = getApi(cfg);
      try {
        const data = await api.listUserTags(cfg.userId);
        const tags = data.notes || data || [];
        if (!Array.isArray(tags) || !tags.length)
          return console.log(chalk.dim("  (no tags)"));
        printNotes(tags);
      } catch (e) {
        console.error(chalk.red(e.message));
      }
    });

  program
    .command("rm-note [noteId]")
    .description("Delete a note by ID. -f skip confirmation")
    .option("-f, --force", "Skip confirmation prompt")
    .action(async (noteId, { force }) => {
      if (!noteId) return console.log(chalk.yellow("Usage: rm-note <noteId> -f"));
      const cfg = requireAuth();
      if (!cfg.activeRootId)
        return console.log(chalk.yellow("No tree selected. Run: use <name>, roots, or mkroot <name>"));
      if (!force)
        return console.log(
          chalk.yellow(`Delete note ${noteId}? Pass -f to confirm.`),
        );
      const api = getApi(cfg);
      try {
        const nodeId = currentNodeId(cfg);
        await api.deleteNote(nodeId, noteId);
        console.log(chalk.green("✓ Note deleted"));
      } catch (e) {
        console.error(chalk.red(e.message));
      }
    });

  // ── Book (extension: book) ──
  if (hasExtension(cfg, "book")) {
  program
    .command("book")
    .description("Print the full book of notes from the node you are in")
    .action(async () => {
      const cfg = requireAuth();
      if (!cfg.activeRootId)
        return console.log(chalk.yellow("No tree selected. Run: use <name>, roots, or mkroot <name>"));
      const api = getApi(cfg);
      try {
        const data = await api.getBook(currentNodeId(cfg));
        const book = data.book || data || {};
        printBook(book);
      } catch (e) {
        console.error(chalk.red(e.message));
      }
    });
  } // end book extension

  program
    .command("contributions")
    .description("List contributions (user at home, node in a tree). -v version")
    .option("-v, --version [n]", "Specific prestige version (default: latest)")
    .action(async ({ version }) => {
      const cfg = requireAuth();
      const api = getApi(cfg);
      try {
        if (!cfg.activeRootId) {
          const data = await api.listUserContributions(cfg.userId, { limit: 50 });
          const items = data.contributions || data || [];
          printContributions(Array.isArray(items) ? items : []);
        } else {
          const nodeId = currentNodeId(cfg);
          const opts = { limit: 50 };
          if (version != null) opts.version = Number(version);
          const data = await api.listNodeContributions(nodeId, opts);
          const items = data.contributions || data || [];
          printContributions(Array.isArray(items) ? items : []);
        }
      } catch (e) {
        console.error(chalk.red(e.message));
      }
    });

  if (hasExtension(cfg, "values")) {
  program
    .command("values")
    .description("List values on the current node. -g global totals, -t per-node tree breakdown, -v version")
    .option("-g, --global", "Show flat totals across the entire tree")
    .option("-t, --tree", "Show values as a tree with per-node breakdowns")
    .option("-v, --version [n]", "Specific prestige version (default: latest)")
    .action(async ({ global: isGlobal, tree: isTree, version }) => {
      const cfg = requireAuth();
      if (!cfg.activeRootId)
        return console.log(chalk.yellow("No tree selected. Run: use <name>, roots, or mkroot <name>"));
      const api = getApi(cfg);
      try {
        if (isGlobal || isTree) {
          const data = await api.getRootValues(cfg.activeRootId);
          if (isTree) {
            const tree = data.tree || {};
            function printNode(node, indent = "") {
              const local = node.localValues || {};
              const total = node.totalValues || {};
              const localEntries = Object.entries(local).filter(([k]) => !k.startsWith("_auto__"));
              const totalEntries = Object.entries(total).filter(([k]) => !k.startsWith("_auto__"));
              const hasLocal = localEntries.length > 0;
              const hasTotal = totalEntries.length > 0;
              if (hasLocal || hasTotal) {
                console.log(`${indent}${chalk.bold(node.nodeName || "root")}`);
                for (const [k, v] of localEntries) {
                  console.log(`${indent}  ${chalk.cyan(k)}  ${v}`);
                }
                if (node.children?.length && hasTotal) {
                  for (const [k, v] of totalEntries) {
                    if (local[k] !== v) console.log(`${indent}  ${chalk.dim(k + " (total)")}  ${chalk.dim(v)}`);
                  }
                }
              }
              for (const child of node.children || []) {
                printNode(child, indent + "  ");
              }
            }
            printNode(tree);
          } else {
            const vals = data.flat || data;
            const entries = Object.entries(vals).filter(([k]) => !k.startsWith("_auto__"));
            if (!entries.length) return console.log(chalk.dim("  (no global values)"));
            console.log(chalk.bold("Global values (all nodes):"));
            entries.forEach(([k, v]) => console.log(`  ${chalk.cyan(k)}  ${v}`));
          }
        } else {
          const data = await api.getValues(currentNodeId(cfg), version != null ? Number(version) : undefined);
          const vals = data.values || data || {};
          const entries = Object.entries(vals).filter(([k]) => !k.startsWith("_auto__"));
          if (!entries.length) return console.log(chalk.dim("  (no values)"));
          entries.forEach(([k, v]) => console.log(`  ${chalk.cyan(k)}  ${v}`));
        }
      } catch (e) {
        console.error(chalk.red(e.message));
      }
    });

  program
    .command("value [key] [value]")
    .description("Set a value on the node you are in")
    .action(async (key, value) => {
      if (!key || !value) return console.log(chalk.yellow("Usage: value <key> <value>"));
      const cfg = requireAuth();
      if (!cfg.activeRootId)
        return console.log(chalk.yellow("No tree selected. Run: use <name>, roots, or mkroot <name>"));
      const api = getApi(cfg);
      try {
        const nodeId = currentNodeId(cfg);
        const parsed = isNaN(value) ? value : Number(value);
        await api.setValue(nodeId, key, parsed);
        console.log(chalk.green(`✓ Set ${key} = ${parsed}`));
      } catch (e) {
        console.error(chalk.red(e.message));
      }
    });

  program
    .command("goal [key] [goal]")
    .description("Set a goal on the node you are in")
    .action(async (key, goal) => {
      if (!key || !goal) return console.log(chalk.yellow("Usage: goal <key> <goal>"));
      const cfg = requireAuth();
      if (!cfg.activeRootId)
        return console.log(chalk.yellow("No tree selected. Run: use <name>, roots, or mkroot <name>"));
      const api = getApi(cfg);
      try {
        const nodeId = currentNodeId(cfg);
        const parsed = isNaN(goal) ? goal : Number(goal);
        await api.setGoal(nodeId, key, parsed);
        console.log(chalk.green(`✓ Goal ${key} = ${parsed}`));
      } catch (e) {
        console.error(chalk.red(e.message));
      }
    });
  } // end values extension

  program
    .command("download [noteId]")
    .description("Download a note to a local file. Text notes save as .txt, file notes save with original name.")
    .option("-o, --output [path]", "Output file path (default: auto-named in current directory)")
    .action(async (noteId, opts) => {
      if (!noteId) return console.log(chalk.yellow("Usage: download <noteId or #>"));
      const cfg = requireAuth();
      if (!cfg.activeRootId)
        return console.log(chalk.yellow("No tree selected."));
      const api = getApi(cfg);
      const fs = require("fs");
      const path = require("path");
      try {
        const nodeId = currentNodeId(cfg);
        const data = await api.getNotes(nodeId, { limit: 100 });
        const notes = data.notes || data || [];

        let note;
        const num = parseInt(noteId, 10);
        if (!isNaN(num) && num > 0 && num <= notes.length) {
          note = notes[num - 1];
        } else {
          note = notes.find(n => n._id === noteId || n._id?.startsWith(noteId));
        }
        if (!note) return console.log(chalk.red("Note not found"));

        if (note.contentType === "file") {
          const url = `${api.baseUrl || ""}/uploads/${note.content}`;
          const res = await fetch(url, { headers: { "x-api-key": api.apiKey } });
          if (!res.ok) return console.log(chalk.red("Failed to download file"));
          const outPath = opts.output || note.content;
          const buffer = Buffer.from(await res.arrayBuffer());
          fs.writeFileSync(outPath, buffer);
          console.log(chalk.green(`Downloaded: ${outPath} (${buffer.length} bytes)`));
        } else {
          const content = note.content || "";
          const outPath = opts.output || `note-${(note._id || "unknown").slice(0, 8)}.txt`;
          fs.writeFileSync(outPath, content, "utf8");
          console.log(chalk.green(`Saved: ${outPath} (${content.length} chars)`));
        }
      } catch (e) {
        console.error(chalk.red(e.message));
      }
    });

  program
    .command("cat [type] [idOrNumber...]")
    .description("View full content: cat note <id/#>, cat idea <id/#>")
    .action(async (type, parts) => {
      if (!type || !parts?.length)
        return console.log(chalk.yellow("Usage: cat note <id or #>, cat idea <id or #>"));
      const input = parts.join(" ");
      const cfg = requireAuth();
      const api = getApi(cfg);
      try {
        if (type === "idea") {
          const num = parseInt(input, 10);
          let idea;
          if (!isNaN(num) && num > 0 && !/^[0-9a-f-]{8,}$/i.test(input)) {
            const data = await api.listRawIdeas(cfg.userId, { status: "all" });
            const ideas = data.rawIdeas || data.ideas || data || [];
            idea = ideas[num - 1];
            if (!idea) return console.log(chalk.yellow(`No idea at position ${num}`));
          } else {
            const data = await api.getRawIdea(cfg.userId, input);
            idea = data.rawIdea || data;
          }
          console.log(chalk.bold("Idea") + "  " + chalk.dim(idea._id || input));
          if (idea.createdAt) console.log(chalk.dim(new Date(idea.createdAt).toLocaleString()));
          if (idea.status) console.log(chalk.yellow(`[${idea.status}]`));
          console.log("\n" + (idea.content || "(empty)"));
        } else if (type === "note") {
          const num = parseInt(input, 10);
          let notes;
          if (!cfg.activeRootId) {
            const data = await api.listUserNotes(cfg.userId);
            notes = data.notes || data || [];
          } else {
            const nodeId = currentNodeId(cfg);
            const data = await api.listNotes(nodeId);
            notes = data.notes || data || [];
          }
          let note;
          if (!isNaN(num) && num > 0 && !/^[0-9a-f-]{8,}$/i.test(input)) {
            note = notes[num - 1];
            if (!note) return console.log(chalk.yellow(`No note at position ${num}`));
          } else {
            note = notes.find(n => n._id === input || n._id.startsWith(input));
            if (!note) return console.log(chalk.yellow(`No note matching "${input}"`));
          }
          console.log(chalk.bold("Note") + "  " + chalk.dim(note._id || ""));
          if (note.createdAt) console.log(chalk.dim(new Date(note.createdAt).toLocaleString()));
          console.log("\n" + (note.content || "(empty)"));
        } else {
          console.log(chalk.yellow("Usage: cat note <id or #>, cat idea <id or #>"));
        }
      } catch (e) {
        console.error(chalk.red(e.message));
      }
    });
};
