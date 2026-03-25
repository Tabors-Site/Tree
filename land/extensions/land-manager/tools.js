import { z } from "zod";
import Node from "../../seed/models/node.js";
import User from "../../seed/models/user.js";
import { getExtMeta } from "../../seed/tree/extensionMetadata.js";
import log from "../../seed/log.js";

async function requireAdmin(userId) {
  const user = await User.findById(userId).select("isAdmin").lean();
  return user?.isAdmin === true;
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
            const LandPeer = (await import("../../canopy/models/landPeer.js")).default;
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
        if (!await requireAdmin(userId)) {
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
        if (!await requireAdmin(userId)) {
          return { content: [{ type: "text", text: "Permission denied." }] };
        }
        try {
          const users = await User.find({ isRemote: { $ne: true } }).select("username isAdmin metadata").lean();
          const { getUserMeta } = await import("../../seed/tree/userMetadata.js");
          const lines = users.map(u => {
            const nav = getUserMeta(u, "nav");
            const treeCount = Array.isArray(nav.roots) ? nav.roots.length : 0;
            return `${u.username} (${u.isAdmin ? "admin" : "user"}) . ${treeCount} trees`;
          });
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
          const LandPeer = (await import("../../canopy/models/landPeer.js")).default;
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
          const systemNodes = await Node.find({ systemRole: { $ne: null } }).select("name systemRole children metadata").lean();
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
        if (!await requireAdmin(userId)) {
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
        if (!await requireAdmin(userId)) {
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
        if (!await requireAdmin(userId)) {
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
          const { getLandConfigValue } = await import("../../seed/landConfig.js");
          const horizonUrl = getLandConfigValue("HORIZON_URL") || "https://horizon.treeos.ai";
          const url = query ? `${horizonUrl}/extensions?q=${encodeURIComponent(query)}` : `${horizonUrl}/extensions`;
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
    // ── Extension Scoping Tools ──

    {
      name: "ext-scope-read",
      description: "Show which extensions are blocked or restricted at a node. Returns active, blocked, restricted, and inheritance chain.",
      schema: {
        nodeId: z.string().describe("Node ID to check extension scope at"),
        userId: z.string().describe("Injected by server. Ignore."),
      },
      annotations: { readOnlyHint: true },
      async handler({ nodeId, userId }) {
        try {
          const { getBlockedExtensionsAtNode } = await import("../../seed/tree/extensionScope.js");
          const { getLoadedExtensionNames } = await import("../../extensions/loader.js");
          const { blocked, restricted } = await getBlockedExtensionsAtNode(nodeId);
          const installed = getLoadedExtensionNames();
          const active = installed.filter(e => !blocked.has(e));
          const restrictedObj = Object.fromEntries(restricted);
          return { content: [{ type: "text", text: JSON.stringify({ nodeId, active, blocked: [...blocked], restricted: restrictedObj, installed }, null, 2) }] };
        } catch (err) {
          return { content: [{ type: "text", text: `Error: ${err.message}` }] };
        }
      },
    },

    {
      name: "ext-scope-set",
      description: "Block or restrict extensions at a node. Inherits to all children. Use to control what extensions can do on specific branches.",
      schema: {
        nodeId: z.string().describe("Node ID to set extension scope on"),
        blocked: z.array(z.string()).optional().describe("Extensions to fully block (no tools, hooks, modes, metadata)"),
        restricted: z.record(z.string(), z.string()).optional().describe("Extensions to restrict. e.g. { \"food\": \"read\" } for read-only tools"),
        userId: z.string().describe("Injected by server. Ignore."),
      },
      annotations: { readOnlyHint: false, destructiveHint: false },
      async handler({ nodeId, blocked, restricted, userId }) {
        try {
          const node = await Node.findById(nodeId);
          if (!node) return { content: [{ type: "text", text: "Node not found" }] };

          const { setExtMeta } = await import("../../seed/tree/extensionMetadata.js");
          const { clearScopeCache } = await import("../../seed/tree/extensionScope.js");

          const config = {};
          if (blocked?.length) config.blocked = blocked;
          if (restricted && Object.keys(restricted).length) config.restricted = restricted;

          if (Object.keys(config).length === 0) {
            await setExtMeta(node, "extensions", null);
          } else {
            await setExtMeta(node, "extensions", config);
          }
          await node.save();
          clearScopeCache();

          return { content: [{ type: "text", text: `Extension scope updated on "${node.name}". ${config.blocked?.length ? `Blocked: ${config.blocked.join(", ")}. ` : ""}${config.restricted ? `Restricted: ${JSON.stringify(config.restricted)}. ` : ""}Inherits to all children.` }] };
        } catch (err) {
          return { content: [{ type: "text", text: `Error: ${err.message}` }] };
        }
      },
    },
  ];
}
