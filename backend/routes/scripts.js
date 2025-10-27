import express from 'express';
import authenticate from '../middleware/authenticate.js';
import { updateScript, executeScript } from '../controllers/scripts.js';

const router = express.Router();

router.post("/updateScript", authenticate, updateScript);
router.post("/executeScript", authenticate, executeScript);

export default router;
