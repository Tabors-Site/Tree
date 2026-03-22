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
import User from "../db/models/user.js";
import RemoteUser from "../db/models/remoteUser.js";
import LandPeer from "../db/models/landPeer.js";
import Node from "../db/models/node.js";
import Invite from "../db/models/invite.js";
import authenticate from "../middleware/authenticate.js";
import { renderCanopyAdmin, renderCanopyInvites, renderCanopyDirectory } from "./api/html/canopy.js";
import { lookupLandByDomain, searchLands, searchPublicTrees } from "../canopy/directory.js";


const router = express.Router();

/**
 * Middleware: Require admin (god tier) for canopy admin endpoints.
 * Must be used after authenticate.
 */
async function requireAdmin(req, res, next) {
  try {
    const user = await User.findById(req.userId).select("profileType").lean();
    if (!user || user.profileType !== "god") {
      return res.status(403).json({ success: false, error: "Requires admin (god) permissions" });
    }
    next();
  } catch (err) {
    res.status(500).json({ success: false, error: "Failed to verify admin status" });
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
  res.json(getLandInfoPayload());
});

/**
 * GET /canopy/redirect
 * If this land has moved domains, return the new domain.
 * Used by peers during heartbeat to auto-update.
 */
router.get("/canopy/redirect", (req, res) => {
  const redirectDomain = process.env.LAND_REDIRECT_TO || null;
  if (redirectDomain) {
    return res.json({
      redirect: true,
      newDomain: redirectDomain,
      permanent: true,
    });
  }
  res.json({ redirect: false });
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
      return res.status(404).json({
        success: false,
        error: "User not found on this land",
      });
    }

    res.json({
      success: true,
      userId: user._id,
      username: user.username,
      landDomain: getLandIdentity().domain,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
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
          queryAvailable: !!tree.llmAssignments?.placement,
        };
      })
    );

    res.json({ success: true, trees: results, page: parseInt(page) });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
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
      return res.status(429).json({ success: false, error: "Rate limit exceeded" });
    }

    const { landId, domain, publicKey, protocolVersion, name, baseUrl } = req.body;

    if (!landId || !domain || !publicKey) {
      return res.status(400).json({
        success: false,
        error: "Missing required fields: landId, domain, publicKey",
      });
    }

    if (!isCompatibleVersion(protocolVersion)) {
      return res.status(400).json({
        success: false,
        error: `Incompatible protocol version: ${protocolVersion}`,
      });
    }

    // SECURITY: Verify the sender actually controls the claimed domain.
    const verifyUrl = baseUrl || (domain.includes("localhost") ? `http://${domain}` : `https://${domain}`);

    // SECURITY: Block private/internal IPs to prevent SSRF
    try {
      const parsed = new URL(verifyUrl);
      const host = parsed.hostname;
      if (/^(127\.|10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|0\.|fc|fd|fe80|::1|localhost)/i.test(host)) {
        if (process.env.NODE_ENV === "production") {
          return res.status(400).json({
            success: false,
            error: "Private/internal addresses not allowed in production",
          });
        }
      }
    } catch {
      return res.status(400).json({ success: false, error: "Invalid baseUrl" });
    }

    let verifiedInfo;
    try {
      const verifyRes = await fetch(`${verifyUrl}/canopy/info`, {
        signal: AbortSignal.timeout(10000),
      });
      if (!verifyRes.ok) throw new Error("Failed to reach land");
      verifiedInfo = await verifyRes.json();
    } catch {
      return res.status(400).json({
        success: false,
        error: "Could not verify land identity. Ensure your land is reachable.",
      });
    }

    // Confirm the claimed identity matches what the land actually serves
    if (verifiedInfo.landId !== landId || verifiedInfo.publicKey !== publicKey) {
      return res.status(403).json({
        success: false,
        error: "Land identity mismatch. The domain does not serve the claimed identity.",
      });
    }

    let peer = await LandPeer.findOne({ domain });

    if (peer) {
      if (peer.status === "blocked") {
        return res.status(403).json({
          success: false,
          error: "This land is blocked",
        });
      }
      // Only allow re-registration from the same landId
      if (peer.landId && peer.landId !== landId) {
        return res.status(403).json({
          success: false,
          error: "Domain already registered with a different land ID",
        });
      }

      // SECURITY: Reject re-registration if publicKey changed.
      // Key rotation requires admin to remove and re-peer.
      if (peer.publicKey && peer.publicKey !== publicKey) {
        return res.status(403).json({
          success: false,
          error: "Public key has changed. Admin must remove and re-peer to accept new keys.",
        });
      }

      peer.landId = landId;
      peer.protocolVersion = protocolVersion;
      peer.name = name || "";
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
        status: "active",
      });
    }

    res.json({
      success: true,
      message: "Peer registered",
      landId: getLandIdentity().landId,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================================
// AUTHENTICATED CANOPY ENDPOINTS (require CanopyToken)
// ============================================================

/**
 * POST /canopy/invite/offer
 * A remote land notifies us that one of our users has been invited
 * to a tree on their land.
 */
router.post("/canopy/invite/offer", authenticateCanopy, async (req, res) => {
  try {
    const validation = validateCanopyRequest("invite_offer", req.body);
    if (!validation.valid) {
      return res.status(400).json({
        success: false,
        errors: validation.errors,
      });
    }

    const { receivingUsername, rootId, rootName, invitingUserId, invitingUsername, sourceInviteId } =
      req.body;

    // Use verified domain from CanopyToken, not the body claim
    const sourceLandDomain = req.canopy.sourceLandDomain;

    // Find the local user being invited
    const localUser = await User.findOne({
      username: receivingUsername,
      isRemote: { $ne: true },
    });

    if (!localUser) {
      return res.status(404).json({
        success: false,
        error: `User ${receivingUsername} not found on this land`,
      });
    }

    // Store info about the remote inviter if we haven't seen them
    await RemoteUser.findOneAndUpdate(
      { _id: invitingUserId },
      {
        _id: invitingUserId,
        username: invitingUsername || "unknown",
        homeLandDomain: sourceLandDomain,
        displayName: invitingUsername || "",
        lastSyncedAt: new Date(),
      },
      { upsert: true, new: true }
    );

    // Check for duplicate pending invite
    const existingInvite = await Invite.findOne({
      userReceiving: localUser._id,
      rootId,
      remoteLandDomain: sourceLandDomain,
      status: "pending",
    });

    if (existingInvite) {
      return res.json({
        success: true,
        inviteId: existingInvite._id,
        message: "Invite already pending",
        userId: localUser._id,
        username: localUser.username,
      });
    }

    // Create a local invite so the user can see and respond
    const invite = await Invite.create({
      userInviting: invitingUserId,
      userReceiving: localUser._id,
      rootId,
      remoteLandDomain: sourceLandDomain,
      remoteRootName: rootName || "Untitled",
      remoteInviteId: sourceInviteId || null,
      remoteInvitingUsername: invitingUsername || null,
      status: "pending",
    });

    res.json({
      success: true,
      inviteId: invite._id,
      message: "Invite offer received",
      userId: localUser._id,
      username: localUser.username,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /canopy/invite/accept
 * A remote land confirms that their user accepted an invite
 * to a tree on our land.
 */
router.post("/canopy/invite/accept", authenticateCanopy, async (req, res) => {
  try {
    const validation = validateCanopyRequest("invite_accept", req.body);
    if (!validation.valid) {
      return res.status(400).json({ success: false, errors: validation.errors });
    }

    const { inviteId, userId, username } = req.body;

    // Atomically mark invite as accepted (prevents race condition)
    const invite = await Invite.findOneAndUpdate(
      { _id: inviteId, status: "pending" },
      { $set: { status: "accepted" } },
      { new: true }
    );
    if (!invite) {
      return res.status(404).json({
        success: false,
        error: "Invite not found or already processed",
      });
    }

    // SECURITY: Verify the accepting land is the one the invite was intended for.
    // The invite must have a corresponding RemoteUser from the claiming land.
    const intendedRecipient = await RemoteUser.findById(invite.userReceiving);
    if (!intendedRecipient || intendedRecipient.homeLandDomain !== req.canopy.sourceLandDomain) {
      await Invite.findByIdAndUpdate(inviteId, { $set: { status: "pending" } });
      return res.status(403).json({
        success: false,
        error: "This invite was not sent to your land",
      });
    }

    // SECURITY: Check if this UUID belongs to a local user.
    const existingLocal = await User.findOne({ _id: userId, isRemote: { $ne: true } });
    if (existingLocal) {
      await Invite.findByIdAndUpdate(inviteId, { $set: { status: "pending" } });
      return res.status(403).json({
        success: false,
        error: "User ID conflicts with a local user. Invite rejected.",
      });
    }

    // Find or create ghost user atomically
    // SECURITY: Quota on ghost users per remote land (prevent database flood)
    const ghostCount = await User.countDocuments({
      isRemote: true,
      homeLand: req.canopy.sourceLandDomain,
    });

    const ghostUsername = username
      ? `${username}@${req.canopy.sourceLandDomain}`
      : `${req.canopy.sourceLandDomain}_${userId.slice(0, 8)}`;

    let ghostUser = await User.findOne({
      _id: userId,
      isRemote: true,
      homeLand: req.canopy.sourceLandDomain,
    });

    if (!ghostUser) {
      if (ghostCount >= 1000) {
        await Invite.findByIdAndUpdate(inviteId, { $set: { status: "pending" } });
        return res.status(429).json({
          success: false,
          error: "Ghost user quota exceeded for this land",
        });
      }

      try {
        ghostUser = await User.create({
          _id: userId,
          username: ghostUsername,
          email: `${userId}@${req.canopy.sourceLandDomain}`,
          password: "$2b$00$REMOTE_NOLOGIN_PLACEHOLDER.......................",
          isRemote: true,
          homeLand: req.canopy.sourceLandDomain,
        });
      } catch (createErr) {
        // Duplicate key: another request created it first
        if (createErr.code === 11000) {
          ghostUser = await User.findOne({ _id: userId, isRemote: true });
          if (!ghostUser) {
            // Collision with local user that was created between our check and insert
            return res.status(409).json({
              success: false,
              error: "User ID conflicts with a local account",
            });
          }
        } else {
          throw createErr;
        }
      }
    }

    // Add to contributors atomically (prevents duplicates)
    await Node.findByIdAndUpdate(invite.rootId, {
      $addToSet: { contributors: userId },
    });

    // Add root to ghost user's roots
    if (!ghostUser.roots.includes(invite.rootId)) {
      ghostUser.roots.push(invite.rootId);
      await ghostUser.save();
    }

    res.json({ success: true, message: "Invite accepted" });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /canopy/invite/decline
 * A remote land confirms that their user declined an invite.
 */
router.post("/canopy/invite/decline", authenticateCanopy, async (req, res) => {
  try {
    const validation = validateCanopyRequest("invite_decline", req.body);
    if (!validation.valid) {
      return res.status(400).json({ success: false, errors: validation.errors });
    }

    const { inviteId } = req.body;

    const invite = await Invite.findById(inviteId);
    if (!invite) {
      return res.status(404).json({
        success: false,
        error: "Invite not found",
      });
    }

    // SECURITY: Verify the declining land is the one the invite was sent to.
    if (invite.remoteLandDomain && invite.remoteLandDomain !== req.canopy.sourceLandDomain) {
      return res.status(403).json({
        success: false,
        error: "This invite was not sent to your land",
      });
    }

    invite.status = "declined";
    await invite.save();

    res.json({ success: true, message: "Invite declined" });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
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
      return res.status(400).json({ success: false, errors: validation.errors });
    }

    const { messages, model, tools, tool_choice, slot } = req.body;

    // Resolve the local (non-remote) user
    const user = await User.findOne({
      _id: req.canopy.userId,
      isRemote: { $ne: true },
    }).select("_id").lean();

    if (!user) {
      return res.status(404).json({
        success: false,
        error: "user_not_found",
        message: "User not found on this land",
      });
    }

    // Resolve LLM connection
    const { getClientForUser } = await import("../ws/conversation.js");
    const clientEntry = await getClientForUser(user._id.toString(), slot || "main");

    if (clientEntry.noLlm) {
      return res.status(422).json({
        success: false,
        error: "no_llm",
        message: "No LLM connection configured on home land",
      });
    }

    // Deduct energy before running the LLM call
    const { useEnergy } = await import("../core/tree/energy.js");
    try {
      await useEnergy({ userId: user._id.toString(), action: "proxyLlm" });
    } catch (energyErr) {
      return res.status(422).json({
        success: false,
        error: "insufficient_energy",
        message: energyErr.message,
      });
    }

    // Run the LLM call
    const completion = await clientEntry.client.chat.completions.create({
      model: model || clientEntry.model,
      messages,
      tools: tools || undefined,
      tool_choice: tools ? (tool_choice || "auto") : undefined,
    });

    res.json({
      success: true,
      completion,
      model: clientEntry.model,
    });
  } catch (err) {
    console.error("[Canopy] LLM proxy error:", err.message);
    res.status(502).json({
      success: false,
      error: "llm_error",
      message: err.message,
    });
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
      return res.status(400).json({ success: false, errors: validation.errors });
    }

    const { targetUserId, notificationType, data } = req.body;

    // Verify the target user is local
    const user = await User.findById(targetUserId);
    if (!user || user.isRemote) {
      return res.status(404).json({
        success: false,
        error: "Target user not found on this land",
      });
    }

    // For now, just log it. Notification delivery will use existing
    // notification infrastructure.
    console.log(
      `[Canopy] Notification for ${user.username}: ${notificationType}`
    );

    res.json({ success: true, message: "Notification received" });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
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
      return res.status(400).json({
        success: false,
        error: "Missing url",
      });
    }

    const peer = await registerPeer(url);
    res.json({ success: true, peer });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
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
      res.json({ success: true, message: "Peer removed" });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
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
        return res.status(404).json({
          success: false,
          error: "Peer not found",
        });
      }
      res.json({ success: true, peer });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
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
        return res.status(404).json({
          success: false,
          error: "Peer not found",
        });
      }
      res.json({ success: true, peer });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
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

    res.json({
      success: true,
      peers,
      pendingEvents,
      land: getLandInfoPayload(),
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /canopy/admin/heartbeat
 * Manually trigger a heartbeat check on all peers.
 */
router.post("/canopy/admin/heartbeat", authenticate, requireAdmin, async (req, res) => {
  try {
    const results = await runHeartbeat();
    res.json({ success: true, results });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /canopy/admin/events/failed
 * List failed canopy events for review.
 */
router.get("/canopy/admin/events/failed", authenticate, requireAdmin, async (req, res) => {
  try {
    const events = await getFailedEvents();
    res.json({ success: true, events });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
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
        return res.status(404).json({
          success: false,
          error: "Event not found",
        });
      }
      res.json({ success: true, sent: result });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  }
);

/**
 * POST /canopy/invite-remote
 * Invite a user from a remote land to a local tree.
 * This is what a local tree owner calls to invite someone cross-land.
 */
router.post("/canopy/invite-remote", authenticate, async (req, res) => {
  try {
    const { canopyId, rootId } = req.body;

    if (!canopyId || !rootId) {
      return res.status(400).json({
        success: false,
        error: "Missing canopyId (username@domain) or rootId",
      });
    }

    // Parse canopy ID
    const atIndex = canopyId.lastIndexOf("@");
    if (atIndex === -1) {
      return res.status(400).json({
        success: false,
        error: "Invalid canopy ID format. Expected username@domain",
      });
    }

    const username = canopyId.slice(0, atIndex);
    const domain = canopyId.slice(atIndex + 1);

    // Reject self-land invites — use local invite instead
    if (domain === getLandIdentity().domain) {
      return res.status(400).json({
        success: false,
        error: "That user is on this land. Use a local invite instead of user@domain.",
      });
    }

    // Verify the tree exists and the requester owns it
    const rootNode = await Node.findById(rootId);
    if (!rootNode) {
      return res.status(404).json({
        success: false,
        error: "Tree not found",
      });
    }

    if (rootNode.rootOwner !== req.userId) {
      return res.status(403).json({
        success: false,
        error: "Only the tree owner can invite remote users",
      });
    }

    // Look up the peer, auto-discover via directory if needed
    let peer = await getPeerByDomain(domain);
    if (!peer) {
      // Try directory lookup and auto-peer
      const directoryLand = await lookupLandByDomain(domain);
      if (directoryLand && directoryLand.baseUrl) {
        try {
          peer = await registerPeer(directoryLand.baseUrl);
        } catch (peerErr) {
          return res.status(404).json({
            success: false,
            error: `Found land ${domain} in directory but could not connect: ${peerErr.message}`,
          });
        }
      } else {
        return res.status(404).json({
          success: false,
          error: `Land ${domain} not found. Not a peer and not in the directory.`,
        });
      }
    }

    // Resolve the user on the remote land
    const peerBaseUrl = getPeerBaseUrl(peer);
    const lookupToken = await signCanopyToken(req.userId, domain);
    const resolveRes = await fetch(
      `${peerBaseUrl}/canopy/user/${encodeURIComponent(username)}`,
      {
        headers: { Authorization: `CanopyToken ${lookupToken}` },
        signal: AbortSignal.timeout(10000),
      }
    );

    if (!resolveRes.ok) {
      return res.status(404).json({
        success: false,
        error: `User ${username} not found on land ${domain}`,
      });
    }

    const remoteUserInfo = await resolveRes.json();

    // Store remote user info
    await RemoteUser.findOneAndUpdate(
      { _id: remoteUserInfo.userId },
      {
        _id: remoteUserInfo.userId,
        username: remoteUserInfo.username,
        homeLandDomain: domain,
        displayName: remoteUserInfo.username,
        lastSyncedAt: new Date(),
      },
      { upsert: true }
    );

    // Create the invite locally
    const invite = await Invite.create({
      userInviting: req.userId,
      userReceiving: remoteUserInfo.userId,
      rootId,
      status: "pending",
    });

    // Notify the remote land
    const identity = getLandIdentity();
    const owner = await User.findById(req.userId).select("username").lean();

    await queueCanopyEvent(domain, "invite_offer", {
      sourceInviteId: invite._id,
      invitingUserId: req.userId,
      invitingUsername: owner?.username || "unknown",
      receivingUsername: username,
      rootId,
      rootName: rootNode.name || "Untitled",
      sourceLandDomain: identity.domain,
    });

    res.json({
      success: true,
      message: `Invite sent to ${canopyId}`,
      inviteId: invite._id,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /canopy/admin/directory/lands
 * Search the directory for lands.
 */
router.get("/canopy/admin/directory/lands", authenticate, requireAdmin, async (req, res) => {
  try {
    const lands = await searchLands(req.query.q || "");
    res.json({ success: true, lands });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /canopy/admin/directory/trees
 * Search the directory for public trees across the network.
 */
router.get("/canopy/admin/directory/trees", authenticate, requireAdmin, async (req, res) => {
  try {
    const trees = await searchPublicTrees(req.query.q || "");
    res.json({ success: true, trees });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /canopy/admin/peer/discover
 * Look up a land by domain in the directory and auto-peer with it.
 */
router.post("/canopy/admin/peer/discover", authenticate, requireAdmin, async (req, res) => {
  try {
    const { domain } = req.body;
    if (!domain) {
      return res.status(400).json({ success: false, error: "Missing domain" });
    }

    const directoryLand = await lookupLandByDomain(domain);
    if (!directoryLand || !directoryLand.baseUrl) {
      return res.status(404).json({
        success: false,
        error: `Land ${domain} not found in directory`,
      });
    }

    const peer = await registerPeer(directoryLand.baseUrl);
    res.json({ success: true, peer });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
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

    res.status(result.status).json(result.data);
  } catch (err) {
    res.status(502).json({ success: false, error: err.message });
  }
});

// ============================================================
// HTML PAGES (gated behind ENABLE_FRONTEND_HTML)
// ============================================================

/**
 * GET /canopy/admin
 * Server-rendered admin dashboard for Canopy federation.
 */
router.get("/canopy/admin", authenticate, requireAdmin, async (req, res) => {
  if (process.env.ENABLE_FRONTEND_HTML !== "true") {
    return res.status(404).json({ error: "Server-rendered HTML is disabled." });
  }

  try {
    const peers = await getAllPeers();
    const pendingEvents = await getPendingEventCount();
    const failedEvents = await getFailedEvents();
    const land = getLandInfoPayload();

    const html = renderCanopyAdmin({ land, peers, pendingEvents, failedEvents });
    res.send(html);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /canopy/admin/invites
 * Server-rendered invites page for cross-land collaboration.
 */
router.get("/canopy/admin/invites", authenticate, requireAdmin, async (req, res) => {
  if (process.env.ENABLE_FRONTEND_HTML !== "true") {
    return res.status(404).json({ error: "Server-rendered HTML is disabled." });
  }

  try {
    // Get invites where the current user is receiving
    const invites = await Invite.find({
      userReceiving: req.userId,
    }).lean();

    // Enrich invites with tree names
    for (const inv of invites) {
      const root = await Node.findById(inv.rootId)
        .select("name")
        .lean();
      inv.rootName = root?.name || "Untitled";
    }

    // Get remote users for display info
    const remoteUserIds = invites.map((i) => i.userInviting);
    const remoteUsers = await RemoteUser.find({
      _id: { $in: remoteUserIds },
    }).lean();

    // Get trees the user owns or contributes to for the invite form
    const userTrees = await Node.find({
      rootOwner: { $nin: [null, "SYSTEM"] },
      $or: [
        { rootOwner: req.userId },
        { contributors: req.userId },
      ],
      "versions.0.status": "active",
    })
      .select("_id name rootOwner")
      .lean();

    const localTrees = userTrees.map((t) => ({
      _id: t._id,
      name: t.name || "Untitled",
      isOwner: t.rootOwner === req.userId,
    }));

    const html = renderCanopyInvites({ invites, remoteUsers, localTrees });
    res.send(html);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /canopy/admin/directory
 * Server-rendered directory search page.
 */
router.get("/canopy/admin/directory", authenticate, requireAdmin, async (req, res) => {
  if (process.env.ENABLE_FRONTEND_HTML !== "true") {
    return res.status(404).json({ error: "Server-rendered HTML is disabled." });
  }

  try {
    const hasDirectory = !!process.env.DIRECTORY_URL;
    const html = renderCanopyDirectory({ hasDirectory });
    res.send(html);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
