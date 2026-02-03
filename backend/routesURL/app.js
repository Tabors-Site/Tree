// routes/app.js
import express from "express";
import User from "../db/models/user.js";

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
 const userHtml = await User.findById(req.userId)
      .select("htmlShareToken"); // only fetch what you need
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
      --glass-alpha-hover: 0.38;
      --glass-blur: 22px;
      --glass-border: rgba(255, 255, 255, 0.28);
      --glass-border-light: rgba(255, 255, 255, 0.15);
      --glass-highlight: rgba(255, 255, 255, 0.25);
      --text-primary: #ffffff;
      --text-secondary: rgba(255, 255, 255, 0.9);
      --text-muted: rgba(255, 255, 255, 0.6);
      --accent: #10b981;
      --accent-glow: rgba(16, 185, 129, 0.6);
      --chat-width: 400px;
      --header-height: 56px;
      --transition-fast: 150ms cubic-bezier(0.4, 0, 0.2, 1);
      --transition-smooth: 300ms cubic-bezier(0.4, 0, 0.2, 1);
      --mobile-input-height: 72px;
      --min-panel-width: 280px;
    }

    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
      -webkit-tap-highlight-color: transparent;
    }

    html, body {
      height: 100%;
      width: 100%;
      overflow: hidden;
      font-family: 'DM Sans', -apple-system, BlinkMacSystemFont, sans-serif;
      color: var(--text-primary);
    }

    /* Animated gradient background */
    .app-bg {
      position: fixed;
      inset: 0;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      z-index: -2;
    }

    .app-bg::before,
    .app-bg::after {
      content: '';
      position: fixed;
      border-radius: 50%;
      opacity: 0.08;
      animation: float 20s infinite ease-in-out;
      pointer-events: none;
    }

    .app-bg::before {
      width: 600px;
      height: 600px;
      background: transparent;
      top: -300px;
      right: -200px;
      animation-delay: -5s;
    }

    .app-bg::after {
      width: 400px;
      height: 400px;
      background: transparent;
      bottom: -200px;
      left: -100px;
      animation-delay: -10s;
    }

    @keyframes float {
      0%, 100% { transform: translateY(0) rotate(0deg); }
      50% { transform: translateY(-30px) rotate(5deg); }
    }

    /* Main Layout */
    .app-container {
      display: flex;
      height: 100%;
      width: 100%;
      position: relative;
      padding: 16px;
      gap: 16px;
    }

    /* Glass Panel Base */
    .glass-panel {
      background: rgba(var(--glass-rgb), var(--glass-alpha));
      backdrop-filter: blur(var(--glass-blur)) saturate(140%);
      -webkit-backdrop-filter: blur(var(--glass-blur)) saturate(140%);
      border-radius: 24px;
      border: 1px solid var(--glass-border);
      box-shadow: 
        0 20px 60px rgba(0, 0, 0, 0.2),
        inset 0 1px 0 var(--glass-highlight);
      overflow: hidden;
      position: relative;
    }

    .glass-panel::before {
      content: "";
      position: absolute;
      inset: -40%;
      background: radial-gradient(
        120% 60% at 0% 0%,
        rgba(255, 255, 255, 0.2),
        transparent 60%
      );
      pointer-events: none;
      z-index: 0;
    }

    /* Chat Panel */
    .chat-panel {
      width: 400px;
      min-width: 0;
      height: 100%;
      display: flex;
      flex-direction: column;
      z-index: 10;
      flex-shrink: 0;
    }

    /* Chat Header */
    .chat-header {
      height: var(--header-height);
      padding: 0 20px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      border-bottom: 1px solid var(--glass-border-light);
      flex-shrink: 0;
      position: relative;
      z-index: 1;
    }

    .chat-title {
      display: flex;
      align-items: center;
      gap: 12px;
    }

    .tree-icon {
      font-size: 28px;
      filter: drop-shadow(0 4px 12px rgba(0, 0, 0, 0.3));
      animation: grow 4.5s infinite ease-in-out;
    }

    @keyframes grow {
      0%, 100% { transform: scale(1); }
      50% { transform: scale(1.06); }
    }

    .chat-title h1 {
      font-size: 18px;
      font-weight: 600;
      letter-spacing: -0.02em;
      text-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
    }

    .status-badge {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 6px 14px;
      background: rgba(255, 255, 255, 0.15);
      backdrop-filter: blur(10px);
      border-radius: 100px;
      border: 1px solid var(--glass-border-light);
      font-size: 12px;
      font-weight: 600;
      color: var(--text-primary);
    }

    .status-dot {
      width: 8px;
      height: 8px;
      background: var(--accent);
      border-radius: 50%;
      box-shadow: 0 0 12px var(--accent-glow);
      animation: pulse 2s ease-in-out infinite;
    }

    @keyframes pulse {
      0%, 100% { opacity: 1; transform: scale(1); }
      50% { opacity: 0.7; transform: scale(1.15); }
    }

    /* Panel Controls */
    .panel-controls {
      display: flex;
      gap: 8px;
    }

    .panel-btn {
      width: 36px;
      height: 36px;
      display: flex;
      align-items: center;
      justify-content: center;
      background: rgba(255, 255, 255, 0.1);
      border: 1px solid var(--glass-border-light);
      border-radius: 10px;
      color: var(--text-secondary);
      cursor: pointer;
      transition: all var(--transition-fast);
    }

    .panel-btn:hover {
      background: rgba(255, 255, 255, 0.2);
      color: var(--text-primary);
      transform: scale(1.05);
    }

    .panel-btn:active {
      transform: scale(0.95);
    }

    .panel-btn svg {
      width: 18px;
      height: 18px;
    }

    /* Chat Messages Area */
    .chat-messages {
      flex: 1;
      overflow-y: auto;
      overflow-x: hidden;
      padding: 24px 20px;
      display: flex;
      flex-direction: column;
      gap: 16px;
      position: relative;
      z-index: 1;
    }

    .chat-messages::-webkit-scrollbar {
      width: 6px;
    }

    .chat-messages::-webkit-scrollbar-track {
      background: transparent;
    }

    .chat-messages::-webkit-scrollbar-thumb {
      background: rgba(255, 255, 255, 0.2);
      border-radius: 3px;
    }

    .chat-messages::-webkit-scrollbar-thumb:hover {
      background: rgba(255, 255, 255, 0.3);
    }

    /* Welcome Message */
    .welcome-message {
      text-align: center;
      padding: 40px 20px;
    }

    .welcome-icon {
      font-size: 64px;
      margin-bottom: 20px;
      display: inline-block;
      filter: drop-shadow(0 8px 32px rgba(0, 0, 0, 0.3));
      animation: floatIcon 3s ease-in-out infinite;
    }

    @keyframes floatIcon {
      0%, 100% { transform: translateY(0); }
      50% { transform: translateY(-10px); }
    }

    .welcome-message h2 {
      font-size: 24px;
      font-weight: 600;
      margin-bottom: 12px;
      letter-spacing: -0.02em;
      text-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
    }

    .welcome-message p {
      font-size: 15px;
      color: var(--text-secondary);
      line-height: 1.6;
    }

    /* Message Bubble */
    .message {
      display: flex;
      gap: 12px;
      animation: messageIn 0.3s ease-out;
      min-width: 0;
      max-width: 100%;
    }

    @keyframes messageIn {
      from {
        opacity: 0;
        transform: translateY(10px);
      }
    }

    .message.user {
      flex-direction: row-reverse;
    }

    .message-avatar {
      width: 36px;
      height: 36px;
      border-radius: 12px;
      background: rgba(255, 255, 255, 0.15);
      backdrop-filter: blur(10px);
      border: 1px solid var(--glass-border-light);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 16px;
      flex-shrink: 0;
    }

    .message.user .message-avatar {
      background: linear-gradient(135deg, rgba(99, 102, 241, 0.6) 0%, rgba(139, 92, 246, 0.6) 100%);
    }

    .message-content {
      max-width: 85%;
      min-width: 0;
      padding: 14px 18px;
      background: rgba(255, 255, 255, 0.15);
      backdrop-filter: blur(10px);
      border: 1px solid var(--glass-border-light);
      border-radius: 18px;
      font-size: 14px;
      line-height: 1.6;
      color: var(--text-primary);
      word-wrap: break-word;
      overflow-wrap: break-word;
      word-break: break-word;
      hyphens: auto;
    }

    .message.user .message-content {
      background: linear-gradient(135deg, rgba(99, 102, 241, 0.5) 0%, rgba(139, 92, 246, 0.5) 100%);
      border-radius: 18px 18px 6px 18px;
    }

    .message.assistant .message-content {
      border-radius: 18px 18px 18px 6px;
    }

    /* Chat Input Area */
    .chat-input-area {
      padding: 16px 20px 20px;
      border-top: 1px solid var(--glass-border-light);
      position: relative;
      z-index: 1;
    }

    .input-container {
      display: flex;
      align-items: flex-end;
      gap: 12px;
      padding: 14px 18px;
      background: rgba(255, 255, 255, 0.15);
      backdrop-filter: blur(10px);
      border: 1px solid var(--glass-border-light);
      border-radius: 18px;
      transition: all var(--transition-fast);
      min-width: 0;
    }

    .input-container:focus-within {
      background: rgba(255, 255, 255, 0.2);
      border-color: rgba(255, 255, 255, 0.4);
      box-shadow: 0 0 0 4px rgba(255, 255, 255, 0.1);
    }

    .chat-input {
      flex: 1;
      min-width: 0;
      width: 100%;
      background: transparent;
      border: none;
      outline: none;
      font-family: inherit;
      font-size: 15px;
      color: var(--text-primary);
      resize: none;
      max-height: 120px;
      line-height: 1.5;
      word-wrap: break-word;
      overflow-wrap: break-word;
    }

    .chat-input::placeholder {
      color: var(--text-muted);
    }

    .send-btn {
      width: 40px;
      height: 40px;
      display: flex;
      align-items: center;
      justify-content: center;
      background: var(--accent);
      border: none;
      border-radius: 12px;
      color: white;
      cursor: pointer;
      transition: all var(--transition-fast);
      flex-shrink: 0;
      box-shadow: 0 4px 15px var(--accent-glow);
    }

    .send-btn:hover:not(:disabled) {
      transform: scale(1.08);
      box-shadow: 0 6px 25px var(--accent-glow);
    }

    .send-btn:active:not(:disabled) {
      transform: scale(0.95);
    }

    .send-btn:disabled {
      opacity: 0.4;
      cursor: not-allowed;
      transform: none;
      box-shadow: none;
    }

    .send-btn svg {
      width: 20px;
      height: 20px;
    }

    /* Viewport Panel */
    .viewport-panel {
      flex: 1;
      height: 100%;
      display: flex;
      flex-direction: column;
      min-width: 0;
    }

    /* Viewport Header */
    .viewport-header {
      height: var(--header-height);
      padding: 0 20px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      border-bottom: 1px solid var(--glass-border-light);
      flex-shrink: 0;
      position: relative;
      z-index: 1;
    }

    .viewport-info {
      display: flex;
      align-items: center;
      gap: 12px;
      overflow: hidden;
      flex: 1;
      min-width: 0;
    }

    .url-display {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 8px 14px;
      background: rgba(255, 255, 255, 0.1);
      border: 1px solid var(--glass-border-light);
      border-radius: 10px;
      font-family: 'JetBrains Mono', monospace;
      font-size: 12px;
      color: var(--text-secondary);
      max-width: 100%;
      overflow: hidden;
    }

    .url-display svg {
      width: 14px;
      height: 14px;
      color: var(--text-muted);
      flex-shrink: 0;
    }

    .url-text {
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    /* Iframe Container */
    .iframe-container {
      flex: 1;
      position: relative;
      overflow: hidden;
      border-radius: 0 0 24px 24px;
      margin: -1px;
      margin-top: 0;
    }

    iframe {
      width: 100%;
      height: 100%;
      border: none;
      display: block;
      background: transparent;
      border-radius: 0 0 23px 23px;
    }

    /* Loading Overlay */
    .loading-overlay {
      position: absolute;
      inset: 0;
      background: rgba(var(--glass-rgb), 0.8);
      backdrop-filter: blur(10px);
      display: flex;
      align-items: center;
      justify-content: center;
      opacity: 0;
      pointer-events: none;
      transition: opacity var(--transition-fast);
      z-index: 5;
      border-radius: 0 0 24px 24px;
    }

    .loading-overlay.visible {
      opacity: 1;
      pointer-events: auto;
    }

    .loading-spinner {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 16px;
    }

    .spinner-ring {
      width: 44px;
      height: 44px;
      border: 3px solid rgba(255, 255, 255, 0.2);
      border-top-color: white;
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
    }

    @keyframes spin {
      to { transform: rotate(360deg); }
    }

    .loading-text {
      font-size: 14px;
      font-weight: 500;
      color: var(--text-secondary);
    }

    /* Divider with drag handle */
    .panel-divider {
      width: 16px;
      height: 100%;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: col-resize;
      position: relative;
      z-index: 20;
      flex-shrink: 0;
    }

    .divider-handle {
      width: 6px;
      height: 80px;
      background: rgba(var(--glass-rgb), 0.5);
      backdrop-filter: blur(var(--glass-blur));
      border: 1px solid var(--glass-border);
      border-radius: 4px;
      transition: all var(--transition-fast);
      position: relative;
    }

    .divider-handle::before {
      content: '';
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      width: 2px;
      height: 24px;
      background: rgba(255, 255, 255, 0.3);
      border-radius: 1px;
    }

    .panel-divider:hover .divider-handle,
    .panel-divider.dragging .divider-handle {
      background: rgba(var(--glass-rgb), 0.7);
      width: 8px;
      box-shadow: 0 0 20px rgba(0, 0, 0, 0.2);
    }

    .panel-divider.dragging .divider-handle {
      background: rgba(255, 255, 255, 0.3);
    }

    /* Quick expand buttons */
    .expand-buttons {
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      display: flex;
      flex-direction: column;
      gap: 8px;
      opacity: 0;
      pointer-events: none;
      transition: opacity var(--transition-fast);
    }

    .panel-divider:hover .expand-buttons {
      opacity: 1;
      pointer-events: auto;
    }

    .panel-divider:hover .divider-handle {
      opacity: 0;
    }

    .expand-btn {
      width: 32px;
      height: 32px;
      display: flex;
      align-items: center;
      justify-content: center;
      background: rgba(var(--glass-rgb), 0.8);
      backdrop-filter: blur(var(--glass-blur));
      border: 1px solid var(--glass-border);
      border-radius: 8px;
      color: var(--text-secondary);
      cursor: pointer;
      transition: all var(--transition-fast);
    }

    .expand-btn:hover {
      background: rgba(255, 255, 255, 0.25);
      color: var(--text-primary);
      transform: scale(1.1);
    }

    .expand-btn svg {
      width: 16px;
      height: 16px;
    }

    /* ========== MOBILE SLIDE-UP CHAT ========== */
    
    /* Mobile Bottom Input Bar */
    .mobile-input-bar {
      display: none;
      position: fixed;
      bottom: 0;
      left: 0;
      right: 0;
      z-index: 150;
      padding: 8px 16px;
      padding-bottom: max(12px, env(safe-area-inset-bottom));
      background: rgba(var(--glass-rgb), 0.9);
      backdrop-filter: blur(var(--glass-blur)) saturate(140%);
      -webkit-backdrop-filter: blur(var(--glass-blur)) saturate(140%);
      border-top: 1px solid var(--glass-border);
      box-shadow: 0 -10px 40px rgba(0, 0, 0, 0.2);
    }

    .mobile-input-bar .drag-handle {
      width: 40px;
      height: 4px;
      background: rgba(255, 255, 255, 0.3);
      border-radius: 2px;
      margin: 0 auto 10px;
      pointer-events: none;
    }

    .mobile-input-bar .input-container {
      padding: 10px 14px;
      border-radius: 28px;
    }

    .mobile-input-bar .chat-input {
      font-size: 16px;
    }

    .mobile-input-bar .send-btn {
      width: 38px;
      height: 38px;
      border-radius: 50%;
    }

    /* Mobile Chat Panel (Slide-up Sheet) */
    .mobile-chat-sheet {
      display: none;
      position: fixed;
      bottom: 0;
      left: 0;
      right: 0;
      height: 85vh;
      max-height: calc(100vh - 40px);
      z-index: 200;
      background: rgba(var(--glass-rgb), 0.95);
      backdrop-filter: blur(var(--glass-blur)) saturate(140%);
      -webkit-backdrop-filter: blur(var(--glass-blur)) saturate(140%);
      border-top-left-radius: 24px;
      border-top-right-radius: 24px;
      border: 1px solid var(--glass-border);
      border-bottom: none;
      box-shadow: 0 -20px 60px rgba(0, 0, 0, 0.3);
      transform: translateY(100%);
      transition: transform 0.4s cubic-bezier(0.32, 0.72, 0, 1);
      will-change: transform;
      flex-direction: column;
    }

    .mobile-chat-sheet.open {
      transform: translateY(0);
    }

    .mobile-chat-sheet.dragging {
      transition: none;
    }

    .mobile-sheet-header {
      padding: 8px 16px;
      display: flex;
      flex-direction: column;
      align-items: center;
      border-bottom: 1px solid var(--glass-border-light);
      flex-shrink: 0;
      cursor: grab;
      touch-action: none;
    }

    .mobile-sheet-header:active {
      cursor: grabbing;
    }

    .mobile-sheet-header .drag-handle {
      width: 40px;
      height: 4px;
      background: rgba(255, 255, 255, 0.3);
      border-radius: 2px;
      margin-bottom: 10px;
      pointer-events: none;
    }

    .mobile-sheet-title-row {
      width: 100%;
      display: flex;
      align-items: center;
      justify-content: space-between;
      pointer-events: none;
    }

    .mobile-sheet-title-row .mobile-close-btn {
      pointer-events: auto;
    }

    .mobile-sheet-title {
      display: flex;
      align-items: center;
      gap: 10px;
    }

    .mobile-sheet-title .tree-icon {
      font-size: 24px;
    }

    .mobile-sheet-title h1 {
      font-size: 17px;
      font-weight: 600;
    }

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
      transition: all var(--transition-fast);
    }

    .mobile-close-btn:hover {
      background: rgba(255, 255, 255, 0.2);
      color: var(--text-primary);
    }

    .mobile-close-btn svg {
      width: 16px;
      height: 16px;
    }

    .mobile-chat-messages {
      flex: 1;
      overflow-y: auto;
      overflow-x: hidden;
      padding: 16px;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    .mobile-chat-messages::-webkit-scrollbar {
      width: 4px;
    }

    .mobile-chat-messages::-webkit-scrollbar-thumb {
      background: rgba(255, 255, 255, 0.2);
      border-radius: 2px;
    }

    .mobile-chat-input-area {
      padding: 12px 16px;
      padding-bottom: max(12px, env(safe-area-inset-bottom));
      border-top: 1px solid var(--glass-border-light);
      flex-shrink: 0;
    }

    .mobile-chat-input-area .input-container {
      padding: 12px 16px;
      border-radius: 24px;
    }

    .mobile-chat-input-area .chat-input {
      font-size: 16px;
    }

    /* Backdrop for mobile sheet */
    .mobile-backdrop {
      display: none;
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.4);
      z-index: 190;
      opacity: 0;
      transition: opacity 0.3s ease;
      pointer-events: none;
    }

    .mobile-backdrop.visible {
      opacity: 1;
      pointer-events: auto;
    }

    /* Responsive */
    @media (max-width: 900px) {
      :root {
        --chat-width: 340px;
      }
    }

    @media (max-width: 768px) {
      .app-container {
        padding: 0;
        gap: 0;
        flex-direction: column;
      }

      /* Hide desktop chat panel on mobile */
      .chat-panel {
        display: none !important;
      }

      .viewport-panel {
        width: 100% !important;
        height: 100%;
        padding-bottom: var(--mobile-input-height);
      }

      .viewport-panel.glass-panel {
        border-radius: 0;
      }

      /* Hide viewport header on mobile */
      .viewport-header {
        display: none;
      }

      .iframe-container {
        border-radius: 0;
        margin: 0;
      }

      iframe {
        border-radius: 0;
      }

      .loading-overlay {
        border-radius: 0;
      }

      .panel-divider {
        display: none;
      }

      /* Show mobile elements */
      .mobile-input-bar {
        display: block;
      }

      .mobile-chat-sheet {
        display: flex;
      }

      .mobile-backdrop {
        display: block;
      }
    }

    @media (max-width: 480px) {
      .mobile-sheet-title h1 {
        font-size: 16px;
      }

      .mobile-sheet-title .tree-icon {
        font-size: 22px;
      }
    }

    /* Safe area support for notched devices */
    @supports (padding: max(0px)) {
      @media (max-width: 768px) {
        .viewport-panel {
          padding-bottom: calc(var(--mobile-input-height) + env(safe-area-inset-bottom));
        }
      }
    }

    /* Prevent text selection while dragging */
    .app-container.dragging {
      user-select: none;
      cursor: col-resize;
    }

    .app-container.dragging iframe {
      pointer-events: none;
    }

    /* Panel collapsed state */
    .chat-panel.collapsed,
    .viewport-panel.collapsed {
      width: 0 !important;
      min-width: 0 !important;
      opacity: 0;
      pointer-events: none;
      padding: 0;
      border: none;
      overflow: hidden;
    }

    /* Base smooth transitions for panels */
    .chat-panel,
    .viewport-panel {
      transition: width 0.4s cubic-bezier(0.4, 0, 0.2, 1),
                  opacity 0.4s cubic-bezier(0.4, 0, 0.2, 1),
                  flex 0.4s cubic-bezier(0.4, 0, 0.2, 1);
    }

    /* Disable transitions while dragging */
    .app-container.dragging .chat-panel,
    .app-container.dragging .viewport-panel {
      transition: none;
    }

    /* Smooth panel transitions for snap-to-mode */
    .chat-panel.animating,
    .viewport-panel.animating {
      transition: width 0.4s cubic-bezier(0.4, 0, 0.2, 1),
                  opacity 0.4s cubic-bezier(0.4, 0, 0.2, 1),
                  flex 0.4s cubic-bezier(0.4, 0, 0.2, 1);
      will-change: width, opacity, flex;
    }

    html, body {
      background: #736fe6;
      margin: 0;
      padding: 0;
    }

    /* Hide old mobile toggle */
    .mobile-toggle {
      display: none !important;
    }
      .chat-header a {
        text-decoration: none;
        color: inherit;
      }
  </style>
</head>
<body>
  <!-- Animated Background -->
  <div class="app-bg"></div>

  <div class="app-container">
    <!-- Chat Panel (Desktop only) -->
    <div class="chat-panel glass-panel" id="chatPanel">
     <a href="/">
      <div class="chat-header">
        <div class="chat-title">
          <span class="tree-icon">🌳</span>
         <h1>Tree</h1>
        </div>
        </a>
        <div class="panel-controls">
          <div class="status-badge">
            <span class="status-dot"></span>
            <span>Connected</span>
          </div>
        </div>
      </div>

      <div class="chat-messages" id="chatMessages">
        <div class="welcome-message">
          <div class="welcome-icon">🌳</div>
          <p>Your intelligent workspace is ready. Start typing to interact with your Tree.</p>
          <p>
            <strong>Coming soon.</strong> For now, you can connect directly with ChatGPT using the
            App functionality via OAuth. This option is less deeply integrated and requires more
            manual use of tools, but it works well for quick AI assistance.
          </p>
          <p>
            <strong>Name:</strong> Tree<br />
            <strong>MCP Server URL:</strong>
            <a href="https://tree.tabors.site/mcp" target="_blank" rel="noopener noreferrer">
              https://tree.tabors.site/mcp
            </a><br />
            <strong>Authentication:</strong> OAuth
          </p>
        </div>
      </div>

      <div class="chat-input-area">
        <div class="input-container">
          <textarea 
            class="chat-input" 
            id="chatInput" 
            placeholder="Message Tree..."
            rows="1"
          ></textarea>
          <button class="send-btn" id="sendBtn" disabled>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z"/>
            </svg>
          </button>
        </div>
      </div>
    </div>

    <!-- Panel Divider -->
    <div class="panel-divider" id="panelDivider">
      <div class="divider-handle"></div>
      <div class="expand-buttons">
        <button class="expand-btn" id="expandChatBtn" title="Expand chat fully">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M11 19l-7-7 7-7"/>
            <path d="M19 19l-7-7 7-7"/>
          </svg>
        </button>
        <button class="expand-btn" id="swapPanelsBtn" title="Swap panels">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M7 16l-4-4 4-4"/>
            <path d="M17 8l4 4-4 4"/>
            <path d="M3 12h18"/>
          </svg>
        </button>
        <button class="expand-btn" id="resetPanelsBtn" title="Reset to 50/50">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="3" y="3" width="7" height="18" rx="1"/>
            <rect x="14" y="3" width="7" height="18" rx="1"/>
          </svg>
        </button>
        <button class="expand-btn" id="expandViewportBtn" title="Expand viewport fully">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M13 5l7 7-7 7"/>
            <path d="M5 5l7 7-7 7"/>
          </svg>
        </button>
      </div>
    </div>

    <!-- Viewport Panel -->
    <div class="viewport-panel glass-panel" id="viewportPanel">
      <div class="viewport-header">
        <div class="viewport-info">
          <div class="url-display">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="10"/>
              <path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
            </svg>
            <span class="url-text" id="urlDisplay">/api/user/${req.userId}?html&token=${userHtml.htmlShareToken}</span>
          </div>
        </div>
        <div class="panel-controls">
          <button class="panel-btn" id="refreshBtn" title="Refresh">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M23 4v6h-6M1 20v-6h6"/>
              <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
            </svg>
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
        <iframe
          id="viewport"
          src="/api/user/${req.userId}?html&token=${userHtml.htmlShareToken}"
          sandbox="
            allow-same-origin
            allow-scripts
            allow-forms
            allow-popups
            allow-modals
            allow-downloads
            allow-top-navigation-by-user-activation
            allow-top-navigation

          "
        ></iframe>
      </div>
    </div>
  </div>

  <!-- Mobile Bottom Input Bar -->
  <div class="mobile-input-bar" id="mobileInputBar">
    <div class="drag-handle" id="mobileInputDragHandle"></div>
    <div class="input-container">
      <textarea 
        class="chat-input" 
        id="mobileBottomInput" 
        placeholder="Message Tree..."
        rows="1"
      ></textarea>
      <button class="send-btn" id="mobileSendBtn" disabled>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z"/>
        </svg>
      </button>
    </div>
  </div>

  <!-- Mobile Backdrop -->
  <div class="mobile-backdrop" id="mobileBackdrop"></div>

  <!-- Mobile Chat Sheet -->
  <div class="mobile-chat-sheet" id="mobileChatSheet">
    <div class="mobile-sheet-header">
      <div class="drag-handle" id="mobileSheetDragHandle"></div>
      <div class="mobile-sheet-title-row">
        <div class="mobile-sheet-title">
          <span class="tree-icon">🌳</span>
          <h1>Tree</h1>
        </div>
        <button class="mobile-close-btn" id="mobileCloseBtn">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M18 6L6 18M6 6l12 12"/>
          </svg>
        </button>
      </div>
    </div>

    <div class="mobile-chat-messages" id="mobileChatMessages">
      <div class="welcome-message">
        <div class="welcome-icon">🌳</div>
        <p>
  <strong>Coming soon.</strong> For now, you can connect directly with ChatGPT using the
  App functionality via OAuth. This option is less deeply integrated and requires more
  manual use of tools, but it works well for quick AI assistance.
</p>

<p>

  <strong>Name:</strong> Tree<br />
  <strong>MCP Server URL:</strong>
  <a href="https://tree.tabors.site/mcp" target="_blank" rel="noopener noreferrer">
    https://tree.tabors.site/mcp
  </a><br />
  <strong>Authentication:</strong> OAuth
</p>

      </div>
    </div>

    <div class="mobile-chat-input-area">
      <div class="input-container">
        <textarea 
          class="chat-input" 
          id="mobileSheetInput" 
          placeholder="Message Tree..."
          rows="1"
        ></textarea>
        <button class="send-btn" id="mobileSheetSendBtn" disabled>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z"/>
          </svg>
        </button>
      </div>
    </div>
  </div>

  <script src="/socket.io/socket.io.js"></script>

  <script>
    // Elements
    const iframe = document.getElementById("viewport");
    const appContainer = document.querySelector(".app-container");
    const chatPanel = document.getElementById("chatPanel");
    const viewportPanel = document.getElementById("viewportPanel");
    const chatMessages = document.getElementById("chatMessages");
    const chatInput = document.getElementById("chatInput");
    const sendBtn = document.getElementById("sendBtn");
    const panelDivider = document.getElementById("panelDivider");
    const expandChatBtn = document.getElementById("expandChatBtn");
    const expandViewportBtn = document.getElementById("expandViewportBtn");
    const resetPanelsBtn = document.getElementById("resetPanelsBtn");
    const swapPanelsBtn = document.getElementById("swapPanelsBtn");
    const refreshBtn = document.getElementById("refreshBtn");
    const loadingOverlay = document.getElementById("loadingOverlay");
    const urlDisplay = document.getElementById("urlDisplay");

    // Mobile elements
    const mobileInputBar = document.getElementById("mobileInputBar");
    const mobileInputDragHandle = document.getElementById("mobileInputDragHandle");
    const mobileBottomInput = document.getElementById("mobileBottomInput");
    const mobileSendBtn = document.getElementById("mobileSendBtn");
    const mobileBackdrop = document.getElementById("mobileBackdrop");
    const mobileChatSheet = document.getElementById("mobileChatSheet");
    const mobileSheetDragHandle = document.getElementById("mobileSheetDragHandle");
    const mobileChatMessages = document.getElementById("mobileChatMessages");
    const mobileSheetInput = document.getElementById("mobileSheetInput");
    const mobileSheetSendBtn = document.getElementById("mobileSheetSendBtn");
    const mobileCloseBtn = document.getElementById("mobileCloseBtn");

    // Panel state (desktop)
    const DIVIDER_WIDTH = 16;
    const CONTAINER_PADDING = 32;
    const MIN_PANEL_WIDTH = 280; // Minimum readable width
    let isDragging = false;
    let containerWidth = 0;
    let currentChatWidth = 0;
    let panelsSwapped = false;

    // Mobile sheet state
    let isSheetOpen = false;
    let sheetStartTranslateY = 0;

    function calculateContainerWidth() {
      containerWidth = appContainer.clientWidth;
    }

    function getAvailableWidth() {
      return containerWidth - CONTAINER_PADDING - DIVIDER_WIDTH;
    }

    function setChatWidth(width, animate = false) {
      const availableWidth = getAvailableWidth();
      
      // Clamp to valid range
      let clampedWidth = Math.max(0, Math.min(width, availableWidth));
      
      // Snap to edges if below minimum readable width
      if (clampedWidth > 0 && clampedWidth < MIN_PANEL_WIDTH) {
        clampedWidth = 0;
      }
      
      const viewportWidth = availableWidth - clampedWidth;
      if (viewportWidth > 0 && viewportWidth < MIN_PANEL_WIDTH) {
        clampedWidth = availableWidth;
      }
      
      currentChatWidth = clampedWidth;
      
      // Apply styles
      if (clampedWidth === 0) {
        chatPanel.classList.add('collapsed');
        chatPanel.style.width = '0px';
      } else {
        chatPanel.classList.remove('collapsed');
        chatPanel.style.width = clampedWidth + 'px';
        chatPanel.style.opacity = '1';
        chatPanel.style.pointerEvents = 'auto';
      }
      
      const actualViewportWidth = availableWidth - clampedWidth;
      if (actualViewportWidth === 0) {
        viewportPanel.classList.add('collapsed');
      } else {
        viewportPanel.classList.remove('collapsed');
        viewportPanel.style.opacity = '1';
        viewportPanel.style.pointerEvents = 'auto';
      }
    }

    function swapPanels() {
      panelsSwapped = !panelsSwapped;
      
      if (panelsSwapped) {
        appContainer.style.flexDirection = 'row-reverse';
      } else {
        appContainer.style.flexDirection = 'row';
      }
    }

    // Initialize
    calculateContainerWidth();
    const initialWidth = getAvailableWidth() / 2;
    setChatWidth(initialWidth, false);

    window.addEventListener('resize', () => {
      calculateContainerWidth();
      // Maintain current ratio on resize
      const availableWidth = getAvailableWidth();
      const ratio = currentChatWidth / (containerWidth - CONTAINER_PADDING - DIVIDER_WIDTH);
      setChatWidth(availableWidth * ratio, false);
    });

    // Desktop dragging logic
    let dragStartX = 0;
    let dragStartWidth = 0;

    panelDivider.addEventListener('mousedown', (e) => {
      isDragging = true;
      dragStartX = e.clientX;
      dragStartWidth = currentChatWidth;
      appContainer.classList.add('dragging');
      panelDivider.classList.add('dragging');
      e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
      if (!isDragging) return;
      
      const deltaX = panelsSwapped ? -(e.clientX - dragStartX) : (e.clientX - dragStartX);
      const newWidth = dragStartWidth + deltaX;
      const availableWidth = getAvailableWidth();
      
      // Free-form dragging without snapping during drag
      let clampedWidth = Math.max(0, Math.min(newWidth, availableWidth));
      
      currentChatWidth = clampedWidth;
      
      // Update visual state during drag
      if (clampedWidth < MIN_PANEL_WIDTH / 2) {
        chatPanel.style.opacity = String(clampedWidth / (MIN_PANEL_WIDTH / 2));
      } else {
        chatPanel.style.opacity = '1';
      }
      
      const viewportWidth = availableWidth - clampedWidth;
      if (viewportWidth < MIN_PANEL_WIDTH / 2) {
        viewportPanel.style.opacity = String(viewportWidth / (MIN_PANEL_WIDTH / 2));
      } else {
        viewportPanel.style.opacity = '1';
      }
      
      chatPanel.style.width = clampedWidth + 'px';
      chatPanel.classList.remove('collapsed');
      viewportPanel.classList.remove('collapsed');
    });

    document.addEventListener('mouseup', (e) => {
      if (!isDragging) return;
      
      isDragging = false;
      appContainer.classList.remove('dragging');
      panelDivider.classList.remove('dragging');
      
      // Only snap if below minimum readable width
      setChatWidth(currentChatWidth, true);
    });

    // Touch support for desktop divider
    panelDivider.addEventListener('touchstart', (e) => {
      isDragging = true;
      dragStartX = e.touches[0].clientX;
      dragStartWidth = currentChatWidth;
      appContainer.classList.add('dragging');
      panelDivider.classList.add('dragging');
    });

    document.addEventListener('touchmove', (e) => {
      if (!isDragging || isSheetDragging) return;
      
      const touch = e.touches[0];
      const deltaX = panelsSwapped ? -(touch.clientX - dragStartX) : (touch.clientX - dragStartX);
      const newWidth = dragStartWidth + deltaX;
      const availableWidth = getAvailableWidth();
      
      let clampedWidth = Math.max(0, Math.min(newWidth, availableWidth));
      currentChatWidth = clampedWidth;
      
      if (clampedWidth < MIN_PANEL_WIDTH / 2) {
        chatPanel.style.opacity = String(clampedWidth / (MIN_PANEL_WIDTH / 2));
      } else {
        chatPanel.style.opacity = '1';
      }
      
      const viewportWidth = availableWidth - clampedWidth;
      if (viewportWidth < MIN_PANEL_WIDTH / 2) {
        viewportPanel.style.opacity = String(viewportWidth / (MIN_PANEL_WIDTH / 2));
      } else {
        viewportPanel.style.opacity = '1';
      }
      
      chatPanel.style.width = clampedWidth + 'px';
      chatPanel.classList.remove('collapsed');
      viewportPanel.classList.remove('collapsed');
    });

    document.addEventListener('touchend', () => {
      if (!isDragging || isSheetDragging) return;
      
      isDragging = false;
      appContainer.classList.remove('dragging');
      panelDivider.classList.remove('dragging');
      
      setChatWidth(currentChatWidth, true);
    });

    // Expand buttons
    expandChatBtn.addEventListener('click', () => setChatWidth(getAvailableWidth(), true));
    expandViewportBtn.addEventListener('click', () => setChatWidth(0, true));
    resetPanelsBtn.addEventListener('click', () => setChatWidth(getAvailableWidth() / 2, true));
    swapPanelsBtn.addEventListener('click', swapPanels);

    // ========== MOBILE SHEET LOGIC ==========

    // Shared text state between bottom bar and sheet
    let sharedInputText = '';
    let isSheetDragging = false;

    function syncTextToBottomBar() {
      mobileBottomInput.value = sharedInputText;
      mobileBottomInput.style.height = 'auto';
      updateMobileSendButtons();
    }

    function syncTextToSheet() {
      mobileSheetInput.value = sharedInputText;
      mobileSheetInput.style.height = 'auto';
      if (sharedInputText) {
        mobileSheetInput.style.height = Math.min(mobileSheetInput.scrollHeight, 120) + 'px';
      }
      updateMobileSendButtons();
    }

    function openMobileSheet(focusInput = true) {
      if (isSheetOpen) return;
      
      isSheetOpen = true;
      mobileChatSheet.classList.add('open');
      mobileBackdrop.classList.add('visible');
      mobileInputBar.style.visibility = 'hidden';
      mobileInputBar.style.pointerEvents = 'none';
      
      // Sync text to sheet
      syncTextToSheet();
      
      // Focus the sheet input
      if (focusInput) {
        setTimeout(() => {
          mobileSheetInput.focus();
          // Move cursor to end
          mobileSheetInput.selectionStart = mobileSheetInput.selectionEnd = mobileSheetInput.value.length;
        }, 100);
      }
    }

    function closeMobileSheet() {
      if (!isSheetOpen) return;
      
      isSheetOpen = false;
      mobileChatSheet.classList.remove('open');
      mobileBackdrop.classList.remove('visible');
      
      // Save current text state
      sharedInputText = mobileSheetInput.value;
      
      // Show input bar again after animation
      setTimeout(() => {
        if (!isSheetOpen) {
          mobileInputBar.style.visibility = 'visible';
          mobileInputBar.style.pointerEvents = 'auto';
          syncTextToBottomBar();
        }
      }, 350);
    }

    // Open sheet when tapping/focusing bottom input - immediate focus transfer
    mobileBottomInput.addEventListener('focus', (e) => {
      e.preventDefault();
      mobileBottomInput.blur();
      sharedInputText = mobileBottomInput.value;
      openMobileSheet(true);
    });

    // Close button
    mobileCloseBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      closeMobileSheet();
    });

    // Backdrop click to close
    mobileBackdrop.addEventListener('click', closeMobileSheet);

    // ========== DRAG HANDLING ==========
    
    let dragStartY = 0;
    let dragCurrentY = 0;
    let isDraggingBar = false;
    let isDraggingSheet = false;
    let dragStartTime = 0;

    // Bottom bar drag - open sheet
    mobileInputBar.addEventListener('touchstart', (e) => {
      // Don't intercept if touching the input or button directly
      if (e.target.closest('.input-container')) return;
      
      isDraggingBar = true;
      dragStartY = e.touches[0].clientY;
      dragStartTime = Date.now();
      e.preventDefault();
    }, { passive: false });

    // Sheet header drag - close sheet
    const mobileSheetHeader = mobileChatSheet.querySelector('.mobile-sheet-header');
    
    mobileSheetHeader.addEventListener('touchstart', (e) => {
      // Allow close button to work
      if (e.target.closest('.mobile-close-btn')) return;
      
      isSheetDragging = true;
      isDraggingSheet = true;
      dragStartY = e.touches[0].clientY;
      dragStartTime = Date.now();
      sheetStartTranslateY = 0;
      mobileChatSheet.classList.add('dragging');
      e.preventDefault();
    }, { passive: false });

    document.addEventListener('touchmove', (e) => {
      if (isDraggingBar) {
        dragCurrentY = e.touches[0].clientY;
        const deltaY = dragStartY - dragCurrentY;
        
        // Visual feedback - slight scale/opacity change
        if (deltaY > 10) {
          mobileInputBar.style.transform = \`translateY(\${Math.max(-20, -deltaY * 0.3)}px)\`;
          mobileInputBar.style.opacity = String(Math.max(0.7, 1 - deltaY * 0.005));
        }
      }
      
      if (isDraggingSheet) {
        dragCurrentY = e.touches[0].clientY;
        const deltaY = Math.max(0, dragCurrentY - dragStartY);
        mobileChatSheet.style.transform = \`translateY(\${deltaY}px)\`;
      }
    }, { passive: true });

    document.addEventListener('touchend', (e) => {
      if (isDraggingBar) {
        const deltaY = dragStartY - dragCurrentY;
        const velocity = deltaY / (Date.now() - dragStartTime);
        
        // Reset visual state
        mobileInputBar.style.transform = '';
        mobileInputBar.style.opacity = '';
        
        // Open if dragged up enough or with velocity
        if (deltaY > 50 || velocity > 0.3) {
          sharedInputText = mobileBottomInput.value;
          openMobileSheet(true);
        }
        
        isDraggingBar = false;
        dragCurrentY = 0;
      }
      
      if (isDraggingSheet) {
        mobileChatSheet.classList.remove('dragging');
        
        const deltaY = dragCurrentY - dragStartY;
        const velocity = deltaY / (Date.now() - dragStartTime);
        const sheetHeight = mobileChatSheet.offsetHeight;
        
        // Close if dragged down enough (20%) or with velocity
        if (deltaY > sheetHeight * 0.2 || velocity > 0.5) {
          mobileChatSheet.style.transform = '';
          closeMobileSheet();
        } else {
          // Snap back
          mobileChatSheet.style.transform = '';
        }
        
        isDraggingSheet = false;
        isSheetDragging = false;
        dragCurrentY = 0;
      }
    });

    // Also allow dragging from the messages area edge
    let messagesAreaDragging = false;
    let messagesStartY = 0;
    
    mobileChatMessages.addEventListener('touchstart', (e) => {
      // Only if scrolled to top and touching near the top
      if (mobileChatMessages.scrollTop <= 0) {
        messagesAreaDragging = true;
        messagesStartY = e.touches[0].clientY;
      }
    }, { passive: true });

    mobileChatMessages.addEventListener('touchmove', (e) => {
      if (messagesAreaDragging && mobileChatMessages.scrollTop <= 0) {
        const deltaY = e.touches[0].clientY - messagesStartY;
        if (deltaY > 0) {
          // Pulling down
          mobileChatSheet.style.transform = \`translateY(\${deltaY * 0.5}px)\`;
          mobileChatSheet.classList.add('dragging');
        }
      }
    }, { passive: true });

    mobileChatMessages.addEventListener('touchend', (e) => {
      if (messagesAreaDragging) {
        mobileChatSheet.classList.remove('dragging');
        const transform = mobileChatSheet.style.transform;
        const match = transform.match(/translateY\\(([\\d.]+)px\\)/);
        const currentY = match ? parseFloat(match[1]) : 0;
        
        if (currentY > 80) {
          mobileChatSheet.style.transform = '';
          closeMobileSheet();
        } else {
          mobileChatSheet.style.transform = '';
        }
        messagesAreaDragging = false;
      }
    });

    // Mobile input handling
    function updateMobileSendButtons() {
      const bottomHasText = mobileBottomInput.value.trim().length > 0;
      const sheetHasText = mobileSheetInput.value.trim().length > 0;
      
      mobileSendBtn.disabled = !bottomHasText;
      mobileSheetSendBtn.disabled = !sheetHasText;
    }

    mobileBottomInput.addEventListener('input', () => {
      sharedInputText = mobileBottomInput.value;
      updateMobileSendButtons();
      mobileBottomInput.style.height = 'auto';
      mobileBottomInput.style.height = Math.min(mobileBottomInput.scrollHeight, 80) + 'px';
    });

    mobileSheetInput.addEventListener('input', () => {
      sharedInputText = mobileSheetInput.value;
      updateMobileSendButtons();
      mobileSheetInput.style.height = 'auto';
      mobileSheetInput.style.height = Math.min(mobileSheetInput.scrollHeight, 120) + 'px';
    });

    mobileSheetInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMobileMessage();
      }
    });

    mobileSheetSendBtn.addEventListener('click', sendMobileMessage);
    mobileSendBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      // Send directly without opening
      const message = mobileBottomInput.value.trim();
      if (!message) return;
      
      sharedInputText = '';
      mobileBottomInput.value = '';
      updateMobileSendButtons();
      
      // Add messages
      const welcomeMsg = mobileChatMessages.querySelector('.welcome-message');
      if (welcomeMsg) welcomeMsg.remove();
      addMobileMessage(message, 'user');
      addMessage(message, 'user');
      
      // Open sheet to show the conversation
      openMobileSheet(false);
    });

    function sendMobileMessage() {
      const message = mobileSheetInput.value.trim();
      if (!message) return;

      // Remove welcome message if present
      const welcomeMsg = mobileChatMessages.querySelector('.welcome-message');
      if (welcomeMsg) welcomeMsg.remove();

      // Add user message
      addMobileMessage(message, 'user');

      // Clear input and shared state
      mobileSheetInput.value = '';
      sharedInputText = '';
      mobileSheetInput.style.height = 'auto';
      updateMobileSendButtons();

      // Also sync to desktop
      addMessage(message, 'user');

      console.log('[mobile chat] sending:', message);
    }

    function addMobileMessage(content, role) {
      const messageEl = document.createElement('div');
      messageEl.className = \`message \${role}\`;
      messageEl.innerHTML = \`
        <div class="message-avatar">\${role === 'user' ? '👤' : '🌳'}</div>
        <div class="message-content">\${escapeHtml(content)}</div>
      \`;
      mobileChatMessages.appendChild(messageEl);
      mobileChatMessages.scrollTop = mobileChatMessages.scrollHeight;
    }

    // Socket connection
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
      loadingOverlay.classList.add("visible");
      urlDisplay.textContent = url;

      if (replace) {
        iframe.contentWindow?.location.replace(url);
      } else {
        iframe.src = url;
      }
    });

    socket.on("reload", () => {
      loadingOverlay.classList.add("visible");
      iframe.contentWindow?.location.reload();
    });

    iframe.addEventListener("load", () => {
      loadingOverlay.classList.remove("visible");
      try {
        const currentUrl = iframe.contentWindow?.location.href;
        if (currentUrl) {
          const url = new URL(currentUrl);
          urlDisplay.textContent = url.pathname + url.search;
        }
      } catch (e) {}
    });

    // Desktop chat input handling
    chatInput.addEventListener("input", () => {
      sendBtn.disabled = !chatInput.value.trim();
      chatInput.style.height = "auto";
      chatInput.style.height = Math.min(chatInput.scrollHeight, 120) + "px";
    });

    chatInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
      }
    });

    sendBtn.addEventListener("click", sendMessage);

    function sendMessage() {
      const message = chatInput.value.trim();
      if (!message) return;

      addMessage(message, "user");
      chatInput.value = "";
      chatInput.style.height = "auto";
      sendBtn.disabled = true;

      // Also sync to mobile
      addMobileMessage(message, 'user');

      console.log("[chat] sending message:", message);
    }

    function addMessage(content, role) {
      const welcomeMsg = chatMessages.querySelector(".welcome-message");
      if (welcomeMsg) welcomeMsg.remove();

      const messageEl = document.createElement("div");
      messageEl.className = \`message \${role}\`;
      messageEl.innerHTML = \`
        <div class="message-avatar">\${role === "user" ? "👤" : "🌳"}</div>
        <div class="message-content">\${escapeHtml(content)}</div>
      \`;
      chatMessages.appendChild(messageEl);
      chatMessages.scrollTop = chatMessages.scrollHeight;
    }

    function escapeHtml(text) {
      const div = document.createElement("div");
      div.textContent = text;
      return div.innerHTML;
    }

    refreshBtn.addEventListener("click", () => {
      loadingOverlay.classList.add("visible");
      iframe.contentWindow?.location.reload();
    });

    // Expose API
    window.TreeApp = {
      addMessage: (content, role) => {
        addMessage(content, role);
        addMobileMessage(content, role);
      },
      navigate: (url) => {
        loadingOverlay.classList.add("visible");
        urlDisplay.textContent = url;
        iframe.src = url;
      },
      setChatWidth,
      expandChat: () => setChatWidth(getAvailableWidth(), true),
      expandViewport: () => setChatWidth(0, true),
      resetPanels: () => setChatWidth(getAvailableWidth() / 2, true),
      swapPanels,
      getChatWidth: () => currentChatWidth,
      isPanelsSwapped: () => panelsSwapped,
      openMobileChat: (focus = true) => openMobileSheet(focus),
      closeMobileChat: closeMobileSheet,
      isMobileChatOpen: () => isSheetOpen
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
