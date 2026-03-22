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

        if (data.apiKey) {
          const { me, api } = await saveLogin(cfg, data.apiKey);
          if (data.firstUser) {
            console.log(chalk.green("\n  First user. You are the admin (god tier)."));
          }
          await printLoginSuccess(me, api);
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

        // Create an API key for CLI usage
        const keyData = await jwtPost(token, `/user/${userId}/api-keys`, { name: "treeos-cli" });
        const apiKey = keyData.apiKey;

        const { me, api } = await saveLogin(cfg, apiKey);
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
