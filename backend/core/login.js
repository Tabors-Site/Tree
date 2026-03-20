const BASE_URL = process.env.TREE_FRONTEND_DOMAIN;
import AuthCode from "../db/models/authCode.js";
import User from "../db/models/user.js";
import crypto from "crypto";

export function renderLoginPage(req, res) {
  const redirect = req.query.redirect || "";

  res.setHeader("Content-Type", "text/html");
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, user-scalable=no" />
  <meta name="theme-color" content="#736fe6">
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
  <title>TreeOS - Login</title>

  <style>
    :root {
      --glass-water-rgb: 115, 111, 230;
      --glass-alpha: 0.28;
      --glass-alpha-hover: 0.38;
    }

    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
      -webkit-tap-highlight-color: transparent;
    }
  
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen', 'Ubuntu', 'Cantarell', sans-serif;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      min-height: 100vh;
      min-height: 100dvh;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 20px;
      position: relative;
      overflow-x: hidden;
      overflow-y: auto;
      touch-action: manipulation;
    }

    /* Animated background elements */
    body::before,
    body::after {
      content: '';
      position: fixed;
      border-radius: 50%;
      opacity: 0.08;
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
      html, body {
        background: #736fe6;
        margin: 0;
        padding: 0;
      }
    @keyframes float {
      0%, 100% {
        transform: translateY(0) rotate(0deg);
      }
      50% {
        transform: translateY(-30px) rotate(5deg);
      }
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

    /* Brand Header */
    .brand-header {
      position: relative;
      z-index: 1;
      margin-bottom: 32px;
      text-align: center;
      animation: fadeInDown 0.8s ease-out;
    }

    .brand-logo {
      font-size: 80px;
      margin-bottom: 16px;
      display: inline-block;
      filter: drop-shadow(0 8px 32px rgba(0, 0, 0, 0.2));
      animation: fadeInDown 0.5s ease-out both, grow 4.5s ease-in-out infinite;
    }

    @keyframes grow {
      0%, 100% {
        transform: scale(1);
      }
      50% {
        transform: scale(1.06);
      }
    }

    .brand-title {
      font-size: 56px;
      font-weight: 600;
      color: white;
      text-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
      letter-spacing: -1.5px;
      margin-bottom: 8px;
    }

    .brand-subtitle {
      font-size: 18px;
      color: rgba(255, 255, 255, 0.85);
      font-weight: 400;
      letter-spacing: 0.2px;
    }

    /* Login Container - Glass */
    .login-container {
      background: rgba(var(--glass-water-rgb), var(--glass-alpha));
      backdrop-filter: blur(22px) saturate(140%);
      -webkit-backdrop-filter: blur(22px) saturate(140%);
      padding: 48px;
      border-radius: 16px;
      width: 100%;
      max-width: 460px;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.12),
        inset 0 1px 0 rgba(255, 255, 255, 0.25);
      border: 1px solid rgba(255, 255, 255, 0.28);
      text-align: center;
      position: relative;
      z-index: 1;
      animation: slideUp 0.6s ease-out 0.2s both;
    }

    h2 {
      font-size: 32px;
      font-weight: 600;
      color: white;
      margin-bottom: 12px;
      text-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
      letter-spacing: -0.5px;
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
      color: white;
      margin-bottom: 8px;
      text-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
      letter-spacing: -0.2px;
    }

    input {
      width: 100%;
      padding: 14px 18px;
      border-radius: 12px;
      border: 2px solid rgba(255, 255, 255, 0.3);
      font-size: 16px;
      transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
      background: rgba(255, 255, 255, 0.15);
      backdrop-filter: blur(20px) saturate(150%);
      -webkit-backdrop-filter: blur(20px) saturate(150%);
      font-family: inherit;
      color: white;
      font-weight: 500;
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.1),
        inset 0 1px 0 rgba(255, 255, 255, 0.25);
      touch-action: manipulation;
    }

    input:focus {
      outline: none;
      border-color: rgba(255, 255, 255, 0.6);
      background: rgba(255, 255, 255, 0.25);
      backdrop-filter: blur(25px) saturate(160%);
      -webkit-backdrop-filter: blur(25px) saturate(160%);
      box-shadow: 
        0 0 0 4px rgba(255, 255, 255, 0.15),
        0 8px 30px rgba(0, 0, 0, 0.15),
        inset 0 1px 0 rgba(255, 255, 255, 0.4);
      transform: translateY(-2px);
    }

    input::placeholder {
      color: rgba(255, 255, 255, 0.5);
      font-weight: 400;
    }

    /* Glass Button */
    button {
      width: 100%;
      padding: 16px;
      margin-top: 8px;
      border-radius: 980px;
      border: 1px solid rgba(255, 255, 255, 0.3);
      background: rgba(255, 255, 255, 0.25);
      backdrop-filter: blur(10px);
      color: white;
      font-size: 16px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.3s;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.12);
      font-family: inherit;
      letter-spacing: -0.2px;
      position: relative;
      overflow: hidden;
      touch-action: manipulation;
    }

    button::before {
      content: "";
      position: absolute;
      inset: -40%;
      background: radial-gradient(
        120% 60% at 0% 0%,
        rgba(255, 255, 255, 0.35),
        transparent 60%
      );
      opacity: 0;
      transform: translateX(-30%) translateY(-10%);
      transition: opacity 0.35s ease, transform 0.6s cubic-bezier(0.22, 1, 0.36, 1);
      pointer-events: none;
    }

    button:hover::before {
      opacity: 1;
      transform: translateX(30%) translateY(10%);
    }

    button:hover {
      background: rgba(255, 255, 255, 0.35);
      transform: translateY(-2px);
      box-shadow: 0 6px 20px rgba(0, 0, 0, 0.18);
    }

    button:active {
      transform: translateY(0);
    }

    .error-message {
      color: white;
      margin-top: 16px;
      margin-bottom: 16px;
      padding: 12px 16px;
      background: rgba(239, 68, 68, 0.3);
      backdrop-filter: blur(10px);
      border-radius: 10px;
      font-size: 14px;
      font-weight: 600;
      border: 1px solid rgba(239, 68, 68, 0.4);
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
    }

    .back-btn,
    .secondary-btn {
      width: 100%;
      background: rgba(255, 255, 255, 0.15);
      color: white;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
      font-weight: 600;
      padding: 12px;
      font-size: 15px;
    }

    .back-btn:hover,
    .secondary-btn:hover {
      background: rgba(255, 255, 255, 0.25);
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
      border-bottom: 1px solid rgba(255, 255, 255, 0.2);
    }

    .divider span {
      padding: 0 16px;
      color: rgba(255, 255, 255, 0.8);
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
        letter-spacing: -1px;
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

      input {
        font-size: 16px;
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
  <a href="/" style="text-decoration: none;">
    <div class="brand-logo">🌳</div>
    <h1 class="brand-title">TreeOS</h1></a>
    <div class="brand-subtitle">Organize your life, efficiently</div>
  </div>

  <!-- Login Container -->
  <div class="login-container">
    <h2>Welcome Back</h2>

    <form id="loginForm">
      <div class="input-group">
        <label for="username">Username</label>
        <input 
          type="text" 
          id="username" 
          placeholder="Enter your username" 
          required 
          autocomplete="username"
          autocapitalize="off"
          autocorrect="off"
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
        <button type="button" id="registerBtn" class="secondary-btn">
        Create an account
      </button>
      <button type="button" id="forgotPasswordBtn" class="secondary-btn">
        Forgot your password?
      </button>

  

      <button class="back-btn" onclick="goBack()">← Back to Home</button>
    </div>
  </div>

  <script>
    const apiUrl = "https://treeOS.ai";
    const redirectAfterLogin = "${redirect}" || null;

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

    window.location.href = redirectAfterLogin || "/chat";

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
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, user-scalable=no" />
  <meta name="theme-color" content="#736fe6">
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
  <title>TreeOS - Register</title>

  <style>
    :root {
      --glass-water-rgb: 115, 111, 230;
      --glass-alpha: 0.28;
      --glass-alpha-hover: 0.38;
    }

    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
      -webkit-tap-highlight-color: transparent;
    }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen', 'Ubuntu', 'Cantarell', sans-serif;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      min-height: 100vh;
      min-height: 100dvh;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 20px;
      position: relative;
      overflow-x: hidden;
      overflow-y: auto;
      touch-action: manipulation;
    }

    body::before,
    body::after {
      content: '';
      position: fixed;
      border-radius: 50%;
      opacity: 0.08;
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

    html, body {
      background: #736fe6;
      margin: 0;
      padding: 0;
    }

    @keyframes float {
      0%, 100% { transform: translateY(0) rotate(0deg); }
      50% { transform: translateY(-30px) rotate(5deg); }
    }

    @keyframes fadeInDown {
      from { opacity: 0; transform: translateY(-30px); }
      to { opacity: 1; transform: translateY(0); }
    }

    @keyframes slideUp {
      from { opacity: 0; transform: translateY(30px); }
      to { opacity: 1; transform: translateY(0); }
    }

    .brand-header {
      position: relative;
      z-index: 1;
      margin-bottom: 32px;
      text-align: center;
      animation: fadeInDown 0.8s ease-out;
    }

    .brand-logo {
      font-size: 80px;
      margin-bottom: 16px;
      display: inline-block;
      filter: drop-shadow(0 8px 32px rgba(0, 0, 0, 0.2));
      animation: fadeInDown 0.5s ease-out both, grow 4.5s ease-in-out infinite;
    }

    @keyframes grow {
      0%, 100% { transform: scale(1); }
      50% { transform: scale(1.06); }
    }

    .brand-title {
      font-size: 56px;
      font-weight: 600;
      color: white;
      text-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
      letter-spacing: -1.5px;
      margin-bottom: 8px;
    }

    .brand-subtitle {
      font-size: 18px;
      color: rgba(255, 255, 255, 0.85);
      font-weight: 400;
      letter-spacing: 0.2px;
    }

    .register-container {
      background: rgba(var(--glass-water-rgb), var(--glass-alpha));
      backdrop-filter: blur(22px) saturate(140%);
      -webkit-backdrop-filter: blur(22px) saturate(140%);
      padding: 48px;
      border-radius: 16px;
      width: 100%;
      max-width: 460px;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.12),
        inset 0 1px 0 rgba(255, 255, 255, 0.25);
      border: 1px solid rgba(255, 255, 255, 0.28);
      text-align: center;
      position: relative;
      z-index: 1;
      animation: slideUp 0.6s ease-out 0.2s both;
    }

    h2 {
      font-size: 32px;
      font-weight: 600;
      color: white;
      margin-bottom: 8px;
      text-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
      letter-spacing: -0.5px;
    }

    .subtitle {
      font-size: 15px;
      color: rgba(255, 255, 255, 0.85);
      margin-bottom: 32px;
      line-height: 1.5;
      font-weight: 400;
    }

    form { margin-bottom: 16px; }

    .input-group {
      margin-bottom: 16px;
      text-align: left;
    }

    label {
      display: block;
      font-size: 14px;
      font-weight: 600;
      color: white;
      margin-bottom: 8px;
      text-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
      letter-spacing: -0.2px;
    }

    input {
      width: 100%;
      padding: 14px 18px;
      border-radius: 12px;
      border: 2px solid rgba(255, 255, 255, 0.3);
      font-size: 16px;
      transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
      background: rgba(255, 255, 255, 0.15);
      backdrop-filter: blur(20px) saturate(150%);
      -webkit-backdrop-filter: blur(20px) saturate(150%);
      font-family: inherit;
      color: white;
      font-weight: 500;
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.1),
        inset 0 1px 0 rgba(255, 255, 255, 0.25);
      touch-action: manipulation;
    }

    input:focus {
      outline: none;
      border-color: rgba(255, 255, 255, 0.6);
      background: rgba(255, 255, 255, 0.25);
      backdrop-filter: blur(25px) saturate(160%);
      -webkit-backdrop-filter: blur(25px) saturate(160%);
      box-shadow: 
        0 0 0 4px rgba(255, 255, 255, 0.15),
        0 8px 30px rgba(0, 0, 0, 0.15),
        inset 0 1px 0 rgba(255, 255, 255, 0.4);
      transform: translateY(-2px);
    }

    input::placeholder {
      color: rgba(255, 255, 255, 0.5);
      font-weight: 400;
    }

    input.error {
      border-color: rgba(239, 68, 68, 0.6);
      background: rgba(239, 68, 68, 0.1);
    }

    input.error:focus {
      box-shadow: 
        0 0 0 4px rgba(239, 68, 68, 0.2),
        0 8px 30px rgba(239, 68, 68, 0.2);
    }

    .password-hint {
      font-size: 12px;
      color: rgba(255, 255, 255, 0.7);
      margin-top: 6px;
      text-align: left;
      font-weight: 400;
    }

    button {
      width: 100%;
      padding: 16px;
      margin-top: 8px;
      border-radius: 980px;
      border: 1px solid rgba(255, 255, 255, 0.3);
      background: rgba(255, 255, 255, 0.25);
      backdrop-filter: blur(10px);
      color: white;
      font-size: 16px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.3s;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.12);
      font-family: inherit;
      letter-spacing: -0.2px;
      position: relative;
      overflow: hidden;
      touch-action: manipulation;
    }

    button::before {
      content: "";
      position: absolute;
      inset: -40%;
      background: radial-gradient(
        120% 60% at 0% 0%,
        rgba(255, 255, 255, 0.35),
        transparent 60%
      );
      opacity: 0;
      transform: translateX(-30%) translateY(-10%);
      transition: opacity 0.35s ease, transform 0.6s cubic-bezier(0.22, 1, 0.36, 1);
      pointer-events: none;
    }

    button:hover::before {
      opacity: 1;
      transform: translateX(30%) translateY(10%);
    }

    button:hover {
      background: rgba(255, 255, 255, 0.35);
      transform: translateY(-2px);
      box-shadow: 0 6px 20px rgba(0, 0, 0, 0.18);
    }

    button:active { transform: translateY(0); }

    .message {
      margin-top: 16px;
      margin-bottom: 16px;
      padding: 12px 16px;
      border-radius: 10px;
      font-size: 14px;
      font-weight: 600;
      text-align: left;
      display: none;
    }

    .error-message {
      color: white;
      background: rgba(239, 68, 68, 0.3);
      backdrop-filter: blur(10px);
      border: 1px solid rgba(239, 68, 68, 0.4);
    }

    .success-message {
      color: white;
      background: rgba(16, 185, 129, 0.3);
      backdrop-filter: blur(10px);
      border: 1px solid rgba(16, 185, 129, 0.4);
    }

    .message.show { display: block; }

    .secondary-actions {
      display: flex;
      flex-direction: column;
      gap: 8px;
      margin-top: 24px;
      padding-top: 24px;
    }

    .back-btn {
      width: 100%;
      background: rgba(255, 255, 255, 0.15);
      color: white;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
      font-weight: 600;
      padding: 12px;
      font-size: 15px;
      margin-top: 0;
    }

    .back-btn:hover { background: rgba(255, 255, 255, 0.25); }

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

    @keyframes spin { to { transform: rotate(360deg); } }

    /* Agreement text */
    .agreement-text {
      font-size: 13px;
      color: rgba(255, 255, 255, 0.65);
      line-height: 1.5;
      margin-top: 20px;
      margin-bottom: 4px;
      text-align: center;
    }

    .agreement-link {
      color: rgba(255, 255, 255, 0.9);
      text-decoration: underline;
      text-underline-offset: 2px;
      cursor: pointer;
      font-weight: 500;
      transition: color 0.2s;
    }

    .agreement-link:hover {
      color: white;
    }

    /* Modal overlay */
    .modal-overlay {
      display: none;
      position: fixed;
      inset: 0;
      z-index: 1000;
      background: rgba(0, 0, 0, 0.6);
      backdrop-filter: blur(8px);
      -webkit-backdrop-filter: blur(8px);
      align-items: center;
      justify-content: center;
      padding: 20px;
      animation: modalFadeIn 0.25s ease-out;
    }

    .modal-overlay.show {
      display: flex;
    }

    @keyframes modalFadeIn {
      from { opacity: 0; }
      to { opacity: 1; }
    }

    .modal-container {
      width: 100%;
      max-width: 720px;
      height: 85vh;
      height: 85dvh;
      background: rgba(var(--glass-water-rgb), 0.35);
      backdrop-filter: blur(22px) saturate(140%);
      -webkit-backdrop-filter: blur(22px) saturate(140%);
      border-radius: 20px;
      border: 1px solid rgba(255, 255, 255, 0.28);
      box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
      display: flex;
      flex-direction: column;
      overflow: hidden;
      animation: modalSlideUp 0.3s ease-out;
    }

    @keyframes modalSlideUp {
      from { opacity: 0; transform: translateY(40px) scale(0.97); }
      to { opacity: 1; transform: translateY(0) scale(1); }
    }

    .modal-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 16px 20px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.15);
      flex-shrink: 0;
    }

    .modal-title {
      font-size: 16px;
      font-weight: 600;
      color: white;
      text-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
    }

    .modal-close {
      width: 32px;
      height: 32px;
      min-width: 32px;
      border-radius: 50%;
      border: 1px solid rgba(255, 255, 255, 0.25);
      background: rgba(255, 255, 255, 0.15);
      color: white;
      font-size: 18px;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 0;
      margin: 0;
      transition: background 0.2s;
      box-shadow: none;
      backdrop-filter: none;
    }

    .modal-close:hover {
      background: rgba(255, 255, 255, 0.3);
      transform: none;
      box-shadow: none;
    }

    .modal-close::before { display: none; }

    .modal-body {
      flex: 1;
      overflow: hidden;
    }

    .modal-body iframe {
      width: 100%;
      height: 100%;
      border: none;
      background: transparent;
    }

    @media (max-width: 640px) {
      body {
        padding: 20px 16px;
        justify-content: center;
      }

      .brand-header { margin-bottom: 24px; }
      .brand-logo { font-size: 64px; }

      .brand-title {
        font-size: 42px;
        letter-spacing: -1px;
      }

      .brand-subtitle { font-size: 16px; }
      .register-container { padding: 32px 24px; }
      h2 { font-size: 28px; }
      input { font-size: 16px; }

      .modal-container {
        height: 90vh;
        height: 90dvh;
        border-radius: 16px;
      }

      .modal-overlay {
        padding: 10px;
      }
    }

    @media (min-width: 641px) and (max-width: 1024px) {
      .register-container { max-width: 420px; }
    }
  </style>
</head>

<body>
  <div class="brand-header">
    <a href="/" style="text-decoration: none;">

    <div class="brand-logo">🌳</div>
    <h1 class="brand-title">TreeOS</h1></a>
    <div class="brand-subtitle">Organize your life, efficiently</div>
  </div>

  <div class="register-container">
    <h2>Create Account</h2>
    <p class="subtitle">Sign up to get started with TreeOS</p>

    <form id="registerForm">
      <div class="input-group">
        <label for="username">Username</label>
        <input 
          type="text"
          id="username" 
          placeholder="Choose a username"
          required 
          autocomplete="username"
          autocapitalize="off"
          autocorrect="off"
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
          autocapitalize="off"
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

      <div class="agreement-text">
        By creating an account, you agree to our
        <span class="agreement-link" onclick="openModal('terms')">Terms of Service</span>
        and
        <span class="agreement-link" onclick="openModal('privacy')">Privacy Policy</span>.
      </div>

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

  <!-- Terms Modal -->
  <div class="modal-overlay" id="termsModal">
    <div class="modal-container">
      <div class="modal-header">
        <span class="modal-title">Terms of Service</span>
        <button class="modal-close" onclick="closeModal('terms')">✕</button>
      </div>
      <div class="modal-body">
        <iframe src="/terms" title="Terms of Service"></iframe>
      </div>
    </div>
  </div>

  <!-- Privacy Modal -->
  <div class="modal-overlay" id="privacyModal">
    <div class="modal-container">
      <div class="modal-header">
        <span class="modal-title">Privacy Policy</span>
        <button class="modal-close" onclick="closeModal('privacy')">✕</button>
      </div>
      <div class="modal-body">
        <iframe src="/privacy" title="Privacy Policy"></iframe>
      </div>
    </div>
  </div>

  <script>
    const apiUrl = "https://treeOS.ai";

    function openModal(type) {
      const id = type === 'terms' ? 'termsModal' : 'privacyModal';
      document.getElementById(id).classList.add('show');
      document.body.style.overflow = 'hidden';
    }

    function closeModal(type) {
      const id = type === 'terms' ? 'termsModal' : 'privacyModal';
      document.getElementById(id).classList.remove('show');
      document.body.style.overflow = '';
    }

    // Close modal on overlay click
    document.querySelectorAll('.modal-overlay').forEach(overlay => {
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) {
          overlay.classList.remove('show');
          document.body.style.overflow = '';
        }
      });
    });

    // Close modal on Escape key
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        document.querySelectorAll('.modal-overlay.show').forEach(m => {
          m.classList.remove('show');
        });
        document.body.style.overflow = '';
      }
    });

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

      errorEl.classList.remove("show");
      successEl.classList.remove("show");
      passwordInput.classList.remove("error");
      confirmPasswordInput.classList.remove("error");

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

        document.getElementById("registerForm").reset();
        successEl.classList.add("show");
        btn.classList.remove("loading");
        btn.disabled = false;

        setTimeout(() => {
          window.location.href = "/login";
        }, 7000);

      } catch (err) {
        console.error(err);
        errorEl.textContent = "An error occurred. Please try again.";
        errorEl.classList.add("show");
        btn.classList.remove("loading");
        btn.disabled = false;
      }
    });

    document.getElementById("confirmPassword").addEventListener("input", (e) => {
      const password = document.getElementById("password").value;
      const confirmPassword = e.target.value;
      if (confirmPassword && password !== confirmPassword) {
        e.target.classList.add("error");
      } else {
        e.target.classList.remove("error");
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
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, user-scalable=no" />
  <meta name="theme-color" content="#736fe6">
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
  <title>TreeOS - Reset Password</title>

  <style>
    :root {
      --glass-water-rgb: 115, 111, 230;
      --glass-alpha: 0.28;
      --glass-alpha-hover: 0.38;
    }

    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
      -webkit-tap-highlight-color: transparent;
    }

    html, body {
      background: #736fe6;
      margin: 0;
      padding: 0;
    }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen', 'Ubuntu', 'Cantarell', sans-serif;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      min-height: 100vh;
      min-height: 100dvh;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 20px;
      position: relative;
      overflow-x: hidden;
      overflow-y: auto;
      touch-action: manipulation;
    }

    body::before,
    body::after {
      content: '';
      position: fixed;
      border-radius: 50%;
      opacity: 0.08;
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
      0%, 100% { transform: translateY(0) rotate(0deg); }
      50% { transform: translateY(-30px) rotate(5deg); }
    }

    @keyframes fadeInDown {
      from { opacity: 0; transform: translateY(-30px); }
      to { opacity: 1; transform: translateY(0); }
    }

    @keyframes slideUp {
      from { opacity: 0; transform: translateY(30px); }
      to { opacity: 1; transform: translateY(0); }
    }

    @keyframes grow {
      0%, 100% { transform: scale(1); }
      50% { transform: scale(1.06); }
    }

    @keyframes spin {
      to { transform: rotate(360deg); }
    }

    .brand-header {
      position: relative;
      z-index: 1;
      margin-bottom: 32px;
      text-align: center;
      animation: fadeInDown 0.8s ease-out;
    }

    .brand-logo {
      font-size: 80px;
      margin-bottom: 16px;
      display: inline-block;
      filter: drop-shadow(0 8px 32px rgba(0, 0, 0, 0.2));
      animation: fadeInDown 0.5s ease-out both, grow 4.5s ease-in-out infinite;
    }

    .brand-title {
      font-size: 56px;
      font-weight: 600;
      color: white;
      text-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
      letter-spacing: -1.5px;
      margin-bottom: 8px;
    }

    .brand-subtitle {
      font-size: 18px;
      color: rgba(255, 255, 255, 0.85);
      font-weight: 400;
      letter-spacing: 0.2px;
    }

    .forgot-container {
      background: rgba(var(--glass-water-rgb), var(--glass-alpha));
      backdrop-filter: blur(22px) saturate(140%);
      -webkit-backdrop-filter: blur(22px) saturate(140%);
      padding: 48px;
      border-radius: 16px;
      width: 100%;
      max-width: 460px;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.12),
        inset 0 1px 0 rgba(255, 255, 255, 0.25);
      border: 1px solid rgba(255, 255, 255, 0.28);
      text-align: center;
      position: relative;
      z-index: 1;
      animation: slideUp 0.6s ease-out 0.2s both;
    }

    h2 {
      font-size: 32px;
      font-weight: 600;
      color: white;
      margin-bottom: 8px;
      text-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
      letter-spacing: -0.5px;
    }

    .subtitle {
      font-size: 15px;
      color: rgba(255, 255, 255, 0.85);
      margin-bottom: 32px;
      line-height: 1.5;
      font-weight: 400;
    }

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
      color: white;
      margin-bottom: 8px;
      text-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
      letter-spacing: -0.2px;
    }

    input {
      width: 100%;
      padding: 14px 18px;
      border-radius: 12px;
      border: 2px solid rgba(255, 255, 255, 0.3);
      font-size: 16px;
      transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
      background: rgba(255, 255, 255, 0.15);
      backdrop-filter: blur(20px) saturate(150%);
      -webkit-backdrop-filter: blur(20px) saturate(150%);
      font-family: inherit;
      color: white;
      font-weight: 500;
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.1),
        inset 0 1px 0 rgba(255, 255, 255, 0.25);
      touch-action: manipulation;
    }

    input:focus {
      outline: none;
      border-color: rgba(255, 255, 255, 0.6);
      background: rgba(255, 255, 255, 0.25);
      backdrop-filter: blur(25px) saturate(160%);
      -webkit-backdrop-filter: blur(25px) saturate(160%);
      box-shadow:
        0 0 0 4px rgba(255, 255, 255, 0.15),
        0 8px 30px rgba(0, 0, 0, 0.15),
        inset 0 1px 0 rgba(255, 255, 255, 0.4);
      transform: translateY(-2px);
    }

    input::placeholder {
      color: rgba(255, 255, 255, 0.5);
      font-weight: 400;
    }

    input.error {
      border-color: rgba(239, 68, 68, 0.6);
      background: rgba(239, 68, 68, 0.1);
    }

    input.error:focus {
      box-shadow:
        0 0 0 4px rgba(239, 68, 68, 0.2),
        0 8px 30px rgba(239, 68, 68, 0.2);
    }

    button {
      width: 100%;
      padding: 16px;
      margin-top: 8px;
      border-radius: 980px;
      border: 1px solid rgba(255, 255, 255, 0.3);
      background: rgba(255, 255, 255, 0.25);
      backdrop-filter: blur(10px);
      color: white;
      font-size: 16px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.3s;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.12);
      font-family: inherit;
      letter-spacing: -0.2px;
      position: relative;
      overflow: hidden;
      touch-action: manipulation;
    }

    button::before {
      content: "";
      position: absolute;
      inset: -40%;
      background: radial-gradient(
        120% 60% at 0% 0%,
        rgba(255, 255, 255, 0.35),
        transparent 60%
      );
      opacity: 0;
      transform: translateX(-30%) translateY(-10%);
      transition: opacity 0.35s ease, transform 0.6s cubic-bezier(0.22, 1, 0.36, 1);
      pointer-events: none;
    }

    button:hover::before {
      opacity: 1;
      transform: translateX(30%) translateY(10%);
    }

    button:hover {
      background: rgba(255, 255, 255, 0.35);
      transform: translateY(-2px);
      box-shadow: 0 6px 20px rgba(0, 0, 0, 0.18);
    }

    button:active { transform: translateY(0); }

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

    .message {
      margin-top: 16px;
      margin-bottom: 16px;
      padding: 12px 16px;
      border-radius: 10px;
      font-size: 14px;
      font-weight: 600;
      text-align: left;
      display: none;
    }

    .error-message {
      color: white;
      background: rgba(239, 68, 68, 0.3);
      backdrop-filter: blur(10px);
      border: 1px solid rgba(239, 68, 68, 0.4);
    }

    .success-message {
      color: white;
      background: rgba(16, 185, 129, 0.3);
      backdrop-filter: blur(10px);
      border: 1px solid rgba(16, 185, 129, 0.4);
    }

    .message.show { display: block; }

    .secondary-actions {
      display: flex;
      flex-direction: column;
      gap: 8px;
      margin-top: 24px;
      padding-top: 24px;
    }

    .back-btn {
      width: 100%;
      background: rgba(255, 255, 255, 0.15);
      color: white;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
      font-weight: 600;
      padding: 12px;
      font-size: 15px;
      margin-top: 0;
    }

    .back-btn:hover {
      background: rgba(255, 255, 255, 0.25);
    }

    @media (max-width: 640px) {
      body {
        padding: 20px 16px;
        justify-content: center;
      }

      .brand-header { margin-bottom: 24px; }
      .brand-logo { font-size: 64px; }

      .brand-title {
        font-size: 42px;
        letter-spacing: -1px;
      }

      .brand-subtitle { font-size: 16px; }
      .forgot-container { padding: 32px 24px; }
      h2 { font-size: 28px; }
      input { font-size: 16px; }
    }

    @media (min-width: 641px) and (max-width: 1024px) {
      .forgot-container { max-width: 420px; }
    }
  </style>
</head>

<body>
  <div class="brand-header">
    <a href="/" style="text-decoration: none;">
      <div class="brand-logo">🌳</div>
      <h1 class="brand-title">TreeOS</h1>
    </a>
    <div class="brand-subtitle">Organize your life, efficiently</div>
  </div>

  <div class="forgot-container">
    <h2>Reset Password</h2>
    <p class="subtitle">Enter your email address and we'll send you a link to reset your password.</p>

    <form id="forgotForm">
      <div class="input-group">
        <label for="email">Email Address</label>
        <input
          type="email"
          id="email"
          placeholder="Enter your email"
          required
          autocomplete="email"
          autocapitalize="off"
        />
      </div>

      <button type="submit" id="submitBtn">Send Reset Link</button>
    </form>

    <div id="errorMessage" class="message error-message"></div>
    <div id="successMessage" class="message success-message">
      ✓ If an account exists for that email, a password reset link has been sent. Check your inbox.
    </div>

    <div class="secondary-actions">
      <button class="back-btn" onclick="window.location.href='/login'">
        ← Back to Login
      </button>
    </div>
  </div>

  <script>
    const apiUrl = "https://treeOS.ai";
    const EMAIL_REGEX = /^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/;

    document.getElementById("forgotForm").addEventListener("submit", async (e) => {
      e.preventDefault();

      const email = document.getElementById("email").value.trim();
      const emailInput = document.getElementById("email");
      const btn = document.getElementById("submitBtn");
      const errorEl = document.getElementById("errorMessage");
      const successEl = document.getElementById("successMessage");

      errorEl.classList.remove("show");
      successEl.classList.remove("show");
      emailInput.classList.remove("error");

      if (!email) {
        errorEl.textContent = "Please enter your email address.";
        errorEl.classList.add("show");
        emailInput.classList.add("error");
        emailInput.focus();
        return;
      }

      if (!EMAIL_REGEX.test(email)) {
        errorEl.textContent = "Please enter a valid email address.";
        errorEl.classList.add("show");
        emailInput.classList.add("error");
        emailInput.focus();
        return;
      }

      if (email.length > 320) {
        errorEl.textContent = "Email address is too long.";
        errorEl.classList.add("show");
        emailInput.classList.add("error");
        emailInput.focus();
        return;
      }

      btn.classList.add("loading");
      btn.disabled = true;

      try {
        await fetch(\`\${apiUrl}/forgot-password\`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email })
        });

        document.getElementById("forgotForm").reset();
        successEl.classList.add("show");
        btn.classList.remove("loading");
        btn.disabled = false;

      } catch (err) {
        console.error(err);
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
