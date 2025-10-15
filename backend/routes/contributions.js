import express from 'express';
const router = express.Router();
import { getContributions } from '../controllers/contributions.js';


// Route for getting contributions
router.post('/get-contributions', getContributions);

// Export the router
export default router;
