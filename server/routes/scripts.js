const express = require("express");

const router = express.Router();
const authenticate = require("../middleware/authenticate");
const { updateScript, executeScript } = require("../controllers/scripts");

router.post("/updateScript", updateScript);
router.post("/executeScript", executeScript);

module.exports = router;
