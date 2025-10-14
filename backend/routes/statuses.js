// routes/statusRouter.js
const express = require("express");
const { editStatus, addPrestige } = require("../controllers/statuses");
const authenticate  = require("../middleware/authenticate");

const router = express.Router();

// Route to edit the status of a node version and its children
router.post("/edit-status", authenticate, editStatus);

// Route to add prestige to a node
router.post("/add-prestige", authenticate, addPrestige);

module.exports = router;
