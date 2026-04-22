// treeos/app/app.js - Dashboard page
import express from "express";
import { sendError, ERR } from "../../../seed/protocol.js";
import User from "../../../seed/models/user.js";
import LlmConnection from "../../../seed/models/llmConnection.js";
import authenticateLite from "../../html-rendering/authenticateLite.js";
import { notFoundPage } from "../../html-rendering/notFoundPage.js";
import {
  dashboardCSS,
  dashboardHTML,
  dashboardJS,
} from "./sessionManagerPartial.js";
import { getLandUrl, getLandIdentity } from "../../../canopy/identity.js";
import { isHtmlEnabled } from "../../html-rendering/config.js";
import { esc } from "../../html-rendering/html/utils.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const router = express.Router();

/**
 * GET /dashboard
 * Authenticated iframe shell with integrated chat
 */
router.get("/dashboard", authenticateLite, async (req, res) => {
  try {
    if (!isHtmlEnabled()) {
      return sendError(res, 404, ERR.EXTENSION_NOT_FOUND, "Server-rendered HTML is disabled. Use the SPA frontend.");
    }
    if (!req.userId) {
      return res.redirect("/login");
    }

    const user = await User.findById(req.userId).select(
      "username metadata llmDefault",
    );

    if (!user) {
      return notFoundPage(req, res, "This user doesn't exist.");
    }

    const userMetaModule = await import("../../../seed/tree/userMetadata.js");
    const nav = userMetaModule.getUserMeta(user, "nav");
    const userRoots = Array.isArray(nav.roots) ? nav.roots : [];

    // Redirect to setup if user needs LLM (unless they skipped recently).
    // No tree is fine. Sprout creates trees from conversation.
    const setupSkipped = req.cookies?.setupSkipped === "1";
    if (!setupSkipped) {
      const hasMainLlm = !!user.llmDefault;
      if (!hasMainLlm) {
        const connCount = await LlmConnection.countDocuments({ userId: req.userId });
        if (connCount === 0) {
          return res.redirect("/setup");
        }
      }
    }

    const { getUserMeta } = await import("../../../seed/tree/userMetadata.js");
    const htmlShareToken = getUserMeta(user, "html")?.shareToken || "";
    const { username } = user;
    const hasLlm =
      !!user.llmDefault ||
      (await LlmConnection.countDocuments({ userId: req.userId })) > 0;

    const landName = getLandIdentity()?.name || "TreeOS";

    return res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>${landName}</title>
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
  <meta name="theme-color" content="#0d1117" />
  <link rel="icon" href="/tree.png" />
  <link rel="canonical" href="${getLandUrl()}/app" />
  <meta name="robots" content="noindex, nofollow" />
  <meta name="description" content="${landName}. Powered by TreeOS." />
  <meta property="og:title" content="${landName}" />
  <meta property="og:description" content="${landName}. Powered by TreeOS." />
  <meta property="og:url" content="${getLandUrl()}/app" />
  <meta property="og:type" content="website" />
  <meta property="og:site_name" content="${landName}" />
  <meta property="og:image" content="${getLandUrl()}/tree.png" />
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=DM+Sans:opsz,wght@9..40,400;9..40,500;9..40,600&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
  <style>
    :root {
      /* Nightfall theme */
      --bg:           #0d1117;
      --bg-elevated:  #161b24;
      --bg-hover:     #1c222e;
      --border:       #232a38;
      --border-strong:#2f3849;

      --text-primary:   #e6e8eb;
      --text-secondary: #c4c8d0;
      --text-muted:     #9ba1ad;
      --text-dim:       #5d6371;

      --accent:      #7dd385;
      --accent-glow: rgba(125, 211, 133, 0.5);
      --error:       #c97e6a;

      /* Legacy aliases (some code still references these) */
      --glass-rgb:          22, 27, 36;
      --glass-alpha:        1;
      --glass-blur:         0px;
      --glass-border:       #232a38;
      --glass-border-light: #232a38;
      --glass-highlight:    #2f3849;

      --header-height: 56px;
      --transition-fast: 150ms cubic-bezier(0.4, 0, 0.2, 1);
      --mobile-input-height: 70px;
      --min-panel-width: 280px;
    }


    * { box-sizing: border-box; margin: 0; padding: 0; -webkit-tap-highlight-color: transparent; }
    html, body { height: 100%; width: 100%; overflow: hidden; font-family: 'DM Sans', -apple-system, sans-serif; color: var(--text-primary); background: var(--bg); }

    .app-bg { position: fixed; inset: 0; background: var(--bg); z-index: -2; }

    .app-container { display: flex; height: 100%; width: 100%; padding: 0px; gap: 0px; }
    .glass-panel {
      background: var(--bg-elevated);
      border-radius: 0;
      border: none;
      box-shadow: none;
    }

    .chat-panel { width: 400px; min-width: 0; height: 100%; display: flex; flex-direction: column; z-index: 10; flex-shrink: 0; position: relative; }
    .chat-header { height: var(--header-height); padding: 0 16px; display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid var(--glass-border-light); flex-shrink: 0; position: relative; z-index: 1; }
    .chat-header a { text-decoration: none; color: inherit; }
    .chat-title { display: flex; align-items: center; gap: 12px; flex-shrink: 0; }
    .tree-icon { font-size: 28px; filter: drop-shadow(0 4px 12px rgba(0, 0, 0, 0.3)); animation: grow 4.5s infinite ease-in-out; }
    @keyframes grow { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.06); } }
    .chat-title h1 { font-size: 18px; font-weight: 600; letter-spacing: -0.02em; text-shadow: 0 2px 8px rgba(0, 0, 0, 0.2); }
    
    .chat-header-controls { display: flex; align-items: center; gap: 0; margin-left: auto; }
    .chat-header-buttons { display: flex; align-items: center; gap: 6px; margin-right: 12px; }
    .chat-header-right { display: flex; align-items: center; gap: 0; }

    .status-badge { display: flex; align-items: center; gap: 8px; padding: 6px 14px; background: rgba(255, 255, 255, 0.15); backdrop-filter: blur(10px); border-radius: 100px; border: 1px solid var(--glass-border-light); font-size: 12px; font-weight: 600; }
    .status-badge .status-text { display: inline; }
    .status-dot { width: 8px; height: 8px; border-radius: 50%; box-shadow: 0 0 12px var(--accent-glow); animation: pulse 2s ease-in-out infinite; flex-shrink: 0; }
    .status-dot.connected { background: var(--accent); }
    .status-dot.disconnected { background: var(--error); animation: none; }
    .status-dot.connecting { background: #f59e0b; }
    @keyframes pulse { 0%, 100% { opacity: 1; transform: scale(1); } 50% { opacity: 0.7; transform: scale(1.15); } }
    
    /* Compact mode for narrow panels */
    .chat-panel:not(.collapsed) { container-type: inline-size; }
    @container (max-width: 420px) {
      #desktopOpenTabBtn { display: none; }
    }
    @container (max-width: 360px) {
      .status-badge .status-text { display: none; }
      .status-badge { padding: 6px; min-width: 20px; justify-content: center; }
    }
    @container (max-width: 320px) {
      .chat-title h1 { display: none; }
    }
    
    /* Wide panel mode - constrain content when panel is very wide */
    @container (min-width: 750px) {
      .chat-messages {
        width: 100%;
        max-width: 720px;
        margin-left: auto;
        margin-right: auto;
        padding-left: 24px;
        padding-right: 24px;
      }
      .chat-input-area {
        width: 100%;
        max-width: 760px;
        margin-left: auto;
        margin-right: auto;
      }
      .mode-bar {
        width: 100%;
        max-width: 760px;
        margin-left: auto;
        margin-right: auto;
      }
    }
    @container (min-width: 950px) {
      .chat-messages {
        max-width: 840px;
      }
      .chat-input-area {
        max-width: 880px;
      }
      .mode-bar {
        max-width: 880px;
      }
    }
    @container (min-width: 1150px) {
      .chat-messages {
        max-width: 920px;
        padding-left: 32px;
        padding-right: 32px;
      }
      .chat-input-area {
        max-width: 960px;
      }
      .mode-bar {
        max-width: 960px;
      }
    }
/* Orchestrator step / system messages: hidden by default, toggle to show */
.message.orchestrator-step,
.chat-message.system {
  display: none;
}
body.show-bg-messages .message.orchestrator-step,
body.show-bg-messages .chat-message.system {
  display: flex;
}
/* Mode picker is an advanced override. Sprout + the routing index pick the
   right mode automatically. Hide the picker unless the user opts into the
   advanced/system view (same toggle as background messages). */
.mode-bar,
.mobile-mode-bar {
  display: none !important;
}
body.show-bg-messages .mode-bar {
  display: flex !important;
}
body.show-bg-messages .mobile-mode-bar {
  display: flex !important;
}
.message.orchestrator-step .message-content {
  background: rgba(255, 255, 255, 0.06);
  border: 1px dashed rgba(255, 255, 255, 0.15);
  border-radius: 12px;
  font-size: 12px;
  color: var(--text-muted);
  padding: 10px 14px;
  font-family: 'JetBrains Mono', monospace;
  max-width: 95%;
}
.message.orchestrator-step .message-avatar {
  width: 28px;
  height: 28px;
  font-size: 12px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.06);
  border-color: rgba(255, 255, 255, 0.1);
}
.message.orchestrator-step .step-mode {
  color: var(--accent);
  font-weight: 600;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin-bottom: 4px;
  display: block;
}
.message.orchestrator-step .step-body {
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 200px;
  overflow-y: auto;
  display: block;
}
.message.orchestrator-step .step-body::-webkit-scrollbar { width: 4px; }
.message.orchestrator-step .step-body::-webkit-scrollbar-thumb { background: rgba(255, 255, 255, 0.15); border-radius: 2px; }
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
      flex-shrink: 0;
    }
    #clearChatBtn {
      margin-left: 8px;
    }
    .clear-chat-btn:hover {
      background: rgba(255, 255, 255, 0.2);
      color: var(--text-primary);
    }
    .clear-chat-btn:active {
      transform: scale(0.93);
    }
    .clear-chat-btn svg { width: 14px; height: 14px; }
    .clear-chat-btn.llm-glow {
      animation: llmGlow 0.6s ease-in-out 3;
      border-color: var(--accent);
      will-change: opacity;
    }
    @keyframes llmGlow {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.4; background: rgba(16, 185, 129, 0.25); }
    }

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

    /* Mobile root path - no prefix slash, styled as path */
    .mobile-root-path {
      font-size: 15px;
      font-weight: 500;
    }
    .mobile-root-path::before {
      content: '/';
      color: var(--text-muted);
    }

    /* ================================================================
       RECENT ROOTS DROPDOWN (Top-left overlay, doesn't push content)
       ================================================================ */
    .recent-roots-dropdown {
      position: absolute;
      top: calc(var(--header-height) + 6px);
      left: 16px;
      z-index: 50;
    }
    .recent-roots-dropdown.hidden {
      display: none;
    }
    
    .recent-roots-trigger {
      width: 28px;
      height: 28px;
      display: flex;
      align-items: center;
      justify-content: center;
      background: rgba(255, 255, 255, 0.12);
      border: 1px solid var(--glass-border-light);
      border-radius: 8px;
      cursor: pointer;
      transition: all var(--transition-fast);
      color: var(--text-muted);
    }
    .recent-roots-trigger:hover {
      background: rgba(255, 255, 255, 0.2);
      color: var(--text-primary);
    }
    .recent-roots-trigger:active {
      transform: scale(0.94);
    }
    .recent-roots-trigger svg {
      width: 14px;
      height: 14px;
      transition: transform 0.2s ease;
    }
    .recent-roots-dropdown.open .recent-roots-trigger svg {
      transform: rotate(180deg);
    }
    .recent-roots-dropdown.open .recent-roots-trigger {
      background: rgba(255, 255, 255, 0.2);
      color: var(--text-primary);
    }
    
    .recent-roots-menu {
      display: none;
      position: absolute;
      top: calc(100% + 6px);
      left: 0;
      min-width: 160px;
      max-width: 200px;
      background: rgba(var(--glass-rgb), 0.92);
      backdrop-filter: blur(var(--glass-blur)) saturate(140%);
      -webkit-backdrop-filter: blur(var(--glass-blur)) saturate(140%);
      border: 1px solid var(--glass-border);
      border-radius: 12px;
      padding: 6px;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
      animation: recentMenuIn 0.15s ease-out;
    }
    @keyframes recentMenuIn {
      from { opacity: 0; transform: translateY(-4px); }
      to { opacity: 1; transform: translateY(0); }
    }
    .recent-roots-dropdown.open .recent-roots-menu {
      display: block;
    }
    
    .recent-roots-menu-header {
      padding: 6px 10px 8px;
      font-size: 10px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: var(--text-muted);
      border-bottom: 1px solid var(--glass-border-light);
      margin-bottom: 4px;
    }
    
    .recent-root-item {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 10px;
      border-radius: 8px;
      cursor: pointer;
      transition: all var(--transition-fast);
      font-size: 12px;
      font-weight: 500;
      color: var(--text-secondary);
      border: none;
      background: none;
      width: 100%;
      text-align: left;
    }
    .recent-root-item:hover {
      background: rgba(255, 255, 255, 0.12);
      color: var(--text-primary);
    }
    .recent-root-item:active {
      background: rgba(255, 255, 255, 0.18);
      transform: scale(0.98);
    }
    .recent-root-item.active {
      background: rgba(16, 185, 129, 0.15);
      color: var(--text-primary);
      border-left: 2px solid var(--accent);
      padding-left: 8px;
    }
    .recent-root-name {
      flex: 1;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .chat-messages { flex: 1; overflow-y: auto; overflow-x: hidden; padding: 24px 20px; display: flex; flex-direction: column; gap: 16px; position: relative; z-index: 1; }
    .chat-messages::-webkit-scrollbar { width: 6px; }
    .chat-messages::-webkit-scrollbar-track { background: transparent; }
    .chat-messages::-webkit-scrollbar-thumb { background: rgba(255, 255, 255, 0.2); border-radius: 3px; }

    .welcome-message { text-align: center; padding: 40px 20px; }
    .welcome-message.disconnected { opacity: 0.7; }
    .welcome-message.disconnected .welcome-icon { filter: grayscale(0.5) drop-shadow(0 8px 32px rgba(0, 0, 0, 0.3)); animation: none; }
    .welcome-icon { font-size: 64px; margin-bottom: 20px; display: inline-block; filter: drop-shadow(0 8px 32px rgba(0, 0, 0, 0.3)); animation: floatIcon 3s ease-in-out infinite; }
    @keyframes floatIcon { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-10px); } }
    .welcome-message h2 { font-size: 24px; font-weight: 600; margin-bottom: 12px; }
    .welcome-message p { font-size: 15px; color: var(--text-secondary); line-height: 1.6; margin-bottom: 8px; }

    .message { display: flex; gap: 12px; animation: messageIn 0.3s ease-out; min-width: 0; max-width: 100%; }
    @keyframes messageIn { from { opacity: 0; transform: translateY(10px); } }
    .message.user { flex-direction: row-reverse; }
    .message-avatar { width: 36px; height: 36px; border-radius: 12px; background: rgba(255, 255, 255, 0.15); backdrop-filter: blur(10px); border: 1px solid var(--glass-border-light); display: flex; align-items: center; justify-content: center; font-size: 16px; flex-shrink: 0; }
    .message.user .message-avatar { background: rgba(125, 211, 133, 0.18); border-color: rgba(125, 211, 133, 0.4); }
    .message-content { max-width: 85%; min-width: 0; padding: 14px 18px; background: var(--bg-elevated); border: 1px solid var(--border); border-radius: 18px; font-size: 14px; line-height: 1.6; word-wrap: break-word; overflow-wrap: break-word; word-break: break-word; }
    .message.user .message-content { background: rgba(125, 211, 133, 0.08); border-color: rgba(125, 211, 133, 0.25); border-radius: 18px 18px 6px 18px; }
    .message.assistant .message-content { border-radius: 18px 18px 18px 6px; }
    .message.error .message-content { background: rgba(239, 68, 68, 0.3); border-color: rgba(239, 68, 68, 0.5); }

    /* Carried messages from previous mode - dimmed */
    .message.carried { opacity: 0.4; pointer-events: none; }
    .message.carried .message-content { border-style: dashed; }

    /* User message sent mid-stream — the stream extension merges it into
       the running turn rather than starting a new one. Chip explains this. */
    .message.user.merged .message-content { border-style: dashed; border-color: rgba(125, 211, 133, 0.45); }
    .user-merge-chip {
      display: inline-block;
      margin-top: 8px;
      padding: 2px 8px;
      font-size: 11px;
      color: rgba(125, 211, 133, 0.85);
      background: rgba(125, 211, 133, 0.08);
      border: 1px solid rgba(125, 211, 133, 0.25);
      border-radius: 999px;
      letter-spacing: 0.02em;
      cursor: help;
    }

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
    .typing-dot { width: 8px; height: 8px; background: #ffffff; border-radius: 50%; animation: typing 1.4s infinite; }
    .typing-dot:nth-child(2) { animation-delay: 0.2s; }
    .typing-dot:nth-child(3) { animation-delay: 0.4s; }
    @keyframes typing { 0%, 60%, 100% { transform: translateY(0); } 30% { transform: translateY(-8px); } }

    /* Live reasoning stream — same vocabulary the CLI renders. Each
       event is one compact row inserted between the user message and
       the typing indicator during processing. Lines stay in the
       transcript afterward so the user can scroll back through the
       trace. */
    .live-line {
      margin: 2px 0 2px 50px;
      padding: 2px 10px;
      font-size: 12px;
      line-height: 1.5;
      font-family: 'SF Mono', 'Fira Code', 'Consolas', monospace;
      color: rgba(255, 255, 255, 0.78);
      animation: liveIn 0.18s ease-out;
    }
    .live-line b { color: rgba(255, 255, 255, 0.95); font-weight: 600; }
    .live-dim { color: rgba(255, 255, 255, 0.5); }
    .live-ok { color: rgba(125, 220, 155, 0.95); font-weight: 700; }
    .live-fail { color: rgba(240, 130, 130, 0.95); font-weight: 700; }
    .live-fail-text { color: rgba(240, 130, 130, 0.85); }
    .live-dot { color: rgba(255, 255, 255, 0.45); }
    .live-tc-dot { color: rgba(255, 200, 100, 0.9); font-weight: 700; }
    .live-swarm { color: rgba(140, 180, 240, 0.95); font-weight: 700; }
    .live-branch { color: rgba(140, 180, 240, 0.95); font-weight: 700; }
    .live-scout { color: rgba(200, 160, 250, 0.95); font-weight: 700; }
    .live-scout-warn { color: rgba(255, 205, 120, 0.95); font-weight: 700; }
    .live-scout-route { color: rgba(140, 200, 255, 0.95); font-weight: 700; }
    .live-scout-redeploy { color: rgba(180, 230, 200, 0.95); font-weight: 700; }
    .live-line-scout-dispatch, .live-line-scout-report, .live-line-scout-route,
    .live-line-scout-redeploy, .live-line-scout-clean, .live-line-scout-reconciled { padding-left: 6px; }
    .live-line-scout-report { padding-left: 20px; }
    .live-line-intent { padding-left: 6px; }
    .live-line-intent b { color: rgba(160, 210, 255, 0.95); }
    .live-line-mode { padding-left: 6px; }
    .live-line-mode b { color: rgba(160, 210, 255, 0.95); }
    .live-line-thinking { color: rgba(210, 170, 255, 0.85); font-style: italic; }
    .live-line-tool-call, .live-line-tool-ok, .live-line-tool-fail { padding-left: 20px; }
    .live-line-branch-start, .live-line-branch-ok, .live-line-branch-fail { padding-left: 20px; }
    @keyframes liveIn { from { opacity: 0; transform: translateY(-2px); } to { opacity: 1; transform: translateY(0); } }

    /* Plan card for proposed / updated swarm plans. Larger than a
       one-liner because it lists branches and carries action buttons. */
    .live-line-plan-card { padding: 0; margin-top: 8px; margin-bottom: 8px; font-family: inherit; }
    .plan-card {
      background: rgba(140,180,240,0.08);
      border: 1px solid rgba(140,180,240,0.35);
      border-left: 3px solid rgba(140,180,240,0.85);
      border-radius: 10px;
      padding: 12px 16px;
      color: rgba(255,255,255,0.9);
    }
    .plan-card-head { font-size: 13px; margin-bottom: 6px; letter-spacing: 0.2px; }
    .plan-card-head b { font-weight: 700; }
    .plan-trigger { font-size: 11px; color: rgba(255,255,255,0.55); margin: 2px 0 8px 0; }
    .plan-branches { display: flex; flex-direction: column; gap: 4px; margin: 6px 0; }
    .plan-branch {
      font-family: 'SF Mono', 'Fira Code', 'Consolas', monospace;
      font-size: 11px;
      padding: 4px 8px;
      background: rgba(0,0,0,0.15);
      border-radius: 4px;
    }
    .plan-branch b { color: rgba(200,220,255,0.95); }
    .plan-branch .plan-path, .plan-branch .plan-mode, .plan-branch .plan-files {
      color: rgba(255,255,255,0.5);
      margin-left: 6px;
    }
    .plan-spec { color: rgba(255,255,255,0.75); margin-top: 3px; font-size: 11px; line-height: 1.5; font-family: inherit; }
    .plan-actions { display: flex; gap: 8px; margin-top: 10px; }
    .plan-btn {
      padding: 6px 14px;
      font-size: 12px;
      font-weight: 600;
      border: 1px solid rgba(255,255,255,0.25);
      border-radius: 6px;
      background: rgba(255,255,255,0.08);
      color: rgba(255,255,255,0.9);
      cursor: pointer;
      transition: all 0.15s;
    }
    .plan-btn:hover { background: rgba(255,255,255,0.15); border-color: rgba(255,255,255,0.45); }
    .plan-btn-accept { background: rgba(125,220,155,0.2); border-color: rgba(125,220,155,0.55); }
    .plan-btn-accept:hover { background: rgba(125,220,155,0.3); }
    .plan-btn-cancel { background: rgba(240,130,130,0.15); border-color: rgba(240,130,130,0.45); }
    .plan-btn-cancel:hover { background: rgba(240,130,130,0.25); }
    .plan-btn:disabled { cursor: default; opacity: 0.55; }
    .plan-btn:disabled:hover { background: rgba(255,255,255,0.08); border-color: rgba(255,255,255,0.25); }
    .plan-btn-chosen { opacity: 1 !important; border-color: rgba(255,255,255,0.6) !important; box-shadow: 0 0 0 1px rgba(255,255,255,0.15) inset; }
    .plan-btn-unchosen { opacity: 0.3 !important; }
    .plan-card-spent { opacity: 0.75; }
    .plan-card-spent .plan-hint { display: none; }
    .plan-hint { font-size: 10px; color: rgba(255,255,255,0.45); margin-top: 8px; font-style: italic; }
    .live-line-plan-archived { padding-left: 6px; font-size: 12px; }

    .chat-input-area { padding: 16px 20px 20px; border-top: 1px solid var(--glass-border-light); position: relative; z-index: 1; }
    .input-container { display: flex; align-items: flex-end; gap: 12px; padding: 14px 18px; background: rgba(255, 255, 255, 0.15); backdrop-filter: blur(10px); border: 1px solid var(--glass-border-light); border-radius: 18px; transition: all var(--transition-fast); }
    .input-container:focus-within { background: rgba(255, 255, 255, 0.2); border-color: rgba(255, 255, 255, 0.4); box-shadow: 0 0 0 4px rgba(255, 255, 255, 0.1); }
    .chat-input { flex: 1; min-width: 0; background: transparent; border: none; outline: none; font-family: inherit; font-size: 15px; color: var(--text-primary); resize: none; max-height: 120px; line-height: 1.5; }
    .chat-input::placeholder { color: var(--text-muted); }
    .chat-input:disabled { opacity: 0.5; cursor: not-allowed; }
    .send-btn { width: 40px; height: 40px; display: flex; align-items: center; justify-content: center; background: var(--accent); border: none; border-radius: 12px; color: white; cursor: pointer; transition: all var(--transition-fast); flex-shrink: 0; box-shadow: 0 4px 15px var(--accent-glow); }
    .send-btn:hover:not(:disabled) { transform: scale(1.08); box-shadow: 0 6px 25px var(--accent-glow); }
    .send-btn:disabled { opacity: 0.4; cursor: not-allowed; }
    .send-btn svg { width: 20px; height: 20px; }

    .viewport-panel { flex: 1; height: 100%; display: flex; flex-direction: column; min-width: 0; position: relative; }

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

    .loading-overlay { position: absolute; inset: 0; background: rgba(var(--glass-rgb), 0.8); backdrop-filter: blur(10px); display: flex; align-items: center; justify-content: center; opacity: 0; pointer-events: none; transition: opacity var(--transition-fast); z-index: 5; border-radius: 0; }
    .loading-overlay.visible { opacity: 1; pointer-events: auto; }
    .spinner-ring { width: 44px; height: 44px; border: 3px solid rgba(255, 255, 255, 0.2); border-top-color: white; border-radius: 50%; animation: spin 0.8s linear infinite; }
    @keyframes spin { to { transform: rotate(360deg); } }
    .loading-text { font-size: 14px; font-weight: 500; color: var(--text-secondary); margin-top: 16px; }

    .navigator-indicator {
      display: none;
      align-items: center;
      justify-content: flex-end;
      gap: 4px;
      padding: 2px 8px 4px;
    }
    .navigator-indicator.active { display: flex; }
    .navigator-indicator.desktop-only { }
    .navigator-indicator.mobile-only {
      position: fixed;
      top: 8px;
      right: 8px;
      z-index: 200;
      padding: 0;
    }
    @media (max-width: 768px) {
      .navigator-indicator.desktop-only { display: none !important; }
    }
    @media (min-width: 769px) {
      .navigator-indicator.mobile-only { display: none !important; }
    }
    /* ── Dashboard toggle (chat panel) ─────────────────────────────── */
    .chat-dashboard-btn {
      display: flex;
      align-items: center;
      justify-content: flex-end;
      gap: 4px;
      padding: 2px 8px 4px;
    }
    .chat-dashboard-badge {
      display: flex;
      align-items: center;
      gap: 5px;
      padding: 3px 8px;
      background: rgba(59, 130, 246, 0.12);
      border: 1px solid rgba(59, 130, 246, 0.25);
      border-radius: 6px;
      cursor: pointer;
      transition: all 0.15s;
      font-size: 10px;
      color: rgba(147, 197, 253, 0.9);
      white-space: nowrap;
    }
    .chat-dashboard-badge:hover { background: rgba(59, 130, 246, 0.22); color: #93c5fd; }
    .chat-dashboard-badge.active { background: rgba(16,185,129,0.15); border-color: rgba(16,185,129,0.35); color: var(--accent); }
    .chat-dashboard-badge svg { width: 12px; height: 12px; flex-shrink: 0; }
    .chat-dashboard-badge .dash-btn-label {
      max-width: 0;
      overflow: hidden;
      transition: max-width 0.25s ease, opacity 0.2s;
      opacity: 0;
    }
    .chat-dashboard-badge:hover .dash-btn-label { max-width: 80px; opacity: 1; }
    @media (max-width: 768px) {
      .chat-dashboard-btn { display: none; }
    }
    .navigator-badge {
      display: flex;
      flex-direction: row-reverse;
      align-items: center;
      gap: 4px;
      padding: 3px 6px;
      background: rgba(var(--glass-rgb), 0.4);
      border: 1px solid var(--glass-border);
      border-radius: 6px;
      cursor: default;
      transition: background 0.2s;
    }
    .navigator-badge:hover { background: rgba(var(--glass-rgb), 0.7); }
    .navigator-badge .nav-icon {
      width: 14px;
      height: 14px;
      color: var(--accent);
      flex-shrink: 0;
    }
    .navigator-badge .nav-label {
      font-size: 10px;
      color: var(--text-secondary);
      white-space: nowrap;
      max-width: 0;
      overflow: hidden;
      transition: max-width 0.3s ease, opacity 0.2s;
      opacity: 0;
    }
    .navigator-badge .nav-close-icon {
      width: 12px;
      height: 12px;
      max-width: 0;
      overflow: hidden;
      opacity: 0;
      flex-shrink: 0;
      transition: max-width 0.3s ease, opacity 0.2s;
    }
    /* Reveal: just expand to show label (no red, no X) */
    .navigator-badge.reveal .nav-label { max-width: 160px; opacity: 1; }
    /* Hover: expand all, turn red, show X */
    .navigator-badge:hover .nav-label { max-width: 160px; opacity: 1; }
    .navigator-badge:hover .nav-close-icon { max-width: 16px; opacity: 1; }
    .navigator-badge:hover {
      background: rgba(239, 68, 68, 0.15);
      border-color: rgba(239, 68, 68, 0.3);
      cursor: pointer;
    }
    .navigator-badge:hover .nav-icon { color: #ef4444; }
    .navigator-badge:hover .nav-label { color: #ef4444; }
    .navigator-badge:hover .nav-close-icon { color: #ef4444; }

    /* Welcome/background message toggle */
    .welcome-toggle {
      display: flex;
      align-items: center;
      justify-content: flex-end;
      padding: 2px 8px 4px;
    }
    .welcome-toggle-btn {
      display: flex;
      align-items: center;
      gap: 5px;
      padding: 3px 8px;
      background: rgba(255,255,255,0.06);
      border: 1px solid rgba(255,255,255,0.1);
      border-radius: 6px;
      cursor: pointer;
      transition: all 0.15s;
      font-size: 10px;
      color: var(--text-muted);
      white-space: nowrap;
    }
    .welcome-toggle-btn:hover { background: rgba(255,255,255,0.1); color: var(--text-secondary); }
    .welcome-toggle-btn.active { background: rgba(16,185,129,0.12); border-color: rgba(16,185,129,0.25); color: var(--accent); }
    .welcome-toggle-btn svg { width: 12px; height: 12px; flex-shrink: 0; }
    @media (max-width: 768px) {
      .welcome-toggle { display: none; }
    }

    .panel-divider { width: 16px; height: 100%; display: flex; align-items: center; justify-content: center; cursor: col-resize; position: relative; z-index: 20; flex-shrink: 0; }
    .divider-handle { width: 6px; height: 80px; background: rgba(var(--glass-rgb), 0.5); backdrop-filter: blur(var(--glass-blur)); border: 1px solid var(--glass-border); border-radius: 4px; transition: all var(--transition-fast); }
    .panel-divider:hover .divider-handle { background: rgba(var(--glass-rgb), 0.7); width: 8px; }
    .chat-header,
    .chat-input-area {
      border-bottom: none;
      border-top: none;
    }
    .expand-buttons { position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); display: flex; flex-direction: column; gap: 8px; opacity: 0; pointer-events: none; transition: opacity var(--transition-fast); }
    .panel-divider:hover .expand-buttons { opacity: 1; pointer-events: auto; }
    .panel-divider:hover .divider-handle { opacity: 0; }
    .expand-btn { width: 32px; height: 32px; display: flex; align-items: center; justify-content: center; background: rgba(var(--glass-rgb), 0.8); backdrop-filter: blur(var(--glass-blur)); border: 1px solid var(--glass-border); border-radius: 8px; color: var(--text-secondary); cursor: pointer; transition: all var(--transition-fast); }
    .expand-btn:hover { background: rgba(255, 255, 255, 0.25); color: var(--text-primary); transform: scale(1.1); }
    .expand-btn svg { width: 16px; height: 16px; }

    /* Collapsed chat tab - visible by default on mobile */
    .mobile-chat-tab {
      display: none;
      position: fixed;
      bottom: calc(100px + env(safe-area-inset-bottom, 0px));
      right: 0;
      z-index: 150;
      width: 32px;
      height: 56px;
      background: rgba(255, 255, 255, 0.12);
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
      border: 1px solid rgba(255, 255, 255, 0.15);
      border-right: none;
      border-radius: 12px 0 0 12px;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      transition: all 0.2s ease;
      box-shadow: -2px 0 12px rgba(0, 0, 0, 0.1);
      font-size: 18px;
    }
    .mobile-chat-tab:active {
      width: 38px;
      background: rgba(255, 255, 255, 0.2);
    }

    /* Mobile connection status indicator - inside sheet header */
    .mobile-status-indicator {
      display: none;
      width: 6px;
      height: 6px;
      border-radius: 50%;
      flex-shrink: 0;
    }
    .mobile-status-indicator.connected {
      background: var(--accent);
      box-shadow: 0 0 6px var(--accent-glow);
      animation: pulse 2s ease-in-out infinite;
    }
    .mobile-status-indicator.disconnected {
      background: var(--error);
      animation: none;
    }
    .mobile-status-indicator.connecting {
      background: #f59e0b;
      animation: pulse 1s ease-in-out infinite;
    }

    /* Tree icon with status dot wrapper */
    .mobile-tree-icon-wrapper {
      position: relative;
      display: flex;
      align-items: center;
      justify-content: center;
      text-decoration: none;
      transition: transform 0.15s ease;
    }
    .mobile-tree-icon-wrapper:active {
      transform: scale(0.92);
    }
    .mobile-tree-icon-wrapper .mobile-status-indicator {
      display: block;
      position: absolute;
      top: 0;
      left: 0;
    }
    .mobile-tree-icon-wrapper .tree-icon {
      font-size: 24px;
      text-shadow: none;
      filter: none;
    }

    /* Mobile header action buttons */
    .mobile-header-actions {
      display: flex;
      align-items: center;
      gap: 2px;
    }
    .mobile-header-actions .mobile-close-btn {
      margin-left: 10px;
    }
    .mobile-header-actions .clear-chat-btn {
      background: rgba(255, 255, 255, 0.08);
      border-color: rgba(255, 255, 255, 0.12);
    }
    .mobile-header-actions .clear-chat-btn:active {
      background: rgba(255, 255, 255, 0.15);
    }
    .mobile-header-actions .mobile-dash-btn {
      background: rgba(59, 130, 246, 0.15);
      border-color: rgba(59, 130, 246, 0.3);
      color: rgba(147, 197, 253, 0.9);
    }
    .mobile-header-actions .mobile-dash-btn:active {
      background: rgba(59, 130, 246, 0.28);
    }
    .mobile-header-actions .mobile-dash-btn.active {
      background: rgba(16, 185, 129, 0.2);
      border-color: rgba(16, 185, 129, 0.35);
      color: var(--accent);
    }

    .mobile-chat-sheet {
      display: none;
      position: fixed;
      bottom: 0;
      left: 0;
      right: 0;
      height: 85vh;
      max-height: calc(100vh - 40px);
      z-index: 200;
      background: rgba(var(--glass-rgb), 0.22);
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
      border-top-left-radius: 24px;
      border-top-right-radius: 24px;
      border: 1px solid rgba(255, 255, 255, 0.18);
      border-bottom: none;
      box-shadow: 0 -15px 50px rgba(0, 0, 0, 0.15), inset 0 1px 0 rgba(255, 255, 255, 0.25);
      transform: translateY(100%);
      flex-direction: column;
      will-change: transform;
    }
    .mobile-chat-sheet.open { 
      transform: translateY(0); 
      transition: transform 0.4s cubic-bezier(0.32, 0.72, 0, 1);
    }
    .mobile-chat-sheet.peeked {
      transform: translateY(calc(100% - 90px));
      transition: transform 0.3s cubic-bezier(0.32, 0.72, 0, 1);
    }
    .mobile-chat-sheet.peeked .mobile-chat-messages,
    .mobile-chat-sheet.peeked .mobile-chat-input-area,
    .mobile-chat-sheet.peeked .mobile-recent-roots,
    .mobile-chat-sheet.peeked .mobile-mode-bar {
      display: none;
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
      border-bottom: 1px solid rgba(255, 255, 255, 0.1);
      flex-shrink: 0;
      cursor: grab;
      touch-action: none;
      background: rgba(255, 255, 255, 0.03);
      user-select: none;
      position: relative;
    }
    .mobile-sheet-header h1,
    .mobile-sheet-header .root-name-inline {
      text-shadow: 0 1px 2px rgba(0, 0, 0, 0.25);
    }
    .mobile-sheet-header:active { cursor: grabbing; }
    .mobile-sheet-header .drag-handle { 
      width: 36px; 
      height: 4px; 
      background: rgba(255, 255, 255, 0.2); 
      border-radius: 2px; 
      margin-bottom: 10px;
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
      background: rgba(255, 255, 255, 0.08); 
      border: 1px solid rgba(255, 255, 255, 0.12); 
      border-radius: 50%; 
      color: var(--text-primary); 
      cursor: pointer;
      transition: all 0.15s ease;
    }
    .mobile-close-btn:active {
      background: rgba(255, 255, 255, 0.15);
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
    
    /* Glass-printed text style for mobile */
    .mobile-chat-messages .message-content {
      background: rgba(255, 255, 255, 0.1);
      border: 1px solid rgba(255, 255, 255, 0.12);
      color: #fff;
      text-shadow: 0 1px 2px rgba(0, 0, 0, 0.25);
    }
    .mobile-chat-messages .message.user .message-content {
      background: rgba(255, 255, 255, 0.14);
      border-color: rgba(255, 255, 255, 0.18);
    }
    .mobile-chat-messages .message-avatar {
      background: rgba(255, 255, 255, 0.1);
      border-color: rgba(255, 255, 255, 0.12);
    }
    .mobile-chat-messages .welcome-message {
      text-shadow: 0 2px 4px rgba(0, 0, 0, 0.25);
    }

    .mobile-chat-input-area {
      padding: 14px 16px;
      padding-bottom: calc(20px + env(safe-area-inset-bottom, 0px));
      border-top: 1px solid rgba(255, 255, 255, 0.1);
      flex-shrink: 0;
      background: transparent;
    }
    .mobile-chat-input-area .input-container { 
      padding: 14px 18px; 
      border-radius: 26px;
      background: rgba(255, 255, 255, 0.12);
      backdrop-filter: blur(6px);
      border: 1px solid rgba(255, 255, 255, 0.12);
      min-height: 52px;
    }
    .mobile-chat-input-area .input-container:focus-within {
      background: rgba(255, 255, 255, 0.16);
      border-color: rgba(255, 255, 255, 0.25);
    }
    .mobile-chat-input-area .chat-input { font-size: 16px; }
    .mobile-chat-input-area .send-btn { 
      width: 42px; 
      height: 42px; 
      border-radius: 14px;
      box-shadow: none;
    }
    .mobile-chat-input-area .send-btn:hover:not(:disabled) {
      box-shadow: none;
    }

    .mobile-backdrop {
      display: none;
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.1);
      z-index: 190;
      opacity: 0;
      transition: opacity 0.3s ease;
      pointer-events: none;
    }
    .mobile-backdrop.visible { opacity: 1; pointer-events: auto; }

    /* Mobile recent roots dropdown */
    .mobile-recent-roots {
      display: none;
      width: 100%;
      margin-top: 6px;
    }
    .mobile-recent-roots.visible {
      display: block;
    }
    .mobile-recent-roots-toggle {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 4px;
      padding: 4px 10px;
      background: rgba(255, 255, 255, 0.08);
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 14px;
      font-size: 11px;
      font-weight: 500;
      color: var(--text-muted);
      cursor: pointer;
      margin: 0 auto;
      transition: all var(--transition-fast);
    }
    .mobile-recent-roots-toggle:active {
      background: rgba(255, 255, 255, 0.15);
      transform: scale(0.97);
    }
    .mobile-recent-roots-toggle svg {
      width: 10px;
      height: 10px;
      transition: transform 0.2s ease;
    }
    .mobile-recent-roots.expanded .mobile-recent-roots-toggle svg {
      transform: rotate(180deg);
    }
    .mobile-recent-roots-list {
      display: none;
      flex-direction: row;
      flex-wrap: wrap;
      gap: 4px;
      margin-top: 6px;
      padding: 0 4px;
      justify-content: center;
    }
    .mobile-recent-roots.expanded .mobile-recent-roots-list {
      display: flex;
    }
    .mobile-recent-roots-list .recent-root-item {
      background: rgba(255, 255, 255, 0.06);
      font-size: 11px;
      padding: 5px 10px;
      border-radius: 12px;
      width: auto;
      flex: 0 0 auto;
    }

    @media (max-width: 768px) {
      .app-container { padding: 0; gap: 0; flex-direction: column; }
      .chat-panel { display: none !important; }
      .viewport-panel { width: 100% !important; height: 100%; }
      .viewport-panel.glass-panel { border-radius: 0; }
      .iframe-container { border-radius: 0; margin: 0; flex: 1; }
      iframe, .loading-overlay { border-radius: 0; }
      .panel-divider { display: none; }
      .mobile-chat-sheet, .mobile-backdrop { display: block; }
      .mobile-chat-sheet { display: flex; }
      .mobile-chat-tab { display: flex; }
      .mobile-chat-tab.hidden { display: none; }
      
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
       Mode bar styles
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
      position: relative;
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
      bottom: calc(100% + 8px);
      left: 0;
      min-width: 180px;
      max-width: 280px;
      max-height: 60vh;
      overflow-y: auto;
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
      bottom: 165px;
      left: 10px;
      z-index: 9999;
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 7px 14px;
      background: rgba(var(--glass-rgb), 0.85);
      backdrop-filter: blur(var(--glass-blur));
      -webkit-backdrop-filter: blur(var(--glass-blur));
      border: 1px solid var(--glass-border);
      border-radius: 10px;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
      font-size: 12px;
      font-weight: 600;
      color: var(--text-primary);
      pointer-events: none;
      opacity: 0;
      transform: translateY(10px);
      transition: opacity 0.25s ease, transform 0.25s ease;
    }
    .mode-alert.visible {
      opacity: 1;
      transform: translateY(0);
    }
    .mode-alert-emoji {
      font-size: 14px;
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
      scroll-behavior: smooth;
    }
    .mobile-mode-bar::-webkit-scrollbar { display: none; }

    .mobile-mode-btn {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 6px 12px;
      background: rgba(255, 255, 255, 0.08);
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 20px;
      font-size: 12px;
      font-weight: 600;
      color: var(--text-primary);
      cursor: pointer;
      white-space: nowrap;
      flex-shrink: 0;
      transition: all var(--transition-fast);
      text-shadow: 0 1px 2px rgba(0, 0, 0, 0.2);
    }
    .mobile-mode-btn:active {
      transform: scale(0.95);
    }
    .mobile-mode-btn.active {
      background: rgba(16, 185, 129, 0.2);
      border-color: rgba(16, 185, 129, 0.3);
      color: var(--text-primary);
    }
    .mobile-mode-btn-emoji {
      font-size: 14px;
    }

    @media (max-width: 768px) {
      .mode-alert {
        top: 10px;
        bottom: auto;
        left: 50%;
        transform: translateX(-50%) translateY(-10px);
      }
      .mode-alert.visible {
        transform: translateX(-50%) translateY(0);
      }
    }
    ${dashboardCSS()}
  </style>
</head>
<body>
  <div class="app-bg"></div>

  <!-- Mode alert toast -->
  <div class="mode-alert" id="modeAlert">
    <span class="mode-alert-emoji" id="modeAlertEmoji"></span>
    <span id="modeAlertText"></span>
  </div>

  <!-- Navigator indicator (mobile: fixed top-right) -->
  <div class="navigator-indicator mobile-only" id="navigatorIndicatorMobile">
    <div class="navigator-badge" id="navigatorBadgeMobile" title="Detach session navigator">
      <svg class="nav-close-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      <span class="nav-label" id="navigatorLabelMobile">session</span>
      <svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>
    </div>
  </div>

  <div class="app-container">
    <!-- Chat Panel -->
    <div class="chat-panel glass-panel" id="chatPanel">
      <div class="chat-header">
        <a href="/app" class="tree-home-link">
          <div class="chat-title">
            <span class="tree-icon">🌳</span>
            <h1>${landName}</h1>
          </div>
        </a>
        <span class="root-name-inline" id="rootNameLabel" title=""></span>

        <div class="chat-header-controls">
          <div class="chat-header-buttons">
            <button class="clear-chat-btn" id="desktopHomeBtn" title="Home">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
            </button>
            <button class="clear-chat-btn" id="desktopRefreshBtn" title="Refresh">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 4v6h-6M1 20v-6h6"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
            </button>
            <button class="clear-chat-btn" id="desktopOpenTabBtn" title="Open in new tab">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
            </button>
            <button class="clear-chat-btn" id="desktopCustomAiBtn" title="LLM Connections">🤖</button>
          </div>
          <div class="chat-header-right">
            <div class="status-badge">
              <span class="status-dot connecting" id="statusDot"></span>
              <span class="status-text" id="statusText">Connecting...</span>
            </div>
            <button class="clear-chat-btn" id="clearChatBtn" title="Clear conversation">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
            </button>
          </div>
        </div>
      </div>

      <!-- Session manager toggle (desktop: row above navigator) -->
      <div class="chat-dashboard-btn" id="desktopDashboardRow">
        <div class="chat-dashboard-badge" id="desktopDashboardBtn" title="Session Manager">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="9" rx="1"/><rect x="14" y="3" width="7" height="5" rx="1"/><rect x="14" y="12" width="7" height="9" rx="1"/><rect x="3" y="16" width="7" height="5" rx="1"/></svg>
          <span class="dash-btn-label">Sessions</span>
        </div>
      </div>

      <!-- Navigator indicator (desktop: row below session manager) -->
      <div class="navigator-indicator desktop-only" id="navigatorIndicatorDesktop">
        <div class="navigator-badge" id="navigatorBadgeDesktop" title="Detach session navigator">
          <svg class="nav-close-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          <span class="nav-label" id="navigatorLabelDesktop">session</span>
          <svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>
        </div>
      </div>

      <!-- Background messages toggle -->
      <div class="welcome-toggle">
        <button class="welcome-toggle-btn" id="bgMsgToggleBtn" title="Show background system messages">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
          <span>System</span>
        </button>
      </div>

      <!-- Recent Roots Dropdown (absolute positioned, top-left overlay) -->
      <div class="recent-roots-dropdown hidden" id="recentRootsDropdown">
        <div class="recent-roots-trigger" id="recentRootsTrigger">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M6 9l6 6 6-6"/></svg>
        </div>
        <div class="recent-roots-menu" id="recentRootsMenu">
          <div class="recent-roots-menu-header">Recent Trees</div>
          <div id="recentRootsList"></div>
        </div>
      </div>

      <div class="chat-messages" id="chatMessages">
        <div class="welcome-message">
          <div class="welcome-icon">🌳</div>
          <h2>Welcome</h2>
          <p>Just type. Say hello, ask a question, or tell it something. Natural language works.</p>
          <p style="margin-top:8px;font-size:13px;color:var(--text-tertiary);">You can also connect via CLI: <code style="background:rgba(255,255,255,0.06);padding:2px 6px;border-radius:4px;">npm i -g treeos</code></p>
        </div>
      </div>

      <!-- Desktop mode bar (above input) -->
      <div class="mode-bar" id="modeBar">
        <div class="mode-current" id="modeCurrent">
          <span class="mode-current-emoji" id="modeCurrentEmoji">🏠</span>
          <span class="mode-current-label" id="modeCurrentLabel">Home</span>
          <svg class="mode-current-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M6 15l6-6 6 6"/></svg>
          <div class="mode-dropdown" id="modeDropdown"></div>
        </div>
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
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 5l7 7-7 7"/><path d="M5 5l7 7-7 7"/></svg>
        </button>
        <button class="expand-btn" id="resetPanelsBtn" title="Reset">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="18" rx="1"/><rect x="14" y="3" width="7" height="18" rx="1"/></svg>
        </button>
        <button class="expand-btn" id="expandViewportBtn" title="Expand viewport">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 19l-7-7 7-7"/><path d="M19 19l-7-7 7-7"/></svg>
        </button>
      </div>
    </div>

    <!-- Viewport Panel -->
    <div class="viewport-panel glass-panel" id="viewportPanel">
      ${dashboardHTML()}
      <div class="iframe-container" id="iframeContainer">
        <div class="loading-overlay" id="loadingOverlay">
          <div class="loading-spinner">
            <div class="spinner-ring"></div>
            <span class="loading-text">Loading...</span>
          </div>
        </div>
        <iframe id="viewport" src="${req.query.rootId && UUID_RE.test(req.query.rootId) ? `/api/v1/root/${req.query.rootId}?html&token=${encodeURIComponent(htmlShareToken)}&inApp=1` : `/api/v1/user/${req.userId}?html&token=${encodeURIComponent(htmlShareToken)}&inApp=1`}" sandbox="allow-same-origin allow-scripts allow-forms allow-popups allow-modals allow-downloads allow-top-navigation-by-user-activation allow-top-navigation"></iframe>
      </div>
    </div>
  </div>

  <!-- Collapsed chat tab -->
  <div class="mobile-chat-tab" id="mobileChatTab">🌳</div>

  <div class="mobile-backdrop" id="mobileBackdrop"></div>

  <div class="mobile-chat-sheet" id="mobileChatSheet">
    <div class="mobile-sheet-header" id="mobileSheetHeader">
      <div class="drag-handle"></div>
      <div class="mobile-sheet-title-row">
        <div class="mobile-sheet-title">
          <a href="/app" class="mobile-tree-icon-wrapper" title="Back to ${landName}">
            <div class="mobile-status-indicator connecting" id="mobileStatusIndicator"></div>
            <span class="tree-icon">🌳</span>
          </a>
          <span class="root-name-inline mobile-root-path" id="mobileRootNameLabel" title=""></span>
        </div>
        <div class="mobile-header-actions">
          <button class="clear-chat-btn mobile-dash-btn" id="mobileDashboardBtn" title="Session Manager">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="9" rx="1"/><rect x="14" y="3" width="7" height="5" rx="1"/><rect x="14" y="12" width="7" height="9" rx="1"/><rect x="3" y="16" width="7" height="5" rx="1"/></svg>
          </button>
          <button class="clear-chat-btn" id="mobileHomeBtn" title="Home">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
          </button>
          <button class="clear-chat-btn" id="mobileRefreshBtn" title="Refresh">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 4v6h-6M1 20v-6h6"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
          </button>
          <button class="clear-chat-btn" id="mobileClearChatBtn" title="Clear conversation">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
          </button>
          <button class="clear-chat-btn" id="mobileCustomAiBtn" title="LLM Connections">🤖</button>
          <button class="mobile-close-btn" id="mobileCloseBtn">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
          </button>
        </div>
      </div>
      <!-- Mobile mode bar (horizontal pill row) -->
      <div class="mobile-mode-bar" id="mobileModeBar"></div>
      <!-- Mobile recent roots dropdown -->
      <div class="mobile-recent-roots" id="mobileRecentRoots">
        <div class="mobile-recent-roots-toggle" id="mobileRecentRootsToggle">
          <span>Recent Trees</span>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M6 9l6 6 6-6"/></svg>
        </div>
        <div class="mobile-recent-roots-list" id="mobileRecentRootsList"></div>
      </div>
    </div>
    <div class="mobile-chat-messages" id="mobileChatMessages">
      <div class="welcome-message">
        <div class="welcome-icon">🌳</div>
        <h2>Welcome</h2>
        <p>Just type. Say hello, ask a question, or tell it something.</p>
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
      userId: "${esc(req.userId)}",
      username: ${JSON.stringify(username || req.userId || "")},
      htmlShareToken: "${esc(htmlShareToken)}",
      homeUrl: "/api/v1/user/${esc(req.userId)}?html&token=${encodeURIComponent(htmlShareToken)}&inApp=1",
      hasLlm: ${!!hasLlm},
      landName: ${JSON.stringify(landName || "")},
    };

    // Elements
    const $ = (id) => document.getElementById(id);
    const chatMessages = $("chatMessages");
    const chatInput = $("chatInput");
    const sendBtn = $("sendBtn");
    const statusDot = $("statusDot");
    const statusText = $("statusText");
    const mobileStatusIndicator = $("mobileStatusIndicator");
    const iframe = $("viewport");
    const loadingOverlay = $("loadingOverlay");
    const mobileChatMessages = $("mobileChatMessages");
    const mobileSheetInput = $("mobileSheetInput");
    const mobileSheetSendBtn = $("mobileSheetSendBtn");
    const mobileChatSheet = $("mobileChatSheet");
    const mobileBackdrop = $("mobileBackdrop");
    const mobileSheetHeader = $("mobileSheetHeader");
    const mobileChatTab = $("mobileChatTab");

    // Recent roots elements
    const recentRootsDropdown = $("recentRootsDropdown");
    const recentRootsTrigger = $("recentRootsTrigger");
    const recentRootsList = $("recentRootsList");
    const mobileRecentRoots = $("mobileRecentRoots");
    const mobileRecentRootsToggle = $("mobileRecentRootsToggle");
    const mobileRecentRootsList = $("mobileRecentRootsList");

    // State
    let isConnected = false;
    let isRegistered = false;
    let isSending = false;
    let currentIframeUrl = CONFIG.homeUrl;

    // Mobile sheet state: 'closed' | 'peeked' | 'open'
    let mobileSheetState = 'closed';

    // Mode state
    let currentModeKey = null;
    let availableModes = [];
    let modeBarOpen = false;
    let requestGeneration = 0;

    // Recent roots state
    let recentRoots = [];
    let recentRootsOpen = false;
    let mobileRecentRootsExpanded = false;
// Build iframe URL — always injects inApp, token, and rootId when available
function buildIframeUrl(raw) {
  try {
    const base = raw.startsWith('http') ? raw : new URL(raw, window.location.origin).href;
    const u = new URL(base);
    if (!u.searchParams.has('inApp'))  u.searchParams.set('inApp', '1');
    if (!u.searchParams.has('token'))  u.searchParams.set('token', CONFIG.htmlShareToken);
    const rootId = getCurrentRootId();
    if (rootId && !u.pathname.includes('/root/')) {
      u.searchParams.set('rootId', rootId);
    } else {
      u.searchParams.delete('rootId');
    }
    return u.pathname + u.search;
  } catch (e) {
    return raw;
  }
}
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
        let currentUrl = "";
        try { currentUrl = iframe.contentWindow?.location?.pathname + iframe.contentWindow?.location?.search; } catch(e) {}
        if (!currentUrl) {
          try { const u = new URL(iframe.src); currentUrl = u.pathname + u.search; } catch(e) {}
        }
        if (!currentUrl) {
          currentUrl = currentIframeUrl || "";
        }
        socket.emit("getAvailableModes", { url: currentUrl });
        socket.emit("getRecentRoots");
        if (currentUrl) detectIframeUrlChange();
      } else {
        console.error("[socket] registration failed:", error);
        updateStatus("connected");
        addMessage("Chat registration failed: " + (error || "Unknown error") + ". You can still browse your tree.", "error");
      }
    });

    socket.on("chatResponse", ({ answer, generation }) => {
      if (generation !== undefined && generation < requestGeneration) {
        console.log("[socket] dropping stale response, gen:", generation, "current:", requestGeneration);
        return;
      }
      removeTypingIndicator();
      addMessage(answer, "assistant");
      isSending = false;
      updateSendButtons();
      lockModeBar(false);
      // Refresh iframe content after AI response (data may have changed)
      try { iframe.contentWindow?.location.reload(); } catch(e) {}
    });

    socket.on("chatError", ({ error, generation }) => {
      if (generation !== undefined && generation < requestGeneration) return;
      removeTypingIndicator();
      addMessage("Error: " + error, "error");
      isSending = false;
      updateSendButtons();
      lockModeBar(false);

      // Glow the LLM button after a delay so they read the error first
      if (error && (error.includes("/setup") || error.includes("LLM connection"))) {
        setTimeout(function() {
          var glowBtns = [$("desktopCustomAiBtn"), $("mobileCustomAiBtn")];
          glowBtns.forEach(function(btn) {
            if (!btn) return;
            btn.classList.remove("llm-glow");
            void btn.offsetWidth;
            btn.classList.add("llm-glow");
            btn.addEventListener("animationend", function() { btn.classList.remove("llm-glow"); }, { once: true });
          });
        }, 2500);
      }
    });

    // Session killed from session manager while chat was in-flight
    socket.on("chatCancelled", () => {
      if (isSending) {
        removeTypingIndicator();
        isSending = false;
        lockModeBar(false);
        updateSendButtons();
      }
    });

socket.on("navigate", ({ url, replace }) => {
    console.log("[socket] navigate:", url);
    loadingOverlay.classList.add("visible");
    currentIframeUrl = url;
    let navUrl = buildIframeUrl(url);
    if (replace) {
      iframe.contentWindow?.location.replace(navUrl);
    } else {
      iframe.src = navUrl;
    }
  });

    // ── Navigator session indicator ──────────────────────────────────
    const navIndicators = [
      document.getElementById("navigatorIndicatorDesktop"),
      document.getElementById("navigatorIndicatorMobile"),
    ];
    const navBadges = [
      document.getElementById("navigatorBadgeDesktop"),
      document.getElementById("navigatorBadgeMobile"),
    ];
    const navLabels = [
      document.getElementById("navigatorLabelDesktop"),
      document.getElementById("navigatorLabelMobile"),
    ];

    const sessionTypeLabels = {
      "websocket-chat": "chat",
      "api-tree-chat": "api chat",
      "api-tree-place": "api place",
      "raw-idea-orchestrate": "raw idea",
      "raw-idea-chat": "raw idea chat",
      "understanding-orchestrate": "understand",
      "scheduled-raw-idea": "scheduled",
    };

    let navFlashTimer = null;
    let currentNavSessionId = null;
    socket.on("navigatorSession", (data) => {
      if (data && data.sessionId) {
        const label = sessionTypeLabels[data.type] || data.type || "session";
        navLabels.forEach(el => { if (el) el.textContent = label; });
        navIndicators.forEach(el => { if (el) el.classList.add("active"); });
        // Only reveal when navigator actually changes (new session or added from nothing)
        if (data.sessionId !== currentNavSessionId) {
          currentNavSessionId = data.sessionId;
          navBadges.forEach(el => { if (el) el.classList.add("reveal"); });
          if (navFlashTimer) clearTimeout(navFlashTimer);
          navFlashTimer = setTimeout(() => {
            navBadges.forEach(el => { if (el) el.classList.remove("reveal"); });
          }, 3000);
        }
      } else {
        currentNavSessionId = null;
        navIndicators.forEach(el => { if (el) el.classList.remove("active"); });
        navBadges.forEach(el => { if (el) el.classList.remove("reveal"); });
        if (navFlashTimer) clearTimeout(navFlashTimer);
      }
    });

    document.getElementById("navigatorBadgeDesktop").addEventListener("click", () => {
      socket.emit("detachNavigator");
    });

    // Mobile: first tap expands, second tap (when expanded) detaches
    let mobileNavExpanded = false;
    let mobileNavCollapseTimer = null;
    document.getElementById("navigatorBadgeMobile").addEventListener("click", () => {
      const badge = document.getElementById("navigatorBadgeMobile");
      if (mobileNavExpanded) {
        // Already expanded — detach
        mobileNavExpanded = false;
        if (mobileNavCollapseTimer) clearTimeout(mobileNavCollapseTimer);
        badge.classList.remove("reveal");
        socket.emit("detachNavigator");
      } else {
        // First tap — expand to show session name
        mobileNavExpanded = true;
        badge.classList.add("reveal");
        if (mobileNavCollapseTimer) clearTimeout(mobileNavCollapseTimer);
        mobileNavCollapseTimer = setTimeout(() => {
          mobileNavExpanded = false;
          badge.classList.remove("reveal");
        }, 4000);
      }
    });

    socket.on("reload", () => {
      loadingOverlay.classList.add("visible");
      iframe.contentWindow?.location.reload();
    });

    // Live dashboard updates: when extension data changes in the background,
    // refresh the iframe if it's showing that tree's dashboard.
    socket.on("dashboardUpdate", ({ rootId: updatedRootId }) => {
      if (!updatedRootId || isSending) return;
      const currentRoot = getCurrentRootId();
      if (currentRoot === updatedRootId) {
        try { iframe.contentWindow?.location.reload(); } catch(e) {}
      }
    });

    socket.on("disconnect", () => {
      isConnected = false;
      isRegistered = false;
      updateStatus("disconnected");
      navIndicators.forEach(el => { if (el) el.classList.remove("active"); });

      [chatMessages, mobileChatMessages].forEach(container => {
        container.innerHTML = '<div class="welcome-message disconnected"><div class="welcome-icon">🌳</div><h2>Disconnected</h2><p>You have been disconnected from ' + CONFIG.landName + '. Please refresh the whole website to reconnect.</p></div>';
      });
    });

    // ================================================================
    // Recent Roots
    // ================================================================

    socket.on("recentRoots", ({ roots }) => {
      console.log("[socket] recent roots:", roots);
      recentRoots = roots || [];
      renderRecentRoots();
    });
var _initParams = new URLSearchParams(window.location.search);
let activeRootId = _initParams.get("rootId") || null;
if (activeRootId) window.history.replaceState({}, "", "/dashboard");

   function getCurrentRootId() {
  if (activeRootId) return activeRootId;
  // Fallback: try to extract from URL
  const ID = '(?:[a-f0-9]{24}|[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})';
  const rootMatch = currentIframeUrl.match(new RegExp('(?:/api/v1)?/root/(' + ID + ')', 'i'));
  return rootMatch ? rootMatch[1] : null;
}

    function truncateName(str, maxLen = 18) {
      if (!str) return '';
      return str.length > maxLen ? str.slice(0, maxLen) + '…' : str;
    }

    function renderRecentRoots() {
      const currentRootId = getCurrentRootId();

      // Hide if no roots
      if (recentRoots.length === 0) {
        recentRootsDropdown.classList.add("hidden");
        mobileRecentRoots.classList.remove("visible");
        return;
      }

      // Show dropdown trigger
      recentRootsDropdown.classList.remove("hidden");
      mobileRecentRoots.classList.add("visible");
      mobileRecentRoots.classList.toggle("expanded", mobileRecentRootsExpanded);

      // Render list HTML (truncated names, no emoji)
      const listHtml = recentRoots.map(root => {
        const isActive = root.rootId === currentRootId;
        return \`
          <button class="recent-root-item\${isActive ? ' active' : ''}" data-root-id="\${root.rootId}">
            <span class="recent-root-name">\${escapeHtml(truncateName(root.name))}</span>
          </button>
        \`;
      }).join('');

      recentRootsList.innerHTML = listHtml;
      mobileRecentRootsList.innerHTML = listHtml;

      // Add click handlers
      [recentRootsList, mobileRecentRootsList].forEach(list => {
        list.querySelectorAll('.recent-root-item').forEach(item => {
          item.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const rootId = item.dataset.rootId;
            if (rootId) {
              navigateToRoot(rootId);
              closeRecentRoots();
              // On mobile, just collapse recent trees, not the whole sheet
              if (window.innerWidth <= 768) {
                mobileRecentRootsExpanded = false;
                mobileRecentRoots.classList.remove("expanded");
              }
            }
          });
        });
      });
    }

  function navigateToRoot(rootId) {
    activeRootId = rootId;

  const url = '/api/v1/root/' + rootId + '?html&token=' + CONFIG.htmlShareToken + '&inApp=1';
  loadingOverlay.classList.add("visible");
  iframe.src = url;
  currentIframeUrl = '/api/v1/root/' + rootId;
}

    function closeRecentRoots() {
      recentRootsOpen = false;
      recentRootsDropdown.classList.remove("open");
    }

    function toggleRecentRoots() {
      recentRootsOpen = !recentRootsOpen;
      recentRootsDropdown.classList.toggle("open", recentRootsOpen);
    }

    // Desktop trigger click
    recentRootsTrigger.addEventListener("click", (e) => {
      e.stopPropagation();
      toggleRecentRoots();
    });

    // Mobile toggle
    mobileRecentRootsToggle.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      mobileRecentRootsExpanded = !mobileRecentRootsExpanded;
      mobileRecentRoots.classList.toggle("expanded", mobileRecentRootsExpanded);
    });

    // Close recent roots when clicking outside
    document.addEventListener("click", (e) => {
      if (recentRootsOpen && !recentRootsDropdown.contains(e.target)) {
        closeRecentRoots();
      }
      if (modeBarOpen && !$("modeBar").contains(e.target)) {
        closeModeBar();
      }
    });

    // Close recent roots when focusing chat input
    chatInput.addEventListener("focus", () => {
      closeRecentRoots();
    });

    // Close mobile recent roots when focusing input
    mobileSheetInput.addEventListener("focus", () => {
      mobileRecentRootsExpanded = false;
      mobileRecentRoots.classList.remove("expanded");
    });

    // ================================================================
    // Mode switching socket events
    // ================================================================

    socket.on("modeSwitched", ({ modeKey, emoji, label, alert, carriedMessages, silent }) => {
      console.log("[mode] switched to:", modeKey, silent ? "(silent)" : "", "carried:", carriedMessages?.length || 0);
      currentModeKey = modeKey;
      $("modeCurrentEmoji").textContent = emoji;
      $("modeCurrentLabel").textContent = label;
      const bigMode = modeKey.split(":")[0];
      if (availableModes.length && availableModes[0].key.startsWith(bigMode + ":")) {
        renderModeDropdown();
        renderMobileModeBar();
      }
      if (!silent) {
        if (isSending) {
          isSending = false;
          removeTypingIndicator();
          lockModeBar(false);
          updateSendButtons();
        }
        clearChatUI(carriedMessages || [], modeKey, emoji);
        showModeAlert(emoji, label);
      }
    });

   socket.on("availableModes", ({ bigMode, modes, currentMode, rootName, rootId }) => {
  console.log("[mode] available:", bigMode, modes, "root:", rootName, rootId);
  availableModes = modes || [];
  if (currentMode) currentModeKey = currentMode;

  // Sync activeRootId from server — this is the source of truth
  if (rootId) {
    activeRootId = rootId;
  } else if (bigMode === 'home') {
    activeRootId = null;
  }

  const active = availableModes.find(m => m.key === currentModeKey);
  if (active) {
    $("modeCurrentEmoji").textContent = active.emoji;
    $("modeCurrentLabel").textContent = active.label;
  }
  renderModeDropdown();
  renderMobileModeBar();

  // Visibility is controlled by CSS (gated behind body.show-bg-messages).
  // The mode picker is an advanced override; sprout + the routing index
  // pick the right mode automatically.
  updateRootName(rootName);
});

    socket.on("conversationCleared", () => {
      console.log("[socket] conversation manually cleared");
      clearChatUI([], currentModeKey);
    });

    // ================================================================
    // Mode bar logic (desktop)
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

    // Prevent clicks inside dropdown from toggling mode bar
    $("modeDropdown").addEventListener("click", (e) => {
      e.stopPropagation();
    });

    // ================================================================
    // Lock/unlock mode bar while AI is responding
    // ================================================================

    const SEND_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z"/></svg>';
    const STOP_SVG = '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>';

    function lockModeBar(locked) {
      $("modeBar").classList.toggle("locked", locked);
      document.querySelectorAll(".mobile-mode-btn").forEach(btn => {
        btn.classList.toggle("locked", locked);
      });
      [sendBtn, mobileSheetSendBtn].forEach(btn => {
        btn.classList.toggle("stop-mode", locked);
        btn.innerHTML = locked ? STOP_SVG : SEND_SVG;
        if (locked) btn.disabled = false;
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
            void el.offsetWidth;
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
    // Mobile mode bar (horizontal pills in sheet header)
    // ================================================================

    function renderMobileModeBar() {
      const bar = $("mobileModeBar");
      bar.innerHTML = "";
      availableModes.forEach(mode => {
        const btn = document.createElement("button");
        btn.className = "mobile-mode-btn" + (mode.key === currentModeKey ? " active" : "");
        btn.dataset.modeKey = mode.key;
        btn.innerHTML = '<span class="mobile-mode-btn-emoji">' + mode.emoji + '</span><span>' + mode.label + '</span>';
        btn.addEventListener("click", (e) => {
          e.stopPropagation();
          if (mode.key !== currentModeKey) {
            socket.emit("switchMode", { modeKey: mode.key });
          }
        });
        bar.appendChild(btn);
      });
      scrollToActiveMode();
    }

    function scrollToActiveMode() {
      const bar = $("mobileModeBar");
      const activeBtn = bar.querySelector(".mobile-mode-btn.active");
      if (activeBtn) {
        const barRect = bar.getBoundingClientRect();
        const btnRect = activeBtn.getBoundingClientRect();
        const scrollLeft = activeBtn.offsetLeft - (barRect.width / 2) + (btnRect.width / 2);
        bar.scrollTo({ left: Math.max(0, scrollLeft), behavior: "smooth" });
      }
    }

    // ================================================================
    // Mode alert toast
    // ================================================================

    let modeAlertTimer = null;
    function showModeAlert(emoji, label) {
     //handled behind scenes
    }

    // ================================================================
    // Clear chat UI helper
    // ================================================================

    function clearChatUI(carriedMessages, modeKey, emoji) {
      const valid = (carriedMessages || []).filter(m => m.content && m.content.trim());
      const activeMode = availableModes.find(m => m.key === modeKey);
      const welcome = {
        icon: emoji || activeMode?.emoji || "🌳",
        title: activeMode?.label || (modeKey === "home:default" ? "Welcome to " + CONFIG.landName : "Ready"),
        desc: "",
      };

      [chatMessages, mobileChatMessages].forEach(container => {
        container.innerHTML = '';

        if (valid.length > 0) {
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
    // iframe URL change detection
    // ================================================================

    let lastEmittedUrl = "";
    function detectIframeUrlChange() {
      let path = "";

      try {
        const loc = iframe.contentWindow?.location;
        if (loc) path = loc.pathname + loc.search;
      } catch (e) {}

      if (!path) {
        try { const u = new URL(iframe.src); path = u.pathname + u.search; } catch(e) {}
      }

      if (!path) {
        path = currentIframeUrl || "";
      }

      if (path && path !== lastEmittedUrl) {
        lastEmittedUrl = path;
        currentIframeUrl = path;
        const ID = '(?:[a-f0-9]{24}|[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})';
        let rootId = null;
        let nodeId = null;
        const rootMatch = path.match(new RegExp('(?:/api/v1)?/root/(' + ID + ')(?:[?/]|$)', 'i'));
        const extDashMatch = path.match(new RegExp('(?:/api/v1)?/root/(' + ID + ')/[a-z]', 'i'));
        const bareMatch = path.match(new RegExp('(?:/api/v1)?/(' + ID + ')(?:[?/]|$)', 'i'));

        // Extension dashboards (/root/:id/fitness, /root/:id/food, etc.)
        // Chat bar is now in the app shell, not in the iframe.
        // Emit urlChanged so the server switches to the right tree session.
        if (extDashMatch) {
          rootId = extDashMatch[1];
          activeRootId = rootId;
          if (isRegistered) {
            socket.emit("urlChanged", { url: path, rootId, nodeId: null });
          }
        } else {
          if (rootMatch) rootId = rootMatch[1];
          else if (bareMatch) nodeId = bareMatch[1];

          if (isRegistered) {
            socket.emit("urlChanged", { url: path, rootId, nodeId });
          }
          if (rootMatch) activeRootId = rootId;
        }
        // Re-render recent roots to update active state
        renderRecentRoots();
      }
    }

    // Status
    function updateStatus(status) {
      statusDot.className = "status-dot " + status;
      mobileStatusIndicator.className = "mobile-status-indicator " + status;
      statusText.textContent = status === "connected" ? "Connected" : status === "connecting" ? "Connecting..." : "Disconnected";
      isConnected = status === "connected";
    }

    // Format message content with markdown-like parsing
    function formatMessageContent(text) {
      if (!text) return '';
      
      let html = text;
      
      html = html.replace(/&nbsp;/g, ' ');
      html = html.replace(/&amp;/g, '&');
      html = html.replace(/&lt;/g, '<');
      html = html.replace(/&gt;/g, '>');
      html = html.replace(/\\u00A0/g, ' ');
      html = html.replace(/–/g, '-');
      html = html.replace(/—/g, '--');
      
      html = html.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      
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
      
      html = html.replace(/^\\|\\s*(\\d{1,2})\\s*\\|\\s*(.+?)\\s*\\|\\s*$/gm, (match, num, name) => {
        return '<div class="menu-item clickable" data-action="' + num + '" data-name="' + name.replace(/"/g, '&quot;') + '">' +
          '<span class="menu-number">' + num + '</span>' +
          '<span class="menu-text">' + name + '</span></div>';
      });
      
      html = html.replace(/^\\|\\s*#\\s*\\|.*\\|\\s*$/gm, '');
      html = html.replace(/^\\|[-:\\s|]+\\|\\s*$/gm, '');
      
      html = html.replace(/\`\`\`([\\s\\S]*?)\`\`\`/g, '<pre><code>$1</code></pre>');
      html = html.replace(/\`([^\`]+)\`/g, '<code>$1</code>');
      
      html = html.replace(/\\*\\*(.+?)\\*\\*/g, '<strong>$1</strong>');
      html = html.replace(/__(.+?)__/g, '<strong>$1</strong>');
      
      html = html.replace(/(?<![\\w\\*])\\*([^\\*]+)\\*(?![\\w\\*])/g, '<em>$1</em>');
      
      html = html.replace(/^####\\s*(.+)$/gm, '<h4>$1</h4>');
      html = html.replace(/^###\\s*(.+)$/gm, '<h3>$1</h3>');
      html = html.replace(/^##\\s*(.+)$/gm, '<h2>$1</h2>');
      html = html.replace(/^#\\s*(.+)$/gm, '<h1>$1</h1>');
      
      html = html.replace(/^-{3,}$/gm, '<hr>');
      html = html.replace(/^\\*{3,}$/gm, '<hr>');
      
      html = html.replace(/^&gt;\\s*(.+)$/gm, '<blockquote>$1</blockquote>');
      
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
      
      html = html.replace(/^([1-9]|1[0-9]|20)\\.\\s*<strong>(.+?)<\\/strong>(.*)$/gm, (m, num, title, rest) => {
        return '<div class="menu-item clickable" data-action="' + num + '" data-name="' + title.replace(/"/g, '&quot;') + '">' +
          '<span class="menu-number">' + num + '</span>' +
          '<span class="menu-text"><strong>' + title + '</strong>' + rest + '</span></div>';
      });
      
      html = html.replace(/^[-–•]\\s*<strong>(.+?)<\\/strong>(.*)$/gm, 
        '<div class="menu-item"><span class="menu-number">•</span><span class="menu-text"><strong>$1</strong>$2</span></div>');
      
      html = html.replace(/^[-–•]\\s+([^<].*)$/gm, '<li>$1</li>');
      
      html = html.replace(/^(\\d+)\\.\\s+([^<*].*)$/gm, '<li><span class="list-num">$1.</span> $2</li>');
      
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
      
      html = html.replace(/\\[([^\\]]+)\\]\\(([^)]+)\\)/g, '<a href="$2" target="_blank">$1</a>');
      
      const blocks = html.split(/\\n\\n+/);
      html = blocks.map(block => {
        const trimmed = block.trim();
        if (!trimmed) return '';
        if (trimmed.match(/^<(h[1-4]|ul|ol|pre|blockquote|hr|div|table)/)) return trimmed;
        const withBreaks = trimmed.split('\\n').map(l => l.trim()).filter(l => l).join('<br>');
        return '<p>' + withBreaks + '</p>';
      }).filter(b => b).join('');
      
      html = html.replace(/<p><\\/p>/g, '');
      html = html.replace(/<p>(<div|<ul|<ol|<h[1-4]|<hr|<pre|<blockquote|<table)/g, '$1');
      html = html.replace(/(<\\/div>|<\\/ul>|<\\/ol>|<\\/h[1-4]>|<\\/pre>|<\\/blockquote>|<\\/table>)<\\/p>/g, '$1');
      html = html.replace(/<br>(<div|<\\/div>)/g, '$1');
      html = html.replace(/(<div[^>]*>)<br>/g, '$1');
      
      return html;
    }

    // Messages
    function addMessage(content, role, opts) {
      const merged = role === "user" && opts && opts.merged;
      [chatMessages, mobileChatMessages].forEach(container => {
        const welcome = container.querySelector(".welcome-message");
        if (welcome) welcome.remove();

        const msg = document.createElement("div");
        msg.className = "message " + role + (merged ? " merged" : "");

        const formattedContent = role === "assistant" ? formatMessageContent(content) : escapeHtml(content);
        const chip = merged
          ? '<div class="user-merge-chip" title="Sent while the previous response was still streaming. Merged into the running turn.">&#x21BB; merged into running response</div>'
          : '';

        msg.innerHTML = \`
          <div class="message-avatar">\${role === "user" ? "👤" : "🌳"}</div>
          <div class="message-content">\${formattedContent}\${chip}</div>
        \`;

        if (role === "assistant") {
          msg.querySelectorAll('.menu-item.clickable').forEach(item => {
            item.addEventListener('click', () => handleMenuItemClick(item));
          });
        }

        container.appendChild(msg);
        container.scrollTop = container.scrollHeight;
      });
    }

    function handleMenuItemClick(item) {
      const action = item.dataset.action;
      const name = item.dataset.name;
      
      if (!action || isSending) return;
      
      item.classList.add('clicking');
      setTimeout(() => item.classList.remove('clicking'), 300);
      
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

    // Send message. During processing, messages still send (stream extension
    // accumulates them for mid-flight injection). Input stays enabled.
    function sendChatMessage(message) {
      if (!message.trim() || !isRegistered) return;

      const startingNewTurn = !isSending;
      addMessage(message, "user", { merged: !startingNewTurn });
      if (startingNewTurn) {
        addTypingIndicator();
        isSending = true;
        lockModeBar(true);
      }
      // Reset the live-event dedupe so the first mode switch /
      // thinking line of the next turn always renders.
      if (typeof _liveState !== "undefined") {
        _liveState.lastMode = null;
        _liveState.lastThinking = null;
      }
      // Only bump generation when starting a new turn. Mid-flight sends are
      // accumulated server-side into the running turn (see websocket.js
      // ~825) and will complete under the original turn's generation. If we
      // bumped here, the completion's generation would be < requestGeneration
      // and the chatResponse handler would drop the answer as "stale",
      // leaving the typing indicator spinning forever.
      if (startingNewTurn) requestGeneration++;
      const thisGen = requestGeneration;
      updateSendButtons();

      socket.emit("chat", { message, username: CONFIG.username, generation: thisGen, mode: currentModeKey?.split(":").pop()?.split("-")[0] || "chat" });
    }

    function updateSendButtons() {
      const desktopText = chatInput.value.trim();
      const mobileSheetText = mobileSheetInput.value.trim();

      // When AI is working: button is Stop (red) unless user has typed text, then it's Send
      if (isSending && !desktopText) {
        sendBtn.disabled = false;
        sendBtn.classList.add("stop-mode");
      } else {
        sendBtn.disabled = !(desktopText && isRegistered);
        sendBtn.classList.remove("stop-mode");
      }

      if (isSending && !mobileSheetText) {
        mobileSheetSendBtn.disabled = false;
        mobileSheetSendBtn.classList.add("stop-mode");
      } else {
        mobileSheetSendBtn.disabled = !(mobileSheetText && isRegistered);
        mobileSheetSendBtn.classList.remove("stop-mode");
      }

      // Input always enabled so user can type corrections mid-flight
      chatInput.disabled = false;
      mobileSheetInput.disabled = false;
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
        if (msg && isRegistered) {
          sendChatMessage(msg);
          chatInput.value = "";
          chatInput.style.height = "auto";
          updateSendButtons();
        }
      }
    });

    // Input change: if user starts typing while AI is responding,
    // switch button from Stop back to Send
    chatInput.addEventListener("input", () => updateSendButtons());
    mobileSheetInput.addEventListener("input", () => updateSendButtons());

    sendBtn.addEventListener("click", () => {
      const msg = chatInput.value.trim();
      if (msg && isRegistered) {
        // Text in input: send it (even during processing, stream accumulates)
        sendChatMessage(msg);
        chatInput.value = "";
        chatInput.style.height = "auto";
        updateSendButtons();
      } else if (isSending) {
        // No text, AI is working: stop
        cancelRequest();
      }
    });

    // Mobile handlers
    let sheetDragStartY = 0;
    let isDraggingSheet = false;
    let sheetHeight = 0;
    let currentDragY = 0;
    let dragStartState = 'closed';

    function setMobileSheetState(newState, force = false) {
      // Don't re-run if already in this state (unless forced)
      if (mobileSheetState === newState && !force) return;
      
      mobileSheetState = newState;
      mobileChatSheet.classList.remove("open", "peeked", "closing");
      
      if (newState === 'open') {
        mobileChatSheet.classList.add("open");
        mobileBackdrop.classList.add("visible");
        mobileChatTab.classList.add("hidden");
        setTimeout(() => {
          mobileSheetInput.focus();
          updateSendButtons();
          scrollToActiveMode();
        }, 350);
      } else if (newState === 'peeked') {
        mobileChatSheet.classList.add("peeked");
        mobileBackdrop.classList.remove("visible");
        mobileChatTab.classList.add("hidden");
        mobileSheetInput.blur();
      } else {
        // closed - go to side tab
        mobileChatSheet.classList.add("closing");
        mobileBackdrop.classList.remove("visible");
        mobileSheetInput.blur();
        setTimeout(() => {
          mobileChatSheet.classList.remove("closing");
          mobileChatTab.classList.remove("hidden");
        }, 300);
      }
    }

    function openMobileSheetFull() {
      setMobileSheetState('open');
    }

    function peekMobileSheet() {
      setMobileSheetState('peeked');
    }

    function closeMobileSheet() {
      setMobileSheetState('closed');
    }

    // Side tab opens to full
    mobileChatTab.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      openMobileSheetFull();
    });

    // Header tap in peeked state opens full (ignore button clicks)
    mobileSheetHeader.addEventListener("click", (e) => {
      if (mobileSheetState === 'peeked' && !isDraggingSheet && !e.target.closest("button")) {
        e.preventDefault();
        e.stopPropagation();
        openMobileSheetFull();
      }
    });

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
      const msg = mobileSheetInput.value.trim();
      if (msg && isRegistered) {
        sendChatMessage(msg);
        mobileSheetInput.value = "";
        mobileSheetInput.style.height = "auto";
        updateSendButtons();
      } else if (isSending) {
        cancelRequest();
      }
    });

    // X button always closes to side tab
    $("mobileCloseBtn").addEventListener("click", (e) => {
      e.stopPropagation();
      e.preventDefault();
      closeMobileSheet();
    });
    // Backdrop click closes to side tab
    mobileBackdrop.addEventListener("click", closeMobileSheet);

    // Sheet drag handling
    function handleSheetDragStart(e) {
      if (mobileSheetState === 'closed') return;
      
      const touch = e.touches ? e.touches[0] : e;
      sheetDragStartY = touch.clientY;
      sheetHeight = mobileChatSheet.offsetHeight;
      currentDragY = 0;
      isDraggingSheet = true;
      dragStartState = mobileSheetState;
      mobileChatSheet.classList.add("dragging");
    }

    function handleSheetDragMove(e) {
      if (!isDraggingSheet) return;
      
      const touch = e.touches ? e.touches[0] : e;
      const deltaY = touch.clientY - sheetDragStartY;
      
      // Calculate base offset based on current state
      let baseOffset = 0;
      if (dragStartState === 'peeked') {
        baseOffset = sheetHeight - 90; // peeked position
      }
      
      if (dragStartState === 'open') {
        // Dragging down from open
        if (deltaY > 0) {
          currentDragY = deltaY;
          mobileChatSheet.style.transform = \`translateY(\${deltaY}px)\`;
          const progress = Math.min(deltaY / (sheetHeight * 0.5), 1);
          mobileBackdrop.style.opacity = String(1 - progress);
        } else if (deltaY < 0) {
          // Allow slight overdrag up
          currentDragY = deltaY;
          mobileChatSheet.style.transform = \`translateY(\${Math.max(deltaY, -20)}px)\`;
        }
      } else if (dragStartState === 'peeked') {
        // Dragging from peeked state
        currentDragY = deltaY;
        const newOffset = Math.max(0, Math.min(baseOffset + deltaY, sheetHeight));
        mobileChatSheet.style.transform = \`translateY(\${newOffset}px)\`;
        
        // Show backdrop when dragging up
        if (deltaY < 0) {
          const progress = Math.min(Math.abs(deltaY) / (sheetHeight - 90), 1);
          mobileBackdrop.style.opacity = String(progress);
          mobileBackdrop.classList.add("visible");
        }
      }
    }

    function handleSheetDragEnd(e) {
      if (!isDraggingSheet) return;
      
      isDraggingSheet = false;
      mobileChatSheet.classList.remove("dragging");
      mobileChatSheet.style.transform = "";
      mobileBackdrop.style.opacity = "";
      
      const peekThreshold = sheetHeight - 200; // pixels from top to trigger peek
      
      if (dragStartState === 'open') {
        // From open: drag down far = peek, drag down very far = still peek (not close)
        if (currentDragY > peekThreshold) {
          peekMobileSheet();
        } else if (currentDragY > 50) {
          peekMobileSheet();
        } else {
          setMobileSheetState('open');
        }
      } else if (dragStartState === 'peeked') {
        // From peeked: drag up = open, drag down = stay peeked
        if (currentDragY < -50) {
          openMobileSheetFull();
        } else {
          setMobileSheetState('peeked');
        }
      }
      
      currentDragY = 0;
    }

    mobileSheetHeader.addEventListener("touchstart", handleSheetDragStart, { passive: true });
    mobileSheetHeader.addEventListener("touchmove", handleSheetDragMove, { passive: true });
    mobileSheetHeader.addEventListener("touchend", handleSheetDragEnd, { passive: true });
    mobileSheetHeader.addEventListener("touchcancel", handleSheetDragEnd, { passive: true });

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

    // Start in peeked state on mobile
    if (window.innerWidth <= 768) {
      setTimeout(() => setMobileSheetState('peeked'), 100);
    }

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

    // Resize handling: keep panel widths sane AND keep mobile sheet state in
    // sync with the CSS breakpoint. Without the breakpoint sync, the mobile
    // backdrop's .visible class can survive a desktop->mobile resize and end
    // up blocking all clicks on the iframe (full-viewport pointer-events:auto
    // overlay). The .open class on the sheet would also leave it slid up over
    // the viewport. Reset to peeked when entering mobile, closed when leaving.
    const mobileMql = window.matchMedia("(max-width: 768px)");
    function onBreakpointChange(e) {
      if (e.matches) {
        // Just entered mobile. Make sure the sheet starts in peeked state and
        // the backdrop is hidden so the iframe is interactive.
        setMobileSheetState('peeked', true);
      } else {
        // Just left mobile. Clear all mobile state so the desktop layout has
        // no leftover transforms or backdrop overlays.
        setMobileSheetState('closed', true);
      }
    }
    if (typeof mobileMql.addEventListener === "function") {
      mobileMql.addEventListener("change", onBreakpointChange);
    } else if (typeof mobileMql.addListener === "function") {
      // Older Safari
      mobileMql.addListener(onBreakpointChange);
    }

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

    // Clear chat buttons
   function handleClearChat() {
      if (!isRegistered) return;
      if (isSending) cancelRequest();
      socket.emit("clearConversation");
      clearChatUI([], currentModeKey);
      // Navigate iframe back to tree root
      const rootId = getCurrentRootId();
      if (rootId) {
        navigateToRoot(rootId);
      } else {
        goHome();
      }
    }

    $("clearChatBtn").addEventListener("click", handleClearChat);
    $("mobileClearChatBtn").addEventListener("click", (e) => {
      e.stopPropagation();
      e.preventDefault();
      handleClearChat();
    });

    function getCurrentIframeUrl() {
      let url = "";
      try {
        url = iframe.contentWindow?.location?.href;
      } catch (e) {}
      if (!url) {
        try { url = iframe.src; } catch(e) {}
      }
      if (!url) {
        url = window.location.origin + currentIframeUrl;
      }
      try {
        const u = new URL(url, window.location.origin);
        u.searchParams.delete('inApp');
        return u.href;
      } catch(e) {
        return url.replace(/[&?]inApp=1/g, '');
      }
    }

function goHome() {
  activeRootId = null;

  // Close dashboard if open
  if (window.TreeApp && window.TreeApp.closeDashboard) window.TreeApp.closeDashboard();

  loadingOverlay.classList.add("visible");
  currentIframeUrl = CONFIG.homeUrl;
  iframe.src = CONFIG.homeUrl; // home doesn't need rootId
}

    // Background messages toggle (defaults off)
    $("bgMsgToggleBtn").addEventListener("click", () => {
      const on = document.body.classList.toggle("show-bg-messages");
      $("bgMsgToggleBtn").classList.toggle("active", on);
      try { localStorage.setItem("treeos:bgMessages", on ? "1" : "0"); } catch {}
    });
    // Restore preference
    try { if (localStorage.getItem("treeos:bgMessages") === "1") { document.body.classList.add("show-bg-messages"); $("bgMsgToggleBtn").classList.add("active"); } } catch {}

    $("desktopHomeBtn").addEventListener("click", goHome);
    $("mobileHomeBtn").addEventListener("click", (e) => {
      e.stopPropagation();
      e.preventDefault();
      goHome();
      // Always reset to peeked/dragged-down mode on mobile (use timeout to ensure it happens last)
      setTimeout(() => setMobileSheetState('peeked', true), 10);
    });

    function doRefresh() {
      loadingOverlay.classList.add("visible");
      iframe.contentWindow?.location.reload();
    }

    $("desktopRefreshBtn").addEventListener("click", doRefresh);
    $("mobileRefreshBtn").addEventListener("click", (e) => {
      e.stopPropagation();
      e.preventDefault();
      doRefresh();
    });

    function openInNewTab() {
      const url = getCurrentIframeUrl();
      window.open(url, '_blank');
    }

    $("desktopOpenTabBtn").addEventListener("click", openInNewTab);

    // LLM Connections button — go to /setup if no LLM, else energy page
    function goCustomAi() {
      if (!CONFIG.hasLlm) {
        window.location.href = "/setup";
        return;
      }
      const url = buildIframeUrl('/api/v1/user/' + CONFIG.userId + '/energy?html');
      loadingOverlay.classList.add("visible");
      currentIframeUrl = url;
      iframe.src = url;
      // Scroll iframe to bottom once loaded
      const onLoad = () => {
        iframe.removeEventListener('load', onLoad);
        try { iframe.contentWindow.scrollTo(0, iframe.contentDocument.body.scrollHeight); } catch(e) {}
      };
      iframe.addEventListener('load', onLoad);
    }

    $("desktopCustomAiBtn").addEventListener("click", goCustomAi);
    $("mobileCustomAiBtn").addEventListener("click", (e) => {
      e.stopPropagation();
      e.preventDefault();
      if (mobileSheetState === 'open') {
        // In full chat mode on mobile — slide it down to peeked
        setTimeout(() => setMobileSheetState('peeked', true), 10);
      }
      // If already peeked/closed, keep it down (don't open)
      goCustomAi();
    });

    // Iframe
   iframe.addEventListener("load", () => {
  loadingOverlay.classList.remove("visible");
  try {
    const loc = iframe.contentWindow?.location;
    if (loc) {
      currentIframeUrl = loc.pathname + loc.search;
    }
  } catch (e) {}
  detectIframeUrlChange();
  injectIframeParamForwarding();
});

function injectIframeParamForwarding() {
  try {
    const doc = iframe.contentDocument || iframe.contentWindow?.document;
    if (!doc) return;

    // Skip if already injected
    if (doc._paramForwardingInjected) return;
    doc._paramForwardingInjected = true;

    // Intercept all clicks on links
    doc.addEventListener('click', (e) => {
      const anchor = e.target.closest('a');
      if (!anchor || !anchor.href) return;

      try {
        const url = new URL(anchor.href);

        // Only rewrite same-origin links
        if (url.origin !== window.location.origin) return;

        // Add inApp
        if (!url.searchParams.has('inApp')) {
          url.searchParams.set('inApp', '1');
        }

        // Add token
        if (!url.searchParams.has('token')) {
          url.searchParams.set('token', CONFIG.htmlShareToken);
        }

        // Add rootId if we have one and it's not already a /root/ URL
        const rootId = getCurrentRootId();
        if (rootId && !url.pathname.includes('/root/')) {
          url.searchParams.set('rootId', rootId);
        }

        anchor.href = url.pathname + url.search;
      } catch (err) {
        // ignore malformed URLs
      }
    }, true); // capture phase to run before default

    // Also intercept form submissions
    doc.addEventListener('submit', (e) => {
      const form = e.target;
      if (!form || !form.action) return;
      try {
        const url = new URL(form.action, window.location.origin);
        if (url.origin !== window.location.origin) return;

        // Inject hidden fields
        ['inApp', 'token', 'rootId'].forEach(key => {
          if (form.querySelector('input[name="' + key + '"]')) return;
          let val;
          if (key === 'inApp') val = '1';
          else if (key === 'token') val = CONFIG.htmlShareToken;
          else if (key === 'rootId') val = getCurrentRootId();
          if (!val) return;
          const input = doc.createElement('input');
          input.type = 'hidden';
          input.name = key;
          input.value = val;
          form.appendChild(input);
        });
      } catch (err) {}
    }, true);

    // Intercept programmatic navigation (window.location assignments)
    const iframeWindow = iframe.contentWindow;
    if (iframeWindow) {
      const origPushState = iframeWindow.history.pushState?.bind(iframeWindow.history);
      const origReplaceState = iframeWindow.history.replaceState?.bind(iframeWindow.history);

      function patchUrl(urlArg) {
        if (!urlArg || typeof urlArg !== 'string') return urlArg;
        try {
          const u = new URL(urlArg, window.location.origin);
          if (u.origin !== window.location.origin) return urlArg;
          if (!u.searchParams.has('inApp')) u.searchParams.set('inApp', '1');
          if (!u.searchParams.has('token')) u.searchParams.set('token', CONFIG.htmlShareToken);
          const rootId = getCurrentRootId();
          if (rootId && !u.pathname.includes('/root/')) u.searchParams.set('rootId', rootId);
          return u.pathname + u.search;
        } catch (e) { return urlArg; }
      }

      if (origPushState) {
        iframeWindow.history.pushState = function(state, title, url) {
          return origPushState(state, title, patchUrl(url));
        };
      }
      if (origReplaceState) {
        iframeWindow.history.replaceState = function(state, title, url) {
          return origReplaceState(state, title, patchUrl(url));
        };
      }
    }
  } catch (e) {
    // Cross-origin or sandbox restriction — can't inject
    console.warn('[iframe] param forwarding injection failed:', e.message);
  }
}

    // Socket events
    socket.on("treeChanged", ({ nodeId, changeType, details }) => {
      console.log("[socket] tree changed:", changeType, nodeId);
      loadingOverlay.classList.add("visible");
      iframe.contentWindow?.location.reload();
    });

    // ── Live reasoning stream (mirrors CLI liveRenderer) ─────────────
    // The dashboard gets the same event vocabulary as the CLI: intent,
    // mode switches, thinking prose, tool calls + results, swarm fanout,
    // branch start/end. Lines land as compact rows between the user
    // message and the typing indicator.
    var _liveState = { lastMode: null, lastThinking: null };

    // Returns an array of inserted rows, one per chat container,
    // so callers can bind click listeners directly. Previously
    // callers used last-of-typewhich matched by element TYPE
    // (not class) and could grab the wrong element when other
    // divs followed in the same container — buttons silently no-op.
    function _liveAddLine(classSuffix, html) {
      var rows = [];
      [chatMessages, mobileChatMessages].forEach(function(container) {
        if (!container) return;
        const welcome = container.querySelector(".welcome-message");
        if (welcome) welcome.remove();
        const typing = container.querySelector(".typing-indicator")?.closest(".message");
        const row = document.createElement("div");
        row.className = "live-line live-line-" + classSuffix;
        row.innerHTML = html;
        if (typing) container.insertBefore(row, typing);
        else container.appendChild(row);
        container.scrollTop = container.scrollHeight;
        rows.push(row);
      });
      return rows;
    }

    function _liveOneLine(s, max) {
      if (!s) return "";
      var flat = String(s).replace(/\\s+/g, " ").trim();
      return flat.length <= max ? flat : flat.slice(0, max - 1) + "\\u2026";
    }

    function _liveFormatArgs(args) {
      if (!args || typeof args !== "object") return "";
      var keys = ["filePath", "path", "name", "query", "command", "action"];
      for (var i = 0; i < keys.length; i++) {
        var k = keys[i];
        if (args[k] != null && typeof args[k] !== "object") {
          var v = String(args[k]);
          return v.length > 60 ? v.slice(0, 57) + "\\u2026" : v;
        }
      }
      return "";
    }

    // Reset dedupe state when a new chat message is about to go out
    // (hooked from the sendChatMessage path — see _resetLiveStateForTurn()).
    window._resetLiveStateForTurn = function() {
      _liveState.lastMode = null;
      _liveState.lastThinking = null;
    };

    socket.on("toolResult", function(ev) {
      console.log("[socket] tool:", ev && ev.tool, ev && ev.success ? "\\u2713" : "\\u2717", (ev && ev.error) || "");
      var name = ev && ev.tool ? String(ev.tool) : "?";
      var ok = !(ev && (ev.success === false || ev.error));
      if (ok) {
        var preview = "";
        if (ev && typeof ev.result === "string" && ev.result.trim()) {
          var firstLine = ev.result.split("\\n").find(function(l) { return l.trim(); }) || "";
          preview = _liveOneLine(firstLine, 120);
        }
        _liveAddLine("tool-ok",
          '<span class="live-ok">\\u2713</span> <span class="live-dim">' + escapeHtml(name) + '</span>' +
          (preview ? ' <span class="live-dim">\\u2014 ' + escapeHtml(preview) + '</span>' : "")
        );
      } else {
        var err = _liveOneLine((ev && ev.error) || "failed", 160);
        _liveAddLine("tool-fail",
          '<span class="live-fail">\\u2717</span> <span class="live-dim">' + escapeHtml(name) + '</span>' +
          (err ? ' <span class="live-fail-text">' + escapeHtml(err) + '</span>' : "")
        );
      }
    });

    socket.on("toolCalled", function(ev) {
      var name = ev && ev.tool ? String(ev.tool) : "?";
      var hint = _liveFormatArgs(ev && ev.args);
      _liveAddLine("tool-call",
        '<span class="live-tc-dot">\\u00b7</span> <b>' + escapeHtml(name) + '</b>' +
        (hint ? ' <span class="live-dim">(' + escapeHtml(hint) + ')</span>' : "")
      );
    });

    socket.on("thinking", function(ev) {
      var text = _liveOneLine(ev && ev.text, 200);
      if (!text) return;
      var key = text.slice(0, 60);
      if (key === _liveState.lastThinking) return;
      _liveState.lastThinking = key;
      _liveAddLine("thinking", '\\u2026 <span class="live-dim">' + escapeHtml(text) + '</span>');
    });

    socket.on("modeSwitched", function(ev) {
      var m = ev && (ev.mode || ev.modeKey || ev.to);
      if (!m || m === _liveState.lastMode) return;
      _liveAddLine("mode", '\\u21aa <b>' + escapeHtml(m) + '</b>');
      _liveState.lastMode = m;
    });

    socket.on("swarmDispatch", function(ev) {
      var count = (ev && ev.count) || (ev && ev.branches && ev.branches.length) || 0;
      var names = (ev && ev.branches ? ev.branches.map(function(b) { return b.name; }).filter(Boolean) : []);
      var label = names.length ? " [" + names.slice(0, 6).join(", ") + (names.length > 6 ? " +" + (names.length - 6) : "") + "]" : "";
      _liveAddLine("swarm",
        '<span class="live-swarm">\\u232b</span> swarm: <b>' + count + ' branch' + (count === 1 ? "" : "es") + '</b>' +
        '<span class="live-dim">' + escapeHtml(label) + '</span>'
      );
    });

    socket.on("branchStarted", function(ev) {
      var name = ev && ev.name ? String(ev.name) : "?";
      var pos = (ev && ev.index != null && ev.total != null) ? " " + ev.index + "/" + ev.total : "";
      _liveAddLine("branch-start",
        '<span class="live-branch">\\u25b6</span> <b>' + escapeHtml(name) + '</b><span class="live-dim">' + pos + '</span>'
      );
    });

    socket.on("branchCompleted", function(ev) {
      var name = ev && ev.name ? String(ev.name) : "?";
      var st = (ev && ev.status) || "done";
      if (st === "done") {
        _liveAddLine("branch-ok",
          '<span class="live-ok">\\u2713</span> <span class="live-dim">branch </span><b>' + escapeHtml(name) + '</b>'
        );
      } else {
        var err = _liveOneLine((ev && ev.error) || st, 140);
        _liveAddLine("branch-fail",
          '<span class="live-fail">\\u2717</span> <span class="live-dim">branch </span><b>' + escapeHtml(name) + '</b>' +
          (err ? ' <span class="live-fail-text">' + escapeHtml(err) + '</span>' : "")
        );
      }
    });

    // ── Plan-first swarm events ─────────────────────────────────────
    // A multi-branch build is proposed: render a full plan card with
    // a per-branch list and three action buttons (Accept / Revise /
    // Cancel). All three route back through the chat socket so the
    // server-side interception in orchestrator.js picks them up the
    // same way a typed "yes" / "..." / "cancel" would.
    function _renderPlanCard(ev, isUpdate) {
      // Remove any prior spent plan cards before rendering a new one.
      // Clicking Revise on v1 previously left v1 dimmed-but-visible
      // next to the incoming v2, confusing which plan was live.
      try {
        var staleRoots = document.querySelectorAll(".live-line-plan-card");
        for (var i = 0; i < staleRoots.length; i++) {
          if (staleRoots[i].querySelector(".plan-card-spent") && staleRoots[i].parentNode) {
            staleRoots[i].parentNode.removeChild(staleRoots[i]);
          }
        }
      } catch (e) { /* best effort; never block render */ }

      var version = ev && ev.version != null ? "v" + ev.version : "";
      var branches = (ev && Array.isArray(ev.branches)) ? ev.branches : [];
      var count = branches.length;
      var header = isUpdate ? "Updated plan" : "Proposed plan";
      var trigger = isUpdate && ev && ev.trigger
        ? '<div class="plan-trigger">\\u21aa ' + escapeHtml(_liveOneLine(ev.trigger, 120)) + '</div>'
        : '';
      var rows = branches.map(function(b) {
        var name = escapeHtml(b.name || "?");
        var path = b.path ? '<span class="plan-path">\\u00b7 path: ' + escapeHtml(b.path) + '</span>' : '';
        var mode = b.mode ? '<span class="plan-mode">\\u00b7 ' + escapeHtml(b.mode) + '</span>' : '';
        var files = (Array.isArray(b.files) && b.files.length)
          ? '<span class="plan-files">\\u00b7 files: ' + escapeHtml(_liveOneLine(b.files.join(", "), 80)) + '</span>'
          : '';
        var spec = b.spec
          ? '<div class="plan-spec">' + escapeHtml(_liveOneLine(b.spec, 180)) + '</div>'
          : '';
        return (
          '<div class="plan-branch">' +
            '<div class="plan-branch-head">' +
              '<b>' + name + '</b> ' + path + ' ' + mode + ' ' + files +
            '</div>' +
            spec +
          '</div>'
        );
      }).join("");

      var buttons = (
        '<div class="plan-actions">' +
          '<button class="plan-btn plan-btn-accept">Accept</button>' +
          '<button class="plan-btn plan-btn-revise">Revise</button>' +
          '<button class="plan-btn plan-btn-cancel">Cancel</button>' +
        '</div>'
      );

      var insertedRows = _liveAddLine("plan-card",
        '<div class="plan-card">' +
          '<div class="plan-card-head">' +
            '<span class="live-swarm">\\u232b</span> <b>' + escapeHtml(header) + '</b>' +
            (version ? ' <span class="live-dim">' + escapeHtml(version) + '</span>' : '') +
            ' <span class="live-dim">' + count + ' branch' + (count === 1 ? '' : 'es') + '</span>' +
          '</div>' +
          trigger +
          '<div class="plan-branches">' + rows + '</div>' +
          buttons +
          '<div class="plan-hint">Reply "yes" to run, or describe what to change. "cancel" to drop.</div>' +
        '</div>'
      );

      // Bind buttons on every inserted row (desktop + mobile chat
      // panels both render the card; need listeners on each). Both
      // cards share a spent-state so clicking in one dims the other.
      var sharedSpent = { settled: false, choice: null };
      function _spendPlanCardRow(card, chosen) {
        card.classList.add("plan-card-spent");
        var all = card.querySelectorAll(".plan-btn");
        for (var i = 0; i < all.length; i++) {
          all[i].disabled = true;
          var btnKey = all[i].classList.contains("plan-btn-accept") ? "accept"
            : all[i].classList.contains("plan-btn-cancel") ? "cancel"
            : "revise";
          if (btnKey !== chosen) all[i].classList.add("plan-btn-unchosen");
          else all[i].classList.add("plan-btn-chosen");
        }
      }
      function _spendAllCards(chosen) {
        sharedSpent.settled = true;
        sharedSpent.choice = chosen;
        (insertedRows || []).forEach(function(c) { if (c) _spendPlanCardRow(c, chosen); });
      }
      (insertedRows || []).forEach(function(card) {
        if (!card) return;
        var accept = card.querySelector(".plan-btn-accept");
        var cancel = card.querySelector(".plan-btn-cancel");
        var revise = card.querySelector(".plan-btn-revise");
        if (accept) accept.addEventListener("click", function() {
          if (sharedSpent.settled) return;
          _spendAllCards("accept");
          if (typeof window !== "undefined" && window.TreeApp && typeof window.TreeApp.sendMessage === "function") {
            window.TreeApp.sendMessage("yes");
          }
        });
        if (cancel) cancel.addEventListener("click", function() {
          if (sharedSpent.settled) return;
          _spendAllCards("cancel");
          if (typeof window !== "undefined" && window.TreeApp && typeof window.TreeApp.sendMessage === "function") {
            window.TreeApp.sendMessage("cancel");
          }
        });
        if (revise) revise.addEventListener("click", function() {
          if (sharedSpent.settled) return;
          _spendAllCards("revise");
          var input = document.getElementById("chatInput") || document.getElementById("mobileSheetInput");
          if (input) {
            input.focus();
            if (!input.value) input.placeholder = "describe what to change about the plan\\u2026";
          }
        });
      });
    }

    socket.on("swarmPlanProposed", function(ev) { _renderPlanCard(ev, false); });
    socket.on("swarmPlanUpdated",  function(ev) { _renderPlanCard(ev, true); });
    socket.on("swarmPlanArchived", function(ev) {
      var count = ev && ev.branchCount != null
        ? ev.branchCount + " branch" + (ev.branchCount === 1 ? "" : "es")
        : "plan";
      var reason = ev && ev.reason ? " \\u00b7 " + escapeHtml(ev.reason) : "";
      _liveAddLine("plan-archived",
        '<span class="live-dim">\\ud83d\\udce6 archived </span><b>' + escapeHtml(count) + '</b>' +
        '<span class="live-dim">' + reason + '</span>'
      );
    });

    // ── Scout phase events — seam verification after builders finish ──
    socket.on("swarmScoutsDispatched", function(ev) {
      var cycle = ev && ev.cycle != null ? " (cycle " + ev.cycle + ")" : "";
      var n = ev && ev.branchCount != null
        ? ev.branchCount + " branch" + (ev.branchCount === 1 ? "" : "es")
        : "project";
      _liveAddLine("scout-dispatch",
        '<span class="live-scout">\\ud83d\\udd0d</span> dispatching scouts<span class="live-dim">' +
        escapeHtml(cycle) + ' over ' + escapeHtml(n) + '\\u2026</span>'
      );
    });
    socket.on("swarmScoutReport", function(ev) {
      var branch = (ev && ev.branch) ? String(ev.branch) : "?";
      var detail = _liveOneLine((ev && ev.detail) || "(no detail)", 180);
      var counter = (ev && ev.counterpartBranch)
        ? ' <span class="live-dim">\\u2194 ' + escapeHtml(ev.counterpartBranch) + '</span>'
        : '';
      _liveAddLine("scout-report",
        '<span class="live-scout-warn">\\u26a0</span> <b>' + escapeHtml(branch) + '</b>' + counter +
        '<span class="live-dim">: ' + escapeHtml(detail) + '</span>'
      );
    });
    socket.on("swarmIssuesRouted", function(ev) {
      var total = (ev && ev.total) || 0;
      var cycle = ev && ev.cycle != null ? "cycle " + ev.cycle + " \\u00b7 " : "";
      if (total === 0) {
        _liveAddLine("scout-clean",
          '<span class="live-ok">\\u2713</span> <span class="live-dim">' + escapeHtml(cycle) + 'no mismatches found</span>'
        );
      } else {
        var affected = (ev && Array.isArray(ev.affectedBranches)) ? ev.affectedBranches : [];
        var suffix = affected.length
          ? ' \\u2192 ' + affected.slice(0, 6).join(", ") +
            (affected.length > 6 ? " +" + (affected.length - 6) : "")
          : "";
        _liveAddLine("scout-route",
          '<span class="live-scout-route">\\ud83d\\udcec</span> routing <b>' + total + ' issue' +
          (total === 1 ? "" : "s") + '</b><span class="live-dim">' + escapeHtml(suffix) + '</span>'
        );
      }
    });
    socket.on("swarmRedeploying", function(ev) {
      var cycle = ev && ev.cycle != null ? " (cycle " + (ev.cycle + 1) + ")" : "";
      var names = (ev && Array.isArray(ev.branches)) ? ev.branches.join(", ") : "";
      _liveAddLine("scout-redeploy",
        '<span class="live-scout-redeploy">\\ud83d\\udd27</span> redeploying<span class="live-dim">' +
        escapeHtml(cycle) + ': </span><b>' + escapeHtml(names) + '</b>'
      );
    });
    socket.on("swarmReconciled", function(ev) {
      var cycles = (ev && ev.cycles != null) ? ev.cycles + " cycle" + (ev.cycles === 1 ? "" : "s") : "";
      var status = (ev && ev.status) || "done";
      var total = (ev && ev.totalIssues != null) ? ", " + ev.totalIssues + " issue" + (ev.totalIssues === 1 ? "" : "s") : "";
      var cls = status === "clean" ? "live-ok"
        : status === "stuck" ? "live-scout-warn"
        : status === "capped" ? "live-scout-warn"
        : "live-dim";
      _liveAddLine("scout-reconciled",
        '<span class="' + cls + '">\\u2713</span> swarm reconciled<span class="live-dim"> (' +
        escapeHtml(status) + (cycles ? ' \\u00b7 ' + escapeHtml(cycles) : '') + escapeHtml(total) + ')</span>'
      );
    });

    // Stream extension: message was accumulated for mid-flight injection.
    // The user bubble already carries a "merged" chip (see addMessage), so
    // we no longer render a separate system row — just log the server ACK.
    socket.on("messageQueued", ({ message, status }) => {
      console.log("[stream] queued:", message?.slice(0, 60), status || "merged");
    });
socket.on("executionStatus", function(ev) {
  if (!ev || (!ev.text && (ev.phase === "intent" || ev.phase === "done"))) return;
  _liveAddLine("status", '<span class="live-dot">\\u00b7</span> ' + escapeHtml(ev.text || ev.phase));
});

socket.on("orchestratorStep", function(ev) {
  var mode = ev && ev.modeKey ? String(ev.modeKey) : "?";

  // Classifier result: render intent + target mode + confidence inline
  // (\\ud83c\\udfaf extension \\u2192 tree:code-plan conf=0.96 \\u2014 <msg>).
  if (mode === "intent") {
    var parsed = ev.result;
    if (typeof parsed === "string") {
      try { parsed = JSON.parse(parsed); } catch (e) { parsed = null; }
    }
    if (parsed && typeof parsed === "object") {
      var intent = parsed.intent || "?";
      var conf = typeof parsed.confidence === "number" ? " conf=" + parsed.confidence.toFixed(2) : "";
      var targetMode = parsed.mode ? " \\u2192 " + escapeHtml(parsed.mode) : "";
      var summary = parsed.summary ? ' <span class="live-dim">\\u2014 ' + escapeHtml(_liveOneLine(parsed.summary, 120)) + '</span>' : "";
      _liveAddLine("intent", '\\ud83c\\udfaf <b>' + escapeHtml(intent) + '</b>' + targetMode + '<span class="live-dim">' + conf + '</span>' + summary);
      _liveState.lastMode = mode;
      return;
    }
  }
  if (mode !== _liveState.lastMode) {
    _liveAddLine("mode", '\\u21aa <b>' + escapeHtml(mode) + '</b>');
    _liveState.lastMode = mode;
  }
});
    // API
    window.TreeApp = {
      sendMessage: sendChatMessage,
      addMessage,
  navigate: (url) => { 
  loadingOverlay.classList.add("visible"); 
  currentIframeUrl = url;
  iframe.src = buildIframeUrl(url);
},
      goHome: () => { loadingOverlay.classList.add("visible"); iframe.src = CONFIG.homeUrl; currentIframeUrl = CONFIG.homeUrl; },
      isConnected: () => isConnected,
      isRegistered: () => isRegistered,
      notifyNodeUpdated: (nodeId, changes) => { if (isRegistered) socket.emit("nodeUpdated", { nodeId, changes }); },
      notifyNodeNavigated: (nodeId, nodeName) => { if (isRegistered) socket.emit("nodeNavigated", { nodeId, nodeName }); },
      notifyNodeSelected: (nodeId, nodeName) => { if (isRegistered) socket.emit("nodeSelected", { nodeId, nodeName }); },
      notifyNodeCreated: (nodeId, nodeName, parentId) => { if (isRegistered) socket.emit("nodeCreated", { nodeId, nodeName, parentId }); },
      notifyNodeDeleted: (nodeId, nodeName) => { if (isRegistered) socket.emit("nodeDeleted", { nodeId, nodeName }); },
      notifyNoteCreated: (nodeId, noteContent) => { if (isRegistered) socket.emit("noteCreated", { nodeId, noteContent }); },
      clearConversation: () => { if (isRegistered) socket.emit("clearConversation"); },
      switchMode: (modeKey) => { if (isRegistered) socket.emit("switchMode", { modeKey }); },
      getCurrentMode: () => currentModeKey,
      getAvailableModes: () => availableModes,
      getRecentRoots: () => recentRoots,
      navigateToRoot: navigateToRoot
    };

    ${dashboardJS()}
  </script>
</body>
</html>`);
  } catch (err) {
    console.error(err);
    res.status(500).send("Failed to load app");
  }
});

export default router;
