import { Invite } from "./model.js";

/**
 * Send an invite to a remote user (username@domain format).
 *
 * Flow:
 * 1. Parse canopyId into username and domain
 * 2. Find or auto-peer with the remote land
 * 3. Resolve the remote user via GET /canopy/user/:username
 * 4. Send invite offer to remote land via POST /canopy/invite/offer
 * 5. Create a local pending invite with the remote user info
 */
export async function sendRemoteInvite({ userInvitingId, canopyId, rootId, Node, User, RemoteUser, canopy }) {
  const [username, domain] = canopyId.split("@");
  if (!username || !domain) {
    throw new Error("Invalid canopy ID. Use username@domain format.");
  }

  const identity = canopy.getLandIdentity();
  if (domain === identity.domain) {
    throw new Error("That domain is this land. Use just the username for local invites.");
  }

  // Validate the tree exists and inviting user has access
  const rootNode = await Node.findById(rootId).lean();
  if (!rootNode) throw new Error("Root node not found");
  if (rootNode.parent === "deleted") throw new Error("This tree has been deleted");

  const isOwner = rootNode.rootOwner?.toString() === userInvitingId;
  const isContributor = rootNode.contributors?.some(
    (c) => c.toString() === userInvitingId
  );
  if (!isOwner && !isContributor) {
    throw new Error("You must be an owner or contributor to invite users");
  }

  const invitingUser = await User.findById(userInvitingId).select("username").lean();
  if (!invitingUser) throw new Error("Inviting user not found");

  // Find the peer land, or auto-peer via directory
  let peer = await canopy.getPeerByDomain(domain);

  if (!peer) {
    // Try the directory
    const directoryLand = await canopy.lookupLandByDomain(domain);
    if (directoryLand && directoryLand.baseUrl) {
      peer = await canopy.registerPeer(directoryLand.baseUrl);
    }
  }

  if (!peer) {
    throw new Error(
      `Could not find land "${domain}". Add it as a peer first or check the domain.`
    );
  }

  if (peer.status === "blocked") {
    throw new Error(`Land ${domain} is blocked`);
  }

  // Resolve the remote user via their land
  const baseUrl = canopy.getPeerBaseUrl(peer);
  const token = await canopy.signCanopyToken(userInvitingId, domain);

  let remoteUserData;
  try {
    const lookupRes = await fetch(
      `${baseUrl}/canopy/user/${encodeURIComponent(username)}`,
      {
        headers: { Authorization: `CanopyToken ${token}` },
        signal: AbortSignal.timeout(10000),
      }
    );
    if (!lookupRes.ok) {
      throw new Error(`User "${username}" not found on ${domain}`);
    }
    remoteUserData = await lookupRes.json();
    if (!remoteUserData.success || !remoteUserData.userId) {
      throw new Error(`User "${username}" not found on ${domain}`);
    }
  } catch (err) {
    if (err.name === "TimeoutError") {
      throw new Error(`Could not reach ${domain} (timed out)`);
    }
    throw err;
  }

  // Cache the remote user info locally
  await RemoteUser.findOneAndUpdate(
    { _id: remoteUserData.userId },
    {
      username: remoteUserData.username,
      homeLandDomain: domain,
      displayName: remoteUserData.displayName || remoteUserData.username,
    },
    { upsert: true }
  );

  // Create a local invite first so we can send its ID to the remote land
  const invite = await Invite.create({
    userInviting: userInvitingId,
    userReceiving: remoteUserData.userId,
    rootId,
    status: "pending",
    isToBeOwner: false,
    isUninviting: false,
  });

  // Send the invite offer to the remote land (includes our invite ID)
  let offerData;
  try {
    const offerRes = await fetch(`${baseUrl}/canopy/invite/offer`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `CanopyToken ${token}`,
      },
      body: JSON.stringify({
        receivingUsername: remoteUserData.username,
        rootId,
        rootName: rootNode.name || "Untitled",
        sourceLandDomain: identity.domain,
        invitingUserId: userInvitingId,
        invitingUsername: invitingUser.username,
        sourceInviteId: invite._id,
      }),
      signal: AbortSignal.timeout(15000),
    });

    offerData = await offerRes.json();
    if (!offerRes.ok || !offerData.success) {
      // Clean up our local invite since the remote land rejected
      await Invite.findByIdAndDelete(invite._id);
      throw new Error(offerData.error || "Remote land rejected the invite");
    }
  } catch (err) {
    // Clean up on network failure too
    if (!offerData) await Invite.findByIdAndDelete(invite._id);
    throw err;
  }

  // Store the remote land's invite ID for cross-reference
  if (offerData.inviteId) {
    invite.remoteInviteId = offerData.inviteId;
    await invite.save();
  }

  return {
    inviteId: invite._id,
    remoteUser: `${remoteUserData.username}@${domain}`,
  };
}
