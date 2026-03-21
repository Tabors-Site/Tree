const chalk = require("chalk");
const TreeAPI = require("../api");
const { requireAuth } = require("../config");
const { getApi } = require("../helpers");

module.exports = (program) => {
  program
    .command("team")
    .description("Show the owner and contributors for the current tree")
    .action(async () => {
      const cfg = requireAuth();
      if (!cfg.activeRootId)
        return console.log(chalk.yellow("No tree selected. Run: use <name>, roots, or mkroot <name>"));
      const api = getApi(cfg);
      try {
        const data = await api.getRoot(cfg.activeRootId);
        const root = data.root || data;
        const owner = root.rootOwner;
        const contribs = root.contributors || [];
        const remoteDomain = cfg.remoteDomain;
        const formatUser = (u) => {
          const name = u?.username || u?._id || u || "unknown";
          const uid = u?._id || u;
          // When viewing a remote tree, flip perspective:
          // - You (matching userId) show as "you"
          // - Users with isRemote+homeLand show @homeLand (visitors from elsewhere)
          // - Local users on the remote land show @remoteDomain
          if (remoteDomain) {
            if (uid && String(uid) === String(cfg.userId)) return name + chalk.dim(" (you)");
            if (u?.isRemote && u?.homeLand) return name + chalk.dim(` @${u.homeLand}`);
            return name + chalk.dim(` @${remoteDomain}`);
          }
          // Local view: only annotate remote users
          if (u?.isRemote && u?.homeLand) return name + chalk.dim(` @${u.homeLand}`);
          return name;
        };
        console.log(chalk.bold("Owner:"));
        console.log(`  ${formatUser(owner)}`);
        if (contribs.length) {
          console.log(chalk.bold("Contributors:"));
          for (const c of contribs) {
            console.log(`  ${formatUser(c)}`);
          }
        } else {
          console.log(chalk.dim("  No other contributors"));
        }
      } catch (e) {
        console.error(chalk.red(e.message));
      }
    });

  program
    .command("invite [userOrAction...]")
    .description("Invite a user to current tree. Use user@domain for remote lands")
    .action(async (parts) => {
      if (!parts || !parts.length) return console.log(chalk.yellow("Usage: invite <username> | invite <user@domain> | invite accept <id> | invite deny <id>"));
      const cfg = requireAuth();
      const first = parts[0];

      // invite accept <id|number> / invite deny <id|number>
      if ((first === "accept" || first === "deny") && parts[1]) {
        const api = new TreeAPI(cfg.apiKey);
        try {
          let inviteId = parts[1];
          // If user passed a number, resolve it from the invite list
          if (/^\d+$/.test(inviteId)) {
            const data = await api.listInvites(cfg.userId);
            const invites = data.invites || data || [];
            const idx = parseInt(inviteId, 10) - 1;
            if (idx < 0 || idx >= invites.length) return console.log(chalk.yellow("Invalid invite number."));
            inviteId = invites[idx]._id;
          }
          const isAccept = first === "accept";
          await api.respondInvite(cfg.userId, inviteId, isAccept);
          console.log(chalk.green(`✓ Invite ${isAccept ? "accepted" : "declined"}`));
        } catch (e) { console.error(chalk.red(e.message)); }
        return;
      }

      // invite <username or userId or user@domain> — send invite from current tree
      if (!cfg.activeRootId)
        return console.log(chalk.yellow("Enter a tree first to invite someone, or use: invites"));
      const api = getApi(cfg);
      const userReceiving = parts.join(" ");
      try {
        await api.invite(cfg.activeRootId, userReceiving);
        const isRemote = userReceiving.includes("@") && userReceiving.split("@")[1].includes(".");
        const label = isRemote ? `${userReceiving} (remote)` : userReceiving;
        console.log(chalk.green(`✓ Invited "${label}" to ${cfg.activeRootName || "this tree"}`));
      } catch (e) { console.error(chalk.red(e.message)); }
    });

  program
    .command("invites")
    .description("List your pending invites")
    .action(async () => {
      const cfg = requireAuth();
      const api = new TreeAPI(cfg.apiKey);
      try {
        const data = await api.listInvites(cfg.userId);
        const invites = data.invites || data || [];
        if (!invites.length) return console.log(chalk.dim("  (no pending invites)"));
        invites.forEach((inv, i) => {
          const from = inv.userInviting?.username || inv.remoteInvitingUsername || inv.userInviting || "";
          const tree = inv.rootId?.name || inv.remoteRootName || inv.rootId || "";
          const land = inv.remoteLandDomain ? ` ${chalk.dim(`@${inv.remoteLandDomain}`)}` : "";
          console.log(
            `  ${chalk.cyan(i + 1 + ".")} ${chalk.bold(tree)}${land}  ${chalk.dim("from")} ${from}`,
          );
        });
        console.log(chalk.dim("\n  Accept: invite accept <id>  ·  Decline: invite deny <id>"));
      } catch (e) { console.error(chalk.red(e.message)); }
    });

  program
    .command("kick [userOrId...]")
    .description("Remove a contributor from the current tree")
    .action(async (parts) => {
      if (!parts || !parts.length) return console.log(chalk.yellow("Usage: kick <username or userId>"));
      const cfg = requireAuth();
      if (!cfg.activeRootId)
        return console.log(chalk.yellow("No tree selected. Run: use <name>, roots, or mkroot <name>"));
      const api = getApi(cfg);
      const userReceiving = parts.join(" ");
      try {
        await api.removeUser(cfg.activeRootId, userReceiving);
        console.log(chalk.green(`✓ Removed "${userReceiving}" from ${cfg.activeRootName || "this tree"}`));
      } catch (e) { console.error(chalk.red(e.message)); }
    });

  program
    .command("owner [userOrId...]")
    .description("Transfer tree ownership to another contributor")
    .action(async (parts) => {
      if (!parts || !parts.length) return console.log(chalk.yellow("Usage: owner <username or userId>"));
      const cfg = requireAuth();
      if (!cfg.activeRootId)
        return console.log(chalk.yellow("No tree selected. Run: use <name>, roots, or mkroot <name>"));
      const api = getApi(cfg);
      const userReceiving = parts.join(" ");
      try {
        await api.transferOwner(cfg.activeRootId, userReceiving);
        console.log(chalk.green(`✓ Ownership transferred to "${userReceiving}"`));
      } catch (e) { console.error(chalk.red(e.message)); }
    });
};
