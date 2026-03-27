import express from "express";
import { sendOk, sendError, ERR } from "../../seed/protocol.js";
import authenticate from "../../seed/middleware/authenticate.js";
import { extractLessons, importLessons, shareLessons, dismissLesson, getLessons } from "./core.js";

const router = express.Router();

// GET /root/:rootId/teach - Show active lessons
router.get("/root/:rootId/teach", authenticate, async (req, res) => {
  try {
    const result = await getLessons(req.params.rootId);
    sendOk(res, result);
  } catch (err) {
    sendError(res, 400, ERR.INVALID_INPUT, err.message);
  }
});

// POST /root/:rootId/teach/export - Extract lessons from this tree
router.post("/root/:rootId/teach/export", authenticate, async (req, res) => {
  try {
    const lessonSet = await extractLessons(req.params.rootId, req.userId, req.username);
    sendOk(res, lessonSet);
  } catch (err) {
    sendError(res, 400, ERR.INVALID_INPUT, err.message);
  }
});

// POST /root/:rootId/teach/import - Import lessons into this tree
router.post("/root/:rootId/teach/import", authenticate, async (req, res) => {
  try {
    const lessonSet = req.body;
    if (!lessonSet?.lessons) {
      return sendError(res, 400, ERR.INVALID_INPUT, "Request body must contain a lesson set with a lessons array");
    }
    const result = await importLessons(req.params.rootId, lessonSet, req.userId);
    sendOk(res, result);
  } catch (err) {
    sendError(res, 400, ERR.INVALID_INPUT, err.message);
  }
});

// POST /root/:rootId/teach/share - Send lessons to a peered land
router.post("/root/:rootId/teach/share", authenticate, async (req, res) => {
  try {
    const { peer } = req.body;
    if (!peer) return sendError(res, 400, ERR.INVALID_INPUT, "peer (domain) is required");
    const result = await shareLessons(req.params.rootId, peer, req.userId, req.username);
    sendOk(res, result);
  } catch (err) {
    sendError(res, 400, ERR.INVALID_INPUT, err.message);
  }
});

// POST /root/:rootId/teach/dismiss - Dismiss a lesson
router.post("/root/:rootId/teach/dismiss", authenticate, async (req, res) => {
  try {
    const { id } = req.body;
    if (!id) return sendError(res, 400, ERR.INVALID_INPUT, "id (lesson ID) is required");
    const result = await dismissLesson(req.params.rootId, id, req.userId);
    sendOk(res, result);
  } catch (err) {
    sendError(res, 400, ERR.INVALID_INPUT, err.message);
  }
});

export default router;
