import express from 'express';
import { setValueForNode, setGoalForNode } from '../controllers/values.js';
import authenticate from '../middleware/authenticate.js';

const router = express.Router();

// Route to edit the value for a node
router.post("/edit-value", authenticate, setValueForNode);

// Route to edit the goal for a node
router.post("/edit-goal", authenticate, setGoalForNode);

export default router;
