import express from 'express';
const router = express.Router();
import authenticate from '../middleware/authenticate.js';
import { invite, inviteAccept, getPendingInvites } from '../controllers/invites.js';

router.post("/invite", authenticate, invite);

router.post("/invite/accept", authenticate, inviteAccept);

router.post("/pending-invites", authenticate, getPendingInvites);

// Export the router
export default router;
