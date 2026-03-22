const chalk = require("chalk");
const TreeAPI = require("../api");
const { getBaseSite } = require("../api");
const { load, save, requireAuth, currentNodeId, hasExtension } = require("../config");
const { termLink } = require("../helpers");

/** Check if the connected Land has frontend HTML enabled */
async function checkFrontendEnabled(api) {
  try {
    const data = await api.getLandConfigValue("ENABLE_FRONTEND_HTML");
    const val = data.value;
    return val === true || val === "true";
  } catch {
    // Config endpoint may not exist on older lands, assume enabled
    return true;
  }
}

module.exports = (program) => {
  const cfg = load();

  program
    .command("share-token [token]")
    .description("Show or set your share token. share-token <token> to update")
    .action(async (token) => {
      const cfg = requireAuth();
      if (!token) {
        return console.log(cfg.shareToken ? chalk.cyan(cfg.shareToken) : chalk.dim("(none)"));
      }
      const api = new TreeAPI(cfg.apiKey);
      try {
        await api.setShareToken(cfg.userId, token);
        cfg.shareToken = token;
        save(cfg);
        console.log(chalk.green("✓ Share token updated"));
      } catch (e) {
        console.error(chalk.red(e.message));
      }
    });

  program
    .command("share [type] [id]")
    .description("Generate a public share link. share idea <id> | share note <id> | share book")
    .action(async (type, id) => {
      if (!type) {
        const cfg = load();
        if (cfg.activeRootId) return console.log(chalk.yellow("Usage: share note <id> | share book"));
        return console.log(chalk.yellow("Usage: share idea <id> | share note <id>"));
      }
      const cfg = requireAuth();
      const checkApi = new TreeAPI(cfg.apiKey);
      const enabled = await checkFrontendEnabled(checkApi);
      if (!enabled) {
        return console.log(chalk.yellow("This Land does not have frontend HTML enabled. Ask the admin to set ENABLE_FRONTEND_HTML=true"));
      }

      if (type === "idea") {
        if (!id) return console.log(chalk.yellow("Usage: share idea <rawIdeaId>"));
        const url = `${getBaseSite()}/api/v1/user/${cfg.userId}/raw-ideas/${id}?html`;
        return console.log(termLink(url, url));
      }

      if (type === "note") {
        if (!id) return console.log(chalk.yellow("Usage: share note <noteId>"));
        if (!cfg.activeRootId) return console.log(chalk.yellow("Enter a tree first."));
        const nodeId = currentNodeId(cfg);
        const url = `${getBaseSite()}/api/v1/node/${nodeId}/latest/notes/${id}?html`;
        return console.log(termLink(url, url));
      }

      if (type === "book") {
        if (!cfg.activeRootId) return console.log(chalk.yellow("Enter a tree first."));
        const nodeId = currentNodeId(cfg);
        const settings = { toc: true };
        const api = new TreeAPI(cfg.apiKey);
        try {
          const data = await api.generateBookShare(nodeId, settings);
          const path = data.redirect || data.shareUrl;
          if (!path) return console.log(chalk.red("No share link returned"));
          const url = `${getBaseSite()}${path.startsWith("/") ? path : "/" + path}`;
          console.log(termLink(url, url));
        } catch (e) {
          console.error(chalk.red(e.message));
        }
        return;
      }

      const cfg2 = load();
      if (cfg2.activeRootId) {
        console.log(chalk.yellow(`Unknown type "${type}". Use: share note <id> | share book`));
      } else {
        console.log(chalk.yellow(`Unknown type "${type}". Use: share idea <id> | share note <id> | share book`));
      }
    });

  program
    .command("link [type] [id]")
    .description("Open a clickable link to your current location in the Tree web app")
    .action(async (type, id) => {
      const cfg = load();
      if (cfg.apiKey) {
        const api = new TreeAPI(cfg.apiKey);
        const enabled = await checkFrontendEnabled(api);
        if (!enabled) {
          return console.log(chalk.yellow("This Land does not have frontend HTML enabled. Ask the admin to set ENABLE_FRONTEND_HTML=true"));
        }
      }
      const qs = cfg.shareToken ? `?token=${cfg.shareToken}&html` : "?html";

      if (!cfg.userId) {
        const url = `${getBaseSite()}/app`;
        return console.log(termLink(url, url));
      }

      let url;

      if (!type) {
        if (!cfg.activeRootId) {
          url = `${getBaseSite()}/api/v1/user/${cfg.userId}${qs}`;
        } else {
          const nodeId = currentNodeId(cfg);
          url = `${getBaseSite()}/api/v1/node/${nodeId}${qs}`;
        }
      } else if (type === "root") {
        if (!cfg.activeRootId) return console.log(chalk.yellow("Enter a tree first."));
        url = `${getBaseSite()}/api/v1/root/${cfg.activeRootId}${qs}`;
      } else if (type === "book") {
        const nodeId = cfg.activeRootId ? currentNodeId(cfg) : null;
        if (!nodeId) {
          return console.log(chalk.yellow("Enter a tree first to link the book."));
        }
        url = `${getBaseSite()}/api/v1/root/${cfg.activeRootId}/book${qs}`;
      } else if (type === "ideas") {
        url = `${getBaseSite()}/api/v1/user/${cfg.userId}/raw-ideas${qs}`;
      } else if (type === "idea") {
        if (!id) return console.log(chalk.yellow("Usage: link idea <rawIdeaId>"));
        url = `${getBaseSite()}/api/v1/user/${cfg.userId}/raw-ideas/${id}${qs}`;
      } else if (type === "note") {
        if (!id) return console.log(chalk.yellow("Usage: link note <noteId>"));
        const nodeId = currentNodeId(cfg);
        url = `${getBaseSite()}/api/v1/node/${nodeId}/latest/notes/${id}/editor${qs}`;
      } else if (type === "gateway") {
        if (!cfg.activeRootId) return console.log(chalk.yellow("Enter a tree first."));
        url = `${getBaseSite()}/api/v1/root/${cfg.activeRootId}/gateway${qs}`;
      } else {
        if (cfg.activeRootId) {
          return console.log(chalk.yellow(`Unknown link type "${type}". Try: link, link root, link book, link gateway, link note <id>`));
        }
        return console.log(chalk.yellow(`Unknown link type "${type}". Try: link, link ideas, link idea <id>, link note <id>`));
      }

      console.log(termLink(url, url));
    });

  // ── Visibility (extension: visibility) ──
  if (hasExtension(cfg, "visibility")) {
  program
    .command("visibility [level]")
    .description("Show or set tree visibility. visibility public | visibility private")
    .action(async (level) => {
      const cfg = requireAuth();
      if (!cfg.activeRootId) {
        return console.log(chalk.yellow("Enter a tree first."));
      }
      const api = new TreeAPI(cfg.apiKey);

      if (!level) {
        // Show current visibility
        try {
          const data = await api.getRoot(cfg.activeRootId);
          const root = data.root || data;
          const vis = root.visibility || "private";
          const label = vis === "public"
            ? chalk.green("public") + chalk.dim(" (anyone can view and query)")
            : chalk.dim("private") + chalk.dim(" (invite only)");
          console.log(`  Visibility: ${label}`);
        } catch (e) {
          console.error(chalk.red(e.message));
        }
        return;
      }

      const valid = ["public", "private"];
      if (!valid.includes(level)) {
        return console.log(chalk.yellow(`Must be one of: ${valid.join(", ")}`));
      }

      try {
        await api.setVisibility(cfg.activeRootId, level);
        if (level === "public") {
          console.log(chalk.green("✓ Tree is now public. Anyone can view and query it."));
        } else {
          console.log(chalk.green("✓ Tree is now private. Only invited users can access it."));
        }
      } catch (e) {
        console.error(chalk.red(e.message));
      }
    });
  } // end visibility extension
};
