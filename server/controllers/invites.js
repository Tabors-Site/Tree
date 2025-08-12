const Node = require("../db/models/node");
const User = require("../db/models/user");
const Invite = require("../db/models/invite");
const { logContribution } = require("../db/utils");

const invite = async (req, res) => {
  const { userReceiving, isToBeOwner, isUninviting, rootId } = req.body;
  const userId = req.userId; // User ID of the person sending the invite

  try {
    const node = await Node.findById(rootId).populate("rootOwner contributors");
    if (!node)
      return res
        .status(404)
        .json({ status: 404, message: "Root node not found" });

    const invitingUser = await User.findById(userId);
    if (!invitingUser)
      return res
        .status(404)
        .json({ status: 404, message: "Inviting user not found" });

    let receivingUser = null;

    // Regular expression for validating UUID (v4)
    const isValidUUID = (id) =>
      /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(
        id
      );

    if (isValidUUID(userReceiving)) {
      receivingUser = await User.findById(userReceiving);
    }

    // If it's not a valid UUID, try to find by username
    if (!receivingUser) {
      receivingUser = await User.findOne({ username: userReceiving });
    }

    if (!receivingUser)
      return res
        .status(404)
        .json({ status: 404, message: "Receiving user not found" });

    if (!isUninviting && userId === receivingUser._id) {
      return res
        .status(400)
        .json({ status: 400, message: "You cannot invite yourself" });
    }

    // Log the invite for every action
    const invite = new Invite({
      userInviting: userId,
      userReceiving: receivingUser._id, // Use the user ID of the receiving user
      isToBeOwner,
      isUninviting,
      rootId,
      status: "pending", // Default status; will be updated below if action is immediate
    });

    const inviteAction = {
      receivingId: receivingUser._id,
    };

    const isOwner = node.rootOwner._id.toString() === userId;

    // Contributor invitation which only owner can do
    if (!isToBeOwner && !isUninviting) {
      if (!isOwner) {
        return res.status(403).json({
          status: 403,
          message: "Only the current owner can invite a new contributor",
        });
      }
      inviteAction.action = "invite";

      await logContribution({
        userId: userId,
        nodeId: node.id,
        action: "invite",
        inviteAction: inviteAction,
        nodeVersion: node.prestige, // Index of the version with prestige
      });
      await invite.save();
      return res.status(200).json({
        status: 200,
        message: "Contributor invite created and logged",
      });
    }

    // Ownership transfer
    if (isToBeOwner) {
      if (!isOwner) {
        return res.status(403).json({
          status: 403,
          message: "Only the current owner can invite a new owner",
        });
      }

      // Update ownership
      node.rootOwner = receivingUser._id;
      node.contributors = node.contributors.filter(
        (u) => u._id.toString() !== receivingUser._id
      );
      node.contributors.push(invitingUser);

      await node.save();


      invite.status = "accepted";
      await invite.save();

      inviteAction.action = "switchOwner";

      await logContribution({
        userId: userId,
        nodeId: node.id,
        action: "invite",
        inviteAction: inviteAction,
        nodeVersion: node.prestige, 
      });

      return res.status(200).json({
        status: 200,
        message: "Ownership transferred and invite logged",
      });
    }

    // self-removal
    if (!isToBeOwner && isUninviting) {
      // Case 1: Owner tries to remove themselves but contributors exist
      if (
        isOwner &&
        receivingUser._id.toString() === userId &&
        node.contributors.length > 0
      ) {
        return res.status(400).json({
          status: 400,
          message: "Owner cannot remove themselves when contributors exist",
        });
      }

      // Case 2: Owner removes a contributor
      if (isOwner && receivingUser._id.toString() !== userId) {
        node.contributors = node.contributors.filter(
          (u) => u._id.toString() !== receivingUser._id
        );

        await node.save();

        invite.status = "accepted";
        await invite.save();

        await User.findByIdAndUpdate(receivingUser._id, {
          $pull: { roots: rootId }, // Remove rootId from the user's roots
        });
        inviteAction.action = "removeContributor";

        await logContribution({
          userId: userId,
          nodeId: node.id,
          action: "invite",
          inviteAction: inviteAction,
          nodeVersion: node.prestige, // Index of the version with prestige
        });

        return res.status(200).json({
          status: 200,
          message: "Contributor removed by owner and invite logged",
        });
      }

      // Case 3: Owner removes themselves when there are no contributors
      if (
        isOwner &&
        receivingUser._id.toString() === userId &&
        node.contributors.length === 0
      ) {
        node.rootOwner = null; // Remove owner
        await node.save();

        await User.findByIdAndUpdate(userId, {
          $pull: { roots: rootId }, // Remove rootId from the user's roots
        });
        inviteAction.action = "removeContributor";

        await logContribution({
          userId: userId,
          nodeId: node.id,
          action: "invite",
          inviteAction: inviteAction,
          nodeVersion: node.prestige, // Index of the version with prestige
        });
        return res.status(200).json({
          status: 200,
          message: "Owner removed themselves and root ownership cleared",
        });
      }

      // Case 4: Contributor removes themselves
      if (!isOwner && receivingUser._id.toString() === userId) {
        // Check if the user is in the contributors array
        const isContributor = node.contributors.some(
          (u) => u._id.toString() === userId
        );

        if (!isContributor) {
          return res.status(400).json({
            status: 400,
            message: "You are not a contributor and cannot remove yourself.",
          });
        }
        node.contributors = node.contributors.filter(
          (u) => u._id.toString() !== userId
        );

        await node.save();

        invite.status = "accepted";
        await invite.save();

        await User.findByIdAndUpdate(userId, {
          $pull: { roots: rootId }, // Remove rootId from the user's roots
        });
        inviteAction.action = "removeContributor";

        await logContribution({
          userId: userId,
          nodeId: node.id,
          action: "invite",
          inviteAction: inviteAction,
          nodeVersion: node.prestige, // Index of the version with prestige
        });
        return res.status(200).json({
          status: 200,
          message: "Contributor removed themselves and invite logged",
        });
      }

      // Case 5: Invalid request
      return res.status(400).json({
        status: 400,
        message: "Invalid uninviting request",
      });
    }

    res.status(400).json({ status: 400, message: "Invalid invite operation" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ status: 500, message: "Server error" });
  }
};

const inviteAccept = async (req, res) => {
  const { inviteId, acceptInvite } = req.body;
  const userReceiving = req.userId;
  const inviteAction = {
    receivingId: userReceiving,
  };

  try {
    // Find the invite by ID
    const invite = await Invite.findById(inviteId);

    if (!invite) return res.status(404).send("Invite not found");

    // Ensure the invite is for the correct user
    if (invite.userReceiving.toString() !== userReceiving)
      return res.status(403).send("This invite is not for the specified user");

    // Find the node associated with the invite
    const node = await Node.findById(invite.rootId).populate(
      "rootOwner contributors"
    );
    if (!node) return res.status(404).send("Node not found");

    // If accepting the invite
    if (acceptInvite) {
      // Add the user as a contributor to the node
      node.contributors.push(userReceiving);
      await node.save();

      // Update the user's roots field
      await User.findByIdAndUpdate(userReceiving, {
        $addToSet: { roots: invite.rootId }, // Add the rootId to the user's roots
      });

      // Update the invite status to 'accepted'
      invite.status = "accepted";
      await invite.save();
      inviteAction.action = "acceptInvite";

      await logContribution({
        userId: userReceiving,
        nodeId: node.id,
        action: "invite",
        inviteAction: inviteAction,
        nodeVersion: node.prestige, // Index of the version with prestige
      });
      // Return a JSON response with success
      return res.status(200).json({
        success: true,
        message:
          "Invite accepted, user added as contributor, and roots updated",
      });
    }

    // If declining the invite
    else {
      // Update the invite status to 'declined'
      invite.status = "declined";
      await invite.save();
      inviteAction.action = "denyInvite";

      await logContribution({
        userId: userReceiving,
        nodeId: node.id,
        action: "invite",
        inviteAction: inviteAction,
        nodeVersion: node.prestige, // Index of the version with prestige
      });

      // Return a JSON response with success
      return res.status(200).json({
        success: true,
        message: "Invite declined",
      });
    }
  } catch (err) {
    console.error(err);
    res.status(500).send("Server error");
  }
};

// Endpoint to get all pending invites for a user
const getPendingInvites = async (req, res) => {
  const userId = req.userId; // Expect userId to be sent in the request body

  if (!userId) {
    return res.status(400).json({ message: "User ID is required" });
  }

  try {
    // Fetch all pending invites where the user is either the inviter or the receiver
    const pendingInvites = await Invite.find({
      userReceiving: userId,
      status: "pending",
    })
      .populate("userInviting", "username")
      .populate("rootId", "name"); // Populate the username field for userReceiving

    // Return the found invites
    return res.status(200).json({ invites: pendingInvites });
  } catch (error) {
    console.error("Error fetching pending invites:", error);
    return res
      .status(500)
      .json({ message: "Server error, could not fetch pending invites" });
  }
};

module.exports = {
  invite,
  inviteAccept,
  getPendingInvites,
};
