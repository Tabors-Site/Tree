// routesURL/chat.js
// Simple chat-only interface for tree conversations.
// No iframe, no tree view — just pick a tree and talk.

import express from "express";
import User from "../db/models/user.js";
import Node from "../db/models/node.js";
import authenticateLite from "../middleware/authenticateLite.js";

const router = express.Router();

function escapeHtml(str) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

router.get("/chat", authenticateLite, async (req, res) => {
  try {
    if (!req.userId) {
      return res.redirect("/login");
    }

    const user = await User.findById(req.userId).select("username roots");
    if (!user) {
      return res.status(404).send("User not found");
    }

    const { username } = user;

    // Load user's trees
    const rootIds = (user.roots || []).map(String);
    let trees = [];
    if (rootIds.length > 0) {
      trees = await Node.find({ _id: { $in: rootIds } })
        .select("_id name children")
        .lean();
    }

    const treesJSON = JSON.stringify(
      trees.map((t) => ({
        id: t._id,
        name: t.name,
        childCount: t.children?.length || 0,
      })),
    );

    return res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Tree Chat</title>
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
  <meta name="theme-color" content="#667eea" />
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=DM+Sans:opsz,wght@9..40,400;9..40,500;9..40,600&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
  <style>
    :root {
      --glass-rgb: 115, 111, 230;
      --glass-alpha: 0.28;
      --glass-blur: 22px;
      --glass-border: rgba(255, 255, 255, 0.28);
      --glass-border-light: rgba(255, 255, 255, 0.15);
      --glass-highlight: rgba(255, 255, 255, 0.25);
      --text-primary: #ffffff;
      --text-secondary: rgba(255, 255, 255, 0.9);
      --text-muted: rgba(255, 255, 255, 0.6);
      --accent: #10b981;
      --accent-glow: rgba(16, 185, 129, 0.6);
      --error: #ef4444;
      --header-height: 56px;
      --transition-fast: 150ms cubic-bezier(0.4, 0, 0.2, 1);
    }

    * { box-sizing: border-box; margin: 0; padding: 0; -webkit-tap-highlight-color: transparent; }
    html, body { height: 100%; width: 100%; overflow: hidden; font-family: 'DM Sans', -apple-system, sans-serif; color: var(--text-primary); background: #736fe6; }

    .app-bg { position: fixed; inset: 0; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); z-index: -2; }
    .app-bg::before, .app-bg::after { content: ''; position: fixed; border-radius: 50%; opacity: 0.08; animation: float 20s infinite ease-in-out; pointer-events: none; }
    .app-bg::before { width: 600px; height: 600px; top: -300px; right: -200px; animation-delay: -5s; }
    .app-bg::after { width: 400px; height: 400px; bottom: -200px; left: -100px; animation-delay: -10s; }
    @keyframes float { 0%, 100% { transform: translateY(0) rotate(0deg); } 50% { transform: translateY(-30px) rotate(5deg); } }

    /* Layout */
    .container {
      height: 100%; width: 100%;
      display: flex; flex-direction: column;
      max-width: 800px; margin: 0 auto;
    }

    /* Header */
    .chat-header {
      height: var(--header-height); padding: 0 20px;
      display: flex; align-items: center; justify-content: space-between;
      border-bottom: 1px solid var(--glass-border-light); flex-shrink: 0;
    }
    .chat-title { display: flex; align-items: center; gap: 12px; }
    .tree-icon { font-size: 28px; filter: drop-shadow(0 4px 12px rgba(0, 0, 0, 0.3)); animation: grow 4.5s infinite ease-in-out; }
    @keyframes grow { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.06); } }
    .chat-title h1 { font-size: 18px; font-weight: 600; letter-spacing: -0.02em; text-shadow: 0 2px 8px rgba(0, 0, 0, 0.2); }

    .header-right { display: flex; align-items: center; gap: 10px; }
    .back-btn {
      display: none; align-items: center; gap: 6px;
      font-size: 12px; color: var(--text-muted);
      background: rgba(255,255,255,0.1); border-radius: 8px;
      padding: 6px 12px; border: 1px solid var(--glass-border-light);
      cursor: pointer; transition: all var(--transition-fast);
      font-family: inherit;
    }
    .back-btn:hover { background: rgba(255,255,255,0.18); color: var(--text-primary); }
    .back-btn.visible { display: flex; }
    .back-btn svg { width: 12px; height: 12px; }

    .status-badge { display: flex; align-items: center; gap: 8px; padding: 6px 14px; background: rgba(255, 255, 255, 0.15); backdrop-filter: blur(10px); border-radius: 100px; border: 1px solid var(--glass-border-light); font-size: 12px; font-weight: 600; }
    .status-dot { width: 8px; height: 8px; border-radius: 50%; box-shadow: 0 0 12px var(--accent-glow); animation: pulse 2s ease-in-out infinite; flex-shrink: 0; }
    .status-dot.connected { background: var(--accent); }
    .status-dot.disconnected { background: var(--error); animation: none; }
    .status-dot.connecting { background: #f59e0b; }
    @keyframes pulse { 0%, 100% { opacity: 1; transform: scale(1); } 50% { opacity: 0.7; transform: scale(1.15); } }

    .advanced-btn {
      font-size: 12px; color: var(--text-muted);
      background: rgba(255,255,255,0.1); border-radius: 8px;
      padding: 6px 14px; border: 1px solid var(--glass-border-light);
      cursor: pointer; text-decoration: none; transition: all var(--transition-fast);
      font-family: inherit;
    }
    .advanced-btn:hover { background: rgba(255,255,255,0.18); color: var(--text-primary); }

    /* Root name inline */
    .root-name-inline {
      font-size: 13px; font-weight: 400; color: var(--text-muted);
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      max-width: 200px; opacity: 0; transition: opacity 0.3s ease;
    }
    .root-name-inline.visible { opacity: 1; }
    .root-name-inline::before { content: ' / '; color: var(--glass-border-light); }

    /* Tree picker */
    .tree-picker {
      flex: 1; display: flex; flex-direction: column;
      align-items: center; justify-content: center;
      padding: 40px 20px; gap: 24px;
    }
    .tree-picker-title { font-size: 24px; font-weight: 600; margin-bottom: 4px; }
    .tree-picker-sub { color: var(--text-muted); font-size: 15px; text-align: center; }
    .tree-list { display: flex; flex-direction: column; gap: 8px; width: 100%; max-width: 420px; }
    .tree-item {
      background: rgba(var(--glass-rgb), var(--glass-alpha));
      backdrop-filter: blur(var(--glass-blur)) saturate(140%);
      -webkit-backdrop-filter: blur(var(--glass-blur)) saturate(140%);
      border: 1px solid var(--glass-border-light);
      border-radius: 16px; padding: 18px 22px;
      cursor: pointer; transition: all var(--transition-fast);
      display: flex; align-items: center; justify-content: space-between;
      animation: fadeInUp 0.3s ease-out backwards;
    }
    .tree-item:hover { background: rgba(var(--glass-rgb), 0.42); transform: translateY(-2px); box-shadow: 0 8px 32px rgba(0,0,0,0.15); }
    .tree-item:active { transform: translateY(0) scale(0.98); }
    .tree-item-left { display: flex; align-items: center; gap: 14px; }
    .tree-item-icon { font-size: 22px; }
    .tree-item-name { font-size: 15px; font-weight: 500; }
    .tree-item-meta { font-size: 12px; color: var(--text-muted); }
    @keyframes fadeInUp { from { opacity: 0; transform: translateY(16px); } }
    ${trees.map((_, i) => `.tree-item:nth-child(${i + 1}) { animation-delay: ${i * 0.06}s; }`).join("\n    ")}

    .empty-state {
      background: rgba(var(--glass-rgb), var(--glass-alpha));
      backdrop-filter: blur(var(--glass-blur)) saturate(140%);
      border: 1px solid var(--glass-border-light);
      border-radius: 20px; padding: 48px 32px;
      text-align: center; max-width: 400px;
    }
    .empty-state .empty-icon { font-size: 48px; margin-bottom: 16px; display: block; filter: drop-shadow(0 8px 32px rgba(0, 0, 0, 0.3)); }
    .empty-state h2 { font-size: 20px; margin-bottom: 8px; }
    .empty-state p { color: var(--text-muted); font-size: 14px; margin-bottom: 20px; line-height: 1.5; }
    /* Create tree form */
    .create-tree-form {
      display: flex; gap: 8px; width: 100%; max-width: 420px; margin-top: 8px;
    }
    .create-tree-form input {
      flex: 1; padding: 14px 18px; font-size: 15px;
      background: rgba(var(--glass-rgb), 0.25);
      border: 1px solid var(--glass-border-light);
      border-radius: 14px; color: var(--text-primary);
      transition: all 0.2s; outline: none;
    }
    .create-tree-form input::placeholder { color: var(--text-muted); }
    .create-tree-form input:focus {
      border-color: var(--accent); background: rgba(var(--glass-rgb), 0.35);
      box-shadow: 0 0 0 3px rgba(16, 185, 129, 0.15);
    }
    .create-tree-form button {
      padding: 14px 18px; font-size: 20px; line-height: 1;
      background: rgba(var(--glass-rgb), 0.3);
      border: 1px solid var(--glass-border-light);
      border-radius: 14px; color: var(--text-primary);
      cursor: pointer; transition: all 0.2s;
    }
    .create-tree-form button:hover {
      background: var(--accent); border-color: var(--accent);
      box-shadow: 0 4px 15px var(--accent-glow);
    }
    .create-tree-form button:disabled { opacity: 0.4; cursor: not-allowed; }

    /* Chat area */
    .chat-area { flex: 1; display: none; flex-direction: column; overflow: hidden; }
    .chat-area.active { display: flex; }

    /* Messages — matches app.js */
    .chat-messages { flex: 1; overflow-y: auto; overflow-x: hidden; padding: 24px 20px; display: flex; flex-direction: column; gap: 16px; }
    .chat-messages::-webkit-scrollbar { width: 6px; }
    .chat-messages::-webkit-scrollbar-track { background: transparent; }
    .chat-messages::-webkit-scrollbar-thumb { background: rgba(255, 255, 255, 0.2); border-radius: 3px; }

    .message { display: flex; gap: 12px; animation: messageIn 0.3s ease-out; min-width: 0; max-width: 100%; }
    @keyframes messageIn { from { opacity: 0; transform: translateY(10px); } }
    .message.user { flex-direction: row-reverse; }
    .message-avatar { width: 36px; height: 36px; border-radius: 12px; background: rgba(255, 255, 255, 0.15); backdrop-filter: blur(10px); border: 1px solid var(--glass-border-light); display: flex; align-items: center; justify-content: center; font-size: 16px; flex-shrink: 0; }
    .message.user .message-avatar { background: linear-gradient(135deg, rgba(99, 102, 241, 0.6) 0%, rgba(139, 92, 246, 0.6) 100%); }
    .message-content { max-width: 85%; min-width: 0; padding: 14px 18px; background: rgba(255, 255, 255, 0.15); backdrop-filter: blur(10px); border: 1px solid var(--glass-border-light); border-radius: 18px; font-size: 14px; line-height: 1.6; word-wrap: break-word; overflow-wrap: break-word; word-break: break-word; }
    .message.user .message-content { background: linear-gradient(135deg, rgba(99, 102, 241, 0.5) 0%, rgba(139, 92, 246, 0.5) 100%); border-radius: 18px 18px 6px 18px; }
    .message.assistant .message-content { border-radius: 18px 18px 18px 6px; }
    .message.error .message-content { background: rgba(239, 68, 68, 0.3); border-color: rgba(239, 68, 68, 0.5); }

    /* Message content formatting — matches app.js */
    .message-content p { margin: 0 0 10px 0; word-break: break-word; }
    .message-content p:last-child { margin-bottom: 0; }
    .message-content h1, .message-content h2, .message-content h3, .message-content h4 { margin: 14px 0 8px 0; font-weight: 600; line-height: 1.3; }
    .message-content h1:first-child, .message-content h2:first-child, .message-content h3:first-child, .message-content h4:first-child { margin-top: 0; }
    .message-content h1 { font-size: 17px; }
    .message-content h2 { font-size: 16px; }
    .message-content h3 { font-size: 15px; }
    .message-content h4 { font-size: 14px; color: var(--text-secondary); }
    .message-content ul, .message-content ol { margin: 8px 0; padding-left: 0; list-style: none; }
    .message-content li { margin: 4px 0; padding: 6px 10px; background: rgba(255, 255, 255, 0.06); border-radius: 8px; line-height: 1.4; word-break: break-word; }
    .message-content li .list-num { color: var(--accent); font-weight: 600; margin-right: 6px; }
    .message-content strong, .message-content b { font-weight: 600; color: #fff; }
    .message-content em, .message-content i { font-style: italic; color: var(--text-secondary); }
    .message-content code { background: rgba(0, 0, 0, 0.3); padding: 2px 6px; border-radius: 4px; font-family: 'JetBrains Mono', monospace; font-size: 11px; word-break: break-all; }
    .message-content pre { background: rgba(0, 0, 0, 0.3); padding: 12px; border-radius: 8px; overflow-x: auto; margin: 10px 0; max-width: 100%; }
    .message-content pre code { background: none; padding: 0; word-break: normal; white-space: pre-wrap; }
    .message-content blockquote { border-left: 3px solid var(--accent); padding-left: 12px; margin: 10px 0; color: var(--text-secondary); font-style: italic; }
    .message-content hr { border: none; border-top: 1px solid var(--glass-border-light); margin: 14px 0; }
    .message-content a { color: var(--accent); text-decoration: underline; text-underline-offset: 2px; }
    .message-content a:hover { text-decoration: none; }

    /* Menu items */
    .message-content .menu-item { display: flex; align-items: flex-start; gap: 10px; padding: 10px 12px; margin: 6px 0; background: rgba(255, 255, 255, 0.08); border-radius: 10px; border: 1px solid rgba(255, 255, 255, 0.06); transition: all 0.15s ease; }
    .message-content .menu-item.clickable { cursor: pointer; user-select: none; }
    .message-content .menu-item.clickable:hover { background: rgba(255, 255, 255, 0.15); border-color: rgba(16, 185, 129, 0.3); transform: translateX(4px); }
    .message-content .menu-item.clickable:active { transform: translateX(4px) scale(0.98); background: rgba(16, 185, 129, 0.2); }
    .message-content .menu-item:first-of-type { margin-top: 8px; }
    .message-content .menu-number { display: flex; align-items: center; justify-content: center; min-width: 26px; max-width: 26px; height: 26px; background: linear-gradient(135deg, var(--accent) 0%, #059669 100%); border-radius: 8px; font-size: 12px; font-weight: 600; flex-shrink: 0; box-shadow: 0 2px 8px rgba(16, 185, 129, 0.3); transition: all 0.15s ease; }
    .message-content .menu-item.clickable:hover .menu-number { transform: scale(1.1); box-shadow: 0 4px 12px rgba(16, 185, 129, 0.5); }
    .message-content .menu-text { flex: 1; min-width: 0; padding-top: 2px; word-break: break-word; overflow-wrap: break-word; }
    .message-content .menu-text strong { display: block; margin-bottom: 2px; word-break: break-word; }

    /* Typing indicator — matches app.js */
    .typing-indicator { display: flex; gap: 4px; padding: 14px 18px; }
    .typing-dot { width: 8px; height: 8px; background: rgba(255, 255, 255, 0.6); border-radius: 50%; animation: typing 1.4s infinite; }
    .typing-dot:nth-child(2) { animation-delay: 0.2s; }
    .typing-dot:nth-child(3) { animation-delay: 0.4s; }
    @keyframes typing { 0%, 60%, 100% { transform: translateY(0); } 30% { transform: translateY(-8px); } }

    /* Input — matches app.js */
    .chat-input-area { padding: 16px 20px 20px; border-top: 1px solid var(--glass-border-light); }
    .input-container { display: flex; align-items: flex-end; gap: 12px; padding: 14px 18px; background: rgba(255, 255, 255, 0.15); backdrop-filter: blur(10px); border: 1px solid var(--glass-border-light); border-radius: 18px; transition: all var(--transition-fast); }
    .input-container:focus-within { background: rgba(255, 255, 255, 0.2); border-color: rgba(255, 255, 255, 0.4); box-shadow: 0 0 0 4px rgba(255, 255, 255, 0.1); }
    .chat-input { flex: 1; min-width: 0; background: transparent; border: none; outline: none; font-family: inherit; font-size: 15px; color: var(--text-primary); resize: none; max-height: 120px; line-height: 1.5; }
    .chat-input::placeholder { color: var(--text-muted); }
    .send-btn { width: 40px; height: 40px; display: flex; align-items: center; justify-content: center; background: var(--accent); border: none; border-radius: 12px; color: white; cursor: pointer; transition: all var(--transition-fast); flex-shrink: 0; box-shadow: 0 4px 15px var(--accent-glow); }
    .send-btn:hover:not(:disabled) { transform: scale(1.08); box-shadow: 0 6px 25px var(--accent-glow); }
    .send-btn:disabled { opacity: 0.4; cursor: not-allowed; }
    .send-btn svg { width: 20px; height: 20px; }
    .send-btn.stop-mode { background: rgba(239, 68, 68, 0.7); box-shadow: 0 4px 15px rgba(239, 68, 68, 0.4); }
    .send-btn.stop-mode:hover:not(:disabled) { background: rgba(239, 68, 68, 0.9); box-shadow: 0 6px 25px rgba(239, 68, 68, 0.5); }

    /* Welcome message */
    .welcome-message { text-align: center; padding: 40px 20px; }
    .welcome-icon { font-size: 64px; margin-bottom: 20px; display: inline-block; filter: drop-shadow(0 8px 32px rgba(0, 0, 0, 0.3)); animation: floatIcon 3s ease-in-out infinite; }
    @keyframes floatIcon { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-10px); } }
    .welcome-message h2 { font-size: 24px; font-weight: 600; margin-bottom: 12px; }
    .welcome-message p { font-size: 15px; color: var(--text-secondary); line-height: 1.6; }

    @media (max-width: 600px) {
      .container { max-width: 100%; }
      .chat-input-area { padding: 12px 16px 16px; }
      .advanced-btn { padding: 6px 10px; font-size: 11px; }
    }
  </style>
</head>
<body>
  <div class="app-bg"></div>
  <div class="container">
    <div class="chat-header">
      <div class="chat-title">
        <a href="/" style="text-decoration:none;display:flex;align-items:center;gap:12px;color:inherit;">
        <span class="tree-icon">🌳</span>
        <h1>Tree</h1>
        </a>
        <span class="root-name-inline" id="rootName"></span>
      </div>
      <div class="header-right">
        <button class="back-btn" id="backBtn" onclick="backToTrees()">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
          Trees
        </button>
        <div class="status-badge">
          <div class="status-dot connecting" id="statusDot"></div>
          <span id="statusText">Connecting</span>
        </div>
        <a href="/app" class="advanced-btn">Advanced</a>
      </div>
    </div>

    <div class="tree-picker" id="treePicker">
      ${
        trees.length === 0
          ? `<div class="empty-state">
              <span class="empty-icon">🌱</span>
              <h2>Plant your first tree</h2>
              <p>A tree starts with a single root — a topic that everything else grows from. It can be broad like <strong>My Life</strong>, focused like <strong>Workout Plan</strong>, or anything in between.</p>
              <p style="margin-top:8px;">Name it, and you can start chatting with it right away.</p>
              <form class="create-tree-form" style="margin-top:16px;" onsubmit="createTree(event)">
                <input type="text" id="newTreeNameEmpty" placeholder="e.g. My Life, Recipe Ideas, Project X..." autocomplete="off" />
                <button type="submit" title="Create tree">+</button>
              </form>
            </div>`
          : `<h2 class="tree-picker-title">Your Trees</h2>
            <p class="tree-picker-sub">Pick a tree to start chatting</p>
            <div class="tree-list" id="treeList">
              ${trees
                .map(
                  (t) => `
                <div class="tree-item" onclick="selectTree('${t._id}', '${escapeHtml(t.name)}')">
                  <span class="tree-item-icon">🌳</span>
                  <span class="tree-item-name">${escapeHtml(t.name)}</span>
                </div>`,
                )
                .join("")}
            </div>`
      }
      ${trees.length > 0 ? `
      <form class="create-tree-form" id="createTreeForm" onsubmit="createTree(event)">
        <input type="text" id="newTreeName" placeholder="New tree name..." autocomplete="off" />
        <button type="submit" title="Create tree">+</button>
      </form>` : ""}
    </div>

    <div class="chat-area" id="chatArea">
      <div class="chat-messages" id="messages">
        <div class="welcome-message" id="welcomeMsg">
          <div class="welcome-icon">🌳</div>
          <h2>Start chatting</h2>
          <p>Ask anything about your tree or tell it something new.</p>
        </div>
      </div>
      <div class="chat-input-area">
        <div class="input-container">
          <textarea class="chat-input" id="chatInput" placeholder="Say something..." rows="1"></textarea>
          <button class="send-btn" id="sendBtn" disabled>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/></svg>
          </button>
        </div>
      </div>
    </div>
  </div>

  <script src="/socket.io/socket.io.js"></script>
  <script>
    const CONFIG = {
      username: "${escapeHtml(username)}",
      userId: "${req.userId}",
      trees: ${treesJSON},
    };

    // State
    let activeRootId = null;
    let isConnected = false;
    let isRegistered = false;
    let isSending = false;
    let requestGeneration = 0;

    // Elements
    const statusDot = document.getElementById("statusDot");
    const statusText = document.getElementById("statusText");
    const treePicker = document.getElementById("treePicker");
    const chatArea = document.getElementById("chatArea");
    const chatMessages = document.getElementById("messages");
    const chatInput = document.getElementById("chatInput");
    const sendBtn = document.getElementById("sendBtn");
    const backBtn = document.getElementById("backBtn");
    const rootName = document.getElementById("rootName");

    function escapeHtml(s) {
      const d = document.createElement("div");
      d.textContent = s;
      return d.innerHTML;
    }

    // ── Markdown formatting — matches app.js ──────────────────────────
    function formatMessageContent(text) {
      if (!text) return '';
      let html = text;

      html = html.replace(/&nbsp;/g, ' ');
      html = html.replace(/&amp;/g, '&');
      html = html.replace(/&lt;/g, '<');
      html = html.replace(/&gt;/g, '>');
      html = html.replace(/\\u00A0/g, ' ');

      html = html.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

      // Code blocks
      html = html.replace(/\`\`\`([\\s\\S]*?)\`\`\`/g, '<pre><code>$1</code></pre>');
      html = html.replace(/\`([^\`]+)\`/g, '<code>$1</code>');

      // Bold / italic
      html = html.replace(/\\*\\*(.+?)\\*\\*/g, '<strong>$1</strong>');
      html = html.replace(/__(.+?)__/g, '<strong>$1</strong>');
      html = html.replace(/(?<![\\w\\*])\\*([^\\*]+)\\*(?![\\w\\*])/g, '<em>$1</em>');

      // Headings
      html = html.replace(/^####\\s*(.+)$/gm, '<h4>$1</h4>');
      html = html.replace(/^###\\s*(.+)$/gm, '<h3>$1</h3>');
      html = html.replace(/^##\\s*(.+)$/gm, '<h2>$1</h2>');
      html = html.replace(/^#\\s*(.+)$/gm, '<h1>$1</h1>');

      // HR
      html = html.replace(/^-{3,}$/gm, '<hr>');
      html = html.replace(/^\\*{3,}$/gm, '<hr>');

      // Blockquote
      html = html.replace(/^&gt;\\s*(.+)$/gm, '<blockquote>$1</blockquote>');

      // Numbered menu items with bold title
      html = html.replace(/^([1-9]|1[0-9]|20)\\.\\s*<strong>(.+?)<\\/strong>(.*)$/gm, function(m, num, title, rest) {
        return '<div class="menu-item clickable" data-action="' + num + '" data-name="' + title.replace(/"/g, '&quot;') + '">' +
          '<span class="menu-number">' + num + '</span>' +
          '<span class="menu-text"><strong>' + title + '</strong>' + rest + '</span></div>';
      });

      // Bullet items with bold title
      html = html.replace(/^[-\\u2013\\u2022]\\s*<strong>(.+?)<\\/strong>(.*)$/gm,
        '<div class="menu-item"><span class="menu-number">\\u2022</span><span class="menu-text"><strong>$1</strong>$2</span></div>');

      // Plain bullet items
      html = html.replace(/^[-\\u2013\\u2022]\\s+([^<].*)$/gm, '<li>$1</li>');

      // Numbered list items
      html = html.replace(/^(\\d+)\\.\\s+([^<*].*)$/gm, '<li><span class="list-num">$1.</span> $2</li>');

      // Wrap consecutive li in ul
      let inList = false;
      const lines = html.split('\\n');
      const processed = [];
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const isListItem = line.trim().startsWith('<li>');
        if (isListItem && !inList) { processed.push('<ul>'); inList = true; }
        else if (!isListItem && inList) { processed.push('</ul>'); inList = false; }
        processed.push(line);
      }
      if (inList) processed.push('</ul>');
      html = processed.join('\\n');

      // Links
      html = html.replace(/\\[([^\\]]+)\\]\\(([^)]+)\\)/g, '<a href="$2" target="_blank">$1</a>');

      // Paragraphs
      const blocks = html.split(/\\n\\n+/);
      html = blocks.map(function(block) {
        const trimmed = block.trim();
        if (!trimmed) return '';
        if (trimmed.match(/^<(h[1-4]|ul|ol|pre|blockquote|hr|div|table)/)) return trimmed;
        const withBreaks = trimmed.split('\\n').map(function(l) { return l.trim(); }).filter(function(l) { return l; }).join('<br>');
        return '<p>' + withBreaks + '</p>';
      }).filter(function(b) { return b; }).join('');

      // Clean up
      html = html.replace(/<p><\\/p>/g, '');
      html = html.replace(/<p>(<div|<ul|<ol|<h[1-4]|<hr|<pre|<blockquote)/g, '$1');
      html = html.replace(/(<\\/div>|<\\/ul>|<\\/ol>|<\\/h[1-4]>|<\\/pre>|<\\/blockquote>)<\\/p>/g, '$1');
      html = html.replace(/<br>(<div|<\\/div>)/g, '$1');
      html = html.replace(/(<div[^>]*>)<br>/g, '$1');

      return html;
    }

    // ── Socket ────────────────────────────────────────────────────────
    const socket = io({ transports: ["websocket", "polling"], withCredentials: true });

    socket.on("connect", () => {
      isConnected = true;
      statusDot.className = "status-dot connecting";
      statusText.textContent = "Connecting";
      socket.emit("ready");
      socket.emit("register", { username: CONFIG.username });
    });

    socket.on("registered", ({ success }) => {
      if (success) {
        isRegistered = true;
        statusDot.className = "status-dot connected";
        statusText.textContent = "Connected";
        updateSendBtn();
      }
    });

    socket.on("chatResponse", ({ answer, generation }) => {
      if (generation !== undefined && generation < requestGeneration) return;
      removeTyping();
      addMessage(answer, "assistant");
      isSending = false;
      updateSendBtn();
    });

    socket.on("chatError", ({ error, generation }) => {
      if (generation !== undefined && generation < requestGeneration) return;
      removeTyping();
      addMessage("Error: " + error, "error");
      isSending = false;
      updateSendBtn();
    });

    socket.on("chatCancelled", () => {
      if (isSending) {
        removeTyping();
        isSending = false;
        updateSendBtn();
      }
    });

    socket.on("disconnect", () => {
      isConnected = false;
      isRegistered = false;
      statusDot.className = "status-dot disconnected";
      statusText.textContent = "Disconnected";
      updateSendBtn();
    });

    // Ignore navigate events — no iframe
    socket.on("navigate", () => {});

    // ── Create tree ─────────────────────────────────────────────────
    async function createTree(e) {
      e.preventDefault();
      const input = e.target.querySelector("input[type=text]");
      const name = input.value.trim();
      if (!name) return;

      const btn = e.target.querySelector("button");
      btn.disabled = true;

      try {
        const res = await fetch("/api/v1/user/" + CONFIG.userId + "/createRoot", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ name }),
        });
        const data = await res.json();
        if (!data.success) throw new Error(data.error || "Failed");

        // Add to tree list (create it if empty state)
        let treeList = document.getElementById("treeList");
        if (!treeList) {
          // Was empty state — rebuild picker content
          const emptyState = treePicker.querySelector(".empty-state");
          if (emptyState) emptyState.remove();

          const title = document.createElement("h2");
          title.className = "tree-picker-title";
          title.textContent = "Your Trees";

          const sub = document.createElement("p");
          sub.className = "tree-picker-sub";
          sub.textContent = "Pick a tree to start chatting";

          treeList = document.createElement("div");
          treeList.className = "tree-list";
          treeList.id = "treeList";

          const form = document.getElementById("createTreeForm");
          treePicker.insertBefore(treeList, form);
          treePicker.insertBefore(sub, treeList);
          treePicker.insertBefore(title, sub);
        }

        const item = document.createElement("div");
        item.className = "tree-item";
        item.onclick = () => selectTree(data.rootId, name);
        item.innerHTML = \`
          <span class="tree-item-icon">🌳</span>
          <span class="tree-item-name">\${escapeHtml(name)}</span>\`;
        item.style.animation = "fadeInUp 0.3s ease-out";
        treeList.appendChild(item);

        input.value = "";
      } catch (err) {
        console.error("Create tree error:", err);
        alert("Failed to create tree: " + err.message);
      } finally {
        btn.disabled = false;
      }
    }

    // ── Tree selection ────────────────────────────────────────────────
    function selectTree(rootId, name) {
      activeRootId = rootId;
      treePicker.style.display = "none";
      chatArea.classList.add("active");
      rootName.textContent = name;
      rootName.classList.add("visible");
      backBtn.classList.add("visible");

      // Reset chat
      const welcome = chatMessages.querySelector(".welcome-message");
      if (welcome) welcome.style.display = "";
      chatMessages.querySelectorAll(".message, .typing-indicator").forEach(el => el.remove());

      // Tell server about this root
      socket.emit("setActiveRoot", { rootId });
      socket.emit("urlChanged", { url: "/api/v1/root/" + rootId, rootId });

      chatInput.focus();
      updateSendBtn();
    }

    function backToTrees() {
      activeRootId = null;
      treePicker.style.display = "";
      chatArea.classList.remove("active");
      rootName.classList.remove("visible");
      backBtn.classList.remove("visible");
      isSending = false;
      updateSendBtn();
      socket.emit("clearConversation");
    }

    // ── Messages ──────────────────────────────────────────────────────
    function addMessage(content, role) {
      const welcome = chatMessages.querySelector(".welcome-message");
      if (welcome) welcome.remove();

      const msg = document.createElement("div");
      msg.className = "message " + role;

      const formattedContent = role === "assistant" ? formatMessageContent(content) : escapeHtml(content);

      msg.innerHTML =
        '<div class="message-avatar">' + (role === "user" ? "\\ud83d\\udc64" : "\\ud83c\\udf33") + '</div>' +
        '<div class="message-content">' + formattedContent + '</div>';

      // Clickable menu items
      if (role === "assistant") {
        msg.querySelectorAll(".menu-item.clickable").forEach(function(item) {
          item.addEventListener("click", function() {
            const name = item.dataset.name;
            if (name && !isSending) {
              chatInput.value = name;
              sendMessage();
            }
          });
        });
      }

      chatMessages.appendChild(msg);
      chatMessages.scrollTop = chatMessages.scrollHeight;
    }

    function addTyping() {
      removeTyping();
      const msg = document.createElement("div");
      msg.className = "message assistant";
      msg.id = "typingIndicator";
      msg.innerHTML =
        '<div class="message-avatar">\\ud83c\\udf33</div>' +
        '<div class="message-content typing-indicator"><div class="typing-dot"></div><div class="typing-dot"></div><div class="typing-dot"></div></div>';
      chatMessages.appendChild(msg);
      chatMessages.scrollTop = chatMessages.scrollHeight;
    }

    function removeTyping() {
      const el = document.getElementById("typingIndicator");
      if (el) el.remove();
    }

    // ── Send ──────────────────────────────────────────────────────────
    function sendMessage() {
      const text = chatInput.value.trim();
      if (!text || !isRegistered || !activeRootId) return;

      if (isSending) {
        socket.emit("cancelRequest");
        removeTyping();
        isSending = false;
        updateSendBtn();
        return;
      }

      chatInput.value = "";
      chatInput.style.height = "auto";
      addMessage(text, "user");
      addTyping();
      isSending = true;
      requestGeneration++;
      updateSendBtn();
      socket.emit("chat", { message: text, username: CONFIG.username, generation: requestGeneration });
    }

    function updateSendBtn() {
      const hasText = chatInput.value.trim().length > 0;
      if (isSending) {
        sendBtn.classList.add("stop-mode");
        sendBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>';
        sendBtn.disabled = false;
      } else {
        sendBtn.classList.remove("stop-mode");
        sendBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/></svg>';
        sendBtn.disabled = !(hasText && isRegistered && activeRootId);
      }
    }

    // ── Input handlers ────────────────────────────────────────────────
    chatInput.addEventListener("input", () => {
      chatInput.style.height = "auto";
      chatInput.style.height = Math.min(chatInput.scrollHeight, 120) + "px";
      updateSendBtn();
    });

    chatInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
      }
    });

    sendBtn.addEventListener("click", sendMessage);
  </script>
</body>
</html>`);
  } catch (err) {
    console.error("Error rendering /chat:", err);
    return res.status(500).send("Internal server error");
  }
});

export default router;
