import express from "express";
import User from "../../db/models/user.js";
import authenticate from "../../middleware/authenticate.js";
import { notFoundPage } from "../../middleware/notFoundPage.js";
import { setHtmlShareToken } from "../../core/tree/user.js";
import { getUserMeta } from "../../core/tree/userMetadata.js";
import { renderShareToken } from "../../routes/api/html/user.js";

const router = express.Router();

router.get("/user/:userId/shareToken", authenticate, async (req, res) => {
  try {
    const { userId } = req.params;

    if (req.userId.toString() !== userId.toString()) {
      return res.status(403).send("Not authorized");
    }

    const user = await User.findById(userId)
      .select("username metadata")
      .lean();

    if (!user) {
      return notFoundPage(req, res, "This user doesn't exist.");
    }

    const token = getUserMeta(user, "html")?.shareToken;
    const tokenQS = req.query.token
      ? `?token=${req.query.token}&html`
      : "?html";

    return res.send(renderShareToken({ userId, user, token, tokenQS }));
  } catch (err) {
    console.error("shareToken page error:", err);
    res.status(500).send("Server error");
  }
});

router.post("/user/:userId/shareToken", authenticate, async (req, res) => {
  try {
    const { userId } = req.params;

    if (req.userId.toString() !== userId.toString()) {
      return res.status(403).json({ message: "Not authorized" });
    }

    const user = await User.findById(userId).select("htmlShareToken");
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const hadShareTokenBefore = Boolean(getUserMeta(user, "html")?.shareToken);

    const u = await setHtmlShareToken({
      userId,
      htmlShareToken: req.body.htmlShareToken,
    });

    if ("html" in req.query) {
      if (!hadShareTokenBefore) {
        return res.redirect("/dashboard");
      }
      return res.redirect(
        `/api/v1/user/${userId}?token=${getUserMeta(u, "html")?.shareToken ?? ""}&html`,
      );
    }

    return res.json({ success: true, shareToken: getUserMeta(u, "html")?.shareToken });
  } catch (err) {
    console.error("shareToken update error:", err);
    if ("html" in req.query) {
      return res
        .status(400)
        .send(err.message || "Failed to update share token");
    }
    return res
      .status(400)
      .json({ error: err.message || "Failed to update share token" });
  }
});

export default router;
