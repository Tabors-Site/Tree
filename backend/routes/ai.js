import express from 'express';
import { getAiResponse } from '../controllers/oldAI.js';
import { handleMcpRequest } from '../mcp/server.js';
import { getMCPResponse } from '../mcp/client.js';

const router = express.Router();

router.post("/AiResponse", getAiResponse);
router.post("/mcp", handleMcpRequest);
router.post("/getMCPResponse", getMCPResponse);


export default router;
