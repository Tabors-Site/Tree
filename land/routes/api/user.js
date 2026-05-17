import log from "../../seed/log.js";
import express from "express";
import authenticate from "../../seed/middleware/authenticate.js";
import { sendOk, sendError, ERR } from "../../seed/protocol.js";
import Being from "../../seed/models/being.js";
import { getBeingMeta } from "../../seed/tree/beingMetadata.js";
import { createNode } from "../../seed/tree/treeManagement.js";
import { getExtension } from "../../extensions/loader.js";

const router = express.Router();

router.get("/user/:beingId", authenticate, async (req, res) => {
  try {
    const { beingId } = req.params;

    const user = await Being.findById(beingId).exec();

    if (!user) {
      return sendError(res, 404, ERR.USER_NOT_FOUND, "User not found");
    }
    (getExtension("energy")?.exports?.maybeResetEnergy || (() => false))(user);

    const navExt = getExtension("navigation")?.exports;
    const roots = (await navExt?.getUserRootsWithNames(beingId)) || [];
    const recentRoots = navExt?.getRecentRootsWithNames ? (await navExt.getRecentRootsWithNames(beingId)) : [];
    const billingMeta = getBeingMeta(user, "billing");
    const plan = billingMeta.plan || "basic";
    const energyData = getBeingMeta(user, "energy");
    const energy = energyData.available;
    const canopyMeta = getBeingMeta(user, "canopy");

    sendOk(res, {
      beingId: user._id,
      username: user.username,
      roots,
      recentRoots,
      remoteRoots: canopyMeta.remoteRoots || [],
      isAdmin: user.isAdmin || false,
      plan,
      energy,
    });
  } catch (err) {
    log.error("API", "Error in /user/:beingId:", err);
    sendError(res, 500, ERR.INTERNAL, err.message);
  }
});

router.post("/user/:beingId/createRoot", authenticate, async (req, res) => {
  try {
    const { beingId } = req.params;
    const { name, type } = req.body;

    if (req.beingId.toString() !== beingId.toString()) {
      return sendError(res, 403, ERR.FORBIDDEN, "Not authorized");
    }

    if (!name || typeof name !== "string") {
      return sendError(res, 400, ERR.INVALID_INPUT, "Name is required");
    }

    const rootNode = await createNode({
      name,
      isRoot: true,
      beingId,
      type: type || null,
      validatedUser: req.user,
    });

    // HTML form submission: redirect back to user page
    if ("html" in req.query) {
      const token = req.query.token ? `&token=${req.query.token}` : "";
      return res.redirect(`/api/v1/user/${beingId}?html${token}`);
    }

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
