import log from "../../seed/log.js";
import express from "express";
import Node from "../../seed/models/node.js";
import authenticate from "../../seed/middleware/authenticate.js";
import { sendOk, sendError, ERR } from "../../seed/protocol.js";
import {
  ensureVersionWallet,
  syncVersionSOLBalance,
  syncVersionTokenHoldings,
  getVersionWalletInfo,
  sendSOLFromVersion,
  swapFromVersion,
} from "./core.js";
import { renderSolanaNoWallet, renderSolanaWallet } from "./html.js";
import { getExtension } from "../loader.js";

const router = express.Router();

function parseVersion(v) {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0) return null;
  return n;
}

function isLikelySolanaAddress(value) {
  return (
    typeof value === "string" && (value.length === 43 || value.length === 44)
  );
}

function isLikelyNodeId(value) {
  return typeof value === "string" && value.length === 36;
}

const allowedParams = ["html", "token", "success", "sig", "error"];

// GET wallet info + balances
router.get(
  "/node/:nodeId/:version/values/solana",
  authenticate,
  async (req, res) => {
    try {
      const { nodeId, version } = req.params;
      const parsedVersion = parseVersion(version);
      if (parsedVersion === null) {
        return sendError(res, 400, ERR.INVALID_INPUT, "Invalid version");
      }

      const filtered = Object.entries(req.query)
        .filter(([key]) => allowedParams.includes(key))
        .map(([key, val]) => (val === "" ? key : `${key}=${val}`))
        .join("&");
      const queryString = filtered ? `?${filtered}` : "";

      const node = await Node.findById(nodeId);
      await syncVersionSOLBalance(node, parsedVersion);
      await syncVersionTokenHoldings(node, parsedVersion);
      const walletInfo = await getVersionWalletInfo(nodeId, parsedVersion);

      if (
        !("html" in req.query) ||
        !getExtension("html-rendering")
      ) {
        return sendOk(res, { nodeId, version: parsedVersion, ...walletInfo });
      }

      const token = req.query.token ?? "";

      if (!walletInfo.exists) {
        return res.send(
          renderSolanaNoWallet({ nodeId, parsedVersion, queryString, token }),
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
 log.error("Solana", "Error in /node/:nodeId/:version/values/solana:", err);
      sendError(res, 500, ERR.INTERNAL, err.message);
    }
  },
);

// POST create wallet
router.post(
  "/node/:nodeId/:version/values/solana",
  authenticate,
  async (req, res) => {
    try {
      const { nodeId, version } = req.params;
      const parsedVersion = parseVersion(version);
      if (parsedVersion === null) {
        return sendError(res, 400, ERR.INVALID_INPUT, "Invalid version");
      }

      await ensureVersionWallet(nodeId, parsedVersion);

      if ("html" in req.query) {
        return res.redirect(
          `/api/v1/node/${nodeId}/${parsedVersion}/values/solana?token=${
            req.query.token ?? ""
          }&html`,
        );
      }

      sendOk(res, {}, 201);
    } catch (err) {
      sendError(res, 500, ERR.INTERNAL, err.message);
    }
  },
);

// POST send SOL
router.post(
  "/node/:nodeId/:version/values/solana/send",
  authenticate,
  async (req, res) => {
    try {
      const { nodeId, version } = req.params;
      const { destination, amount } = req.body;
      const parsedVersion = parseVersion(version);
      if (parsedVersion === null) {
        return sendError(res, 400, ERR.INVALID_INPUT, "Invalid version");
      }

      if (typeof destination !== "string" || !destination.trim()) {
        return sendError(res, 400, ERR.INVALID_INPUT, "Destination is required");
      }

      const dest = destination.trim();
      let toAddress;
      let toNodeId;

      if (isLikelySolanaAddress(dest)) {
        toAddress = dest;
      } else if (isLikelyNodeId(dest)) {
        toNodeId = dest;
      } else {
        return sendError(res, 400, ERR.INVALID_INPUT, "Destination must be a Solana address or a nodeId");
      }

      const solAmount = Number(amount);
      if (!Number.isFinite(solAmount) || solAmount <= 0) {
        return sendError(res, 400, ERR.INVALID_INPUT, "Invalid SOL amount");
      }

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

      sendOk(res, { signature: result.signature, to: result.to });
    } catch (err) {
 log.error("Solana", "Send SOL error:", err);
      sendError(res, 500, ERR.INTERNAL, err.message);
    }
  },
);

// POST swap (Jupiter)
router.post(
  "/node/:nodeId/:version/values/solana/transaction",
  authenticate,
  async (req, res) => {
    const { nodeId, version } = req.params;
    const parsedVersion = parseVersion(version);

    try {
      if (parsedVersion === null) throw new Error("Invalid version");

      const { fromType, toType, amount, slippageBps } = req.body;
      const SOL_MINT = "So11111111111111111111111111111111111111112";

      if (!["sol", "token"].includes(fromType)) throw new Error("Invalid fromType");
      if (!["sol", "token"].includes(toType)) throw new Error("Invalid toType");
      if (fromType === "sol" && toType === "sol") throw new Error("SOL to SOL swap is not allowed");

      const inputMint = fromType === "sol" ? SOL_MINT : req.body.inputMint;
      const outputMint = toType === "sol" ? SOL_MINT : req.body.outputMint;

      const uiAmount = Number(amount);
      if (!Number.isFinite(uiAmount) || uiAmount <= 0) throw new Error("Invalid amount");

      const result = await swapFromVersion({
        nodeId,
        versionIndex: parsedVersion,
        inputMint,
        outputMint,
        amountUi: uiAmount,
        slippageBps,
      });

      if ("html" in req.query) {
        return res.redirect(
          `/api/v1/node/${nodeId}/${parsedVersion}/values/solana?` +
            `success=1&sig=${result.signature}&token=${req.query.token ?? ""}&html`,
        );
      }

      return sendOk(res, result);
    } catch (err) {
 log.error("Solana", "Swap transaction error:", err);

      if ("html" in req.query) {
        return res.redirect(
          `/api/v1/node/${nodeId}/${parsedVersion}/values/solana?` +
            `error=${encodeURIComponent(err.message)}&token=${req.query.token ?? ""}&html`,
        );
      }

      sendError(res, 500, ERR.INTERNAL, err.message);
    }
  },
);

// Versionless aliases (protocol-compliant)
router.get("/node/:nodeId/values/solana", authenticate, async (req, res) => {
  try {
    const info = await getVersionWalletInfo(req.params.nodeId, 0);
    if ("html" in req.query && getExtension("html-rendering")) {
      req.params.version = "0";
      // Fall through to versioned HTML route
      const node = await Node.findById(req.params.nodeId);
      if (!node) return sendError(res, 404, ERR.NODE_NOT_FOUND, "Node not found");
      return res.redirect(`/api/v1/node/${req.params.nodeId}/0/values/solana?${new URLSearchParams(req.query)}`);
    }
    sendOk(res, info);
  } catch (err) {
    sendError(res, 500, ERR.INTERNAL, err.message);
  }
});

router.post("/node/:nodeId/values/solana", authenticate, async (req, res) => {
  try {
    const result = await ensureVersionWallet(req.params.nodeId, 0);
    sendOk(res, { publicKey: result.publicKey, created: result.created }, 201);
  } catch (err) {
    sendError(res, 500, ERR.INTERNAL, err.message);
  }
});

export default router;
