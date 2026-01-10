// routes/app.js
import express from "express";

const router = express.Router();
import authenticateLite from "../middleware/authenticateLite.js";

/**
 * GET /app
 * Authenticated iframe shell
 */
router.get("/app", authenticateLite, async (req, res) => {
  try {
    if (!req.userId) {
      return res.status(401).send("Not authenticated");
    }

    return res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Tree App</title>

  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="theme-color" content="#667eea" />

  <style>
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    html, body {
      height: 100%;
      width: 100%;
      overflow: hidden;
      background: #000;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Oxygen', 'Ubuntu', 'Cantarell', sans-serif;
    }

    iframe {
      width: 100%;
      height: 100%;
      border: none;
      display: block;
      background: white;
    }

    /* Welcome Screen */
    .welcome-screen {
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 10;
      transition: opacity 0.5s ease-out;
    }

    .welcome-screen.hidden {
      opacity: 0;
      pointer-events: none;
    }

    /* Animated background */
    .welcome-screen::before,
    .welcome-screen::after {
      content: '';
      position: absolute;
      border-radius: 50%;
      opacity: 0.1;
      animation: float 20s infinite ease-in-out;
      pointer-events: none;
    }

    .welcome-screen::before {
      width: 600px;
      height: 600px;
      background: white;
      top: -300px;
      right: -200px;
      animation-delay: -5s;
    }

    .welcome-screen::after {
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

    .welcome-content {
      text-align: center;
      max-width: 600px;
      padding: 48px 32px;
      background: rgba(255, 255, 255, 0.98);
      backdrop-filter: blur(20px);
      border-radius: 24px;
      box-shadow: 0 20px 60px rgba(0, 0, 0, 0.2);
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

    .welcome-content::before {
      content: '';
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 6px;
      background: linear-gradient(90deg, #667eea 0%, #764ba2 100%);
      border-radius: 24px 24px 0 0;
    }

    .brand-logo {
      font-size: 80px;
      margin-bottom: 24px;
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

    .welcome-title {
      font-size: 36px;
      font-weight: 800;
      color: #1a1a1a;
      margin-bottom: 16px;
      letter-spacing: -0.5px;
    }

    .welcome-subtitle {
      font-size: 18px;
      color: #666;
      line-height: 1.6;
      margin-bottom: 32px;
    }

    .instructions {
      background: linear-gradient(135deg, rgba(102, 126, 234, 0.1) 0%, rgba(118, 75, 162, 0.1) 100%);
      padding: 24px;
      border-radius: 16px;
      border-left: 4px solid #667eea;
      text-align: left;
      margin-bottom: 24px;
    }

    .instructions-title {
      font-size: 16px;
      font-weight: 700;
      color: #667eea;
      margin-bottom: 16px;
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .instructions-title::before {
      content: '📝';
      font-size: 20px;
    }

    .instructions ol {
      padding-left: 24px;
      margin: 0;
    }

    .instructions li {
      font-size: 15px;
      color: #444;
      line-height: 1.8;
      margin-bottom: 12px;
    }

    .instructions li:last-child {
      margin-bottom: 0;
    }

    .instructions strong {
      color: #667eea;
      font-weight: 600;
    }

    .status-indicator {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 12px;
      padding: 16px 24px;
      background: #f8f9fa;
      border-radius: 12px;
      font-size: 14px;
      font-weight: 600;
      color: #888;
    }

    .status-dot {
      width: 12px;
      height: 12px;
      border-radius: 50%;
      background: #10b981;
      animation: pulse 2s ease-in-out infinite;
    }

    @keyframes pulse {
      0%, 100% {
        opacity: 1;
        transform: scale(1);
      }
      50% {
        opacity: 0.5;
        transform: scale(1.1);
      }
    }

    /* Loading state */
    .loading-indicator {
      position: absolute;
      bottom: 32px;
      left: 50%;
      transform: translateX(-50%);
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 12px 24px;
      background: rgba(255, 255, 255, 0.95);
      backdrop-filter: blur(10px);
      border-radius: 20px;
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.15);
      font-size: 14px;
      font-weight: 600;
      color: #667eea;
      z-index: 20;
      opacity: 0;
      transition: opacity 0.3s;
    }

    .loading-indicator.visible {
      opacity: 1;
    }

    .loading-spinner {
      width: 16px;
      height: 16px;
      border: 3px solid rgba(102, 126, 234, 0.2);
      border-top-color: #667eea;
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
    }

    @keyframes spin {
      to {
        transform: rotate(360deg);
      }
    }

    /* Responsive */
    @media (max-width: 640px) {
      .welcome-content {
        padding: 32px 24px;
        margin: 16px;
      }

      .brand-logo {
        font-size: 64px;
      }

      .welcome-title {
        font-size: 28px;
      }

      .welcome-subtitle {
        font-size: 16px;
      }

      .instructions {
        padding: 20px;
      }

      .instructions-title {
        font-size: 15px;
      }

      .instructions li {
        font-size: 14px;
      }
    }
  </style>
</head>
<body>
  <!-- Welcome Screen -->
  <div class="welcome-screen" id="welcomeScreen">
    <div class="welcome-content">
      <div class="brand-logo">🌳</div>
      <h1 class="welcome-title">Welcome to Tree</h1>
      <p class="welcome-subtitle">
        Your intelligent workspace is ready
      </p>

      <div class="instructions">
        <div class="instructions-title">Get Started</div>
        <ol>
          <li>Open <strong>ChatGPT</strong> in another tab</li>
          <li>Search for and activate the <strong>Tree app</strong></li>
          <li>Keep this window open</li>
          <li>Start chatting with your Tree through ChatGPT</li>
        </ol>
      </div>

      <div class="status-indicator">
        <div class="status-dot"></div>
        <span>Connected and waiting for commands...</span>
      </div>
    </div>
  </div>

  <!-- Loading Indicator -->
  <div class="loading-indicator" id="loadingIndicator">
    <div class="loading-spinner"></div>
    <span>Loading...</span>
  </div>

  <!-- Main Iframe -->
 <iframe
  id="viewport"
  sandbox="
    allow-same-origin
    allow-scripts
    allow-forms
    allow-popups
    allow-modals
    allow-downloads
    allow-top-navigation-by-user-activation
  "
></iframe>


  <script src="/socket.io/socket.io.js"></script>

  <script>
    const iframe = document.getElementById("viewport");
    const welcomeScreen = document.getElementById("welcomeScreen");
    const loadingIndicator = document.getElementById("loadingIndicator");
    let hasNavigated = false;

    const socket = io({
      transports: ["websocket"],
      withCredentials: true
    });

    socket.on("connect", () => {
      console.log("[app] socket connected:", socket.id);
      socket.emit("ready");
    });

    socket.on("navigate", ({ url, replace }) => {
      console.log("[app] navigate:", url);

      // Hide welcome screen on first navigation
      if (!hasNavigated) {
        hasNavigated = true;
        welcomeScreen.classList.add("hidden");
        loadingIndicator.classList.add("visible");
        
        // Hide loading indicator after iframe loads
        iframe.addEventListener("load", () => {
          loadingIndicator.classList.remove("visible");
        }, { once: true });
      }

      if (replace) {
        iframe.contentWindow?.location.replace(url);
      } else {
        iframe.src = url;
      }
    });

    socket.on("reload", () => {
      iframe.contentWindow?.location.reload();
    });
  </script>
  
</html>`);
  } catch (err) {
    console.error(err);
    res.status(500).send("Failed to load app");
  }
});

export default router;
