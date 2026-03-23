const chalk = require("chalk");
const { createInterface } = require("readline");
const TreeAPI = require("../api");
const { unauthPost, jwtPost, jwtGet } = require("../api");
const { load, save, requireAuth, currentNodeId, currentPath } = require("../config");

/** Read a line from stdin */
function prompt(label) {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    rl.question(label, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

/** Read password with * masking */
function readPassword(label) {
  return new Promise((resolve) => {
    process.stdout.write(label);
    const stdin = process.stdin;
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    let pw = "";
    const onData = (ch) => {
      if (ch === "\r" || ch === "\n") {
        stdin.setRawMode(false);
        stdin.pause();
        stdin.removeListener("data", onData);
        process.stdout.write("\n");
        resolve(pw);
      } else if (ch === "\u0003") {
        stdin.setRawMode(false);
        stdin.pause();
        process.exit(0);
      } else if (ch === "\u007f" || ch === "\b") {
        if (pw.length > 0) {
          pw = pw.slice(0, -1);
          process.stdout.write("\b \b");
        }
      } else {
        pw += ch;
        process.stdout.write("*");
      }
    };
    stdin.on("data", onData);
  });
}

/** Save login state from API key */
async function saveLogin(cfg, apiKey) {
  const api = new TreeAPI(apiKey);
  const me = await api.me();
  cfg.apiKey = apiKey;
  cfg.userId = me.userId;
  cfg.username = me.username;
  cfg.plan = me.profileType || null;
  cfg.planExpiresAt = me.planExpiresAt || null;
  cfg.shareToken = me.shareToken || null;
  cfg.energy = me.energy || null;
  cfg.pathStack = [];
  cfg.activeRootId = null;
  cfg.activeRootName = null;
  save(cfg);
  return { me, api };
}

/**
 * After register/login, create an API key via the extension endpoint.
 * Falls back to JWT-only auth if the api-keys extension isn't loaded.
 */
async function createCliApiKey(cfg, token, userId, username) {
  try {
    const keyData = await jwtPost(token, `/user/${userId}/api-keys`, { name: "treeos-cli" });
    return await saveLogin(cfg, keyData.apiKey);
  } catch (e) {
    // api-keys extension not loaded, or key creation failed. Use JWT directly.
    cfg.apiKey = null;
    cfg.jwtToken = token;
    cfg.userId = userId;
    cfg.username = username || null;
    cfg.pathStack = [];
    cfg.activeRootId = null;
    cfg.activeRootName = null;
    save(cfg);
    return { me: { userId, username: username || null }, api: new TreeAPI(null) };
  }
}

/** Print post-login info */
async function printLoginSuccess(me, api) {
  console.log(chalk.green(`\n  Logged in as ${me.username}`));
  if (me.profileType) console.log(chalk.dim(`  Plan: ${me.profileType}`));
  try {
    const data = await api.getUser(me.userId);
    const roots = data.roots || data.user?.roots || [];
    if (roots.length) {
      console.log(chalk.dim("\n  Your trees:"));
      roots.forEach((r) =>
        console.log(`    ${chalk.cyan(r.name)}  ${chalk.dim(r._id)}`),
      );
      console.log(chalk.dim(`\n  Run: use "<tree name>" to select one`));
    } else {
      console.log(chalk.dim("\n  No trees yet. Run: mkroot <name>"));
    }
  } catch (_) {}
}

/** Open URL in default browser */
function openBrowser(url) {
  const { exec } = require("child_process");
  const cmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
  exec(`${cmd} ${url}`);
}

module.exports = (program) => {
  // ── Register ──────────────────────────────────────────────────────────

  program
    .command("register")
    .description("Create a new account on the connected Land. --browser to open in browser")
    .option("--browser", "Open registration page in browser instead")
    .action(async (opts) => {
      const cfg = load();
      const landUrl = (cfg.landUrl || "https://treeOS.ai").replace(/\/+$/, "");

      if (opts.browser) {
        openBrowser(`${landUrl}/register`);
        console.log(chalk.dim("  Opened registration page. After signing up, run: treeos login"));
        return;
      }

      try {
        const username = await prompt("  Username: ");
        if (!username) return console.log(chalk.yellow("Username is required."));

        const password = await readPassword("  Password: ");
        if (!password) return console.log(chalk.yellow("Password is required."));

        const confirm = await readPassword("  Confirm password: ");
        if (password !== confirm) return console.log(chalk.red("Passwords do not match."));

        const email = await prompt("  Email (optional): ");

        let data;
        try {
          data = await unauthPost("/register", {
            username,
            password,
            email: email || undefined,
          });
        } catch (e) {
          // Server requires email but user skipped it
          if (!email && e.message && e.message.toLowerCase().includes("email is required")) {
            const retryEmail = await prompt("  This land requires email: ");
            if (!retryEmail) return console.log(chalk.yellow("Email is required on this land."));
            data = await unauthPost("/register", {
              username,
              password,
              email: retryEmail,
            });
          } else {
            throw e;
          }
        }

        if (data.token) {
          if (data.firstUser) {
            console.log(chalk.green("\n  First user. You are the admin (god tier)."));
          }
          const { me, api } = await createCliApiKey(cfg, data.token, data.userId, data.username || username);
          save(cfg);
          await printLoginSuccess(me, api);

          // LLM connection (required for AI interaction)
          console.log(chalk.bold("\n  Connect Your LLM\n"));
          console.log(chalk.dim("  Connect your own LLM for chat, placement, and understanding."));
          console.log(chalk.dim("  Any OpenAI-compatible endpoint works (Ollama, OpenRouter, Together, etc.)\n"));

          let llmConnected = false;
          while (!llmConnected) {
            try {
              const llmName = await prompt("  Connection name (e.g. my-ollama): ");
              if (!llmName) {
                const skip = await prompt("  Skip? You'll use tree owners' models when chatting. (y/N): ");
                if (skip.toLowerCase() === "y") {
                  console.log(chalk.dim("  Skipped. Run 'llm add' anytime to connect your own."));
                  break;
                }
                continue;
              }

              const llmUrl = await prompt("  Base URL (e.g. http://localhost:11434/v1): ");
              if (!llmUrl) continue;

              const llmModel = await prompt("  Model (e.g. qwen3:32b): ");
              if (!llmModel) continue;

              const llmKey = await prompt("  API Key (press enter for none): ");

              await api.addLlmConnection(me.userId, {
                name: llmName,
                baseUrl: llmUrl,
                model: llmModel,
                apiKey: llmKey || "none",
              });
              console.log(chalk.green(`\n  Connected: ${llmName}`));
              console.log(chalk.dim("  Set as your default model. Manage with 'llm' command.\n"));
              llmConnected = true;
            } catch (e) {
              console.log(chalk.red(`  Error: ${e.message}`));
              console.log(chalk.dim("  Try again or type empty name to skip.\n"));
            }
          }

          // Create first tree
          console.log(chalk.bold("\n  Plant Your First Tree\n"));
          console.log(chalk.dim("  A tree is a living structure for goals, plans, knowledge, and ideas.\n"));

          const treeName = await prompt("  Tree name: ");
          if (treeName) {
            console.log(chalk.dim("\n  What kind of tree is this?\n"));
            console.log("    1. " + chalk.cyan("goal") + chalk.dim("       . a desired outcome"));
            console.log("    2. " + chalk.cyan("plan") + chalk.dim("       . a strategy or sequence of steps"));
            console.log("    3. " + chalk.cyan("task") + chalk.dim("       . a discrete piece of work"));
            console.log("    4. " + chalk.cyan("knowledge") + chalk.dim("  . stored information or understanding"));
            console.log("    5. " + chalk.cyan("resource") + chalk.dim("   . tools, skills, capabilities"));
            console.log("    6. " + chalk.cyan("identity") + chalk.dim("   . who or what this tree represents"));
            console.log("    7. " + chalk.dim("(none)") + chalk.dim("     . no type, just a tree"));
            console.log();

            const typeInput = await prompt("  Type (1-7 or name): ");
            const typeMap = { "1": "goal", "2": "plan", "3": "task", "4": "knowledge", "5": "resource", "6": "identity" };
            const treeType = typeMap[typeInput] || (typeInput === "7" || !typeInput ? null : typeInput);

            try {
              const rootData = await api.createRoot(me.userId, treeName, treeType);
              const rootId = rootData.rootId || rootData.root?._id;
              console.log(chalk.green(`\n  Planted: ${treeName}`) + (treeType ? chalk.dim(` (${treeType})`) : ""));

              // Auto-select the new tree
              if (rootId) {
                const cfg2 = load();
                cfg2.activeRootId = rootId;
                cfg2.activeRootName = treeName;
                cfg2.pathStack = [{ id: rootId, name: treeName }];
                save(cfg2);
                console.log(chalk.dim(`  You're in. Start chatting or run 'mkdir' to add branches.\n`));
              }
            } catch (e) {
              console.log(chalk.dim(`  Skipped: ${e.message}. Run 'mkroot <name>' to create one later.`));
            }
          } else {
            console.log(chalk.dim("  Skipped. Run 'mkroot <name>' to plant your first tree.\n"));
          }

          const { startShell } = require("../index");
          await startShell();
        } else if (data.pendingVerification) {
          console.log(chalk.green("\n  Account created. Check your email to verify."));
          console.log(chalk.dim("  After verifying, run: treeos login"));
        }
      } catch (e) {
        console.error(chalk.red("Registration failed:"), e.message);
      }
    });

  // ── Login ─────────────────────────────────────────────────────────────

  program
    .command("login")
    .description("Log in with username/password. --key <apiKey>, --browser")
    .option("--key <apiKey>", "Authenticate with an API key")
    .option("--browser", "Open login page in browser instead")
    .action(async (opts) => {
      const cfg = load();
      const landUrl = (cfg.landUrl || "https://treeOS.ai").replace(/\/+$/, "");

      // --browser: open login page
      if (opts.browser) {
        openBrowser(`${landUrl}/login`);
        console.log(chalk.dim("  Opened login page. After logging in, run: treeos login --key <your-key>"));
        return;
      }

      // --key: existing API key flow
      if (opts.key) {
        try {
          const { me, api } = await saveLogin(cfg, opts.key);
          await printLoginSuccess(me, api);
          const { startShell } = require("../index");
          await startShell();
        } catch (e) {
          console.error(chalk.red("Login failed:"), e.message);
        }
        return;
      }

      // Interactive: username + password
      try {
        const username = await prompt("  Username: ");
        if (!username) return console.log(chalk.yellow("Username is required."));

        const password = await readPassword("  Password: ");
        if (!password) return console.log(chalk.yellow("Password is required."));

        // Authenticate
        const loginData = await unauthPost("/login", { username, password });
        const token = loginData.token;
        const userId = loginData.userId;

        // Create an API key for CLI usage (falls back to JWT if api-keys extension not loaded)
        const { me, api } = await createCliApiKey(cfg, token, userId, username);
        await printLoginSuccess(me, api);
        const { startShell } = require("../index");
        await startShell();
      } catch (e) {
        console.error(chalk.red("Login failed:"), e.message);
      }
    });

  // ── Logout ────────────────────────────────────────────────────────────

  program
    .command("logout")
    .description("Clear stored credentials")
    .action(() => {
      const cfg = load();
      cfg.apiKey = null;
      cfg.userId = null;
      cfg.username = null;
      cfg.pathStack = [];
      cfg.activeRootId = null;
      cfg.activeRootName = null;
      save(cfg);
      console.log(chalk.green("Logged out."));
    });

  // ── Whoami ────────────────────────────────────────────────────────────

  program
    .command("whoami")
    .description("Show current login and active tree")
    .action(async () => {
      const cfg = load();
      if (!cfg.apiKey) return console.log(chalk.yellow("Not logged in. Run: treeos login or treeos register"));
      try {
        const api = new TreeAPI(cfg.apiKey);
        const me = await api.me();
        cfg.username = me.username;
        cfg.plan = me.profileType || null;
        cfg.planExpiresAt = me.planExpiresAt || null;
        cfg.shareToken = me.shareToken || null;
        cfg.energy = me.energy || null;
        save(cfg);
      } catch (_) {}
      console.log(`User:  ${chalk.cyan(cfg.username || cfg.userId)}`);
      if (cfg.plan) console.log(`Plan:  ${chalk.cyan(cfg.plan)}${cfg.planExpiresAt ? chalk.dim(" (expires " + new Date(cfg.planExpiresAt).toLocaleDateString() + ")") : ""}`);
      if (cfg.energy) console.log(`Energy: ${chalk.cyan(cfg.energy.available)} available  ${chalk.dim(cfg.energy.additional + " additional . " + cfg.energy.total + " total")}`);
      console.log(`Tree:  ${chalk.cyan(cfg.activeRootName || chalk.dim("(none)"))}  ${chalk.dim(cfg.activeRootId || "")}`);
      console.log(`Path:  ${chalk.cyan(currentPath(cfg))}`);
    });
};
