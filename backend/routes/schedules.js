import express from 'express';
import authenticate from '../middleware/authenticate.js';
import { updateSchedule } from '../controllers/schedules.js';

const router = express.Router();

router.post("/update-schedule", authenticate, updateSchedule);

export default router;
