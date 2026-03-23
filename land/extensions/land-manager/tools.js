import { z } from "zod";
import Node from "../../db/models/node.js";
import User from "../../db/models/user.js";
import { getExtMeta } from "../../core/tree/extensionMetadata.js";
import log from "../../core/log.js";

async function requireGod(userId) {
  const user = await User.findById(userId).select("profileType").lean();
  return user?.profileType === "god";
}

export default function getTools() {
  return [
    {
      name: "land-status",
      description: "Get land status: loaded extensions, system nodes, config, connected peers, user count, tree count.",
      schema: {
        userId: z.string().describe("Injected by server. Ignore."),
      },
      annotations: { readOnlyHint: true },
      async handler({ userId }) {
        try {
          const { getLoadedManifests, getLoadedExtensionNames } = await import("../../extensions/loader.js");
          const { getLandIdentity, getLandUrl } = await import("../../canopy/identity.js");

          const land = getLandIdentity();
          const loaded = getLoadedExtensionNames();
          const manifests = getLoadedManifests();
          const userCount = await User.countDocuments({ isRemote: { $ne: true } });
          const treeCount = await Node.countDocuments({ rootOwner: { $ne: null }, parent: { $ne: "deleted" } });

          let peerCount = 0;
          try {
            const LandPeer = (await import("../../db/models/landPeer.js")).default;
            peerCount = await LandPeer.countDocuments();
          } catch {}

          const status = {
            land: { name: land.name, domain: land.domain, url: getLandUrl() },
            extensions: { count: loaded.length, loaded: manifests.map(m => `${m.name} v${m.version}`).join(", ") },
            stats: { users: userCount, trees: treeCount, peers: peerCount },
          };

          return { content: [{ type: "text", text: JSON.stringify(status, null, 2) }] };
        } catch (err) {
          return { content: [{ type: "text", text: `Error: ${err.message}` }] };
        }
      },
    },

    {
      name: "land-config-read",
      description: "Read land configuration values from the .config system node.",
      schema: {
        key: z.string().optional().describe("Config key to read. Omit for all."),
        userId: z.string().describe("Injected by server. Ignore."),
      },
      annotations: { readOnlyHint: true },
      async handler({ key, userId }) {
        try {
          const configNode = await Node.findOne({ systemRole: "config" }).lean();
          if (!configNode) return { content: [{ type: "text", text: "No .config node found." }] };
          const meta = configNode.metadata instanceof Map ? Object.fromEntries(configNode.metadata) : (configNode.metadata || {});
          if (key) return { content: [{ type: "text", text: `${key} = ${JSON.stringify(meta[key] ?? null)}` }] };
          return { content: [{ type: "text", text: JSON.stringify(meta, null, 2) }] };
        } catch (err) {
          return { content: [{ type: "text", text: `Error: ${err.message}` }] };
        }
      },
    },

    {
      name: "land-config-set",
      description: "Set a land configuration value. God-tier only.",
      schema: {
        key: z.string().describe("Config key"),
        value: z.string().describe("Value to set"),
        userId: z.string().describe("Injected by server. Ignore."),
      },
      annotations: { readOnlyHint: false, destructiveHint: true },
      async handler({ key, value, userId }) {
        if (!await requireGod(userId)) {
          return { content: [{ type: "text", text: "Permission denied. Requires god-tier." }] };
        }
        try {
          const configNode = await Node.findOne({ systemRole: "config" });
          if (!configNode) return { content: [{ type: "text", text: "No .config node found." }] };
          if (!configNode.metadata) configNode.metadata = new Map();
          if (configNode.metadata instanceof Map) { configNode.metadata.set(key, value); }
          else { configNode.metadata[key] = value; }
          configNode.markModified("metadata");
          await configNode.save();
          log.info("LandManager", `Config set: ${key} = ${value} (by ${userId})`);
          return { content: [{ type: "text", text: `Set ${key} = ${value}` }] };
        } catch (err) {
          return { content: [{ type: "text", text: `Error: ${err.message}` }] };
        }
      },
    },

    {
      name: "land-users",
      description: "List users on this land with their profile type and tree count.",
      schema: {
        userId: z.string().describe("Injected by server. Ignore."),
      },
      annotations: { readOnlyHint: true },
      async handler({ userId }) {
        if (!await requireGod(userId)) {
          return { content: [{ type: "text", text: "Permission denied." }] };
        }
        try {
          const users = await User.find({ isRemote: { $ne: true } }).select("username profileType roots").lean();
          const lines = users.map(u => `${u.username} (${u.profileType}) . ${u.roots?.length || 0} trees`);
          return { content: [{ type: "text", text: lines.join("\n") || "No users." }] };
        } catch (err) {
          return { content: [{ type: "text", text: `Error: ${err.message}` }] };
        }
      },
    },

    {
      name: "land-peers",
      description: "List federated peers connected to this land.",
      schema: {
        userId: z.string().describe("Injected by server. Ignore."),
      },
      annotations: { readOnlyHint: true },
      async handler({ userId }) {
        try {
          const LandPeer = (await import("../../db/models/landPeer.js")).default;
          const peers = await LandPeer.find().lean();
          if (!peers.length) return { content: [{ type: "text", text: "No peers." }] };
          const lines = peers.map(p => `${p.domain} . ${p.status || "unknown"} . last seen ${p.lastSeenAt ? new Date(p.lastSeenAt).toLocaleString() : "never"}`);
          return { content: [{ type: "text", text: lines.join("\n") }] };
        } catch (err) {
          return { content: [{ type: "text", text: `Error: ${err.message}` }] };
        }
      },
    },

    {
      name: "land-system-nodes",
      description: "Read the system node tree (.identity, .config, .peers, .extensions).",
      schema: {
        userId: z.string().describe("Injected by server. Ignore."),
      },
      annotations: { readOnlyHint: true },
      async handler({ userId }) {
        try {
          const systemNodes = await Node.find({ isSystem: true }).select("name systemRole children metadata").lean();
          const result = systemNodes.map(n => ({
            name: n.name,
            role: n.systemRole,
            children: n.children?.length || 0,
            metadata: Object.keys(n.metadata instanceof Map ? Object.fromEntries(n.metadata) : (n.metadata || {})),
          }));
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        } catch (err) {
          return { content: [{ type: "text", text: `Error: ${err.message}` }] };
        }
      },
    },
  ];
}
