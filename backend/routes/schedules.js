import express from 'express';
const router = express.Router();
import authenticate from '../middleware/authenticate.js';
import { updateSchedule } from '../controllers/schedules.js';

// Route to update schedule
router.post("/update-schedule", authenticate, updateSchedule);

export default router;
