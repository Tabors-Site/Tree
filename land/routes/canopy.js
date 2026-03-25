import log from "../seed/log.js";
import { sendOk, sendError, ERR, NODE_STATUS } from "../seed/protocol.js";
import express from "express";
import { getLandInfoPayload, getLandIdentity, signCanopyToken } from "../canopy/identity.js";
import {
  registerPeer,
  removePeer,
  blockPeer,
  unblockPeer,
  getAllPeers,
  getPeerByDomain,
  getPeerBaseUrl,
  runHeartbeat,
} from "../canopy/peers.js";
import {
  addCanopyHeaders,
  authenticateCanopy,
  checkRateLimit as checkCanopyRateLimit,
} from "../canopy/middleware.js";
import {
  validateCanopyRequest,
  isCompatibleVersion,
} from "../canopy/protocol.js";
import { proxyToRemoteLand } from "../canopy/proxy.js";
import {
  queueCanopyEvent,
  getPendingEventCount,
  getFailedEvents,
  retryEvent,
} from "../canopy/events.js";
import User from "../seed/models/user.js";
import RemoteUser from "../canopy/models/remoteUser.js";
import LandPeer from "../canopy/models/landPeer.js";
import Node from "../seed/models/node.js";
import authenticate from "../seed/middleware/authenticate.js";
import { getExtension } from "../extensions/loader.js";
import { lookupLandByDomain, searchLands, searchPublicTrees } from "../canopy/horizon.js";
import { isPrivateHost } from "../canopy/security.js";
import { getUserMeta } from "../seed/tree/userMetadata.js";
import { addContributor } from "../seed/tree/ownership.js";


const router = express.Router();

// Canopy-specific body size limit (100KB). Prevents peers from sending huge payloads.
router.use(express.json({ limit: "100kb" }));

/**
 * Middleware: Require admin (god tier) for canopy admin endpoints.
 * Must be used after authenticate.
 */
async function requireAdmin(req, res, next) {
  try {
    const user = await User.findById(req.userId).select("isAdmin").lean();
    if (!user || !user.isAdmin) {
      return sendError(res, 403, ERR.FORBIDDEN, "Requires admin permissions");
    }
    next();
  } catch (err) {
    sendError(res, 500, ERR.INTERNAL, "Failed to verify admin status");
  }
}

// Simple IP-based rate limiter for unauthenticated endpoints
const ipRateWindows = new Map();
const IP_WINDOW_MS = 60 * 1000;
function checkIpRate(ip, maxPerMinute) {
  const now = Date.now();
  const w = ipRateWindows.get(ip);
  if (!w || now - w.start > IP_WINDOW_MS) {
    ipRateWindows.set(ip, { start: now, count: 1 });
    return true;
  }
  w.count += 1;
  return w.count <= maxPerMinute;
}
setInterval(() => {
  const now = Date.now();
  for (const [k, w] of ipRateWindows) {
    if (now - w.start > IP_WINDOW_MS * 2) ipRateWindows.delete(k);
  }
}, IP_WINDOW_MS * 5);

// All canopy routes get canopy response headers
router.use("/canopy", addCanopyHeaders);

// ============================================================
// PUBLIC CANOPY ENDPOINTS (no auth required)
// ============================================================

/**
 * GET /canopy/info
 * Returns this land's public identity and capabilities.
 * Used by other lands for discovery, peering, and heartbeat.
 */
router.get("/canopy/info", (req, res) => {
  sendOk(res, getLandInfoPayload());
});

/**
 * GET /canopy/redirect
 * If this land has moved domains, return the new domain.
 * Used by peers during heartbeat to auto-update.
 */
router.get("/canopy/redirect", (req, res) => {
  const redirectDomain = process.env.LAND_REDIRECT_TO || null;
  if (redirectDomain) {
    return sendOk(res, {
      redirect: true,
      newDomain: redirectDomain,
      permanent: true,
    });
  }
  sendOk(res, { redirect: false });
});

/**
 * GET /canopy/user/:username
 * Resolve a local user by username.
 * Used by remote lands to look up users for cross-land invites.
 */
router.get("/canopy/user/:username", authenticateCanopy, async (req, res) => {
  try {
    const user = await User.findOne({
      username: req.params.username,
      isRemote: { $ne: true },
    })
      .select("_id username")
      .lean();

    if (!user) {
      return sendError(res, 404, ERR.USER_NOT_FOUND, "User not found on this land");
    }

    sendOk(res, {
      userId: user._id,
      username: user.username,
      landDomain: getLandIdentity().domain,
    });
  } catch (err) {
    sendError(res, 500, ERR.INTERNAL, err.message);
  }
});

/**
 * GET /canopy/public-trees
 * List public trees on this land.
 * Supports pagination and search.
 */
router.get("/canopy/public-trees", async (req, res) => {
  try {
    const { q, page = 1 } = req.query;
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
    const skip = (Math.max(1, parseInt(page)) - 1) * limit;

    const query = {
      rootOwner: { $nin: [null, "SYSTEM"] },
      "versions.0.status": "active",
      visibility: "public",
    };

    if (q) {
      const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      query.name = { $regex: escaped, $options: "i" };
    }

    const trees = await Node.find(query)
      .select("_id name rootOwner llmAssignments")
      .skip(skip)
      .limit(parseInt(limit))
      .lean();

    const identity = getLandIdentity();

    const results = await Promise.all(
      trees.map(async (tree) => {
        const owner = await User.findById(tree.rootOwner)
          .select("username")
          .lean();
        return {
          rootId: tree._id,
          name: tree.name || "",
          ownerUsername: owner?.username || "unknown",
          landDomain: identity.domain,
          queryAvailable: !!(tree.llmDefault && tree.llmDefault !== "none"),
        };
      })
    );

    sendOk(res, { trees: results, page: parseInt(page) });
  } catch (err) {
    sendError(res, 500, ERR.INTERNAL, err.message);
  }
});

/**
 * POST /canopy/peer/register
 * Called by a remote land to introduce itself.
 * This is the receiving side of peer registration.
 */
router.post("/canopy/peer/register", async (req, res) => {
  try {
    const ip = req.ip || req.connection?.remoteAddress || "unknown";
    if (!checkIpRate(`register:${ip}`, 5)) {
      return sendError(res, 429, ERR.RATE_LIMITED, "Rate limit exceeded");
    }

    const { landId, domain, publicKey, protocolVersion, name, baseUrl } = req.body;

    if (!landId || !domain || !publicKey) {
      return sendError(res, 400, ERR.INVALID_INPUT, "Missing required fields: landId, domain, publicKey");
    }

    if (!isCompatibleVersion(protocolVersion)) {
      return sendError(res, 400, ERR.INVALID_INPUT, `Incompatible protocol version: ${protocolVersion}`);
    }

    // SECURITY: Verify the sender actually controls the claimed domain.
    const verifyUrl = baseUrl || (domain.includes("localhost") ? `http://${domain}` : `https://${domain}`);

    // SECURITY: Block private/internal IPs to prevent SSRF
    try {
      const parsed = new URL(verifyUrl);
      const host = parsed.hostname;
      if (isPrivateHost(host)) {
        // Allow localhost in dev for local testing
        if (!(host === "localhost" && process.env.NODE_ENV !== "production")) {
          return sendError(res, 400, ERR.INVALID_INPUT, "Private/internal addresses not allowed");
        }
      }
    } catch {
      return sendError(res, 400, ERR.INVALID_INPUT, "Invalid baseUrl");
    }

    let verifiedInfo;
    try {
      const verifyRes = await fetch(`${verifyUrl}/canopy/info`, {
        signal: AbortSignal.timeout(10000),
      });
      if (!verifyRes.ok) throw new Error("Failed to reach land");
      verifiedInfo = await verifyRes.json();
    } catch {
      return sendError(res, 502, ERR.PEER_UNREACHABLE, "Could not verify land identity. Ensure your land is reachable.");
    }

    // Confirm the claimed identity matches what the land actually serves
    if (verifiedInfo.landId !== landId || verifiedInfo.publicKey !== publicKey) {
      return sendError(res, 403, ERR.FORBIDDEN, "Land identity mismatch. The domain does not serve the claimed identity.");
    }

    let peer = await LandPeer.findOne({ domain });

    if (peer) {
      if (peer.status === "blocked") {
        return sendError(res, 403, ERR.FORBIDDEN, "This land is blocked");
      }
      // Only allow re-registration from the same landId
      if (peer.landId && peer.landId !== landId) {
        return sendError(res, 403, ERR.FORBIDDEN, "Domain already registered with a different land ID");
      }

      // SECURITY: Reject re-registration if publicKey changed.
      // Key rotation requires admin to remove and re-peer.
      if (peer.publicKey && peer.publicKey !== publicKey) {
        return sendError(res, 403, ERR.FORBIDDEN, "Public key has changed. Admin must remove and re-peer to accept new keys.");
      }

      peer.landId = landId;
      peer.protocolVersion = protocolVersion;
      peer.name = name || "";
      peer.extensions = req.body.extensions || [];
      if (baseUrl) peer.baseUrl = baseUrl;
      peer.lastSeenAt = new Date();
      peer.lastSuccessAt = new Date();
      // Only reset status if dead (re-peering). Let heartbeat handle degraded/unreachable recovery.
      if (peer.status === "dead") {
        peer.status = "active";
        peer.consecutiveFailures = 0;
        peer.firstFailureAt = null;
      }
      await peer.save();
    } else {
      peer = await LandPeer.create({
        domain,
        baseUrl: baseUrl || null,
        landId,
        publicKey,
        protocolVersion,
        name: name || "",
        extensions: req.body.extensions || [],
        status: NODE_STATUS.ACTIVE,
      });
    }

    sendOk(res, {
      message: "Peer registered",
      landId: getLandIdentity().landId,
    });
  } catch (err) {
    sendError(res, 500, ERR.INTERNAL, err.message);
  }
});

// ============================================================
// AUTHENTICATED CANOPY ENDPOINTS (require CanopyToken)
// ============================================================

// ── Canopy invite handlers (delegated to team extension) ─────────────

// Used inline with sendError below; kept as a label for grep-ability
const TEAM_NOT_INSTALLED_MSG = "Team extension not installed. Invites unavailable.";

async function loadTeamCanopyHandlers() {
  try {
    return await import("../extensions/team/canopyHandlers.js");
  } catch {
    return null;
  }
}

router.post("/canopy/invite/offer", authenticateCanopy, async (req, res) => {
  try {
    const handlers = await loadTeamCanopyHandlers();
    if (!handlers) return sendError(res, 404, ERR.EXTENSION_NOT_FOUND, TEAM_NOT_INSTALLED_MSG);
    await handlers.handleInviteOffer(req, res, { User, RemoteUser, validateCanopyRequest });
  } catch (err) {
    sendError(res, 500, ERR.INTERNAL, err.message);
  }
});

router.post("/canopy/invite/accept", authenticateCanopy, async (req, res) => {
  try {
    const handlers = await loadTeamCanopyHandlers();
    if (!handlers) return sendError(res, 404, ERR.EXTENSION_NOT_FOUND, TEAM_NOT_INSTALLED_MSG);
    await handlers.handleInviteAccept(req, res, { User, Node, RemoteUser, validateCanopyRequest, addContributor });
  } catch (err) {
    sendError(res, 500, ERR.INTERNAL, err.message);
  }
});

router.post("/canopy/invite/decline", authenticateCanopy, async (req, res) => {
  try {
    const handlers = await loadTeamCanopyHandlers();
    if (!handlers) return sendError(res, 404, ERR.EXTENSION_NOT_FOUND, TEAM_NOT_INSTALLED_MSG);
    await handlers.handleInviteDecline(req, res, { validateCanopyRequest });
  } catch (err) {
    sendError(res, 500, ERR.INTERNAL, err.message);
  }
});

/**
 * POST /canopy/llm/proxy
 * Run LLM inference on behalf of a remote user.
 * The user's LLM connection lives on this (home) land. The remote land
 * sends the messages/tools, we resolve the connection, run the call,
 * deduct energy, and return the completion.
 */
router.post("/canopy/llm/proxy", authenticateCanopy, async (req, res) => {
  try {
    const validation = validateCanopyRequest("llm_proxy", req.body);
    if (!validation.valid) {
      return sendError(res, 400, ERR.INVALID_INPUT, "Validation failed", { errors: validation.errors });
    }

    const { messages, tools, tool_choice, slot } = req.body;

    // Resolve the local (non-remote) user
    const user = await User.findOne({
      _id: req.canopy.userId,
      isRemote: { $ne: true },
    }).select("_id metadata").lean();

    if (!user) {
      return sendError(res, 404, ERR.USER_NOT_FOUND, "User not found on this land");
    }

    // Verify user has a relationship with the calling land
    const callingLand = req.canopy.sourceLandDomain;
    const canopyMeta = getUserMeta(user, "canopy");
    const remoteRoots = canopyMeta.remoteRoots || [];
    const hasRelationship = remoteRoots.some(
      (rr) => rr.landDomain?.toLowerCase() === callingLand?.toLowerCase()
    );
    if (!hasRelationship) {
      return sendError(res, 403, ERR.FORBIDDEN, "User has no relationship with the calling land");
    }

    // Resolve LLM connection
    const { getClientForUser } = await import("../seed/ws/conversation.js");
    const clientEntry = await getClientForUser(user._id.toString(), slot || "main");

    if (clientEntry.noLlm) {
      return sendError(res, 503, ERR.LLM_NOT_CONFIGURED, "No LLM connection configured on home land");
    }

    // Deduct energy before running the LLM call (skip if energy extension not installed)
    const energySvc = getExtension("energy")?.exports;
    if (energySvc?.useEnergy) {
      try {
        await energySvc.useEnergy({ userId: user._id.toString(), action: "proxyLlm" });
      } catch (energyErr) {
        return sendError(res, 429, ERR.RATE_LIMITED, energyErr.message);
      }
    }

    // Run the LLM call
    const completion = await clientEntry.client.chat.completions.create({
      model: clientEntry.model,
      messages,
      tools: tools || undefined,
      tool_choice: tools ? (tool_choice || "auto") : undefined,
    });

    sendOk(res, {
      completion,
      model: clientEntry.model,
    });
  } catch (err) {
    log.error("API", "[Canopy] LLM proxy error:", err.message);
    sendError(res, 503, ERR.LLM_FAILED, err.message);
  }
});

/**
 * POST /canopy/notify
 * Receive a notification from a remote land.
 * (dream summaries, tree changes, etc.)
 */
router.post("/canopy/notify", authenticateCanopy, async (req, res) => {
  try {
    const validation = validateCanopyRequest("notify", req.body);
    if (!validation.valid) {
      return sendError(res, 400, ERR.INVALID_INPUT, "Validation failed", { errors: validation.errors });
    }

    const { targetUserId, notificationType, data } = req.body;

    // Verify the target user is local
    const user = await User.findById(targetUserId);
    if (!user || user.isRemote) {
      return sendError(res, 404, ERR.USER_NOT_FOUND, "Target user not found on this land");
    }

    // For now, just log it. Notification delivery will use existing
    // notification infrastructure.
    log.verbose("Canopy",
      `[Canopy] Notification for ${user.username}: ${notificationType}`
    );

    sendOk(res, { message: "Notification received" });
  } catch (err) {
    sendError(res, 500, ERR.INTERNAL, err.message);
  }
});

// ============================================================
// LOCAL ADMIN ENDPOINTS (require normal auth, not canopy)
// ============================================================

/**
 * POST /canopy/admin/peer/add
 * Add a peer land by URL (manual peering).
 */
router.post("/canopy/admin/peer/add", authenticate, requireAdmin, async (req, res) => {
  try {
    const { url } = req.body;
    if (!url) {
      return sendError(res, 400, ERR.INVALID_INPUT, "Missing url");
    }

    const peer = await registerPeer(url);
    sendOk(res, { peer });
  } catch (err) {
    sendError(res, 500, ERR.INTERNAL, err.message);
  }
});

/**
 * DELETE /canopy/admin/peer/:domain
 * Remove a peer land.
 */
router.delete(
  "/canopy/admin/peer/:domain",
  authenticate,
  requireAdmin,
  async (req, res) => {
    try {
      await removePeer(req.params.domain);
      sendOk(res, { message: "Peer removed" });
    } catch (err) {
      sendError(res, 500, ERR.INTERNAL, err.message);
    }
  }
);

/**
 * POST /canopy/admin/peer/:domain/block
 * Block a peer land.
 */
router.post(
  "/canopy/admin/peer/:domain/block",
  authenticate,
  requireAdmin,
  async (req, res) => {
    try {
      const peer = await blockPeer(req.params.domain);
      if (!peer) {
        return sendError(res, 404, ERR.PEER_NOT_FOUND, "Peer not found");
      }
      sendOk(res, { peer });
    } catch (err) {
      sendError(res, 500, ERR.INTERNAL, err.message);
    }
  }
);

/**
 * POST /canopy/admin/peer/:domain/unblock
 * Unblock a peer land.
 */
router.post(
  "/canopy/admin/peer/:domain/unblock",
  authenticate,
  requireAdmin,
  async (req, res) => {
    try {
      const peer = await unblockPeer(req.params.domain);
      if (!peer) {
        return sendError(res, 404, ERR.PEER_NOT_FOUND, "Peer not found");
      }
      sendOk(res, { peer });
    } catch (err) {
      sendError(res, 500, ERR.INTERNAL, err.message);
    }
  }
);

/**
 * GET /canopy/admin/peers
 * List all peers and their status.
 */
router.get("/canopy/admin/peers", authenticate, requireAdmin, async (req, res) => {
  try {
    const peers = await getAllPeers();
    const pendingEvents = await getPendingEventCount();

    sendOk(res, {
      peers,
      pendingEvents,
      land: getLandInfoPayload(),
    });
  } catch (err) {
    sendError(res, 500, ERR.INTERNAL, err.message);
  }
});

/**
 * POST /canopy/admin/heartbeat
 * Manually trigger a heartbeat check on all peers.
 */
router.post("/canopy/admin/heartbeat", authenticate, requireAdmin, async (req, res) => {
  try {
    const results = await runHeartbeat();
    sendOk(res, { results });
  } catch (err) {
    sendError(res, 500, ERR.INTERNAL, err.message);
  }
});

/**
 * GET /canopy/admin/events/failed
 * List failed canopy events for review.
 */
router.get("/canopy/admin/events/failed", authenticate, requireAdmin, async (req, res) => {
  try {
    const events = await getFailedEvents();
    sendOk(res, { events });
  } catch (err) {
    sendError(res, 500, ERR.INTERNAL, err.message);
  }
});

/**
 * POST /canopy/admin/events/:eventId/retry
 * Retry a specific failed event.
 */
router.post(
  "/canopy/admin/events/:eventId/retry",
  authenticate,
  requireAdmin,
  async (req, res) => {
    try {
      const result = await retryEvent(req.params.eventId);
      if (result === null) {
        return sendError(res, 404, ERR.NODE_NOT_FOUND, "Event not found");
      }
      sendOk(res, { sent: result });
    } catch (err) {
      sendError(res, 500, ERR.INTERNAL, err.message);
    }
  }
);

router.post("/canopy/invite-remote", authenticate, async (req, res) => {
  try {
    const handlers = await loadTeamCanopyHandlers();
    if (!handlers) return sendError(res, 404, ERR.EXTENSION_NOT_FOUND, TEAM_NOT_INSTALLED_MSG);
    await handlers.handleInviteRemote(req, res, {
      User, Node, RemoteUser,
      getLandIdentity, signCanopyToken,
      getPeerByDomain, getPeerBaseUrl, registerPeer,
      lookupLandByDomain, queueCanopyEvent,
    });
  } catch (err) {
    sendError(res, 500, ERR.INTERNAL, err.message);
  }
});

/**
 * GET /canopy/admin/horizon/lands
 * Search the Horizon for lands.
 */
router.get("/canopy/admin/horizon/lands", authenticate, requireAdmin, async (req, res) => {
  try {
    const lands = await searchLands(req.query.q || "");
    sendOk(res, { lands });
  } catch (err) {
    sendError(res, 500, ERR.INTERNAL, err.message);
  }
});

/**
 * GET /canopy/admin/horizon/trees
 * Search the Horizon for public trees across the network.
 */
router.get("/canopy/admin/horizon/trees", authenticate, requireAdmin, async (req, res) => {
  try {
    const trees = await searchPublicTrees(req.query.q || "");
    sendOk(res, { trees });
  } catch (err) {
    sendError(res, 500, ERR.INTERNAL, err.message);
  }
});

/**
 * POST /canopy/admin/peer/discover
 * Look up a land by domain on the Horizon and auto-peer with it.
 */
router.post("/canopy/admin/peer/discover", authenticate, requireAdmin, async (req, res) => {
  try {
    const { domain } = req.body;
    if (!domain) {
      return sendError(res, 400, ERR.INVALID_INPUT, "Missing domain");
    }

    const horizonLand = await lookupLandByDomain(domain);
    if (!horizonLand || !horizonLand.baseUrl) {
      return sendError(res, 404, ERR.NODE_NOT_FOUND, `Land ${domain} not found on the Horizon`);
    }

    const peer = await registerPeer(horizonLand.baseUrl);
    sendOk(res, { peer });
  } catch (err) {
    sendError(res, 500, ERR.INTERNAL, err.message);
  }
});

// ============================================================
// PROXY: Forward local user API calls to remote lands
// ============================================================

/**
 * ALL /canopy/proxy/:domain/*
 * Proxy any API request to a remote land on behalf of the logged-in user.
 * The frontend calls this when interacting with a tree that lives elsewhere.
 *
 * Example: POST /canopy/proxy/other.land.com/api/v1/node/create
 * becomes: POST https://other.land.com/api/v1/node/create
 * with a CanopyToken header signed by this land.
 */
router.all("/canopy/proxy/:domain/*", authenticate, async (req, res) => {
  // Per-user rate limit: 60 requests per minute
  if (!checkCanopyRateLimit(`proxy:${req.userId}`, 60)) {
    return sendError(res, 429, ERR.RATE_LIMITED, "Proxy rate limit exceeded");
  }

  try {
    const { domain } = req.params;
    // Extract the path after /canopy/proxy/:domain/
    const forwardPath = "/" + req.params[0];

    const result = await proxyToRemoteLand({
      userId: req.userId,
      targetLandDomain: domain,
      method: req.method,
      path: forwardPath,
      body: req.body,
      query: req.query,
    });

    // Proxy passthrough: forward the remote land's response as-is
    res.status(result.status).json(result.data);
  } catch (err) {
    sendError(res, 500, ERR.INTERNAL, err.message);
  }
});

// ============================================================
// HTML PAGES (gated behind ENABLE_FRONTEND_HTML)
// ============================================================

export default router;
