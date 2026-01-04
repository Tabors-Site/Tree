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
  if (client_id !== "chatgpt-connector") {
    return res.status(400).send("Invalid client");
  }

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
      text-align: left;
    }

    .oauth-hint::before {
      content: 'ℹ️ ';
      margin-right: 6px;
    }

    /* Form */
    form {
      margin-bottom: 16px;
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
      font-family: inherit;
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
      margin-bottom: 16px;
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

    /* Secondary Actions */
    .secondary-actions {
      display: flex;
      flex-direction: column;
      gap: 8px;
      margin-top: 24px;
      padding-top: 24px;
      border-top: 2px solid #e9ecef;
    }

    .back-btn,
    .secondary-btn {
      width: 100%;
      background: transparent;
      color: #667eea;
      box-shadow: none;
      font-weight: 600;
      padding: 12px;
      font-size: 15px;
    }

    .back-btn:hover,
    .secondary-btn:hover {
      background: rgba(102, 126, 234, 0.1);
      transform: none;
      box-shadow: none;
    }

    .secondary-btn {
      margin-top: 0;
    }

    /* Divider */
    .divider {
      display: flex;
      align-items: center;
      text-align: center;
      margin: 20px 0;
    }

    .divider::before,
    .divider::after {
      content: '';
      flex: 1;
      border-bottom: 1px solid #e9ecef;
    }

    .divider span {
      padding: 0 16px;
      color: #999;
      font-size: 13px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.5px;
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
    <div class="brand-subtitle">Organize your life, efficiently</div>
  </div>

  <!-- Login Container -->
  <div class="login-container">
    <h2>Welcome Back</h2>

    <p id="oauthHint" class="oauth-hint" style="display:none;">
      Please log in to continue. If you need to register, please restart the process afterward.
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

    <div class="divider">
      <span>Need Help?</span>
    </div>

    <div class="secondary-actions">
      <button type="button" id="forgotPasswordBtn" class="secondary-btn">
        Forgot your password?
      </button>

      <button type="button" id="registerBtn" class="secondary-btn">
        Create an account
      </button>

      <button class="back-btn" onclick="goBack()">← Back to Home</button>
    </div>
  </div>

  <script>
    const apiUrl = "https://tree.tabors.site/api";
    const redirectAfterLogin = "${redirect}" ? decodeURIComponent("${redirect}") : null;

    if (redirectAfterLogin) {
      document.getElementById("oauthHint").style.display = "block";
    }

    // Secondary button handlers
    document.getElementById("registerBtn").addEventListener("click", () => {
      window.location.href = "/register";
    });

    document.getElementById("forgotPasswordBtn").addEventListener("click", () => {
      window.location.href = "/forgot-password";
    });

    // Login form submission
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
} else if (data.htmlShareToken) {
  window.location.href =
    "/api/user/" +
    data.userId +
    "?html&token=" +
    encodeURIComponent(data.htmlShareToken);
} else {
  window.location.href =
    "/api/user/" + data.userId + "/sharetoken?html";
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
export function renderRegisterPage(req, res) {
  res.setHeader("Content-Type", "text/html");
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="theme-color" content="#667eea">
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
  <title>Tree — Register</title>

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

    /* Register Container */
    .register-container {
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

    .register-container::before {
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
      margin-bottom: 8px;
    }

    .subtitle {
      font-size: 15px;
      color: #666;
      margin-bottom: 32px;
      line-height: 1.5;
    }

    /* Form */
    form {
      margin-bottom: 16px;
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

    input.error {
      border-color: #ef4444;
    }

    input.error:focus {
      box-shadow: 0 0 0 4px rgba(239, 68, 68, 0.1);
    }

    /* Password strength indicator */
    .password-hint {
      font-size: 12px;
      color: #888;
      margin-top: 6px;
      text-align: left;
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
      font-family: inherit;
    }

    button:hover {
      transform: translateY(-2px);
      box-shadow: 0 6px 20px rgba(102, 126, 234, 0.4);
    }

    button:active {
      transform: translateY(0);
    }

    /* Messages */
    .message {
      margin-top: 16px;
      margin-bottom: 16px;
      padding: 12px;
      border-radius: 8px;
      font-size: 14px;
      font-weight: 600;
      text-align: left;
      display: none;
    }

    .error-message {
      color: #ef4444;
      background: rgba(239, 68, 68, 0.1);
      border-left: 3px solid #ef4444;
    }

    .success-message {
      color: #16a34a;
      background: rgba(34, 197, 94, 0.1);
      border-left: 3px solid #16a34a;
    }

    .message.show {
      display: block;
    }

    /* Secondary Actions */
    .secondary-actions {
      display: flex;
      flex-direction: column;
      gap: 8px;
      margin-top: 24px;
      padding-top: 24px;
      border-top: 2px solid #e9ecef;
    }

    .back-btn {
      width: 100%;
      background: transparent;
      color: #667eea;
      box-shadow: none;
      font-weight: 600;
      padding: 12px;
      font-size: 15px;
      margin-top: 0;
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

      .register-container {
        padding: 32px 24px;
      }

      h2 {
        font-size: 28px;
      }
    }

    @media (min-width: 641px) and (max-width: 1024px) {
      .register-container {
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
    <div class="brand-subtitle">Organize your life, efficiently</div>
  </div>

  <!-- Register Container -->
  <div class="register-container">
    <h2>Create Account</h2>
    <p class="subtitle">Sign up to get started with Tree</p>

    <form id="registerForm">
      <div class="input-group">
        <label for="username">Username</label>
        <input 
          type="text"
          id="username" 
          placeholder="Choose a username"
          required 
          autocomplete="username"
        />
      </div>

      <div class="input-group">
        <label for="email">Email</label>
        <input 
          type="email" 
          id="email" 
          placeholder="Enter your email"
          required 
          autocomplete="email"
        />
      </div>

      <div class="input-group">
        <label for="password">Password</label>
        <input 
          type="password" 
          id="password" 
          placeholder="Create a password"
          required 
          autocomplete="new-password"
        />
        <div class="password-hint">Must be at least 8 characters</div>
      </div>

      <div class="input-group">
        <label for="confirmPassword">Confirm Password</label>
        <input 
          type="password" 
          id="confirmPassword" 
          placeholder="Confirm your password"
          required 
          autocomplete="new-password"
        />
      </div>

      <button type="submit" id="registerBtn">Create Account</button>
    </form>

    <div id="errorMessage" class="message error-message"></div>
    <div id="successMessage" class="message success-message">
      ✓ Registration successful! Check your email to complete registration.
    </div>

    <div class="secondary-actions">
      <button class="back-btn" onclick="window.location.href='/login'">
        ← Back to Login
      </button>
    </div>
  </div>

  <script>
    const apiUrl = "https://tree.tabors.site/api";

    document.getElementById("registerForm").addEventListener("submit", async (e) => {
      e.preventDefault();

      const username = document.getElementById("username").value.trim();
      const email = document.getElementById("email").value.trim();
      const password = document.getElementById("password").value;
      const confirmPassword = document.getElementById("confirmPassword").value;

      const errorEl = document.getElementById("errorMessage");
      const successEl = document.getElementById("successMessage");
      const btn = document.getElementById("registerBtn");
      const passwordInput = document.getElementById("password");
      const confirmPasswordInput = document.getElementById("confirmPassword");

      // Clear previous states
      errorEl.classList.remove("show");
      successEl.classList.remove("show");
      passwordInput.classList.remove("error");
      confirmPasswordInput.classList.remove("error");

      // Client-side validation
      if (password.length < 8) {
        errorEl.textContent = "Password must be at least 8 characters long.";
        errorEl.classList.add("show");
        passwordInput.classList.add("error");
        passwordInput.focus();
        return;
      }

      if (password !== confirmPassword) {
        errorEl.textContent = "Passwords do not match.";
        errorEl.classList.add("show");
        confirmPasswordInput.classList.add("error");
        confirmPasswordInput.focus();
        return;
      }

      btn.classList.add("loading");
      btn.disabled = true;

      try {
        const res = await fetch(\`\${apiUrl}/register\`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username, email, password })
        });

        const data = await res.json();

        if (!res.ok) {
          errorEl.textContent = data.message || "Registration failed. Please try again.";
          errorEl.classList.add("show");
          btn.classList.remove("loading");
          btn.disabled = false;
          return;
        }

        // Success
        document.getElementById("registerForm").reset();
        successEl.classList.add("show");
        btn.classList.remove("loading");
        btn.disabled = false;

        // Redirect to login after 3 seconds
        setTimeout(() => {
          window.location.href = "/login";
        }, 3000);

      } catch (err) {
        console.error(err);
        errorEl.textContent = "An error occurred. Please try again.";
        errorEl.classList.add("show");
        btn.classList.remove("loading");
        btn.disabled = false;
      }
    });

    // Real-time password match validation
    document.getElementById("confirmPassword").addEventListener("input", (e) => {
      const password = document.getElementById("password").value;
      const confirmPassword = e.target.value;
      const confirmPasswordInput = e.target;

      if (confirmPassword && password !== confirmPassword) {
        confirmPasswordInput.classList.add("error");
      } else {
        confirmPasswordInput.classList.remove("error");
      }
    });
  </script>
</body>
</html>`);
}

export function renderForgotPasswordPage(req, res) {
  res.setHeader("Content-Type", "text/html");
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="theme-color" content="#667eea">
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
  <title>Tree — Reset Password</title>

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

    /* Forgot Password Container */
    .forgot-container {
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

    .forgot-container::before {
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

    .subtitle {
      font-size: 15px;
      color: #666;
      margin-bottom: 32px;
      line-height: 1.6;
    }

    /* Info Box */
    .info-box {
      background: linear-gradient(135deg, rgba(102, 126, 234, 0.1) 0%, rgba(118, 75, 162, 0.1) 100%);
      padding: 16px;
      border-radius: 12px;
      border-left: 4px solid #667eea;
      margin-bottom: 32px;
      text-align: left;
    }

    .info-box-content {
      font-size: 14px;
      color: #666;
      line-height: 1.6;
    }

    .info-box-content::before {
      margin-right: 6px;
    }

    /* Form */
    form {
      margin-bottom: 16px;
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
      font-family: inherit;
    }

    button:hover {
      transform: translateY(-2px);
      box-shadow: 0 6px 20px rgba(102, 126, 234, 0.4);
    }

    button:active {
      transform: translateY(0);
    }

    /* Success Message */
    .success-message {
      margin-top: 16px;
      margin-bottom: 16px;
      padding: 16px;
      border-radius: 8px;
      font-size: 15px;
      font-weight: 600;
      text-align: left;
      color: #16a34a;
      background: rgba(34, 197, 94, 0.1);
      border-left: 3px solid #16a34a;
      display: none;
      line-height: 1.6;
    }

    .success-message::before {
      content: '✓ ';
      margin-right: 6px;
      font-size: 16px;
    }

    .success-message.show {
      display: block;
    }

    /* Secondary Actions */
    .secondary-actions {
      display: flex;
      flex-direction: column;
      gap: 8px;
      margin-top: 24px;
      padding-top: 24px;
      border-top: 2px solid #e9ecef;
    }

    .back-btn {
      width: 100%;
      background: transparent;
      color: #667eea;
      box-shadow: none;
      font-weight: 600;
      padding: 12px;
      font-size: 15px;
      margin-top: 0;
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

      .forgot-container {
        padding: 32px 24px;
      }

      h2 {
        font-size: 28px;
      }
    }

    @media (min-width: 641px) and (max-width: 1024px) {
      .forgot-container {
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
    <div class="brand-subtitle">Organize your life, efficiently</div>
  </div>

  <!-- Forgot Password Container -->
  <div class="forgot-container">
    <h2>Reset Password</h2>
    <p class="subtitle">
      Enter your email address and we'll send you a link to reset your password.
    </p>

    <div class="info-box">
      <div class="info-box-content">
        For security reasons, we'll send a reset link if an account exists for this email.
      </div>
    </div>

    <form id="forgotForm">
      <div class="input-group">
        <label for="email">Email Address</label>
        <input 
          type="email" 
          id="email" 
          placeholder="Enter your email"
          required 
          autocomplete="email"
        />
      </div>

      <button type="submit" id="submitBtn">Send Reset Link</button>
    </form>

    <div id="successMessage" class="success-message">
      If an account exists for that email, a password reset link has been sent. Please check your inbox.
    </div>

    <div class="secondary-actions">
      <button class="back-btn" onclick="window.location.href='/login'">
        ← Back to Login
      </button>
    </div>
  </div>

  <script>
    const apiUrl = "https://tree.tabors.site/api";

    document.getElementById("forgotForm").addEventListener("submit", async (e) => {
      e.preventDefault();

      const email = document.getElementById("email").value.trim();
      const btn = document.getElementById("submitBtn");
      const successEl = document.getElementById("successMessage");

      successEl.classList.remove("show");
      btn.classList.add("loading");
      btn.disabled = true;

      try {
        await fetch(\`\${apiUrl}/forgot-password\`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email })
        });

        // Always show success (by design - security)
        document.getElementById("forgotForm").reset();
        successEl.classList.add("show");
        btn.classList.remove("loading");
        btn.disabled = false;

      } catch (err) {
        console.error(err);
        // Still show success message for security
        document.getElementById("forgotForm").reset();
        successEl.classList.add("show");
        btn.classList.remove("loading");
        btn.disabled = false;
      }
    });
  </script>
</body>
</html>`);
}

export async function oauthToken(req, res) {
  try {
    const { grant_type, code, client_id, code_verifier } = req.body;
    if (client_id !== "chatgpt-connector") {
      return res.status(400).send("Invalid client");
    }

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
