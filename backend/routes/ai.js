import express from "express";
import { getAiResponse, aiUserResponse } from "../controllers/oldAI.js";
import { handleMcpRequest } from "../mcp/server.js";
import { getMCPResponse } from "../mcp/client.js";
import {
  getOpenIdConfiguration,
  oauthRegister,
  oauthAuthorize,
  renderLoginPage,
  renderRegisterPage,
  oauthToken,
  renderForgotPasswordPage,
} from "../mcp/oauth.js";

import authenticateOptional from "../middleware/authenticateLite.js";
import authenticateMCP from "../middleware/authenticateMCP.js";


const router = express.Router();

router.post("/AiResponse", getAiResponse);
router.post("/mcp", authenticateMCP, handleMcpRequest);

router.post("/getMCPResponse", getMCPResponse);
router.post("/aiUserResponse", aiUserResponse);
router.get("/login", renderLoginPage);
router.get("/register", renderRegisterPage);
router.get("/forgot-password", renderForgotPasswordPage);

router.get("/.well-known/openid-configuration", getOpenIdConfiguration);
router.post("/oauth2/register", oauthRegister);
router.get("/oauth2/authorize", authenticateOptional, oauthAuthorize);
router.post("/oauth2/token", oauthToken);

export default router;
