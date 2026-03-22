import express from "express";
import authenticate from "../../middleware/authenticate.js";
import { addPrestige } from "./core.js";
import Node from "../../db/models/node.js";

const router = express.Router();

async function useLatest(req, res, next) {
  try {
    const node = await Node.findById(req.params.nodeId).select("prestige").lean();
    if (!node) return res.status(404).json({ error: "Node not found" });
    req.params.version = String(node.prestige);
    next();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

const prestigeHandler = async (req, res) => {
  try {
    const { nodeId, version } = req.params;
    const userId = req.userId;

    const nextVersion = Number(version) + 1;

    if (Number.isNaN(nextVersion)) {
      return res.status(400).json({ error: "Invalid version" });
    }

    const result = await addPrestige({
      nodeId,
      userId,
    });

    if ("html" in req.query) {
      return res.redirect(
        `/api/v1/node/${nodeId}/${nextVersion}?token=${req.query.token ?? ""}&html`,
      );
    }

    res.json({ success: true, ...result });
  } catch (err) {
    console.error("prestige error:", err);
    res.status(400).json({ error: err.message });
  }
};

router.post("/node/:nodeId/prestige", authenticate, useLatest, prestigeHandler);
router.post("/node/:nodeId/:version/prestige", authenticate, prestigeHandler);

export default router;
