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
async function saveLogin(cfg, apiKey, jwtToken = null) {
  const api = new TreeAPI(apiKey);
  const me = await api.me();
  cfg.apiKey = apiKey;
  // CRITICAL: refresh jwtToken too if provided. Without this, the CLI
  // keeps a stale jwt from an earlier login, and anything that auths
  // via jwt (the websocket session in particular — socket.io cookie
  // handshake) ends up posting as the previous user. Left this out
  // once and spent hours debugging "user:tabor222" showing up in
  // server logs after logging in as tabor.
  if (jwtToken) cfg.jwtToken = jwtToken;
  cfg.userId = me.userId;
  cfg.username = me.username;
  cfg.plan = me.plan || null;
  cfg.planExpiresAt = me.planExpiresAt || null;
  cfg.shareToken = me.shareToken || null;
  cfg.energy = me.energy || null;
  cfg.pathStack = [];
  cfg.activeRootId = null;
  cfg.activeRootName = null;
  cfg.atHome = true;
  save(cfg);
  return { me, api };
}

/**
 * After register/login, create an API key via the extension endpoint.
 * Falls back to JWT-only auth if the api-keys extension isn't loaded.
 */
async function createCliApiKey(cfg, token, userId, username) {
  try {
    const keyData = await jwtPost(token, `/user/${userId}/api-keys`, { name: "treeos-cli", revokeOld: true });
    // Pass the fresh jwt alongside the apiKey so saveLogin refreshes
    // BOTH credentials in cfg. The socket session uses jwt; HTTP uses
    // apiKey. Missing one leaves a stale identity for one path.
    return await saveLogin(cfg, keyData.apiKey, token);
  } catch (e) {
    // api-keys extension not loaded, or key creation failed. Use JWT directly.
    cfg.apiKey = null;
    cfg.jwtToken = token;
    cfg.userId = userId;
    cfg.username = username || null;
    cfg.pathStack = [];
    cfg.activeRootId = null;
    cfg.activeRootName = null;
    cfg.atHome = true;
    save(cfg);
    return { me: { userId, username: username || null }, api: new TreeAPI(null) };
  }
}

/** Print post-login info */
async function printLoginSuccess(me, api) {
  console.log(chalk.green(`\n  Logged in as ${me.username}`));
  if (me.plan) console.log(chalk.dim(`  Plan: ${me.plan}`));
  try {
    const data = await api.getUser(me.userId);
    const roots = data.roots || data.user?.roots || [];
    if (roots.length) {
      console.log(chalk.dim("\n  Your trees:"));
      roots.forEach((r) =>
        console.log(`    ${chalk.cyan(r.name)}  ${chalk.dim(r._id)}`),
      );
      console.log(chalk.dim(`\n  Run: cd "<tree name>" to enter a tree`));
    } else {
      console.log(chalk.dim("\n  No trees yet. Get started:"));
      console.log(chalk.dim("    llm add             Add an LLM connection (required for AI)"));
      console.log(chalk.dim("    chat \"hello\"         Start talking. The tree grows from conversation."));
      console.log(chalk.dim("    life add food        Or add a domain directly (operator shortcut)"));
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
    .description("Create a new account. --browser, --username, --password, --email")
    .option("--browser", "Open registration page in browser instead")
    .option("--username <username>", "Username (non-interactive)")
    .option("--password <password>", "Password (non-interactive)")
    .option("--email <email>", "Email (non-interactive, optional)")
    .action(async (opts) => {
      const cfg = load();
      if (cfg.apiKey && cfg.username) {
        return console.log(chalk.yellow(`Already logged in as ${cfg.username}. Run: logout first.`));
      }
      const landUrl = (cfg.landUrl || "https://treeOS.ai").replace(/\/+$/, "");
      const nonInteractive = !!(opts.username && opts.password);

      if (opts.browser) {
        openBrowser(`${landUrl}/register`);
        console.log(chalk.dim("  Opened registration page. After signing up, run: treeos login"));
        return;
      }

      try {
        const username = opts.username || await prompt("  Username: ");
        if (!username) return console.log(chalk.yellow("Username is required."));

        const password = opts.password || await readPassword("  Password: ");
        if (!password) return console.log(chalk.yellow("Password is required."));

        if (!nonInteractive) {
          const confirm = await readPassword("  Confirm password: ");
          if (password !== confirm) return console.log(chalk.red("Passwords do not match."));
        }

        const email = opts.email || (nonInteractive ? undefined : await prompt("  Email (optional): "));

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

          if (nonInteractive) {
            return; // Non-interactive: skip LLM setup and tree creation
          }

          // LLM connection (required for AI interaction)
          console.log(chalk.bold("\n  Connect Your LLM\n"));
          console.log(chalk.dim("  Connect your own LLM for chat, placement, and understanding."));
          console.log(chalk.dim("  Any OpenAI-compatible endpoint works (Ollama, OpenRouter, Together, etc.)"));
          console.log(chalk.dim("  Free LLM setup guide: ") + chalk.cyan("https://www.youtube.com/watch?v=_cXGZXdiVgw") + "\n");

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

          // No tree wizard. Sprout handles it from conversation.
          console.log(chalk.bold("\n  You're ready.\n"));
          console.log(chalk.dim("  Just start talking. Say what's on your mind."));
          console.log(chalk.dim("  The tree will grow around what you care about.\n"));

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
    .description("Log in with username/password. --key <apiKey>, --browser, --username, --password")
    .option("--key <apiKey>", "Authenticate with an API key")
    .option("--browser", "Open login page in browser instead")
    .option("--username <username>", "Username (non-interactive)")
    .option("--password <password>", "Password (non-interactive, wrap in single quotes if it has special chars)")
    .action(async (opts) => {
      const cfg = load();
      if (cfg.apiKey && cfg.username && !opts.key) {
        return console.log(chalk.yellow(`Already logged in as ${cfg.username}. Run: logout first.`));
      }
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

      // Non-interactive or interactive: username + password
      try {
        const username = opts.username || await prompt("  Username: ");
        if (!username) return console.log(chalk.yellow("Username is required."));

        const password = opts.password || await readPassword("  Password: ");
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
      cfg.jwtToken = null; // MUST clear both auth methods or the next login inherits stale jwt
      cfg.userId = null;
      cfg.username = null;
      cfg.pathStack = [];
      cfg.activeRootId = null;
      cfg.activeRootName = null;
      save(cfg);
      console.log(chalk.green("Logged out."));
      process.exit(0);
    });

  // ── Whoami ────────────────────────────────────────────────────────────

  program
    .command("whoami")
    .description("Show current login and active tree")
    .action(async () => {
      const cfg = load();
      if (!cfg.apiKey && !cfg.jwtToken) return console.log(chalk.yellow("Not logged in. Run: treeos login or treeos register"));
      try {
        const api = new TreeAPI(cfg.apiKey, cfg.jwtToken);
        const me = await api.me();
        cfg.username = me.username;
        cfg.plan = me.plan || null;
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

  program
    .command("passwd")
    .description("Change your password")
    .action(async () => {
      const cfg = requireAuth();
      try {
        const oldPassword = await readPassword("Current password: ");
        if (!oldPassword) return console.log(chalk.yellow("Cancelled."));

        const newPassword = await readPassword("New password (min 8 chars): ");
        if (!newPassword || newPassword.length < 8) {
          return console.log(chalk.yellow("Password must be at least 8 characters."));
        }

        const confirmPassword = await readPassword("Confirm new password: ");
        if (newPassword !== confirmPassword) {
          return console.log(chalk.red("Passwords do not match."));
        }

        const api = new TreeAPI(cfg.apiKey, cfg.jwtToken);
        const data = await api.post("/user/change-password", { oldPassword, newPassword });

        if (data.token) {
          cfg.jwtToken = data.token;
          save(cfg);
        }

        console.log(chalk.green("Password changed."));
      } catch (err) {
        console.error(chalk.red(err.message));
      }
    });
};
