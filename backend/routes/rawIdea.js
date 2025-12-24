import express from "express";

import authenticate from "../middleware/authenticate.js";

import {
  upload,
  createRawIdea,
  getRawIdeas,
  searchRawIdeasForUser,
  convertRawIdeaToNote,
  deleteRawIdeaAndFile,
  getFile,
} from "../controllers/rawIdea.js";

const router = express.Router();

/* ---------------- create ---------------- */

// create raw idea (text or file)
router.post(
  "/create-raw-idea",
  authenticate,
  upload.single("file"),
  createRawIdea
);

/* ---------------- read ---------------- */

router.post("/get-raw-ideas-user", authenticate, getRawIdeas);

router.post("/user/search-raw-ideas", authenticate, searchRawIdeasForUser);

router.post("/place-raw-idea", authenticate, convertRawIdeaToNote);

router.post("/delete-raw-idea", authenticate, deleteRawIdeaAndFile);

router.get("/uploads/:fileName", getFile);

export default router;
