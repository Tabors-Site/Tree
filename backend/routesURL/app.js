// routes/app.js
import express from "express";
import User from "../db/models/user.js";
import authenticateLite from "../middleware/authenticateLite.js";

const router = express.Router();

/**
 * GET /app
 * Authenticated iframe shell with integrated chat
 */
router.get("/app", authenticateLite, async (req, res) => {
  try {
    if (!req.userId) {
      return res.status(401).send("Not authenticated");
    }

    const user = await User.findById(req.userId).select(
      "htmlShareToken username roots",
    );

    if (!user) {
      return res.status(404).send("User not found");
    }

    const { htmlShareToken, username } = user;

    return res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Tree - App</title>
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
      --mobile-input-height: 70px;
      --min-panel-width: 280px;
    }

    * { box-sizing: border-box; margin: 0; padding: 0; -webkit-tap-highlight-color: transparent; }
    html, body { height: 100%; width: 100%; overflow: hidden; font-family: 'DM Sans', -apple-system, sans-serif; color: var(--text-primary); background: #736fe6; }

    .app-bg { position: fixed; inset: 0; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); z-index: -2; }
    .app-bg::before, .app-bg::after { content: ''; position: fixed; border-radius: 50%; opacity: 0.08; animation: float 20s infinite ease-in-out; pointer-events: none; }
    .app-bg::before { width: 600px; height: 600px; top: -300px; right: -200px; animation-delay: -5s; }
    .app-bg::after { width: 400px; height: 400px; bottom: -200px; left: -100px; animation-delay: -10s; }
    @keyframes float { 0%, 100% { transform: translateY(0) rotate(0deg); } 50% { transform: translateY(-30px) rotate(5deg); } }

    .app-container { display: flex; height: 100%; width: 100%; padding: 0px; gap: 0px; }
.glass-panel {
  background: rgba(var(--glass-rgb), var(--glass-alpha));
  backdrop-filter: blur(var(--glass-blur)) saturate(140%);
  -webkit-backdrop-filter: blur(var(--glass-blur)) saturate(140%);
  border-radius: 0;
  border: none;
  box-shadow: none;
}
    .glass-panel::before { content: ""; position: absolute; inset: -40%; background: radial-gradient(120% 60% at 0% 0%, rgba(255, 255, 255, 0.2), transparent 60%); pointer-events: none; z-index: 0; }

    .chat-panel { width: 400px; min-width: 0; height: 100%; display: flex; flex-direction: column; z-index: 10; flex-shrink: 0; }
    .chat-header { height: var(--header-height); padding: 0 20px; display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid var(--glass-border-light); flex-shrink: 0; position: relative; z-index: 1; }
    .chat-header a { text-decoration: none; color: inherit; }
    .chat-title { display: flex; align-items: center; gap: 12px; }
    .tree-icon { font-size: 28px; filter: drop-shadow(0 4px 12px rgba(0, 0, 0, 0.3)); animation: grow 4.5s infinite ease-in-out; }
    @keyframes grow { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.06); } }
    .chat-title h1 { font-size: 18px; font-weight: 600; letter-spacing: -0.02em; text-shadow: 0 2px 8px rgba(0, 0, 0, 0.2); }

    .status-badge { display: flex; align-items: center; gap: 8px; padding: 6px 14px; background: rgba(255, 255, 255, 0.15); backdrop-filter: blur(10px); border-radius: 100px; border: 1px solid var(--glass-border-light); font-size: 12px; font-weight: 600; }
    .status-dot { width: 8px; height: 8px; border-radius: 50%; box-shadow: 0 0 12px var(--accent-glow); animation: pulse 2s ease-in-out infinite; }
    .status-dot.connected { background: var(--accent); }
    .status-dot.disconnected { background: var(--error); animation: none; }
    .status-dot.connecting { background: #f59e0b; }
    @keyframes pulse { 0%, 100% { opacity: 1; transform: scale(1); } 50% { opacity: 0.7; transform: scale(1.15); } }

    /* Clear chat button in header */
    .clear-chat-btn {
      width: 30px;
      height: 30px;
      display: flex;
      align-items: center;
      justify-content: center;
      background: rgba(255, 255, 255, 0.1);
      border: 1px solid var(--glass-border-light);
      border-radius: 8px;
      color: var(--text-muted);
      cursor: pointer;
      transition: all var(--transition-fast);
      margin-left: 8px;
      flex-shrink: 0;
    }
    .clear-chat-btn:hover {
      background: rgba(255, 255, 255, 0.2);
      color: var(--text-primary);
    }
    .clear-chat-btn:active {
      transform: scale(0.93);
    }
    .clear-chat-btn svg { width: 14px; height: 14px; }

    /* Active root name - inline after Tree in header */
    .root-name-inline {
      font-size: 13px;
      font-weight: 400;
      color: var(--text-muted);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      flex: 1;
      min-width: 0;
      opacity: 0;
      cursor: default;
      transition: opacity 0.3s ease;
    }
    .root-name-inline.visible {
      opacity: 1;
    }
    .root-name-inline::before {
      content: ' / ';
      color: var(--glass-border-light);
    }
    .root-name-inline.fade-in {
      animation: rootNameFade 0.5s ease;
    }
    @keyframes rootNameFade {
      0% { opacity: 0; transform: translateY(-4px); }
      100% { opacity: 1; transform: translateY(0); }
    }

    .chat-messages { flex: 1; overflow-y: auto; overflow-x: hidden; padding: 24px 20px; display: flex; flex-direction: column; gap: 16px; position: relative; z-index: 1; }
    .chat-messages::-webkit-scrollbar { width: 6px; }
    .chat-messages::-webkit-scrollbar-track { background: transparent; }
    .chat-messages::-webkit-scrollbar-thumb { background: rgba(255, 255, 255, 0.2); border-radius: 3px; }

    .welcome-message { text-align: center; padding: 40px 20px; }
    .welcome-icon { font-size: 64px; margin-bottom: 20px; display: inline-block; filter: drop-shadow(0 8px 32px rgba(0, 0, 0, 0.3)); animation: floatIcon 3s ease-in-out infinite; }
    @keyframes floatIcon { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-10px); } }
    .welcome-message h2 { font-size: 24px; font-weight: 600; margin-bottom: 12px; }
    .welcome-message p { font-size: 15px; color: var(--text-secondary); line-height: 1.6; margin-bottom: 8px; }

    .message { display: flex; gap: 12px; animation: messageIn 0.3s ease-out; min-width: 0; max-width: 100%; }
    @keyframes messageIn { from { opacity: 0; transform: translateY(10px); } }
    .message.user { flex-direction: row-reverse; }
    .message-avatar { width: 36px; height: 36px; border-radius: 12px; background: rgba(255, 255, 255, 0.15); backdrop-filter: blur(10px); border: 1px solid var(--glass-border-light); display: flex; align-items: center; justify-content: center; font-size: 16px; flex-shrink: 0; }
    .message.user .message-avatar { background: linear-gradient(135deg, rgba(99, 102, 241, 0.6) 0%, rgba(139, 92, 246, 0.6) 100%); }
    .message-content { max-width: 85%; min-width: 0; padding: 14px 18px; background: rgba(255, 255, 255, 0.15); backdrop-filter: blur(10px); border: 1px solid var(--glass-border-light); border-radius: 18px; font-size: 14px; line-height: 1.6; word-wrap: break-word; overflow-wrap: break-word; word-break: break-word; }
    .message.user .message-content { background: linear-gradient(135deg, rgba(99, 102, 241, 0.5) 0%, rgba(139, 92, 246, 0.5) 100%); border-radius: 18px 18px 6px 18px; }
    .message.assistant .message-content { border-radius: 18px 18px 18px 6px; }
    .message.error .message-content { background: rgba(239, 68, 68, 0.3); border-color: rgba(239, 68, 68, 0.5); }

    /* Carried messages from previous mode - dimmed */
    .message.carried { opacity: 0.4; pointer-events: none; }
    .message.carried .message-content { border-style: dashed; }

    /* Mode bar locked while AI is responding */
    .mode-bar.locked .mode-current {
      opacity: 0.4;
      pointer-events: none;
      cursor: not-allowed;
    }
    .mobile-mode-btn.locked {
      opacity: 0.4;
      pointer-events: none;
    }

    /* Send button in stop mode */
    .send-btn.stop-mode {
      background: rgba(239, 68, 68, 0.7);
      box-shadow: 0 4px 15px rgba(239, 68, 68, 0.4);
    }
    .send-btn.stop-mode:hover:not(:disabled) {
      background: rgba(239, 68, 68, 0.9);
      box-shadow: 0 6px 25px rgba(239, 68, 68, 0.5);
    }

    /* Message content formatting */
    .message-content p { margin: 0 0 10px 0; word-break: break-word; }
    .message-content p:last-child { margin-bottom: 0; }
    .message-content h1, .message-content h2, .message-content h3, .message-content h4 {
      margin: 14px 0 8px 0;
      font-weight: 600;
      line-height: 1.3;
    }
    .message-content h1:first-child, .message-content h2:first-child, 
    .message-content h3:first-child, .message-content h4:first-child { margin-top: 0; }
    .message-content h1 { font-size: 17px; }
    .message-content h2 { font-size: 16px; }
    .message-content h3 { font-size: 15px; }
    .message-content h4 { font-size: 14px; color: var(--text-secondary); }
    .message-content ul, .message-content ol {
      margin: 8px 0;
      padding-left: 0;
      list-style: none;
    }
    .message-content li {
      margin: 4px 0;
      padding: 6px 10px;
      background: rgba(255, 255, 255, 0.06);
      border-radius: 8px;
      line-height: 1.4;
      word-break: break-word;
    }
    .message-content li .list-num {
      color: var(--accent);
      font-weight: 600;
      margin-right: 6px;
    }
    .message-content strong, .message-content b {
      font-weight: 600;
      color: #fff;
    }
    .message-content em, .message-content i {
      font-style: italic;
      color: var(--text-secondary);
    }
    .message-content code {
      background: rgba(0, 0, 0, 0.3);
      padding: 2px 6px;
      border-radius: 4px;
      font-family: 'JetBrains Mono', monospace;
      font-size: 11px;
      word-break: break-all;
    }
    .message-content pre {
      background: rgba(0, 0, 0, 0.3);
      padding: 12px;
      border-radius: 8px;
      overflow-x: auto;
      margin: 10px 0;
      max-width: 100%;
    }
    .message-content pre code {
      background: none;
      padding: 0;
      word-break: normal;
      white-space: pre-wrap;
    }
    .message-content blockquote {
      border-left: 3px solid var(--accent);
      padding-left: 12px;
      margin: 10px 0;
      color: var(--text-secondary);
      font-style: italic;
    }
    .message-content hr {
      border: none;
      border-top: 1px solid var(--glass-border-light);
      margin: 14px 0;
    }
    .message-content a {
      color: var(--accent);
      text-decoration: underline;
      text-underline-offset: 2px;
    }
    .message-content a:hover {
      text-decoration: none;
    }

    /* Menu items - numbered/bulleted options */
    .message-content .menu-item {
      display: flex;
      align-items: flex-start;
      gap: 10px;
      padding: 10px 12px;
      margin: 6px 0;
      background: rgba(255, 255, 255, 0.08);
      border-radius: 10px;
      border: 1px solid rgba(255, 255, 255, 0.06);
      transition: all 0.15s ease;
    }
    .message-content .menu-item.clickable {
      cursor: pointer;
      user-select: none;
    }
    .message-content .menu-item.clickable:hover {
      background: rgba(255, 255, 255, 0.15);
      border-color: rgba(16, 185, 129, 0.3);
      transform: translateX(4px);
    }
    .message-content .menu-item.clickable:active {
      transform: translateX(4px) scale(0.98);
      background: rgba(16, 185, 129, 0.2);
    }
    .message-content .menu-item:first-of-type {
      margin-top: 8px;
    }
    .message-content .menu-number {
      display: flex;
      align-items: center;
      justify-content: center;
      min-width: 26px;
      max-width: 26px;
      height: 26px;
      background: linear-gradient(135deg, var(--accent) 0%, #059669 100%);
      border-radius: 8px;
      font-size: 12px;
      font-weight: 600;
      flex-shrink: 0;
      box-shadow: 0 2px 8px rgba(16, 185, 129, 0.3);
      transition: all 0.15s ease;
    }
    .message-content .menu-item.clickable:hover .menu-number {
      transform: scale(1.1);
      box-shadow: 0 4px 12px rgba(16, 185, 129, 0.5);
    }
    .message-content .menu-text {
      flex: 1;
      min-width: 0;
      padding-top: 2px;
      word-break: break-word;
      overflow-wrap: break-word;
    }
    .message-content .menu-text strong {
      display: block;
      margin-bottom: 2px;
      word-break: break-word;
    }
    .message-content .menu-item.clicking {
      animation: menuClick 0.3s ease;
    }
    @keyframes menuClick {
      0% { background: rgba(16, 185, 129, 0.3); }
      100% { background: rgba(255, 255, 255, 0.08); }
    }

    .typing-indicator { display: flex; gap: 4px; padding: 14px 18px; }
    .typing-dot { width: 8px; height: 8px; background: rgba(255, 255, 255, 0.6); border-radius: 50%; animation: typing 1.4s infinite; }
    .typing-dot:nth-child(2) { animation-delay: 0.2s; }
    .typing-dot:nth-child(3) { animation-delay: 0.4s; }
    @keyframes typing { 0%, 60%, 100% { transform: translateY(0); } 30% { transform: translateY(-8px); } }

    .chat-input-area { padding: 16px 20px 20px; border-top: 1px solid var(--glass-border-light); position: relative; z-index: 1; }
    .input-container { display: flex; align-items: flex-end; gap: 12px; padding: 14px 18px; background: rgba(255, 255, 255, 0.15); backdrop-filter: blur(10px); border: 1px solid var(--glass-border-light); border-radius: 18px; transition: all var(--transition-fast); }
    .input-container:focus-within { background: rgba(255, 255, 255, 0.2); border-color: rgba(255, 255, 255, 0.4); box-shadow: 0 0 0 4px rgba(255, 255, 255, 0.1); }
    .chat-input { flex: 1; min-width: 0; background: transparent; border: none; outline: none; font-family: inherit; font-size: 15px; color: var(--text-primary); resize: none; max-height: 120px; line-height: 1.5; }
    .chat-input::placeholder { color: var(--text-muted); }
    .send-btn { width: 40px; height: 40px; display: flex; align-items: center; justify-content: center; background: var(--accent); border: none; border-radius: 12px; color: white; cursor: pointer; transition: all var(--transition-fast); flex-shrink: 0; box-shadow: 0 4px 15px var(--accent-glow); }
    .send-btn:hover:not(:disabled) { transform: scale(1.08); box-shadow: 0 6px 25px var(--accent-glow); }
    .send-btn:disabled { opacity: 0.4; cursor: not-allowed; }
    .send-btn svg { width: 20px; height: 20px; }

    .viewport-panel { flex: 1; height: 100%; display: flex; flex-direction: column; min-width: 0; }
    .viewport-header { height: var(--header-height); padding: 0 20px; display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid var(--glass-border-light); flex-shrink: 0; position: relative; z-index: 1; }
    .viewport-info { display: flex; align-items: center; gap: 12px; overflow: hidden; flex: 1; min-width: 0; }
    .url-display { display: flex; align-items: center; gap: 10px; padding: 8px 14px; background: rgba(255, 255, 255, 0.1); border: 1px solid var(--glass-border-light); border-radius: 10px; font-family: 'JetBrains Mono', monospace; font-size: 12px; color: var(--text-secondary); max-width: 100%; overflow: hidden; }
    .url-display svg { width: 14px; height: 14px; color: var(--text-muted); flex-shrink: 0; }
    .url-text { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .panel-controls { display: flex; gap: 8px; }
    .panel-btn { width: 36px; height: 36px; display: flex; align-items: center; justify-content: center; background: rgba(255, 255, 255, 0.1); border: 1px solid var(--glass-border-light); border-radius: 10px; color: var(--text-secondary); cursor: pointer; transition: all var(--transition-fast); }
    .panel-btn:hover { background: rgba(255, 255, 255, 0.2); color: var(--text-primary); transform: scale(1.05); }
    .panel-btn svg { width: 18px; height: 18px; }

    .iframe-container {
  flex: 1;
  position: relative;
  overflow: hidden;
  border-radius: 0;
  margin: 0;
}

iframe {
  width: 100%;
  height: 100%;
  border: none;
  display: block;
  background: transparent;
  border-radius: 0;
}

    .loading-overlay { position: absolute; inset: 0; background: rgba(var(--glass-rgb), 0.8); backdrop-filter: blur(10px); display: flex; align-items: center; justify-content: center; opacity: 0; pointer-events: none; transition: opacity var(--transition-fast); z-index: 5; border-radius: 0 0 24px 24px; }
    .loading-overlay.visible { opacity: 1; pointer-events: auto; }
    .spinner-ring { width: 44px; height: 44px; border: 3px solid rgba(255, 255, 255, 0.2); border-top-color: white; border-radius: 50%; animation: spin 0.8s linear infinite; }
    @keyframes spin { to { transform: rotate(360deg); } }
    .loading-text { font-size: 14px; font-weight: 500; color: var(--text-secondary); margin-top: 16px; }

    .panel-divider { width: 16px; height: 100%; display: flex; align-items: center; justify-content: center; cursor: col-resize; position: relative; z-index: 20; flex-shrink: 0; }
    .divider-handle { width: 6px; height: 80px; background: rgba(var(--glass-rgb), 0.5); backdrop-filter: blur(var(--glass-blur)); border: 1px solid var(--glass-border); border-radius: 4px; transition: all var(--transition-fast); }
    .panel-divider:hover .divider-handle { background: rgba(var(--glass-rgb), 0.7); width: 8px; }
.chat-header,
.chat-input-area,
.viewport-header {
  border-bottom: none;
  border-top: none;
}
    .expand-buttons { position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); display: flex; flex-direction: column; gap: 8px; opacity: 0; pointer-events: none; transition: opacity var(--transition-fast); }
    .panel-divider:hover .expand-buttons { opacity: 1; pointer-events: auto; }
    .panel-divider:hover .divider-handle { opacity: 0; }
    .expand-btn { width: 32px; height: 32px; display: flex; align-items: center; justify-content: center; background: rgba(var(--glass-rgb), 0.8); backdrop-filter: blur(var(--glass-blur)); border: 1px solid var(--glass-border); border-radius: 8px; color: var(--text-secondary); cursor: pointer; transition: all var(--transition-fast); }
    .expand-btn:hover { background: rgba(255, 255, 255, 0.25); color: var(--text-primary); transform: scale(1.1); }
    .expand-btn svg { width: 16px; height: 16px; }

    /* Mobile */
    .mobile-input-bar {
      display: none;
      position: fixed;
      bottom: 0;
      left: 0;
      right: 0;
      z-index: 150;
      padding: 10px 12px;
      padding-bottom: calc(10px + env(safe-area-inset-bottom, 0px));
      background: transparent;
      transition: opacity 0.3s ease;
    }
    .mobile-input-bar .input-container {
      padding: 12px 16px;
      border-radius: 24px;
      background: rgba(255, 255, 255, 0.15);
      backdrop-filter: blur(10px);
      -webkit-backdrop-filter: blur(10px);
      border: 1px solid var(--glass-border-light);
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
    }
    .mobile-input-bar .chat-input { font-size: 16px; }
    .mobile-input-bar .send-btn { width: 38px; height: 38px; border-radius: 50%; }

    .mobile-chat-sheet {
      display: none;
      position: fixed;
      bottom: 0;
      left: 0;
      right: 0;
      height: 85vh;
      max-height: calc(100vh - 40px);
      z-index: 200;
      background: rgba(var(--glass-rgb), 0.75);
      backdrop-filter: blur(var(--glass-blur)) saturate(140%);
      -webkit-backdrop-filter: blur(var(--glass-blur)) saturate(140%);
      border-top-left-radius: 24px;
      border-top-right-radius: 24px;
      border: 1px solid var(--glass-border);
      border-bottom: none;
      box-shadow: 0 -20px 60px rgba(0, 0, 0, 0.25), inset 0 1px 0 var(--glass-highlight);
      transform: translateY(100%);
      flex-direction: column;
      will-change: transform;
    }
    .mobile-chat-sheet.open { 
      transform: translateY(0); 
      transition: transform 0.4s cubic-bezier(0.32, 0.72, 0, 1);
    }
    .mobile-chat-sheet.closing {
      transform: translateY(100%);
      transition: transform 0.3s cubic-bezier(0.4, 0, 1, 1);
    }
    .mobile-chat-sheet.dragging { 
      transition: none !important; 
    }

    .mobile-sheet-header {
      padding: 12px 16px;
      display: flex;
      flex-direction: column;
      align-items: center;
      border-bottom: 1px solid var(--glass-border-light);
      flex-shrink: 0;
      cursor: grab;
      touch-action: none;
      background: rgba(255, 255, 255, 0.05);
      user-select: none;
    }
    .mobile-sheet-header:active { cursor: grabbing; }
    .mobile-sheet-header .drag-handle { 
      width: 40px; 
      height: 5px; 
      background: rgba(255, 255, 255, 0.4); 
      border-radius: 3px; 
      margin-bottom: 12px;
    }
    .mobile-sheet-title-row { width: 100%; display: flex; align-items: center; justify-content: space-between; }
    .mobile-sheet-title { display: flex; align-items: center; gap: 10px; min-width: 0; overflow: hidden; }
    .mobile-sheet-title .tree-icon { font-size: 24px; }
    .mobile-sheet-title h1 { font-size: 17px; font-weight: 600; }
    .mobile-close-btn { 
      width: 32px; 
      height: 32px; 
      display: flex; 
      align-items: center; 
      justify-content: center; 
      background: rgba(255, 255, 255, 0.1); 
      border: 1px solid var(--glass-border-light); 
      border-radius: 50%; 
      color: var(--text-secondary); 
      cursor: pointer;
      transition: all 0.15s ease;
    }
    .mobile-close-btn:active {
      background: rgba(255, 255, 255, 0.2);
      transform: scale(0.95);
    }
    .mobile-close-btn svg { width: 16px; height: 16px; }

    .mobile-chat-messages {
      flex: 1;
      overflow-y: auto;
      padding: 16px;
      display: flex;
      flex-direction: column;
      gap: 12px;
      background: transparent;
      -webkit-overflow-scrolling: touch;
    }

    .mobile-chat-input-area {
      padding: 12px 16px;
      padding-bottom: calc(16px + env(safe-area-inset-bottom, 0px));
      border-top: 1px solid var(--glass-border-light);
      flex-shrink: 0;
      background: rgba(255, 255, 255, 0.05);
    }
    .mobile-chat-input-area .input-container { 
      padding: 12px 16px; 
      border-radius: 24px;
      background: rgba(255, 255, 255, 0.15);
      backdrop-filter: blur(10px);
      border: 1px solid var(--glass-border-light);
    }
    .mobile-chat-input-area .input-container:focus-within {
      background: rgba(255, 255, 255, 0.2);
      border-color: rgba(255, 255, 255, 0.4);
      box-shadow: 0 0 0 4px rgba(255, 255, 255, 0.1);
    }
    .mobile-chat-input-area .chat-input { font-size: 16px; }

    .mobile-backdrop {
      display: none;
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.3);
      z-index: 190;
      opacity: 0;
      transition: opacity 0.3s ease;
      pointer-events: none;
    }
    .mobile-backdrop.visible { opacity: 1; pointer-events: auto; }

    @media (max-width: 768px) {
      .app-container { padding: 0; gap: 0; flex-direction: column; }
      .chat-panel { display: none !important; }
      .viewport-panel { width: 100% !important; height: 100%; }
      .viewport-panel.glass-panel { border-radius: 0; }
      .viewport-header { display: none; }
      .iframe-container { border-radius: 0; margin: 0; flex: 1; }
      iframe, .loading-overlay { border-radius: 0; }
      .panel-divider { display: none; }
      .mobile-input-bar, .mobile-chat-sheet, .mobile-backdrop { display: block; }
      .mobile-chat-sheet { display: flex; }
      
      .message-content {
        max-width: 90%;
        padding: 12px 14px;
        font-size: 14px;
      }
      .message-content .menu-item {
        padding: 8px 10px;
        gap: 8px;
      }
      .message-content .menu-number {
        min-width: 24px;
        max-width: 24px;
        height: 24px;
        font-size: 11px;
      }
      .message-content .menu-text {
        font-size: 13px;
      }
      .message-content code {
        font-size: 10px;
      }
      .message-content pre {
        padding: 10px;
        font-size: 11px;
      }
    }

    .app-container.dragging { user-select: none; cursor: col-resize; }
    .app-container.dragging iframe { pointer-events: none; }
    .chat-panel.collapsed, .viewport-panel.collapsed { width: 0 !important; min-width: 0 !important; opacity: 0; pointer-events: none; padding: 0; border: none; overflow: hidden; }
    .chat-panel, .viewport-panel { transition: width 0.4s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.4s cubic-bezier(0.4, 0, 0.2, 1); }
    .app-container.dragging .chat-panel, .app-container.dragging .viewport-panel { transition: none; }

    /* ================================================================
       NEW: Mode bar styles
       ================================================================ */
    .mode-bar {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 6px 12px;
      border-top: 1px solid var(--glass-border-light);
      flex-shrink: 0;
      position: relative;
      z-index: 12;
      min-height: 40px;
    }

    .mode-current {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 5px 12px 5px 8px;
      background: rgba(255, 255, 255, 0.15);
      backdrop-filter: blur(10px);
      border: 1px solid var(--glass-border-light);
      border-radius: 10px;
      cursor: pointer;
      user-select: none;
      transition: all var(--transition-fast);
      font-size: 13px;
      font-weight: 600;
      color: var(--text-primary);
    }
    .mode-current:hover {
      background: rgba(255, 255, 255, 0.22);
      border-color: rgba(255, 255, 255, 0.3);
    }
    .mode-current:active {
      transform: scale(0.97);
    }
    .mode-current-emoji {
      font-size: 16px;
      line-height: 1;
    }
    .mode-current-label {
      white-space: nowrap;
    }
    .mode-current-chevron {
      width: 12px;
      height: 12px;
      color: var(--text-muted);
      transition: transform var(--transition-fast);
      flex-shrink: 0;
    }
    .mode-bar.open .mode-current-chevron {
      transform: rotate(180deg);
    }

    .mode-dropdown {
      display: none;
      position: absolute;
      bottom: calc(100% + 4px);
      left: 12px;
      min-width: 180px;
      background: rgba(var(--glass-rgb), 0.85);
      backdrop-filter: blur(var(--glass-blur)) saturate(140%);
      -webkit-backdrop-filter: blur(var(--glass-blur)) saturate(140%);
      border: 1px solid var(--glass-border);
      border-radius: 14px;
      padding: 6px;
      z-index: 100;
      box-shadow: 0 -8px 40px rgba(0, 0, 0, 0.3), inset 0 1px 0 var(--glass-highlight);
      animation: dropdownIn 0.15s ease-out;
    }
    @keyframes dropdownIn {
      from { opacity: 0; transform: translateY(6px); }
      to { opacity: 1; transform: translateY(0); }
    }
    .mode-bar.open .mode-dropdown {
      display: block;
    }

    .mode-option {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 8px 12px;
      border-radius: 10px;
      cursor: pointer;
      transition: all var(--transition-fast);
      font-size: 13px;
      font-weight: 500;
      color: var(--text-secondary);
      border: none;
      background: none;
      width: 100%;
      text-align: left;
    }
    .mode-option:hover {
      background: rgba(255, 255, 255, 0.15);
      color: var(--text-primary);
    }
    .mode-option:active {
      background: rgba(255, 255, 255, 0.2);
      transform: scale(0.97);
    }
    .mode-option.active {
      background: rgba(16, 185, 129, 0.2);
      color: var(--text-primary);
      font-weight: 600;
      border: 1px solid rgba(16, 185, 129, 0.3);
    }
    .mode-option-emoji {
      font-size: 16px;
      width: 22px;
      text-align: center;
      flex-shrink: 0;
    }

    /* Mode alert toast */
    .mode-alert {
      position: fixed;
      top: 72px;
      left: 16px;
      z-index: 9999;
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 10px 18px;
      background: rgba(var(--glass-rgb), 0.85);
      backdrop-filter: blur(var(--glass-blur));
      -webkit-backdrop-filter: blur(var(--glass-blur));
      border: 1px solid var(--glass-border);
      border-radius: 12px;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
      font-size: 14px;
      font-weight: 600;
      color: var(--text-primary);
      pointer-events: none;
      opacity: 0;
      transform: translateY(-10px);
      transition: opacity 0.25s ease, transform 0.25s ease;
    }
    .mode-alert.visible {
      opacity: 1;
      transform: translateY(0);
    }
    .mode-alert-emoji {
      font-size: 18px;
    }

    /* Mobile mode bar (inside sheet header) */
    .mobile-mode-bar {
      display: flex;
      gap: 4px;
      margin-top: 10px;
      width: 100%;
      overflow-x: auto;
      -webkit-overflow-scrolling: touch;
      scrollbar-width: none;
      padding-bottom: 2px;
    }
    .mobile-mode-bar::-webkit-scrollbar { display: none; }

    .mobile-mode-btn {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 6px 12px;
      background: rgba(255, 255, 255, 0.1);
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 20px;
      font-size: 12px;
      font-weight: 600;
      color: var(--text-secondary);
      cursor: pointer;
      white-space: nowrap;
      flex-shrink: 0;
      transition: all var(--transition-fast);
    }
    .mobile-mode-btn:active {
      transform: scale(0.95);
    }
    .mobile-mode-btn.active {
      background: rgba(16, 185, 129, 0.25);
      border-color: rgba(16, 185, 129, 0.4);
      color: var(--text-primary);
    }
    .mobile-mode-btn-emoji {
      font-size: 14px;
    }

    @media (max-width: 768px) {
      .mode-alert {
        top: 10px;
        left: 50%;
        transform: translateX(-50%) translateY(-10px);
      }
      .mode-alert.visible {
        transform: translateX(-50%) translateY(0);
      }
    }
    /* END: Mode bar styles */
  </style>
</head>
<body>
  <div class="app-bg"></div>

  <!-- NEW: Mode alert toast -->
  <div class="mode-alert" id="modeAlert">
    <span class="mode-alert-emoji" id="modeAlertEmoji"></span>
    <span id="modeAlertText"></span>
  </div>

  <div class="app-container">
    <!-- Chat Panel -->
    <div class="chat-panel glass-panel" id="chatPanel">
     <div class="chat-header">
  <a href="/" class="tree-home-link">
    <div class="chat-title">
      <span class="tree-icon">🌳</span>
      <h1>Tree</h1>
    </div>
  </a>
  <span class="root-name-inline" id="rootNameLabel" title=""></span>

  <div style="display:flex;align-items:center;gap:0;margin-left:auto;">
    <div class="status-badge">
      <span class="status-dot connecting" id="statusDot"></span>
      <span id="statusText">Connecting...</span>
    </div>
    <button class="clear-chat-btn" id="clearChatBtn" title="Clear conversation">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
    </button>
  </div>
</div>

      <div class="chat-messages" id="chatMessages">
        <div class="welcome-message">
          <div class="welcome-icon">🌳</div>
          <h2>Welcome to Tree</h2>
          <p>Your intelligent workspace is ready</p>
        </div>
      </div>

      <!-- NEW: Desktop mode bar (above input) -->
      <div class="mode-bar" id="modeBar">
        <div class="mode-current" id="modeCurrent">
          <span class="mode-current-emoji" id="modeCurrentEmoji">🏠</span>
          <span class="mode-current-label" id="modeCurrentLabel">Home</span>
          <svg class="mode-current-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M6 15l6-6 6 6"/></svg>
        </div>
        <div class="mode-dropdown" id="modeDropdown"></div>
      </div>

      <div class="chat-input-area">
        <div class="input-container">
          <textarea class="chat-input" id="chatInput" placeholder="Message Tree..." rows="1"></textarea>
          <button class="send-btn" id="sendBtn" disabled>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z"/>
            </svg>
          </button>
        </div>
      </div>
    </div>

    <!-- Divider -->
    <div class="panel-divider" id="panelDivider">
      <div class="divider-handle"></div>
      <div class="expand-buttons">
        <button class="expand-btn" id="expandChatBtn" title="Expand chat">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 19l-7-7 7-7"/><path d="M19 19l-7-7 7-7"/></svg>
        </button>
        <button class="expand-btn" id="resetPanelsBtn" title="Reset">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="18" rx="1"/><rect x="14" y="3" width="7" height="18" rx="1"/></svg>
        </button>
        <button class="expand-btn" id="expandViewportBtn" title="Expand viewport">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 5l7 7-7 7"/><path d="M5 5l7 7-7 7"/></svg>
        </button>
      </div>
    </div>

    <!-- Viewport Panel -->
    <div class="viewport-panel glass-panel" id="viewportPanel">
      <div class="viewport-header">
        <div class="viewport-info">
          <div class="url-display">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
            <span class="url-text" id="urlDisplay">/api/user/${req.userId}?html&token=${htmlShareToken}</span>
          </div>
        </div>
        <div class="panel-controls">
          <button class="panel-btn" id="homeBtn" title="Home (Profile)">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
          </button>
          <button class="panel-btn" id="refreshBtn" title="Refresh">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 4v6h-6M1 20v-6h6"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
          </button>
        </div>
      </div>

      <div class="iframe-container">
        <div class="loading-overlay" id="loadingOverlay">
          <div class="loading-spinner">
            <div class="spinner-ring"></div>
            <span class="loading-text">Loading...</span>
          </div>
        </div>
        <iframe id="viewport" src="/api/user/${req.userId}?html&token=${htmlShareToken}&inApp=1" sandbox="allow-same-origin allow-scripts allow-forms allow-popups allow-modals allow-downloads allow-top-navigation-by-user-activation allow-top-navigation"></iframe>
      </div>
    </div>
  </div>

  <!-- Mobile Elements -->
  <div class="mobile-input-bar" id="mobileInputBar">
    <div class="input-container" id="mobileInputTrigger">
      <textarea class="chat-input" id="mobileBottomInput" placeholder="Message Tree..." rows="1" readonly></textarea>
      <button class="send-btn" id="mobileSendBtn" disabled>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z"/></svg>
      </button>
    </div>
  </div>

  <div class="mobile-backdrop" id="mobileBackdrop"></div>

  <div class="mobile-chat-sheet" id="mobileChatSheet">
    <div class="mobile-sheet-header" id="mobileSheetHeader">
      <div class="drag-handle"></div>
      <div class="mobile-sheet-title-row">
        <div class="mobile-sheet-title">
          <span class="tree-icon">🌳</span>
          <h1>Tree</h1>
          <span class="root-name-inline" id="mobileRootNameLabel" title=""></span>
        </div>
        <div style="display:flex;align-items:center;gap:8px;">
          <button class="clear-chat-btn" id="mobileClearChatBtn" title="Clear conversation">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
          </button>
          <button class="mobile-close-btn" id="mobileCloseBtn">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
          </button>
        </div>
      </div>
      <!-- NEW: Mobile mode bar (horizontal pill row) -->
      <div class="mobile-mode-bar" id="mobileModeBar"></div>
    </div>
    <div class="mobile-chat-messages" id="mobileChatMessages">
      <div class="welcome-message">
        <div class="welcome-icon">🌳</div>
        <h2>Welcome to Tree</h2>
        <p>Your intelligent workspace is ready.</p>
      </div>
    </div>
    <div class="mobile-chat-input-area">
      <div class="input-container">
        <textarea class="chat-input" id="mobileSheetInput" placeholder="Message Tree..." rows="1"></textarea>
        <button class="send-btn" id="mobileSheetSendBtn" disabled>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z"/></svg>
        </button>
      </div>
    </div>
  </div>

  <script src="/socket.io/socket.io.js"></script>
  <script>
    // Config from server
    const CONFIG = {
      userId: "${req.userId}",
      username: "${username || req.userId}",
      htmlShareToken: "${htmlShareToken}",
      homeUrl: "/api/user/${req.userId}?html&token=${htmlShareToken}&inApp=1"
    };

    // Elements
    const $ = (id) => document.getElementById(id);
    const chatMessages = $("chatMessages");
    const chatInput = $("chatInput");
    const sendBtn = $("sendBtn");
    const statusDot = $("statusDot");
    const statusText = $("statusText");
    const iframe = $("viewport");
    const loadingOverlay = $("loadingOverlay");
    const urlDisplay = $("urlDisplay");
    const mobileChatMessages = $("mobileChatMessages");
    const mobileBottomInput = $("mobileBottomInput");
    const mobileSendBtn = $("mobileSendBtn");
    const mobileSheetInput = $("mobileSheetInput");
    const mobileSheetSendBtn = $("mobileSheetSendBtn");
    const mobileChatSheet = $("mobileChatSheet");
    const mobileBackdrop = $("mobileBackdrop");
    const mobileInputBar = $("mobileInputBar");
    const mobileSheetHeader = $("mobileSheetHeader");
    const mobileInputTrigger = $("mobileInputTrigger");

    // State
    let isConnected = false;
    let isRegistered = false;
    let isSending = false;

    // NEW: Mode state
    let currentModeKey = null;
    let availableModes = [];
    let modeBarOpen = false;
    let requestGeneration = 0; // bumped on cancel/mode-switch to ignore stale responses

    // Socket setup
    const socket = io({ transports: ["websocket", "polling"], withCredentials: true });

    socket.on("connect", () => {
      console.log("[socket] connected:", socket.id);
      isConnected = true;
      socket.emit("ready");
      updateStatus("connecting");
      socket.emit("register", { username: CONFIG.username });
    });

    socket.on("registered", ({ success, error }) => {
      if (success) {
        isRegistered = true;
        updateStatus("connected");
        console.log("[socket] registered for chat");
        // Get current iframe URL using multiple fallbacks
        let currentUrl = "";
        try { currentUrl = iframe.contentWindow?.location?.pathname + iframe.contentWindow?.location?.search; } catch(e) {}
        if (!currentUrl) {
          // Fallback to iframe.src attribute
          try { const u = new URL(iframe.src); currentUrl = u.pathname + u.search; } catch(e) {}
        }
        if (!currentUrl) {
          // Fallback to last known URL in display
          currentUrl = urlDisplay.textContent || "";
        }
        socket.emit("getAvailableModes", { url: currentUrl });
        // Also emit urlChanged so rootId gets set
        if (currentUrl) detectIframeUrlChange();
      } else {
        console.error("[socket] registration failed:", error);
        updateStatus("connected");
        addMessage("Chat registration failed: " + (error || "Unknown error") + ". You can still browse your tree.", "error");
      }
    });

    socket.on("chatResponse", ({ answer, generation }) => {
      // Drop stale responses from before a cancel/mode-switch
      if (generation !== undefined && generation < requestGeneration) {
        console.log("[socket] dropping stale response, gen:", generation, "current:", requestGeneration);
        return;
      }
      removeTypingIndicator();
      addMessage(answer, "assistant");
      isSending = false;
      updateSendButtons();
      lockModeBar(false);
    });

    socket.on("chatError", ({ error, generation }) => {
      if (generation !== undefined && generation < requestGeneration) return;
      removeTypingIndicator();
      addMessage("Error: " + error, "error");
      isSending = false;
      updateSendButtons();
      lockModeBar(false);
    });

    socket.on("navigate", ({ url, replace }) => {
      console.log("[socket] navigate:", url);
      loadingOverlay.classList.add("visible");
      urlDisplay.textContent = url;
      // Add inApp param if not present
      const navUrl = url.includes('inApp=') ? url : url + (url.includes('?') ? '&' : '?') + 'inApp=1';
      if (replace) {
        iframe.contentWindow?.location.replace(navUrl);
      } else {
        iframe.src = navUrl;
      }
    });

    socket.on("reload", () => {
      loadingOverlay.classList.add("visible");
      iframe.contentWindow?.location.reload();
    });

    socket.on("disconnect", () => {
      isConnected = false;
      isRegistered = false;
      updateStatus("disconnected");
    });

    // ================================================================
    // NEW: Mode switching socket events
    // ================================================================

    socket.on("modeSwitched", ({ modeKey, emoji, label, alert, carriedMessages, silent }) => {
      console.log("[mode] switched to:", modeKey, silent ? "(silent)" : "", "carried:", carriedMessages?.length || 0);
      currentModeKey = modeKey;
      // Update desktop mode bar current display
      $("modeCurrentEmoji").textContent = emoji;
      $("modeCurrentLabel").textContent = label;
      // Only re-render if availableModes already matches this big mode
      const bigMode = modeKey.split(":")[0];
      if (availableModes.length && availableModes[0].key.startsWith(bigMode + ":")) {
        renderModeDropdown();
        renderMobileModeBar();
      }
      if (!silent) {
        // Reset sending state if a request was in-flight
        if (isSending) {
          isSending = false;
          removeTypingIndicator();
          lockModeBar(false);
          updateSendButtons();
        }
        // Clear chat and show mode-specific welcome
        clearChatUI(carriedMessages || [], modeKey, emoji);
        // Show alert toast
        showModeAlert(emoji, label);
      }
    });

    socket.on("availableModes", ({ bigMode, modes, currentMode, rootName }) => {
      console.log("[mode] available:", bigMode, modes, "root:", rootName);
      availableModes = modes || [];
      if (currentMode) currentModeKey = currentMode;
      // If we have a current mode, update the display
      const active = availableModes.find(m => m.key === currentModeKey);
      if (active) {
        $("modeCurrentEmoji").textContent = active.emoji;
        $("modeCurrentLabel").textContent = active.label;
      }
      renderModeDropdown();
      renderMobileModeBar();
      updateRootName(rootName);
    });

    socket.on("conversationCleared", () => {
      console.log("[socket] conversation manually cleared");
      clearChatUI([], currentModeKey);
    });

    // ================================================================
    // NEW: Mode bar logic (desktop)
    // ================================================================

    function renderModeDropdown() {
      const dropdown = $("modeDropdown");
      dropdown.innerHTML = "";
      availableModes.forEach(mode => {
        const btn = document.createElement("button");
        btn.className = "mode-option" + (mode.key === currentModeKey ? " active" : "");
        btn.innerHTML = '<span class="mode-option-emoji">' + mode.emoji + '</span><span>' + mode.label + '</span>';
        btn.addEventListener("click", (e) => {
          e.stopPropagation();
          if (mode.key !== currentModeKey) {
            socket.emit("switchMode", { modeKey: mode.key });
          }
          closeModeBar();
        });
        dropdown.appendChild(btn);
      });
    }

    function toggleModeBar() {
      modeBarOpen = !modeBarOpen;
      $("modeBar").classList.toggle("open", modeBarOpen);
    }

    function closeModeBar() {
      modeBarOpen = false;
      $("modeBar").classList.remove("open");
    }

    $("modeCurrent").addEventListener("click", (e) => {
      e.stopPropagation();
      toggleModeBar();
    });

    // Close dropdown when clicking outside
    document.addEventListener("click", (e) => {
      if (modeBarOpen && !$("modeBar").contains(e.target)) {
        closeModeBar();
      }
    });

    // ================================================================
    // NEW: Lock/unlock mode bar while AI is responding
    // ================================================================

    const SEND_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z"/></svg>';
    const STOP_SVG = '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>';

    function lockModeBar(locked) {
      $("modeBar").classList.toggle("locked", locked);
      // Lock mobile mode buttons
      document.querySelectorAll(".mobile-mode-btn").forEach(btn => {
        btn.classList.toggle("locked", locked);
      });
      // Toggle all send buttons to stop mode
      [sendBtn, mobileSheetSendBtn].forEach(btn => {
        btn.classList.toggle("stop-mode", locked);
        btn.innerHTML = locked ? STOP_SVG : SEND_SVG;
        if (locked) btn.disabled = false; // stop button should always be clickable
      });
    }

    function cancelRequest() {
      if (!isSending) return;
      requestGeneration++;
      isSending = false;
      removeTypingIndicator();
      lockModeBar(false);
      updateSendButtons();
      socket.emit("cancelRequest");
    }

    function updateRootName(name) {
      ["rootNameLabel", "mobileRootNameLabel"].forEach(id => {
        const el = $(id);
        if (name) {
          const changed = el.textContent !== name;
          el.textContent = name;
          el.title = name;
          el.classList.add("visible");
          if (changed) {
            el.classList.remove("fade-in");
            void el.offsetWidth; // force reflow
            el.classList.add("fade-in");
          }
        } else {
          el.classList.remove("visible", "fade-in");
          el.textContent = "";
          el.title = "";
        }
      });
    }

    // ================================================================
    // NEW: Mobile mode bar (horizontal pills in sheet header)
    // ================================================================

    function renderMobileModeBar() {
      const bar = $("mobileModeBar");
      bar.innerHTML = "";
      availableModes.forEach(mode => {
        const btn = document.createElement("button");
        btn.className = "mobile-mode-btn" + (mode.key === currentModeKey ? " active" : "");
        btn.innerHTML = '<span class="mobile-mode-btn-emoji">' + mode.emoji + '</span><span>' + mode.label + '</span>';
        btn.addEventListener("click", (e) => {
          e.stopPropagation(); // Don't trigger drag
          if (mode.key !== currentModeKey) {
            socket.emit("switchMode", { modeKey: mode.key });
          }
        });
        bar.appendChild(btn);
      });
    }

    // ================================================================
    // NEW: Mode alert toast
    // ================================================================

    let modeAlertTimer = null;
    function showModeAlert(emoji, label) {
      const el = $("modeAlert");
      $("modeAlertEmoji").textContent = emoji;
      $("modeAlertText").textContent = label;
      el.classList.add("visible");
      clearTimeout(modeAlertTimer);
      modeAlertTimer = setTimeout(() => {
        el.classList.remove("visible");
      }, 2000);
    }

    // ================================================================
    // NEW: Clear chat UI helper
    // ================================================================

    const MODE_WELCOMES = {
     "home:default": {
  icon: "🌳",
  title: "Welcome to Tree",
  desc: "Your intelligent workspace is ready — build, explore, and reflect"
},

"home:raw-idea-placement": {
  icon: "💡",
  title: "Raw Ideas",
  desc: "Capture unstructured thoughts and gradually grow them into trees (work in progress)"
},

"home:reflect": {
  icon: "🔮",
  title: "Reflect",
  desc: "Review your notes, tags, and contributions across all your trees"
},

"tree:structure": {
  icon: "🏗️",
  title: "Structure Mode",
  desc: "Create, reorganize, and grow the overall shape of your tree"
},

"tree:be": {
  icon: "🎯",
  title: "Be Mode",
  desc: "Focus on one active leaf at a time and work through it step by step"
},

"tree:reflect": {
  icon: "🔮",
  title: "Reflect Mode",
  desc: "Look at your tree as a whole to spot gaps, patterns, and opportunities"
},

"tree:edit": {
  icon: "✏️",
  title: "Edit Mode",
  desc: "Refine names, values, notes, and details within your tree"
}

    };

    function clearChatUI(carriedMessages, modeKey, emoji) {
      // Filter out empty/blank messages
      const valid = (carriedMessages || []).filter(m => m.content && m.content.trim());

      const welcome = MODE_WELCOMES[modeKey] || { icon: emoji || "🌳", title: "Ready", desc: "How can I help?" };

      [chatMessages, mobileChatMessages].forEach(container => {
        container.innerHTML = '';

        if (valid.length > 0) {
          // Render carried messages dimmed
          valid.forEach(msg => {
            const el = document.createElement("div");
            el.className = "message " + msg.role + " carried";
            const formattedContent = msg.role === "assistant" ? formatMessageContent(msg.content) : escapeHtml(msg.content);
            el.innerHTML =
              '<div class="message-avatar">' + (msg.role === "user" ? "👤" : "🌳") + '</div>' +
              '<div class="message-content">' + formattedContent + '</div>';
            container.appendChild(el);
          });
          container.scrollTop = container.scrollHeight;
        } else {
          container.innerHTML = '<div class="welcome-message"><div class="welcome-icon">' + welcome.icon + '</div><h2>' + welcome.title + '</h2><p>' + welcome.desc + '</p></div>';
        }
      });
    }

    // ================================================================
    // NEW: iframe URL change detection → emit urlChanged
    // ================================================================

    let lastEmittedUrl = "";
    function detectIframeUrlChange() {
      let path = "";

      // Try contentWindow first (may fail cross-origin)
      try {
        const loc = iframe.contentWindow?.location;
        if (loc) path = loc.pathname + loc.search;
      } catch (e) {}

      // Fallback to iframe.src attribute
      if (!path) {
        try { const u = new URL(iframe.src); path = u.pathname + u.search; } catch(e) {}
      }

      // Fallback to URL display text
      if (!path) {
        path = urlDisplay.textContent || "";
      }

      if (path && path !== lastEmittedUrl) {
        lastEmittedUrl = path;
        // Extract IDs from URL
        const ID = '(?:[a-f0-9]{24}|[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})';
        let rootId = null;
        let nodeId = null;
        const rootMatch = path.match(new RegExp('(?:/api)?/root/(' + ID + ')', 'i'));
        const bareMatch = path.match(new RegExp('(?:/api)?/(' + ID + ')(?:[?/]|$)', 'i'));
        if (rootMatch) rootId = rootMatch[1];
        else if (bareMatch) nodeId = bareMatch[1];

        if (isRegistered) {
          socket.emit("urlChanged", { url: path, rootId, nodeId });
        }
      }
    }

    // Status
    function updateStatus(status) {
      statusDot.className = "status-dot " + status;
      statusText.textContent = status === "connected" ? "Connected" : status === "connecting" ? "Connecting..." : "Disconnected";
      isConnected = status === "connected";
    }

    // Format message content with markdown-like parsing
    function formatMessageContent(text) {
      if (!text) return '';
      
      let html = text;
      
      // Decode HTML entities
      html = html.replace(/&nbsp;/g, ' ');
      html = html.replace(/&amp;/g, '&');
      html = html.replace(/&lt;/g, '<');
      html = html.replace(/&gt;/g, '>');
      html = html.replace(/\u00A0/g, ' ');
      html = html.replace(/–/g, '-');
      html = html.replace(/—/g, '--');
      
      // Escape HTML
      html = html.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      
      // Detect markdown tables and convert to clickable items
      const tableRegex = /^\\|(.+)\\|\\s*\\n\\|[-:\\s|]+\\|\\s*\\n((?:\\|.+\\|\\s*\\n?)+)/gm;
      html = html.replace(tableRegex, (match, headerRow, bodyRows) => {
        const rows = bodyRows.trim().split('\\n').map(row => 
          row.split('|').map(cell => cell.trim()).filter(cell => cell)
        );
        let items = '';
        rows.forEach(row => {
          if (row.length >= 2) {
            const num = row[0];
            const name = row[1];
            if (/^\\d{1,2}$/.test(num)) {
              items += '<div class="menu-item clickable" data-action="' + num + '" data-name="' + name.replace(/"/g, '&quot;') + '">' +
                '<span class="menu-number">' + num + '</span>' +
                '<span class="menu-text">' + name + '</span></div>';
            } else {
              items += '<div class="menu-item">' +
                '<span class="menu-number">•</span>' +
                '<span class="menu-text">' + name + '</span></div>';
            }
          }
        });
        return items;
      });
      
      // Convert pipe-separated lists (only if first cell is a number 1-99)
      html = html.replace(/^\\|\\s*(\\d{1,2})\\s*\\|\\s*(.+?)\\s*\\|\\s*$/gm, (match, num, name) => {
        return '<div class="menu-item clickable" data-action="' + num + '" data-name="' + name.replace(/"/g, '&quot;') + '">' +
          '<span class="menu-number">' + num + '</span>' +
          '<span class="menu-text">' + name + '</span></div>';
      });
      
      // Remove table artifacts
      html = html.replace(/^\\|\\s*#\\s*\\|.*\\|\\s*$/gm, '');
      html = html.replace(/^\\|[-:\\s|]+\\|\\s*$/gm, '');
      
      // Code blocks
      html = html.replace(/\`\`\`([\\s\\S]*?)\`\`\`/g, '<pre><code>$1</code></pre>');
      html = html.replace(/\`([^\`]+)\`/g, '<code>$1</code>');
      
      // Bold
      html = html.replace(/\\*\\*(.+?)\\*\\*/g, '<strong>$1</strong>');
      html = html.replace(/__(.+?)__/g, '<strong>$1</strong>');
      
      // Italic
      html = html.replace(/(?<![\\w\\*])\\*([^\\*]+)\\*(?![\\w\\*])/g, '<em>$1</em>');
      
      // Headers
      html = html.replace(/^####\\s*(.+)$/gm, '<h4>$1</h4>');
      html = html.replace(/^###\\s*(.+)$/gm, '<h3>$1</h3>');
      html = html.replace(/^##\\s*(.+)$/gm, '<h2>$1</h2>');
      html = html.replace(/^#\\s*(.+)$/gm, '<h1>$1</h1>');
      
      // Horizontal rules
      html = html.replace(/^-{3,}$/gm, '<hr>');
      html = html.replace(/^\\*{3,}$/gm, '<hr>');
      
      // Blockquotes
      html = html.replace(/^&gt;\\s*(.+)$/gm, '<blockquote>$1</blockquote>');
      
      // Emoji numbered items - clickable
      html = html.replace(/^([1-9]️⃣)\\s*<strong>(.+?)<\\/strong>(.*)$/gm, (m, emoji, title, rest) => {
        const num = emoji.match(/[1-9]/)?.[0] || '1';
        return '<div class="menu-item clickable" data-action="' + num + '" data-name="' + title.replace(/"/g, '&quot;') + '">' +
          '<span class="menu-number">' + num + '</span>' +
          '<span class="menu-text"><strong>' + title + '</strong>' + rest + '</span></div>';
      });
      html = html.replace(/^([1-9]️⃣)\\s*(.+)$/gm, (m, emoji, text) => {
        const num = emoji.match(/[1-9]/)?.[0] || '1';
        return '<div class="menu-item clickable" data-action="' + num + '" data-name="' + text.replace(/"/g, '&quot;') + '">' +
          '<span class="menu-number">' + num + '</span>' +
          '<span class="menu-text">' + text + '</span></div>';
      });
      
      // Only numbered items with bold title are clickable (1-20)
      html = html.replace(/^([1-9]|1[0-9]|20)\\.\\s*<strong>(.+?)<\\/strong>(.*)$/gm, (m, num, title, rest) => {
        return '<div class="menu-item clickable" data-action="' + num + '" data-name="' + title.replace(/"/g, '&quot;') + '">' +
          '<span class="menu-number">' + num + '</span>' +
          '<span class="menu-text"><strong>' + title + '</strong>' + rest + '</span></div>';
      });
      
      // Dash/bullet items with bold title - NOT clickable
      html = html.replace(/^[-–•]\\s*<strong>(.+?)<\\/strong>(.*)$/gm, 
        '<div class="menu-item"><span class="menu-number">•</span><span class="menu-text"><strong>$1</strong>$2</span></div>');
      
      // Plain dash items - regular list
      html = html.replace(/^[-–•]\\s+([^<].*)$/gm, '<li>$1</li>');
      
      // Plain numbered items WITHOUT bold - not clickable
      html = html.replace(/^(\\d+)\\.\\s+([^<*].*)$/gm, '<li><span class="list-num">$1.</span> $2</li>');
      
      // Wrap li in ul
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
      html = blocks.map(block => {
        const trimmed = block.trim();
        if (!trimmed) return '';
        if (trimmed.match(/^<(h[1-4]|ul|ol|pre|blockquote|hr|div|table)/)) return trimmed;
        const withBreaks = trimmed.split('\\n').map(l => l.trim()).filter(l => l).join('<br>');
        return '<p>' + withBreaks + '</p>';
      }).filter(b => b).join('');
      
      // Cleanup
      html = html.replace(/<p><\\/p>/g, '');
      html = html.replace(/<p>(<div|<ul|<ol|<h[1-4]|<hr|<pre|<blockquote|<table)/g, '$1');
      html = html.replace(/(<\\/div>|<\\/ul>|<\\/ol>|<\\/h[1-4]>|<\\/pre>|<\\/blockquote>|<\\/table>)<\\/p>/g, '$1');
      html = html.replace(/<br>(<div|<\\/div>)/g, '$1');
      html = html.replace(/(<div[^>]*>)<br>/g, '$1');
      
      return html;
    }

    // Messages
    function addMessage(content, role) {
      [chatMessages, mobileChatMessages].forEach(container => {
        const welcome = container.querySelector(".welcome-message");
        if (welcome) welcome.remove();

        const msg = document.createElement("div");
        msg.className = "message " + role;
        
        const formattedContent = role === "assistant" ? formatMessageContent(content) : escapeHtml(content);
        
        msg.innerHTML = \`
          <div class="message-avatar">\${role === "user" ? "👤" : "🌳"}</div>
          <div class="message-content">\${formattedContent}</div>
        \`;
        
        // Add click handlers for menu items
        if (role === "assistant") {
          msg.querySelectorAll('.menu-item.clickable').forEach(item => {
            item.addEventListener('click', () => handleMenuItemClick(item));
          });
        }
        
        container.appendChild(msg);
        container.scrollTop = container.scrollHeight;
      });
    }

    // Handle clicking on menu items
    function handleMenuItemClick(item) {
      const action = item.dataset.action;
      const name = item.dataset.name;
      
      if (!action || isSending) return;
      
      // Visual feedback
      item.classList.add('clicking');
      setTimeout(() => item.classList.remove('clicking'), 300);
      
      // Send the number/action as a message
      sendChatMessage(action);
    }

    function addTypingIndicator() {
      [chatMessages, mobileChatMessages].forEach(container => {
        if (container.querySelector(".typing-indicator")) return;
        const typing = document.createElement("div");
        typing.className = "message assistant";
        typing.innerHTML = \`
          <div class="message-avatar">🌳</div>
          <div class="typing-indicator">
            <div class="typing-dot"></div>
            <div class="typing-dot"></div>
            <div class="typing-dot"></div>
          </div>
        \`;
        container.appendChild(typing);
        container.scrollTop = container.scrollHeight;
      });
    }

    function removeTypingIndicator() {
      document.querySelectorAll(".typing-indicator").forEach(el => el.closest(".message")?.remove());
    }

    function escapeHtml(text) {
      const div = document.createElement("div");
      div.textContent = text;
      return div.innerHTML;
    }

    // Send message
    function sendChatMessage(message) {
      if (!message.trim() || isSending || !isRegistered) return;

      addMessage(message, "user");
      addTypingIndicator();
      isSending = true;
      requestGeneration++;
      const thisGen = requestGeneration;
      updateSendButtons();
      lockModeBar(true);

      socket.emit("chat", { message, username: CONFIG.username, generation: thisGen });
    }

    function updateSendButtons() {
      const desktopText = chatInput.value.trim();
      const mobileSheetText = mobileSheetInput.value.trim();
      
      // When sending, buttons act as stop - keep enabled
      sendBtn.disabled = isSending ? false : !(desktopText && isRegistered);
      mobileSheetSendBtn.disabled = isSending ? false : !(mobileSheetText && isRegistered);
      mobileSendBtn.disabled = true;
    }

    // Input handlers - Desktop
    chatInput.addEventListener("input", () => {
      updateSendButtons();
      chatInput.style.height = "auto";
      chatInput.style.height = Math.min(chatInput.scrollHeight, 120) + "px";
    });

    chatInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        const msg = chatInput.value.trim();
        if (msg && isRegistered && !isSending) {
          sendChatMessage(msg);
          chatInput.value = "";
          chatInput.style.height = "auto";
          updateSendButtons();
        }
      }
    });

    sendBtn.addEventListener("click", () => {
      if (isSending) {
        cancelRequest();
        return;
      }
      const msg = chatInput.value.trim();
      if (msg && isRegistered && !isSending) {
        sendChatMessage(msg);
        chatInput.value = "";
        chatInput.style.height = "auto";
        updateSendButtons();
      }
    });

    // Mobile handlers
    let isSheetOpen = false;
    let sheetDragStartY = 0;
    let isDraggingSheet = false;
    let sheetHeight = 0;
    let currentDragY = 0;

    function openMobileSheet() {
      if (isSheetOpen) return;
      
      isSheetOpen = true;
      mobileChatSheet.classList.remove("closing");
      mobileChatSheet.classList.add("open");
      mobileBackdrop.classList.add("visible");
      mobileInputBar.style.opacity = "0";
      mobileInputBar.style.pointerEvents = "none";
      
      // Focus the sheet input after animation
      setTimeout(() => {
        mobileSheetInput.focus();
        updateSendButtons();
      }, 420);
    }

    function closeMobileSheet() {
      if (!isSheetOpen) return;
      
      isSheetOpen = false;
      mobileChatSheet.classList.remove("open");
      mobileChatSheet.classList.add("closing");
      mobileBackdrop.classList.remove("visible");
      mobileSheetInput.blur();
      
      // Clean up after animation
      setTimeout(() => { 
        mobileChatSheet.classList.remove("closing");
        mobileInputBar.style.opacity = "1";
        mobileInputBar.style.pointerEvents = "auto";
      }, 300);
    }

    // Tap on mobile input bar to open sheet
    mobileInputTrigger.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      openMobileSheet();
    });

    mobileBottomInput.addEventListener("focus", (e) => {
      e.preventDefault();
      mobileBottomInput.blur();
      openMobileSheet();
    });

    // Mobile sheet input listeners
    mobileSheetInput.addEventListener("input", () => {
      updateSendButtons();
      mobileSheetInput.style.height = "auto";
      mobileSheetInput.style.height = Math.min(mobileSheetInput.scrollHeight, 120) + "px";
    });

    mobileSheetInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        const msg = mobileSheetInput.value.trim();
        if (msg && isRegistered && !isSending) {
          sendChatMessage(msg);
          mobileSheetInput.value = "";
          mobileSheetInput.style.height = "auto";
          updateSendButtons();
        }
      }
    });

    mobileSheetSendBtn.addEventListener("click", () => {
      if (isSending) {
        cancelRequest();
        return;
      }
      const msg = mobileSheetInput.value.trim();
      if (msg && isRegistered && !isSending) {
        sendChatMessage(msg);
        mobileSheetInput.value = "";
        mobileSheetInput.style.height = "auto";
        updateSendButtons();
      }
    });

    $("mobileCloseBtn").addEventListener("click", closeMobileSheet);
    mobileBackdrop.addEventListener("click", closeMobileSheet);

    // Sheet drag to dismiss
    function handleSheetDragStart(e) {
      if (!isSheetOpen) return;
      
      const touch = e.touches ? e.touches[0] : e;
      sheetDragStartY = touch.clientY;
      sheetHeight = mobileChatSheet.offsetHeight;
      currentDragY = 0;
      isDraggingSheet = true;
      mobileChatSheet.classList.add("dragging");
    }

    function handleSheetDragMove(e) {
      if (!isDraggingSheet) return;
      
      const touch = e.touches ? e.touches[0] : e;
      const deltaY = touch.clientY - sheetDragStartY;
      
      // Only allow dragging down (positive deltaY)
      if (deltaY > 0) {
        currentDragY = deltaY;
        mobileChatSheet.style.transform = \`translateY(\${deltaY}px)\`;
        
        // Fade backdrop based on drag progress
        const progress = Math.min(deltaY / (sheetHeight * 0.5), 1);
        mobileBackdrop.style.opacity = String(1 - progress * 0.7);
      }
    }

    function handleSheetDragEnd(e) {
      if (!isDraggingSheet) return;
      
      isDraggingSheet = false;
      mobileChatSheet.classList.remove("dragging");
      
      // Reset inline styles
      mobileChatSheet.style.transform = "";
      mobileBackdrop.style.opacity = "";
      
      // If dragged more than 25% of sheet height, close it
      if (currentDragY > sheetHeight * 0.25) {
        closeMobileSheet();
      } else {
        // Snap back - sheet is already open, just re-add the class
        mobileChatSheet.classList.add("open");
      }
      
      currentDragY = 0;
    }

    // Touch listeners for header drag
    mobileSheetHeader.addEventListener("touchstart", handleSheetDragStart, { passive: true });
    mobileSheetHeader.addEventListener("touchmove", handleSheetDragMove, { passive: true });
    mobileSheetHeader.addEventListener("touchend", handleSheetDragEnd, { passive: true });
    mobileSheetHeader.addEventListener("touchcancel", handleSheetDragEnd, { passive: true });

    // Mouse support for testing on desktop
    let mouseIsDown = false;
    mobileSheetHeader.addEventListener("mousedown", (e) => {
      mouseIsDown = true;
      handleSheetDragStart(e);
    });
    document.addEventListener("mousemove", (e) => {
      if (mouseIsDown && isDraggingSheet) handleSheetDragMove(e);
    });
    document.addEventListener("mouseup", (e) => {
      if (mouseIsDown) {
        mouseIsDown = false;
        if (isDraggingSheet) handleSheetDragEnd(e);
      }
    });

    // Panel resizing (desktop)
    const appContainer = document.querySelector(".app-container");
    const chatPanel = $("chatPanel");
    const viewportPanel = $("viewportPanel");
    const panelDivider = $("panelDivider");
    let isDragging = false, dragStartX = 0, dragStartWidth = 0, currentChatWidth = 0;
    const MIN_PANEL = 280, DIVIDER = 16, PADDING = 32;

    function getAvailable() { return appContainer.clientWidth - PADDING - DIVIDER; }

    function setChatWidth(w) {
      const avail = getAvailable();
      let clamped = Math.max(0, Math.min(w, avail));
      if (clamped > 0 && clamped < MIN_PANEL) clamped = 0;
      if (avail - clamped > 0 && avail - clamped < MIN_PANEL) clamped = avail;
      currentChatWidth = clamped;
      chatPanel.style.width = clamped + "px";
      chatPanel.classList.toggle("collapsed", clamped === 0);
      viewportPanel.classList.toggle("collapsed", avail - clamped === 0);
    }

    setChatWidth(getAvailable() / 2.5);
    window.addEventListener("resize", () => setChatWidth(currentChatWidth));

    panelDivider.addEventListener("mousedown", (e) => {
      isDragging = true;
      dragStartX = e.clientX;
      dragStartWidth = currentChatWidth;
      appContainer.classList.add("dragging");
      e.preventDefault();
    });

    document.addEventListener("mousemove", (e) => {
      if (!isDragging) return;
      setChatWidth(dragStartWidth + (e.clientX - dragStartX));
    });

    document.addEventListener("mouseup", () => {
      if (isDragging) {
        isDragging = false;
        appContainer.classList.remove("dragging");
      }
    });

    $("expandChatBtn").addEventListener("click", () => setChatWidth(getAvailable()));
    $("expandViewportBtn").addEventListener("click", () => setChatWidth(0));
    $("resetPanelsBtn").addEventListener("click", () => setChatWidth(getAvailable() / 2));

    // Clear chat buttons (desktop + mobile)
    function handleClearChat() {
      if (!isRegistered) return;
      if (isSending) cancelRequest();
      socket.emit("clearConversation");
      clearChatUI([], currentModeKey);
    }

    $("clearChatBtn").addEventListener("click", handleClearChat);
    $("mobileClearChatBtn").addEventListener("click", handleClearChat);

    // Home button
    $("homeBtn").addEventListener("click", () => {
      loadingOverlay.classList.add("visible");
      iframe.src = CONFIG.homeUrl;
      urlDisplay.textContent = CONFIG.homeUrl;
    });

    // Iframe
    iframe.addEventListener("load", () => {
      loadingOverlay.classList.remove("visible");
      try {
        const url = new URL(iframe.contentWindow?.location.href);
        urlDisplay.textContent = url.pathname + url.search;
      } catch (e) {}
      // NEW: Detect URL change on iframe load
      detectIframeUrlChange();
    });

    $("refreshBtn").addEventListener("click", () => {
      loadingOverlay.classList.add("visible");
      iframe.contentWindow?.location.reload();
    });

    // Socket events
    socket.on("treeChanged", ({ nodeId, changeType, details }) => {
      console.log("[socket] tree changed:", changeType, nodeId);
      loadingOverlay.classList.add("visible");
      iframe.contentWindow?.location.reload();
    });

    socket.on("toolResult", ({ tool, args, success, error }) => {
      console.log("[socket] tool:", tool, success ? "✓" : "✗", error || "");
    });

    // API
    window.TreeApp = {
      sendMessage: sendChatMessage,
      addMessage,
      navigate: (url) => { 
        loadingOverlay.classList.add("visible"); 
        const navUrl = url.includes('inApp=') ? url : url + (url.includes('?') ? '&' : '?') + 'inApp=1';
        iframe.src = navUrl; 
      },
      goHome: () => { loadingOverlay.classList.add("visible"); iframe.src = CONFIG.homeUrl; },
      isConnected: () => isConnected,
      isRegistered: () => isRegistered,
      notifyNodeUpdated: (nodeId, changes) => { if (isRegistered) socket.emit("nodeUpdated", { nodeId, changes }); },
      notifyNodeNavigated: (nodeId, nodeName) => { if (isRegistered) socket.emit("nodeNavigated", { nodeId, nodeName }); },
      notifyNodeSelected: (nodeId, nodeName) => { if (isRegistered) socket.emit("nodeSelected", { nodeId, nodeName }); },
      notifyNodeCreated: (nodeId, nodeName, parentId) => { if (isRegistered) socket.emit("nodeCreated", { nodeId, nodeName, parentId }); },
      notifyNodeDeleted: (nodeId, nodeName) => { if (isRegistered) socket.emit("nodeDeleted", { nodeId, nodeName }); },
      notifyNoteCreated: (nodeId, noteContent) => { if (isRegistered) socket.emit("noteCreated", { nodeId, noteContent }); },
      clearConversation: () => { if (isRegistered) socket.emit("clearConversation"); },
      // NEW: Mode switching API
      switchMode: (modeKey) => { if (isRegistered) socket.emit("switchMode", { modeKey }); },
      getCurrentMode: () => currentModeKey,
      getAvailableModes: () => availableModes
    };
  </script>
</body>
</html>`);
  } catch (err) {
    console.error(err);
    res.status(500).send("Failed to load app");
  }
});

export default router;
