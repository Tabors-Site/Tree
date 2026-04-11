import { z } from "zod";
import Node from "../../seed/models/node.js";
import User from "../../seed/models/user.js";
import log from "../../seed/log.js";
import { SYSTEM_ROLE, DELETED } from "../../seed/protocol.js";
import { setLandConfigValue } from "../../seed/landConfig.js";

let _metadata = null;
export function setMetadata(metadata) { _metadata = metadata; }

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
          const treeCount = await Node.countDocuments({ rootOwner: { $ne: null }, parent: { $ne: DELETED } });

          let peerCount = 0;
          try {
            const LandPeer = (await import("../../canopy/models/landPeer.js")).default;
            peerCount = await LandPeer.countDocuments();
          } catch (err) { log.debug("LandManager", "Canopy peer count unavailable:", err.message); }

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
      description:
        "Read land configuration. Shows every config key, its effective value, the default, " +
        "and whether it has been customized. Omit key for the full system overview.",
      schema: {
        key: z.string().optional().describe("Config key to read. Omit for full system config."),
        userId: z.string().describe("Injected by server. Ignore."),
      },
      annotations: { readOnlyHint: true },
      async handler({ key, userId }) {
        try {
          const { getConfigWithDefaults, getLandConfigValue, CONFIG_DEFAULTS } = await import("../../seed/landConfig.js");

          if (key) {
            const value = getLandConfigValue(key);
            const def = CONFIG_DEFAULTS[key];
            const isCustom = value !== null && value !== undefined;
            return { content: [{ type: "text", text: `${key} = ${JSON.stringify(value ?? def ?? null)}${isCustom ? " (custom)" : " (default)"}` }] };
          }

          // Full config overview: group by category for readability
          const full = getConfigWithDefaults();
          const lines = [];
          for (const [k, info] of Object.entries(full)) {
            const val = JSON.stringify(info.value);
            const tag = info.custom ? "*" : " ";
            lines.push(`${tag} ${k} = ${val}`);
          }
          const header = "Full system configuration (* = custom, space = default):\n";
          return { content: [{ type: "text", text: header + lines.join("\n") }] };
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
          await setLandConfigValue(key, value);
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
      description: "List ALL loaded extensions with version and what they provide. Always show the complete list. Never truncate.",
      schema: {
        userId: z.string().describe("Injected by server. Ignore."),
      },
      annotations: { readOnlyHint: true },
      async handler({ userId }) {
        try {
          const { getLoadedManifests, getDisabledExtensions } = await import("../../extensions/loader.js");
          const manifests = getLoadedManifests();
          const disabled = getDisabledExtensions?.() || [];
          // Compact format so the AI doesn't feel pressured to truncate
          const lines = manifests.map(m => {
            const parts = [];
            if (m.provides?.routes) parts.push("R");
            if (m.provides?.tools) parts.push("T");
            if (m.provides?.jobs) parts.push("J");
            if (m.provides?.modes) parts.push("M");
            const provides = parts.length ? `[${parts.join("")}]` : "";
            return `${m.name} ${m.version} ${provides}`;
          });
          const header = `${manifests.length} extensions loaded${disabled.length ? ` (${disabled.length} disabled: ${disabled.join(", ")})` : ""}:`;
          return { content: [{ type: "text", text: `${header}\n${lines.join("\n")}` }] };
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
      name: "land-ext-upgrade",
      description: "Upgrade an installed extension to the latest version from the registry. Compares installed version to registry, downloads if newer. God-tier only. Requires restart.",
      schema: {
        name: z.string().describe("Extension name to upgrade"),
        userId: z.string().describe("Injected by server. Ignore."),
      },
      annotations: { readOnlyHint: false, destructiveHint: true },
      async handler({ name: extName, userId }) {
        if (!await requireAdmin(userId)) {
          return { content: [{ type: "text", text: "Permission denied. Requires god-tier." }] };
        }
        try {
          const { getLoadedManifests, installExtension } = await import("../../extensions/loader.js");
          const manifests = getLoadedManifests();
          const current = manifests.find(m => m.name === extName);
          if (!current) {
            return { content: [{ type: "text", text: `"${extName}" is not installed. Use land-ext-install instead.` }] };
          }

          const { getLandConfigValue } = await import("../../seed/landConfig.js");
          const horizonUrl = getLandConfigValue("HORIZON_URL") || process.env.HORIZON_URL || "https://horizon.treeos.ai";
          const res = await fetch(`${horizonUrl}/extensions/${encodeURIComponent(extName)}`);
          if (!res.ok) {
            return { content: [{ type: "text", text: `Registry lookup failed: HTTP ${res.status}` }] };
          }
          const data = await res.json();
          const latest = data.latest || data;
          if (!latest?.version) {
            return { content: [{ type: "text", text: `"${extName}" not found in registry.` }] };
          }

          // Compare versions
          const pa = String(current.version).match(/^(\d+)\.(\d+)\.(\d+)/);
          const pb = String(latest.version).match(/^(\d+)\.(\d+)\.(\d+)/);
          if (pa && pb) {
            let isNewer = false;
            for (let i = 1; i <= 3; i++) {
              if (Number(pb[i]) > Number(pa[i])) { isNewer = true; break; }
              if (Number(pb[i]) < Number(pa[i])) break;
            }
            if (!isNewer) {
              return { content: [{ type: "text", text: `${extName} is already at v${current.version} (latest: v${latest.version}). No upgrade needed.` }] };
            }
          }

          const result = await installExtension(extName, latest.version);
          return { content: [{ type: "text", text: `Upgraded ${extName}: v${current.version} -> v${result.version}. Restart the land to load the new version.` }] };
        } catch (err) {
          return { content: [{ type: "text", text: `Upgrade failed: ${err.message}` }] };
        }
      },
    },

    {
      name: "land-ext-check",
      description: "Check all installed extensions against the registry for available updates. Read-only. No changes made.",
      schema: {
        userId: z.string().describe("Injected by server. Ignore."),
      },
      annotations: { readOnlyHint: true },
      async handler({ userId }) {
        try {
          const { getLoadedManifests } = await import("../../extensions/loader.js");
          const { getLandConfigValue } = await import("../../seed/landConfig.js");
          const horizonUrl = getLandConfigValue("HORIZON_URL") || process.env.HORIZON_URL || "https://horizon.treeos.ai";
          const manifests = getLoadedManifests();

          // Batch fetch: get all extensions from registry
          let registryExts = [];
          try {
            const res = await fetch(`${horizonUrl}/extensions?limit=100`);
            if (res.ok) {
              const data = await res.json();
              registryExts = data.extensions || data || [];
            }
          } catch { /* registry unreachable */ }

          if (registryExts.length === 0) {
            return { content: [{ type: "text", text: "Could not reach the extension registry. Check HORIZON_URL." }] };
          }

          const registryMap = new Map();
          for (const ext of registryExts) {
            if (!registryMap.has(ext.name) || ext.version > registryMap.get(ext.name)) {
              registryMap.set(ext.name, ext.version);
            }
          }

          const updates = [];
          const current = [];
          const notInRegistry = [];

          for (const m of manifests) {
            const registryVersion = registryMap.get(m.name);
            if (!registryVersion) {
              notInRegistry.push(m.name);
              continue;
            }
            const pa = String(m.version).match(/^(\d+)\.(\d+)\.(\d+)/);
            const pb = String(registryVersion).match(/^(\d+)\.(\d+)\.(\d+)/);
            if (pa && pb) {
              let isNewer = false;
              for (let i = 1; i <= 3; i++) {
                if (Number(pb[i]) > Number(pa[i])) { isNewer = true; break; }
                if (Number(pb[i]) < Number(pa[i])) break;
              }
              if (isNewer) {
                updates.push({ name: m.name, installed: m.version, available: registryVersion });
              } else {
                current.push(m.name);
              }
            }
          }

          if (updates.length === 0) {
            return { content: [{ type: "text", text: `All ${current.length} registered extensions are up to date.${notInRegistry.length > 0 ? ` ${notInRegistry.length} local-only (not in registry).` : ""}` }] };
          }

          const lines = updates.map(u => `${u.name}: v${u.installed} -> v${u.available}`);
          return { content: [{ type: "text", text: `${updates.length} update(s) available:\n${lines.join("\n")}\n\nUse land-ext-upgrade <name> to upgrade.` }] };
        } catch (err) {
          return { content: [{ type: "text", text: `Check failed: ${err.message}` }] };
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

          const { clearScopeCache } = await import("../../seed/tree/extensionScope.js");

          const config = {};
          if (blocked?.length) config.blocked = blocked;
          if (restricted && Object.keys(restricted).length) config.restricted = restricted;

          if (Object.keys(config).length === 0) {
            await _metadata.setExtMeta(node, "extensions", null);
          } else {
            await _metadata.setExtMeta(node, "extensions", config);
          }
          clearScopeCache();

          return { content: [{ type: "text", text: `Extension scope updated on "${node.name}". ${config.blocked?.length ? `Blocked: ${config.blocked.join(", ")}. ` : ""}${config.restricted ? `Restricted: ${JSON.stringify(config.restricted)}. ` : ""}Inherits to all children.` }] };
        } catch (err) {
          return { content: [{ type: "text", text: `Error: ${err.message}` }] };
        }
      },
    },
  ];
}
