import log from "../../seed/log.js";
import express from "express";
import { sendOk, sendError, ERR } from "../../seed/protocol.js";
import authenticate, { authenticateOptional } from "../../seed/middleware/authenticate.js";
import {
  createUnderstandingRun,
  findOrCreateUnderstandingRun,
} from "./core.js";
import UnderstandingRun from "./understandingRun.js";
import UnderstandingNode from "./understandingNode.js";
import { getNotes } from "../../seed/tree/notes.js";
import { userHasLlm } from "../../seed/ws/conversation.js";
import { orchestrateUnderstanding } from "./pipeline.js";
import { getSessionsForUser, endSession, SESSION_TYPES } from "../../seed/ws/sessionRegistry.js";
import { renderUnderstandingRun, renderUnderstandingNode, renderUnderstandingsList, renderRunNodeView, buildRunCards, buildRunNodeInputsHtml } from "./html.js";
import { getExtension } from "../loader.js";

// Models wired from init via setModels
let Node = null;
let Contribution = null;
export function setModels(models) {
  Node = models.Node;
  Contribution = models.Contribution;
}

const router = express.Router();

function buildQueryString(req) {
  const allowedParams = ["token", "html"];

  const filtered = Object.entries(req.query)
    .filter(([key]) => allowedParams.includes(key))
    .map(([key, val]) =>
      val === "" ? key : `${key}=${encodeURIComponent(val)}`,
    )
    .join("&");

  return filtered ? `?${filtered}` : "";
}

router.post("/root/:nodeId/understandings", authenticate, async (req, res) => {
  try {
    const { nodeId } = req.params;
    const { perspective = "general", incremental = false } = req.body;
    const userId = req.userId;

    const rootNode = await Node.findById(nodeId).lean();
    if (!rootNode) {
      return sendError(res, 404, ERR.NODE_NOT_FOUND, "Root node not found");
    }

    // Check LLM access — tree owner needs an LLM or root must have one assigned
    const hasUserLlm = await userHasLlm(userId);
    const hasRootLlm = !!(rootNode.llmDefault && rootNode.llmDefault !== "none");
    if (!hasUserLlm && !hasRootLlm) {
      return sendError(res, 503, ERR.LLM_NOT_CONFIGURED, "No LLM connection. Visit /setup to set one up.");
    }

    const result = incremental
      ? await findOrCreateUnderstandingRun(nodeId, userId, perspective)
      : await createUnderstandingRun(nodeId, userId, perspective);
    if ("html" in req.query) {
      return res.redirect(
        `/api/v1/root/${nodeId}/understandings/run/${
          result.understandingRunId
        }?token=${req.query.token ?? ""}&html`,
      );
    }
    return sendOk(res, {
      rootNodeId: nodeId,
      ...result,
    }, 201);
  } catch (err) {
 log.error("Understanding", "Error creating understanding run:", err);
    return sendError(res, 500, ERR.INTERNAL, err.message);
  }
});

router.get(
  "/root/:nodeId/understandings/run/:runId",
  authenticateOptional,
  async (req, res) => {
    try {
      const { runId, nodeId } = req.params;
      const qs = buildQueryString(req);

      const run = await UnderstandingRun.findById(runId).lean();
      if (!run) {
        return sendError(res, 404, ERR.NODE_NOT_FOUND, "UnderstandingRun not found");
      }

      const topology = new Map(
        Object.entries(run.topology || {}).map(([k, v]) => [String(k), v]),
      );

      const uNodeIds = Object.values(run.nodeMap ?? {}).map(String);

      const nodes = await UnderstandingNode.find({
        _id: { $in: uNodeIds },
      })
        .select("_id realNodeId perspectiveStates")
        .lean();

      const byId = new Map(nodes.map((n) => [String(n._id), n]));

      // Load real node names for display
      const realNodeIds = nodes.map((n) => n.realNodeId);
      const realNodes = await Node.find({ _id: { $in: realNodeIds } })
        .select("_id name")
        .lean();
      const realNameById = new Map(
        realNodes.map((n) => [String(n._id), n.name]),
      );

      // Safe perspectiveStates accessor
      const getPS = (node, rid) => {
        const ps = node?.perspectiveStates;
        if (!ps) return null;
        if (ps instanceof Map) return ps.get(rid) || ps.get(String(rid));
        return ps[rid] || ps[String(rid)] || null;
      };

      const ridStr = String(run._id);

      // Completion check
      const completed = {};
      for (const node of nodes) {
        const topo = topology.get(String(node._id));
        const state = getPS(node, ridStr);
        completed[node._id] =
          !!state && !!topo && state.currentLayer >= topo.mergeLayer;
      }

      // Dirty node detection — compare contribution snapshots to current counts
      const contribCounts = await Contribution.aggregate([
        {
          $match: {
            nodeId: { $in: realNodeIds },
            action: { $ne: "understanding" },
          },
        },
        { $group: { _id: "$nodeId", count: { $sum: 1 } } },
      ]);
      const countMap = new Map(contribCounts.map((c) => [c._id, c.count]));

      const dirtyNodes = {};
      let dirtyCount = 0;
      for (const node of nodes) {
        const state = getPS(node, ridStr);
        const currentCount = countMap.get(node.realNodeId) || 0;
        const storedCount = state?.contributionSnapshot;
        const isDirty =
          !state ||
          storedCount === null ||
          storedCount === undefined ||
          storedCount !== currentCount;
        dirtyNodes[node._id] = isDirty;
        if (isDirty) dirtyCount++;
      }

      // Propagate dirty status up the parent chain
      for (const [uNodeId, isDirty] of Object.entries(dirtyNodes)) {
        if (!isDirty) continue;
        let parentId = topology.get(String(uNodeId))?.parent;
        while (parentId) {
          if (dirtyNodes[parentId]) break; // already dirty, ancestors will be too
          dirtyNodes[parentId] = true;
          dirtyCount++;
          parentId = topology.get(String(parentId))?.parent;
        }
      }

      // JSON mode
      const wantHtml = Object.prototype.hasOwnProperty.call(req.query, "html");
      if (!wantHtml || !getExtension("html-rendering")) {
        return sendOk(res, {
          understandingRunId: run._id,
          rootNodeId: run.rootNodeId,
          perspective: run.perspective,
          maxDepth: run.maxDepth,
          status: run.status || "completed",
          createdAt: run.createdAt,
          lastCompletedAt: run.lastCompletedAt || null,
          encodingHistory: run.encodingHistory || [],
          nodeMap: run.nodeMap ?? {},
          completed,
          dirtyNodes,
          dirtyCount,
          nodes,
          topology: run.topology,
        });
      }

      // Build tree
      const buildTree = (uNodeId) => {
        const node = byId.get(String(uNodeId));
        const topo = topology.get(String(uNodeId));
        if (!node || !topo) return null;

        const state = getPS(node, ridStr);

        return {
          ...node,
          name: realNameById.get(String(node.realNodeId)) || "Untitled",
          depthFromRoot: topo.depthFromRoot,
          mergeLayer: topo.mergeLayer,
          childCount: topo.children.length,
          encoding: state?.encoding || "",
          layer: state?.currentLayer ?? "-",
          childNodes: topo.children.map(buildTree).filter(Boolean),
        };
      };

      const rootEntry = [...topology.entries()].find(
        ([, topo]) => topo.parent === null,
      );

      let rootFinalEncoding = null;
      let rootIsCompleted = false;

      if (rootEntry) {
        const rootUNodeId = rootEntry[0];
        rootIsCompleted = !!completed[rootUNodeId];
        const rootNode = byId.get(String(rootUNodeId));
        const rootState = getPS(rootNode, ridStr);
        if (rootState?.encoding) rootFinalEncoding = rootState.encoding;
      }

      // Previous final encoding from encoding history (last completed snapshot)
      const previousFinalEncoding =
        run.encodingHistory?.length > 0
          ? run.encodingHistory[run.encodingHistory.length - 1].encoding
          : null;

      const tree = rootEntry ? buildTree(rootEntry[0]) : null;

      // Progress
      const totalNodes = nodes.length;
      const completedCount = Object.values(completed).filter(Boolean).length;
      const progressPercent =
        totalNodes > 0 ? Math.round((completedCount / totalNodes) * 100) : 0;

      const createdDate = new Date(run.createdAt).toLocaleString();

      return res.send(
        renderUnderstandingRun({
          run,
          qs,
          nodes,
          completed,
          dirtyNodes,
          dirtyCount,
          totalNodes,
          completedCount,
          progressPercent,
          rootFinalEncoding,
          previousFinalEncoding,
          rootIsCompleted,
          tree,
          createdDate,
        }),
      );
    } catch (err) {
 log.error("Understanding", "Error fetching UnderstandingRun:", err);
      return sendError(res, 500, ERR.INTERNAL, err.message);
    }
  },
);

router.get(
  "/root/:nodeId/understandings/:understandingNodeId",
  authenticateOptional,
  async (req, res) => {
    try {
      const { understandingNodeId, nodeId } = req.params;
      const { runId } = req.query;

      const uNode =
        await UnderstandingNode.findById(understandingNodeId).lean();
      if (!uNode) {
        return sendError(res, 404, ERR.NODE_NOT_FOUND, "UnderstandingNode not found");
      }

      const realNode = await Node.findById(uNode.realNodeId)
        .select("name metadata")
        .lean();

      const _pMeta1 = realNode?.metadata instanceof Map ? realNode.metadata.get("prestige") : realNode?.metadata?.prestige;
      const realNodePrestige = _pMeta1?.current || 0;

      let run = null;
      let structure = null;

      if (runId) {
        run = await UnderstandingRun.findById(runId).lean();
        if (!run) {
          return sendError(res, 404, ERR.NODE_NOT_FOUND, "UnderstandingRun not found");
        }

        const topo = run.topology?.[understandingNodeId];
        if (topo) {
          structure = {
            depthFromRoot: topo.depthFromRoot,
            mergeLayer: topo.mergeLayer,
            childrenCount: topo.children.length,
          };
        }
      }

      const notesResult = await getNotes({
        nodeId: realNode._id,
      });

      const encodingHistory = Object.entries(uNode.perspectiveStates || {}).map(
        ([stateRunId, state]) => {
          const isCurrentRun = runId && stateRunId === runId;
          const isCompleted =
            run &&
            run.topology?.[understandingNodeId] &&
            state.currentLayer === run.topology[understandingNodeId].mergeLayer;

          return {
            runId: stateRunId,
            perspective: state.perspective,
            currentLayer: state.currentLayer,
            encoding: state.encoding,
            updatedAt: state.updatedAt,
            isCurrentRun,
            isCompleted,
          };
        },
      );

      const data = {
        understandingNodeId: uNode._id,
        realNode: {
          id: uNode.realNodeId,
          name: realNode?.name ?? "Unknown",
        },
        runContext: run
          ? {
              runId: run._id,
              perspective: run.perspective,
              structure,
            }
          : null,
        encodingHistory,
        createdAt: uNode.createdAt,
        notesToBeCompressed: (notesResult?.notes ?? []).map((n) => ({
          content: n.content,
          username: n.username,
          createdAt: n.createdAt,
        })),
      };

      const wantHtml = Object.prototype.hasOwnProperty.call(req.query, "html");
      if (!wantHtml || !getExtension("html-rendering")) {
        return sendOk(res, data);
      }

      const qs = buildQueryString(req);
      const hasEncodings = encodingHistory.length > 0;

      const backTreeUrl = `/api/v1/root/${nodeId}${qs}`;
      const backUnderstandingsUrl = `/api/v1/root/${nodeId}/understandings${qs}`;
      const realNodeUrl = `/api/v1/node/${data.realNode.id}${qs}`;

      return res.send(
        renderUnderstandingNode({
          data,
          nodeId,
          qs,
          encodingHistory,
          hasEncodings,
          backTreeUrl,
          backUnderstandingsUrl,
          realNodeUrl,
        }),
      );
    } catch (err) {
 log.error("Understanding", "Error fetching UnderstandingNode:", err);
      return sendError(res, 500, ERR.INTERNAL, err.message);
    }
  },
);
router.get("/root/:nodeId/understandings", authenticateOptional, async (req, res) => {
  try {
    const { nodeId } = req.params;
    const queryString = buildQueryString(req);

    const root = await Node.findById(nodeId).select("_id name userId").lean();
    if (!root) {
      return sendError(res, 404, ERR.TREE_NOT_FOUND, "Root not found");
    }

    const runs = await UnderstandingRun.find({ rootNodeId: nodeId })
      .sort({ createdAt: -1 })
      .lean();

    const data = {
      rootNodeId: root._id,
      rootName: root.name,
      understandings: runs.map((r) => ({
        _id: r._id,
        perspective: r.perspective,
        maxDepth: r.maxDepth,
        createdAt: r.createdAt,
      })),
    };

    const wantHtml = "html" in req.query;
    if (!wantHtml || !getExtension("html-rendering")) {
      return sendOk(res, data);
    }

    const runCards = buildRunCards({
      understandings: data.understandings,
      nodeId,
      queryString,
    });

    return res.send(
      renderUnderstandingsList({
        data,
        nodeId,
        queryString,
        runCards,
      }),
    );
  } catch (err) {
 log.error("Understanding", "Error fetching understandings:", err);
    sendError(res, 500, ERR.INTERNAL, err.message);
  }
});

router.get(
  "/root/:nodeId/understandings/run/:runId/:understandingNodeId",
  authenticateOptional,
  async (req, res) => {
    try {
      const { runId, understandingNodeId, nodeId } = req.params;
      const qs = buildQueryString(req);

      const root = await Node.findById(nodeId).select("_id name userId").lean();
      if (!root) {
        return sendError(res, 404, ERR.TREE_NOT_FOUND, "Root not found");
      }

      const uNode =
        await UnderstandingNode.findById(understandingNodeId).lean();
      if (!uNode) {
        return sendError(res, 404, ERR.NODE_NOT_FOUND, "UnderstandingNode not found");
      }

      const realNode = await Node.findById(uNode.realNodeId)
        .select("name metadata")
        .lean();

      const _pMeta2 = realNode?.metadata instanceof Map ? realNode.metadata.get("prestige") : realNode?.metadata?.prestige;
      const realNodePrestige2 = _pMeta2?.current || 0;

      const run = await UnderstandingRun.findById(runId).lean();
      if (!run) {
        return sendError(res, 404, ERR.NODE_NOT_FOUND, "UnderstandingRun not found");
      }

      // Safe perspectiveStates accessor
      const getPS = (node, rid) => {
        const ps = node?.perspectiveStates;
        if (!ps) return null;
        if (ps instanceof Map) return ps.get(rid) || ps.get(String(rid));
        return ps[rid] || ps[String(rid)] || null;
      };

      const ridStr = String(runId);
      const state = getPS(uNode, ridStr);
      const finalMessage = state?.encoding ?? null;
      const isCompleted = Boolean(finalMessage);

      /* =========================
         Determine leaf vs merge from topology
         ========================= */
      const topology = new Map(
        Object.entries(run.topology || {}).map(([k, v]) => [String(k), v]),
      );
      const topo = topology.get(String(understandingNodeId));
      const childIds = topo?.children || [];
      const isLeaf = childIds.length === 0;

      /* =========================
         Leaf: load notes
         Merge: load child encodings
         ========================= */
      let chats = [];
      let childEncodings = [];

      if (isLeaf) {
        const notesResult = await getNotes({
          nodeId: realNode._id,
        });

        chats = (notesResult?.notes ?? []).map((n) => ({
          role: n.username === "assistant" ? "assistant" : "user",
          content: n.content,
          username: n.username,
          createdAt: n.createdAt,
        }));
      } else {
        // Load child understanding nodes
        const childUNodes = await UnderstandingNode.find({
          _id: { $in: childIds.map(String) },
        }).lean();

        // Load their real node names
        const childRealIds = childUNodes.map((n) => n.realNodeId);
        const childRealNodes = await Node.find({ _id: { $in: childRealIds } })
          .select("_id name")
          .lean();
        const childNameById = new Map(
          childRealNodes.map((n) => [String(n._id), n.name]),
        );

        childEncodings = childUNodes.map((child) => {
          const childState = getPS(child, ridStr);
          const childTopo = topology.get(String(child._id));
          return {
            understandingNodeId: child._id,
            realNodeId: child.realNodeId,
            name: childNameById.get(String(child.realNodeId)) || "Untitled",
            encoding: childState?.encoding ?? null,
            currentLayer: childState?.currentLayer ?? null,
            mergeLayer: childTopo?.mergeLayer ?? null,
            isComplete:
              childState &&
              childTopo &&
              childState.currentLayer >= childTopo.mergeLayer,
          };
        });
      }

      /* =========================
         JSON Response
         ========================= */
      const data = {
        runId,
        understandingNodeId,
        realNode: {
          id: uNode.realNodeId,
          name: realNode?.name ?? "Unknown",
        },
        perspective: run.perspective,
        finalMessage,
        isLeaf,
        chats: isLeaf ? chats : [],
        childEncodings: isLeaf ? [] : childEncodings,
        isCompleted,
        updatedAt: state?.updatedAt ?? null,
      };

      const wantHtml = Object.prototype.hasOwnProperty.call(req.query, "html");
      if (!wantHtml || !getExtension("html-rendering")) {
        return sendOk(res, data);
      }

      /* =========================
         HTML Rendering
         ========================= */
      const backTreeUrl = `/api/v1/root/${nodeId}${qs}`;
      const backRunUrl = `/api/v1/root/${nodeId}/understandings/run/${runId}${qs}`;

      const { inputsHtml, inputsSectionTitle } = buildRunNodeInputsHtml({
        isLeaf,
        isCompleted,
        chats,
        childEncodings,
        nodeId,
        runId,
        qs,
      });

      return res.send(
        renderRunNodeView({
          data,
          nodeId,
          runId,
          qs,
          isLeaf,
          isCompleted,
          childEncodings,
          chats,
          finalMessage,
          inputsHtml,
          inputsSectionTitle,
          backTreeUrl,
          backRunUrl,
        }),
      );
    } catch (err) {
 log.error("Understanding", "Error fetching run node view:", err);
      return sendError(res, 500, ERR.INTERNAL, err.message);
    }
  },
);

// ─────────────────────────────────────────────────────────────────────────
// Orchestration endpoints (moved from routes/api/orchestrate.js)
// ─────────────────────────────────────────────────────────────────────────

router.post("/root/:nodeId/understandings/run/:runId/orchestrate", authenticate, async (req, res) => {
  const { nodeId, runId } = req.params;
  const userId = req.userId;
  const username = req.username;
  const fromSite = req.body?.source === "user";

  const rootNode = await Node.findById(nodeId).select("llmDefault metadata").lean();
  const hasRootLlm = !!(rootNode?.llmDefault && rootNode.llmDefault !== "none");
  if (!hasRootLlm && !(await userHasLlm(userId))) {
    return sendError(res, 503, ERR.LLM_NOT_CONFIGURED, "No LLM connection. Visit /setup to set one up.");
  }

  try {
    const result = await orchestrateUnderstanding({ rootId: nodeId, userId, username, runId, fromSite });
    if ("html" in req.query && result.success) {
      return res.redirect(`/api/v1/root/${nodeId}/understandings/run/${runId}?token=${req.query.token ?? ""}&html`);
    }
    return sendOk(res, result);
  } catch (err) {
 log.error("Understanding", "Understanding orchestration error:", err.message);
    return sendError(res, 500, ERR.INTERNAL, err.message);
  }
});

router.post("/root/:nodeId/understandings/run/:runId/stop", authenticate, async (req, res) => {
  const { runId } = req.params;
  const userId = req.userId;
  const sessions = getSessionsForUser(userId);
  const match = sessions.find((s) => s.type === SESSION_TYPES.UNDERSTANDING_ORCHESTRATE && s.meta?.runId === runId);
  if (!match) return sendError(res, 404, ERR.NODE_NOT_FOUND, "No active session found for this run");
  endSession(match.sessionId);
  return sendOk(res);
});

export default router;
