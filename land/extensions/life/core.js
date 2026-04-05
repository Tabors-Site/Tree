/**
 * Life Core
 *
 * Scaffold domains. Wire channels. Hand off.
 * Life doesn't manage extensions after setup. It plants seeds.
 */

import log from "../../seed/log.js";
import { getExtension } from "../loader.js";

// Domains that go under Health vs Learning vs Work
const DOMAIN_GROUPS = {
  food: "Health",
  fitness: "Health",
  recovery: "Health",
  study: "Learning",
  kb: "Work",
  relationships: "Social",
  finance: "Finance",
  investor: "Finance",
  "market-researcher": "Finance",
};

// Auto-wire channels between related domains
const CHANNEL_MAP = [
  ["food", "fitness"],
  ["fitness", "recovery"],
  ["food", "recovery"],
  ["relationships", "recovery"],
  ["finance", "food"],
  ["finance", "fitness"],
  ["investor", "finance"],
  ["market-researcher", "investor"],
  ["market-researcher", "finance"],
];

import { DELETED } from "../../seed/protocol.js";

/**
 * Create the Life root node for a user. No groups or domains yet.
 */
export async function scaffoldRoot(userId) {
  const { createNode } = await import("../../seed/tree/treeManagement.js");
  const { setExtMeta } = await import("../../seed/tree/extensionMetadata.js");
  const root = await createNode({ name: "Life", isRoot: true, userId });
  const rootId = String(root._id);
  await setExtMeta(root, "life", { initialized: true });
  log.info("Life", `Scaffolded Life root for user ${userId}: ${rootId}`);
  return { rootId };
}

/**
 * Find the Life root node for a user. Returns the ID string or null.
 */
export async function findLifeRoot(userId) {
  const Node = (await import("../../seed/models/node.js")).default;
  // Check by metadata first, then fall back to name match
  const root = await Node.findOne({
    rootOwner: userId,
    parent: { $nin: [DELETED, null] },
    "metadata.life.initialized": true,
  }).select("_id").lean()
    || await Node.findOne({
      rootOwner: userId,
      name: "Life",
      parent: { $nin: [DELETED, null] },
    }).select("_id").lean();
  return root ? String(root._id) : null;
}

/**
 * Get domain nodes under a Life root. Walks groups and their children.
 * Returns { fitness: { id, name, ready }, food: { id, name, ready }, ... }
 */
export async function getDomainNodes(rootId) {
  const Node = (await import("../../seed/models/node.js")).default;
  const result = {};
  const domains = ["food", "fitness", "study", "recovery", "kb", "relationships", "finance", "investor", "market-researcher"];

  const children = await Node.find({ parent: rootId }).select("_id name metadata").lean();
  for (const child of children) {
    // Check if child itself is a domain
    for (const d of domains) {
      const meta = child.metadata instanceof Map ? child.metadata.get(d) : child.metadata?.[d];
      if (meta?.initialized) {
        result[d] = { id: String(child._id), name: child.name, ready: meta.setupPhase !== "base", treeRootId: String(rootId) };
      }
    }
    // Check grandchildren (domains under group nodes)
    const grandchildren = await Node.find({ parent: child._id }).select("_id name metadata").lean();
    for (const gc of grandchildren) {
      for (const d of domains) {
        const meta = gc.metadata instanceof Map ? gc.metadata.get(d) : gc.metadata?.[d];
        if (meta?.initialized) {
          result[d] = { id: String(gc._id), name: gc.name, ready: meta.setupPhase !== "base", treeRootId: String(rootId) };
        }
      }
    }
  }
  return result;
}

/**
 * Get available domains (installed extensions that have scaffold capability).
 */
export function getAvailableDomains() {
  const domains = [];
  for (const name of ["food", "fitness", "study", "recovery", "kb", "relationships", "finance", "investor", "market-researcher"]) {
    const ext = getExtension(name);
    if (ext?.exports?.scaffold || ext?.exports?.isInitialized) {
      domains.push(name);
    }
  }
  return domains;
}

/**
 * Scaffold selected domains under a single tree or as separate trees.
 */
export async function scaffold({ selections, singleTree, userId, username }) {
  const { createNode } = await import("../../seed/tree/treeManagement.js");
  const Node = (await import("../../seed/models/node.js")).default;
  const results = [];

  if (singleTree) {
    // Find existing Life root or create one
    let rootId = await findLifeRoot(userId);
    let root;
    if (rootId) {
      root = await Node.findById(rootId);
      // Ensure rootOwner is set (fixes manually created Life nodes)
      if (root && !root.rootOwner) {
        root.rootOwner = userId;
        await root.save();
      }
      root = root?.toObject ? root.toObject() : root;
      log.verbose("Life", `Found existing Life root: ${rootId}`);
    } else {
      root = await createNode({ name: "Life", isRoot: true, userId });
      rootId = String(root._id);
      const { setExtMeta } = await import("../../seed/tree/extensionMetadata.js");
      await setExtMeta(root, "life", { initialized: true });
    }

    // Find or create group nodes
    const groups = new Set(selections.map(s => DOMAIN_GROUPS[s]).filter(Boolean));
    const groupNodes = {};

    for (const group of groups) {
      // Check if group already exists
      const existing = await Node.findOne({ parent: rootId, name: group }).select("_id").lean();
      if (existing) {
        groupNodes[group] = String(existing._id);
      } else {
        const node = await createNode({ name: group, parentId: rootId, userId });
        groupNodes[group] = String(node._id);
      }
    }

    // Scaffold each domain under its group (skip if already exists)
    for (const sel of selections) {
      const group = DOMAIN_GROUPS[sel];
      const parentId = groupNodes[group] || rootId;
      const domainName = sel.charAt(0).toUpperCase() + sel.slice(1);

      // Check if domain node already exists
      const existing = await Node.findOne({ parent: parentId, name: domainName }).select("_id metadata").lean();
      if (existing) {
        const meta = existing.metadata instanceof Map ? existing.metadata.get(sel) : existing.metadata?.[sel];
        if (meta?.initialized) {
          log.verbose("Life", `Domain ${sel} already scaffolded, skipping`);
          results.push({ name: sel, id: String(existing._id), status: "exists" });
          continue;
        }
      }

      try {
        // Create the domain node (or use existing uninitialized one)
        let domainId;
        if (existing) {
          domainId = String(existing._id);
        } else {
          const domainNode = await createNode({ name: domainName, parentId, userId });
          domainId = String(domainNode._id);
        }

        // Call the extension's scaffold
        const ext = getExtension(sel);
        if (ext?.exports?.scaffold) {
          await ext.exports.scaffold(domainId, userId);

          // Set modes.respond so the routing index finds this node
          const DOMAIN_MODES = {
            food: "tree:food-coach", fitness: "tree:fitness-coach",
            recovery: "tree:recovery-plan", study: "tree:study-coach", kb: "tree:kb-tell",
            relationships: "tree:relationships-coach",
            finance: "tree:finance-coach",
            investor: "tree:investor-coach",
            "market-researcher": "tree:market-coach",
          };
          if (DOMAIN_MODES[sel]) {
            const { setNodeMode } = await import("../../seed/modes/registry.js");
            await setNodeMode(domainId, "respond", DOMAIN_MODES[sel], userId);
          }

          results.push({ name: sel, id: domainId, status: "ok" });
        } else {
          results.push({ name: sel, id: domainId, status: "no-scaffold" });
        }
      } catch (err) {
        log.warn("Life", `Failed to scaffold ${sel}: ${err.message}`);
        results.push({ name: sel, status: "error", error: err.message });
      }
    }

    // Wire channels between related domains
    await wireChannels(selections, rootId, userId);

    // Rebuild routing index so new domain nodes are immediately routable
    try {
      const { rebuildIndexForRoot } = await import("../tree-orchestrator/routingIndex.js");
      await rebuildIndexForRoot(rootId);
    } catch {}

    return { rootId, type: "single", results };

  } else {
    // Separate trees
    for (const sel of selections) {
      try {
        const root = await createNode({
          name: sel.charAt(0).toUpperCase() + sel.slice(1),
          isRoot: true,
          userId,
        });
        const rootId = String(root._id);

        const ext = getExtension(sel);
        if (ext?.exports?.scaffold) {
          await ext.exports.scaffold(rootId, userId);
          results.push({ name: sel, rootId, status: "ok" });
        } else {
          results.push({ name: sel, rootId, status: "no-scaffold" });
        }
      } catch (err) {
        log.warn("Life", `Failed to scaffold ${sel}: ${err.message}`);
        results.push({ name: sel, status: "error", error: err.message });
      }
    }

    // Wire channels between related separate trees
    await wireChannelsSeparate(selections, results, userId);

    return { type: "separate", results };
  }
}

/**
 * Add a domain to an existing Life tree.
 */
export async function addDomain({ rootId, domain, userId }) {
  const { createNode } = await import("../../seed/tree/treeManagement.js");
  const Node = (await import("../../seed/models/node.js")).default;

  // Find the right group node
  const group = DOMAIN_GROUPS[domain];
  const children = await Node.find({ parent: rootId }).select("_id name").lean();
  let groupNode = children.find(c => c.name === group);

  if (!groupNode && group) {
    const node = await createNode({ name: group, parentId: rootId, userId });
    groupNode = node;
  }

  const parentId = groupNode ? String(groupNode._id) : rootId;
  const domainName = domain.charAt(0).toUpperCase() + domain.slice(1);

  // Check if domain already exists
  const existing = await Node.findOne({ parent: parentId, name: domainName }).select("_id metadata").lean();
  if (existing) {
    const meta = existing.metadata instanceof Map ? existing.metadata.get(domain) : existing.metadata?.[domain];
    if (meta?.initialized) {
      return { name: domain, id: String(existing._id), status: "exists" };
    }
  }

  let domainId;
  if (existing) {
    domainId = String(existing._id);
  } else {
    const domainNode = await createNode({ name: domainName, parentId, userId });
    domainId = String(domainNode._id);
  }

  const ext = getExtension(domain);
  if (ext?.exports?.scaffold) {
    await ext.exports.scaffold(domainId, userId);

    const DOMAIN_MODES = {
      food: "tree:food-coach", fitness: "tree:fitness-coach",
      recovery: "tree:recovery-plan", study: "tree:study-coach", kb: "tree:kb-tell",
    };
    if (DOMAIN_MODES[domain]) {
      const { setNodeMode } = await import("../../seed/modes/registry.js");
      await setNodeMode(domainId, "respond", DOMAIN_MODES[domain], userId);
    }
  }

  // Wire any new channels
  const existingDomains = await getInstalledDomains(rootId);
  existingDomains.push(domain);
  await wireChannels(existingDomains, rootId, userId);

  // Ensure Life root is in user's nav list
  try {
    const nav = getExtension("navigation");
    if (nav?.exports?.addRoot) await nav.exports.addRoot(userId, rootId);
  } catch {}

  return { name: domain, id: domainId, status: "ok" };
}

/**
 * Get which domains are already scaffolded under a root.
 */
async function getInstalledDomains(rootId) {
  const Node = (await import("../../seed/models/node.js")).default;
  const installed = [];

  // Walk one level of children (group nodes) and their children (domain nodes)
  const children = await Node.find({ parent: rootId }).select("_id name metadata").lean();
  for (const child of children) {
    // Check if this child itself is a domain
    for (const domain of ["food", "fitness", "study", "recovery", "kb", "relationships"]) {
      if (child.name.toLowerCase() === domain) {
        const meta = child.metadata instanceof Map ? child.metadata.get(domain) : child.metadata?.[domain];
        if (meta?.initialized) installed.push(domain);
      }
    }
    // Check grandchildren (under group nodes like Health, Learning)
    const grandchildren = await Node.find({ parent: child._id }).select("name metadata").lean();
    for (const gc of grandchildren) {
      for (const domain of ["food", "fitness", "study", "recovery", "kb", "relationships"]) {
        if (gc.name.toLowerCase() === domain) {
          const meta = gc.metadata instanceof Map ? gc.metadata.get(domain) : gc.metadata?.[domain];
          if (meta?.initialized) installed.push(domain);
        }
      }
    }
  }

  return installed;
}

/**
 * Wire channels between related domains in a single tree.
 */
async function wireChannels(selections, rootId, userId) {
  const ch = getExtension("channels");
  if (!ch?.exports?.createChannel) return;

  const Node = (await import("../../seed/models/node.js")).default;

  // Find domain nodes by walking the tree
  const domainNodes = {};
  const children = await Node.find({ parent: rootId }).select("_id name").lean();
  for (const child of children) {
    const name = child.name.toLowerCase();
    if (selections.includes(name)) {
      domainNodes[name] = String(child._id);
    }
    const grandchildren = await Node.find({ parent: child._id }).select("_id name").lean();
    for (const gc of grandchildren) {
      const gcName = gc.name.toLowerCase();
      if (selections.includes(gcName)) {
        domainNodes[gcName] = String(gc._id);
      }
    }
  }

  for (const [a, b] of CHANNEL_MAP) {
    if (domainNodes[a] && domainNodes[b]) {
      try {
        await ch.exports.createChannel({
          sourceNodeId: domainNodes[a],
          targetNodeId: domainNodes[b],
          channelName: `${a}-${b}`,
          direction: "bidirectional",
          filter: { tags: [a, b] },
          userId,
        });
        log.info("Life", `Channel: ${a} <-> ${b}`);
      } catch (err) {
        log.verbose("Life", `Channel ${a}-${b} failed or exists: ${err.message}`);
      }
    }
  }
}

/**
 * Wire channels between separate tree roots.
 */
async function wireChannelsSeparate(selections, results, userId) {
  const ch = getExtension("channels");
  if (!ch?.exports?.createChannel) return;

  const rootMap = {};
  for (const r of results) {
    if (r.rootId) rootMap[r.name] = r.rootId;
  }

  for (const [a, b] of CHANNEL_MAP) {
    if (rootMap[a] && rootMap[b]) {
      try {
        await ch.exports.createChannel({
          sourceNodeId: rootMap[a],
          targetNodeId: rootMap[b],
          channelName: `${a}-${b}`,
          direction: "bidirectional",
          filter: { tags: [a, b] },
          userId,
        });
        log.info("Life", `Channel: ${a} <-> ${b} (cross-tree)`);
      } catch (err) {
        log.verbose("Life", `Channel ${a}-${b} failed or exists: ${err.message}`);
      }
    }
  }
}
