// orchestrators/pipelines/shortTermDrain.js
// Drains pending ShortMemory items into the tree.
// Pipeline: cluster -> scout -> plan -> build -> place.

import log from "../../seed/log.js";
import { OrchestratorRuntime, LLM_PRIORITY } from "../../seed/orchestrators/runtime.js";
import { acquireLock, releaseLock } from "../../seed/orchestrators/locks.js";
import { SESSION_TYPES } from "../../seed/ws/sessionRegistry.js";
import { buildDeepTreeSummary } from "../../seed/tree/treeFetch.js";
import ShortMemory from "./model.js";
import Node from "../../seed/models/node.js";
import User from "../../seed/models/user.js";

// ─────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────

const MAX_DRAIN_ATTEMPTS = 3;
const MIN_CONFIDENCE = 0.5;
const MAX_ITEMS_PER_RUN = 8;

/**
 * Increment drainAttempts on items. Escalate any that hit MAX_DRAIN_ATTEMPTS.
 */
async function requeueItems(itemIds, reason) {
  if (!itemIds?.length) return;
  await ShortMemory.updateMany(
    { _id: { $in: itemIds } },
    { $inc: { drainAttempts: 1 } },
  );
  await ShortMemory.updateMany(
    { _id: { $in: itemIds }, drainAttempts: { $gte: MAX_DRAIN_ATTEMPTS } },
    { status: "escalated" },
  );
 log.debug("Dreams", `Re-queued ${itemIds.length} items: ${reason}`);
}

// ─────────────────────────────────────────────────────────────────────────
// MAIN ORCHESTRATOR
// ─────────────────────────────────────────────────────────────────────────

/**
 * Drain all pending ShortMemory items for a given tree.
 */
export async function drainTree(rootId) {
  if (!acquireLock("drain", rootId)) {
 log.verbose("Dreams", `Drain already running for tree ${rootId}, skipping`);
    return { sessionId: null };
  }

  // Pre-init: load items and resolve user before creating runtime
  let items, rootNode, userId, username;
  try {
    items = await ShortMemory.find({
      rootId,
      status: "pending",
      drainAttempts: { $lt: MAX_DRAIN_ATTEMPTS },
    })
      .sort({ createdAt: 1 })
      .limit(MAX_ITEMS_PER_RUN)
      .lean();

    if (!items.length) {
      releaseLock("drain", rootId);
      return { sessionId: null };
    }

    rootNode = await Node.findById(rootId).select("rootOwner name").lean();
    if (!rootNode?.rootOwner) {
 log.error("Dreams", `Drain: tree ${rootId} has no rootOwner`);
      releaseLock("drain", rootId);
      return { sessionId: null };
    }
    userId = rootNode.rootOwner;
    const user = await User.findById(userId).select("username").lean();
    username = user?.username || "user";
  } catch (err) {
    releaseLock("drain", rootId);
    throw err;
  }

  // Lock already held, so don't use lockNamespace (we manage it manually)
  const rt = new OrchestratorRuntime({
    rootId,
    userId,
    username,
    visitorId: `drain:${rootId}`,
    sessionType: SESSION_TYPES.SHORT_TERM_DRAIN,
    description: `Short-term drain: ${rootNode.name || rootId}`,
    modeKeyForLlm: "tree:drain-cluster",
    source: "orchestrator",
    llmPriority: LLM_PRIORITY.BACKGROUND,
  });

  await rt.init(`Draining ${items.length} short-term items for tree "${rootNode.name}"`);

 log.verbose("Dreams", `Drain started: ${items.length} items for tree "${rootNode.name}" [${rootId.slice(0, 8)}]`);

  try {
    const treeSummary = await buildDeepTreeSummary(rootId).catch(() => "");
    const itemMap = new Map(items.map((item) => [item._id, item]));

    // STEP 1: CLUSTER ANALYSIS
    const { parsed: manifest } = await rt.runStep("tree:drain-cluster", {
      prompt: `Cluster these ${items.length} deferred items for tree "${rootNode.name}".`,
      modeCtx: { items },
      input: `${items.length} items`,
    });

    if (!manifest?.clusters?.length) {
 log.error("Dreams", "Drain: cluster analysis returned no clusters");
      await requeueItems(items.map((i) => i._id), "cluster analysis failed");
      rt.setResult("Cluster analysis failed", "drain:complete");
      return { sessionId: rt.sessionId };
    }

 log.debug("Dreams", `Clustered into ${manifest.clusters.length} cluster(s)`);

    // Attach full item objects to each cluster
    for (const cluster of manifest.clusters) {
      cluster.items = (cluster.itemIds || [])
        .map((id) => itemMap.get(id))
        .filter(Boolean);
    }

    let totalPlaced = 0;
    let totalRequeued = 0;

    // STEP 2-4: PER-CLUSTER PROCESSING
    for (const cluster of manifest.clusters) {
      if (rt.aborted) break;
      if (!cluster.items.length) continue;

      const clusterItemIds = cluster.items.map((i) => i._id);

      try {
        // SCOUT
        const { parsed: scoutData } = await rt.runStep("tree:drain-scout", {
          prompt: `Scout placement locations for ${cluster.items.length} items about: ${cluster.sharedTheme}`,
          modeCtx: { cluster, treeSummary },
          input: cluster.sharedTheme,
        });

        if (!scoutData?.pins?.length) {
 log.warn("Dreams", `Scout found no pins for cluster "${cluster.sharedTheme}"`);
          await requeueItems(clusterItemIds, "scout found no locations");
          totalRequeued += clusterItemIds.length;
          continue;
        }

        // PLAN
        const { parsed: plan } = await rt.runStep("tree:drain-plan", {
          prompt: `Plan placement for ${cluster.items.length} items using ${scoutData.pins.length} scouted locations.`,
          modeCtx: { cluster, pins: scoutData.pins },
          input: cluster.sharedTheme,
        });

        if (!plan?.placeSteps?.length) {
 log.warn("Dreams", `Plan returned no place steps for cluster "${cluster.sharedTheme}"`);
          await requeueItems(clusterItemIds, "plan returned no steps");
          totalRequeued += clusterItemIds.length;
          continue;
        }

        // CONFIDENCE CHECK
        if ((plan.overallConfidence ?? 1) < MIN_CONFIDENCE) {
 log.debug("Dreams", `Low confidence (${plan.overallConfidence}) for cluster "${cluster.sharedTheme}", re-queuing`);
          await requeueItems(clusterItemIds, `low confidence: ${plan.overallConfidence}`);
          totalRequeued += clusterItemIds.length;
          continue;
        }

        // EXECUTE BUILD STEPS
        const nameToIdMap = new Map();

        if (plan.buildSteps?.length) {
          for (const buildStep of plan.buildSteps) {
            if (rt.aborted) break;

            const { parsed: buildData } = await rt.runStep("tree:structure", {
              prompt: `Create this branch structure under the target node: ${JSON.stringify(buildStep.structure)}. Reason: ${buildStep.reason}`,
              modeCtx: { targetNodeId: buildStep.parentNodeId },
              input: JSON.stringify(buildStep.structure),
              treeContext: (data) => ({
                targetNodeId: buildStep.parentNodeId,
                stepResult: data ? "success" : "failed",
              }),
            });

            if (buildData?.operations) {
              for (const op of buildData.operations) {
                if (op.nodeName && op.nodeId) {
                  nameToIdMap.set(op.nodeName, op.nodeId);
                }
              }
            }
          }
        }

        // EXECUTE PLACE STEPS
        const placedIds = [];

        for (const placeStep of plan.placeSteps) {
          if (rt.aborted) break;

          // Resolve target node ID
          let targetNodeId = placeStep.targetNodeId;
          if (!targetNodeId && placeStep.targetNewNodeName) {
            targetNodeId = nameToIdMap.get(placeStep.targetNewNodeName);

            // Fallback: search tree for the node by name
            if (!targetNodeId) {
              const { parsed: navData } = await rt.runStep("tree:navigate", {
                prompt: `Find the node named "${placeStep.targetNewNodeName}" that was just created.`,
                input: `Navigate to "${placeStep.targetNewNodeName}"`,
              });
              if (navData?.targetNodeId) {
                targetNodeId = navData.targetNodeId;
              }
            }
          }

          if (!targetNodeId) {
 log.warn("Dreams", `Could not resolve target for item ${placeStep.itemId}, skipping`);
            continue;
          }

          // Get current prestige for the target node
          let prestige = 0;
          try {
            const targetNode = await Node.findById(targetNodeId).select("prestige").lean();
            prestige = targetNode?.prestige ?? 0;
          } catch {}

          const { parsed: noteData } = await rt.runStep("tree:notes", {
            prompt: `Create a note with this content: ${placeStep.noteContent}`,
            modeCtx: { targetNodeId, prestige },
            input: placeStep.noteContent?.slice(0, 200),
            treeContext: (data) => ({
              targetNodeId,
              stepResult: data ? "success" : "failed",
            }),
          });

          if (noteData) {
            placedIds.push({ itemId: placeStep.itemId, nodeId: targetNodeId });
          }
        }

        // MARK ITEMS AS PLACED
        if (placedIds.length) {
          const now = new Date();
          for (const { itemId, nodeId } of placedIds) {
            await ShortMemory.findByIdAndUpdate(itemId, {
              status: "placed",
              placedAt: now,
              placedNodeId: nodeId,
            });
          }
          totalPlaced += placedIds.length;
 log.debug("Dreams", `Placed ${placedIds.length}/${cluster.items.length} items for cluster "${cluster.sharedTheme}"`);
        }

        // Re-queue unplaced items
        const unplacedIds = clusterItemIds.filter(
          (id) => !placedIds.some((p) => p.itemId === id),
        );
        if (unplacedIds.length) {
          await requeueItems(unplacedIds, "placement step skipped or failed");
          totalRequeued += unplacedIds.length;
        }
      } catch (clusterErr) {
 log.error("Dreams", `Cluster "${cluster.sharedTheme}" failed:`, clusterErr.message);
        await requeueItems(clusterItemIds, clusterErr.message);
        totalRequeued += clusterItemIds.length;
      }
    }

    rt.setResult(`Placed ${totalPlaced}, re-queued ${totalRequeued} of ${items.length} items`, "drain:complete");
 log.verbose("Dreams", `Drain complete: ${totalPlaced} placed, ${totalRequeued} re-queued`);
  } catch (err) {
 log.error("Dreams", `Drain orchestration error for tree ${rootId}:`, err.message);
    rt.setError(err.message, "drain:complete");
  } finally {
    await rt.cleanup();
    releaseLock("drain", rootId);
  }

  return { sessionId: rt.sessionId };
}
