/**
 * Propagation Core
 *
 * The actual work of moving cascade signals through the tree.
 * Walks children[] outward. Checks each child's metadata.cascade
 * to decide whether to continue deeper. Sends cross-land via Canopy.
 * Retries failed hops from .flow on a timer.
 */

import log from "../../seed/log.js";
import { deliverCascade, getCascadeResults } from "../../seed/tree/cascade.js";

// Node model wired from init via setModels
let Node = null;
export function setModels(models) { Node = models.Node; }
import { getLandConfigValue } from "../../seed/landConfig.js";
import { SYSTEM_ROLE } from "../../seed/protocol.js";

/**
 * Get propagation config from .config node metadata.propagation.
 * These are NOT kernel configs. They are propagation's own settings.
 */
export async function getPropagationConfig() {
  const configNode = await Node.findOne({ systemRole: SYSTEM_ROLE.CONFIG }).select("metadata").lean();
  if (!configNode) return defaults();

  const meta = configNode.metadata instanceof Map
    ? configNode.metadata.get("propagation") || {}
    : configNode.metadata?.propagation || {};

  return {
    propagationTimeout: meta.propagationTimeout ?? 10000,
    propagationRetries: meta.propagationRetries ?? 3,
    defaultCascadeMode: meta.defaultCascadeMode ?? "open",
  };
}

function defaults() {
  return {
    propagationTimeout: 10000,
    propagationRetries: 3,
    defaultCascadeMode: "open",
  };
}

/**
 * Propagate a cascade signal outward through children.
 *
 * Called by the onCascade hook handler. Walks children[] of the source node,
 * calling deliverCascade on each child. deliverCascade fires onCascade at
 * the child, which this handler picks up again, continuing deeper.
 *
 * The recursion guard: deliverCascade checks cascadeMaxDepth from kernel config.
 * We also check each child's metadata.cascade to decide whether to continue.
 * A child without cascade enabled receives the signal but does not propagate further.
 *
 * @param {object} opts
 * @param {object} opts.node - the node where the signal originated
 * @param {string} opts.nodeId - the node's ID
 * @param {string} opts.signalId - ties the full cascade chain together
 * @param {object} opts.payload - signal data (writeContext from kernel or relay payload)
 * @param {number} opts.depth - current propagation depth
 * @param {object} opts.cascadeConfig - the node's metadata.cascade
 */
export async function propagateOutward({ node, nodeId, signalId, payload, depth, cascadeConfig }) {
  const children = node.children;
  if (!children || children.length === 0) return [];

  const config = await getPropagationConfig();
  const maxDepth = parseInt(getLandConfigValue("cascadeMaxDepth") || "50", 10);

  // Don't propagate if we're already at max depth
  if (depth >= maxDepth) {
    log.debug("Propagation", `Depth limit (${maxDepth}) reached at ${node.name || nodeId}. Stopping.`);
    return [];
  }

  // Check cascade mode: sealed signals don't propagate to children
  // unless the child explicitly opts in with metadata.cascade.acceptSealed = true
  const mode = cascadeConfig?.mode || config.defaultCascadeMode;

  const results = [];

  for (const childId of children) {
    const childIdStr = childId.toString();

    // Load child to check its cascade willingness
    const child = await Node.findById(childIdStr).select("name metadata systemRole children").lean();
    if (!child || child.systemRole) continue;

    const childMeta = child.metadata instanceof Map
      ? Object.fromEntries(child.metadata)
      : (child.metadata || {});

    const childCascade = childMeta.cascade;

    // In sealed mode, skip children that don't accept sealed signals
    if (mode === "sealed" && !childCascade?.acceptSealed) continue;

    // Perspective filter: if installed, check whether this child's perspective accepts the signal
    try {
      const { getExtension } = await import("../loader.js");
      const perspectiveExt = getExtension("perspective-filter");
      if (perspectiveExt?.exports?.shouldDeliver) {
        const accepted = await perspectiveExt.exports.shouldDeliver(child, payload);
        if (!accepted) {
          log.debug("Propagation", `Signal ${signalId.slice(0, 8)} rejected by perspective at "${child.name}"`);
          continue;
        }
      }
    } catch {}

    // Filter: if child has cascade.filters, check them
    if (childCascade?.filters) {
      const accepted = evaluateFilters(childCascade.filters, payload);
      if (!accepted) {
        log.debug("Propagation", `Signal ${signalId.slice(0, 8)} filtered out at "${child.name}"`);
        continue;
      }
    }

    try {
      // Sealed transport: if signal is sealed, intermediary nodes get redacted payload.
      // Destination nodes (leaves with no cascade-enabled children) get the full payload.
      let deliveryPayload = payload;
      try {
        const { getExtension } = await import("../loader.js");
        const sealedExt = getExtension("sealed-transport");
        if (sealedExt?.exports?.isSealed?.(cascadeConfig, payload)) {
          const hasChildren = child.children && child.children.length > 0;
          if (hasChildren) {
            deliveryPayload = sealedExt.exports.sealPayload(payload);
          }
        }
      } catch {}

      // deliverCascade writes to .flow and fires onCascade at the child.
      // If the child has cascade.enabled, our handler fires again (recursion).
      // If not, the child receives the signal but does not propagate deeper.
      const result = await withTimeout(
        deliverCascade({
          nodeId: childIdStr,
          signalId,
          payload: deliveryPayload,
          source: nodeId,
          depth: depth + 1,
        }),
        config.propagationTimeout,
      );
      results.push(result);
    } catch (err) {
      log.warn("Propagation", `Hop to "${child.name}" failed: ${err.message}`);
      results.push({
        status: "failed",
        source: childIdStr,
        payload: { reason: err.message },
        timestamp: new Date(),
        signalId,
        extName: "propagation",
      });
    }
  }

  return results;
}

/**
 * Propagate a cascade signal to peered lands via Canopy.
 *
 * Checks .peers for active peer connections and sends through
 * the cascade API endpoint on each peer. The receiving land's
 * propagation extension picks it up from their side.
 */
export async function propagateToPeers({ nodeId, signalId, payload, depth }) {
  let LandPeer;
  try {
    const mod = await import("../../canopy/models/landPeer.js");
    LandPeer = mod.default;
  } catch {
    return []; // LandPeer model not available
  }

  let getPeerBaseUrl;
  try {
    const mod = await import("../../canopy/peers.js");
    getPeerBaseUrl = mod.getPeerBaseUrl;
  } catch {
    return [];
  }

  const peers = await LandPeer.find({ status: "active" });
  if (peers.length === 0) return [];

  const config = await getPropagationConfig();
  const results = [];

  for (const peer of peers) {
    const baseUrl = getPeerBaseUrl(peer);
    const url = `${baseUrl}/api/v1/node/${nodeId}/cascade`;

    try {
      const res = await withTimeout(
        fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            signalId,
            payload,
            source: nodeId,
            depth: depth + 1,
          }),
          signal: AbortSignal.timeout(config.propagationTimeout),
        }),
        config.propagationTimeout + 1000, // outer safety
      );

      if (res.ok) {
        const data = await res.json();
        results.push({ peer: peer.domain, status: "delivered", result: data.result });
        log.debug("Propagation", `Cross-land to ${peer.domain}: delivered`);
      } else {
        results.push({ peer: peer.domain, status: "failed", httpStatus: res.status });
        log.warn("Propagation", `Cross-land to ${peer.domain}: HTTP ${res.status}`);
      }
    } catch (err) {
      results.push({ peer: peer.domain, status: "failed", reason: err.message });
      log.warn("Propagation", `Cross-land to ${peer.domain} failed: ${err.message}`);
    }
  }

  return results;
}

/**
 * Retry failed cascade hops from .flow.
 * Loads all recent results, finds entries with status "failed",
 * and re-attempts delivery.
 */
export async function retryFailedHops() {
  const config = await getPropagationConfig();

  // Load .flow results
  const flowNode = await Node.findOne({ systemRole: SYSTEM_ROLE.FLOW }).select("metadata").lean();
  if (!flowNode) return { retried: 0, succeeded: 0 };

  const allResults = flowNode.metadata instanceof Map
    ? flowNode.metadata.get("results") || {}
    : flowNode.metadata?.results || {};

  let retried = 0;
  let succeeded = 0;
  const maxRetries = config.propagationRetries;

  for (const [signalId, entries] of Object.entries(allResults)) {
    if (!Array.isArray(entries)) continue;

    for (const entry of entries) {
      if (entry.status !== "failed") continue;
      if (entry._retryCount >= maxRetries) continue;

      const targetNodeId = entry.source;
      if (!targetNodeId) continue;

      retried++;

      try {
        const result = await deliverCascade({
          nodeId: targetNodeId,
          signalId,
          payload: entry.payload?.originalPayload || entry.payload || {},
          source: entry.payload?.originalSource || targetNodeId,
          depth: entry.payload?.depth || 0,
        });

        if (result.status === "succeeded") succeeded++;
      } catch (err) {
        log.debug("Propagation", `Retry for ${signalId.slice(0, 8)} at ${targetNodeId.slice(0, 8)} failed: ${err.message}`);
      }
    }
  }

  if (retried > 0) {
    log.verbose("Propagation", `Retry job: ${retried} retried, ${succeeded} succeeded`);
  }

  return { retried, succeeded };
}

/**
 * Evaluate cascade filters against a payload.
 * Filters are an array of { field, op, value } objects.
 * All must pass (AND logic).
 */
function evaluateFilters(filters, payload) {
  if (!Array.isArray(filters) || filters.length === 0) return true;

  for (const filter of filters) {
    const { field, op, value } = filter;
    const actual = payload?.[field];

    switch (op) {
      case "eq": if (actual !== value) return false; break;
      case "ne": if (actual === value) return false; break;
      case "exists": if ((actual != null) !== value) return false; break;
      case "contains":
        if (typeof actual !== "string" || !actual.includes(value)) return false;
        break;
      default: break;
    }
  }

  return true;
}

/**
 * Race a promise against a timeout.
 */
function withTimeout(promise, ms) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`Propagation timeout (${ms}ms)`)), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}
