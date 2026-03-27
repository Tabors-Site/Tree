import express from "express";
import authenticate from "../../seed/middleware/authenticate.js";
import { sendOk, sendError, ERR } from "../../seed/protocol.js";
import { getMyceliumStatus, getRoutingLog, buildPeerProfile } from "./core.js";

const router = express.Router();

// GET /mycelium - status overview
router.get("/mycelium", authenticate, async (req, res) => {
  try {
    const status = await getMyceliumStatus();
    sendOk(res, status);
  } catch (err) {
    sendError(res, 500, ERR.INTERNAL, err.message);
  }
});

// GET /mycelium/routes - recent routing decisions
router.get("/mycelium/routes", authenticate, async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit || "50", 10), 200);
    const log = await getRoutingLog(limit);
    sendOk(res, { count: log.length, decisions: log });
  } catch (err) {
    sendError(res, 500, ERR.INTERNAL, err.message);
  }
});

// GET /mycelium/peers - connected lands with profiles
router.get("/mycelium/peers", authenticate, async (req, res) => {
  try {
    let LandPeer;
    try {
      LandPeer = (await import("../../canopy/models/landPeer.js")).default;
    } catch {
      return sendOk(res, { peers: [] });
    }

    const peers = await LandPeer.find({ status: { $in: ["active", "degraded"] } }).lean();
    const profiles = peers.map(p => {
      const profile = buildPeerProfile(p);
      return {
        domain: profile.domain,
        extensions: [...profile.extensions],
        status: profile.status,
        healthy: profile.healthy,
        lastSeen: profile.lastSeen,
      };
    });

    sendOk(res, { count: profiles.length, peers: profiles });
  } catch (err) {
    sendError(res, 500, ERR.INTERNAL, err.message);
  }
});

// GET /mycelium/health - per-peer health
router.get("/mycelium/health", authenticate, async (req, res) => {
  try {
    let LandPeer;
    try {
      LandPeer = (await import("../../canopy/models/landPeer.js")).default;
    } catch {
      return sendOk(res, { peers: [] });
    }

    const peers = await LandPeer.find().lean();
    const health = peers.map(p => ({
      domain: p.domain,
      status: p.status,
      consecutiveFailures: p.consecutiveFailures || 0,
      lastSuccess: p.lastSuccessAt,
      lastSeen: p.lastSeenAt,
      extensionCount: (p.extensions || []).length,
    }));

    sendOk(res, {
      total: health.length,
      active: health.filter(h => h.status === "active").length,
      degraded: health.filter(h => h.status === "degraded").length,
      unreachable: health.filter(h => h.status === "unreachable").length,
      peers: health,
    });
  } catch (err) {
    sendError(res, 500, ERR.INTERNAL, err.message);
  }
});

export default router;
