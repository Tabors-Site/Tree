import Node from "../../db/models/node.js";
import User from "../../db/models/user.js";
import Invite from "../../db/models/invite.js";
import { logContribution } from "../../db/utils.js";
// Energy: dynamic import, no-op if extension not installed
let useEnergy = async () => ({ energyUsed: 0 });
try { ({ useEnergy } = await import("../../extensions/energy/core.js")); } catch {}
import { queueCanopyEvent } from "../../canopy/events.js";

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// EXACT UUID REGEX FROM OLD CODE
const isValidUUID = (id) =>
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(
    id,
  );

async function resolveReceivingUser(userReceiving) {
  let receivingUser = null;

  if (isValidUUID(userReceiving)) {
    receivingUser = await User.findById(userReceiving);
  }

  if (!receivingUser) {
    receivingUser = await User.findOne({
      username: { $regex: `^${escapeRegex(userReceiving)}$`, $options: "i" },
    });
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
  if (node.parent === "deleted") {
    throw new Error(
      "You can’t invite users or delete a root that’s already deleted..",
    );
  }

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
  const { energyUsed } = await useEnergy({
    userId: userInvitingId,
    action: "invite",
  });
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
      (u) => u._id.toString() === receivingUser._id.toString(),
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
      nodeVersion: "0",
      energyUsed,
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
    // Clear LLM assignments — the new owner doesn't own the old connections
    node.llmAssignments = { placement: null };
    node.contributors = node.contributors.filter(
      (u) => u._id.toString() !== receivingUser._id.toString(),
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
      nodeVersion: "0",
      energyUsed,
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
      throw new Error("Owner cannot leave when contributors exist");
    }

    // Case 2: Owner removes a contributor
    if (isOwner && receivingUser._id.toString() !== userInvitingId) {
      node.contributors = node.contributors.filter(
        (u) => u._id.toString() !== receivingUser._id.toString(),
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
        nodeVersion: "0",
        energyUsed,
      });

      return { message: "Contributor removed by owner and invite logged" };
    }

    // Case 3: Owner removes themselves (no contributors)
    if (
      isOwner &&
      receivingUser._id.toString() === userInvitingId &&
      node.contributors.length === 0
    ) {
      node.parent = "deleted";
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
        nodeVersion: "0",
        energyUsed,
      });
      await logContribution({
        userId: userInvitingId,
        nodeId: node.id,
        action: "branchLifecycle",
        nodeVersion: "0",
        branchLifecycle: {
          action: "retired",
          fromParentId: null,
        },
      });

      return { message: "Owner retired root" };
    }

    // Case 4: Contributor removes themselves
    if (!isOwner && receivingUser._id.toString() === userInvitingId) {
      const isContributor = node.contributors.some(
        (u) => u._id.toString() === userInvitingId,
      );

      if (!isContributor) {
        throw new Error(
          "You are not a contributor and cannot remove yourself.",
        );
      }

      node.contributors = node.contributors.filter(
        (u) => u._id.toString() !== userInvitingId,
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
        nodeVersion: "0",
        energyUsed,
      });

      return { message: "Contributor removed themselves and invite logged" };
    }

    throw new Error("Invalid uninviting request");
  }

  throw new Error("Invalid invite operation");
}

export async function respondToInvite({ inviteId, userId, acceptInvite }) {
  // Atomic status transition prevents double-processing
  const invite = await Invite.findOneAndUpdate(
    { _id: inviteId, status: "pending" },
    { $set: { status: acceptInvite ? "accepted" : "declined" } },
    { new: true }
  );
  if (!invite) throw new Error("Invite not found");

  if (invite.userReceiving.toString() !== userId.toString()) {
    // Revert status since this user shouldn't have changed it
    await Invite.findByIdAndUpdate(inviteId, { $set: { status: "pending" } });
    throw new Error("Invite not intended for this user");
  }

  // Remote invite: tree lives on another land, no local node to modify
  if (invite.remoteLandDomain) {
    if (acceptInvite) {
      // Avoid duplicates: only add if rootId + landDomain combo doesn't exist
      await User.updateOne(
        {
          _id: userId,
          "remoteRoots": {
            $not: { $elemMatch: { rootId: invite.rootId, landDomain: invite.remoteLandDomain } }
          }
        },
        {
          $push: {
            remoteRoots: {
              rootId: invite.rootId,
              rootName: invite.remoteRootName || "Untitled",
              landDomain: invite.remoteLandDomain,
            },
          },
        }
      );

      const acceptingUser = await User.findById(userId).select("username").lean();
      await queueCanopyEvent(invite.remoteLandDomain, "invite_accept", {
        inviteId: invite.remoteInviteId || invite._id,
        userId,
        username: acceptingUser?.username || null,
      });
    } else {
      await queueCanopyEvent(invite.remoteLandDomain, "invite_decline", {
        inviteId: invite.remoteInviteId || invite._id,
      });
    }

    return {
      success: true,
      message: acceptInvite ? "Remote invite accepted" : "Remote invite declined",
    };
  }

  const node = await Node.findById(invite.rootId);
  if (!node) throw new Error("Node not found");
  const { energyUsed } = await useEnergy({
    userId,
    action: "invite",
  });
  const inviteAction = { receivingId: userId };

  if (acceptInvite) {
    // Atomic dedup: $addToSet on contributors instead of push
    await Node.findByIdAndUpdate(invite.rootId, {
      $addToSet: { contributors: userId },
    });

    await User.findByIdAndUpdate(userId, {
      $addToSet: { roots: invite.rootId },
    });

    inviteAction.action = "acceptInvite";
  } else {
    inviteAction.action = "denyInvite";
  }

  await logContribution({
    userId,
    nodeId: node.id,
    action: "invite",
    inviteAction,
    nodeVersion: "0",
    energyUsed,
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
    .populate("userInviting", "username isRemote homeLand")
    .populate("rootId", "name");
}
