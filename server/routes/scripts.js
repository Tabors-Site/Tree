const express = require("express");

const router = express.Router();
const authenticate = require("../middleware/authenticate");
const { updateScript, executeScript } = require("../controllers/scripts");

router.post("/updateScript", authenticate, updateScript);
router.post("/executeScript", authenticate, executeScript);

module.exports = router;
