import express from "express";
import authenticate from "../../seed/middleware/authenticate.js";
import { sendOk, sendError, ERR } from "../../seed/protocol.js";
import Node from "../../seed/models/node.js";
import { getExtension } from "../loader.js";

const router = express.Router();

// GET /node/:nodeId/water - full picture at this position
router.get("/node/:nodeId/water", authenticate, async (req, res) => {
  try {
    const { nodeId } = req.params;
    const node = await Node.findById(nodeId).select("name metadata parent systemRole").lean();
    if (!node) return sendError(res, 404, ERR.NODE_NOT_FOUND, "Node not found");

    const meta = node.metadata instanceof Map
      ? Object.fromEntries(node.metadata)
      : (node.metadata || {});

    const picture = { nodeId, nodeName: node.name };

    // Perspective: what this node drinks
    const perspectiveExt = getExtension("perspective-filter");
    if (perspectiveExt?.exports?.resolvePerspective) {
      try {
        const perspective = await perspectiveExt.exports.resolvePerspective(node);
        picture.perspective = perspective || { accept: [], reject: [] };
      } catch {}
    }

    // Memory: who this node has talked to
    const memoryExt = getExtension("long-memory");
    if (memoryExt?.exports?.getMemory) {
      try {
        const memory = await memoryExt.exports.getMemory(nodeId);
        if (memory && memory.totalInteractions > 0) {
          picture.memory = {
            lastSeen: memory.lastSeen,
            lastStatus: memory.lastStatus,
            totalInteractions: memory.totalInteractions,
            recentSources: (memory.connections || []).slice(-5).map((c) => c.sourceId),
          };
        }
      } catch {}
    }

    // Codebook: compression stats
    if (meta.codebook) {
      const entries = {};
      for (const [uid, data] of Object.entries(meta.codebook)) {
        if (data?.dictionary && Object.keys(data.dictionary).length > 0) {
          entries[uid] = {
            dictionarySize: Object.keys(data.dictionary).length,
            notesSinceCompression: data.notesSinceCompression || 0,
            lastCompressed: data.lastCompressed,
          };
        }
      }
      if (Object.keys(entries).length > 0) picture.codebook = entries;
    }

    // Gaps: what this node is missing
    if (Array.isArray(meta.gaps) && meta.gaps.length > 0) {
      picture.gaps = meta.gaps
        .filter((g) => g.count > 0)
        .sort((a, b) => b.count - a.count)
        .map((g) => ({ namespace: g.namespace, count: g.count }));
    }

    // Flow: recent signals
    const flowExt = getExtension("flow");
    if (flowExt?.exports?.getFlowForPosition) {
      try {
        const flow = await flowExt.exports.getFlowForPosition(nodeId, 10);
        picture.flow = {
          scope: flow.scope,
          recentSignals: Object.keys(flow.results).length,
        };
      } catch {}
    }

    // Evolution: fitness
    if (meta.evolution) {
      picture.fitness = {
        notesWritten: meta.evolution.notesWritten || 0,
        visits: meta.evolution.visits || 0,
        cascades: (meta.evolution.cascadesOriginated || 0) + (meta.evolution.cascadesReceived || 0),
        lastActivity: meta.evolution.lastActivity,
      };
    }

    // Contradictions
    if (Array.isArray(meta.contradictions)) {
      const active = meta.contradictions.filter((c) => c.status === "active");
      if (active.length > 0) picture.contradictions = active.length;
    }

    // Compression
    if (meta.compress?.essence) {
      picture.compressed = { status: meta.compress.status, hasSummary: true };
    }

    sendOk(res, picture);
  } catch (err) {
    sendError(res, 500, ERR.INTERNAL, err.message);
  }
});

// GET /water/land - land-wide dashboard
router.get("/water/land", authenticate, async (req, res) => {
  try {
    const picture = {};

    // Pulse: land health
    const pulseExt = getExtension("pulse");
    if (pulseExt?.exports?.getLatestSnapshot) {
      try {
        const snapshot = await pulseExt.exports.getLatestSnapshot();
        if (snapshot) {
          picture.health = {
            failureRate: snapshot.failureRate,
            elevated: snapshot.elevated,
            signals: snapshot.signals,
            results: snapshot.results,
            lastUpdated: snapshot.timestamp,
            peers: snapshot.peers,
          };
        }
      } catch {}
    }

    // Gaps: land-wide aggregation
    const gapExt = getExtension("gap-detection");
    if (gapExt?.exports?.getGaps) {
      try {
        const roots = await Node.find({ rootOwner: { $ne: null }, systemRole: null })
          .select("_id").lean();

        const { getDescendantIds } = await import("../../seed/tree/treeFetch.js");
        const aggregated = {};

        for (const root of roots.slice(0, 50)) { // cap to prevent overload
          const nodeIds = await getDescendantIds(root._id);
          for (const nid of nodeIds) {
            const gaps = await gapExt.exports.getGaps(nid);
            for (const gap of gaps) {
              if (!aggregated[gap.namespace]) aggregated[gap.namespace] = 0;
              aggregated[gap.namespace] += gap.count;
            }
          }
        }

        const sorted = Object.entries(aggregated)
          .sort((a, b) => b[1] - a[1])
          .map(([namespace, count]) => ({ namespace, count }));

        if (sorted.length > 0) picture.gaps = sorted;
      } catch {}
    }

    // Flow stats
    const flowNode = await Node.findOne({ systemRole: "flow" }).select("_id").lean();
    if (flowNode) {
      const partitions = await Node.find({ parent: flowNode._id })
        .select("name metadata").sort({ name: -1 }).limit(7).lean();

      const today = new Date().toISOString().slice(0, 10);
      const stats = partitions.map((p) => {
        const results = p.metadata instanceof Map
          ? p.metadata.get("results") || {}
          : p.metadata?.results || {};
        return { date: p.name, signals: Object.keys(results).length };
      });

      picture.flow = {
        partitions: partitions.length,
        recentDays: stats,
        todaySignals: stats.find((s) => s.date === today)?.signals || 0,
      };
    }

    sendOk(res, picture);
  } catch (err) {
    sendError(res, 500, ERR.INTERNAL, err.message);
  }
});

export default router;
