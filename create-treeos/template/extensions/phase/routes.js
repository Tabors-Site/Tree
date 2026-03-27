import express from "express";
import { sendOk, sendError, ERR } from "../../seed/protocol.js";
import authenticate from "../../seed/middleware/authenticate.js";
import { getPhaseState, computeCycleStats } from "./core.js";

const router = express.Router();

// GET /user/:userId/phase - Current phase and session stats
router.get("/user/:userId/phase", authenticate, async (req, res) => {
  try {
    const phaseMeta = await getPhaseState(req.params.userId);
    if (!phaseMeta) {
      return sendOk(res, {
        phase: null,
        message: "No phase data yet. Interact with a tree to start tracking.",
      });
    }

    sendOk(res, {
      currentPhase: phaseMeta.currentPhase || null,
      confidence: phaseMeta.phaseConfidence || 0,
      windowSize: (phaseMeta.window || []).length,
      recentInteractions: (phaseMeta.window || []).slice(-5).map(s => ({
        type: s.type,
        at: new Date(s.at).toISOString(),
      })),
    });
  } catch (err) {
    sendError(res, 500, ERR.INTERNAL, err.message);
  }
});

// GET /user/:userId/phase/history - Phase patterns over time
router.get("/user/:userId/phase/history", authenticate, async (req, res) => {
  try {
    const phaseMeta = await getPhaseState(req.params.userId);
    if (!phaseMeta?.history?.length) {
      return sendOk(res, { history: [], message: "No phase history yet." });
    }

    const history = phaseMeta.history.slice(-50).map(entry => ({
      phase: entry.phase,
      startAt: new Date(entry.startAt).toISOString(),
      endAt: entry.endAt ? new Date(entry.endAt).toISOString() : null,
      durationMinutes: entry.durationMs ? Math.round(entry.durationMs / 60000) : null,
      transitionFrom: entry.transitionFrom || null,
    }));

    sendOk(res, { history });
  } catch (err) {
    sendError(res, 500, ERR.INTERNAL, err.message);
  }
});

// GET /user/:userId/phase/cycle - Awareness vs attention ratio
router.get("/user/:userId/phase/cycle", authenticate, async (req, res) => {
  try {
    const phaseMeta = await getPhaseState(req.params.userId);
    if (!phaseMeta?.history?.length) {
      return sendOk(res, { cycle: null, message: "No phase history yet." });
    }

    const stats = computeCycleStats(phaseMeta.history);
    sendOk(res, {
      cycle: {
        awarenessPercent: stats.awareness,
        attentionPercent: stats.attention,
        scatteredPercent: stats.scattered,
        totalTrackedMinutes: Math.round(stats.total / 60000),
      },
    });
  } catch (err) {
    sendError(res, 500, ERR.INTERNAL, err.message);
  }
});

export default router;
