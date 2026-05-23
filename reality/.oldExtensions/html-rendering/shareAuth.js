// Share token authentication for HTML-rendered pages.
// Moved from core/authenticate.js into the html-rendering extension.

import log from "../../seed/log.js";
import Being from "../../seed/models/being.js";
import { resolveRootNode } from "../../seed/tree/treeFetch.js";

export async function resolveHtmlShareAccess({ beingId, nodeId, shareToken }) {
  if (!shareToken) {
    return { allowed: false, reason: "Missing share token" };
  }

  // CASE 1: beingId-based access
  if (beingId && !nodeId) {
    const user = await Being.findOne({
      _id: beingId,
      "metadata.html.shareToken": shareToken,
    })
      .select("_id username")
      .lean()
      .exec();

    if (!user) {
      return { allowed: false, reason: "Invalid share token" };
    }

    return {
      allowed: true,
      matchedUserId: user._id,
      matchedUsername: user.username,
      scope: "user",
    };
  }

  // CASE 2: nodeId-based access
  if (nodeId) {
    const rootNode = await resolveRootNode(nodeId);

    const userIds = [
      rootNode.rootOwner,
      ...(rootNode.contributors || []),
    ].filter(Boolean);

    if (userIds.length === 0) {
      return { allowed: false, reason: "No users associated with root" };
    }

    const matchedUser = await Being.findOne({
      _id: { $in: userIds },
      "metadata.html.shareToken": shareToken,
    })
      .select("_id username")
      .lean()
      .exec();

    if (!matchedUser) {
      log.debug("Auth", "ShareAuth: DENIED nodeId=%s userIds=%j tokenPrefix=%s", nodeId, userIds, shareToken?.slice(0, 6));
      return { allowed: false, reason: "Invalid share token for node" };
    }

    return {
      allowed: true,
      rootId: rootNode._id.toString(),
      matchedUserId: matchedUser._id,
      matchedUsername: matchedUser.username,
      scope: "node",
    };
  }

  return {
    allowed: false,
    reason: "beingId or nodeId is required",
  };
}
