import log from "../../seed/log.js";
import express from "express";
import authenticate from "../../seed/middleware/authenticate.js";
import { sendOk, sendError, ERR } from "../../seed/protocol.js";
import User from "../../seed/models/user.js";
import { getUserMeta } from "../../seed/tree/userMetadata.js";
import { createNode } from "../../seed/tree/treeManagement.js";
import { getExtension } from "../../extensions/loader.js";

const router = express.Router();

router.get("/user/:userId", authenticate, async (req, res) => {
  try {
    const { userId } = req.params;

    const user = await User.findById(userId).exec();

    if (!user) {
      return sendError(res, 404, ERR.USER_NOT_FOUND, "User not found");
    }
    (getExtension("energy")?.exports?.maybeResetEnergy || (() => false))(user);

    const roots = (await getExtension("navigation")?.exports?.getUserRootsWithNames(userId)) || [];
    const billingMeta = getUserMeta(user, "billing");
    const plan = billingMeta.plan || "basic";
    const energyData = getUserMeta(user, "energy");
    const energy = energyData.available;
    const canopyMeta = getUserMeta(user, "canopy");

    sendOk(res, {
      userId: user._id,
      username: user.username,
      roots,
      remoteRoots: canopyMeta.remoteRoots || [],
      isAdmin: user.isAdmin || false,
      plan,
      energy,
    });
  } catch (err) {
    log.error("API", "Error in /user/:userId:", err);
    sendError(res, 500, ERR.INTERNAL, err.message);
  }
});

router.post("/user/:userId/createRoot", authenticate, async (req, res) => {
  try {
    const { userId } = req.params;
    const { name, type } = req.body;

    if (req.userId.toString() !== userId.toString()) {
      return sendError(res, 403, ERR.FORBIDDEN, "Not authorized");
    }

    if (!name || typeof name !== "string") {
      return sendError(res, 400, ERR.INVALID_INPUT, "Name is required");
    }

    const rootNode = await createNode(
      name,
      null,
      0,
      null,
      true, // isRoot
      userId,
      {},
      {},
      null,
      req.user,
      false, // wasAi
      null, // chatId
      null, // sessionId
      type || null,
    );

    sendOk(res, {
      rootId: rootNode._id,
      root: rootNode,
    }, 201);
  } catch (err) {
    log.error("API", "createRoot error:", err);
    sendError(res, 400, ERR.INVALID_INPUT, err.message);
  }
});

router.use((err, req, res, next) => {
  if (err.code === "LIMIT_FILE_SIZE") {
    return sendError(res, 413, ERR.UPLOAD_TOO_LARGE, "File exceeds maximum size of 4 GB");
  }
  next(err);
});

export default router;
