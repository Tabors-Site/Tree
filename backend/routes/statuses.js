import express from 'express';
import { editStatus, addPrestige } from '../controllers/statuses.js';
import authenticate from '../middleware/authenticate.js';

const router = express.Router();

router.post("/edit-status", authenticate, editStatus);

router.post("/add-prestige", authenticate, addPrestige);

export default router;
