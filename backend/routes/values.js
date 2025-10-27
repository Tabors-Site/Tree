import express from "express";
import { setValueForNode, setGoalForNode } from "../controllers/values.js";
import authenticate from "../middleware/authenticate.js";

const router = express.Router();

router.post("/edit-value", authenticate, setValueForNode);

router.post("/edit-goal", authenticate, setGoalForNode);

export default router;
