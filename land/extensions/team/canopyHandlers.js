/**
 * Canopy invite handlers.
 * Called by canopy.js routes via dynamic delegation to the team extension.
 * Each handler receives (req, res) and the canopy infrastructure it needs.
 */
import { sendOk, sendError, ERR } from "../../seed/protocol.js";
import { Invite } from "./model.js";

/**
 * POST /canopy/invite/offer
 * A remote land notifies us that one of our users has been invited.
 */
export async function handleInviteOffer(req, res, { User, RemoteUser, validateCanopyRequest }) {
  const validation = validateCanopyRequest("invite_offer", req.body);
  if (!validation.valid) {
    return sendError(res, 400, ERR.INVALID_INPUT, "Validation failed", { errors: validation.errors });
  }

  const { receivingUsername, rootId, rootName, invitingUserId, invitingUsername, sourceInviteId } =
    req.body;
  const sourceLandDomain = req.canopy.sourceLandDomain;

  const localUser = await User.findOne({
    username: receivingUsername,
    isRemote: { $ne: true },
  });

  if (!localUser) {
    return sendError(res, 404, ERR.USER_NOT_FOUND, `User ${receivingUsername} not found on this land`);
  }

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

  const existingInvite = await Invite.findOne({
    userReceiving: localUser._id,
    rootId,
    remoteLandDomain: sourceLandDomain,
    status: "pending",
  });

  if (existingInvite) {
    return sendOk(res, {
      inviteId: existingInvite._id,
      message: "Invite already pending",
      userId: localUser._id,
      username: localUser.username,
    });
  }

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

  sendOk(res, {
    inviteId: invite._id,
    message: "Invite offer received",
    userId: localUser._id,
    username: localUser.username,
  });
}

/**
 * POST /canopy/invite/accept
 * A remote land confirms that their user accepted an invite.
 */
export async function handleInviteAccept(req, res, { User, Node, RemoteUser, validateCanopyRequest, addContributor }) {
  const validation = validateCanopyRequest("invite_accept", req.body);
  if (!validation.valid) {
    return sendError(res, 400, ERR.INVALID_INPUT, "Validation failed", { errors: validation.errors });
  }

  const { inviteId, userId, username } = req.body;

  const invite = await Invite.findOneAndUpdate(
    { _id: inviteId, status: "pending" },
    { $set: { status: "accepted" } },
    { new: true }
  );
  if (!invite) {
    return sendError(res, 404, ERR.NODE_NOT_FOUND, "Invite not found or already processed");
  }

  // SECURITY: Verify the accepting land is the one the invite was intended for.
  const intendedRecipient = await RemoteUser.findById(invite.userReceiving);
  if (!intendedRecipient || intendedRecipient.homeLandDomain !== req.canopy.sourceLandDomain) {
    await Invite.findByIdAndUpdate(inviteId, { $set: { status: "pending" } });
    return sendError(res, 403, ERR.FORBIDDEN, "This invite was not sent to your land");
  }

  // SECURITY: Check if this UUID belongs to a local user.
  const existingLocal = await User.findOne({ _id: userId, isRemote: { $ne: true } });
  if (existingLocal) {
    await Invite.findByIdAndUpdate(inviteId, { $set: { status: "pending" } });
    return sendError(res, 403, ERR.FORBIDDEN, "User ID conflicts with a local user. Invite rejected.");
  }

  // Find or create ghost user atomically
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
      return sendError(res, 429, ERR.RATE_LIMITED, "Ghost user quota exceeded for this land");
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
      if (createErr.code === 11000) {
        ghostUser = await User.findOne({ _id: userId, isRemote: true });
        if (!ghostUser) {
          return sendError(res, 409, ERR.RESOURCE_CONFLICT, "User ID conflicts with a local account");
        }
      } else {
        throw createErr;
      }
    }
  }

  // afterOwnershipChange hook updates metadata.nav.roots for the ghost user
  await addContributor(invite.rootId, userId, invite.userInviting);

  sendOk(res, { message: "Invite accepted" });
}

/**
 * POST /canopy/invite/decline
 * A remote land confirms that their user declined an invite.
 */
export async function handleInviteDecline(req, res, { validateCanopyRequest }) {
  const validation = validateCanopyRequest("invite_decline", req.body);
  if (!validation.valid) {
    return sendError(res, 400, ERR.INVALID_INPUT, "Validation failed", { errors: validation.errors });
  }

  const { inviteId } = req.body;

  const invite = await Invite.findById(inviteId);
  if (!invite) {
    return sendError(res, 404, ERR.NODE_NOT_FOUND, "Invite not found");
  }

  // SECURITY: Verify the declining land is the one the invite was sent to.
  if (invite.remoteLandDomain && invite.remoteLandDomain !== req.canopy.sourceLandDomain) {
    return sendError(res, 403, ERR.FORBIDDEN, "This invite was not sent to your land");
  }

  invite.status = "declined";
  await invite.save();

  sendOk(res, { message: "Invite declined" });
}

/**
 * POST /canopy/invite-remote
 * A local tree owner invites a user from a remote land.
 */
export async function handleInviteRemote(req, res, {
  User, Node, RemoteUser,
  getLandIdentity, signCanopyToken,
  getPeerByDomain, getPeerBaseUrl, registerPeer,
  lookupLandByDomain, queueCanopyEvent,
}) {
  const { canopyId, rootId } = req.body;

  if (!canopyId || !rootId) {
    return sendError(res, 400, ERR.INVALID_INPUT, "Missing canopyId (username@domain) or rootId");
  }

  const atIndex = canopyId.lastIndexOf("@");
  if (atIndex === -1) {
    return sendError(res, 400, ERR.INVALID_INPUT, "Invalid canopy ID format. Expected username@domain");
  }

  const username = canopyId.slice(0, atIndex);
  const domain = canopyId.slice(atIndex + 1);

  if (domain === getLandIdentity().domain) {
    return sendError(res, 400, ERR.INVALID_INPUT, "That user is on this land. Use a local invite instead of user@domain.");
  }

  const rootNode = await Node.findById(rootId);
  if (!rootNode) {
    return sendError(res, 404, ERR.TREE_NOT_FOUND, "Tree not found");
  }

  if (rootNode.rootOwner !== req.userId) {
    return sendError(res, 403, ERR.FORBIDDEN, "Only the tree owner can invite remote users");
  }

  let peer = await getPeerByDomain(domain);
  if (!peer) {
    const horizonLand = await lookupLandByDomain(domain);
    if (horizonLand && horizonLand.baseUrl) {
      try {
        peer = await registerPeer(horizonLand.baseUrl);
      } catch (peerErr) {
        return sendError(res, 502, ERR.PEER_UNREACHABLE, `Found land ${domain} on the Horizon but could not connect: ${peerErr.message}`);
      }
    } else {
      return sendError(res, 404, ERR.PEER_NOT_FOUND, `Land ${domain} not found. Not a peer and not on the Horizon.`);
    }
  }

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
    return sendError(res, 404, ERR.USER_NOT_FOUND, `User ${username} not found on land ${domain}`);
  }

  const remoteUserInfo = await resolveRes.json();

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

  const invite = await Invite.create({
    userInviting: req.userId,
    userReceiving: remoteUserInfo.userId,
    rootId,
    status: "pending",
  });

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

  sendOk(res, {
    message: `Invite sent to ${canopyId}`,
    inviteId: invite._id,
  });
}

/**
 * GET /canopy/admin/invites
 * Server-rendered invites page for cross-land collaboration.
 */
export async function handleAdminInvites(req, res, { User, Node, RemoteUser, getExtension }) {
  if (process.env.ENABLE_FRONTEND_HTML !== "true") {
    return sendError(res, 404, ERR.EXTENSION_NOT_FOUND, "Server-rendered HTML is disabled.");
  }

  const invites = await Invite.find({
    userReceiving: req.userId,
  }).lean();

  for (const inv of invites) {
    const root = await Node.findById(inv.rootId).select("name").lean();
    inv.rootName = root?.name || "Untitled";
  }

  const remoteUserIds = invites.map((i) => i.userInviting);
  const remoteUsers = await RemoteUser.find({
    _id: { $in: remoteUserIds },
  }).lean();

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

  const renderCanopyInvites = getExtension("html-rendering")?.exports?.renderCanopyInvites;
  if (!renderCanopyInvites) return sendError(res, 404, ERR.EXTENSION_NOT_FOUND, "html-rendering extension not available.");
  const page = renderCanopyInvites({ invites, remoteUsers, localTrees });
  res.send(page);
}
