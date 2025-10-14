const express = require("express");
const { getAiResponse } = require("../controllers/oldAI");

const { handleMcpRequest } = require("../controllers/mcp/server");
const { getMCPResponse } = require("../controllers/mcp/client");

const router = express.Router();

router.post("/AiResponse", getAiResponse);
router.post("/mcp", handleMcpRequest);
router.post("/getMCPResponse", getMCPResponse);


module.exports = router;
