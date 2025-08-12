const express = require("express");
const { getAiResponse } = require("../controllers/ai");

const router = express.Router();

router.post("/AiResponse", getAiResponse);

module.exports = router;
