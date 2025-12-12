import express from "express";
import { getAiResponse, aiUserResponse } from "../controllers/oldAI.js";
import { handleMcpRequest } from "../mcp/server.js";
import { getMCPResponse } from "../mcp/client.js";

const router = express.Router();

router.post("/AiResponse", getAiResponse);
router.post("/mcp", handleMcpRequest);
router.post("/getMCPResponse", getMCPResponse);
router.post("/aiUserResponse", aiUserResponse);

export default router;
