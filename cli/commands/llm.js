const chalk = require("chalk");
const readline = require("readline");
const { load, requireAuth, hasExtension } = require("../config");
const { getApi } = require("../helpers");

function ask(rl, question) {
  return new Promise((resolve) => rl.question(question, resolve));
}

module.exports = (program) => {
  const cfg = load();
  if (!hasExtension(cfg, "user-llm")) return;

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
    .description("Manage LLM connections: add, remove <id>, assign <slot> <id>, tree-assign <slot> <id>")
    .action(async (action, args) => {
      if (!action) {
        console.log(chalk.bold("LLM Management\n"));
        console.log("  " + chalk.cyan("llms") + chalk.dim("                    List your connections"));
        console.log("  " + chalk.cyan("llm add") + chalk.dim("                 Add a new LLM connection (interactive)"));
        console.log("  " + chalk.cyan("llm remove <id>") + chalk.dim("         Remove a connection"));
        console.log("  " + chalk.cyan("llm assign <slot> <id>") + chalk.dim("  Assign connection to user slot (main, rawIdea)"));
        console.log("  " + chalk.cyan("llm tree-assign <slot> <id>") + chalk.dim("  Assign to tree slot"));
        console.log("  " + chalk.cyan("llm clear <slot>") + chalk.dim("        Clear a user slot assignment"));
        console.log("  " + chalk.cyan("llm tree-clear <slot>") + chalk.dim("   Clear a tree slot assignment"));
        console.log();
        console.log(chalk.bold("  User slots:") + chalk.dim("  main, rawIdea"));
        console.log(chalk.bold("  Tree slots:") + chalk.dim("  default, placement, respond, notes, understanding, cleanup, drain, notification"));
        return;
      }

      const cfg = requireAuth();
      const api = getApi(cfg);

      if (action === "add") {
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
        try {
          console.log(chalk.bold("\nAdd LLM Connection\n"));
          console.log(chalk.dim("Connect any OpenAI-compatible endpoint (Ollama, OpenRouter, Together, etc.)\n"));

          const name = await ask(rl, chalk.cyan("  Name: "));
          if (!name.trim()) { rl.close(); return console.log(chalk.yellow("Cancelled.")); }

          const baseUrl = await ask(rl, chalk.cyan("  Base URL (e.g. http://localhost:11434/v1): "));
          if (!baseUrl.trim()) { rl.close(); return console.log(chalk.yellow("Cancelled.")); }

          const model = await ask(rl, chalk.cyan("  Model (e.g. qwen3:32b): "));
          if (!model.trim()) { rl.close(); return console.log(chalk.yellow("Cancelled.")); }

          const apiKey = await ask(rl, chalk.cyan("  API Key (press enter for none): "));

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
