import log from "../../seed/log.js";
import express from "express";
import path from "path";
import fs from "fs";
import multer from "multer";
import { sendOk, sendError, ERR, ARTIFACT_ORIGIN } from "../../seed/protocol.js";
import { getLandConfigValue } from "../../seed/landConfig.js";
import {
  createArtifact as coreCreateArtifact,
  getArtifacts as coreGetArtifacts,
  editArtifact,
  deleteArtifactAndFile as coreDeleteArtifactAndFile,
  transferArtifact as coreTransferArtifact,
  getArtifactEditHistory,
} from "../../seed/tree/artifacts.js";

import authenticate from "../../seed/middleware/authenticate.js";
import preUploadCheck from "../../seed/middleware/preUploadCheck.js";
import { getExtension } from "../../extensions/loader.js";

const router = express.Router();

async function resolveVersion(nodeId, version) {
  const resolve = getExtension("prestige")?.exports?.resolveVersion;
  if (resolve) return resolve(nodeId, version);
  return version === "latest" ? 0 : Number(version);
}

router.param("version", async (req, res, next, val) => {
  try {
    req.params.version = String(await resolveVersion(req.params.nodeId, val));
    next();
  } catch (err) {
    return sendError(res, 404, ERR.NODE_NOT_FOUND, err.message);
  }
});

async function useLatest(req, res, next) {
  try {
    req.params.version = String(await resolveVersion(req.params.nodeId, "latest"));
    next();
  } catch (err) {
    return sendError(res, 404, ERR.NODE_NOT_FOUND, err.message);
  }
}

import { fileURLToPath } from "url";
const __artifactsDir = path.dirname(fileURLToPath(import.meta.url));
const uploadsFolder = path.join(__artifactsDir, "../../uploads");

if (!fs.existsSync(uploadsFolder)) {
  fs.mkdirSync(uploadsFolder);
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsFolder),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    const name = Date.now() + "-" + Math.random().toString(36).slice(2);
    cb(null, name + ext);
  },
});

// Multer fileSize must match maxUploadBytes config. The pre-upload check only
// validates Content-Length (which can be spoofed). This is the real enforcement.
const upload = multer({
  storage,
  limits: { fileSize: Number(getLandConfigValue("maxUploadBytes")) || 104857600 },
});

router.get(
  "/node/:nodeId/:version/artifacts/:artifactId/history",
  authenticate,
  async (req, res) => {
    try {
      const { artifactId } = req.params;
      const rawLimit = Number(req.query.limit) || 100;
      const limit = Math.min(Math.max(1, rawLimit), 1000);
      const offset = Math.max(0, Number(req.query.offset) || 0);
      const history = await getArtifactEditHistory(artifactId, limit, offset);
      return sendOk(res, { history, limit, offset });
    } catch (err) {
      log.error("API", "Artifact history error:", err);
      sendError(res, 500, ERR.INTERNAL, err.message);
    }
  },
);

router.get("/node/:nodeId/:version/artifacts", authenticate, async (req, res) => {
  try {
    const { nodeId } = req.params;
    const rawLimit = req.query.limit;
    const startDate = req.query.startDate;
    const endDate = req.query.endDate;

    const limit = rawLimit !== undefined ? Number(rawLimit) : undefined;

    if (limit !== undefined && (isNaN(limit) || limit <= 0)) {
      return sendError(res, 400, ERR.INVALID_INPUT, "Invalid limit: must be a positive number");
    }

    // Date range validation
    if (startDate && isNaN(Date.parse(startDate))) {
      return sendError(res, 400, ERR.INVALID_INPUT, "Invalid startDate format");
    }
    if (endDate && isNaN(Date.parse(endDate))) {
      return sendError(res, 400, ERR.INVALID_INPUT, "Invalid endDate format");
    }
    if (startDate && endDate) {
      const span = Date.parse(endDate) - Date.parse(startDate);
      if (span < 0) return sendError(res, 400, ERR.INVALID_INPUT, "endDate must be after startDate");
      if (span > 365 * 24 * 60 * 60 * 1000) return sendError(res, 400, ERR.INVALID_INPUT, "Date range cannot exceed 365 days");
    }

    const rawOffset = req.query.offset;
    const offset = rawOffset !== undefined ? Math.max(0, Number(rawOffset) || 0) : 0;

    const result = await coreGetArtifacts({
      nodeId,
      limit,
      offset,
      startDate,
      endDate,
    });

    // For filesystem-origin artifacts, expose the bytes via the uploads
    // route. The artifact's content object stays intact; we add a `url`
    // shortcut so clients don't need to know the origin to render it.
    const artifacts = [...result.artifacts].reverse().map((a) => {
      if (a.origin === ARTIFACT_ORIGIN.FILESYSTEM && a.content?.path) {
        return { ...a, url: `/api/v1/uploads/${a.content.path}` };
      }
      return a;
    });

    return sendOk(res, { artifacts, offset });
  } catch (err) {
    return sendError(res, 400, ERR.INVALID_INPUT, err.message);
  }
});

router.post(
  "/node/:nodeId/:version/artifacts",
  authenticate,
  preUploadCheck,
  upload.single("file"),

  async (req, res) => {
    try {
      const { nodeId } = req.params;

      // If a multipart upload arrived, treat as filesystem origin.
      // Otherwise the artifact is ibp-origin and the body carries the
      // content (string text, or null for a metadata-only object).
      const origin = req.file ? ARTIFACT_ORIGIN.FILESYSTEM : ARTIFACT_ORIGIN.IBP;

      const result = await coreCreateArtifact({
        origin,
        content: origin === ARTIFACT_ORIGIN.IBP ? (req.body.content ?? null) : null,
        beingId: req.beingId,
        nodeId,
        file: req.file,
        metadata: req.body.metadata && typeof req.body.metadata === "object" ? req.body.metadata : {},
      });

      return sendOk(res, { artifact: result.artifact });
    } catch (err) {
      sendError(res, 400, ERR.INVALID_INPUT, err.message);
    }
  },
);

router.put(
  "/node/:nodeId/:version/artifacts/:artifactId",
  authenticate,
  async (req, res) => {
    try {
      const { artifactId } = req.params;
      const { content } = req.body;
      const beingId = req.beingId || req.body.beingId;

      if (!beingId) return sendError(res, 401, ERR.UNAUTHORIZED, "Unauthorized");

      const result = await editArtifact({
        artifactId,
        content: content ?? "",
        beingId,
      });

      return sendOk(res, {
        _id: result.artifact._id,
        message: result.message,
      });
    } catch (err) {
      const status =
        err.message === "Unauthorized"
          ? 403
          : err.message === "Artifact not found"
            ? 404
            : err.name === "EnergyError"
              ? 403
              : 400;
      const code =
        err.message === "Unauthorized"
          ? ERR.FORBIDDEN
          : err.message === "Artifact not found"
            ? ERR.ARTIFACT_NOT_FOUND
            : err.name === "EnergyError"
              ? ERR.FORBIDDEN
              : ERR.INVALID_INPUT;
      return sendError(res, status, code, err.message);
    }
  },
);

router.get("/node/:nodeId/:version/artifacts/:artifactId", authenticate, async (req, res) => {
  try {
    const { nodeId, version, artifactId } = req.params;

    const Artifact = (await import("../../seed/models/artifact.js")).default;
    const artifact = await Artifact.findById(artifactId)
      .populate("beingId", "username")
      .lean();

    if (!artifact) {
      return sendError(res, 404, ERR.ARTIFACT_NOT_FOUND, "This artifact doesn't exist or may have been removed.");
    }

    if (
      artifact.nodeId !== nodeId ||
      ["deleted", "empty", "null", "system"].includes(
        artifact.beingId?._id?.toString?.() ?? artifact.beingId,
      )
    ) {
      return sendError(res, 404, ERR.ARTIFACT_NOT_FOUND, "This artifact doesn't exist or may have been removed.");
    }

    if (artifact.origin === ARTIFACT_ORIGIN.IBP) {
      return sendOk(res, { artifact });
    }

    if (artifact.origin === ARTIFACT_ORIGIN.FILESYSTEM) {
      const filename = artifact.content?.path;
      if (!filename) {
        return sendError(res, 404, ERR.ARTIFACT_NOT_FOUND, "File not found");
      }
      const filePath = path.join(uploadsFolder, filename);
      if (!fs.existsSync(filePath)) {
        return sendError(res, 404, ERR.ARTIFACT_NOT_FOUND, "File not found");
      }
      return res.sendFile(filePath);
    }

    // web / cross-land / future origins: return the structured content
    // and let the client resolve. The kernel doesn't fetch on behalf
    // of clients; bridging extensions can register custom resolvers.
    return sendOk(res, { artifact });
  } catch (err) {
    sendError(res, 500, ERR.INTERNAL, err.message);
  }
});

router.delete(
  "/node/:nodeId/:version/artifacts/:artifactId",
  authenticate,
  async (req, res) => {
    try {
      const { artifactId } = req.params;

      const result = await coreDeleteArtifactAndFile({
        artifactId,
        beingId: req.beingId,
      });

      sendOk(res, result);
    } catch (err) {
      sendError(res, 400, ERR.INVALID_INPUT, err.message);
    }
  },
);

router.post(
  "/node/:nodeId/:version/artifacts/:artifactId/transfer",
  authenticate,
  async (req, res) => {
    try {
      const { artifactId } = req.params;
      const { targetNodeId, prestige } = req.body;

      if (!targetNodeId) {
        return sendError(res, 400, ERR.INVALID_INPUT, "targetNodeId is required");
      }

      const result = await coreTransferArtifact({
        artifactId,
        targetNodeId,
        beingId: req.beingId,
        prestige: typeof prestige === "number" ? prestige : null,
      });

      sendOk(res, result);
    } catch (err) {
      sendError(res, 400, ERR.INVALID_INPUT, err.message);
    }
  },
);

router.get("/node/:nodeId/artifacts", authenticate, useLatest, (req, res, next) => {
  req.url = `/node/${req.params.nodeId}/${req.params.version}/artifacts`;
  router.handle(req, res, next);
});

router.post("/node/:nodeId/artifacts", authenticate, useLatest, (req, res, next) => {
  req.url = `/node/${req.params.nodeId}/${req.params.version}/artifacts`;
  router.handle(req, res, next);
});

router.get("/node/:nodeId/artifacts/:artifactId", authenticate, useLatest, (req, res, next) => {
  req.url = `/node/${req.params.nodeId}/${req.params.version}/artifacts/${req.params.artifactId}`;
  router.handle(req, res, next);
});

router.put("/node/:nodeId/artifacts/:artifactId", authenticate, useLatest, (req, res, next) => {
  req.url = `/node/${req.params.nodeId}/${req.params.version}/artifacts/${req.params.artifactId}`;
  router.handle(req, res, next);
});

router.delete("/node/:nodeId/artifacts/:artifactId", authenticate, useLatest, (req, res, next) => {
  req.url = `/node/${req.params.nodeId}/${req.params.version}/artifacts/${req.params.artifactId}`;
  router.handle(req, res, next);
});

router.post("/node/:nodeId/artifacts/:artifactId/transfer", authenticate, useLatest, (req, res, next) => {
  req.url = `/node/${req.params.nodeId}/${req.params.version}/artifacts/${req.params.artifactId}/transfer`;
  router.handle(req, res, next);
});

router.use((err, req, res, next) => {
  if (err.code === "LIMIT_FILE_SIZE") {
    return sendError(res, 413, ERR.UPLOAD_TOO_LARGE, "File exceeds maximum size of 4 GB");
  }
  next(err);
});

export default router;
