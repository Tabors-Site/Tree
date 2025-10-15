// routes/statusRouter.js
import express from 'express';

import { editStatus, addPrestige } from '../controllers/statuses.js';
import authenticate from '../middleware/authenticate.js';

const router = express.Router();

// Route to edit the status of a node version and its children
router.post("/edit-status", authenticate, editStatus);

// Route to add prestige to a node
router.post("/add-prestige", authenticate, addPrestige);

export default router;
