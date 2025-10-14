const express = require("express");
const router = express.Router();
const authenticate = require("../middleware/authenticate");
const {
  invite,
  inviteAccept,
  getPendingInvites,
} = require("../controllers/invites");

router.post("/invite", authenticate, invite);

router.post("/invite/accept", authenticate, inviteAccept);

router.post("/pending-invites", authenticate, getPendingInvites);

// Export the router
module.exports = router;
