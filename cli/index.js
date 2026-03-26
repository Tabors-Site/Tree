#!/usr/bin/env node

const { Command } = require("commander");
const chalk = require("chalk");
const { version } = require("./package.json");
const { load, currentPath, currentLand } = require("./config");

const program = new Command();

program
  .name("treeos")
  .description(
    "CLI for Tree — navigate and manage your nodes like a filesystem",
  )
  .version(version)
  .addHelpText("afterAll", "")
  .configureHelp({
    formatHelp(cmd, helper) {
      const cfg = load();

      // Core sections
      const coreSections = [
        { title: "Getting Started", cmds: ["connect", "register", "login", "logout", "whoami"] },
        { title: "Navigation", cmds: ["pwd", "ls", "cd", "land", "home", "tree", "recent"] },
        { title: "Trees", cmds: ["roots", "use", "root", "mkroot", "retire"] },
        { title: "Nodes", cmds: ["mkdir", "rm", "mv", "rename", "what", "type", "complete", "activate", "trim"] },
        { title: "Notes", cmds: ["note", "notes", "cat", "rm-note", "download"] },
        { title: "AI", cmds: ["chat", "place", "query", "chats"] },
        { title: "Collaboration", cmds: ["team", "invite", "invites", "kick", "owner", "visibility", "share", "link", "share-token"] },
        { title: "LLM", cmds: ["llms", "llm"] },
        { title: "Extensions", cmds: ["ext", "ext-scope", "ext-block", "ext-allow", "ext-unallow", "ext-restrict", "protocol", "tools", "tools-allow", "tools-block", "tools-clear", "modes", "mode-set", "mode-clear"] },
        { title: "Canopy", cmds: ["peers", "peer", "search", "browse"] },
        { title: "System", cmds: ["config", "show", "flow"] },
      ];

      const coreNames = new Set();
      for (const s of coreSections) for (const c of s.cmds) coreNames.add(c);

      const cmdMap = {};
      cmd.commands.forEach((c) => { cmdMap[c.name()] = c; });

      const landUrl = cfg.landUrl || cfg.remoteDomain || null;
      const username = cfg.username || null;
      const extCount = cfg.landProtocol?.extensions?.length || 0;
      const treeName = cfg.activeRootName || null;

      let out = "";

      if (landUrl) {
        out += chalk.bold(`${username || "?"}`) + chalk.dim(`@${landUrl.replace(/^https?:\/\//, "")}`);
        if (extCount) out += chalk.dim(`  ${extCount} extensions`);
        out += "\n";
        if (treeName) {
          const pos = currentPath(cfg);
          out += chalk.cyan(treeName) + (pos ? chalk.dim(pos) : "") + "\n";
        }
        out += "\n";
      } else {
        out += chalk.bold(`TreeOS CLI v${version}`) + "\n";
        out += chalk.dim(`Not connected. Run: treeos connect <url>`) + "\n\n";
      }

      // Compact format: command padded to 32 chars, description after
      const PAD = 30;
      const fmtLine = (c) => {
        const usage = (c.name() + " " + c.usage()).replace(/ \[options\]/g, "").trim();
        // Strip chalk from description for the [extName] tag
        const desc = c.description().replace(/\s*\[.*?\]\s*$/, "").trim();
        const padded = usage.length < PAD ? usage + " ".repeat(PAD - usage.length) : usage + "  ";
        return `  ${padded}${chalk.dim(desc)}`;
      };

      const RULE = chalk.dim("─".repeat(50));
      const HEAVY_RULE = chalk.dim("═".repeat(50));

      // Core commands
      for (let si = 0; si < coreSections.length; si++) {
        const section = coreSections[si];
        const available = section.cmds.filter(name => cmdMap[name]);
        if (available.length === 0) continue;

        // Heavy rule before Getting Started
        if (si === 0) out += HEAVY_RULE + "\n";

        out += chalk.bold(section.title) + "\n";
        for (const name of available) {
          out += fmtLine(cmdMap[name]) + "\n";
          delete cmdMap[name];
        }

        // Separator after each section
        out += RULE + "\n";
      }

      // Extension commands grouped by extension name
      const extCmds = [];
      for (const [name, c] of Object.entries(cmdMap)) {
        if (!coreNames.has(name)) extCmds.push(c);
      }

      if (extCmds.length > 0) {
        out += HEAVY_RULE + "\n";

        const groups = {};
        for (const c of extCmds) {
          const match = c.description().match(/\[([^\]]+)\]$/);
          const ext = match ? match[1] : "other";
          if (!groups[ext]) groups[ext] = [];
          groups[ext].push(c);
        }

        for (const [ext, cmds] of Object.entries(groups)) {
          out += chalk.bold.magenta(ext.toUpperCase()) + chalk.dim(" (extension)") + "\n";
          for (const c of cmds) {
            out += fmtLine(c) + "\n";
          }
          out += RULE + "\n";
        }
      }

      out += chalk.dim("  -V, --version     Show version") + "\n";
      out += chalk.dim("  -h, --help        Show this help") + "\n";

      return out;
    },
  });

// ─────────────────────────────────────────────────────────────────────────────
// Register all command modules
// ─────────────────────────────────────────────────────────────────────────────
require("./commands/auth")(program);
require("./commands/user")(program);
require("./commands/nav")(program);
require("./commands/nodes")(program);
require("./commands/notes")(program);
require("./commands/collab")(program);
require("./commands/sharing")(program);
require("./commands/ai")(program);
require("./commands/blog")(program);
require("./commands/config")(program);
require("./commands/canopy")(program);
require("./commands/apikeys")(program);
require("./commands/llm")(program);
require("./commands/extensions")(program);
require("./commands/flow")(program);

// Dynamic commands from connected land's protocol (must be last)
require("./commands/dynamic")(program);

// ─────────────────────────────────────────────────────────────────────────────
// ERROR HANDLING (catch unknown commands, missing args)
// ─────────────────────────────────────────────────────────────────────────────
program.showHelpAfterError(true);
program.configureOutput({
  outputError(str, write) {
    // Clean up Commander's default error messages
    const cleaned = str.replace("error: ", "").trim();
    write(chalk.red(cleaned) + "\n");
  },
});

// Catch unknown top-level commands (don't exit in shell mode)
program.on("command:*", (operands) => {
  const unknown = operands[0];
  console.log(chalk.red(`Unknown command: ${unknown}`));

  const allCmds = program.commands.map(c => c.name());
  const suggestions = allCmds.filter(c => c.includes(unknown) || unknown.includes(c));
  if (suggestions.length) {
    console.log(chalk.dim(`Did you mean: ${suggestions.join(", ")}?`));
  }
  console.log(chalk.dim("Type 'help' for all commands."));
});

// Don't exit on errors in shell mode
program.exitOverride();

// ─────────────────────────────────────────────────────────────────────────────
// SHELL (interactive REPL)
// ─────────────────────────────────────────────────────────────────────────────
// Split a shell-like line respecting quoted strings
// e.g. 'note "hello world"' → ['note', 'hello world']
function shellSplit(input) {
  const args = [];
  let current = "";
  let inQuote = null;
  for (const ch of input) {
    if (inQuote) {
      if (ch === inQuote) {
        inQuote = null;
      } else current += ch;
    } else if (ch === '"' || ch === "'") {
      inQuote = ch;
    } else if (ch === " ") {
      if (current) {
        args.push(current);
        current = "";
      }
    } else {
      current += ch;
    }
  }
  if (current) args.push(current);
  return args;
}

const startShell = module.exports.startShell = async () => {
    const readline = require("readline");
    const cfg = load();

    if (!cfg.apiKey && !cfg.jwtToken) {
      console.log(
        chalk.yellow(
          "Not logged in. Run: treeos login or treeos register",
        ),
      );
      return;
    }

    // Prevent Commander from calling process.exit inside the shell
    program.exitOverride();
    program.commands.forEach((cmd) => cmd.allowUnknownOption());
    program.configureOutput({
      writeErr: (str) => {
        // Suppress Commander's own error output — we handle it
        const clean = str.replace(/\x1b\[[0-9;]*m/g, "").trim();
        if (clean) console.error(chalk.red(clean));
      },
      writeOut: (str) => process.stdout.write(str),
    });

    console.log(
      chalk.bold.green("TreeOS Shell") +
        chalk.dim('  (type "exit" to quit, "help" for commands)'),
    );
    console.log("");

    // Build command list for tab completion
    const allCmdNames = program.commands.map(c => c.name()).sort();

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: true,
      completer(line) {
        const parts = line.split(/\s+/);
        const partial = parts[0] || "";

        if (parts.length <= 1) {
          // Complete command name
          const hits = allCmdNames.filter(c => c.startsWith(partial));
          return [hits.length ? hits : allCmdNames, partial];
        }

        // For multi-word: no completion (let the command handle it)
        return [[], line];
      },
    });

    // Shadow hint: show ghost text of the best completion
    let lastHint = "";
    process.stdin.on("keypress", () => {
      // Clear previous hint
      if (lastHint) {
        process.stdout.write("\x1b[0K"); // clear to end of line
        lastHint = "";
      }

      // Show hint after a tick (so rl.line is updated)
      setImmediate(() => {
        const line = rl.line || "";
        const parts = line.split(/\s+/);
        if (parts.length === 1 && parts[0].length > 0) {
          const partial = parts[0];
          const match = allCmdNames.find(c => c.startsWith(partial) && c !== partial);
          if (match) {
            const rest = match.slice(partial.length);
            lastHint = rest;
            // Save cursor, write dim ghost text, restore cursor
            process.stdout.write("\x1b[s\x1b[2m" + rest + "\x1b[0m\x1b[u");
          }
        }
      });
    });

    const prompt = () => {
      const cfg = load(); // re-read so prompt reflects cd/use changes
      const user = cfg.username || cfg.userId || "?";
      const land = currentLand(cfg);
      const p = chalk.green(user) + chalk.dim("@") + chalk.dim(land) + chalk.dim(currentPath(cfg)) + chalk.bold.cyan(" › ");
      rl.setPrompt(p);
      rl.prompt();
    };

    rl.on("line", async (line) => {
      const input = line.trim();
      if (!input) return prompt();
      if (input === "exit" || input === "quit") {
        rl.close();
        return;
      }
      if (input === "shell" || input === "start") {
        console.log(chalk.dim("Already in shell. Type 'help' for commands, 'exit' to quit."));
        return prompt();
      }

      // Reset all subcommand options so flags don't stick between invocations
      program.commands.forEach((cmd) => {
        cmd.options.forEach((opt) => {
          cmd.setOptionValueWithSource(opt.attributeName(), opt.defaultValue, "default");
        });
      });

      // Strip "treeos" prefix if user types it inside the shell
      let cleanInput = input;
      if (/^treeos\s+/i.test(cleanInput)) {
        cleanInput = cleanInput.replace(/^treeos\s+/i, "");
      }

      // Re-dispatch through Commander as if the user typed "tree <input>"
      try {
        await program.parseAsync(["node", "tree", ...shellSplit(cleanInput)]);
      } catch (e) {
        // exitOverride throws instead of exiting — just swallow
        if (!e.code?.startsWith("commander.")) {
          console.error(chalk.red(e.message));
        }
      }

      prompt();
    });

    rl.on("close", () => {
      console.log(chalk.dim("\nBye!"));
      process.exit(0);
    });

    rl.on("SIGINT", () => {
      // If an AI request is in-flight, abort it instead of exiting
      if (global._treeosInFlight) {
        global._treeosInFlight.abort();
        return;
      }
      if (rl.line.length > 0) {
        // Line has content — clear it and re-prompt
        rl.write(null, { ctrl: true, name: "u" });
        process.stdout.write("\n");
        prompt();
      } else {
        // Empty line — exit
        rl.close();
      }
    });

    prompt();
};

program
  .command("shell")
  .description("Start an interactive shell session")
  .action(startShell);

program
  .command("start")
  .description("Start an interactive shell session")
  .action(startShell);

program
  .command("stop")
  .description("Exit the shell (alias for typing exit)")
  .action(() => {
    console.log(chalk.dim("Bye!"));
    process.exit(0);
  });

// ─────────────────────────────────────────────────────────────────────────────
// Parse — skip auto-parse when running interactively inside shell
// ─────────────────────────────────────────────────────────────────────────────
if (process.argv[2] !== "_shell_internal") {
  program.parseAsync(process.argv).catch((e) => {
    if (!e.code?.startsWith("commander.")) {
      console.error(chalk.red(e.message));
    }
    process.exit(1);
  });
}
