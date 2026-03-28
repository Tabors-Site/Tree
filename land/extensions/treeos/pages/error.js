/* ------------------------------------------------- */
/* Error page (layout-wrapped)                       */
/* ------------------------------------------------- */

import { page } from "../../html-rendering/html/layout.js";

export function errorHtml(status, title, message) {
  const css = `
/* ── Error page overrides on base ── */
html, body { height: 100%; }
body {
  color: white;
  display: flex;
  align-items: center;
  justify-content: center;
}

/* Hide base orbs for centered layout */
body::before, body::after { display: none; }
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
.code {
  display: inline-block;
  margin-bottom: 12px;
  font-size: 13px;
  font-weight: 700;
  color: #dc2626;
  letter-spacing: 1px;
  background: rgba(255,255,255,0.18);
  border-radius: 10px;
  padding: 6px 16px;
}
.icon { font-size: 48px; margin-bottom: 8px; }
.brand {
  font-size: 28px;
  font-weight: 700;
  color: white;
  margin-bottom: 20px;
  text-decoration: none;
  display: block;
}
.brand:hover { opacity: 0.9; }
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
@keyframes heroGrow {
  0%, 100% { transform: scale(1); }
  50% { transform: scale(1.06); }
}
.icon { animation: heroGrow 4.5s ease-in-out infinite; }`;

  const bodyHtml = `
<div class="card">
  <div class="code">${status}</div>
  <a href="/" class="brand" onclick="event.preventDefault(); window.top.location.href='/';">
    <div class="icon">\u{1F333}</div>
    Tree
  </a>
  <h1>${title}</h1>
  <p>${message}</p>
  <a href="/" class="btn" onclick="event.preventDefault(); window.top.location.href='/';">Back to Home</a>
  <div class="ai-note">If this was triggered by an AI automated process, wait a moment. You may be redirected shortly.</div>
</div>`;

  return page({
    title: `${title} - TreeOS`,
    css,
    body: bodyHtml,
  });
}
