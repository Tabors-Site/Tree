const chalk = require("chalk");
const readline = require("readline");
const { requireAuth } = require("../config");
const { getApi } = require("../helpers");

function ask(rl, question) {
  return new Promise((resolve) => rl.question(question, resolve));
}

module.exports = (program) => {

  program
    .command("llms")
    .description("List your custom LLM connections")
    .action(async () => {
      const cfg = requireAuth();
      const api = getApi(cfg);
      try {
        const data = await api.listLlmConnections(cfg.userId);
        const connections = data.connections || [];
        if (!connections.length) {
          console.log(chalk.dim("No LLM connections. Run 'llm add' to set one up."));
          return;
        }
        console.log(chalk.bold(`LLM Connections (${connections.length})\n`));
        for (const c of connections) {
          const status = c.isDefault ? chalk.green(" (default)") : "";
          console.log(`  ${chalk.cyan(c.name || c._id)}${status}`);
          console.log(`    ${chalk.dim("model:")} ${c.model}`);
          console.log(`    ${chalk.dim("url:")} ${c.baseUrl}`);
          console.log(`    ${chalk.dim("id:")} ${c._id}`);
          console.log();
        }
      } catch (e) {
        console.error(chalk.red(e.message));
      }
    });

  program
    .command("llm [action] [args...]")
    .description("Manage LLM connections: add, edit <id>, remove <id>, assign <slot> <id>, tree-assign <slot> <id>")
    .option("--name <name>", "Connection name")
    .option("--url <url>", "Base URL")
    .option("--model <model>", "Model name")
    .option("--key <key>", "API key")
    .action(async (action, args, opts) => {
      if (!action) {
        console.log(chalk.bold("LLM Management\n"));
        console.log("  " + chalk.cyan("llms") + chalk.dim("                    List your connections"));
        console.log("  " + chalk.cyan("llm open") + chalk.dim("                Open LLM page in browser"));
        console.log("  " + chalk.cyan("llm add") + chalk.dim("                 Add (interactive, or use flags)"));
        console.log("  " + chalk.cyan("llm edit <id>") + chalk.dim("           Edit a connection (use flags)"));
        console.log("  " + chalk.cyan("llm remove <id>") + chalk.dim("         Remove a connection"));
        console.log("  " + chalk.cyan("llm assign <slot> <id>") + chalk.dim("  Assign connection to user slot (main, rawIdea)"));
        console.log("  " + chalk.cyan("llm tree-assign <slot> <id>") + chalk.dim("  Assign to tree slot"));
        console.log("  " + chalk.cyan("llm clear <slot>") + chalk.dim("        Clear a user slot assignment"));
        console.log("  " + chalk.cyan("llm tree-clear <slot>") + chalk.dim("   Clear a tree slot assignment"));
        console.log();
        console.log(chalk.bold("  Flags:") + chalk.dim("  --name, --url, --model, --key (for add/edit)"));
        console.log(chalk.bold("  User slots:") + chalk.dim("  main, rawIdea"));
        console.log(chalk.bold("  Tree slots:") + chalk.dim("  default, placement, respond, notes, understanding, cleanup, drain, notification"));
        return;
      }

      const cfg = requireAuth();
      const api = getApi(cfg);

      if (action === "open") {
        const landUrl = (cfg.landUrl || "http://localhost:3000").replace(/\/+$/, "");
        const token = cfg.shareToken || "";
        const qs = token ? `?token=${encodeURIComponent(token)}&html` : "?html";
        let url;
        if (cfg.activeRootId) {
          url = `${landUrl}/api/v1/root/${cfg.activeRootId}${qs}`;
        } else {
          url = `${landUrl}/api/v1/user/${cfg.userId}/llm${qs}`;
        }
        console.log(chalk.dim(`Opening: ${url}`));
        const { exec } = require("child_process");
        const cmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
        exec(`${cmd} "${url}"`);
        return;
      }

      if (action === "add") {
        // Non-interactive if all flags provided
        if (opts.name && opts.url && opts.model) {
          try {
            const data = await api.addLlmConnection(cfg.userId, {
              name: opts.name,
              baseUrl: opts.url,
              model: opts.model,
              apiKey: opts.key || "none",
            });
            console.log(chalk.green(`Added: ${opts.name}`));
            console.log(chalk.dim(`ID: ${data.connection?._id || "?"}`));
          } catch (e) {
            console.error(chalk.red(e.message));
          }
          return;
        }

        // Interactive
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
        try {
          console.log(chalk.bold("\nAdd LLM Connection\n"));
          console.log(chalk.dim("Connect any OpenAI-compatible endpoint (Ollama, OpenRouter, Together, etc.)\n"));

          const name = opts.name || await ask(rl, chalk.cyan("  Name: "));
          if (!name.trim()) { rl.close(); return console.log(chalk.yellow("Cancelled.")); }

          const baseUrl = opts.url || await ask(rl, chalk.cyan("  Base URL (e.g. http://localhost:11434/v1): "));
          if (!baseUrl.trim()) { rl.close(); return console.log(chalk.yellow("Cancelled.")); }

          const model = opts.model || await ask(rl, chalk.cyan("  Model (e.g. qwen3:32b): "));
          if (!model.trim()) { rl.close(); return console.log(chalk.yellow("Cancelled.")); }

          const apiKey = opts.key || await ask(rl, chalk.cyan("  API Key (not required for Ollama/local, press enter to skip): "));

          rl.close();

          const data = await api.addLlmConnection(cfg.userId, {
            name: name.trim(),
            baseUrl: baseUrl.trim(),
            model: model.trim(),
            apiKey: apiKey.trim() || "none",
          });

          console.log(chalk.green(`\nAdded: ${name.trim()}`));
          console.log(chalk.dim(`ID: ${data.connection?._id || "?"}`));
          console.log(chalk.dim("Auto-assigned as default if no other connection was set."));
        } catch (e) {
          rl.close();
          console.error(chalk.red(e.message));
        }
        return;
      }

      if (action === "edit") {
        const id = args[0];
        if (!id) return console.log(chalk.yellow("Usage: llm edit <connectionId> --name X --url X --model X --key X"));
        const fields = {};
        if (opts.name) fields.name = opts.name;
        if (opts.url) fields.baseUrl = opts.url;
        if (opts.model) fields.model = opts.model;
        if (opts.key) fields.apiKey = opts.key;
        if (Object.keys(fields).length === 0) {
          return console.log(chalk.yellow("Provide at least one flag: --name, --url, --model, --key"));
        }
        try {
          const data = await api.updateLlmConnection(cfg.userId, id, fields);
          console.log(chalk.green(`Updated: ${data.connection?.name || id}`));
        } catch (e) {
          console.error(chalk.red(e.message));
        }
        return;
      }

      if (action === "remove" || action === "rm") {
        const id = args[0];
        if (!id) return console.log(chalk.yellow("Usage: llm remove <connectionId>. Run 'llms' to see IDs."));
        try {
          await api.deleteLlmConnection(cfg.userId, id);
          console.log(chalk.green("Removed."));
        } catch (e) {
          console.error(chalk.red(e.message));
        }
        return;
      }

      if (action === "assign") {
        const slot = args[0];
        const connectionId = args[1];
        if (!slot || !connectionId) return console.log(chalk.yellow("Usage: llm assign <slot> <connectionId>. Slots: main, rawIdea"));
        try {
          await api.assignLlm(cfg.userId, slot, connectionId);
          console.log(chalk.green(`Assigned to ${slot}.`));
        } catch (e) {
          console.error(chalk.red(e.message));
        }
        return;
      }

      if (action === "clear") {
        const slot = args[0];
        if (!slot) return console.log(chalk.yellow("Usage: llm clear <slot>. Slots: main, rawIdea"));
        try {
          await api.assignLlm(cfg.userId, slot, null);
          console.log(chalk.green(`Cleared ${slot}.`));
        } catch (e) {
          console.error(chalk.red(e.message));
        }
        return;
      }

      if (action === "tree-assign") {
        const slot = args[0];
        const connectionId = args[1];
        if (!slot || !connectionId) return console.log(chalk.yellow("Usage: llm tree-assign <slot> <connectionId>. Slots: placement, respond, notes, cleanup, drain, understanding"));
        if (!cfg.activeRootId) return console.log(chalk.yellow("Not in a tree. Use 'use <tree>' first."));
        try {
          await api.assignTreeLlm(cfg.activeRootId, slot, connectionId);
          console.log(chalk.green(`Tree slot ${slot} assigned.`));
        } catch (e) {
          console.error(chalk.red(e.message));
        }
        return;
      }

      if (action === "tree-clear") {
        const slot = args[0];
        if (!slot) return console.log(chalk.yellow("Usage: llm tree-clear <slot>. Slots: placement, respond, notes, cleanup, drain, understanding"));
        if (!cfg.activeRootId) return console.log(chalk.yellow("Not in a tree. Use 'use <tree>' first."));
        try {
          await api.assignTreeLlm(cfg.activeRootId, slot, null);
          console.log(chalk.green(`Tree slot ${slot} cleared.`));
        } catch (e) {
          console.error(chalk.red(e.message));
        }
        return;
      }

      console.log(chalk.yellow(`Unknown action: ${action}. Run 'llm' for help.`));
    });
};
