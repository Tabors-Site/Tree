const chalk = require("chalk");
const TreeAPI = require("../api");
const { load, save, requireAuth, currentNodeId, currentPath } = require("../config");
const { printTable } = require("../display");
const { findChild } = require("../helpers");

module.exports = (program) => {
  // ── Peers ──────────────────────────────────────────────────────────────

  program
    .command("peers")
    .description("List known peer places in the canopy network")
    .action(async () => {
      const cfg = requireAuth();
      const api = new TreeAPI(cfg.apiKey);
      try {
        const data = await api.listPeers();
        const peers = data.peers || [];
        if (!peers.length) return console.log(chalk.dim("  (no peers)"));
        printTable(
          peers.map((p) => ({
            domain: p.domain,
            name: p.name || "",
            status: p.status,
            lastSeen: p.lastSeenAt ? new Date(p.lastSeenAt).toLocaleString() : "",
          })),
          [
            { key: "domain", label: "Domain", width: 30 },
            { key: "name", label: "Name", width: 20 },
            { key: "status", label: "Status", width: 12 },
            { key: "lastSeen", label: "Last Seen", width: 24 },
          ],
        );
      } catch (e) {
        console.error(chalk.red(e.message));
      }
    });

  program
    .command("peer [action] [value...]")
    .description("Manage peers: peer add <url>, peer remove <domain>, peer block/unblock <domain>, peer discover <domain>")
    .action(async (action, parts) => {
      if (!action) return console.log(chalk.yellow("Usage: peer <action> [value]\n  add <url>        Peer with a place\n  remove <domain>  Remove a peer\n  block <domain>   Block a peer\n  unblock <domain> Unblock a peer\n  discover <domain> Look up on the Horizon\n  ping             Heartbeat all peers"));
      const cfg = requireAuth();
      const api = new TreeAPI(cfg.apiKey);
      const value = parts && parts.length ? parts.join(" ") : null;

      try {
        if (action === "add") {
          if (!value) return console.log(chalk.yellow("Usage: peer add <url>"));
          const data = await api.addPeer(value);
          const peer = data.peer || {};
          console.log(chalk.green(`✓ Peered with ${peer.domain || value}`));
        } else if (action === "remove" || action === "rm") {
          if (!value) return console.log(chalk.yellow("Usage: peer remove <domain>"));
          await api.removePeer(value);
          console.log(chalk.green(`✓ Removed peer ${value}`));
        } else if (action === "block") {
          if (!value) return console.log(chalk.yellow("Usage: peer block <domain>"));
          await api.blockPeer(value);
          console.log(chalk.green(`✓ Blocked ${value}`));
        } else if (action === "unblock") {
          if (!value) return console.log(chalk.yellow("Usage: peer unblock <domain>"));
          await api.unblockPeer(value);
          console.log(chalk.green(`✓ Unblocked ${value}`));
        } else if (action === "discover") {
          if (!value) return console.log(chalk.yellow("Usage: peer discover <domain>"));
          const data = await api.discoverPeer(value);
          const peer = data.peer || {};
          console.log(chalk.green(`✓ Discovered and peered with ${peer.domain || value}`));
        } else if (action === "ping") {
          const data = await api.heartbeat();
          const results = data.results || [];
          if (!results.length) return console.log(chalk.dim("  (no peers to ping)"));
          results.forEach((r) => {
            const icon = r.status === "active" ? chalk.green("✓") : chalk.red("✗");
            console.log(`  ${icon} ${r.domain || r.peer?.domain || "?"}  ${chalk.dim(r.status || "")}`);
          });
        } else {
          console.log(chalk.yellow(`Unknown action "${action}". Try: add, remove, block, unblock, discover, ping`));
        }
      } catch (e) {
        console.error(chalk.red(e.message));
      }
    });

  // ── Search / Discovery ─────────────────────────────────────────────────

  program
    .command("search [query...]")
    .description("Search the Horizon for public trees across the network. -l search places instead")
    .option("-l, --places", "Search for places instead of trees")
    .action(async (parts, opts) => {
      const cfg = requireAuth();
      const api = new TreeAPI(cfg.apiKey);
      const q = parts && parts.length ? parts.join(" ") : "";
      try {
        if (opts.places) {
          const data = await api.searchLands(q);
          const places = data.places || [];
          if (!places.length) return console.log(chalk.dim("  (no places found)"));
          printTable(
            places.map((l) => ({
              domain: l.domain || "",
              name: l.name || "",
              trees: l.publicTreeCount != null ? String(l.publicTreeCount) : "",
            })),
            [
              { key: "domain", label: "Domain", width: 30 },
              { key: "name", label: "Name", width: 24 },
              { key: "trees", label: "Public Trees", width: 14 },
            ],
          );
        } else {
          const data = await api.searchTrees(q);
          const trees = data.trees || [];
          if (!trees.length) return console.log(chalk.dim("  (no trees found)"));
          trees.forEach((t, i) => {
            const owner = t.ownerUsername ? chalk.dim(t.ownerUsername) : "";
            const domain = t.placeDomain ? chalk.dim(`@${t.placeDomain}`) : "";
            console.log(`  ${chalk.cyan(i + 1 + ".")} ${chalk.bold(t.name || t.rootId)}  ${owner} ${domain}`);
          });
        }
      } catch (e) {
        console.error(chalk.red(e.message));
      }
    });

  // ── Browse remote place's public trees ──────────────────────────────────

  program
    .command("browse [domain] [query...]")
    .description("Browse public trees on a peer place. browse <domain> [search]")
    .action(async (domain, query) => {
      if (!domain) return console.log(chalk.yellow("Usage: browse <domain> [search query]"));
      const cfg = requireAuth();
      const api = new TreeAPI(cfg.apiKey);
      const q = query && query.length ? query.join(" ") : "";
      try {
        const data = await api.getRemotePublicTrees(domain, q);
        const trees = data.trees || [];
        if (!trees.length) return console.log(chalk.dim(`  (no public trees on ${domain})`));
        console.log(chalk.bold(`Public trees on ${domain}:\n`));
        trees.forEach((t, i) => {
          const owner = t.ownerUsername ? chalk.dim(t.ownerUsername) : "";
          console.log(`  ${chalk.cyan(i + 1 + ".")} ${chalk.bold(t.name || t.rootId)}  ${owner}  ${chalk.dim(t.rootId)}`);
        });
        console.log(chalk.dim(`\n  Navigate: cd @${domain}/<treename>`));
      } catch (e) {
        console.error(chalk.red(e.message));
      }
    });
};
