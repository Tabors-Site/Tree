const BASE_URL = process.env.TREE_FRONTEND_DOMAIN;
import AuthCode from "../db/models/authCode.js";
import User from "../db/models/user.js";
import crypto from "crypto";

export function getOpenIdConfiguration(req, res) {
  res.json({
    issuer: BASE_URL,

    authorization_endpoint: `${BASE_URL}/oauth2/authorize`,
    token_endpoint: `${BASE_URL}/oauth2/token`,
    registration_endpoint: `${BASE_URL}/oauth2/register`,

    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code"],

    token_endpoint_auth_methods_supported: ["none", "client_secret_post"],

    code_challenge_methods_supported: ["S256"],

    scopes_supported: ["email"],
    claims_supported: ["sub"],
  });
}

export function oauthRegister(req, res) {
  /**
   * Handles dynamic OAuth client registration from ChatGPT.
   * ChatGPT does not require true dynamic registration — a static response is sufficient.
   */

  res.json({
    client_id: process.env.CHATGPT_OAUTH_CLIENT_ID || "chatgpt-connector",

    redirect_uris: ["https://chatgpt.com/connector_platform_oauth_redirect"],

    token_endpoint_auth_method: "none",

    grant_types: ["authorization_code"],

    response_types: ["code"],

    application_type: "web",

    // ⚠️ MUST be EXACTLY one of:
    // "email" OR "openid email"
    scope: "email",
  });
}

export async function oauthAuthorize(req, res) {
  const {
    response_type,
    client_id,
    redirect_uri,
    state,
    code_challenge,
    code_challenge_method,
    scope,
  } = req.query;

  // 1️⃣ Basic validation
  if (response_type !== "code") {
    return res.status(400).send("Invalid response_type");
  }

  if (!redirect_uri) {
    return res.status(400).send("Missing redirect_uri");
  }

  // 🔒 Enforce ChatGPT callback
  if (
    redirect_uri !== "https://chatgpt.com/connector_platform_oauth_redirect"
  ) {
    return res.status(400).send("Invalid redirect_uri");
  }

  // 2️⃣ Check login (use your existing auth system)
  const userId = req.userId; // set by auth middleware/session/cookie

  if (!userId) {
    return res.redirect(
      `/login?redirect=${encodeURIComponent(req.originalUrl)}`
    );
  }

  // 3️⃣ Confirm user still exists
  const user = await User.findById(userId);
  if (!user) {
    return res.redirect(
      `/login?redirect=${encodeURIComponent(req.originalUrl)}`
    );
  }

  // 4️⃣ Generate one-time authorization code
  const authCode = crypto.randomBytes(32).toString("hex");

  await AuthCode.create({
    code: authCode,
    userId: user._id,
    clientId: client_id,
    codeChallenge: code_challenge,
    codeChallengeMethod: code_challenge_method,
    scope,
    expiresAt: new Date(Date.now() + 5 * 60 * 1000), // 5 min
  });

  // 6️⃣ Redirect back to ChatGPT
  const redirectUrl = new URL(redirect_uri);
  redirectUrl.searchParams.set("code", authCode);
  if (state) redirectUrl.searchParams.set("state", state);

  return res.redirect(redirectUrl.toString());
}

export function renderLoginPage(req, res) {
  const redirect = req.query.redirect
    ? encodeURIComponent(req.query.redirect)
    : "";

  res.setHeader("Content-Type", "text/html");
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="theme-color" content="#667eea">
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
  <title>Tree — Login</title>

  <style>
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen', 'Ubuntu', 'Cantarell', sans-serif;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 20px;
      position: relative;
      overflow-x: hidden;
      overflow-y: auto;
    }

    /* Animated background elements */
    body::before,
    body::after {
      content: '';
      position: fixed;
      border-radius: 50%;
      opacity: 0.1;
      animation: float 20s infinite ease-in-out;
      pointer-events: none;
    }

    body::before {
      width: 600px;
      height: 600px;
      background: white;
      top: -300px;
      right: -200px;
      animation-delay: -5s;
    }

    body::after {
      width: 400px;
      height: 400px;
      background: white;
      bottom: -200px;
      left: -100px;
      animation-delay: -10s;
    }

    @keyframes float {
      0%, 100% {
        transform: translateY(0) rotate(0deg);
      }
      50% {
        transform: translateY(-30px) rotate(5deg);
      }
    }

    /* Brand Header */
    .brand-header {
      position: relative;
      z-index: 1;
      margin-bottom: 32px;
      text-align: center;
      animation: fadeInDown 0.8s ease-out;
    }

    @keyframes fadeInDown {
      from {
        opacity: 0;
        transform: translateY(-30px);
      }
      to {
        opacity: 1;
        transform: translateY(0);
      }
    }

    .brand-logo {
      font-size: 80px;
      margin-bottom: 16px;
      display: inline-block;
      animation: grow 2s infinite ease-in-out;
    }

    @keyframes grow {
      0%, 100% {
        transform: scale(1);
      }
      50% {
        transform: scale(1.1);
      }
    }

    .brand-title {
      font-size: 56px;
      font-weight: 800;
      color: white;
      text-shadow: 0 4px 20px rgba(0, 0, 0, 0.2);
      letter-spacing: -1px;
      margin-bottom: 8px;
    }

    .brand-subtitle {
      font-size: 18px;
      color: rgba(255, 255, 255, 0.9);
      font-weight: 500;
    }

    /* Login Container */
    .login-container {
      background: rgba(255, 255, 255, 0.98);
      backdrop-filter: blur(20px);
      padding: 48px;
      border-radius: 24px;
      width: 100%;
      max-width: 460px;
      box-shadow: 0 20px 60px rgba(0, 0, 0, 0.2);
      text-align: center;
      position: relative;
      z-index: 1;
      animation: slideUp 0.6s ease-out;
    }

    @keyframes slideUp {
      from {
        opacity: 0;
        transform: translateY(30px);
      }
      to {
        opacity: 1;
        transform: translateY(0);
      }
    }

    .login-container::before {
      content: '';
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 6px;
      background: linear-gradient(90deg, #667eea 0%, #764ba2 100%);
      border-radius: 24px 24px 0 0;
    }

    h2 {
      font-size: 32px;
      font-weight: 700;
      color: #1a1a1a;
      margin-bottom: 12px;
    }

    .oauth-hint {
      font-size: 15px;
      color: #666;
      margin-bottom: 32px;
      line-height: 1.6;
      padding: 16px;
      background: linear-gradient(135deg, rgba(102, 126, 234, 0.1) 0%, rgba(118, 75, 162, 0.1) 100%);
      border-radius: 12px;
      border-left: 4px solid #667eea;
    }

    .oauth-hint::before {
      content: 'ℹ️ ';
      margin-right: 6px;
    }

    /* Form */
    form {
      margin-bottom: 24px;
    }

    .input-group {
      margin-bottom: 16px;
      text-align: left;
    }

    label {
      display: block;
      font-size: 14px;
      font-weight: 600;
      color: #667eea;
      margin-bottom: 8px;
    }

    input {
      width: 100%;
      padding: 14px 18px;
      border-radius: 12px;
      border: 2px solid #e9ecef;
      font-size: 15px;
      transition: all 0.2s;
      background: white;
      font-family: inherit;
    }

    input:focus {
      outline: none;
      border-color: #667eea;
      box-shadow: 0 0 0 4px rgba(102, 126, 234, 0.1);
    }

    input::placeholder {
      color: #aaa;
    }

    button {
      width: 100%;
      padding: 16px;
      margin-top: 8px;
      border-radius: 12px;
      border: none;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      font-size: 16px;
      font-weight: 700;
      cursor: pointer;
      transition: all 0.2s;
      box-shadow: 0 4px 12px rgba(102, 126, 234, 0.3);
    }

    button:hover {
      transform: translateY(-2px);
      box-shadow: 0 6px 20px rgba(102, 126, 234, 0.4);
    }

    button:active {
      transform: translateY(0);
    }

    .error-message {
      color: #ef4444;
      margin-top: 16px;
      padding: 12px;
      background: rgba(239, 68, 68, 0.1);
      border-radius: 8px;
      font-size: 14px;
      font-weight: 600;
      border-left: 3px solid #ef4444;
      text-align: left;
    }

    .error-message:empty {
      display: none;
    }

    .back-btn {
      margin-top: 16px;
      background: transparent;
      color: #667eea;
      box-shadow: none;
      font-weight: 600;
      padding: 12px;
    }

    .back-btn:hover {
      background: rgba(102, 126, 234, 0.1);
      transform: none;
      box-shadow: none;
    }

    /* Loading State */
    button.loading {
      position: relative;
      color: transparent;
      pointer-events: none;
    }

    button.loading::after {
      content: '';
      position: absolute;
      width: 20px;
      height: 20px;
      top: 50%;
      left: 50%;
      margin-left: -10px;
      margin-top: -10px;
      border: 3px solid rgba(255, 255, 255, 0.3);
      border-radius: 50%;
      border-top-color: white;
      animation: spin 0.8s linear infinite;
    }

    @keyframes spin {
      to {
        transform: rotate(360deg);
      }
    }

    /* Responsive */
    @media (max-width: 640px) {
      body {
        padding: 20px 16px;
        justify-content: center;
      }

      .brand-header {
        margin-bottom: 24px;
      }

      .brand-logo {
        font-size: 64px;
      }

      .brand-title {
        font-size: 42px;
      }

      .brand-subtitle {
        font-size: 16px;
      }

      .login-container {
        padding: 32px 24px;
      }

      h2 {
        font-size: 28px;
      }
    }

    @media (min-width: 641px) and (max-width: 1024px) {
      .login-container {
        max-width: 420px;
      }
    }
  </style>
</head>

<body>
  <!-- Brand Header -->
  <div class="brand-header">
    <div class="brand-logo">🌳</div>
    <h1 class="brand-title">Tree</h1>
    <div class="brand-subtitle">Organize your life, beautifully</div>
  </div>

  <!-- Login Container -->
  <div class="login-container">
    <h2>Welcome Back</h2>

    <p id="oauthHint" class="oauth-hint" style="display:none;">
      Please log in to continue
    </p>

    <form id="loginForm">
      <div class="input-group">
        <label for="username">Username</label>
        <input 
          type="text" 
          id="username" 
          placeholder="Enter your username" 
          required 
          autocomplete="username"
        />
      </div>

      <div class="input-group">
        <label for="password">Password</label>
        <input 
          type="password" 
          id="password" 
          placeholder="Enter your password" 
          required 
          autocomplete="current-password"
        />
      </div>

      <button type="submit" id="loginBtn">Login</button>
    </form>

    <p id="errorMessage" class="error-message"></p>

    <button class="back-btn" onclick="goBack()">← Go Back</button>
  </div>

  <script>
    const apiUrl = "https://tree.tabors.site/api";
    const redirectAfterLogin = "${redirect}" ? decodeURIComponent("${redirect}") : null;

    if (redirectAfterLogin) {
      document.getElementById("oauthHint").style.display = "block";
    }

    document.getElementById("loginForm").addEventListener("submit", async (e) => {
      e.preventDefault();

      const username = document.getElementById("username").value.trim();
      const password = document.getElementById("password").value;
      const errorEl = document.getElementById("errorMessage");
      const loginBtn = document.getElementById("loginBtn");
      
      errorEl.textContent = "";
      loginBtn.classList.add("loading");
      loginBtn.disabled = true;

      try {
        const res = await fetch(\`\${apiUrl}/login\`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ username, password })
        });

        const data = await res.json();

        if (!res.ok) {
          errorEl.textContent = data.message || "Login failed. Please check your credentials.";
          loginBtn.classList.remove("loading");
          loginBtn.disabled = false;
          return;
        }

          if (redirectAfterLogin) {
            window.location.href = redirectAfterLogin;
          } else {
            window.location.href = "/";
          }
      } catch (err) {
        console.error(err);
        errorEl.textContent = "An error occurred. Please try again.";
        loginBtn.classList.remove("loading");
        loginBtn.disabled = false;
      }
    });

    function goBack() {
      window.location.href = "/";
    }
  </script>
</body>
</html>`);
}

export async function oauthToken(req, res) {
  try {
    const { grant_type, code, client_id, code_verifier } = req.body;

    // 1️⃣ Grant type validation
    if (grant_type !== "authorization_code") {
      return res.status(400).json({
        error: "unsupported_grant_type",
      });
    }

    if (!code) {
      return res.status(400).json({
        error: "invalid_request",
        error_description: "Missing authorization code",
      });
    }

    // 2️⃣ Look up auth code
    const authCode = await AuthCode.findOne({ code });

    if (!authCode) {
      return res.status(400).json({
        error: "invalid_grant",
        error_description: "Invalid or expired authorization code",
      });
    }

    // 3️⃣ Expiration check
    if (authCode.expiresAt < new Date()) {
      await authCode.deleteOne();
      return res.status(400).json({
        error: "invalid_grant",
        error_description: "Authorization code expired",
      });
    }

    // 4️⃣ Client binding (important)
    if (authCode.clientId !== client_id) {
      return res.status(400).json({
        error: "invalid_client",
      });
    }

    // 5️⃣ PKCE verification (S256)
    if (authCode.codeChallenge) {
      if (!code_verifier) {
        return res.status(400).json({
          error: "invalid_request",
          error_description: "Missing code_verifier",
        });
      }

      const hashed = crypto
        .createHash("sha256")
        .update(code_verifier)
        .digest("base64url");

      if (hashed !== authCode.codeChallenge) {
        return res.status(400).json({
          error: "invalid_grant",
          error_description: "PKCE verification failed",
        });
      }
    }

    // 6️⃣ Load user
    const user = await User.findById(authCode.userId);
    if (!user) {
      return res.status(400).json({
        error: "invalid_grant",
      });
    }

    // 7️⃣ Ensure OpenAI connector token exists
    if (!user.openAiConnector || user.openAiConnector.revoked) {
      user.openAiConnector = {
        token: await generateOpenAIToken(),
        revoked: false,
        createdAt: new Date(),
      };
    }

    user.openAiConnector.lastUsedAt = new Date();
    await user.save();

    // 8️⃣ One-time use: burn the auth code
    await authCode.deleteOne();

    // 9️⃣ Return token (THIS IS THE MAGIC)
    // 9️⃣ Return connector token to ChatGPT
    return res.json({
      access_token: user.openAiConnector.token,
      token_type: "Bearer",
      expires_in: 7776000, // 90 days
      scope: "token",
    });
  } catch (err) {
    console.error("[oauthToken]", err);
    return res.status(500).json({
      error: "server_error",
    });
  }
}

async function generateOpenAIToken() {
  let token;
  do {
    token = "oa_" + crypto.randomBytes(32).toString("hex");
  } while (await User.exists({ "openAiConnector.token": token }));
  return token;
}
