import Node from "../db/models/node.js";
import User from "../db/models/user.js";
import Invite from "../db/models/invite.js";
import { logContribution } from "../db/utils.js";

// EXACT UUID REGEX FROM OLD CODE
const isValidUUID = (id) =>
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(
    id
  );

async function resolveReceivingUser(userReceiving) {
  let receivingUser = null;

  if (isValidUUID(userReceiving)) {
    receivingUser = await User.findById(userReceiving);
  }

  if (!receivingUser) {
    receivingUser = await User.findOne({ username: userReceiving });
  }

  return receivingUser;
}

export async function createInvite({
  userInvitingId,
  userReceiving,
  rootId,
  isToBeOwner,
  isUninviting,
}) {
  const node = await Node.findById(rootId).populate("rootOwner contributors");
  if (!node) throw new Error("Root node not found");

  const invitingUser = await User.findById(userInvitingId);
  if (!invitingUser) throw new Error("Inviting user not found");

  const receivingUser = await resolveReceivingUser(userReceiving);
  if (!receivingUser) throw new Error("Receiving user not found");
  const existingInvite = await Invite.findOne({
    rootId,
    userReceiving: receivingUser._id,
    status: "pending",
    isToBeOwner,
  });

  if (existingInvite) {
    throw new Error("An invite has already been sent to this user");
  }

  // EXACT OLD SELF-INVITE CHECK
  if (!isUninviting && receivingUser._id.toString() === userInvitingId) {
    throw new Error("You cannot invite yourself");
  }

  // EXACT OLD OWNER CHECK (no optional chaining)
  const isOwner = node.rootOwner._id.toString() === userInvitingId;

  const invite = new Invite({
    userInviting: userInvitingId,
    userReceiving: receivingUser._id,
    isToBeOwner,
    isUninviting,
    rootId,
    status: "pending",
  });

  const inviteAction = {
    receivingId: receivingUser._id,
  };

  // ---------------- INVITE CONTRIBUTOR ----------------
  if (!isToBeOwner && !isUninviting) {
    if (!isOwner) {
      throw new Error("Only the current owner can invite a new contributor");
    }
    if (
      node.rootOwner &&
      node.rootOwner._id.toString() === receivingUser._id.toString()
    ) {
      throw new Error("User already owns this root");
    }
    const alreadyContributor = node.contributors.some(
      (u) => u._id.toString() === receivingUser._id.toString()
    );

    if (alreadyContributor) {
      throw new Error("User is already a contributor");
    }

    inviteAction.action = "invite";

    await logContribution({
      userId: userInvitingId,
      nodeId: node.id,
      action: "invite",
      inviteAction,
      nodeVersion: node.prestige,
    });

    await invite.save();
    return { message: "Contributor invite created and logged" };
  }

  // ---------------- TRANSFER OWNERSHIP ----------------
  if (isToBeOwner) {
    if (!isOwner) {
      throw new Error("Only the current owner can invite a new owner");
    }
    if (
      node.rootOwner &&
      node.rootOwner._id.toString() === receivingUser._id.toString()
    ) {
      throw new Error("User already owns this root");
    }

    node.rootOwner = receivingUser._id;
    node.contributors = node.contributors.filter(
      (u) => u._id.toString() !== receivingUser._id.toString()
    );
    node.contributors.push(invitingUser);

    await node.save();

    invite.status = "accepted";
    await invite.save();

    inviteAction.action = "switchOwner";

    await logContribution({
      userId: userInvitingId,
      nodeId: node.id,
      action: "invite",
      inviteAction,
      nodeVersion: node.prestige,
    });

    return { message: "Ownership transferred and invite logged" };
  }

  // ---------------- UNINVITE ----------------
  if (!isToBeOwner && isUninviting) {
    // Case 1: Owner tries to remove themselves but contributors exist
    if (
      isOwner &&
      receivingUser._id.toString() === userInvitingId &&
      node.contributors.length > 0
    ) {
      throw new Error("Owner cannot remove themselves when contributors exist");
    }

    // Case 2: Owner removes a contributor
    if (isOwner && receivingUser._id.toString() !== userInvitingId) {
      node.contributors = node.contributors.filter(
        (u) => u._id.toString() !== receivingUser._id.toString()
      );

      await node.save();

      invite.status = "accepted";
      await invite.save();

      await User.findByIdAndUpdate(receivingUser._id, {
        $pull: { roots: rootId },
      });

      inviteAction.action = "removeContributor";

      await logContribution({
        userId: userInvitingId,
        nodeId: node.id,
        action: "invite",
        inviteAction,
        nodeVersion: node.prestige,
      });

      return { message: "Contributor removed by owner and invite logged" };
    }

    // Case 3: Owner removes themselves (no contributors)
    if (
      isOwner &&
      receivingUser._id.toString() === userInvitingId &&
      node.contributors.length === 0
    ) {
      node.rootOwner = null;
      await node.save();

      await User.findByIdAndUpdate(userInvitingId, {
        $pull: { roots: rootId },
      });

      inviteAction.action = "removeContributor";

      await logContribution({
        userId: userInvitingId,
        nodeId: node.id,
        action: "invite",
        inviteAction,
        nodeVersion: node.prestige,
      });

      return { message: "Owner removed themselves and root ownership cleared" };
    }

    // Case 4: Contributor removes themselves
    if (!isOwner && receivingUser._id.toString() === userInvitingId) {
      const isContributor = node.contributors.some(
        (u) => u._id.toString() === userInvitingId
      );

      if (!isContributor) {
        throw new Error(
          "You are not a contributor and cannot remove yourself."
        );
      }

      node.contributors = node.contributors.filter(
        (u) => u._id.toString() !== userInvitingId
      );

      await node.save();

      invite.status = "accepted";
      await invite.save();

      await User.findByIdAndUpdate(userInvitingId, {
        $pull: { roots: rootId },
      });

      inviteAction.action = "removeContributor";

      await logContribution({
        userId: userInvitingId,
        nodeId: node.id,
        action: "invite",
        inviteAction,
        nodeVersion: node.prestige,
      });

      return { message: "Contributor removed themselves and invite logged" };
    }

    throw new Error("Invalid uninviting request");
  }

  throw new Error("Invalid invite operation");
}

export async function respondToInvite({ inviteId, userId, acceptInvite }) {
  const invite = await Invite.findById(inviteId);
  if (!invite) throw new Error("Invite not found");

  if (invite.userReceiving.toString() !== userId.toString()) {
    throw new Error("Invite not intended for this user");
  }

  const node = await Node.findById(invite.rootId).populate(
    "rootOwner contributors"
  );
  if (!node) throw new Error("Node not found");

  const inviteAction = { receivingId: userId };

  if (acceptInvite) {
    node.contributors.push(userId); // MATCH OLD
    await node.save();

    await User.findByIdAndUpdate(userId, {
      $addToSet: { roots: invite.rootId },
    });

    invite.status = "accepted";
    inviteAction.action = "acceptInvite";
  } else {
    invite.status = "declined";
    inviteAction.action = "denyInvite";
  }

  await invite.save();

  await logContribution({
    userId,
    nodeId: node.id,
    action: "invite",
    inviteAction,
    nodeVersion: node.prestige,
  });

  return {
    success: true,
    message: acceptInvite
      ? "Invite accepted, user added as contributor, and roots updated"
      : "Invite declined",
  };
}

export async function getPendingInvitesForUser(userId) {
  return Invite.find({
    userReceiving: userId,
    status: "pending",
  })
    .populate("userInviting", "username")
    .populate("rootId", "name");
}
