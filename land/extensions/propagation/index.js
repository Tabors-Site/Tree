/**
 * Propagation Extension
 *
 * The foundation of the cascade network. Listens to onCascade and does
 * the actual work of moving signals through the tree. When the kernel
 * fires onCascade because content was written at a cascade-enabled node,
 * propagation walks children[] outward, checking each child's cascade
 * config to determine if the signal should continue deeper.
 *
 * For cross-land signals, checks .peers for active peer connections
 * and sends through Canopy. The receiving land's propagation extension
 * picks it up from their side via deliverCascade.
 *
 * Depends on: kernel cascade primitive only.
 */

import log from "../../seed/log.js";
import tools from "./tools.js";
import { propagateOutward, propagateToPeers } from "./core.js";
import { startRetryJob, stopRetryJob } from "./retryJob.js";

export async function init(core) {
  const { setModels } = await import("./core.js");
  setModels(core.models);
  // ── The one hook: onCascade ──────────────────────────────────────────
  //
  // When the kernel fires onCascade, we receive the node, the signal,
  // and the depth. Our job: walk children outward and deliver cross-land.
  //
  // The kernel calls checkCascade at depth 0 (local write).
  // We call deliverCascade on each child, which fires onCascade again
  // at depth+1. This handler fires again, recurses. deliverCascade
  // checks cascadeMaxDepth so the chain is bounded.

  core.hooks.register("onCascade", async (hookData) => {
    const { node, nodeId, signalId, writeContext, payload, cascadeConfig, depth } = hookData;

    // The signal data is writeContext (from checkCascade) or payload (from deliverCascade)
    const signalPayload = writeContext || payload || {};

    // Propagate outward through children
    try {
      const results = await propagateOutward({
        node,
        nodeId,
        signalId,
        payload: signalPayload,
        depth: depth || 0,
        cascadeConfig: cascadeConfig || {},
      });

      // If any hops failed, mark the origin result as partial
      const anyFailed = results.some((r) => r.status === "failed");
      if (anyFailed && results.length > 0) {
        hookData._resultStatus = "partial";
        hookData._resultPayload = {
          ...signalPayload,
          propagation: {
            delivered: results.filter((r) => r.status === "succeeded").length,
            failed: results.filter((r) => r.status === "failed").length,
            total: results.length,
          },
        };
      }

      hookData._resultExtName = "propagation";
    } catch (err) {
      log.error("Propagation", `Outward propagation failed at ${node?.name || nodeId}: ${err.message}`);
      hookData._resultStatus = "failed";
      hookData._resultPayload = { reason: err.message };
      hookData._resultExtName = "propagation";
    }

    // Cross-land propagation: send to peered lands if cascade config enables it
    if (cascadeConfig?.crossLand) {
      try {
        const peerResults = await propagateToPeers({
          nodeId,
          signalId,
          payload: signalPayload,
          depth: depth || 0,
        });

        if (peerResults.length > 0) {
          log.debug("Propagation", `Cross-land: ${peerResults.filter((r) => r.status === "delivered").length}/${peerResults.length} peers reached`);
        }
      } catch (err) {
        log.warn("Propagation", `Cross-land propagation failed: ${err.message}`);
      }
    }
  }, "propagation");

  return {
    tools,
    jobs: [
      {
        name: "propagation-retry",
        start: () => startRetryJob(),
        stop: () => stopRetryJob(),
      },
    ],
  };
}
