export function notFoundPage(res, message = "This page doesn't exist or may have been moved.") {
  return res.status(404).send(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="theme-color" content="#667eea">
<title>Page Not Found - Tree</title>
<style>
* { box-sizing: border-box; margin: 0; padding: 0; }
html, body { height: 100%; }
body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 100vh;
  padding: 20px;
}
.card {
  background: rgba(255,255,255,0.12);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  border: 1px solid rgba(255,255,255,0.2);
  border-radius: 20px;
  padding: 48px 40px;
  max-width: 480px;
  width: 100%;
  text-align: center;
  box-shadow: 0 20px 60px rgba(0,0,0,0.2);
}
.icon { font-size: 48px; margin-bottom: 20px; }
h1 {
  font-size: 22px;
  font-weight: 700;
  margin-bottom: 12px;
  color: white;
}
p {
  font-size: 15px;
  line-height: 1.6;
  color: rgba(255,255,255,0.75);
  margin-bottom: 28px;
}
.btn {
  display: inline-block;
  padding: 12px 32px;
  border-radius: 980px;
  background: rgba(255,255,255,0.18);
  border: 1px solid rgba(255,255,255,0.25);
  color: white;
  font-size: 14px;
  font-weight: 600;
  text-decoration: none;
  transition: all 0.2s;
}
.btn:hover {
  background: rgba(255,255,255,0.28);
  transform: translateY(-1px);
}
.code {
  display: inline-block;
  margin-bottom: 12px;
  font-size: 13px;
  font-weight: 700;
  color: rgba(255,255,255,0.35);
  letter-spacing: 1px;
}
.ai-note {
  margin-top: 20px;
  padding: 12px 16px;
  background: rgba(239,68,68,0.2);
  border: 1px solid rgba(239,68,68,0.35);
  border-radius: 12px;
  font-size: 13px;
  line-height: 1.5;
  color: rgba(255,255,255,0.85);
}
</style>
</head>
<body>
<div class="card">
  <div class="code">404</div>
  <div class="icon">🌲</div>
  <h1>Page Not Found</h1>
  <p>${message}</p>
  <a href="/" class="btn" onclick="event.preventDefault(); window.top.location.href='/';">Back to Home</a>
  <div class="ai-note">If this was triggered by an AI automated process, wait a moment. You may be redirected shortly.</div>
</div>
</body>
</html>`);
}
