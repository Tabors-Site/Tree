import express from "express";
import log from "../../seed/log.js";
import Node from "../../seed/models/node.js";
import User from "../../seed/models/user.js";
import { sendError, ERR } from "../../seed/protocol.js";
import urlAuth from "../html-rendering/urlAuth.js";
import { htmlOnly, buildQS, tokenQS } from "../html-rendering/htmlHelpers.js";
import { getExtension } from "../loader.js";
import { isHtmlEnabled } from "../html-rendering/config.js";
import {
  renderResetPasswordExpired,
  renderResetPasswordForm,
  renderResetPasswordMismatch,
  renderResetPasswordInvalid,
  renderResetPasswordSuccess,
} from "./pages/passwordReset.js";

export default function buildEmailHtmlRoutes() {
  const router = express.Router();

  router.get("/user/reset-password/:token", async (req, res) => {
    if (!isHtmlEnabled()) {
      return sendError(res, 404, ERR.EXTENSION_NOT_FOUND, "HTML rendering disabled");
    }
    try {
      const user = await User.findOne({
        "metadata.email.resetToken": req.params.token,
        "metadata.email.resetExpiry": { $gt: Date.now() },
      });
      if (!user) return res.send(renderResetPasswordExpired());
      return res.send(renderResetPasswordForm({ token: req.params.token }));
    } catch (err) {
      log.error("HTML", "Reset password form error:", err.message);
      sendError(res, 500, ERR.INTERNAL, err.message);
    }
  });

  router.post("/user/reset-password/:token", async (req, res) => {
    if (!isHtmlEnabled()) {
      return sendError(res, 404, ERR.EXTENSION_NOT_FOUND, "HTML rendering disabled");
    }
    try {
      const { password, confirm } = req.body;
      if (password !== confirm) {
        return res.send(renderResetPasswordMismatch({ token: req.params.token }));
      }

      const user = await User.findOne({
        "metadata.email.resetToken": req.params.token,
        "metadata.email.resetExpiry": { $gt: Date.now() },
      });
      if (!user) return res.send(renderResetPasswordInvalid());

      user.password = password;
      const emailMeta = (user.metadata instanceof Map ? user.metadata.get("email") : user.metadata?.email) || {};
      delete emailMeta.resetToken;
      delete emailMeta.resetExpiry;
      emailMeta.tokensInvalidBefore = new Date();
      if (user.metadata instanceof Map) user.metadata.set("email", emailMeta);
      else user.metadata.email = emailMeta;
      if (user.markModified) user.markModified("metadata");
      await user.save();

      return res.send(renderResetPasswordSuccess());
    } catch (err) {
      log.error("HTML", "Reset password error:", err.message);
      sendError(res, 500, ERR.INTERNAL, err.message);
    }
  });

  return router;
}
