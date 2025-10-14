const express = require("express");
const { setValueForNode, setGoalForNode } = require("../controllers/values");
const authenticate  = require("../middleware/authenticate");

const router = express.Router();

// Route to edit the value for a node
router.post("/edit-value", authenticate, setValueForNode);

// Route to edit the goal for a node
router.post("/edit-goal", authenticate, setGoalForNode);

module.exports = router;
