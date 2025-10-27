import express from 'express';
import authenticate from '../middleware/authenticate.js';
import { invite, inviteAccept, getPendingInvites } from '../controllers/invites.js';

const router = express.Router();

router.post("/invite", authenticate, invite);

router.post("/invite/accept", authenticate, inviteAccept);

router.post("/pending-invites", authenticate, getPendingInvites);

export default router;
