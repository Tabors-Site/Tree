const express = require("express");
const router = express.Router();
const authenticate  = require("../middleware/authenticate");
const { updateSchedule } = require("../controllers/schedules");

// Route to update schedule
router.post("/update-schedule", authenticate, updateSchedule);

module.exports = router;
