import express from 'express';
import { getContributions } from '../controllers/contributions.js';

const router = express.Router();

router.post('/get-contributions', getContributions);

export default router;
