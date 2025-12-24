import multer from "multer";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

import {
  createRawIdea as coreCreateRawIdea,
  convertRawIdeaToNote as coreConvertRawIdeaToNote,
  deleteRawIdeaAndFile as coreDeleteRawIdeaAndFile,
  getRawIdeas as coreGetRawIdeas,
  searchRawIdeasByUser as coreSearchRawIdeasByUser,
} from "../core/rawIdea.js";

/* ---------------- helpers ---------------- */

function getDateParams(req) {
  return {
    startDate: req.query.startDate ?? req.body.startDate,
    endDate: req.query.endDate ?? req.body.endDate,
  };
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const uploadsFolder = path.join(__dirname, "../uploads");

function generateId() {
  return Math.random().toString(36).substr(2, 9);
}

/* ---------------- multer ---------------- */

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsFolder),
  filename: (req, file, cb) => {
    const uniqueId = generateId();
    const extension = path.extname(file.originalname);
    cb(null, `${uniqueId}${extension}`);
  },
});

const upload = multer({ storage });

/* ---------------- controllers ---------------- */

async function createRawIdea(req, res) {
  try {
    const result = await coreCreateRawIdea({
      contentType: req.body.contentType,
      content: req.body.content,
      userId: req.body.userId,
      file: req.file,
    });

    res.status(201).json({ success: true, ...result });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
}

async function getRawIdeas(req, res) {
  try {
    const userId = req.body.userId || req.params.userId;
    const limit = Number(req.query.limit ?? req.body.limit);
    const { startDate, endDate } = getDateParams(req);

    const result = await coreGetRawIdeas({
      userId,
      limit,
      startDate,
      endDate,
    });

    res.status(200).json({ success: true, ...result });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
}

async function searchRawIdeasForUser(req, res) {
  try {
    const userId = req.body.userId || req.params.userId;
    const query = req.query.q || req.body.query;
    const limit = Number(req.query.limit ?? req.body.limit);
    const { startDate, endDate } = getDateParams(req);

    const result = await coreSearchRawIdeasByUser({
      userId,
      query,
      limit,
      startDate,
      endDate,
    });

    res.status(200).json({ success: true, ...result });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
}

async function convertRawIdeaToNote(req, res) {
  try {
    const result = await coreConvertRawIdeaToNote({
      rawIdeaId: req.body.rawIdeaId,
      userId: req.body.userId,
      nodeId: req.body.nodeId,
    });

    res.status(200).json({ success: true, ...result });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
}

async function deleteRawIdeaAndFile(req, res) {
  try {
    const result = await coreDeleteRawIdeaAndFile({
      rawIdeaId: req.body.rawIdeaId,
      userId: req.body.userId,
    });

    res.status(200).json({ success: true, ...result });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
}

function getFile(req, res) {
  const filePath = path.join(uploadsFolder, req.params.fileName);
  if (fs.existsSync(filePath)) {
    res.sendFile(filePath);
  } else {
    res.status(404).json({ message: "File not found" });
  }
}

/* ---------------- exports ---------------- */

export {
  upload,
  createRawIdea,
  getRawIdeas,
  searchRawIdeasForUser,
  convertRawIdeaToNote,
  deleteRawIdeaAndFile,
  getFile,
};
