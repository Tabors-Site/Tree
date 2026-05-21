import express from "express";
import authenticate from "../../seed/middleware/authenticate.js";
import { sendOk, sendError, ERR } from "../../seed/protocol.js";
import { getLatestDigest, getDigestHistory, getDigestConfig, generateDigest } from "./core.js";

const router = express.Router();

// GET /land/digest - show latest briefing
router.get("/land/digest", authenticate, async (req, res) => {
  try {
    let digest = await getLatestDigest();
    if (!digest) {
      digest = await generateDigest();
    }
    if (!digest) return sendOk(res, { message: "No digest available." });
    sendOk(res, digest);
  } catch (err) {
    sendError(res, 500, ERR.INTERNAL, err.message);
  }
});

// GET /land/digest/history - past briefings
router.get("/land/digest/history", authenticate, async (req, res) => {
  try {
    const history = await getDigestHistory();
    sendOk(res, { history });
  } catch (err) {
    sendError(res, 500, ERR.INTERNAL, err.message);
  }
});

// GET /land/digest/config - delivery settings
router.get("/land/digest/config", authenticate, async (req, res) => {
  try {
    const config = await getDigestConfig();
    sendOk(res, config);
  } catch (err) {
    sendError(res, 500, ERR.INTERNAL, err.message);
  }
});

export default router;
