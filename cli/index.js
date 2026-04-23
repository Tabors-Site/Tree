#!/usr/bin/env node

const { Command } = require("commander");
const chalk = require("chalk");
const { version } = require("./package.json");
const { load, currentPath, currentLand, getProtocolCli, currentZone, currentNodeId } = require("./config");
const { getApi } = require("./helpers");

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
        { title: "Nodes", cmds: ["mkdir", "rm", "mv", "rename", "node", "type", "complete", "activate", "trim"] },
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
    energy: HOME, tier: HOME, invites: HOME, deleted: HOME, revive: HOME, "share-token": HOME,
    "api-keys": HOME, backup: HOME, "backup-snapshot": HOME, "backup-restore": HOME, "backup-list": HOME,

    // Land zone
    config: LAND, peers: LAND, peer: LAND,
    "log-level": LAND,

    // Home + Land
    search: HOME_LAND, browse: HOME_LAND,

    // Tree zone
    cd: TREE, ls: TREE, pwd: TREE, tree: TREE,
    mkdir: TREE, rm: TREE, mv: TREE, rename: TREE, what: TREE, type: TREE,
    complete: TREE, activate: TREE, trim: TREE,
    note: TREE, cat: TREE, "rm-note": TREE, download: TREE, book: TREE,
    chat: TREE, place: TREE, query: TREE, chats: TREE,
    team: TREE, invite: TREE, kick: TREE, owner: TREE,
    share: TREE, visibility: TREE,
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
    notes: TREE_HOME, contributions: TREE_HOME, tags: TREE_HOME, link: TREE_HOME,
    activity: HOME_LAND,
    llms: TREE_HOME, llm: TREE_HOME,

    // Tree only (dynamic/extension commands that leak without scope)
    be: TREE, cc: TREE, go: TREE,
    scout: TREE, explore: TREE, trace: TREE,
    changelog: TREE, digest: TREE, delegate: TREE,
    competence: TREE, evolve: TREE, inverse: TREE,
    intent: TREE, reflect: TREE,

    // Land only
    bundle: LAND, os: LAND, ext: LAND,
    "governance-status": LAND, "governance-check": LAND,

    // Global (no scope needed, available everywhere)
    // whoami, help, logout, connect, login, register, start, stop, protocol, sessions
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

// In shell mode, unknown input becomes chat. Outside shell, show error.
let _shellMode = false;
let _shellChatFallback = null; // set by onLine to capture the full input

program.on("command:*", (operands) => {
  if (_shellMode && _shellChatFallback) {
    // Mark for chat fallback. onLine will handle it after parseAsync returns.
    _shellChatFallback = "__fallback__";
    return;
  }

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
    _shellMode = true;
    // Public flag dynamic commands read to know they should fall through
    // to chat on soft failures (404, "not found") instead of printing an
    // error. Set/cleared here so commands outside shell keep crashing loud.
    global._treeosInShell = true;
    const readline = require("readline");
    const fs = require("fs");
    const path = require("path");
    const os = require("os");
    const cfg = load();

    // ── Command history (persists across sessions) ──
    const HISTORY_FILE = path.join(os.homedir(), ".treeos", "history");
    const MAX_HISTORY = 500;
    let _history = [];
    try {
      const raw = fs.readFileSync(HISTORY_FILE, "utf8").trim();
      if (raw) _history = raw.split("\n").reverse(); // readline expects newest-first
    } catch (_) {}

    function saveHistory() {
      try {
        // rl.history is newest-first, file stores oldest-first
        const lines = (_history || []).slice(0, MAX_HISTORY).slice().reverse();
        fs.writeFileSync(HISTORY_FILE, lines.join("\n") + "\n");
      } catch (_) {}
    }

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
    let _tabContext = "";   // "cmd", "sub:X", "ext-arg", or "child"
    let _hintLine = "";

    // Cached child node names for tab completion
    let _childCache = null;    // { nodeId, names: ["name1", ...] }
    async function getChildNames() {
      const cfg = load();
      const nodeId = currentNodeId(cfg);
      const cacheKey = nodeId || "home";
      if (_childCache && _childCache.nodeId === cacheKey) return _childCache.names;
      try {
        const api = getApi(cfg);
        if (!nodeId) {
          // At home: list roots
          const data = await api.getUser(cfg.userId);
          const roots = data.roots || data.user?.roots || [];
          const names = roots.map(r => r.name).filter(Boolean);
          _childCache = { nodeId: cacheKey, names };
          return names;
        }
        const data = await api.getNode(nodeId);
        const children = (data.node || data).children || [];
        const names = children.map(c => c.name).filter(Boolean);
        _childCache = { nodeId: cacheKey, names };
        return names;
      } catch { return []; }
    }

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
      // Truncate hint so it never wraps to the next line
      let hint = "";
      let hintVisLen = 0;
      if (_hintLine) {
        const cols = process.stdout.columns || 80;
        const promptVisLen = p.replace(/\x1b\[[0-9;]*m/g, "").length;
        const available = cols - promptVisLen - text.length - 2; // 2 for leading spaces
        if (available > 3) {
          const truncated = _hintLine.length > available
            ? _hintLine.slice(0, available - 1) + "\u2026"
            : _hintLine;
          hint = chalk.dim("  " + truncated);
          hintVisLen = truncated.length + 2;
        }
      }
      process.stdout.write(p + text + hint + "\x1b[0K");
      // Move cursor back to end of actual text (before hint)
      if (hintVisLen) {
        process.stdout.write(`\x1b[${hintVisLen}D`);
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

    let rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: true,
      history: _history,
      historySize: MAX_HISTORY,
      // No-op completer. We handle tab ourselves via keypress.
      completer(line) { return [[], line]; },
    });

    // Intercept tab before readline processes it
    let _tabFetching = false;
    const _onKeypress = (ch, key) => {
      if (key && key.name === "tab") {
        // First tab: compute matches from what the user has typed
        if (_tabMatches.length === 0 && !_tabFetching) {
          const line = rl.line || "";
          const parts = line.split(/\s+/);
          const extArgTopLevel = new Set(["ext-block", "ext-allow", "ext-unallow", "ext-restrict"]);
          const extArgSubs = new Set(["disable", "enable", "info", "uninstall", "update", "publish"]);
          const navCmds = new Set(["cd", "use", "root", "rm", "rename", "mv"]);

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
          } else if (parts.length === 2 && parts[0] === "cd") {
            // cd <partial>: complete against child node names
            const partial = parts[1] || "";
            _tabFetching = true;
            getChildNames().then(names => {
              _tabFetching = false;
              const hits = partial.length > 0
                ? names.filter(n => n.toLowerCase().startsWith(partial.toLowerCase()))
                : names;
              if (hits.length === 0) return;
              _tabMatches = hits;
              _tabIndex = 0;
              _tabPartial = partial;
              _tabPrefix = "cd ";
              _tabContext = "child";
              showHint("");
              setLine("cd " + hits[0]);
            }).catch(() => { _tabFetching = false; });
            return;
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

      // Any non-tab key: reset tab state, clear hint, invalidate child cache
      if (_tabMatches.length > 0) {
        _tabMatches = [];
        _tabIndex = -1;
        _childCache = null;
        _tabPartial = "";
        _tabPrefix = "";
        _tabContext = "";
        clearHint();
      }
    };
    process.stdin.on("keypress", _onKeypress);

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

    function onClose() {
      _history = rl.history || _history;
      saveHistory();
      console.log(chalk.dim("\nBye!"));
      process.exit(0);
    }

    function onSigint() {
      if (global._treeosInFlight) {
        global._treeosInFlight.abort();
        return;
      }
      if (rl.line.length > 0) {
        rl.write(null, { ctrl: true, name: "u" });
        process.stdout.write("\n");
        prompt();
      } else {
        rl.close();
      }
    }

    let _processing = false;
    const _lineQueue = [];

    async function processLine(input) {
      if (input === "exit" || input === "quit") {
        rl.close();
        return;
      }
      if (input === "shell" || input === "start") {
        console.log(chalk.dim("Already in shell. Type 'help' for commands, 'exit' to quit."));
        return;
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

      // Capture history before closing so it carries over to the new readline
      _history = rl.history || [];
      saveHistory();

      // Conversational commands (chat / place / query / be / @handle / any
      // line that will fall through to `chat`) don't spin up their own
      // readline — they stream over the websocket while the shell stays
      // responsive. Keep the shell rl ALIVE for those so mid-flight input
      // isn't trapped in the TTY buffer; the onLine handler routes it
      // through ws.sendMidflight while _processing is true.
      //
      // Non-conversational commands (login, register, llm add, passwd) DO
      // create their own interactive readline and would fight stdin with
      // the shell's rl — those take the close/reopen path.
      //
      // Bare messages (e.g. the user types "hi") look like an unknown
      // command at the top level but get fallback-wrapped to
      // `chat hi` later inside this try/catch. We have to predict that
      // BEFORE closing rl, otherwise the mid-flight buffer trap kicks in
      // for every first-message-without-an-explicit-verb.
      const firstWord = cleanInput.split(/\s+/)[0]?.toLowerCase() || "";
      const conversational = new Set(["chat", "place", "query", "be"]);
      const cliCommandSet = new Set(program.commands.map((c) => c.name()));
      const shellKeywords = new Set(["exit", "quit", "shell", "start", "help", "?"]);
      const startsAtHandle = cleanInput.startsWith("@");
      const willChatFallback = !cliCommandSet.has(firstWord) && !shellKeywords.has(firstWord);
      const keepShellRl = conversational.has(firstWord) || startsAtHandle || willChatFallback;

      let subSigint = null;
      if (!keepShellRl) {
        // Fully detach the shell readline and keypress listener so subcommands
        // that create their own readline don't fight over stdin with duplicate
        // listeners.
        process.stdin.removeListener("keypress", _onKeypress);
        rl.removeListener("close", onClose);
        rl.close();
        // While the subcommand runs there is no readline SIGINT handler, so a
        // bare Ctrl+C would hit Node's default and kill the whole shell.
        // Install a process-level guard that aborts the in-flight chat
        // instead; if there is nothing in flight the handler just swallows
        // the signal so the user drops back to the shell prompt rather than
        // exiting treeos.
        subSigint = () => {
          if (global._treeosInFlight) {
            global._treeosInFlight.abort();
          }
        };
        process.on("SIGINT", subSigint);
      }
      // else: shell rl stays open. Its existing onSigint handler already
      // calls global._treeosInFlight.abort() when present, so Ctrl+C still
      // cancels the chat cleanly.
      try {
        _shellChatFallback = cleanInput;
        global._treeosChatFallback = false;
        await program.parseAsync(["node", "tree", ...shellSplit(cleanInput)]);
        // Two fallback paths to the same place:
        //   1. __fallback__  — Commander couldn't find the command at all
        //      (command:* fired). The whole line is unknown vocabulary.
        //   2. global._treeosChatFallback — a command was found and ran, but
        //      the extension behind it returned not-found (verb collision:
        //      `run the tests` matched scripts `run <id>` and the script
        //      named "the" doesn't exist). The dynamic command handler sets
        //      this flag instead of printing the error.
        if (_shellChatFallback === "__fallback__" || global._treeosChatFallback) {
          _shellChatFallback = null;
          global._treeosChatFallback = false;
          await program.parseAsync(["node", "tree", "chat", cleanInput]);
        }
        _shellChatFallback = null;
      } catch (e) {
        _shellChatFallback = null;
        global._treeosChatFallback = false;
        if (!e.code?.startsWith("commander.")) {
          console.error(chalk.red(e.message));
        }
      } finally {
        if (subSigint) process.removeListener("SIGINT", subSigint);
      }
      // Recreate shell readline and reattach listeners — but only if we
      // tore it down. Conversational commands left rl alive so mid-flight
      // input could flow through; nothing to rebuild in that case.
      if (!keepShellRl) {
        rl = readline.createInterface({
          input: process.stdin,
          output: process.stdout,
          terminal: true,
          history: _history,
          historySize: MAX_HISTORY,
          completer(line) { return [[], line]; },
        });
        rl.on("line", onLine);
        rl.on("close", onClose);
        rl.on("SIGINT", onSigint);
        process.stdin.on("keypress", _onKeypress);
      }
    }

    async function drainQueue() {
      while (_lineQueue.length > 0) {
        const next = _lineQueue.shift();
        await processLine(next);
      }
      _processing = false;
      prompt();
    }

    async function onLine(line) {
      clearHint();
      _tabMatches = [];
      _tabIndex = -1;
      const input = line.trim();
      if (!input) return prompt();

      if (_processing) {
        // A chat is in flight. Two possible intents for this new line:
        //   (a) mid-flight natural-language update — send to the active
        //       socket so the server's stream extension intercepts and
        //       injects into the current turn at the next tool-loop
        //       checkpoint. Matches how the HTML UI works.
        //   (b) a follow-on shell command the user wants to run AFTER
        //       the chat completes — queue it.
        //
        // Heuristic: if the first word matches a registered top-level
        // CLI command (chat, cd, ls, help, etc.), treat as (b) and
        // queue. Otherwise treat as (a) and ship over the socket.
        // Natural-language mid-flight updates rarely start with
        // one of those words, and when they accidentally do the user
        // can simply wait for the chat to finish and rephrase.
        const firstWord = input.split(/\s+/)[0]?.toLowerCase() || "";
        const cliCommands = new Set(program.commands.map((c) => c.name()));
        // Shell keywords are always queued regardless of first word.
        const shellKeywords = new Set(["exit", "quit", "shell", "start", "help", "?"]);
        const looksLikeCommand = cliCommands.has(firstWord) || shellKeywords.has(firstWord);

        if (!looksLikeCommand) {
          try {
            const ws = require("./ws");
            if (ws.hasActiveSocket && ws.hasActiveSocket()) {
              const sent = ws.sendMidflight(input);
              if (sent) {
                console.log(chalk.dim(`  mid-flight → ${input}`));
                return;
              }
            }
          } catch {
            // ws module missing — fall through to queue
          }
        }

        _lineQueue.push(input);
        console.log(chalk.dim(`  queued: ${input}`));
        return;
      }

      _processing = true;
      await processLine(input);
      await drainQueue();
    }

    rl.on("line", onLine);
    rl.on("close", onClose);
    rl.on("SIGINT", onSigint);

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
