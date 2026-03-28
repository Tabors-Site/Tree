import express from "express";
import authenticate from "../../seed/middleware/authenticate.js";
import { sendOk, sendError, ERR } from "../../seed/protocol.js";
import { createInvite, respondToInvite, getPendingInvitesForUser } from "./invites.js";
import { sendRemoteInvite } from "./remoteInvites.js";
import { getAllTagsForUser } from "./tags.js";
import { getExtension } from "../loader.js";
import { renderInvites } from "./pages/invites.js";
import { renderUserTags } from "./pages/userTags.js";

export function buildRouter(core, { escapeRegex, queueCanopyEvent }) {
  const htmlExt = getExtension("html-rendering");
  const htmlAuth = htmlExt?.exports?.urlAuth || authenticate;
  const router = express.Router();
  const { User, Node, Note } = core.models;
  const { logContribution } = core.contributions;
  const ownership = core.ownership;

  // ── Invite routes (moved from routes/api/root.js) ─────────────────

  // POST /root/:rootId/invite
  router.post("/root/:rootId/invite", authenticate, async (req, res) => {
    try {
      const { rootId } = req.params;
      const { userReceiving } = req.body;

      if (!userReceiving) {
        return sendError(res, 400, ERR.INVALID_INPUT, "userReceiving is required");
      }

      // Detect cross-land invite (username@domain.tld format)
      const atIndex = userReceiving.indexOf("@");
      const afterAt = atIndex > 0 ? userReceiving.slice(atIndex + 1) : "";
      if (atIndex > 0 && afterAt.includes(".") && afterAt.length > 2) {
        const RemoteUser = (await import("../../canopy/models/remoteUser.js")).default;
        const canopy = await import("../../canopy/identity.js");
        const peers = await import("../../canopy/peers.js");
        const horizon = await import("../../canopy/horizon.js");

        const result = await sendRemoteInvite({
          userInvitingId: req.userId,
          canopyId: userReceiving,
          rootId,
          Node,
          User,
          RemoteUser,
          canopy: {
            getLandIdentity: canopy.getLandIdentity,
            signCanopyToken: canopy.signCanopyToken,
            getPeerByDomain: peers.getPeerByDomain,
            getPeerBaseUrl: peers.getPeerBaseUrl,
            registerPeer: peers.registerPeer,
            lookupLandByDomain: horizon.lookupLandByDomain,
          },
        });

        if ("html" in req.query) {
          return res.redirect(
            `/api/v1/root/${rootId}?token=${req.query.token ?? ""}&html`,
          );
        }
        return sendOk(res, { remote: true, ...result });
      }

      await createInvite({
        userInvitingId: req.userId,
        userReceiving,
        rootId,
        isToBeOwner: false,
        isUninviting: false,
        Node,
        User,
        logContribution,
        escapeRegex,
        queueCanopyEvent,
        ownership,
      });

      if ("html" in req.query) {
        return res.redirect(
          `/api/v1/root/${rootId}?token=${req.query.token ?? ""}&html`,
        );
      }

      return sendOk(res);
    } catch (err) {
      return sendError(res, 400, ERR.INVALID_INPUT, err.message);
    }
  });

  // POST /root/:rootId/transfer-owner
  router.post("/root/:rootId/transfer-owner", authenticate, async (req, res) => {
    try {
      const { rootId } = req.params;
      const { userReceiving } = req.body;

      if (!userReceiving) {
        return sendError(res, 400, ERR.INVALID_INPUT, "userReceiving is required");
      }

      await createInvite({
        userInvitingId: req.userId,
        userReceiving,
        rootId,
        isToBeOwner: true,
        isUninviting: false,
        Node,
        User,
        logContribution,
        escapeRegex,
        queueCanopyEvent,
        ownership,
      });

      if ("html" in req.query) {
        return res.redirect(
          `/api/v1/root/${rootId}?token=${req.query.token ?? ""}&html`,
        );
      }

      return sendOk(res);
    } catch (err) {
      return sendError(res, 400, ERR.INVALID_INPUT, err.message);
    }
  });

  // POST /root/:rootId/remove-user
  router.post("/root/:rootId/remove-user", authenticate, async (req, res) => {
    try {
      const { rootId } = req.params;
      const { userReceiving } = req.body;

      if (!userReceiving) {
        return sendError(res, 400, ERR.INVALID_INPUT, "userReceiving is required");
      }

      await createInvite({
        userInvitingId: req.userId,
        userReceiving,
        rootId,
        isToBeOwner: false,
        isUninviting: true,
        Node,
        User,
        logContribution,
        escapeRegex,
        queueCanopyEvent,
        ownership,
      });

      if ("html" in req.query) {
        return res.redirect(
          `/api/v1/user/${req.userId}?token=${req.query.token ?? ""}&html`,
        );
      }

      return sendOk(res);
    } catch (err) {
      return sendError(res, 400, ERR.INVALID_INPUT, err.message);
    }
  });

  // POST /root/:rootId/retire
  router.post("/root/:rootId/retire", authenticate, async (req, res) => {
    try {
      const { rootId } = req.params;

      await createInvite({
        userInvitingId: req.userId,
        userReceiving: req.userId,
        rootId,
        isToBeOwner: false,
        isUninviting: true,
        Node,
        User,
        logContribution,
        escapeRegex,
        queueCanopyEvent,
        ownership,
      });

      if ("html" in req.query) {
        return res.redirect(
          `/api/v1/user/${req.userId}?token=${req.query.token ?? ""}&html`,
        );
      }

      return sendOk(res);
    } catch (err) {
      return sendError(res, 400, ERR.INVALID_INPUT, err.message);
    }
  });

  // ── Invite list + respond (moved from routes/api/user.js) ─────────

  router.get("/user/:userId/invites", htmlAuth, async (req, res) => {
    try {
      const { userId } = req.params;

      if (req.userId.toString() !== userId.toString()) {
        return sendError(res, 403, ERR.FORBIDDEN, "Not authorized");
      }

      const invites = await getPendingInvitesForUser(userId);

      const wantHtml = "html" in req.query;
      if (!wantHtml || !getExtension("html-rendering")) {
        return sendOk(res, { invites });
      }

      const token = req.query.token ?? "";
      return res.send(renderInvites({ userId, invites, token }));
    } catch (err) {
      sendError(res, 500, ERR.INTERNAL, err.message);
    }
  });

  router.post(
    "/user/:userId/invites/:inviteId",
    authenticate,

    async (req, res) => {
      try {
        const { userId, inviteId } = req.params;
        const { accept } = req.body;

        if (req.userId.toString() !== userId.toString()) {
          return sendError(res, 403, ERR.FORBIDDEN, "Not authorized");
        }

        const acceptInvite = accept === true || accept === "true";

        await respondToInvite({
          inviteId,
          userId: req.userId,
          acceptInvite,
          Node,
          User,
          logContribution,
          queueCanopyEvent,
          ownership,
        });

        if ("html" in req.query) {
          return res.redirect(
            `/api/v1/user/${userId}/invites?token=${req.query.token ?? ""}&html`,
          );
        }

        return sendOk(res, { accepted: acceptInvite });
      } catch (err) {
        return sendError(res, 400, ERR.INVALID_INPUT, err.message);
      }
    },
  );

  // ── Tags (moved from extensions/user-queries) ─────────────────────

  router.get("/user/:userId/tags", htmlAuth, async (req, res) => {
    try {
      const userId = req.params.userId;
      const wantHtml = Object.prototype.hasOwnProperty.call(req.query, "html");
      const startDate = req.query.startDate;
      const endDate = req.query.endDate;

      const token = req.query.token ?? "";
      const rawLimit = req.query.limit;
      const limit = rawLimit !== undefined ? Number(rawLimit) : undefined;

      if (limit !== undefined && (isNaN(limit) || limit <= 0)) {
        return sendError(res, 400, ERR.INVALID_INPUT, "Invalid limit: must be a positive number");
      }

      const result = await getAllTagsForUser(userId, limit, startDate, endDate, Note);

      const notes = result.notes.map((n) => ({
        ...n,
        content: n.contentType === "file" ? `/api/v1/uploads/${n.content}` : n.content,
      }));

      if (!wantHtml || !getExtension("html-rendering")) {
        return sendOk(res, { taggedBy: result.taggedBy, notes });
      }

      const user = await User.findById(userId).lean();
      const getNodeName = (await import("../../routes/api/helpers/getNameById.js")).default;
      return res.send(await renderUserTags({ userId, user, notes, getNodeName, token }));
    } catch (err) {
      sendError(res, 400, ERR.INVALID_INPUT, err.message);
    }
  });

  return router;
}
