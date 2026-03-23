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
    // ── Extension Management ──

    {
      name: "land-ext-list",
      description: "List all loaded extensions with version, status, and what they provide.",
      schema: {
        userId: z.string().describe("Injected by server. Ignore."),
      },
      annotations: { readOnlyHint: true },
      async handler({ userId }) {
        try {
          const { getLoadedManifests, getDisabledExtensions } = await import("../../extensions/loader.js");
          const manifests = getLoadedManifests();
          const disabled = getDisabledExtensions?.() || [];
          const lines = manifests.map(m => {
            const parts = [];
            if (m.provides?.routes) parts.push("routes");
            if (m.provides?.tools) parts.push("tools");
            if (m.provides?.jobs) parts.push("jobs");
            if (m.provides?.modes) parts.push("modes");
            return `${m.name} v${m.version}${parts.length ? ` [${parts.join(", ")}]` : ""} . ${m.description || ""}`;
          });
          if (disabled.length) lines.push(`\nDisabled: ${disabled.join(", ")}`);
          return { content: [{ type: "text", text: lines.join("\n") || "No extensions loaded." }] };
        } catch (err) {
          return { content: [{ type: "text", text: `Error: ${err.message}` }] };
        }
      },
    },

    {
      name: "land-ext-install",
      description: "Install an extension from the registry. Downloads files to extensions/ directory. God-tier only. Requires restart.",
      schema: {
        name: z.string().describe("Extension name to install"),
        userId: z.string().describe("Injected by server. Ignore."),
      },
      annotations: { readOnlyHint: false, destructiveHint: true },
      async handler({ name: extName, userId }) {
        if (!await requireGod(userId)) {
          return { content: [{ type: "text", text: "Permission denied. Requires god-tier." }] };
        }
        try {
          const { installExtension } = await import("../../extensions/loader.js");
          const result = await installExtension(extName);
          return { content: [{ type: "text", text: `Installed ${extName} v${result.version || "?"}. Restart the land to load it.` }] };
        } catch (err) {
          return { content: [{ type: "text", text: `Install failed: ${err.message}` }] };
        }
      },
    },

    {
      name: "land-ext-disable",
      description: "Disable an extension. It won't load on next restart. Data stays. God-tier only.",
      schema: {
        name: z.string().describe("Extension name to disable"),
        userId: z.string().describe("Injected by server. Ignore."),
      },
      annotations: { readOnlyHint: false, destructiveHint: false },
      async handler({ name: extName, userId }) {
        if (!await requireGod(userId)) {
          return { content: [{ type: "text", text: "Permission denied. Requires god-tier." }] };
        }
        try {
          const { disableExtension } = await import("../../extensions/loader.js");
          disableExtension(extName);
          return { content: [{ type: "text", text: `Disabled ${extName}. Restart to take effect.` }] };
        } catch (err) {
          return { content: [{ type: "text", text: `Error: ${err.message}` }] };
        }
      },
    },

    {
      name: "land-ext-enable",
      description: "Re-enable a disabled extension. God-tier only. Requires restart.",
      schema: {
        name: z.string().describe("Extension name to enable"),
        userId: z.string().describe("Injected by server. Ignore."),
      },
      annotations: { readOnlyHint: false, destructiveHint: false },
      async handler({ name: extName, userId }) {
        if (!await requireGod(userId)) {
          return { content: [{ type: "text", text: "Permission denied. Requires god-tier." }] };
        }
        try {
          const { enableExtension } = await import("../../extensions/loader.js");
          enableExtension(extName);
          return { content: [{ type: "text", text: `Enabled ${extName}. Restart to take effect.` }] };
        } catch (err) {
          return { content: [{ type: "text", text: `Error: ${err.message}` }] };
        }
      },
    },

    {
      name: "land-ext-search",
      description: "Search the extension registry for available extensions to install.",
      schema: {
        query: z.string().optional().describe("Search query. Omit for all."),
        userId: z.string().describe("Injected by server. Ignore."),
      },
      annotations: { readOnlyHint: true },
      async handler({ query, userId }) {
        try {
          const { getLandConfigValue } = await import("../../core/landConfig.js");
          const dirUrl = getLandConfigValue("directoryUrl") || "https://dir.treeos.ai";
          const url = query ? `${dirUrl}/extensions?q=${encodeURIComponent(query)}` : `${dirUrl}/extensions`;
          const res = await fetch(url);
          const data = await res.json();
          const exts = data.extensions || data || [];
          if (!exts.length) return { content: [{ type: "text", text: "No extensions found." }] };
          const lines = exts.map(e => `${e.name} v${e.version} . ${e.description || ""}`);
          return { content: [{ type: "text", text: lines.join("\n") }] };
        } catch (err) {
          return { content: [{ type: "text", text: `Registry error: ${err.message}` }] };
        }
      },
    },
  ];
}
