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
  const { Being, Node, Artifact } = core.models;
  const { logDid } = core.dids;
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
          userInvitingId: req.beingId,
          canopyId: userReceiving,
          rootId,
          Node,
          Being,
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
        userInvitingId: req.beingId,
        userReceiving,
        rootId,
        isToBeOwner: false,
        isUninviting: false,
        Node,
          Being,
        logDid,
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
        userInvitingId: req.beingId,
        userReceiving,
        rootId,
        isToBeOwner: true,
        isUninviting: false,
        Node,
          Being,
        logDid,
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
        userInvitingId: req.beingId,
        userReceiving,
        rootId,
        isToBeOwner: false,
        isUninviting: true,
        Node,
          Being,
        logDid,
        escapeRegex,
        queueCanopyEvent,
        ownership,
      });

      if ("html" in req.query) {
        return res.redirect(
          `/api/v1/user/${req.beingId}?token=${req.query.token ?? ""}&html`,
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
        userInvitingId: req.beingId,
        userReceiving: req.beingId,
        rootId,
        isToBeOwner: false,
        isUninviting: true,
        Node,
          Being,
        logDid,
        escapeRegex,
        queueCanopyEvent,
        ownership,
      });

      if ("html" in req.query) {
        return res.redirect(
          `/api/v1/user/${req.beingId}?token=${req.query.token ?? ""}&html`,
        );
      }

      return sendOk(res);
    } catch (err) {
      return sendError(res, 400, ERR.INVALID_INPUT, err.message);
    }
  });

  // ── Invite list + respond (moved from routes/api/user.js) ─────────

  router.get("/user/:beingId/invites", htmlAuth, async (req, res) => {
    try {
      const { beingId } = req.params;

      if (req.beingId.toString() !== beingId.toString()) {
        return sendError(res, 403, ERR.FORBIDDEN, "Not authorized");
      }

      const invites = await getPendingInvitesForUser(beingId);

      const wantHtml = "html" in req.query;
      if (!wantHtml || !getExtension("html-rendering")) {
        return sendOk(res, { invites });
      }

      const token = req.query.token ?? "";
      return res.send(renderInvites({ beingId, invites, token }));
    } catch (err) {
      sendError(res, 500, ERR.INTERNAL, err.message);
    }
  });

  router.post(
    "/user/:beingId/invites/:inviteId",
    authenticate,

    async (req, res) => {
      try {
        const { beingId, inviteId } = req.params;
        const { accept } = req.body;

        if (req.beingId.toString() !== beingId.toString()) {
          return sendError(res, 403, ERR.FORBIDDEN, "Not authorized");
        }

        const acceptInvite = accept === true || accept === "true";

        await respondToInvite({
          inviteId,
          beingId: req.beingId,
          acceptInvite,
          Node,
          Being,
          logDid,
          queueCanopyEvent,
          ownership,
        });

        if ("html" in req.query) {
          return res.redirect(
            `/api/v1/user/${beingId}/invites?token=${req.query.token ?? ""}&html`,
          );
        }

        return sendOk(res, { accepted: acceptInvite });
      } catch (err) {
        return sendError(res, 400, ERR.INVALID_INPUT, err.message);
      }
    },
  );

  // ── Tags (moved from extensions/user-queries) ─────────────────────

  router.get("/user/:beingId/tags", htmlAuth, async (req, res) => {
    try {
      const beingId = req.params.beingId;
      const wantHtml = Object.prototype.hasOwnProperty.call(req.query, "html");
      const startDate = req.query.startDate;
      const endDate = req.query.endDate;

      const token = req.query.token ?? "";
      const rawLimit = req.query.limit;
      const limit = rawLimit !== undefined ? Number(rawLimit) : undefined;

      if (limit !== undefined && (isNaN(limit) || limit <= 0)) {
        return sendError(res, 400, ERR.INVALID_INPUT, "Invalid limit: must be a positive number");
      }

      const result = await getAllTagsForUser(beingId, limit, startDate, endDate, Artifact);

      const notes = result.artifacts.map((n) => ({
        ...n,
        content: n.origin === "filesystem" ? `/api/v1/uploads/${n.content?.path || ""}` : n.content,
      }));

      if (!wantHtml || !getExtension("html-rendering")) {
        return sendOk(res, { taggedBy: result.taggedBy, notes });
      }

      const user = await Being.findById(beingId).lean();
      const getNodeName = (await import("../../routes/api/helpers/getNameById.js")).default;
      return res.send(await renderUserTags({ beingId, user, notes, getNodeName, token }));
    } catch (err) {
      sendError(res, 400, ERR.INVALID_INPUT, err.message);
    }
  });

  return router;
}
