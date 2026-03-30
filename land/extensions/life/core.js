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
};

// Auto-wire channels between related domains
const CHANNEL_MAP = [
  ["food", "fitness"],
  ["fitness", "recovery"],
  ["food", "recovery"],
];

/**
 * Get available domains (installed extensions that have scaffold capability).
 */
export function getAvailableDomains() {
  const domains = [];
  for (const name of ["food", "fitness", "study", "recovery", "kb"]) {
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
  const results = [];

  if (singleTree) {
    // Create one tree with grouping nodes
    const root = await createNode({ name: "Life", isRoot: true, userId });
    const rootId = String(root._id);

    // Determine which group nodes are needed
    const groups = new Set(selections.map(s => DOMAIN_GROUPS[s]).filter(Boolean));
    const groupNodes = {};

    for (const group of groups) {
      const node = await createNode({ name: group, parentId: rootId, userId });
      groupNodes[group] = String(node._id);
    }

    // Scaffold each domain under its group
    for (const sel of selections) {
      const group = DOMAIN_GROUPS[sel];
      const parentId = groupNodes[group] || rootId;

      try {
        // Create the domain node
        const domainNode = await createNode({ name: sel.charAt(0).toUpperCase() + sel.slice(1), parentId, userId });
        const domainId = String(domainNode._id);

        // Call the extension's scaffold
        const ext = getExtension(sel);
        if (ext?.exports?.scaffold) {
          await ext.exports.scaffold(domainId, userId);
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
  const domainNode = await createNode({
    name: domain.charAt(0).toUpperCase() + domain.slice(1),
    parentId,
    userId,
  });
  const domainId = String(domainNode._id);

  const ext = getExtension(domain);
  if (ext?.exports?.scaffold) {
    await ext.exports.scaffold(domainId, userId);
  }

  // Wire any new channels
  const existingDomains = await getInstalledDomains(rootId);
  existingDomains.push(domain);
  await wireChannels(existingDomains, rootId, userId);

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
    for (const domain of ["food", "fitness", "study", "recovery", "kb"]) {
      if (child.name.toLowerCase() === domain) {
        const meta = child.metadata instanceof Map ? child.metadata.get(domain) : child.metadata?.[domain];
        if (meta?.initialized) installed.push(domain);
      }
    }
    // Check grandchildren (under group nodes like Health, Learning)
    const grandchildren = await Node.find({ parent: child._id }).select("name metadata").lean();
    for (const gc of grandchildren) {
      for (const domain of ["food", "fitness", "study", "recovery", "kb"]) {
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
