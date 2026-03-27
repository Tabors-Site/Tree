import log from "../../seed/log.js";
import express from "express";
import { sendOk, sendError, ERR, DELETED } from "../../seed/protocol.js";
import { getLandConfigValue } from "../../seed/landConfig.js";
import mongoose from "mongoose";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
const __riDir = path.dirname(fileURLToPath(import.meta.url));
import multer from "multer";
import authenticate, { authenticateOptional } from "../../seed/middleware/authenticate.js";
import preUploadCheck from "../../seed/middleware/preUploadCheck.js";
import { getLandUrl } from "../../canopy/identity.js";
import { userHasLlm } from "../../seed/ws/conversation.js";
import { orchestrateRawIdeaPlacement } from "./pipeline.js";
import RawIdea from "./model.js";
import User from "../../seed/models/user.js";
import {
  createRawIdea as coreCreateRawIdea,
  getRawIdeas as coreGetRawIdeas,
  searchRawIdeasByUser as coreSearchRawIdeasByUser,
  deleteRawIdeaAndFile as coreDeleteRawIdeaAndFile,
  convertRawIdeaToNote as coreConvertRawIdeaToNote,
  toggleAutoPlace as coreToggleAutoPlace,
  AUTO_PLACE_ELIGIBLE,
} from "./core.js";
import { getExtension } from "../loader.js";
function html() { return getExtension("html-rendering")?.exports || {}; }

function notFoundPage(req, res, message = "This page doesn't exist or may have been moved.") {
  const fn = getExtension("html-rendering")?.exports?.notFoundPage;
  if (fn) return fn(req, res, message);
  return sendError(res, 404, ERR.NOTE_NOT_FOUND, message);
}

const router = express.Router();

const uploadsFolder = path.join(__riDir, "../../uploads");
if (!fs.existsSync(uploadsFolder)) fs.mkdirSync(uploadsFolder);

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsFolder),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    const name = Date.now() + "-" + Math.random().toString(36).slice(2);
    cb(null, name + ext);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: Number(getLandConfigValue("maxUploadBytes")) || 104857600 },
});

function escapeHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// POST create raw idea
router.post(
  "/user/:userId/raw-ideas",
  authenticate,
  preUploadCheck,
  upload.single("file"),
  async (req, res) => {
    try {
      const { userId } = req.params;
      if (req.userId.toString() !== userId.toString()) {
        return sendError(res, 403, ERR.FORBIDDEN, "Not authorized");
      }

      const contentType = req.file ? "file" : "text";
      const result = await coreCreateRawIdea({
        contentType,
        content: contentType === "file" ? req.file.filename : req.body.content,
        userId: req.userId,
        file: req.file,
      });

      if ("html" in req.query) {
        return res.redirect(
          `/api/v1/user/${userId}?token=${req.query.token ?? ""}&html`,
        );
      }

      return sendOk(res, { rawIdea: result.rawIdea }, 201);
    } catch (err) {
      sendError(res, 400, ERR.INVALID_INPUT, err.message);
    }
  },
);

// GET list raw ideas
router.get("/user/:userId/raw-ideas", authenticateOptional, async (req, res) => {
  try {
    const userId = req.params.userId;
    const wantHtml = Object.prototype.hasOwnProperty.call(req.query, "html");
    const startDate = req.query.startDate;
    const endDate = req.query.endDate;

    const rawLimit = req.query.limit;
    let limit = rawLimit !== undefined ? Number(rawLimit) : undefined;
    if (limit >= 200 || limit == undefined) limit = 200;
    if (limit !== undefined && (isNaN(limit) || limit <= 0)) {
      return sendError(res, 400, ERR.INVALID_INPUT, "Invalid limit: must be a positive number");
    }

    const query = req.query.q || "";
    const statusFilter = req.query.status || "pending";

    let result;
    if (query.trim() !== "") {
      result = await coreSearchRawIdeasByUser({
        userId, query, limit, startDate, endDate, status: statusFilter,
      });
    } else {
      result = await coreGetRawIdeas({
        userId, limit, startDate, endDate, status: statusFilter,
      });
    }

    const rawIdeas = result.rawIdeas.map((r) => ({
      ...r,
      content: r.contentType === "file" ? `/api/v1/uploads/${r.content}` : r.content,
    }));

    if (!wantHtml || !getExtension("html-rendering")) {
      return sendOk(res, { rawIdeas });
    }

    const user = await User.findById(userId).lean();
    const token = req.query.token ?? "";

    const tabUrl = (s) => {
      const base = `/api/v1/user/${userId}/raw-ideas`;
      const params = new URLSearchParams();
      if (token) params.set("token", token);
      params.set("html", "");
      if (s !== "pending") params.set("status", s);
      return `${base}?${params.toString()}`;
    };
    const tabs = [
      { key: "pending", label: "Pending" },
      { key: "processing", label: "Active" },
      { key: "succeeded", label: "Finished" },
      { key: "stuck", label: "Stuck" },
      { key: "deferred", label: "Deferred" },
      { key: "deleted", label: "Deleted" },
    ];

    return res.send(
      html().renderRawIdeasList({
        userId, user, rawIdeas, query, statusFilter, tabs, tabUrl, token, AUTO_PLACE_ELIGIBLE,
      }),
    );
  } catch (err) {
 log.error("Raw Ideas", "Error in /user/:userId/raw-ideas:", err);
    sendError(res, 400, ERR.INVALID_INPUT, err.message);
  }
});

// POST toggle auto-place
router.post(
  "/user/:userId/raw-ideas/auto-place",
  authenticate,
  async (req, res) => {
    try {
      if (req.userId.toString() !== req.params.userId.toString()) {
        return sendError(res, 403, ERR.FORBIDDEN, "Not authorized");
      }
      const enabled = req.body?.enabled;
      if (typeof enabled !== "boolean") {
        return sendError(res, 400, ERR.INVALID_INPUT, "enabled (boolean) is required");
      }
      const result = await coreToggleAutoPlace({ userId: req.userId, enabled });
      return sendOk(res, { enabled: result.enabled });
    } catch (err) {
      const status = err.message.includes("only available on") ? 403 : 500;
      const code = status === 403 ? ERR.FORBIDDEN : ERR.INTERNAL;
      return sendError(res, status, code, err.message);
    }
  },
);

// DELETE raw idea
router.delete(
  "/user/:userId/raw-ideas/:rawIdeaId",
  authenticate,
  async (req, res) => {
    try {
      const { userId, rawIdeaId } = req.params;
      if (req.userId.toString() !== userId.toString()) {
        return sendError(res, 403, ERR.FORBIDDEN, "Not authorized");
      }
      const rawIdea = await RawIdea.findById(rawIdeaId);
      if (!rawIdea) {
        return sendError(res, 404, ERR.NOTE_NOT_FOUND, "Raw idea not found");
      }
      if (rawIdea.status === "processing" || rawIdea.status === "succeeded") {
        return sendError(res, 409, ERR.RESOURCE_CONFLICT, `Cannot delete a raw idea with status "${rawIdea.status}"`);
      }
      const result = await coreDeleteRawIdeaAndFile({ rawIdeaId, userId: req.userId });
      return sendOk(res, result);
    } catch (err) {
      sendError(res, 400, ERR.INVALID_INPUT, err.message);
    }
  },
);

// POST transfer raw idea to note
router.post(
  "/user/:userId/raw-ideas/:rawIdeaId/transfer",
  authenticate,
  async (req, res) => {
    try {
      const { userId, rawIdeaId } = req.params;
      const { nodeId } = req.body;
      if (req.userId.toString() !== userId.toString()) {
        return sendError(res, 403, ERR.FORBIDDEN, "Not authorized");
      }
      if (!rawIdeaId || !nodeId) {
        return sendError(res, 400, ERR.INVALID_INPUT, "raw-idea Id and nodeId are required");
      }
      const rawIdeaCheck = await RawIdea.findById(rawIdeaId).lean();
      if (rawIdeaCheck?.status === "processing") {
        return sendError(res, 409, ERR.RESOURCE_CONFLICT, "Cannot transfer a raw idea while it is being processed");
      }
      const result = await coreConvertRawIdeaToNote({ rawIdeaId, userId: req.userId, nodeId });

      if ("html" in req.query) {
        return res.redirect(
          `/api/v1/user/${userId}/raw-ideas?token=${req.query.token ?? ""}&html`,
        );
      }
      return sendOk(res, { note: result.note });
    } catch (err) {
 log.error("Raw Ideas", "raw-idea transfer error:", err);
      return sendError(res, 400, ERR.INVALID_INPUT, err.message);
    }
  },
);

// GET single raw idea
router.get("/user/:userId/raw-ideas/:rawIdeaId", async (req, res) => {
  try {
    const { userId, rawIdeaId } = req.params;
    const rawIdea = await RawIdea.findById(rawIdeaId)
      .populate("userId", "username")
      .lean();

    if (!rawIdea) {
      return notFoundPage(req, res, "This raw idea doesn't exist or may have been removed.");
    }

    const rawUserId = rawIdea.userId?._id?.toString?.() ?? rawIdea.userId;
    if (["deleted", "empty", "null", "system"].includes(rawUserId)) {
      return notFoundPage(req, res, "This raw idea doesn't exist or may have been removed.");
    }
    if (rawUserId !== userId.toString()) {
      return notFoundPage(req, res, "This raw idea doesn't exist or may have been removed.");
    }

    const token = req.query.token ?? "";
    const tokenQS = token ? `?token=${token}&html` : `?html`;
    const hasToken = !!token;
    const back = hasToken
      ? `/api/v1/user/${userId}/raw-ideas${tokenQS}`
      : getLandUrl();
    const backText = hasToken ? "← Back to Raw Ideas" : "← Back to Home";
    const userLink =
      rawIdea.userId && rawIdea.userId !== "empty"
        ? `<a href="/api/v1/user/${rawIdea.userId._id}${tokenQS}">
               ${escapeHtml(rawIdea.userId.username ?? String(rawIdea.userId))}
             </a>`
        : "Unknown user";

    if (req.query.html !== undefined && getExtension("html-rendering")) {
      if (rawIdea.contentType === "text") {
        return res.send(
          html().renderRawIdeaText({ userId, rawIdea, back, backText, userLink, hasToken, token }),
        );
      }
      return res.send(
        html().renderRawIdeaFile({ userId, rawIdea, back, backText, userLink, hasToken, token }),
      );
    }

    if (rawIdea.contentType === "text") {
      return sendOk(res, { text: rawIdea.content });
    }
    if (rawIdea.contentType === "file") {
      const filePath = path.join(uploadsFolder, rawIdea.content);
      if (!fs.existsSync(filePath)) {
        return sendError(res, 404, ERR.NOTE_NOT_FOUND, "File not found");
      }
      return res.sendFile(filePath);
    }

    sendError(res, 400, ERR.INVALID_TYPE, "Unknown raw idea type");
  } catch (err) {
    sendError(res, 500, ERR.INTERNAL, err.message);
  }
});

// ─────────────────────────────────────────────────────────────────────────
// Orchestration endpoints (moved from routes/api/orchestrate.js)
// ─────────────────────────────────────────────────────────────────────────

const TIMEOUT_MS = 19 * 60 * 1000;

router.post("/user/:userId/raw-ideas/place", authenticate, async (req, res) => {
  try {
    if (req.userId.toString() !== req.params.userId.toString()) {
      return sendError(res, 403, ERR.FORBIDDEN, "Not authorized");
    }
    const content = req.body?.content;
    if (!content || typeof content !== "string" || !content.trim()) {
      return sendError(res, 400, ERR.INVALID_INPUT, "content (text string) is required");
    }
    if (!(await userHasLlm(req.userId))) {
      return sendError(res, 503, ERR.LLM_NOT_CONFIGURED, "No LLM connection. Visit /setup to set one up.");
    }
    const alreadyProcessing = await RawIdea.findOne({ userId: req.userId.toString(), status: "processing" });
    if (alreadyProcessing) {
      return sendError(res, 409, ERR.ORCHESTRATOR_LOCKED, "Another idea is already being placed. Please wait for it to finish.");
    }
    const result = await coreCreateRawIdea({ contentType: "text", content: content.trim(), userId: req.userId });
    const user = await User.findById(req.userId).select("username").lean();
    const source = req.body?.source === "user" ? "user" : "api";
    orchestrateRawIdeaPlacement({
      rawIdeaId: result.rawIdea._id, userId: req.userId, username: user?.username || "unknown", source,
 }).catch((err) => log.error("Raw Ideas", "Raw-idea orchestration failed:", err.message));
    return sendOk(res, { message: "Orchestration started", rawIdeaId: result.rawIdea._id }, 202);
  } catch (err) {
 log.error("Raw Ideas", "raw-idea create+place error:", err);
    return sendError(res, 500, ERR.INTERNAL, err.message);
  }
});

router.post("/user/:userId/raw-ideas/chat", authenticate, async (req, res) => {
  try {
    if (req.userId.toString() !== req.params.userId.toString()) {
      return sendError(res, 403, ERR.FORBIDDEN, "Not authorized");
    }
    const content = req.body?.content;
    if (!content || typeof content !== "string" || !content.trim()) {
      return sendError(res, 400, ERR.INVALID_INPUT, "content (text string) is required");
    }
    if (!(await userHasLlm(req.userId))) {
      return sendError(res, 503, ERR.LLM_NOT_CONFIGURED, "No LLM connection. Visit /setup to set one up.");
    }
    const alreadyProcessing = await RawIdea.findOne({ userId: req.userId.toString(), status: "processing" });
    if (alreadyProcessing) {
      return sendError(res, 409, ERR.ORCHESTRATOR_LOCKED, "Another idea is already being placed. Please wait for it to finish.");
    }
    const result = await coreCreateRawIdea({ contentType: "text", content: content.trim(), userId: req.userId });
    const user = await User.findById(req.userId).select("username").lean();
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; if (!res.headersSent) sendError(res, 500, ERR.TIMEOUT, "Request timed out."); }, TIMEOUT_MS);
    const source = req.body?.source === "user" ? "user" : "api";
    const orchResult = await orchestrateRawIdeaPlacement({ rawIdeaId: result.rawIdea._id, userId: req.userId, username: user?.username || "unknown", withResponse: true, source });
    clearTimeout(timer);
    if (timedOut) return;
    if (!orchResult || !orchResult.success) return sendError(res, 503, ERR.LLM_FAILED, orchResult?.reason || "Could not process the idea.");
    return sendOk(res, { answer: orchResult.answer, rootId: orchResult.rootId, rootName: orchResult.rootName, targetNodeId: orchResult.targetNodeId, rawIdeaId: result.rawIdea._id });
  } catch (err) {
 log.error("Raw Ideas", "raw-idea create+chat error:", err);
    return sendError(res, 500, ERR.INTERNAL, err.message);
  }
});

router.post("/user/:userId/raw-ideas/:rawIdeaId/place", authenticate, async (req, res) => {
  try {
    const { rawIdeaId } = req.params;
    if (req.userId.toString() !== req.params.userId.toString()) return sendError(res, 403, ERR.FORBIDDEN, "Not authorized");
    const rawIdea = await RawIdea.findById(rawIdeaId);
    if (!rawIdea || rawIdea.userId === DELETED) return sendError(res, 404, ERR.NOTE_NOT_FOUND, "Raw idea not found");
    if (rawIdea.userId.toString() !== req.userId.toString()) return sendError(res, 403, ERR.FORBIDDEN, "Not authorized");
    if (rawIdea.contentType === "file") return sendError(res, 400, ERR.INVALID_TYPE, "File ideas cannot be auto-placed");
    if (rawIdea.status && rawIdea.status !== "pending") return sendError(res, 409, ERR.RESOURCE_CONFLICT, `Already ${rawIdea.status}`);
    if (!(await userHasLlm(req.userId))) return sendError(res, 503, ERR.LLM_NOT_CONFIGURED, "No LLM connection. Visit /setup to set one up.");
    const alreadyProcessing = await RawIdea.findOne({ userId: req.userId.toString(), status: "processing" });
    if (alreadyProcessing) return sendError(res, 409, ERR.ORCHESTRATOR_LOCKED, "Another idea is already being placed. Please wait for it to finish.");
    const user = await User.findById(req.userId).select("username").lean();
    const source = req.body?.source === "user" ? "user" : "api";
 orchestrateRawIdeaPlacement({ rawIdeaId, userId: req.userId, username: user?.username || "unknown", source }).catch((err) => log.error("Raw Ideas", "Raw-idea orchestration failed:", err.message));
    return sendOk(res, { message: "Orchestration started" }, 202);
  } catch (err) {
 log.error("Raw Ideas", "raw-idea orchestrate error:", err);
    return sendError(res, 500, ERR.INTERNAL, err.message);
  }
});

router.post("/user/:userId/raw-ideas/:rawIdeaId/chat", authenticate, async (req, res) => {
  try {
    const { rawIdeaId } = req.params;
    if (req.userId.toString() !== req.params.userId.toString()) return sendError(res, 403, ERR.FORBIDDEN, "Not authorized");
    const rawIdea = await RawIdea.findById(rawIdeaId);
    if (!rawIdea || rawIdea.userId === DELETED) return sendError(res, 404, ERR.NOTE_NOT_FOUND, "Raw idea not found");
    if (rawIdea.userId.toString() !== req.userId.toString()) return sendError(res, 403, ERR.FORBIDDEN, "Not authorized");
    if (rawIdea.contentType === "file") return sendError(res, 400, ERR.INVALID_TYPE, "File ideas cannot be auto-placed");
    if (rawIdea.status && rawIdea.status !== "pending") return sendError(res, 409, ERR.RESOURCE_CONFLICT, `Already ${rawIdea.status}`);
    if (!(await userHasLlm(req.userId))) return sendError(res, 503, ERR.LLM_NOT_CONFIGURED, "No LLM connection. Visit /setup to set one up.");
    const alreadyProcessing = await RawIdea.findOne({ userId: req.userId.toString(), status: "processing" });
    if (alreadyProcessing) return sendError(res, 409, ERR.ORCHESTRATOR_LOCKED, "Another idea is already being placed. Please wait for it to finish.");
    const user = await User.findById(req.userId).select("username").lean();
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; if (!res.headersSent) sendError(res, 500, ERR.TIMEOUT, "Request timed out."); }, TIMEOUT_MS);
    const source = req.body?.source === "user" ? "user" : "api";
    const result = await orchestrateRawIdeaPlacement({ rawIdeaId, userId: req.userId, username: user?.username || "unknown", withResponse: true, source });
    clearTimeout(timer);
    if (timedOut) return;
    if (!result || !result.success) return sendError(res, 503, ERR.LLM_FAILED, result?.reason || "Could not process the idea.");
    return sendOk(res, { answer: result.answer, rootId: result.rootId, rootName: result.rootName, targetNodeId: result.targetNodeId });
  } catch (err) {
 log.error("Raw Ideas", "raw-idea chat error:", err);
    return sendError(res, 500, ERR.INTERNAL, err.message);
  }
});

export default router;
