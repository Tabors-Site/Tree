import express from "express";
import urlAuth from "../../middleware/urlAuth.js";
import { findNodeById } from "../../db/utils.js";
import Node from "../../db/models/node.js";
import { resolveVersion } from "../../core/tree/treeFetch.js";
import authenticate from "../../middleware/authenticate.js";
import { setValueForNode, setGoalForNode } from "../../core/tree/values.js";
import {
  getVersionWalletInfo,
  ensureVersionWallet,
  syncVersionSOLBalance,
  syncVersionTokenHoldings,
  sendSOLFromVersion,
  swapFromVersion,
} from "../../core/tree/solana.js";
import {
  renderValues,
  renderSolanaNoWallet,
  renderSolanaWallet,
} from "./html/values.js";

const router = express.Router();

// Resolve "latest" to actual prestige number for any route with :version
router.param("version", async (req, res, next, val) => {
  try {
    req.params.version = String(await resolveVersion(req.params.nodeId, val));
    next();
  } catch (err) {
    return res.status(404).json({ error: err.message });
  }
});

async function useLatest(req, res, next) {
  try {
    req.params.version = String(await resolveVersion(req.params.nodeId, "latest"));
    next();
  } catch (err) {
    return res.status(404).json({ error: err.message });
  }
}

const allowedParams = ["token", "html"];

// SET VALUE
router.post("/node/:nodeId/:version/value", authenticate, async (req, res) => {
  try {
    const { nodeId, version } = req.params;
    const { key, value } = req.body;

    await setValueForNode({
      nodeId,
      version,
      key,
      value,
      userId: req.userId,
    });

    if ("html" in req.query) {
      return res.redirect(
        `/api/v1/node/${nodeId}/${version}/values?token=${req.query.token ?? ""}&html`,
      );
    }

    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// SET GOAL
router.post("/node/:nodeId/:version/goal", authenticate, async (req, res) => {
  try {
    const { nodeId, version } = req.params;
    const { key, goal } = req.body;

    await setGoalForNode({
      nodeId,
      version,
      key,
      goal,
      userId: req.userId,
    });

    if ("html" in req.query) {
      return res.redirect(
        `/api/v1/node/${nodeId}/${version}/values?token=${req.query.token ?? ""}&html`,
      );
    }

    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

router.get("/node/:nodeId/:version/values", urlAuth, async (req, res) => {
  try {
    const { nodeId, version } = req.params;

    const parsedVersion = Number(version);
    if (isNaN(parsedVersion)) {
      return res.status(400).json({
        error: "Invalid version: must be a number",
      });
    }

    const filtered = Object.entries(req.query)
      .filter(([key]) => allowedParams.includes(key))
      .map(([key, val]) => (val === "" ? key : `${key}=${val}`))
      .join("&");

    const queryString = filtered ? `?${filtered}` : "";

    const node = await findNodeById(nodeId);
    if (!node) {
      return res.status(404).json({ error: "Node not found" });
    }

    const versionData = node.versions?.[parsedVersion];
    const nodeName = node.name || nodeId;
    const nodeVersion = node.prestige || 0;

    if (!versionData) {
      return res.status(404).json({
        error: `Version ${parsedVersion} not found`,
      });
    }

    const values = Object.fromEntries(versionData.values || []);
    const goals = Object.fromEntries(versionData.goals || []);

    const allKeys = Array.from(
      new Set([...Object.keys(values), ...Object.keys(goals)]),
    ).sort();

    // JSON MODE
    const wantHtml = Object.prototype.hasOwnProperty.call(req.query, "html");
    if (!wantHtml || process.env.ENABLE_FRONTEND_HTML !== "true") {
      return res.json({
        nodeId,
        version: parsedVersion,
        values,
        goals,
      });
    }

    return res.send(
      renderValues({
        nodeId,
        version: parsedVersion,
        nodeName,
        nodeVersion,
        allKeys,
        values,
        goals,
        queryString,
        token: req.query.token ?? "",
      }),
    );
  } catch (err) {
    console.error("Error in /node/:nodeId/:version/values:", err);
    res.status(500).json({ error: err.message });
  }
});

router.get(
  "/node/:nodeId/:version/values/solana",
  authenticate,
  async (req, res) => {
    try {
      const { nodeId, version } = req.params;
      const parsedVersion = Number(version);

      if (!Number.isInteger(parsedVersion) || parsedVersion < 0) {
        return res.status(400).json({ error: "Invalid version" });
      }

      const filtered = Object.entries(req.query)
        .filter(([key]) => allowedParams.includes(key))
        .map(([key, val]) => (val === "" ? key : `${key}=${val}`))
        .join("&");

      const queryString = filtered ? `?${filtered}` : "";
      //update values, may need to update as it happens on every page loads
      const node = await Node.findById(nodeId);
      await syncVersionSOLBalance(node, parsedVersion);
      await syncVersionTokenHoldings(node, parsedVersion);
      const walletInfo = await getVersionWalletInfo(nodeId, parsedVersion);

      // JSON MODE
      if (
        !("html" in req.query) ||
        process.env.ENABLE_FRONTEND_HTML !== "true"
      ) {
        return res.json({
          nodeId,
          version: parsedVersion,
          ...walletInfo,
        });
      }

      /* ---------------- HTML MODE ---------------- */
      const token = req.query.token ?? "";

      // FIRST - No wallet exists (create wallet page)
      if (!walletInfo.exists) {
        return res.send(
          renderSolanaNoWallet({
            nodeId,
            parsedVersion,
            queryString,
            token,
          }),
        );
      }

      return res.send(
        renderSolanaWallet({
          nodeId,
          parsedVersion,
          queryString,
          token,
          walletInfo,
          successMsg: req.query.success ? { sig: req.query.sig } : null,
          errorMsg: req.query.error || null,
        }),
      );
    } catch (err) {
      console.error("Error in /node/:nodeId/:version/values/solana:", err);
      res.status(500).json({ error: err.message });
    }
  },
);

router.post(
  "/node/:nodeId/:version/values/solana",
  authenticate,

  async (req, res) => {
    try {
      const { nodeId, version } = req.params;
      const parsedVersion = Number(version);

      if (!Number.isInteger(parsedVersion) || parsedVersion < 0) {
        return res.status(400).json({ error: "Invalid version" });
      }

      await ensureVersionWallet(nodeId, parsedVersion);

      if ("html" in req.query) {
        return res.redirect(
          `/api/v1/node/${nodeId}/${parsedVersion}/values/solana?token=${
            req.query.token ?? ""
          }&html`,
        );
      }

      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  },
);

function isLikelySolanaAddress(value) {
  return (
    typeof value === "string" && (value.length === 43 || value.length === 44)
  );
}

function isLikelyNodeId(value) {
  return typeof value === "string" && value.length === 36;
}

router.post(
  "/node/:nodeId/:version/values/solana/send",
  authenticate,

  async (req, res) => {
    try {
      const { nodeId, version } = req.params;
      const { destination, amount } = req.body;

      const parsedVersion = Number(version);
      if (!Number.isInteger(parsedVersion) || parsedVersion < 0) {
        return res.status(400).json({ error: "Invalid version" });
      }

      if (typeof destination !== "string" || !destination.trim()) {
        return res.status(400).json({ error: "Destination is required" });
      }

      const dest = destination.trim();

      let toAddress;
      let toNodeId;

      if (isLikelySolanaAddress(dest)) {
        toAddress = dest;
      } else if (isLikelyNodeId(dest)) {
        toNodeId = dest;
      } else {
        return res.status(400).json({
          error: "Destination must be a Solana address or a nodeId",
        });
      }

      const solAmount = Number(amount);
      if (!Number.isFinite(solAmount) || solAmount <= 0) {
        return res.status(400).json({ error: "Invalid SOL amount" });
      }

      // SOL → lamports
      const lamports = Math.round(solAmount * 1e9);

      const result = await sendSOLFromVersion({
        nodeId,
        versionIndex: parsedVersion,
        toAddress,
        toNodeId,
        lamports,
      });

      if ("html" in req.query) {
        return res.redirect(
          `/api/v1/node/${nodeId}/${parsedVersion}/values/solana?token=${
            req.query.token ?? ""
          }&html`,
        );
      }

      res.json({
        success: true,
        signature: result.signature,
        to: result.to,
      });
    } catch (err) {
      console.error("Send SOL error:", err);
      res.status(500).json({ error: err.message });
    }
  },
);

router.post(
  "/node/:nodeId/:version/values/solana/transaction",
  authenticate,

  async (req, res) => {
    const { nodeId, version } = req.params;
    const parsedVersion = Number(version);

    try {
      if (!Number.isInteger(parsedVersion) || parsedVersion < 0) {
        throw new Error("Invalid version");
      }

      const { fromType, toType, amount, slippageBps } = req.body;
      const SOL_MINT = "So11111111111111111111111111111111111111112";

      if (!["sol", "token"].includes(fromType)) {
        throw new Error("Invalid fromType");
      }
      if (!["sol", "token"].includes(toType)) {
        throw new Error("Invalid toType");
      }
      if (fromType === "sol" && toType === "sol") {
        throw new Error("SOL to SOL swap is not allowed");
      }

      const inputMint = fromType === "sol" ? SOL_MINT : req.body.inputMint;
      const outputMint = toType === "sol" ? SOL_MINT : req.body.outputMint;

      const uiAmount = Number(amount);
      if (!Number.isFinite(uiAmount) || uiAmount <= 0) {
        throw new Error("Invalid amount");
      }

      const result = await swapFromVersion({
        nodeId,
        versionIndex: parsedVersion,
        inputMint,
        outputMint,
        amountUi: uiAmount,
        slippageBps,
      });

      /* ---------------- SUCCESS ---------------- */

      if ("html" in req.query) {
        return res.redirect(
          `/api/v1/node/${nodeId}/${parsedVersion}/values/solana?` +
            `success=1&sig=${result.signature}&token=${
              req.query.token ?? ""
            }&html`,
        );
      }

      return res.json({ success: true, ...result });
    } catch (err) {
      console.error("Swap transaction error:", err);

      /* ---------------- FAILURE ---------------- */

      if ("html" in req.query) {
        return res.redirect(
          `/api/v1/node/${nodeId}/${parsedVersion}/values/solana?` +
            `error=${encodeURIComponent(err.message)}&token=${
              req.query.token ?? ""
            }&html`,
        );
      }

      res.status(500).json({ error: err.message });
    }
  },
);

// Versionless aliases (protocol-compliant)
router.get("/node/:nodeId/values", urlAuth, useLatest, (req, res, next) => {
  req.url = `/node/${req.params.nodeId}/${req.params.version}/values`;
  router.handle(req, res, next);
});

router.post("/node/:nodeId/value", authenticate, useLatest, (req, res, next) => {
  req.url = `/node/${req.params.nodeId}/${req.params.version}/value`;
  router.handle(req, res, next);
});

router.post("/node/:nodeId/goal", authenticate, useLatest, (req, res, next) => {
  req.url = `/node/${req.params.nodeId}/${req.params.version}/goal`;
  router.handle(req, res, next);
});

export default router;
