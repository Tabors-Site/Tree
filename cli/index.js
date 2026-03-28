#!/usr/bin/env node

const { Command } = require("commander");
const chalk = require("chalk");
const { version } = require("./package.json");
const { load, currentPath, currentLand, getProtocolCli, currentZone } = require("./config");

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

      const zone = currentZone(cfg);
      const cmdMap = {};
      cmd.commands.forEach((c) => { cmdMap[c.name()] = c; });

      // Zone filter: hide commands whose scope doesn't include the current zone
      const inScope = (c) => !c._scope || c._scope.includes(zone);

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
        const available = section.cmds.filter(name => cmdMap[name] && inScope(cmdMap[name]));
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
        if (!coreNames.has(name) && inScope(c)) extCmds.push(c);
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
// COMMAND ZONE SCOPING
// Built-in commands get scope assigned here (after all modules registered).
// Scope controls help display and tab completion visibility per zone.
// Commands without scope are available everywhere.
// ─────────────────────────────────────────────────────────────────────────────
{
  const TREE = ["tree"];
  const HOME = ["home"];
  const LAND = ["land"];
  const TREE_HOME = ["tree", "home"];
  const TREE_LAND = ["tree", "land"];
  const HOME_LAND = ["home", "land"];

  const scopes = {
    // Home zone
    roots: HOME, mkroot: HOME, use: HOME, root: HOME, recent: HOME, home: HOME,
    ideas: HOME, idea: HOME, "idea-store": HOME, "idea-place": HOME,
    "idea-transfer": HOME, "idea-auto": HOME, "rm-idea": HOME,
    energy: HOME, tier: HOME, invites: HOME, deleted: HOME, revive: HOME,
    "api-keys": HOME, backup: HOME, "backup-snapshot": HOME, "backup-restore": HOME, "backup-list": HOME,

    // Land zone
    config: LAND, peers: LAND, peer: LAND, search: LAND, browse: LAND,
    "log-level": LAND,

    // Tree zone
    cd: TREE, ls: TREE, pwd: TREE, tree: TREE,
    mkdir: TREE, rm: TREE, mv: TREE, rename: TREE, what: TREE, type: TREE,
    complete: TREE, activate: TREE, trim: TREE,
    note: TREE, cat: TREE, "rm-note": TREE, download: TREE, book: TREE,
    chat: TREE, place: TREE, query: TREE, chats: TREE,
    team: TREE, invite: TREE, kick: TREE, owner: TREE,
    share: TREE, visibility: TREE, "share-token": TREE,
    values: TREE, value: TREE, goal: TREE,
    prestige: TREE, schedule: TREE, calendar: TREE, "dream-time": TREE,
    holdings: TREE, "holdings-dismiss": TREE, "holdings-view": TREE,
    understand: TREE, understandings: TREE, "understand-status": TREE, "understand-stop": TREE,
    scripts: TREE, script: TREE, run: TREE,
    flow: TREE,
    "ext-scope": TREE, "ext-block": TREE, "ext-allow": TREE, "ext-unallow": TREE, "ext-restrict": TREE,
    tools: TREE, "tools-allow": TREE, "tools-block": TREE, "tools-clear": TREE,
    modes: TREE, "mode-set": TREE, "mode-clear": TREE,
    retire: TREE,
    "learn-status": TREE, "learn-resume": TREE, "learn-pause": TREE, "learn-stop": TREE,

    // Two-zone
    notes: TREE_HOME, contributions: TREE_HOME, tags: TREE_HOME,
    activity: HOME_LAND,
  };

  for (const cmd of program.commands) {
    const scope = scopes[cmd.name()];
    if (scope && !cmd._scope) cmd._scope = scope;
  }
}

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

    // ── Build command metadata for tab completion ──
    // Two sources: hardcoded Commander commands + dynamic protocol commands.
    const cmdMeta = new Map();
    for (const cmd of program.commands) {
      const entry = { description: cmd.description() || "", subcommands: null, options: [], scope: cmd._scope || null };
      // Collect option names (--flag style)
      for (const opt of cmd.options || []) {
        if (opt.long) entry.options.push(opt.long);
        if (opt.short) entry.options.push(opt.short);
      }
      // Collect subcommand names from nested Commander commands
      if (cmd.commands && cmd.commands.length > 0) {
        entry.subcommands = {};
        for (const sub of cmd.commands) {
          entry.subcommands[sub.name()] = sub.description() || "";
        }
      }
      cmdMeta.set(cmd.name(), entry);
    }
    // Dynamic commands from protocol: add subcommand metadata
    const protoCli = getProtocolCli(load());
    for (const [extName, commands] of Object.entries(protoCli)) {
      for (const decl of commands) {
        const name = decl.command.split(/\s+/)[0];
        if (!cmdMeta.has(name)) continue; // not registered (conflict)
        const entry = cmdMeta.get(name);
        if (decl.subcommands && !entry.subcommands) {
          entry.subcommands = {};
          for (const [sub, def] of Object.entries(decl.subcommands)) {
            entry.subcommands[sub] = typeof def === "object" ? (def.description || "") : "";
          }
        }
      }
    }

    // Filtered command list based on current zone. Recomputed on each tab press.
    function getCmdNamesForZone() {
      const zone = currentZone(load());
      const names = [];
      for (const [name, meta] of cmdMeta) {
        if (!meta.scope || meta.scope.includes(zone)) names.push(name);
      }
      return names.sort();
    }
    // Static list for fallback
    const allCmdNames = [...cmdMeta.keys()].sort();

    // ── Tab cycling engine ──
    // We take full control of tab behavior. Readline's completer is a no-op.
    // Tab fills the line with the current match and shows the description.
    // Each tab press cycles to the next match. Any other key resets.
    let _tabMatches = [];
    let _tabIndex = -1;
    let _tabPartial = "";   // what the user typed before first tab
    let _tabPrefix = "";    // leading part of line before the word being completed
    let _tabContext = "";   // "cmd", "sub:X", or "ext-arg"
    let _hintLine = "";

    function clearHint() {
      _hintLine = "";
    }

    function showHint(text) {
      _hintLine = text || "";
    }

    // Replace the current line content in readline
    function setLine(text) {
      rl.line = text;
      rl.cursor = text.length;
      process.stdout.write("\r");
      const cfg = load();
      const user = cfg.username || cfg.userId || "?";
      const land = currentLand(cfg);
      const session = cfg.activeSession ? chalk.magenta(` @${cfg.activeSession}`) : "";
      const p = chalk.green(user) + chalk.dim("@") + chalk.dim(land) + chalk.dim(currentPath(cfg)) + session + chalk.bold.cyan(" \u203a ");
      // Show hint inline after the command text (dim, same line)
      const hint = _hintLine ? chalk.dim("  " + _hintLine) : "";
      process.stdout.write(p + text + hint + "\x1b[0K");
      // Move cursor back to end of actual text (before hint)
      if (_hintLine) {
        const hintLen = _hintLine.length + 2; // +2 for leading spaces
        process.stdout.write(`\x1b[${hintLen}D`);
      }
    }

    function getMatchDescription(match, context) {
      let desc = "";
      if (context === "cmd") {
        const meta = cmdMeta.get(match);
        desc = meta?.description || "";
      } else if (context === "ext-arg") {
        const cfg = load();
        desc = cfg.landProtocol?.extensionDescriptions?.[match] || "";
      } else if (context.startsWith("sub:")) {
        const parentCmd = context.slice(4);
        const meta = cmdMeta.get(parentCmd);
        desc = meta?.subcommands?.[match] || "";
      }
      return desc.replace(/\x1b\[[0-9;]*m/g, "").trim();
    }

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: true,
      // No-op completer. We handle tab ourselves via keypress.
      completer(line) { return [[], line]; },
    });

    // Intercept tab before readline processes it
    process.stdin.on("keypress", (ch, key) => {
      if (key && key.name === "tab") {
        // First tab: compute matches from what the user has typed
        if (_tabMatches.length === 0) {
          const line = rl.line || "";
          const parts = line.split(/\s+/);
          const extArgTopLevel = new Set(["ext-block", "ext-allow", "ext-unallow", "ext-restrict"]);
          const extArgSubs = new Set(["disable", "enable", "info", "uninstall", "update", "publish"]);

          if (parts.length <= 1) {
            // Completing command name (filtered by current zone)
            const partial = parts[0] || "";
            const zoneCmds = getCmdNamesForZone();
            const hits = partial.length > 0
              ? zoneCmds.filter(c => c.startsWith(partial))
              : zoneCmds;
            if (hits.length === 0) return;
            _tabMatches = hits;
            _tabIndex = -1;
            _tabPartial = partial;
            _tabPrefix = "";
            _tabContext = "cmd";
          } else if (parts.length === 2 && extArgTopLevel.has(parts[0])) {
            // ext-block/ext-allow <extName> completion
            const cfg = load();
            const extNames = (cfg.landProtocol?.extensions || []).sort();
            const partial = parts[1] || "";
            const hits = partial.length > 0 ? extNames.filter(n => n.startsWith(partial)) : extNames;
            if (hits.length === 0) return;
            _tabMatches = hits;
            _tabIndex = -1;
            _tabPartial = partial;
            _tabPrefix = parts[0] + " ";
            _tabContext = "ext-arg";
          } else if (parts.length === 2) {
            // Completing subcommand
            const cmd = parts[0];
            const meta = cmdMeta.get(cmd);
            if (!meta?.subcommands) return;
            const subPartial = parts[1] || "";
            const subNames = Object.keys(meta.subcommands).sort();
            const hits = subPartial.length > 0
              ? subNames.filter(s => s.startsWith(subPartial))
              : subNames;
            if (hits.length === 0) return;
            _tabMatches = hits;
            _tabIndex = -1;
            _tabPartial = subPartial;
            _tabPrefix = cmd + " ";
            _tabContext = "sub:" + cmd;
          } else if (parts.length === 3 && parts[0] === "ext" && extArgSubs.has(parts[1])) {
            // ext disable/enable/info <extName> completion
            const cfg = load();
            const extNames = (cfg.landProtocol?.extensions || []).sort();
            const partial = parts[2] || "";
            const hits = partial.length > 0 ? extNames.filter(n => n.startsWith(partial)) : extNames;
            if (hits.length === 0) return;
            _tabMatches = hits;
            _tabIndex = -1;
            _tabPartial = partial;
            _tabPrefix = parts[0] + " " + parts[1] + " ";
            _tabContext = "ext-arg";
          } else {
            return;
          }
        }

        // Cycle to next match
        _tabIndex = (_tabIndex + 1) % _tabMatches.length;
        const match = _tabMatches[_tabIndex];

        // Set hint BEFORE setLine so it renders on the current draw
        const desc = getMatchDescription(match, _tabContext || "cmd");
        showHint(desc ? `${desc}` : "");

        // Fill the line with this match
        setLine(_tabPrefix + match);
        return;
      }

      // Any non-tab key: reset tab state, clear hint
      if (_tabMatches.length > 0) {
        _tabMatches = [];
        _tabIndex = -1;
        _tabPartial = "";
        _tabPrefix = "";
        _tabContext = "";
        clearHint();
      }
    });

    const prompt = () => {
      clearHint(); // remove any lingering hint line below
      const cfg = load(); // re-read so prompt reflects cd/use changes
      const user = cfg.username || cfg.userId || "?";
      const land = currentLand(cfg);
      const session = cfg.activeSession ? chalk.magenta(` @${cfg.activeSession}`) : "";
      const p = chalk.green(user) + chalk.dim("@") + chalk.dim(land) + chalk.dim(currentPath(cfg)) + session + chalk.bold.cyan(" › ");
      rl.setPrompt(p);
      rl.prompt();
    };

    rl.on("line", async (line) => {
      clearHint();
      _tabMatches = [];
      _tabIndex = -1;
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

      // @prefix shorthand: "@fitness hello" becomes "chat @fitness hello"
      if (cleanInput.startsWith("@")) {
        cleanInput = "chat " + cleanInput;
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
