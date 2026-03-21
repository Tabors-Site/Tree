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
      const sections = [
        {
          title: "Getting Started",
          cmds: ["connect", "register", "login", "logout", "whoami"],
        },
        {
          title: "Navigation",
          cmds: ["pwd", "ls", "cd", "home", "tree", "calendar", "dream-time"],
        },
        {
          title: "Trees",
          cmds: ["roots", "use", "root", "mkroot", "retire", "invites", "tags", "ideas", "idea", "idea-store", "rm-idea", "idea-place", "idea-auto", "idea-transfer", "contributions", "share-token", "share", "link"],
        },
        {
          title: "Node Management",
          cmds: ["mkdir", "rm", "mv", "rename", "complete", "activate", "trim", "schedule", "prestige"],
        },
        {
          title: "Notes & Values",
          cmds: ["note", "notes", "cat", "rm-note", "book", "contributions", "values", "value", "goal"],
        },
        {
          title: "Collaboration",
          cmds: ["team", "invite", "invites", "kick", "owner"],
        },
        {
          title: "AI",
          cmds: ["chat", "chats", "place", "query"],
        },
        {
          title: "Understanding Runs",
          cmds: ["understand", "understandings", "understand-status", "understand-stop"],
        },
        {
          title: "Canopy (federation)",
          cmds: ["peers", "peer", "search", "browse"],
        },
        {
          title: "Blog",
          cmds: ["blogs", "blog"],
        },
        {
          title: "Land Config",
          cmds: ["config"],
        },
      ];

      const cmdMap = {};
      cmd.commands.forEach((c) => {
        cmdMap[c.name()] = c;
      });

      let out = `Usage: ${helper.commandUsage(cmd)}\n\n`;
      out += `What is Tree?\n`;
      out += `  A living structure for everything you're building, thinking, and tracking.\n`;
      out += `  Organize knowledge into trees of nodes, each with history, AI context,\n`;
      out += `  goals, and values. Navigate and manage your trees from the terminal.\n\n`;
      out += `  https://treeOS.ai/about\n\n`;
      out += `  Docs:\n`;
      out += `    Getting Started    https://treeOS.ai/about/gettingstarted\n`;
      out += `    Raw Ideas          https://treeOS.ai/about/raw-ideas\n`;
      out += `    Energy System      https://treeOS.ai/about/energy\n`;
      out += `    Tree Dreams        https://treeOS.ai/about/dreams\n`;
      out += `    CLI                https://treeOS.ai/about/cli\n`;
      out += `    Gateway            https://treeOS.ai/about/gateway\n`;
      out += `    API Reference      https://treeOS.ai/about/api\n`;
      out += `    Blog               https://treeOS.ai/blog\n\n`;

      const fmtUsage = (c) => {
        return (c.name() + " " + c.usage()).replace(/ \[options\]/g, "").trim();
      };

      for (const section of sections) {
        out += `${section.title}:\n`;
        for (const name of section.cmds) {
          const c = cmdMap[name];
          if (!c) continue;
          out += `  ${fmtUsage(c)}\n`;
          out += `      ${c.description()}\n`;
          delete cmdMap[name];
        }
        out += "\n";
      }

      // Any remaining commands not in a section
      const remaining = Object.values(cmdMap);
      if (remaining.length) {
        out += "Other:\n";
        for (const c of remaining) {
          out += `  ${fmtUsage(c)}\n`;
          out += `      ${c.description()}\n`;
        }
        out += "\n";
      }

      out += `Options:\n`;
      out += `  -V, --version                       output the version number\n`;
      out += `  -h, --help                           display help for command\n`;

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

    if (!cfg.apiKey) {
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

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: true,
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

      // Reset all subcommand options so flags don't stick between invocations
      program.commands.forEach((cmd) => {
        cmd.options.forEach((opt) => {
          cmd.setOptionValueWithSource(opt.attributeName(), opt.defaultValue, "default");
        });
      });

      // Re-dispatch through Commander as if the user typed "tree <input>"
      try {
        await program.parseAsync(["node", "tree", ...shellSplit(input)]);
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
  program.parseAsync(process.argv);
}
