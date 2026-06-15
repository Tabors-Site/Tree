// TreeOS . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// content.js — the byte carrier for the content-addressable store.
//
// THIS IS TRANSPORT, NOT A VERB SURFACE. The protocol-level identity
// of content is its HASH: refs ride inside IBP (facts carry
// `{kind:"cas", hash, ...}`, descriptors surface the hash and a
// contentUrl hint). These two routes exist only because today's
// clients are browsers, and browsers move bytes over HTTP (<img>,
// fetch, GLTFLoader want URLs). They are the byte-shaped sibling of
// the WS frames that carry envelopes — when binary IBP lands in the
// kernel, length-prefixed content frames replace them and nothing
// above the transport layer changes.
//
// The routes stamp NO facts and run NO verb logic:
//
//   POST /api/v1/content        store bytes → return the cas ref.
//                               The client then emits a normal
//                               DO create-matter (or set-matter)
//                               carrying the ref through IBP — the
//                               verb is where auth, type gating, and
//                               the fact happen. Two-step doctrine:
//                               four verbs, one execution.
//
//   GET  /api/v1/content/:hash  stream bytes. Content is addressed
//                               by an unguessable 256-bit hash —
//                               capability-URL posture, same as the
//                               static uploads mount this replaces.
//                               SEE-gated serving is a follow-up.
//
// Idempotent by construction: re-uploading identical bytes returns
// the same ref and writes nothing (the store dedups on hash).

import express from "express";
import multer from "multer";
import { fileTypeFromBuffer } from "file-type";
import log from "../../../seed/seedReality/log.js";
import authenticate from "../middleware/authenticate.js";
import preUploadCheck from "../middleware/preUploadCheck.js";
import { getRealityConfigValue } from "../../../seed/realityConfig.js";
import { sendError, IBP_ERR } from "../../../seed/ibp/protocol.js";
import {
  putContent,
  streamContent,
  statContent,
  isContentHash,
} from "../../../seed/materials/matter/contentStore.js";

const router = express.Router();

function maxUploadBytes() {
  return Number(getRealityConfigValue("maxUploadBytes")) || 104857600;
}

function fileMimeAllowed(mimeType) {
  const allowed = getRealityConfigValue("allowedMimeTypes");
  if (!Array.isArray(allowed) || allowed.length === 0) return true;
  const bare = String(mimeType || "").split(";")[0].trim().toLowerCase();
  return allowed.some((p) => {
    const pat = String(p).toLowerCase();
    if (pat === bare) return true;
    return pat.endsWith("/*") ? bare.startsWith(pat.slice(0, -1)) : bare.startsWith(pat);
  });
}

// Memory storage: bytes hash straight into the store; nothing lands
// on disk under a transport-invented name. The pre-check bounds the
// declared size; multer's limit bounds the actual bytes.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 * 1024 }, // hard sanity cap; real cap below
});

router.post(
  "/content",
  authenticate,
  preUploadCheck,
  upload.single("file"),
  async (req, res) => {
    try {
      const file = req.file;
      if (!file || !file.buffer) {
        return sendError(res, 400, IBP_ERR.INVALID_INPUT,
          "POST /content expects multipart/form-data with a `file` field");
      }
      if (file.buffer.length > maxUploadBytes()) {
        return sendError(res, 413, IBP_ERR.UPLOAD_TOO_LARGE,
          `Upload exceeds maximum size (${Math.round(maxUploadBytes() / 1048576)}MB)`);
      }
      // A declared mimetype is the uploader's CLAIM and is spoofable: an
      // executable can announce itself as image/png and sail past an
      // allowlist that only checks the claim. So sniff the actual bytes.
      // file-type reads magic bytes; when it recognizes the format we
      // trust the BYTES over the claim, so both the allowlist gate below
      // and the stored mimeType reflect what the file really is. file-type
      // only knows binary formats (it returns undefined for
      // text/json/svg/csv...), so those keep the declared type, which is
      // the best signal available for them.
      const declared = file.mimetype || "application/octet-stream";
      const bareDeclared = declared.split(";")[0].trim().toLowerCase();
      const sniffed = await fileTypeFromBuffer(file.buffer).catch(() => null);
      if (sniffed?.mime && sniffed.mime !== bareDeclared) {
        log.warn("Content",
          `upload mimetype mismatch: declared "${declared}", bytes are "${sniffed.mime}" — trusting the bytes`);
      }
      const mimeType = sniffed?.mime || declared;
      if (!fileMimeAllowed(mimeType)) {
        return sendError(res, 415, IBP_ERR.UPLOAD_MIME_REJECTED,
          `File type "${mimeType}" not allowed on this reality`);
      }
      const isText = mimeType.startsWith("text/");
      const ref = await putContent(file.buffer, {
        mimeType,
        name: file.originalname || null,
        encoding: isText ? "utf8" : null,
      });
      return res.json({ ok: true, content: ref });
    } catch (err) {
      return sendError(res, 500, IBP_ERR.INTERNAL, err?.message || "content store error");
    }
  },
);

router.get("/content/:hash", async (req, res) => {
  const { hash } = req.params;
  if (!isContentHash(hash)) {
    return sendError(res, 400, IBP_ERR.INVALID_INPUT, "Invalid content hash");
  }
  try {
    const stat = await statContent(hash);
    const stream = stat ? await streamContent(hash) : null;
    if (!stream) {
      // The ref may still exist on the chain; the bytes do not.
      return res.status(404).json({ ok: false, purged: true, hash });
    }
    res.setHeader("Content-Type", stat.mimeType || "application/octet-stream");
    res.setHeader("Content-Length", String(stat.size));
    // Content is immutable by address: a hash's bytes never change.
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    res.setHeader("ETag", `"${hash}"`);
    // User bytes served as declared, never sniffed into something
    // more dangerous (portals iframe these; stored html additionally
    // gets a no-same-origin sandbox client-side).
    res.setHeader("X-Content-Type-Options", "nosniff");
    if (stat.name) {
      res.setHeader(
        "Content-Disposition",
        `inline; filename="${encodeURIComponent(stat.name)}"`,
      );
    }
    stream.pipe(res);
  } catch (err) {
    return sendError(res, 500, IBP_ERR.INTERNAL, err?.message || "content store error");
  }
});

export default router;
