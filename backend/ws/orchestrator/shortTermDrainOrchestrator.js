// ws/orchestrator/shortTermDrainOrchestrator.js
// Drains pending ShortMemory items into the tree.
// Pipeline: cluster → scout → plan → build → place.

import jwt from "jsonwebtoken";
import dotenv from "dotenv";

dotenv.config();

const JWT_SECRET = process.env.JWT_SECRET || "your_secret_key";

import { switchMode, processMessage, setRootId, getClientForUser, resolveRootLlmForMode, clearSession } from "../conversation.js";
import { trackChainStep, startAIChat, finalizeAIChat, setAiContributionContext, clearAiContributionContext } from "../aiChatTracker.js";
import { connectToMCP, closeMCPClient, MCP_SERVER_URL } from "../mcp.js";
import { buildDeepTreeSummary } from "../../core/treeFetch.js";
import { createSession, endSession, setSessionAbort, clearSessionAbort, SESSION_TYPES } from "../sessionRegistry.js";
import ShortMemory from "../../db/models/shortMemory.js";
import Node from "../../db/models/node.js";
import User from "../../db/models/user.js";

// ─────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────

const MAX_DRAIN_ATTEMPTS = 3;
const MIN_CONFIDENCE = 0.5;
const MAX_ITEMS_PER_RUN = 8;

const nullSocket = {
  emit: () => {},
  to: () => nullSocket,
  broadcast: { emit: () => {} },
};

// In-memory lock — prevents concurrent drains for the same tree
const activeDrains = new Set();

// ─────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────

function parseJsonSafe(text) {
  try {
    if (typeof text === "object" && text !== null) return text;
    const match = text.match(/\{[\s\S]*\}/);
    return match ? JSON.parse(match[0]) : null;
  } catch {
    return null;
  }
}

/**
 * Increment drainAttempts on items. Escalate any that hit MAX_DRAIN_ATTEMPTS.
 */
async function requeueItems(itemIds, reason) {
  if (!itemIds?.length) return;
  await ShortMemory.updateMany(
    { _id: { $in: itemIds } },
    { $inc: { drainAttempts: 1 } },
  );
  // Escalate items that just hit the limit
  await ShortMemory.updateMany(
    { _id: { $in: itemIds }, drainAttempts: { $gte: MAX_DRAIN_ATTEMPTS } },
    { status: "escalated" },
  );
  console.log(`🔄 Re-queued ${itemIds.length} items: ${reason}`);
}

// ─────────────────────────────────────────────────────────────────────────
// MAIN ORCHESTRATOR
// ─────────────────────────────────────────────────────────────────────────

/**
 * Drain all pending ShortMemory items for a given tree.
 *
 * @param {string} rootId — the tree root node ID
 */
export async function drainTree(rootId) {
  if (activeDrains.has(rootId)) {
    console.log(`⏭️ Drain already running for tree ${rootId}, skipping`);
    return { sessionId: null };
  }

  // ── Load pending items ───────────────────────────────────────────────
  const items = await ShortMemory.find({
    rootId,
    status: "pending",
    drainAttempts: { $lt: MAX_DRAIN_ATTEMPTS },
  })
    .sort({ createdAt: 1 })
    .limit(MAX_ITEMS_PER_RUN)
    .lean();

  if (!items.length) return { sessionId: null };

  // ── Resolve tree owner ───────────────────────────────────────────────
  const rootNode = await Node.findById(rootId).select("rootOwner name").lean();
  if (!rootNode?.rootOwner) {
    console.error(`❌ Drain: tree ${rootId} has no rootOwner`);
    return { sessionId: null };
  }
  const userId = rootNode.rootOwner;
  const user = await User.findById(userId).select("username").lean();
  const username = user?.username || "user";

  activeDrains.add(rootId);

  const visitorId = `drain:${rootId}`;
  const { sessionId } = createSession({
    userId,
    type: SESSION_TYPES.SHORT_TERM_DRAIN,
    description: `Short-term drain: ${rootNode.name || rootId}`,
    meta: { rootId, visitorId, itemCount: items.length },
  });
  const abort = new AbortController();
  setSessionAbort(sessionId, abort);

  let chainIndex = 1;
  let mainChatId = null;
  let finalizeArgs = { content: null, stopped: true, modeKey: "drain:complete" };

  // ── LLM provider ────────────────────────────────────────────────────
  let llmProvider;
  try {
    const modeConnectionId = await resolveRootLlmForMode(rootId, "tree:drain-cluster");
    const clientInfo = await getClientForUser(userId, "main", modeConnectionId);
    llmProvider = {
      isCustom: clientInfo.isCustom,
      model: clientInfo.model,
      connectionId: clientInfo.connectionId || null,
    };
  } catch {
    llmProvider = undefined;
  }

  // ── AI chat tracking ─────────────────────────────────────────────────
  const mainChat = await startAIChat({
    userId,
    sessionId,
    message: `Draining ${items.length} short-term items for tree "${rootNode.name}"`,
    source: "orchestrator",
    modeKey: "drain:start",
    llmProvider,
  });
  mainChatId = mainChat._id;
  setAiContributionContext(visitorId, sessionId, mainChatId);

  // ── MCP connection ───────────────────────────────────────────────────
  const internalJwt = jwt.sign({ userId, username, visitorId }, JWT_SECRET, { expiresIn: "1h" });
  await connectToMCP(MCP_SERVER_URL, visitorId, internalJwt);

  console.log(`🧠 Drain started: ${items.length} items for tree "${rootNode.name}" [${rootId.slice(0, 8)}]`);

  try {
    // ── Build tree summary ───────────────────────────────────────────
    const treeSummary = await buildDeepTreeSummary(rootId).catch(() => "");
    setRootId(visitorId, rootId);

    // ── Build item map for quick lookups ─────────────────────────────
    const itemMap = new Map(items.map((item) => [item._id, item]));

    // ════════════════════════════════════════════════════════════════
    // STEP 1: CLUSTER ANALYSIS
    // ════════════════════════════════════════════════════════════════

    switchMode(visitorId, "tree:drain-cluster", {
      username,
      userId,
      rootId,
      items,
      clearHistory: true,
    });

    const clusterStart = new Date();
    const clusterResult = await processMessage(
      visitorId,
      `Cluster these ${items.length} deferred items for tree "${rootNode.name}".`,
      { username, userId, rootId, signal: abort.signal, meta: { internal: true } },
    );
    const clusterEnd = new Date();

    const manifest = parseJsonSafe(clusterResult?.answer || clusterResult);
    if (!manifest?.clusters?.length) {
      console.error("❌ Drain: cluster analysis returned no clusters");
      await requeueItems(items.map((i) => i._id), "cluster analysis failed");
      finalizeArgs = { content: "Cluster analysis failed", stopped: false, modeKey: "drain:complete" };
      return { sessionId };
    }

    trackChainStep({
      userId,
      sessionId,
      rootChatId: mainChatId,
      chainIndex: chainIndex++,
      modeKey: "tree:drain-cluster",
      source: "orchestrator",
      input: `${items.length} items`,
      output: manifest,
      startTime: clusterStart,
      endTime: clusterEnd,
      llmProvider,
    });

    console.log(`📊 Clustered into ${manifest.clusters.length} cluster(s)`);

    // Attach full item objects to each cluster
    for (const cluster of manifest.clusters) {
      cluster.items = (cluster.itemIds || [])
        .map((id) => itemMap.get(id))
        .filter(Boolean);
    }

    let totalPlaced = 0;
    let totalRequeued = 0;

    // ════════════════════════════════════════════════════════════════
    // STEP 2-4: PER-CLUSTER PROCESSING
    // ════════════════════════════════════════════════════════════════

    for (const cluster of manifest.clusters) {
      if (abort.signal.aborted) break;
      if (!cluster.items.length) continue;

      const clusterItemIds = cluster.items.map((i) => i._id);

      try {
        // ── SCOUT ──────────────────────────────────────────────────
        switchMode(visitorId, "tree:drain-scout", {
          username,
          userId,
          rootId,
          cluster,
          treeSummary,
          clearHistory: true,
        });

        const scoutStart = new Date();
        const scoutResult = await processMessage(
          visitorId,
          `Scout placement locations for ${cluster.items.length} items about: ${cluster.sharedTheme}`,
          { username, userId, rootId, signal: abort.signal, meta: { internal: true } },
        );
        const scoutEnd = new Date();

        const scoutData = parseJsonSafe(scoutResult?.answer || scoutResult);
        if (!scoutData?.pins?.length) {
          console.warn(`⚠️ Scout found no pins for cluster "${cluster.sharedTheme}"`);
          await requeueItems(clusterItemIds, "scout found no locations");
          totalRequeued += clusterItemIds.length;
          continue;
        }

        trackChainStep({
          userId,
          sessionId,
          rootChatId: mainChatId,
          chainIndex: chainIndex++,
          modeKey: "tree:drain-scout",
          source: "orchestrator",
          input: cluster.sharedTheme,
          output: scoutData,
          startTime: scoutStart,
          endTime: scoutEnd,
          llmProvider,
        });

        // ── PLAN ───────────────────────────────────────────────────
        switchMode(visitorId, "tree:drain-plan", {
          username,
          userId,
          rootId,
          cluster,
          pins: scoutData.pins,
          clearHistory: true,
        });

        const planStart = new Date();
        const planResult = await processMessage(
          visitorId,
          `Plan placement for ${cluster.items.length} items using ${scoutData.pins.length} scouted locations.`,
          { username, userId, rootId, signal: abort.signal, meta: { internal: true } },
        );
        const planEnd = new Date();

        const plan = parseJsonSafe(planResult?.answer || planResult);
        if (!plan?.placeSteps?.length) {
          console.warn(`⚠️ Plan returned no place steps for cluster "${cluster.sharedTheme}"`);
          await requeueItems(clusterItemIds, "plan returned no steps");
          totalRequeued += clusterItemIds.length;
          continue;
        }

        trackChainStep({
          userId,
          sessionId,
          rootChatId: mainChatId,
          chainIndex: chainIndex++,
          modeKey: "tree:drain-plan",
          source: "orchestrator",
          input: cluster.sharedTheme,
          output: plan,
          startTime: planStart,
          endTime: planEnd,
          llmProvider,
        });

        // ── CONFIDENCE CHECK ───────────────────────────────────────
        if ((plan.overallConfidence ?? 1) < MIN_CONFIDENCE) {
          console.log(`⏸️ Low confidence (${plan.overallConfidence}) for cluster "${cluster.sharedTheme}" — re-queuing`);
          await requeueItems(clusterItemIds, `low confidence: ${plan.overallConfidence}`);
          totalRequeued += clusterItemIds.length;
          continue;
        }

        // ── EXECUTE BUILD STEPS ────────────────────────────────────
        const nameToIdMap = new Map();

        if (plan.buildSteps?.length) {
          for (const buildStep of plan.buildSteps) {
            if (abort.signal.aborted) break;

            switchMode(visitorId, "tree:structure", {
              username,
              userId,
              rootId,
              targetNodeId: buildStep.parentNodeId,
              clearHistory: true,
            });

            const buildStart = new Date();
            const buildResult = await processMessage(
              visitorId,
              `Create this branch structure under the target node: ${JSON.stringify(buildStep.structure)}. Reason: ${buildStep.reason}`,
              { username, userId, rootId, signal: abort.signal, meta: { internal: true } },
            );
            const buildEnd = new Date();

            const buildData = parseJsonSafe(buildResult?.answer || buildResult);
            if (buildData?.operations) {
              for (const op of buildData.operations) {
                if (op.nodeName && op.nodeId) {
                  nameToIdMap.set(op.nodeName, op.nodeId);
                }
              }
            }

            trackChainStep({
              userId,
              sessionId,
              rootChatId: mainChatId,
              chainIndex: chainIndex++,
              modeKey: "tree:structure",
              source: "orchestrator",
              input: JSON.stringify(buildStep.structure),
              output: buildData,
              startTime: buildStart,
              endTime: buildEnd,
              llmProvider,
              treeContext: {
                targetNodeId: buildStep.parentNodeId,
                stepResult: buildData ? "success" : "failed",
              },
            });
          }
        }

        // ── EXECUTE PLACE STEPS ────────────────────────────────────
        const placedIds = [];

        for (const placeStep of plan.placeSteps) {
          if (abort.signal.aborted) break;

          // Resolve target node ID
          let targetNodeId = placeStep.targetNodeId;
          if (!targetNodeId && placeStep.targetNewNodeName) {
            targetNodeId = nameToIdMap.get(placeStep.targetNewNodeName);

            // Fallback: search tree for the node by name
            if (!targetNodeId) {
              switchMode(visitorId, "tree:navigate", {
                username,
                userId,
                rootId,
                clearHistory: true,
              });
              const navResult = await processMessage(
                visitorId,
                `Find the node named "${placeStep.targetNewNodeName}" that was just created.`,
                { username, userId, rootId, signal: abort.signal, meta: { internal: true } },
              );
              const navData = parseJsonSafe(navResult?.answer || navResult);
              if (navData?.targetNodeId) {
                targetNodeId = navData.targetNodeId;
              }
            }
          }

          if (!targetNodeId) {
            console.warn(`⚠️ Could not resolve target for item ${placeStep.itemId}, skipping`);
            continue;
          }

          // Get current prestige for the target node
          let prestige = 0;
          try {
            const targetNode = await Node.findById(targetNodeId).select("prestige").lean();
            prestige = targetNode?.prestige ?? 0;
          } catch {}

          switchMode(visitorId, "tree:notes", {
            username,
            userId,
            rootId,
            targetNodeId,
            prestige,
            clearHistory: true,
          });

          const noteStart = new Date();
          const noteResult = await processMessage(
            visitorId,
            `Create a note with this content: ${placeStep.noteContent}`,
            { username, userId, rootId, signal: abort.signal, meta: { internal: true } },
          );
          const noteEnd = new Date();

          const noteData = parseJsonSafe(noteResult?.answer || noteResult);

          trackChainStep({
            userId,
            sessionId,
            rootChatId: mainChatId,
            chainIndex: chainIndex++,
            modeKey: "tree:notes",
            source: "orchestrator",
            input: placeStep.noteContent?.slice(0, 200),
            output: noteData,
            startTime: noteStart,
            endTime: noteEnd,
            llmProvider,
            treeContext: {
              targetNodeId,
              stepResult: noteData ? "success" : "failed",
            },
          });

          if (noteData) {
            placedIds.push({ itemId: placeStep.itemId, nodeId: targetNodeId });
          }
        }

        // ── MARK ITEMS AS PLACED ───────────────────────────────────
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
          console.log(`✅ Placed ${placedIds.length}/${cluster.items.length} items for cluster "${cluster.sharedTheme}"`);
        }

        // Re-queue any items that weren't placed
        const unplacedIds = clusterItemIds.filter(
          (id) => !placedIds.some((p) => p.itemId === id),
        );
        if (unplacedIds.length) {
          await requeueItems(unplacedIds, "placement step skipped or failed");
          totalRequeued += unplacedIds.length;
        }
      } catch (clusterErr) {
        console.error(`❌ Cluster "${cluster.sharedTheme}" failed:`, clusterErr.message);
        await requeueItems(clusterItemIds, clusterErr.message);
        totalRequeued += clusterItemIds.length;
      }
    }

    finalizeArgs = {
      content: `Placed ${totalPlaced}, re-queued ${totalRequeued} of ${items.length} items`,
      stopped: false,
      modeKey: "drain:complete",
    };

    console.log(`🧠 Drain complete: ${totalPlaced} placed, ${totalRequeued} re-queued`);
  } catch (err) {
    console.error(`❌ Drain orchestration error for tree ${rootId}:`, err.message);
    finalizeArgs = { content: err.message, stopped: abort.signal.aborted, modeKey: "drain:complete" };
  } finally {
    if (mainChatId) {
      finalizeAIChat({ chatId: mainChatId, ...finalizeArgs }).catch((e) =>
        console.error(`❌ Failed to finalize drain session chat:`, e.message),
      );
    }
    clearAiContributionContext(visitorId);
    clearSessionAbort(sessionId);
    endSession(sessionId);
    closeMCPClient(visitorId);
    clearSession(visitorId);
    activeDrains.delete(rootId);
  }

  return { sessionId };
}
