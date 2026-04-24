// routesURL/chat.js
// Simple chat-only interface for tree conversations.
// No iframe, no tree view — just pick a tree and talk.

import express from "express";
import { sendOk, sendError, ERR, DELETED } from "../../../seed/protocol.js";
import User from "../../../seed/models/user.js";
import Node from "../../../seed/models/node.js";
import LlmConnection from "../../../seed/models/llmConnection.js";
import authenticateLite from "../../html-rendering/authenticateLite.js";
import { getExtension } from "../../loader.js";
import { notFoundPage } from "../../html-rendering/notFoundPage.js";
import { getLandUrl, getLandIdentity } from "../../../canopy/identity.js";
import { isHtmlEnabled } from "../../html-rendering/config.js";

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
    if (!isHtmlEnabled()) {
      return sendError(res, 404, ERR.EXTENSION_NOT_FOUND, "Server-rendered HTML is disabled. Use the SPA frontend.");
    }
    if (!req.userId) {
      return res.redirect("/login");
    }

    const user = await User.findById(req.userId).select(
      "username metadata llmDefault isAdmin",
    );
    if (!user) {
      return notFoundPage(req, res, "This user doesn't exist.");
    }

    const { getUserMeta } = await import("../../../seed/tree/userMetadata.js");
    const nav = getUserMeta(user, "nav");
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

    const { username } = user;

    // Load user's trees
    const rootIds = userRoots.map(String);
    let trees = [];
    if (rootIds.length > 0) {
      trees = await Node.find({ _id: { $in: rootIds }, parent: { $ne: DELETED } })
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

    // Load app data for hotbar (life domains)
    let appsJSON = "[]";
    try {
      const life = getExtension("life");
      if (life?.exports?.findLifeRoot && life?.exports?.getDomainNodes) {
        const lifeRootId = await life.exports.findLifeRoot(req.userId);
        if (lifeRootId) {
          const domains = await life.exports.getDomainNodes(lifeRootId);
          const APP_META = {
            food: { emoji: "🍎", name: "Food", path: "food" },
            fitness: { emoji: "💪", name: "Fitness", path: "fitness" },
            recovery: { emoji: "🌿", name: "Recovery", path: "recovery" },
            study: { emoji: "📚", name: "Study", path: "study" },
            kb: { emoji: "📖", name: "KB", path: "kb" },
            relationships: { emoji: "👥", name: "Relationships", path: "relationships" },
            finance: { emoji: "💰", name: "Finance", path: "finance" },
            investor: { emoji: "📈", name: "Investor", path: "investor" },
            "market-researcher": { emoji: "🔬", name: "Research", path: "market-researcher" },
          };
          const apps = [];
          for (const [key, info] of Object.entries(domains)) {
            const meta = APP_META[key];
            if (meta) apps.push({ key, id: info.id, name: info.name, emoji: meta.emoji, label: meta.name, path: meta.path, treeRootId: lifeRootId });
          }
          appsJSON = JSON.stringify(apps);
        }
      }
    } catch {}

    const landName = getLandIdentity()?.name || "TreeOS";

    return res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Chat - ${landName}</title>
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
  <meta name="theme-color" content="#0d1117" />
  <link rel="icon" href="/tree.png" />
  <link rel="canonical" href="${getLandUrl()}/chat" />
  <meta name="robots" content="noindex, nofollow" />
  <meta name="description" content="Chat with your knowledge trees on ${landName}." />
  <meta property="og:title" content="Chat - ${landName}" />
  <meta property="og:description" content="Chat with your knowledge trees on ${landName}." />
  <meta property="og:url" content="${getLandUrl()}/chat" />
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

      --accent:      #7dd385;
      --accent-glow: rgba(125, 211, 133, 0.5);
      --error:       #c97e6a;

      /* Legacy aliases */
      --glass-rgb:          22, 27, 36;
      --glass-alpha:        1;
      --glass-blur:         0px;
      --glass-border:       #232a38;
      --glass-border-light: #232a38;
      --glass-highlight:    #2f3849;

      --header-height: 56px;
      --transition-fast: 150ms cubic-bezier(0.4, 0, 0.2, 1);
    }

    * { box-sizing: border-box; margin: 0; padding: 0; -webkit-tap-highlight-color: transparent; }
    html, body { height: 100%; width: 100%; overflow: hidden; font-family: 'DM Sans', -apple-system, sans-serif; color: var(--text-primary); }
    html { background: var(--bg); }
    body { background: var(--bg); }

    /* Layout */
    .container {
      height: 100%; width: 100%;
      display: flex; flex-direction: column;
      max-width: 800px; margin: 0 auto;
    }
    @media (min-width: 1000px) {
      .container { max-width: 1100px; }
    }

    /* Scrollable wrapper for the home/trees/land zones so the page
       scrolls internally instead of overflowing into the header. */
    .zones {
      flex: 1;
      min-height: 0;
      overflow-y: auto;
      padding: 12px 0 16px;
      scrollbar-width: thin;
      scrollbar-color: rgba(255,255,255,0.18) transparent;
    }
    .zones::-webkit-scrollbar { width: 8px; }
    .zones::-webkit-scrollbar-track { background: transparent; }
    .zones::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.15); border-radius: 4px; }
    .zones::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.3); }

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
    .back-row {
      display: none; padding: 8px 20px 0;
      border-bottom: none; flex-shrink: 0;
    }
    .back-row.visible { display: flex; }
    .back-btn {
      display: flex; align-items: center; gap: 6px;
      font-size: 12px; color: var(--text-muted);
      background: rgba(255,255,255,0.1); border-radius: 8px;
      padding: 6px 12px; border: 1px solid var(--glass-border-light);
      cursor: pointer; transition: all var(--transition-fast);
      font-family: inherit;
    }
    .back-btn:hover { background: rgba(255,255,255,0.18); color: var(--text-primary); }
    .back-btn svg { width: 12px; height: 12px; }

    .status-badge { display: flex; align-items: center; gap: 8px; padding: 6px 14px; background: rgba(255, 255, 255, 0.15); backdrop-filter: blur(10px); border-radius: 100px; border: 1px solid var(--glass-border-light); font-size: 12px; font-weight: 600; }
    .status-badge .status-text { display: inline; }
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

    /* Zone sections (home, trees, land) */
    .zone-section {
      margin: 0 12px 12px;
      border: 1px solid var(--border);
      border-radius: 12px;
      overflow: hidden;
      background: var(--bg);
    }

    /* Wide-screen layout. Non-admin: home full-width on top, trees below.
       Admin: home + land sit side-by-side up top, trees spans below. */
    @media (min-width: 900px) {
      .zones {
        display: grid;
        grid-template-columns: 1fr;
        grid-template-areas:
          "home"
          "trees";
        gap: 0;
        padding: 12px 0 16px;
      }
      #zoneHome  { grid-area: home; }
      #zoneTrees { grid-area: trees; }

      .zones.zones-admin {
        grid-template-columns: 1fr 1fr;
        grid-template-areas:
          "home  land"
          "trees trees";
      }
      .zones.zones-admin #zoneHome { margin-right: 6px; }
      .zones.zones-admin #zoneLand { grid-area: land; margin-left: 6px; }
    }
    .zone-label {
      padding: 10px 16px;
      font-size: 0.8rem;
      font-weight: 600;
      color: var(--text-muted);
      background: var(--bg-elevated);
      border-bottom: 1px solid var(--border);
      font-family: 'JetBrains Mono', monospace;
      letter-spacing: 0.02em;
    }
    .zone-messages {
      max-height: 280px;
      overflow-y: auto;
      padding: 12px 16px;
      display: flex;
      flex-direction: column;
      gap: 8px;
      scrollbar-width: thin;
      scrollbar-color: rgba(255,255,255,0.15) transparent;
    }
    .zone-messages::-webkit-scrollbar { width: 6px; }
    .zone-messages::-webkit-scrollbar-track { background: transparent; }
    .zone-messages::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.12); border-radius: 3px; }
    .zone-messages::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.25); }
    .zone-messages:empty::after {
      content: "Say something...";
      color: var(--text-muted);
      font-size: 0.85rem;
      text-align: center;
      padding: 24px 0;
    }
    .zone-input {
      display: flex;
      gap: 8px;
      padding: 10px 12px;
      border-top: 1px solid var(--border);
      background: var(--bg-elevated);
      align-items: flex-end;
    }
    .zone-input textarea {
      flex: 1;
      background: var(--bg);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 8px 12px;
      color: var(--text-primary);
      font-family: inherit;
      font-size: 0.9rem;
      resize: none;
      outline: none;
      min-height: 36px;
      max-height: 120px;
    }
    .zone-input textarea:focus { border-color: var(--border-strong); }
    .zone-input textarea::placeholder { color: var(--text-muted); }
    .zone-input button {
      background: var(--accent);
      color: var(--bg);
      border: none;
      border-radius: 8px;
      padding: 8px 16px;
      font-weight: 600;
      font-size: 0.85rem;
      cursor: pointer;
      font-family: inherit;
      flex-shrink: 0;
      height: 36px;
    }
    .zone-input button:disabled { opacity: 0.4; cursor: not-allowed; }
    .zone-input button:not(:disabled):hover { filter: brightness(1.1); }
    .zone-msg {
      padding: 8px 12px;
      border-radius: 10px;
      font-size: 0.9rem;
      line-height: 1.5;
      max-width: 85%;
      word-wrap: break-word;
      white-space: pre-wrap;
    }
    .zone-msg.user {
      align-self: flex-end;
      background: var(--bg-elevated);
      border: 1px solid var(--border);
      color: var(--text-primary);
    }
    .zone-msg.assistant {
      align-self: flex-start;
      background: rgba(125, 211, 133, 0.06);
      border: 1px solid rgba(125, 211, 133, 0.15);
      color: var(--text-secondary);
    }
    .zone-msg.error {
      align-self: flex-start;
      background: rgba(201, 126, 106, 0.08);
      border: 1px solid rgba(201, 126, 106, 0.2);
      color: var(--error);
      font-size: 0.85rem;
    }
    .zone-msg.thinking {
      align-self: flex-start;
      color: var(--text-muted);
      font-size: 0.85rem;
      font-style: italic;
    }

    /* Tree picker */
    .tree-picker {
      padding: 12px 16px 4px;
    }
    /* Responsive tree-list grid. Cards self-size; on narrow screens
       they collapse to one column, on wider screens fill with as many
       as fit at minmax(220px, 1fr). */
    .tree-list {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
      gap: 10px;
      width: 100%;
    }
    .tree-item {
      background: rgba(var(--glass-rgb), var(--glass-alpha));
      border: 1px solid var(--glass-border-light);
      border-radius: 12px;
      padding: 14px 16px;
      cursor: pointer;
      transition: background var(--transition-fast), transform var(--transition-fast), border-color var(--transition-fast);
      display: flex; align-items: center; gap: 12px;
      min-height: 56px;
      animation: fadeInUp 0.3s ease-out backwards;
    }
    .tree-item:hover {
      background: var(--bg-hover);
      border-color: var(--border-strong);
      transform: translateY(-1px);
    }
    .tree-item:active { transform: translateY(0) scale(0.98); }
    .tree-item-left { display: flex; align-items: center; gap: 12px; min-width: 0; flex: 1; }
    .tree-item-icon { font-size: 20px; flex-shrink: 0; }
    .tree-item-name { font-size: 14px; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
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
      flex-shrink: 0; padding-bottom: 8px;
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
    .chat-messages::-webkit-scrollbar { width: 4px; }
    .chat-messages::-webkit-scrollbar-track { background: transparent; margin: 8px 0; }
    .chat-messages::-webkit-scrollbar-thumb { background: rgba(255, 255, 255, 0.12); border-radius: 4px; }
    .chat-messages::-webkit-scrollbar-thumb:hover { background: rgba(255, 255, 255, 0.25); }
    .chat-messages { scrollbar-width: thin; scrollbar-color: rgba(255, 255, 255, 0.12) transparent; }

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

    /* Live event stream — mirrors the CLI liveRenderer. Each line is
       a single-row dimmed status inserted between the user bubble and
       the typing indicator during a turn. They stay in the transcript
       after the answer lands so the user can scroll the trace. */
    .live-line {
      margin: 2px 0 2px 50px;
      padding: 2px 10px;
      font-size: 12px;
      line-height: 1.5;
      font-family: 'SF Mono', 'Fira Code', 'Consolas', monospace;
      color: rgba(255, 255, 255, 0.75);
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
    .live-line-thinking { color: rgba(210, 170, 255, 0.8); font-style: italic; }
    .live-line-tool-call { padding-left: 20px; }
    .live-line-tool-ok, .live-line-tool-fail { padding-left: 20px; }
    .live-line-branch-start { padding-left: 20px; }
    .live-line-branch-ok, .live-line-branch-fail { padding-left: 20px; }
    @keyframes liveIn { from { opacity: 0; transform: translateY(-2px); } to { opacity: 1; transform: translateY(0); } }

    /* Plan-card for proposed / updated swarm plans */
    .live-line-plan-card { padding: 0; margin-top: 8px; margin-bottom: 8px; font-family: inherit; }
    .plan-card { background: rgba(140,180,240,0.08); border: 1px solid rgba(140,180,240,0.35); border-left: 3px solid rgba(140,180,240,0.85); border-radius: 10px; padding: 12px 16px; color: rgba(255,255,255,0.9); }
    .plan-card-head { font-size: 13px; margin-bottom: 6px; }
    .plan-trigger { font-size: 11px; color: rgba(255,255,255,0.55); margin: 2px 0 8px 0; }
    .plan-branches { display: flex; flex-direction: column; gap: 4px; margin: 6px 0; }
    .plan-branch { font-family: 'SF Mono', 'Fira Code', monospace; font-size: 11px; padding: 4px 8px; background: rgba(0,0,0,0.15); border-radius: 4px; }
    .plan-branch b { color: rgba(200,220,255,0.95); }
    .plan-branch .plan-path, .plan-branch .plan-mode, .plan-branch .plan-files { color: rgba(255,255,255,0.5); margin-left: 6px; }
    .plan-spec { color: rgba(255,255,255,0.75); margin-top: 3px; font-size: 11px; line-height: 1.5; font-family: inherit; }
    .plan-actions { display: flex; gap: 8px; margin-top: 10px; }
    .plan-btn { padding: 6px 14px; font-size: 12px; font-weight: 600; border: 1px solid rgba(255,255,255,0.25); border-radius: 6px; background: rgba(255,255,255,0.08); color: rgba(255,255,255,0.9); cursor: pointer; transition: all 0.15s; }
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

    /* Input — matches app.js */
    .chat-input-area { padding: 16px 20px 20px; border-top: 1px solid var(--glass-border-light); }
    .input-container { display: flex; align-items: flex-end; gap: 12px; padding: 14px 18px; background: rgba(255, 255, 255, 0.15); backdrop-filter: blur(10px); border: 1px solid var(--glass-border-light); border-radius: 18px; transition: all var(--transition-fast); }
    .input-container:focus-within { background: rgba(255, 255, 255, 0.2); border-color: rgba(255, 255, 255, 0.4); box-shadow: 0 0 0 4px rgba(255, 255, 255, 0.1); }
    .chat-input { flex: 1; min-width: 0; background: transparent; border: none; outline: none; font-family: inherit; font-size: 15px; color: var(--text-primary); resize: none; max-height: 120px; line-height: 1.5; overflow-y: auto; }
    .chat-input::-webkit-scrollbar { width: 4px; }
    .chat-input::-webkit-scrollbar-track { background: transparent; }
    .chat-input::-webkit-scrollbar-thumb { background: rgba(255, 255, 255, 0.15); border-radius: 4px; }
    .chat-input::-webkit-scrollbar-thumb:hover { background: rgba(255, 255, 255, 0.3); }
    .chat-area.empty .chat-input { max-height: 40vh; }
    .chat-input::placeholder { color: var(--text-muted); }
    .chat-input:disabled { opacity: 0.5; cursor: not-allowed; }
    .send-btn { width: 40px; height: 40px; display: flex; align-items: center; justify-content: center; background: var(--accent); border: none; border-radius: 12px; color: white; cursor: pointer; transition: all var(--transition-fast); flex-shrink: 0; box-shadow: 0 4px 15px var(--accent-glow); }
    .send-btn:hover:not(:disabled) { transform: scale(1.08); box-shadow: 0 6px 25px var(--accent-glow); }
    .send-btn:disabled { opacity: 0.4; cursor: not-allowed; }
    .send-btn svg { width: 20px; height: 20px; }
    .send-btn.stop-mode { background: rgba(239, 68, 68, 0.7); box-shadow: 0 4px 15px rgba(239, 68, 68, 0.4); }
    .send-btn.stop-mode:hover:not(:disabled) { background: rgba(239, 68, 68, 0.9); box-shadow: 0 6px 25px rgba(239, 68, 68, 0.5); }

    /* Mode toggle */
    .mode-toggle { display: flex; gap: 4px; padding: 0 2px 10px; }
    .mode-btn { padding: 4px 14px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.12); background: rgba(255,255,255,0.06); color: var(--text-muted); font-size: 12px; font-weight: 500; cursor: pointer; transition: all var(--transition-fast); font-family: inherit; }
    .mode-btn:hover { background: rgba(255,255,255,0.12); color: var(--text-secondary); }
    .mode-btn.active { background: rgba(255,255,255,0.18); color: var(--text-primary); border-color: rgba(255,255,255,0.25); }
    .mode-btn.active[data-mode="chat"] { background: var(--accent); border-color: var(--accent); color: #fff; }
    .mode-btn.active[data-mode="place"] { background: rgba(72,187,120,0.4); border-color: rgba(72,187,120,0.5); color: #fff; }
    .mode-btn.active[data-mode="query"] { background: rgba(115,111,230,0.4); border-color: rgba(115,111,230,0.5); color: #fff; }
    .mode-hint { font-size: 11px; color: var(--text-muted); padding: 0 4px 6px; opacity: 0.7; }

    /* Place result message */
    .place-result { font-size: 13px; color: var(--text-muted); padding: 8px 14px; background: rgba(72,187,120,0.08); border-radius: 12px; border: 1px solid rgba(72,187,120,0.15); margin: 4px 0; }

    /* Empty state — input pinned to vertical center, welcome above it */
    .chat-area.empty { position: relative; }
    .chat-area.empty .chat-input-area { position: absolute; top: 40%; left: 50%; transform: translate(-50%, 0); border-top: none; max-width: 600px; width: calc(100% - 40px); }
    .chat-area.empty .chat-messages { position: absolute; top: 40%; left: 0; right: 0; transform: translateY(-100%); display: flex; flex-direction: column; align-items: center; overflow: visible; flex: none; }

    /* Welcome message */
    .welcome-message { text-align: center; padding: 40px 20px; }
    .welcome-icon { font-size: 64px; margin-bottom: 20px; display: inline-block; filter: drop-shadow(0 8px 32px rgba(0, 0, 0, 0.3)); animation: floatIcon 3s ease-in-out infinite; }
    @keyframes floatIcon { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-10px); } }
    .chat-area.empty .welcome-message { padding: 8px 20px; }
    .chat-area.empty .welcome-icon { font-size: 48px; margin-bottom: 12px; }
    .chat-area.empty .welcome-message h2 { font-size: 18px; margin-bottom: 6px; }
    .chat-area.empty .welcome-message p { font-size: 13px; }
    .welcome-message h2 { font-size: 24px; font-weight: 600; margin-bottom: 12px; }
    .welcome-message p { font-size: 15px; color: var(--text-secondary); line-height: 1.6; }
    .welcome-message.disconnected { opacity: 0.7; }
    .welcome-message.disconnected .welcome-icon { filter: grayscale(0.5) drop-shadow(0 8px 32px rgba(0, 0, 0, 0.3)); animation: none; }

    /* Notifications panel */
    .clear-chat-btn {
      background: rgba(255,255,255,0.1); border: 1px solid var(--glass-border-light);
      border-radius: 8px; padding: 6px 8px; cursor: pointer;
      color: var(--text-muted); transition: all var(--transition-fast);
      display: none; align-items: center; justify-content: center;
    }
    .clear-chat-btn.visible { display: flex; }
    .clear-chat-btn:hover { background: rgba(255,255,255,0.2); color: var(--text-primary); }
    .clear-chat-btn:active { transform: scale(0.93); }
    .clear-chat-btn svg { width: 14px; height: 14px; }
    .notif-btn {
      font-size: 12px; color: var(--text-muted);
      background: rgba(255,255,255,0.1); border-radius: 8px;
      padding: 6px 14px; border: 1px solid var(--glass-border-light);
      cursor: pointer; transition: all var(--transition-fast);
      font-family: inherit; position: relative;
      display: flex; align-items: center; gap: 6px;
    }
    .notif-btn:hover { background: rgba(255,255,255,0.18); color: var(--text-primary); }
    .notif-btn-icon { display: none; font-size: 14px; line-height: 1; }
    .notif-btn .notif-dot {
      position: absolute; top: -3px; right: -3px;
      width: 8px; height: 8px; border-radius: 50%;
      background: var(--accent); box-shadow: 0 0 8px var(--accent-glow);
      display: none;
    }
    .notif-btn .notif-dot.has-notifs { display: block; }

    .notif-overlay {
      position: fixed; inset: 0; background: rgba(0,0,0,0.4);
      z-index: 9998; display: none;
    }
    .notif-overlay.open { display: block; }

    .notif-panel {
      position: fixed; top: 0; right: -400px; bottom: 0;
      width: 380px; max-width: 90vw;
      background: var(--bg-elevated);
      z-index: 9999;
      display: flex; flex-direction: column;
      transition: right 0.3s cubic-bezier(0.4, 0, 0.2, 1);
      box-shadow: -8px 0 32px rgba(0,0,0,0.3);
    }
    .notif-panel.open { right: 0; }

    .notif-panel-header {
      padding: 20px; display: flex; align-items: center;
      justify-content: space-between; flex-shrink: 0;
      border-bottom: 1px solid var(--glass-border-light);
    }
    .notif-panel-header h2 { font-size: 18px; font-weight: 600; color: white; }
    .notif-close {
      width: 32px; height: 32px; border-radius: 8px;
      background: rgba(255,255,255,0.1); border: 1px solid var(--glass-border-light);
      color: white; cursor: pointer; font-size: 16px; display: flex;
      align-items: center; justify-content: center; transition: all var(--transition-fast);
    }
    .notif-close:hover { background: rgba(255,255,255,0.2); }

    .notif-list {
      flex: 1; overflow-y: auto; padding: 16px;
      display: flex; flex-direction: column; gap: 12px;
    }
    .notif-list::-webkit-scrollbar { width: 6px; }
    .notif-list::-webkit-scrollbar-track { background: transparent; }
    .notif-list::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.2); border-radius: 3px; }

    .notif-item {
      background: rgba(var(--glass-rgb), var(--glass-alpha));
      backdrop-filter: blur(var(--glass-blur)) saturate(140%);
      -webkit-backdrop-filter: blur(var(--glass-blur)) saturate(140%);
      border: 1px solid var(--glass-border-light);
      border-radius: 14px; padding: 16px;
      animation: fadeInUp 0.3s ease-out backwards;
      transition: all var(--transition-fast);
    }
    .notif-item:hover {
      background: rgba(var(--glass-rgb), 0.42);
      transform: translateY(-1px);
    }
    .notif-item.type-thought { border-left: 3px solid #9b64dc; }
    .notif-item.type-summary { border-left: 3px solid #6464d2; }

    .notif-item-header {
      display: flex; align-items: center; gap: 8px; margin-bottom: 8px;
    }
    .notif-item-icon { font-size: 18px; flex-shrink: 0; }
    .notif-item-title {
      font-size: 14px; font-weight: 600; color: white;
      flex: 1; line-height: 1.3;
    }
    .notif-item-badge {
      font-size: 9px; font-weight: 700; text-transform: uppercase;
      letter-spacing: 0.5px; padding: 2px 7px; border-radius: 6px;
      background: rgba(255,255,255,0.12); color: rgba(255,255,255,0.6);
      border: 1px solid rgba(255,255,255,0.1); flex-shrink: 0;
    }
    .notif-item-content {
      font-size: 13px; color: rgba(255,255,255,0.85);
      line-height: 1.55; white-space: pre-wrap; word-break: break-word;
    }
    .notif-item-time {
      font-size: 11px; color: rgba(255,255,255,0.45);
      margin-top: 8px;
    }
    .notif-empty {
      text-align: center; color: rgba(255,255,255,0.5);
      font-size: 14px; padding: 40px 20px;
    }
    .notif-empty-icon { font-size: 40px; margin-bottom: 12px; display: block; }
    .notif-loading { text-align: center; color: rgba(255,255,255,0.5); padding: 40px 20px; font-size: 14px; }

    /* Notification tabs */
    .notif-tabs {
      display: flex; gap: 0; flex-shrink: 0;
      border-bottom: 1px solid var(--glass-border-light);
    }
    .notif-tab {
      flex: 1; padding: 10px 0; text-align: center;
      font-size: 13px; font-weight: 500; color: rgba(255,255,255,0.5);
      background: none; border: none; border-bottom: 2px solid transparent;
      cursor: pointer; font-family: inherit; transition: all var(--transition-fast);
      position: relative;
    }
    .notif-tab:hover { color: rgba(255,255,255,0.8); }
    .notif-tab.active { color: white; border-bottom-color: white; }
    .notif-tab .tab-dot {
      display: none; width: 6px; height: 6px; border-radius: 50%;
      background: var(--accent); position: absolute; top: 8px; right: calc(50% - 30px);
    }
    .notif-tab .tab-dot.visible { display: block; }

    /* Invite items */
    .invite-item {
      background: rgba(var(--glass-rgb), var(--glass-alpha));
      backdrop-filter: blur(var(--glass-blur)) saturate(140%);
      border: 1px solid var(--glass-border-light);
      border-radius: 14px; padding: 16px;
      border-left: 3px solid #48bb78;
      animation: fadeInUp 0.3s ease-out backwards;
    }
    .invite-item-text { font-size: 13px; color: rgba(255,255,255,0.9); line-height: 1.5; margin-bottom: 10px; }
    .invite-item-text strong { color: white; }
    .invite-item-actions { display: flex; gap: 8px; }
    .invite-item-actions button {
      flex: 1; padding: 8px; border-radius: 8px; border: none;
      font-family: inherit; font-size: 12px; font-weight: 600;
      cursor: pointer; transition: all var(--transition-fast);
    }
    .invite-accept { background: var(--accent); color: white; }
    .invite-accept:hover { filter: brightness(1.1); }
    .invite-decline { background: rgba(255,255,255,0.1); color: rgba(255,255,255,0.7); border: 1px solid var(--glass-border-light) !important; }
    .invite-decline:hover { background: rgba(255,255,255,0.18); color: white; }

    /* Members section */
    .members-section { margin-top: 4px; }
    .members-section-title { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; color: rgba(255,255,255,0.4); margin-bottom: 8px; }
    .member-item {
      display: flex; align-items: center; justify-content: space-between;
      padding: 10px 14px; border-radius: 10px;
      background: rgba(var(--glass-rgb), var(--glass-alpha));
      border: 1px solid var(--glass-border-light); margin-bottom: 8px;
    }
    .member-name { font-size: 13px; color: white; font-weight: 500; }
    .member-role { font-size: 11px; color: rgba(255,255,255,0.45); margin-left: 6px; }
    .member-actions { display: flex; gap: 6px; }
    .member-actions button {
      padding: 4px 10px; border-radius: 6px; border: 1px solid var(--glass-border-light);
      background: rgba(255,255,255,0.08); color: rgba(255,255,255,0.6);
      font-family: inherit; font-size: 11px; cursor: pointer;
      transition: all var(--transition-fast);
    }
    .member-actions button:hover { background: rgba(255,255,255,0.15); color: white; }
    .member-actions .btn-danger:hover { background: rgba(239,68,68,0.3); color: #fca5a5; border-color: rgba(239,68,68,0.4); }

    .invite-form {
      display: flex; gap: 8px; margin-top: 12px;
    }
    .invite-form input {
      flex: 1; padding: 8px 12px; border-radius: 8px;
      background: rgba(255,255,255,0.08); border: 1px solid var(--glass-border-light);
      color: white; font-family: inherit; font-size: 13px; outline: none;
    }
    .invite-form input::placeholder { color: rgba(255,255,255,0.35); }
    .invite-form input:focus { border-color: var(--glass-border); }
    .invite-form button {
      padding: 8px 16px; border-radius: 8px; border: none;
      background: var(--accent); color: white; font-family: inherit;
      font-size: 12px; font-weight: 600; cursor: pointer;
      transition: all var(--transition-fast);
    }
    .invite-form button:hover { filter: brightness(1.1); }
    .invite-form button:disabled { opacity: 0.5; cursor: not-allowed; }

    .invite-status {
      font-size: 12px; margin-top: 6px; padding: 6px 10px;
      border-radius: 6px; display: none;
    }
    .invite-status.error { display: block; background: rgba(239,68,68,0.15); color: #fca5a5; }
    .invite-status.success { display: block; background: rgba(16,185,129,0.15); color: #6ee7b7; }

    /* Dream time config */
    .dream-config {
      background: rgba(var(--glass-rgb), var(--glass-alpha));
      border: 1px solid var(--glass-border-light);
      border-radius: 14px; padding: 14px 16px; margin-bottom: 12px;
    }
    .dream-config-label { font-size: 12px; color: rgba(255,255,255,0.5); margin-bottom: 6px; }
    .dream-config-row { display: flex; align-items: center; gap: 8px; }
    .dream-config-row input[type="time"] {
      padding: 6px 10px; border-radius: 8px;
      background: rgba(255,255,255,0.08); border: 1px solid var(--glass-border-light);
      color: white; font-family: inherit; font-size: 13px; outline: none;
      color-scheme: dark;
    }
    .dream-config-row input[type="time"]:focus { border-color: var(--glass-border); }
    .dream-config-row button {
      padding: 6px 12px; border-radius: 8px; border: none;
      font-family: inherit; font-size: 12px; font-weight: 600;
      cursor: pointer; transition: all var(--transition-fast);
    }
    .dream-config-save { background: var(--accent); color: white; }
    .dream-config-save:hover { filter: brightness(1.1); }
    .dream-config-off {
      background: rgba(255,255,255,0.1); color: rgba(255,255,255,0.6);
      border: 1px solid var(--glass-border-light) !important;
    }
    .dream-config-off:hover { background: rgba(255,255,255,0.18); color: white; }
    .dream-config-status { font-size: 11px; color: rgba(255,255,255,0.5); margin-top: 6px; }
    .dream-config-hint { font-size: 12px; color: rgba(255,255,255,0.45); line-height: 1.4; }

    .notif-panel-footer {
      padding: 16px; border-top: 1px solid var(--glass-border-light); flex-shrink: 0;
    }
    .logout-btn {
      width: 100%; padding: 10px; border-radius: 10px;
      background: rgba(239,68,68,0.15); border: 1px solid rgba(239,68,68,0.3);
      color: #fca5a5; font-family: inherit; font-size: 13px;
      cursor: pointer; transition: all var(--transition-fast);
    }
    .logout-btn:hover { background: rgba(239,68,68,0.3); color: #fecaca; }

    @media (max-width: 600px) {
      .container { max-width: 100%; }
      .chat-header { padding: 0 12px; }
      .header-right { gap: 6px; }
      .chat-input-area { padding: 12px 16px 16px; }

      /* Collapse status badge to dot only */
      .status-badge .status-text { display: none; }
      .status-badge { padding: 6px; min-width: 20px; justify-content: center; }

      /* Collapse notifications button to icon only */
      .notif-btn-label { display: none; }
      .notif-btn-icon { display: inline; }
      .notif-btn { padding: 6px 8px; }

      /* Shrink other buttons */
      .advanced-btn { padding: 6px 10px; font-size: 11px; }
      .back-btn { padding: 4px 8px; font-size: 11px; }
      .back-btn svg { width: 10px; height: 10px; }

      /* Hide title text, keep icon */
      .chat-title h1 { display: none; }

      .notif-panel { width: 100%; max-width: 100%; right: -100%; }
      .notif-panel.open { right: 0; }

      /* Empty state — mobile: push to top */
      .chat-area.empty { overflow: visible; }
      .chat-area.empty .chat-messages { position: static; flex: 0; padding-top: 0; transform: none; overflow: visible; }
      .chat-area.empty .chat-input-area { position: static; transform: none; width: 100%; max-width: 100%; margin: 0; }
    }

    /* App dashboard panel (slide-out drawer from right) */
    .app-panel {
      position: fixed; top: 0; right: -500px; bottom: 0;
      width: 480px; max-width: 95vw;
      background: var(--bg-elevated);
      z-index: 9997;
      display: flex; flex-direction: column;
      transition: right 0.3s cubic-bezier(0.4, 0, 0.2, 1);
      box-shadow: -8px 0 32px rgba(0,0,0,0.3);
    }
    .app-panel.visible { right: 0; }
    .app-panel iframe {
      flex: 1; width: 100%; border: none;
      background: transparent;
    }
    .app-panel-header {
      display: flex; align-items: center; justify-content: space-between;
      padding: 14px 20px; flex-shrink: 0;
      border-bottom: 1px solid var(--glass-border-light);
    }
    .app-panel-title {
      font-size: 15px; font-weight: 600; color: white;
      display: flex; align-items: center; gap: 8px;
    }
    .app-panel-close {
      width: 32px; height: 32px; border-radius: 8px;
      background: rgba(255,255,255,0.1); border: 1px solid var(--glass-border-light);
      color: white; cursor: pointer; font-size: 16px; display: flex;
      align-items: center; justify-content: center; transition: all var(--transition-fast);
    }
    .app-panel-close:hover { background: rgba(255,255,255,0.2); }

    /* App hotbar */
    .app-hotbar {
      display: none; flex-shrink: 0;
      border-top: 1px solid var(--glass-border-light);
      padding: 6px 12px;
      overflow-x: auto;
    }
    .app-hotbar.visible { display: flex; }
    .app-hotbar-inner {
      display: flex; gap: 2px; margin: 0 auto;
      justify-content: center;
    }
    .app-hotbar-item {
      display: flex; flex-direction: column; align-items: center; gap: 1px;
      padding: 4px 10px; border-radius: 8px;
      background: none; border: 1px solid transparent;
      color: var(--text-muted); font-size: 9px;
      cursor: pointer; transition: all var(--transition-fast);
      font-family: inherit; min-width: 48px;
    }
    .app-hotbar-item:hover { background: rgba(255,255,255,0.06); color: var(--text-secondary); }
    .app-hotbar-item.active {
      background: rgba(var(--glass-rgb), 0.3);
      border-color: var(--glass-border-light);
      color: white;
    }
    .app-hotbar-emoji { font-size: 18px; }
  </style>
</head>
<body>
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
        <div class="status-badge">
          <div class="status-dot connecting" id="statusDot"></div>
          <span class="status-text" id="statusText">Connecting</span>
        </div>
        <button class="clear-chat-btn" id="clearChatBtn" title="Clear conversation">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
        </button>
        <button class="notif-btn" id="notifBtn" onclick="toggleNotifs()">
          <span class="notif-dot" id="notifDot"></span>
          <span class="notif-btn-icon">☰</span>
          <span class="notif-btn-label">Menu</span>
        </button>
        <a href="/dashboard" class="advanced-btn" id="advancedLink">Advanced</a>
      </div>
    </div>
    <div class="back-row" id="backRow">
      <button class="back-btn" onclick="backToTrees()">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
        Back
      </button>
    </div>

    <!-- Menu panel -->
    <div class="notif-overlay" id="notifOverlay" onclick="toggleNotifs()"></div>
    <div class="notif-panel" id="notifPanel">
      <div class="notif-panel-header">
        <h2>Menu</h2>
        <button class="notif-close" onclick="toggleNotifs()">&#x2715;</button>
      </div>
      <div class="notif-tabs">
        ${getExtension("dreams") ? `<button class="notif-tab active" id="tabDreams" onclick="switchTab('dreams')">Dreams<span class="tab-dot" id="dreamsDot"></span></button>` : ""}
        ${getExtension("team") ? `<button class="notif-tab${getExtension("dreams") ? "" : " active"}" id="tabInvites" onclick="switchTab('invites')">Invites<span class="tab-dot" id="invitesDot"></span></button>` : ""}
      </div>
      ${getExtension("dreams") ? `<div class="notif-list" id="notifList"><div class="notif-loading">Loading...</div></div>` : ""}
      ${getExtension("team") ? `<div class="notif-list" id="invitesList"${getExtension("dreams") ? ' style="display:none"' : ""}><div class="notif-loading">Loading...</div></div>` : ""}
      <div class="notif-panel-footer">
        <button class="logout-btn" onclick="doLogout()">Log out</button>
      </div>
    </div>

    <!-- Scrollable zones wrapper. All home/trees/land sections live here
         so overflow is contained to this region instead of bleeding
         into the header on short viewports. -->
    <div class="zones${user.isAdmin ? " zones-admin" : ""}" id="zonesWrap">

    <!-- Home Zone -->
    <div class="zone-section" id="zoneHome">
      <div class="zone-label">~ Home</div>
      <div class="zone-messages" id="homeMessages"></div>
      <div class="zone-input">
        <textarea id="homeInput" placeholder="Talk about anything..." rows="1"></textarea>
        <button id="homeSendBtn" onclick="sendZoneMessage('home')" disabled>Send</button>
      </div>
    </div>

    <!-- Trees Zone -->
    <div class="zone-section" id="zoneTrees">
      <div class="zone-label" style="display:flex;justify-content:space-between;align-items:center;">
        <span>Trees</span>
        <form style="display:flex;gap:6px;" onsubmit="createTree(event)">
          <input type="text" id="newTreeName" placeholder="New tree..." autocomplete="off" style="background:var(--bg);border:1px solid var(--border);border-radius:6px;padding:4px 8px;color:var(--text-secondary);font-size:0.8rem;width:120px;outline:none;" />
          <button type="submit" style="background:var(--border-strong);border:none;color:var(--text-muted);border-radius:6px;padding:4px 10px;cursor:pointer;font-size:0.8rem;">+</button>
        </form>
      </div>
      <div class="tree-picker" id="treePicker">
        ${
          trees.length > 0
            ? `<div class="tree-list" id="treeList">
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
            : `<div style="padding:16px;color:var(--text-muted);font-size:0.85rem;text-align:center;">No trees yet. Just start talking at home and the tree grows.</div>`
        }
      </div>
    </div>

    ${user.isAdmin ? `
    <!-- Land Zone (admin only) -->
    <div class="zone-section" id="zoneLand">
      <div class="zone-label">/ Land</div>
      <div class="zone-messages" id="landMessages"></div>
      <div class="zone-input">
        <textarea id="landInput" placeholder="Manage your land..." rows="1"></textarea>
        <button id="landSendBtn" onclick="sendZoneMessage('land')" disabled>Send</button>
      </div>
    </div>
    ` : ""}

    </div><!-- /.zones -->

    <div class="app-panel" id="appPanel">
      <div class="app-panel-header">
        <span class="app-panel-title" id="appPanelTitle"></span>
        <button class="app-panel-close" onclick="closeAppPanel()">x</button>
      </div>
      <iframe id="appPanelFrame" sandbox="allow-same-origin allow-scripts allow-forms"></iframe>
    </div>
    <div class="chat-area empty" id="chatArea">
      <div class="chat-messages" id="messages">
        <div class="welcome-message" id="welcomeMsg">
          <div class="welcome-icon">🌳</div>
          <h2>Start chatting</h2>
          <p>Just type. Natural language works. Say hello, log food, ask a question, or tell it something new.</p>
          <p style="margin-top:8px;font-size:13px;color:var(--text-tertiary);">Connect via CLI too: <code style="background:rgba(255,255,255,0.06);padding:2px 6px;border-radius:4px;">npm i -g treeos</code> . <a href="/cli" style="color:inherit;text-decoration:underline;" target="_blank">Reference</a></p>
        </div>
      </div>
      <div class="chat-input-area">
        <div class="mode-toggle" id="modeToggle">
          <button class="mode-btn active" data-mode="chat">Chat</button>
          <button class="mode-btn" data-mode="place">Place</button>
          <button class="mode-btn" data-mode="query">Query</button>
        </div>
        <div class="input-container">
          <textarea class="chat-input" id="chatInput" placeholder="Say something..." rows="1"></textarea>
          <button class="send-btn" id="sendBtn" disabled>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/></svg>
          </button>
        </div>
      </div>
      <div class="app-hotbar" id="appHotbar"><div class="app-hotbar-inner" id="appHotbarInner"></div></div>
    </div>
  </div>

  <script src="/socket.io/socket.io.js"></script>
  <script>
    const CONFIG = {
      username: "${escapeHtml(username)}",
      userId: "${req.userId}",
      trees: ${treesJSON},
      apps: ${appsJSON},
      landName: "${landName.replace(/"/g, '\\"')}",
      isAdmin: ${!!user.isAdmin},
    };

    // State
    let activeRootId = null;
    let isConnected = false;
    let isRegistered = false;
    let isSending = false;
    let requestGeneration = 0;
    let chatMode = "chat";

    // Mode toggle
    const modeToggle = document.getElementById("modeToggle");
    const modePlaceholders = { chat: "Full conversation. Places content and responds.", place: "Places content onto your tree but doesn't respond.", query: "Talk to your tree without it making any changes." };
    modeToggle.addEventListener("click", function(e) {
      var btn = e.target.closest(".mode-btn");
      if (!btn || isSending) return;
      chatMode = btn.dataset.mode;
      modeToggle.querySelectorAll(".mode-btn").forEach(function(b) { b.classList.remove("active"); });
      btn.classList.add("active");
      document.getElementById("chatInput").placeholder = modePlaceholders[chatMode] || "Say something...";
    });

    // Elements
    const statusDot = document.getElementById("statusDot");
    const statusText = document.getElementById("statusText");
    const treePicker = document.getElementById("treePicker");
    const chatArea = document.getElementById("chatArea");
    const chatMessages = document.getElementById("messages");
    const chatInput = document.getElementById("chatInput");
    const sendBtn = document.getElementById("sendBtn");
    const backRow = document.getElementById("backRow");
    const rootName = document.getElementById("rootName");
    const advancedLink = document.getElementById("advancedLink");

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

        // Clear disconnected message on reconnect
        const disc = chatMessages.querySelector(".welcome-message.disconnected");
        if (disc) {
          disc.remove();
          chatMessages.innerHTML = '<div class="welcome-message" id="welcomeMsg"><div class="welcome-icon">🌳</div><h2>Start chatting</h2><p>Just type. Natural language works.</p></div>';
          chatArea.classList.add("empty");
        }

        updateSendBtn();
        if (activeRootId) {
          socket.emit("setActiveRoot", { rootId: activeRootId });
          socket.emit("urlChanged", { url: "/api/v1/root/" + activeRootId, rootId: activeRootId });
        }
      }
    });

    socket.on("chatResponse", ({ answer, generation, targetNodeId }) => {
      if (generation !== undefined && generation < requestGeneration) return;
      removeTyping();
      addMessage(answer, "assistant");
      isSending = false;
      updateSendBtn();

      // Surface app dashboard if the response routed to an extension node
      if (targetNodeId && targetNodeId !== activeRootId) {
        surfaceApp(targetNodeId);
      }
    });

    // ── Live reasoning stream ───────────────────────────────────────
    // Mirrors the CLI liveRenderer: the moment a message is sent, a
    // row of dimmed status lines appears between the user bubble and
    // the typing indicator, showing what the AI is doing right now.
    // Every line stays in the transcript so the user can scroll back
    // through the trace of a turn later.
    var _liveState = { lastMode: null, lastThinking: null };

    function addLiveLine(classSuffix, html) {
      const welcome = chatMessages.querySelector(".welcome-message");
      if (welcome) {
        welcome.remove();
        document.getElementById("chatArea").classList.remove("empty");
      }
      const typing = document.getElementById("typingIndicator");
      const row = document.createElement("div");
      row.className = "live-line live-line-" + classSuffix;
      row.innerHTML = html;
      if (typing) chatMessages.insertBefore(row, typing);
      // Returning the inserted row lets callers (plan card, branch
      // tickers) bind click listeners directly without selector
      // gymnastics — :last-of-type matches by element TYPE, not by
      // class, and was binding to the wrong element when other divs
      // followed in chatMessages.
      else chatMessages.appendChild(row);
      chatMessages.scrollTop = chatMessages.scrollHeight;
      return row;
    }

    function oneLineLive(s, max) {
      if (!s) return "";
      var flat = String(s).replace(/\\s+/g, " ").trim();
      return flat.length <= max ? flat : flat.slice(0, max - 1) + "\\u2026";
    }

    function formatLiveArgs(args) {
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

    socket.on("executionStatus", function(ev) {
      // "intent" / "done" phase with no text is just a progress marker.
      if (!ev || (!ev.text && (ev.phase === "intent" || ev.phase === "done"))) return;
      addLiveLine("status", '<span class="live-dot">\\u00b7</span> ' + escapeHtml(ev.text || ev.phase));
    });

    socket.on("orchestratorStep", function(ev) {
      var mode = ev && ev.modeKey ? String(ev.modeKey) : "?";

      // Classifier result: render the chosen intent + target mode + confidence
      // the same way the CLI does (\\ud83c\\udfaf extension \\u2192 tree:code-plan conf=0.96).
      if (mode === "intent") {
        var parsed = ev.result;
        if (typeof parsed === "string") {
          try { parsed = JSON.parse(parsed); } catch (e) { parsed = null; }
        }
        if (parsed && typeof parsed === "object") {
          var intent = parsed.intent || "?";
          var conf = typeof parsed.confidence === "number" ? " conf=" + parsed.confidence.toFixed(2) : "";
          var targetMode = parsed.mode ? " \\u2192 " + escapeHtml(parsed.mode) : "";
          var summary = parsed.summary ? ' <span class="live-dim">\\u2014 ' + escapeHtml(oneLineLive(parsed.summary, 120)) + '</span>' : "";
          addLiveLine("intent", '\\ud83c\\udfaf <b>' + escapeHtml(intent) + '</b>' + targetMode + '<span class="live-dim">' + conf + '</span>' + summary);
          _liveState.lastMode = mode;
          return;
        }
      }
      if (mode !== _liveState.lastMode) {
        addLiveLine("mode", '\\u21aa <b>' + escapeHtml(mode) + '</b>');
        _liveState.lastMode = mode;
      }
    });

    socket.on("modeSwitched", function(ev) {
      var m = ev && (ev.mode || ev.modeKey || ev.to);
      if (!m || m === _liveState.lastMode) return;
      addLiveLine("mode", '\\u21aa <b>' + escapeHtml(m) + '</b>');
      _liveState.lastMode = m;
    });

    socket.on("thinking", function(ev) {
      var text = oneLineLive(ev && ev.text, 200);
      if (!text) return;
      var key = text.slice(0, 60);
      if (key === _liveState.lastThinking) return;
      _liveState.lastThinking = key;
      addLiveLine("thinking", '\\u2026 <span class="live-dim">' + escapeHtml(text) + '</span>');
    });

    socket.on("toolCalled", function(ev) {
      var name = ev && ev.tool ? String(ev.tool) : "?";
      var hint = formatLiveArgs(ev && ev.args);
      addLiveLine("tool-call",
        '<span class="live-tc-dot">\\u00b7</span> <b>' + escapeHtml(name) + '</b>' +
        (hint ? ' <span class="live-dim">(' + escapeHtml(hint) + ')</span>' : "")
      );
    });

    socket.on("toolResult", function(ev) {
      var name = ev && ev.tool ? String(ev.tool) : "?";
      var ok = !(ev && (ev.success === false || ev.error));
      if (ok) {
        var preview = "";
        if (ev && typeof ev.result === "string" && ev.result.trim()) {
          var firstLine = ev.result.split("\\n").find(function(l) { return l.trim(); }) || "";
          preview = oneLineLive(firstLine, 120);
        }
        addLiveLine("tool-ok",
          '<span class="live-ok">\\u2713</span> <span class="live-dim">' + escapeHtml(name) + '</span>' +
          (preview ? ' <span class="live-dim">\\u2014 ' + escapeHtml(preview) + '</span>' : "")
        );
      } else {
        var err = oneLineLive((ev && ev.error) || "failed", 160);
        addLiveLine("tool-fail",
          '<span class="live-fail">\\u2717</span> <span class="live-dim">' + escapeHtml(name) + '</span>' +
          (err ? ' <span class="live-fail-text">' + escapeHtml(err) + '</span>' : "")
        );
      }
    });

    socket.on("swarmDispatch", function(ev) {
      var count = (ev && ev.count) || (ev && ev.branches && ev.branches.length) || 0;
      var names = (ev && ev.branches ? ev.branches.map(function(b) { return b.name; }).filter(Boolean) : []);
      var label = names.length ? " [" + names.slice(0, 6).join(", ") + (names.length > 6 ? " +" + (names.length - 6) : "") + "]" : "";
      addLiveLine("swarm",
        '<span class="live-swarm">\\u232b</span> swarm: <b>' + count + ' branch' + (count === 1 ? "" : "es") + '</b>' +
        '<span class="live-dim">' + escapeHtml(label) + '</span>'
      );
    });

    socket.on("branchStarted", function(ev) {
      var name = ev && ev.name ? String(ev.name) : "?";
      var pos = (ev && ev.index != null && ev.total != null) ? " " + ev.index + "/" + ev.total : "";
      addLiveLine("branch-start",
        '<span class="live-branch">\\u25b6</span> <b>' + escapeHtml(name) + '</b><span class="live-dim">' + pos + '</span>'
      );
    });

    socket.on("branchCompleted", function(ev) {
      var name = ev && ev.name ? String(ev.name) : "?";
      var st = (ev && ev.status) || "done";
      if (st === "done") {
        addLiveLine("branch-ok",
          '<span class="live-ok">\\u2713</span> <span class="live-dim">branch </span><b>' + escapeHtml(name) + '</b>'
        );
      } else {
        var err = oneLineLive((ev && ev.error) || st, 140);
        addLiveLine("branch-fail",
          '<span class="live-fail">\\u2717</span> <span class="live-dim">branch </span><b>' + escapeHtml(name) + '</b>' +
          (err ? ' <span class="live-fail-text">' + escapeHtml(err) + '</span>' : "")
        );
      }
    });

    // ── Plan-first swarm events (same behavior as /dashboard) ───────
    function _renderPlanCard(ev, isUpdate) {
      // Strip any prior spent plan cards from the DOM before rendering
      // the new one. Without this, clicking Revise leaves the v1 card
      // visible-but-dimmed next to the fresh v2 card, and the user
      // can't tell which one is the live proposal. Current live plan
      // card is always the most recent; spent ones are history that
      // the chat stream's own scroll already captured. Removing them
      // doesn't lose anything.
      try {
        var stale = chatMessages.querySelectorAll(".plan-card-spent");
        for (var i = 0; i < stale.length; i++) {
          var parent = stale[i].closest(".live-line-plan-card") || stale[i];
          if (parent && parent.parentNode) parent.parentNode.removeChild(parent);
        }
      } catch (e) { /* best effort; never block render */ }

      var version = ev && ev.version != null ? "v" + ev.version : "";
      var branches = (ev && Array.isArray(ev.branches)) ? ev.branches : [];
      var count = branches.length;
      var header = isUpdate ? "Updated plan" : "Proposed plan";
      var trigger = isUpdate && ev && ev.trigger
        ? '<div class="plan-trigger">\\u21aa ' + escapeHtml(oneLineLive(ev.trigger, 120)) + '</div>'
        : '';
      var rows = branches.map(function(b) {
        var name = escapeHtml(b.name || "?");
        var path = b.path ? '<span class="plan-path">\\u00b7 path: ' + escapeHtml(b.path) + '</span>' : '';
        var mode = b.mode ? '<span class="plan-mode">\\u00b7 ' + escapeHtml(b.mode) + '</span>' : '';
        var files = (Array.isArray(b.files) && b.files.length)
          ? '<span class="plan-files">\\u00b7 files: ' + escapeHtml(oneLineLive(b.files.join(", "), 80)) + '</span>'
          : '';
        var spec = b.spec
          ? '<div class="plan-spec">' + escapeHtml(oneLineLive(b.spec, 180)) + '</div>'
          : '';
        return (
          '<div class="plan-branch">' +
            '<div class="plan-branch-head"><b>' + name + '</b> ' + path + ' ' + mode + ' ' + files + '</div>' +
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
      var card = addLiveLine("plan-card",
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
      if (!card) return;
      var accept = card.querySelector(".plan-btn-accept");
      var cancel = card.querySelector(".plan-btn-cancel");
      var revise = card.querySelector(".plan-btn-revise");
      function _spendPlanCard(chosen) {
        // Mark the whole card as settled so it can't be acted on again:
        // disable every button and dim the card. New proposals (plan v2+)
        // render fresh cards with live buttons.
        card.classList.add("plan-card-spent");
        var all = card.querySelectorAll(".plan-btn");
        for (var i = 0; i < all.length; i++) {
          all[i].disabled = true;
          if (all[i] !== chosen) all[i].classList.add("plan-btn-unchosen");
        }
        if (chosen) chosen.classList.add("plan-btn-chosen");
      }
      if (accept) accept.addEventListener("click", function() {
        if (accept.disabled) return;
        _spendPlanCard(accept);
        chatInput.value = "yes";
        sendMessage();
      });
      if (cancel) cancel.addEventListener("click", function() {
        if (cancel.disabled) return;
        _spendPlanCard(cancel);
        chatInput.value = "cancel";
        sendMessage();
      });
      if (revise) revise.addEventListener("click", function() {
        if (revise.disabled) return;
        _spendPlanCard(revise);
        chatInput.focus();
        if (!chatInput.value) chatInput.placeholder = "describe what to change about the plan\\u2026";
      });
    }

    socket.on("swarmPlanProposed", function(ev) { _renderPlanCard(ev, false); });
    socket.on("swarmPlanUpdated",  function(ev) { _renderPlanCard(ev, true); });
    socket.on("swarmPlanArchived", function(ev) {
      var count = ev && ev.branchCount != null
        ? ev.branchCount + " branch" + (ev.branchCount === 1 ? "" : "es")
        : "plan";
      var reason = ev && ev.reason ? " \\u00b7 " + escapeHtml(ev.reason) : "";
      addLiveLine("plan-archived",
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
      addLiveLine("scout-dispatch",
        '<span class="live-scout">\\ud83d\\udd0d</span> dispatching scouts<span class="live-dim">' +
        escapeHtml(cycle) + ' over ' + escapeHtml(n) + '\\u2026</span>'
      );
    });
    socket.on("swarmScoutReport", function(ev) {
      var branch = (ev && ev.branch) ? String(ev.branch) : "?";
      var detail = oneLineLive((ev && ev.detail) || "(no detail)", 180);
      var counter = (ev && ev.counterpartBranch)
        ? ' <span class="live-dim">\\u2194 ' + escapeHtml(ev.counterpartBranch) + '</span>'
        : '';
      addLiveLine("scout-report",
        '<span class="live-scout-warn">\\u26a0</span> <b>' + escapeHtml(branch) + '</b>' + counter +
        '<span class="live-dim">: ' + escapeHtml(detail) + '</span>'
      );
    });
    socket.on("swarmIssuesRouted", function(ev) {
      var total = (ev && ev.total) || 0;
      var cycle = ev && ev.cycle != null ? "cycle " + ev.cycle + " \\u00b7 " : "";
      if (total === 0) {
        addLiveLine("scout-clean",
          '<span class="live-ok">\\u2713</span> <span class="live-dim">' + escapeHtml(cycle) + 'no mismatches found</span>'
        );
      } else {
        var affected = (ev && Array.isArray(ev.affectedBranches)) ? ev.affectedBranches : [];
        var suffix = affected.length
          ? ' \\u2192 ' + affected.slice(0, 6).join(", ") +
            (affected.length > 6 ? " +" + (affected.length - 6) : "")
          : "";
        addLiveLine("scout-route",
          '<span class="live-scout-route">\\ud83d\\udcec</span> routing <b>' + total + ' issue' +
          (total === 1 ? "" : "s") + '</b><span class="live-dim">' + escapeHtml(suffix) + '</span>'
        );
      }
    });
    socket.on("swarmRedeploying", function(ev) {
      var cycle = ev && ev.cycle != null ? " (cycle " + (ev.cycle + 1) + ")" : "";
      var names = (ev && Array.isArray(ev.branches)) ? ev.branches.join(", ") : "";
      addLiveLine("scout-redeploy",
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
      addLiveLine("scout-reconciled",
        '<span class="' + cls + '">\\u2713</span> swarm reconciled<span class="live-dim"> (' +
        escapeHtml(status) + (cycles ? ' \\u00b7 ' + escapeHtml(cycles) : '') + escapeHtml(total) + ')</span>'
      );
    });

    socket.on("placeResult", ({ stepSummaries, targetPath, generation }) => {
      if (generation !== undefined && generation < requestGeneration) return;
      var el = document.getElementById("placeStatus");
      var summary = (stepSummaries && stepSummaries.length > 0)
        ? "Placed on: " + (targetPath || stepSummaries.map(function(s) { return s.summary || s; }).join(", "))
        : "Nothing to place for that message.";
      if (el) {
        el.querySelector(".place-result").textContent = summary;
      } else {
        addMessage(summary, "place-status");
      }
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
      isSending = false;
      statusDot.className = "status-dot disconnected";
      statusText.textContent = "Disconnected";
      updateSendBtn();

      chatMessages.innerHTML = '<div class="welcome-message disconnected"><div class="welcome-icon">🌳</div><h2>Disconnected</h2><p>You have been disconnected from ' + CONFIG.landName + '. Please refresh the page to reconnect.</p></div>';
    });

    // Ignore navigate events — no iframe
    socket.on("navigate", () => {});

    // ── Zone chat (home + land via HTTP) ────────────────────────────

    function addZoneMessage(containerId, text, role) {
      const container = document.getElementById(containerId);
      if (!container) return;
      const div = document.createElement("div");
      div.className = "zone-msg " + role;
      div.textContent = text;
      container.appendChild(div);
      container.scrollTop = container.scrollHeight;
    }

    const ZONE_ENDPOINTS = {
      home: "/api/v1/home/chat",
      land: "/api/v1/land/chat",
    };

    async function sendZoneMessage(zone) {
      const input = document.getElementById(zone === "home" ? "homeInput" : "landInput");
      const btn = document.getElementById(zone === "home" ? "homeSendBtn" : "landSendBtn");
      const msgContainer = zone === "home" ? "homeMessages" : "landMessages";
      const text = input.value.trim();
      if (!text) return;

      addZoneMessage(msgContainer, text, "user");
      input.value = "";
      btn.disabled = true;
      addZoneMessage(msgContainer, "Thinking...", "thinking");

      try {
        const res = await fetch(ZONE_ENDPOINTS[zone], {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ message: text }),
        });
        const data = await res.json();
        // Remove thinking indicator
        const container = document.getElementById(msgContainer);
        const thinking = container.querySelector(".zone-msg.thinking:last-child");
        if (thinking) thinking.remove();

        if (data.status === "ok") {
          addZoneMessage(msgContainer, data.data.answer || "No response.", "assistant");
        } else {
          addZoneMessage(msgContainer, (data.error && data.error.message) || "Something went wrong.", "error");
        }
      } catch (err) {
        const container = document.getElementById(msgContainer);
        const thinking = container.querySelector(".zone-msg.thinking:last-child");
        if (thinking) thinking.remove();
        addZoneMessage(msgContainer, err.message, "error");
      }
      btn.disabled = false;
      input.focus();
    }

    // Zone input: enter to send, shift+enter for newline
    for (const id of ["homeInput", "landInput"]) {
      const el = document.getElementById(id);
      if (!el) continue;
      const zone = id === "homeInput" ? "home" : "land";
      const btn = document.getElementById(zone === "home" ? "homeSendBtn" : "landSendBtn");
      el.addEventListener("input", () => { btn.disabled = !el.value.trim(); });
      el.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          if (el.value.trim()) sendZoneMessage(zone);
        }
      });
    }

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
        if (!res.ok || data.status === "error") throw new Error((data.error && data.error.message) || data.error || "Failed");

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
        const rootId = data.data?.rootId || data.rootId;
        item.onclick = () => selectTree(rootId, name);
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
      advancedLink.href = "/dashboard?rootId=" + rootId;
      treePicker.style.display = "none";
      document.getElementById("zoneTrees").style.display = "none";
      document.getElementById("zoneHome").style.display = "none";
      var zoneLand = document.getElementById("zoneLand");
      if (zoneLand) zoneLand.style.display = "none";
      chatArea.classList.add("active");
      rootName.textContent = name;
      rootName.classList.add("visible");
      backRow.classList.add("visible");

      // Reset chat to the empty/centered state. If we've already chatted
      // this session, the welcome message was removed from the DOM by
      // addMessage — rebuilding it is the only way to get the centered
      // form back. Toggling visibility on a non-existent element was the
      // bug behind "stuck in the collapse middle form" on second tree.
      chatMessages.innerHTML = '<div class="welcome-message" id="welcomeMsg"><div class="welcome-icon">🌳</div><h2>Start chatting</h2><p>Just type. Natural language works.</p></div>';
      chatArea.classList.add("empty");
      document.getElementById("clearChatBtn").classList.remove("visible");

      // Tell server about this root
      socket.emit("setActiveRoot", { rootId });
      socket.emit("urlChanged", { url: "/api/v1/root/" + rootId, rootId });

      // Build app hotbar for this tree
      buildHotbar(rootId);

      // Refresh menu panel for this tree
      dreamsLoaded = false;
      invitesLoaded = false;
      if (notifOpen) {
        if (activeTab === "dreams") fetchDreams();
        if (activeTab === "invites") fetchInvites();
      }

      updateSendBtn();
    }

    function backToTrees() {
      // Cancel any in-flight request
      if (isSending) {
        requestGeneration++;
        socket.emit("cancelRequest");
        removeTyping();
      }

      activeRootId = null;
      advancedLink.href = "/dashboard";
      treePicker.style.display = "";
      document.getElementById("zoneTrees").style.display = "";
      document.getElementById("zoneHome").style.display = "";
      var zoneLand = document.getElementById("zoneLand");
      if (zoneLand) zoneLand.style.display = "";
      chatArea.classList.remove("active");
      rootName.classList.remove("visible");
      backRow.classList.remove("visible");
      document.getElementById("clearChatBtn").classList.remove("visible");
      isSending = false;
      updateSendBtn();

      // Tell server we're going home so it properly exits tree mode
      socket.emit("urlChanged", { url: "/api/v1/user/" + CONFIG.userId });
      socket.emit("clearConversation");
      dreamsLoaded = false;
      invitesLoaded = false;
      if (notifOpen) {
        if (activeTab === "dreams") fetchDreams();
        if (activeTab === "invites") fetchInvites();
      }
    }

    // ── Messages ──────────────────────────────────────────────────────
    function addMessage(content, role) {
      const welcome = chatMessages.querySelector(".welcome-message");
      if (welcome) {
        welcome.remove();
        document.getElementById("chatArea").classList.remove("empty");
        document.getElementById("clearChatBtn").classList.add("visible");
      }

      const msg = document.createElement("div");
      if (role === "place-status") {
        msg.className = "message assistant";
        msg.id = "placeStatus";
        msg.innerHTML = '<div class="message-avatar">\\ud83c\\udf33</div><div class="message-content"><div class="place-result">' + escapeHtml(content) + '</div></div>';
        chatMessages.appendChild(msg);
        chatMessages.scrollTop = chatMessages.scrollHeight;
        return;
      }

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

    // ── App Dashboard Panel ──────────────────────────────────────────

    const APP_META = {
      food: { emoji: "🍎", name: "Food", path: "food" },
      fitness: { emoji: "💪", name: "Fitness", path: "fitness" },
      recovery: { emoji: "🌿", name: "Recovery", path: "recovery" },
      study: { emoji: "📚", name: "Study", path: "study" },
      kb: { emoji: "📖", name: "KB", path: "kb" },
      relationships: { emoji: "👥", name: "Relationships", path: "relationships" },
      finance: { emoji: "💰", name: "Finance", path: "finance" },
      investor: { emoji: "📈", name: "Investor", path: "investor" },
      "market-researcher": { emoji: "🔬", name: "Research", path: "market-researcher" },
    };

    let currentAppNodeId = null;
    let hotbarBuilt = false;

    function surfaceApp(nodeId) {
      const apps = CONFIG.apps || [];
      const match = apps.find(a => a.id === nodeId);
      if (match) {
        showAppPanel(nodeId, match.key);
        highlightHotbarItem(match.key);
      }
    }

    function showAppPanel(nodeId, appKey) {
      // Navigate the session to this app's node
      if (typeof socket !== "undefined" && socket.connected) {
        socket.emit("urlChanged", { url: "/api/v1/node/" + nodeId, nodeId });
      }

      const panel = document.getElementById("appPanel");
      const frame = document.getElementById("appPanelFrame");
      const title = document.getElementById("appPanelTitle");
      const meta = APP_META[appKey];
      if (!meta) return;

      currentAppNodeId = nodeId;
      title.innerHTML = meta.emoji + " " + meta.name;
      frame.src = "/api/v1/root/" + nodeId + "/" + meta.path + "?html&inApp=1";

      // Update header to show active app
      const rn = document.getElementById("rootName");
      if (rn) rn.textContent = meta.name;
      panel.classList.add("visible");

    }

    function closeAppPanel() {
      document.getElementById("appPanel").classList.remove("visible");
      document.getElementById("appPanelFrame").src = "";
      currentAppNodeId = null;
      highlightHotbarItem(null);
      // Restore header to tree name
      const tree = CONFIG.trees.find(t => t.id === activeRootId);
      const rn = document.getElementById("rootName");
      if (rn && tree) rn.textContent = tree.name;
    }

    function buildHotbar(treeId) {
      const hotbar = document.getElementById("appHotbar");
      if (!hotbar) return;

      const apps = CONFIG.apps || [];
      // Hotbar belongs to the Life tree only. Any other tree hides it.
      // The old hotbarBuilt guard short-circuited the function once the
      // bar was rendered, so switching trees left a stale hotbar visible.
      const isLifeTree = apps.length > 0 && apps.some(a => a.treeRootId === treeId);
      if (!isLifeTree) {
        hotbar.classList.remove("visible");
        return;
      }

      if (!hotbarBuilt) {
        const inner = document.getElementById("appHotbarInner");
        inner.innerHTML = apps.map(a =>
          '<button class="app-hotbar-item" data-app="' + a.key + '" data-node-id="' + a.id + '" onclick="showAppPanel(\\'' + a.id + '\\',\\'' + a.key + '\\');highlightHotbarItem(\\'' + a.key + '\\')">' +
            '<span class="app-hotbar-emoji">' + a.emoji + '</span>' +
            '<span>' + a.label + '</span>' +
          '</button>'
        ).join("");
        hotbarBuilt = true;
      }
      hotbar.classList.add("visible");
    }

    function highlightHotbarItem(appKey) {
      document.querySelectorAll(".app-hotbar-item").forEach(el => {
        el.classList.toggle("active", el.dataset.app === appKey);
      });
    }

    // ── Send ──────────────────────────────────────────────────────────
    function sendMessage() {
      if (isSending) {
        requestGeneration++;
        socket.emit("cancelRequest");
        removeTyping();
        addMessage("Stopped", "error");
        isSending = false;
        updateSendBtn();
        return;
      }

      const text = chatInput.value.trim();
      if (!text || !isRegistered || !activeRootId) return;

      chatInput.value = "";
      chatInput.style.height = "auto";
      addMessage(text, "user");
      if (chatMode === "place") {
        addMessage("Placing...", "place-status");
      } else {
        addTyping();
      }
      // Reset the live-stream dedupe state for this new turn so the
      // first mode switch / thinking line of the next run always
      // shows (the previous turn's values don't carry over).
      _liveState.lastMode = null;
      _liveState.lastThinking = null;
      isSending = true;
      requestGeneration++;
      updateSendBtn();
      // Include current tree position in the chat payload so the server
      // routes tree-zone work through the orchestrator even on the very
      // first message after a reload (before urlChanged has flipped
      // mode). Matches the CLI payload shape. Without this, the server
      // chat handler sees missing root/node/zone and falls back to the
      // home zone, so dispatches built for tree mode land in the wrong
      // session.
      socket.emit("chat", {
        message: text,
        username: CONFIG.username,
        generation: requestGeneration,
        mode: chatMode,
        rootId: activeRootId || null,
        currentNodeId: activeRootId || null,
        zone: activeRootId ? "tree" : "home",
      });
    }

    function updateSendBtn() {
      const hasText = chatInput.value.trim().length > 0;
      if (isSending) {
        sendBtn.classList.add("stop-mode");
        sendBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>';
        sendBtn.disabled = !(isConnected && isRegistered);
        chatInput.disabled = true;
      } else {
        sendBtn.classList.remove("stop-mode");
        sendBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/></svg>';
        sendBtn.disabled = !(hasText && isRegistered && activeRootId);
        chatInput.disabled = false;
      }
    }

    // ── Input handlers ────────────────────────────────────────────────
    chatInput.addEventListener("input", () => {
      const maxH = chatArea.classList.contains("empty") ? window.innerHeight * 0.4 : 120;
      chatInput.style.height = "auto";
      chatInput.style.height = Math.min(chatInput.scrollHeight, maxH) + "px";
      updateSendBtn();
    });

    chatInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
        // On mobile, blur to dismiss keyboard so user can see the response
        if ('ontouchstart' in window || navigator.maxTouchPoints > 0) {
          chatInput.blur();
        }
      }
    });

    sendBtn.addEventListener("click", sendMessage);

    document.getElementById("clearChatBtn").addEventListener("click", () => {
      if (!isRegistered) return;
      if (isSending) {
        socket.emit("cancelRequest");
        removeTyping();
        isSending = false;
      }
      socket.emit("clearConversation");
      chatMessages.innerHTML = '<div class="welcome-message" id="welcomeMsg"><div class="welcome-icon">🌳</div><h2>Start chatting</h2><p>Just type. Natural language works.</p></div>';
      chatArea.classList.add("empty");
      document.getElementById("clearChatBtn").classList.remove("visible");
      updateSendBtn();
    });

    // ── Notifications + Invites ────────────────────────────────────────
    const notifPanel = document.getElementById("notifPanel");
    const notifOverlay = document.getElementById("notifOverlay");
    const notifList = document.getElementById("notifList");
    const invitesList = document.getElementById("invitesList");
    const notifDot = document.getElementById("notifDot");
    let notifOpen = false;
    let dreamsLoaded = false;
    let invitesLoaded = false;
    let activeTab = notifList ? "dreams" : invitesList ? "invites" : "dreams";

    async function doLogout() {
      try {
        await fetch("/api/v1/logout", { method: "POST", credentials: "include" });
        window.location.href = "/login";
      } catch(e) {
        alert("Logout failed");
      }
    }

    function toggleNotifs() {
      notifOpen = !notifOpen;
      notifPanel.classList.toggle("open", notifOpen);
      notifOverlay.classList.toggle("open", notifOpen);
      if (notifOpen) {
        if (activeTab === "dreams" && !dreamsLoaded && notifList) fetchDreams();
        if (activeTab === "invites" && !invitesLoaded && invitesList) fetchInvites();
      }
    }

    function switchTab(tab) {
      activeTab = tab;
      var tabDreams = document.getElementById("tabDreams");
      var tabInvites = document.getElementById("tabInvites");
      if (tabDreams) tabDreams.classList.toggle("active", tab === "dreams");
      if (tabInvites) tabInvites.classList.toggle("active", tab === "invites");
      if (notifList) notifList.style.display = tab === "dreams" ? "" : "none";
      if (invitesList) invitesList.style.display = tab === "invites" ? "" : "none";
      if (tab === "dreams" && !dreamsLoaded) fetchDreams();
      if (tab === "invites" && !invitesLoaded) fetchInvites();
    }

    async function fetchDreams() {
      notifList.innerHTML = '<div class="notif-loading">Loading...</div>';
      dreamsLoaded = false;
      try {
        var dreamUrl = "/chat/notifications" + (activeRootId ? "?rootId=" + activeRootId : "");
        var res = await fetch(dreamUrl, { credentials: "include" });
        var data = await res.json();
        if (!res.ok || data.status === "error") throw new Error((data.error && data.error.message) || data.error || "Failed");
        var inner = data.data || data;

        dreamsLoaded = true;
        var notifs = inner.notifications || [];
        var html = "";

        // Dream time config (only when inside a tree and user is owner)
        if (activeRootId && inner.isOwner) {
          if (inner.metadata?.dreams?.dreamTime) {
            html += '<div class="dream-config">' +
              '<div class="dream-config-label">Dream schedule</div>' +
              '<div class="dream-config-row">' +
                '<input type="time" id="dreamTimeInput" value="' + escapeHtml(inner.metadata?.dreams?.dreamTime) + '" />' +
                '<button class="dream-config-save" onclick="saveDreamTime()">Save</button>' +
                '<button class="dream-config-off" onclick="disableDreamTime()">Turn Off</button>' +
              '</div>' +
              '<div class="dream-config-status" id="dreamStatus"></div>' +
            '</div>';
          } else {
            html += '<div class="dream-config">' +
              '<div class="dream-config-hint">Dreams are off for this tree. Set a time to enable nightly dreams. Your tree will reflect, reorganize, and share thoughts with you.</div>' +
              '<div class="dream-config-row" style="margin-top:8px">' +
                '<input type="time" id="dreamTimeInput" value="" />' +
                '<button class="dream-config-save" onclick="saveDreamTime()">Enable</button>' +
              '</div>' +
              '<div class="dream-config-status" id="dreamStatus"></div>' +
            '</div>';
          }
        }

        if (notifs.length === 0) {
          html += '<div class="notif-empty"><span class="notif-empty-icon">\\ud83d\\udd14</span>' +
            (activeRootId ? 'No dreams from this tree yet' : 'No dream notifications from the last 7 days') +
          '</div>';
          notifList.innerHTML = html;
          return;
        }

        document.getElementById("dreamsDot").classList.add("visible");
        notifDot.classList.add("has-notifs");
        html += notifs.map(function(n, i) {
          var isThought = n.type === "dream-thought";
          var icon = isThought ? "\\ud83d\\udcad" : "\\ud83d\\udccb";
          var badge = isThought ? "Thought" : "Summary";
          var cls = isThought ? "type-thought" : "type-summary";
          var date = new Date(n.createdAt).toLocaleDateString(undefined, {
            month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
          });
          return '<div class="notif-item ' + cls + '" style="animation-delay:' + (i * 0.04) + 's">' +
            '<div class="notif-item-header">' +
              '<span class="notif-item-icon">' + icon + '</span>' +
              '<span class="notif-item-title">' + escapeHtml(n.title) + '</span>' +
              '<span class="notif-item-badge">' + badge + '</span>' +
            '</div>' +
            '<div class="notif-item-content">' + escapeHtml(n.content) + '</div>' +
            '<div class="notif-item-time">' + date + '</div>' +
          '</div>';
        }).join("");
        notifList.innerHTML = html;
      } catch (err) {
        console.error("Dreams error:", err);
        notifList.innerHTML = '<div class="notif-empty">Failed to load notifications</div>';
      }
    }

    async function saveDreamTime() {
      var input = document.getElementById("dreamTimeInput");
      var status = document.getElementById("dreamStatus");
      if (!input.value) { status.textContent = "Pick a time first"; return; }
      try {
        var res = await fetch("/api/v1/root/" + activeRootId + "/dream-time", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ dreamTime: input.value }),
        });
        var data = await res.json();
        if (!res.ok) throw new Error((data.error && data.error.message) || data.error || "Failed");
        status.textContent = "Dreams set for " + input.value;
        dreamsLoaded = false;
        fetchDreams();
      } catch (err) {
        status.textContent = err.message;
      }
    }

    async function disableDreamTime() {
      var status = document.getElementById("dreamStatus");
      try {
        var res = await fetch("/api/v1/root/" + activeRootId + "/dream-time", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ dreamTime: null }),
        });
        var data = await res.json();
        if (!res.ok) throw new Error((data.error && data.error.message) || data.error || "Failed");
        status.textContent = "Dreams disabled";
        dreamsLoaded = false;
        fetchDreams();
      } catch (err) {
        status.textContent = err.message;
      }
    }

    async function fetchInvites() {
      invitesList.innerHTML = '<div class="notif-loading">Loading...</div>';
      invitesLoaded = false;
      try {
        var invUrl = "/chat/invites" + (activeRootId ? "?rootId=" + activeRootId : "");
        var res = await fetch(invUrl, { credentials: "include" });
        var data = await res.json();
        if (!res.ok || data.status === "error") throw new Error((data.error && data.error.message) || data.error || "Failed");
        var invInner = data.data || data;

        invitesLoaded = true;
        var html = "";

        // Pending invites section
        var invites = invInner.invites || [];
        if (invites.length > 0) {
          document.getElementById("invitesDot").classList.add("visible");
          notifDot.classList.add("has-notifs");
          html += invites.map(function(inv, i) {
            return '<div class="invite-item" style="animation-delay:' + (i * 0.04) + 's">' +
              '<div class="invite-item-text"><strong>' + escapeHtml(inv.from) + '</strong> invited you to <strong>' + escapeHtml(inv.treeName) + (inv.isRemote && inv.homeLand ? ' on ' + escapeHtml(inv.homeLand) : '') + '</strong></div>' +
              '<div class="invite-item-actions">' +
                '<button class="invite-accept" onclick="respondInvite(\\'' + inv.id + '\\', true, this)">Accept</button>' +
                '<button class="invite-decline" onclick="respondInvite(\\'' + inv.id + '\\', false, this)">Decline</button>' +
              '</div>' +
            '</div>';
          }).join("");
        }

        // Members section (only when inside a tree)
        if (activeRootId && invInner.members) {
          var members = invInner.members;
          html += '<div class="members-section">';
          html += '<div class="members-section-title">Members</div>';

          // Owner
          if (members.owner) {
            html += '<div class="member-item">' +
              '<div><span class="member-name">' + escapeHtml(members.owner.username) + '</span><span class="member-role">Owner</span></div>' +
            '</div>';
          }

          // Contributors
          (members.contributors || []).forEach(function(c) {
            var isSelf = c._id === CONFIG.userId;
            var isOwner = members.isOwner;
            var actions = '';
            if (isOwner || isSelf) {
              var label = isSelf ? "Leave" : "Remove";
              var cls = isSelf ? "btn-danger" : "btn-danger";
              actions = '<div class="member-actions">';
              if (isOwner && !isSelf) {
                actions += '<button onclick="transferOwner(\\'' + c._id + '\\', this)">Transfer</button>';
              }
              actions += '<button class="' + cls + '" onclick="removeMember(\\'' + c._id + '\\', \\'' + label + '\\', this)">' + label + '</button>';
              actions += '</div>';
            }
            html += '<div class="member-item">' +
              '<div><span class="member-name">' + escapeHtml(c.username) + '</span></div>' +
              actions +
            '</div>';
          });

          // Invite form (owner or contributor)
          if (members.isOwner || members.contributors.some(function(c) { return c._id === userId; })) {
            html += '<form class="invite-form" onsubmit="sendInvite(event)">' +
              '<input type="text" id="inviteUsername" placeholder="username or user@other.land.com" />' +
              '<button type="submit">Invite</button>' +
            '</form>' +
            '<div class="invite-status" id="inviteStatus"></div>';
          }
          html += '</div>';
        }

        if (!html) {
          html = '<div class="notif-empty"><span class="notif-empty-icon">\\ud83d\\udcec</span>No pending invites</div>';
        }

        invitesList.innerHTML = html;
      } catch (err) {
        console.error("Invites error:", err);
        invitesList.innerHTML = '<div class="notif-empty">Failed to load invites</div>';
      }
    }

    async function respondInvite(inviteId, accept, btn) {
      var item = btn.closest(".invite-item");
      item.style.opacity = "0.5";
      item.style.pointerEvents = "none";
      try {
        var res = await fetch("/chat/invites/" + inviteId, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ accept: accept }),
        });
        var data = await res.json();
        if (!res.ok) throw new Error((data.error && data.error.message) || data.error || "Failed");
        item.remove();
        // Refresh tree list if accepted
        if (accept) {
          location.reload();
        }
      } catch (err) {
        item.style.opacity = "1";
        item.style.pointerEvents = "";
        alert(err.message);
      }
    }

    async function sendInvite(e) {
      e.preventDefault();
      var input = document.getElementById("inviteUsername");
      var status = document.getElementById("inviteStatus");
      var username = input.value.trim();
      if (!username) return;

      status.className = "invite-status";
      status.textContent = "";

      try {
        var res = await fetch("/api/v1/root/" + activeRootId + "/invite", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ userReceiving: username }),
        });
        var data = await res.json();
        if (!res.ok) throw new Error((data.error && data.error.message) || data.error || "Failed");

        status.textContent = "Invite sent!";
        status.className = "invite-status success";
        input.value = "";
      } catch (err) {
        status.textContent = err.message;
        status.className = "invite-status error";
      }
    }

    async function removeMember(userId, label, btn) {
      if (!confirm("Are you sure you want to " + label.toLowerCase() + "?")) return;
      btn.disabled = true;
      try {
        var res = await fetch("/api/v1/root/" + activeRootId + "/remove-user", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ userReceiving: userId }),
        });
        var data = await res.json();
        if (!res.ok) throw new Error((data.error && data.error.message) || data.error || "Failed");
        if (userId === CONFIG.userId) {
          location.reload();
        } else {
          invitesLoaded = false;
          fetchInvites();
        }
      } catch (err) {
        btn.disabled = false;
        alert(err.message);
      }
    }

    async function transferOwner(userId, btn) {
      if (!confirm("Transfer ownership? This cannot be undone.")) return;
      btn.disabled = true;
      try {
        var res = await fetch("/api/v1/root/" + activeRootId + "/transfer-owner", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ userReceiving: userId }),
        });
        var data = await res.json();
        if (!res.ok) throw new Error((data.error && data.error.message) || data.error || "Failed");
        invitesLoaded = false;
        fetchInvites();
      } catch (err) {
        btn.disabled = false;
        alert(err.message);
      }
    }

    // Check for notifications + invites on load
    fetch("/chat/notifications", { credentials: "include" })
      .then(function(r) { return r.json(); })
      .then(function(d) {
        var di = d.data || d;
        if (di.notifications && di.notifications.length > 0) {
          notifDot.classList.add("has-notifs");
          document.getElementById("dreamsDot").classList.add("visible");
        }
      })
      .catch(function() {});

    fetch("/chat/invites", { credentials: "include" })
      .then(function(r) { return r.json(); })
      .then(function(d) {
        if (d.invites && d.invites.length > 0) {
          notifDot.classList.add("has-notifs");
          document.getElementById("invitesDot").classList.add("visible");
        }
      })
      .catch(function() {});
  </script>
</body>
</html>`);
  } catch (err) {
    console.error("Error rendering /chat:", err);
    return res.status(500).send("Internal server error");
  }
});

router.get("/chat/notifications", authenticateLite, async (req, res) => {
  try {
    if (!req.userId)
      return sendError(res, 401, ERR.UNAUTHORIZED, "Not authenticated");
    const rootId = req.query.rootId;
    const notifExt = getExtension("notifications");
    const getNotifications = notifExt?.exports?.getNotifications;
    const { notifications, total } = getNotifications
      ? await getNotifications({ userId: req.userId, rootId, limit: 50, sinceDays: 7 })
      : { notifications: [], total: 0 };

    // Include dream config when viewing a specific tree
    let dreamTime = null;
    let isOwner = false;
    if (rootId) {
      const rootNode = await Node.findById(rootId)
        .select("metadata rootOwner")
        .lean();
      if (rootNode) {
        dreamTime = rootNode.metadata?.dreams?.dreamTime || null;
        isOwner = rootNode.rootOwner?.toString() === req.userId.toString();
      }
    }

    return sendOk(res, { notifications, total, dreamTime, isOwner });
  } catch (err) {
    console.error("Chat notifications error:", err);
    return sendError(res, 500, ERR.INTERNAL, err.message);
  }
});

// ── Invites + Members API for chat panel ──────────────────────────────
router.get("/chat/invites", authenticateLite, async (req, res) => {
  try {
    if (!req.userId)
      return sendError(res, 401, ERR.UNAUTHORIZED, "Not authenticated");

    // Pending invites for this user (from team extension)
    const teamExt = getExtension("team")?.exports || {};
    const invites = teamExt.getPendingInvitesForUser
      ? await teamExt.getPendingInvitesForUser(req.userId)
      : [];
    const inviteList = invites.map((inv) => ({
      id: inv._id,
      from: inv.userInviting?.username
        ? (inv.userInviting.isRemote && inv.userInviting.homeLand
          ? inv.userInviting.username + "@" + inv.userInviting.homeLand
          : inv.userInviting.username)
        : "Unknown",
      isRemote: inv.userInviting?.isRemote || false,
      homeLand: inv.userInviting?.homeLand || null,
      treeName: inv.rootId?.name || "Unknown tree",
      rootId: inv.rootId?._id || inv.rootId,
    }));

    // Members (only if rootId query param provided = user is in a tree)
    let members = null;
    const rootId = req.query.rootId;
    if (rootId) {
      const rootNode = await Node.findById(rootId)
        .populate("rootOwner", "username _id")
        .populate("contributors", "username _id")
        .select("rootOwner contributors")
        .lean();
      if (rootNode) {
        members = {
          owner: rootNode.rootOwner || null,
          contributors: rootNode.contributors || [],
          isOwner:
            rootNode.rootOwner?._id?.toString() === req.userId.toString(),
        };
      }
    }

    return sendOk(res, { invites: inviteList, members });
  } catch (err) {
    console.error("Chat invites error:", err);
    return sendError(res, 500, ERR.INTERNAL, err.message);
  }
});

router.post("/chat/invites/:inviteId", authenticateLite, async (req, res) => {
  try {
    if (!req.userId)
      return sendError(res, 401, ERR.UNAUTHORIZED, "Not authenticated");
    const { accept } = req.body;
    const teamExt = getExtension("team")?.exports || {};
    if (!teamExt.respondToInvite) {
      return sendError(res, 404, ERR.EXTENSION_NOT_FOUND, "Team extension not installed");
    }
    await teamExt.respondToInvite({
      inviteId: req.params.inviteId,
      userId: req.userId,
      acceptInvite: accept === true || accept === "true",
    });
    return sendOk(res);
  } catch (err) {
    return sendError(res, 400, ERR.INVALID_INPUT, err.message);
  }
});

export default router;
