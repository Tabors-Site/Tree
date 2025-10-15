import express from 'express';

const router = express.Router();
import authenticate from '../middleware/authenticate.js';
import { updateScript, executeScript } from '../controllers/scripts.js';

router.post("/updateScript", authenticate, updateScript);
router.post("/executeScript", authenticate, executeScript);

export default router;
