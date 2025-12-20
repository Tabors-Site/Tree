import express from "express";
import {
  getContributions,
  getContributionsByUser,
} from "../controllers/contributions.js";

const router = express.Router();

router.post("/get-contributions", getContributions);
router.post("/get-contributions-by-user", getContributionsByUser);

export default router;
