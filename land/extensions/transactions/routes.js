import log from "../../seed/log.js";
import express from "express";
import { sendOk, sendError, ERR } from "../../seed/protocol.js";
import authenticate, { authenticateOptional } from "../../seed/middleware/authenticate.js";

import {
  setTransactionPolicy,
  getTransactions,
  createTransaction,
  applyApproval,
  denyTransaction,
  getTransactionWithContributions,
} from "./core.js";
import getNodeName from "../../routes/api/helpers/getNameById.js";
import {
  renderTransactionsList,
  renderTransactionDetail,
} from "./html.js";

import Node from "../../seed/models/node.js";
import { getExtension } from "../loader.js";

async function resolveVersion(nodeId, version) {
  if (version === "latest" || version === undefined) {
    const node = await Node.findById(nodeId).select("metadata").lean();
    const meta = node?.metadata instanceof Map ? Object.fromEntries(node.metadata) : (node?.metadata || {});
    return meta.version?.current || 0;
  }
  return Number(version);
}

const router = express.Router();
const allowedParams = ["token", "html"];

// Resolve "latest" to actual prestige number
router.param("version", async (req, res, next, val) => {
  try {
    req.params.version = String(await resolveVersion(req.params.nodeId, val));
    next();
  } catch (err) {
    return sendError(res, 404, ERR.NODE_NOT_FOUND, err.message);
  }
});

/**
 * Parse JSON safely for values payloads.
 * Always returns a plain object. Throws a 400-friendly Error on invalid JSON.
 */
function safeParseValues(input) {
  if (input == null || input === "") return {};
  if (typeof input !== "string") {
    // In case you ever send JSON already parsed (e.g. fetch with JSON body)
    if (typeof input === "object") return input ?? {};
    return {};
  }

  try {
    const parsed = JSON.parse(input);
    return typeof parsed === "object" &&
      parsed !== null &&
      !Array.isArray(parsed)
      ? parsed
      : {};
  } catch {
    throw new Error("Invalid JSON in values");
  }
}

/**
 * Sanitize values to:
 * - block mongo operators / dot paths
 * - allow only finite numbers
 * - normalize -0 to 0
 */
function sanitizeValuesObject(obj) {
  const clean = {};

  for (const [key, value] of Object.entries(obj || {})) {
    if (typeof key !== "string") continue;
    if (key.startsWith("$") || key.includes(".")) continue;
    if (key === "__proto__" || key === "constructor" || key === "prototype")
      continue;

    if (typeof value !== "number" || !Number.isFinite(value)) continue;

    clean[key] = Object.is(value, -0) ? 0 : value;
  }

  return clean;
}

/**
 * Basic semantic checks to keep behavior consistent with your backend:
 * - A NODE can send values (valuesA / valuesB depending on which side is NODE)
 * - OUTSIDE is only a counterparty reference and cannot mint/receive values directly via this route
 *   (If you *want* minting, remove this rule.)
 */
function validateTransactionSemantics(normalized) {
  const hasA = Object.keys(normalized.valuesA || {}).length > 0;
  const hasB = Object.keys(normalized.valuesB || {}).length > 0;

  if (!hasA && !hasB) {
    throw new Error("Transaction must trade at least one value");
  }

  // If a side is OUTSIDE, it must not carry a values payload on that side.
  // (Prevents accidental minting or confusing directionality.)
  if (normalized.sideA.kind === "OUTSIDE" && hasA) {
    throw new Error("Outside side cannot send values");
  }
  if (normalized.sideB.kind === "OUTSIDE" && hasB) {
    throw new Error("Outside side cannot send values");
  }

  // If one side is OUTSIDE, the other side must be NODE (your core logic enforces this too,
  // but we keep input errors friendly here).
  const outsideCount =
    (normalized.sideA.kind === "OUTSIDE" ? 1 : 0) +
    (normalized.sideB.kind === "OUTSIDE" ? 1 : 0);

  if (outsideCount > 1) {
    throw new Error("Only one transaction side may be OUTSIDE.");
  }

  // If NODE ↔ OUTSIDE, require the NODE side's version index to be present.
  if (normalized.sideA.kind === "NODE") {
    if (
      typeof normalized.versionAIndex !== "number" ||
      isNaN(normalized.versionAIndex)
    ) {
      throw new Error("versionAIndex is required for NODE sideA");
    }
  }
}

/**
 * LIST TRANSACTIONS FOR NODE + VERSION
 */
router.get("/node/:nodeId/:version/transactions", authenticateOptional, async (req, res) => {
  try {
    const { nodeId, version } = req.params;
    const parsedVersion = Number(version);

    if (isNaN(parsedVersion)) {
      return sendError(res, 400, ERR.INVALID_INPUT, "Invalid version");
    }

    const filtered = Object.entries(req.query)
      .filter(([key]) => allowedParams.includes(key))
      .map(([key, val]) => (val === "" ? key : `${key}=${val}`))
      .join("&");

    const queryString = filtered ? `?${filtered}` : "";

    const result = await getTransactions({
      nodeId,
      version: parsedVersion,
      includePending: true,
      userId: req.userId,
    });

    const wantHtml = "html" in req.query;

    // JSON MODE
    if (!wantHtml || !getExtension("html-rendering")) {
      return sendOk(res, {
        nodeId,
        version: parsedVersion,
        ...result,
      });
    }

    const nodeName = await getNodeName(nodeId);
    const transactions = result.transactions || [];

    return res.send(
      renderTransactionsList({
        nodeId,
        version: parsedVersion,
        nodeName,
        transactions,
        queryString,
      }),
    );
  } catch (err) {
 log.error("Transactions", "transactions list error:", err);
    sendError(res, 500, ERR.INTERNAL, err.message);
  }
});

/**
 * CREATE TRANSACTION
 */
router.post(
  "/node/:nodeId/:version/transactions",
  authenticate,

  async (req, res) => {
    try {
      const normalized = normalizeTransactionBody(req.body);

      // Friendly input-level checks (prevents confusing backend behavior)
      validateTransactionSemantics(normalized);

      const transaction = await createTransaction({
        ...normalized,
        userId: req.userId,
      });

      if ("html" in req.query) {
        return res.redirect(
          `/api/v1/node/${req.params.nodeId}/${req.params.version}/transactions${
            req.query.token ? `?token=${req.query.token}&html` : "?html"
          }`,
        );
      }

      return sendOk(res, { transaction });
    } catch (err) {
      sendError(res, 400, ERR.INVALID_INPUT, err.message);
    }
  },
);

/**
 * APPROVE TRANSACTION
 */
router.post(
  "/node/:nodeId/:version/transactions/:transactionId/approve",
  authenticate,

  async (req, res) => {
    try {
      const tx = await applyApproval(req.params.transactionId, req.userId);

      if ("html" in req.query) {
        const qs = [];
        if (req.query.token) qs.push(`token=${req.query.token}`);
        qs.push("html");
        return res.redirect(
          `/api/v1/node/${req.params.nodeId}/${
            req.params.version
          }/transactions?${qs.join("&")}`,
        );
      }

      return sendOk(res, { transaction: tx });
    } catch (err) {
      sendError(res, 400, ERR.INVALID_INPUT, err.message);
    }
  },
);
router.post(
  "/node/:nodeId/:version/transactions/:transactionId/deny",
  authenticate,

  async (req, res) => {
    try {
      await denyTransaction(req.params.transactionId, req.userId);

      if ("html" in req.query) {
        const qs = [];
        if (req.query.token) qs.push(`token=${req.query.token}`);
        qs.push("html");

        return res.redirect(
          `/api/v1/node/${req.params.nodeId}/${
            req.params.version
          }/transactions?${qs.join("&")}`,
        );
      }

      sendOk(res);
    } catch (err) {
      sendError(res, 400, ERR.INVALID_INPUT, err.message);
    }
  },
);

/**
 * Normalize & sanitize request body to match the core transaction backend.
 * - valuesA/valuesB become clean plain objects of finite numbers only
 * - indices become Numbers when present
 */
function normalizeTransactionBody(body) {
  const sideA = {
    kind: body["sideA.kind"],
    nodeId: body["sideA.nodeId"],
    sourceType: body["sideA.sourceType"],
    sourceId: body["sideA.sourceId"],
  };

  const sideB = {
    kind: body["sideB.kind"],
    nodeId: body["sideB.nodeId"],
    sourceType: body["sideB.sourceType"],
    sourceId: body["sideB.sourceId"],
  };

  const rawA = safeParseValues(body.valuesA);
  const rawB = safeParseValues(body.valuesB);

  const valuesA = sanitizeValuesObject(rawA);
  const valuesB = sanitizeValuesObject(rawB);

  return {
    sideA,
    sideB,
    versionAIndex:
      body.versionAIndex !== undefined && body.versionAIndex !== ""
        ? Number(body.versionAIndex)
        : undefined,
    versionBIndex:
      body.versionBIndex !== undefined && body.versionBIndex !== ""
        ? Number(body.versionBIndex)
        : undefined,
    valuesA,
    valuesB,
  };
}

/**
 * GET TRANSACTION + ALL CONTRIBUTIONS
 * GET /transactions/:transactionId
 */
router.get(
  "/node/:nodeId/:version/transactions/:transactionId",
  authenticateOptional,
  async (req, res) => {
    try {
      const { nodeId, version, transactionId } = req.params;

      const filtered = Object.entries(req.query)
        .filter(([key]) => allowedParams.includes(key))
        .map(([key, val]) => (val === "" ? key : `${key}=${val}`))
        .join("&");

      const queryString = filtered ? `?${filtered}` : "";

      const result = await getTransactionWithContributions(transactionId);

      const wantHtml = "html" in req.query;

      // JSON MODE
      if (!wantHtml || !getExtension("html-rendering")) {
        return sendOk(res, result);
      }

      const tx = result.transaction;
      const contributions = result.contributions || [];

      // Get node names
      const sideANodeName =
        tx.sideA.kind === "NODE"
          ? await getNodeName(tx.sideA.nodeId)
          : "External Source";

      const sideBNodeName =
        tx.sideB.kind === "NODE"
          ? await getNodeName(tx.sideB.nodeId)
          : "External Source";

      return res.send(
        renderTransactionDetail({
          nodeId,
          version,
          transactionId,
          tx,
          contributions,
          sideANodeName,
          sideBNodeName,
          queryString,
        }),
      );
    } catch (err) {
      const status =
        err.message === "Transaction not found" ||
        err.message === "transactionId is required"
          ? 400
          : 500;

      const code = status === 400 ? ERR.INVALID_INPUT : ERR.INTERNAL;
      sendError(res, status, code, err.message);
    }
  },
);

// Versionless aliases (protocol-compliant)
async function useLatest(req, res, next) {
  try {
    req.params.version = String(await resolveVersion(req.params.nodeId, "latest"));
    next();
  } catch (err) {
    return sendError(res, 404, ERR.NODE_NOT_FOUND, err.message);
  }
}

router.get("/node/:nodeId/transactions", authenticateOptional, useLatest, (req, res, next) => {
  req.url = `/node/${req.params.nodeId}/${req.params.version}/transactions`;
  router.handle(req, res, next);
});

router.post("/node/:nodeId/transactions", authenticate, useLatest, (req, res, next) => {
  req.url = `/node/${req.params.nodeId}/${req.params.version}/transactions`;
  router.handle(req, res, next);
});

router.post("/node/:nodeId/transactions/:transactionId/approve", authenticate, useLatest, (req, res, next) => {
  req.url = `/node/${req.params.nodeId}/${req.params.version}/transactions/${req.params.transactionId}/approve`;
  router.handle(req, res, next);
});

router.post("/node/:nodeId/transactions/:transactionId/deny", authenticate, useLatest, (req, res, next) => {
  req.url = `/node/${req.params.nodeId}/${req.params.version}/transactions/${req.params.transactionId}/deny`;
  router.handle(req, res, next);
});

// Transaction policy (moved from routes/api/root.js)
router.post("/root/:nodeId/transaction-policy", authenticate, async (req, res) => {
  try {
    const { nodeId } = req.params;
    const { policy } = req.body;

    const result = await setTransactionPolicy({
      rootNodeId: nodeId,
      policy,
      userId: req.userId,
    });

    if ("html" in req.query) {
      return res.redirect(
        `/api/v1/root/${nodeId}?token=${req.query.token ?? ""}&html`,
      );
    }

    return sendOk(res, result);
  } catch (err) {
 log.error("Transactions", "Change policy error:", err);
    sendError(res, 400, ERR.INVALID_INPUT, err.message);
  }
});

export default router;
