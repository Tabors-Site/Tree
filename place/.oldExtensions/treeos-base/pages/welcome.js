/**
 * Welcome Page ("/")
 *
 * Public landing for any visitor to this land.
 * Shows the land name, login/register if anonymous, dashboard link if logged in.
 */

export function renderWelcome({ landName, landUrl, isLoggedIn, isAdmin, username, extensionCount, userCount, treeCount }) {
  const esc = (s) => String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="theme-color" content="#0a0a0a">
  <title>${esc(landName)}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      background: #0a0a0a;
      color: #e5e5e5;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      -webkit-font-smoothing: antialiased;
    }

    .top-bar {
      position: fixed;
      top: 0;
      right: 0;
      padding: 20px 24px;
      display: flex;
      gap: 10px;
      z-index: 10;
    }

    .btn {
      padding: 10px 22px;
      border-radius: 8px;
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
      border: none;
      text-decoration: none;
      transition: all 0.2s;
    }
    .btn-primary {
      background: #fff;
      color: #0a0a0a;
    }
    .btn-primary:hover { background: #e5e5e5; }
    .btn-secondary {
      background: transparent;
      color: #e5e5e5;
      border: 1px solid rgba(255,255,255,0.15);
    }
    .btn-secondary:hover {
      border-color: rgba(255,255,255,0.3);
      background: rgba(255,255,255,0.05);
    }

    .hero {
      text-align: center;
      padding: 0 24px;
    }
    .hero h1 {
      font-size: 72px;
      font-weight: 800;
      letter-spacing: -2px;
      color: #fff;
      margin-bottom: 12px;
    }
    .hero p {
      font-size: 18px;
      color: rgba(255,255,255,0.4);
      max-width: 480px;
      margin: 0 auto 32px;
      line-height: 1.6;
    }
    .hero-links {
      display: flex;
      gap: 12px;
      justify-content: center;
      flex-wrap: wrap;
    }

    .stats {
      margin-top: 48px;
      display: flex;
      gap: 32px;
      justify-content: center;
    }
    .stat {
      text-align: center;
    }
    .stat-num {
      font-size: 24px;
      font-weight: 700;
      color: #fff;
    }
    .stat-label {
      font-size: 12px;
      color: rgba(255,255,255,0.3);
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-top: 4px;
    }

    .footer {
      position: fixed;
      bottom: 0;
      width: 100%;
      text-align: center;
      padding: 16px;
      font-size: 12px;
      color: rgba(255,255,255,0.15);
    }
    .footer a { color: inherit; text-decoration: none; }

    @media (max-width: 600px) {
      .hero h1 { font-size: 42px; }
      .stats { gap: 20px; }
    }
  </style>
</head>
<body>
  <div class="top-bar">
    ${isLoggedIn
      ? `<a class="btn btn-primary" href="/dashboard">Dashboard</a>
         ${isAdmin ? `<a class="btn btn-secondary" href="/land">Admin</a>` : ""}`
      : `<a class="btn btn-secondary" href="/login">Log In</a>
         <a class="btn btn-primary" href="/register">Register</a>`
    }
  </div>

  <div class="hero">
    <h1>${esc(landName)}</h1>
    <p>
      ${isLoggedIn
        ? `Welcome back, ${esc(username)}.`
        : `A TreeOS land. Log in or register to start growing trees.`
      }
    </p>
    <div class="hero-links">
      ${isLoggedIn
        ? `<a class="btn btn-primary" href="/dashboard">Go to Dashboard</a>`
        : `<a class="btn btn-primary" href="/register">Get Started</a>`
      }
    </div>
    <div class="stats">
      <div class="stat"><div class="stat-num">${extensionCount}</div><div class="stat-label">Extensions</div></div>
      <div class="stat"><div class="stat-num">${userCount}</div><div class="stat-label">Users</div></div>
      <div class="stat"><div class="stat-num">${treeCount}</div><div class="stat-label">Trees</div></div>
    </div>
  </div>

  <div class="footer">
    Powered by <a href="https://treeos.ai">The Seed</a>
  </div>
</body>
</html>`;
}
