import express from "express";
import { handleMcpRequest } from "../mcp/server.js";
import authenticateMCP from "../middleware/authenticateMCP.js";

const router = express.Router();

router.post("/mcp", authenticateMCP, handleMcpRequest);

export default router;
