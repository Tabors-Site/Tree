import { page } from "../../html-rendering/html/layout.js";
import { esc, escapeHtml } from "../../html-rendering/html/utils.js";
import { getUserMeta } from "../../../seed/tree/userMetadata.js";

export function renderUserProfile({ userId, user, roots, plan, energy, extraEnergy, queryString, resetTimeLabel, storageUsedKB }) {
  const safeUsername = escapeHtml(user.username);

  const css = `
    html { overflow-y: auto; height: 100%; }

    /* Glass Card Base */
    .glass-card {
      background: rgba(var(--glass-water-rgb), var(--glass-alpha));
      backdrop-filter: blur(22px) saturate(140%);
      -webkit-backdrop-filter: blur(22px) saturate(140%);
      border-radius: 16px;
      padding: 32px;
      margin-bottom: 24px;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.12),
        inset 0 1px 0 rgba(255, 255, 255, 0.25);
      border: 1px solid rgba(255, 255, 255, 0.28);
      position: relative;
      overflow: hidden;
      animation: fadeInUp 0.6s ease-out both;
    }

    /* Header Section */
    .header {
      animation-delay: 0.1s;
    }

    .user-info h1 {
      font-size: 32px;
      font-weight: 700;
      color: white;
      margin-bottom: 16px;
      letter-spacing: -0.5px;
      text-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
    }

    .user-info h1::before {
      content: '\uD83D\uDC64 ';
      font-size: 28px;
    }

    /* User Meta Info */
    .user-meta {
      display: flex;
      gap: 12px;
      align-items: center;
      margin-bottom: 16px;
      flex-wrap: wrap;
    }
.send-button.loading {
  pointer-events: none;
  opacity: 0.9;
}

.send-progress {
  position: absolute;
  left: 0;
  top: 0;
  height: 100%;
  width: 0%;
  background: linear-gradient(
    90deg,
    rgba(255,255,255,0.25),
    rgba(255,255,255,0.6),
    rgba(255,255,255,0.25)
  );
  transition: width 0.2s ease;
  pointer-events: none;
}

    .plan-badge {
      padding: 8px 16px;
      border-radius: 980px;
      font-weight: 600;
      font-size: 13px;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      background: rgba(255, 255, 255, 0.9);
      color: #667eea;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
    }
.plan-basic {
  background: rgba(255, 255, 255, 0.9);
  color: #64748b;
}

/* STANDARD */
.plan-standard {
  background: linear-gradient(135deg, #60a5fa, #2563eb);
  color: white;
}

/* PREMIUM */
.plan-premium {
  background: linear-gradient(135deg, #a855f7, #7c3aed);
  color: white;
}

/* GOD */
.plan-god {
  background: linear-gradient(
    135deg,
    #facc15,
    #f59e0b,
    #eab308
  );
  color: #3a2e00;
  text-shadow: 0 1px 1px rgba(255, 255, 255, 0.6);
  box-shadow:
    0 0 20px rgba(250, 204, 21, 0.6),
    0 6px 24px rgba(234, 179, 8, 0.5);
  border: 1px solid rgba(255, 215, 0, 0.9);
}
    .meta-item {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 8px 14px;
      background: rgba(255, 255, 255, 0.2);
      backdrop-filter: blur(10px);
      border-radius: 980px;
      font-size: 13px;
      font-weight: 500;
      color: white;
      border: 1px solid rgba(255, 255, 255, 0.3);
    }

    .storage-toggle-btn {
      padding: 2px 8px;
      margin-left: 4px;
      border-radius: 6px;
      border: 1px solid rgba(255, 255, 255, 0.4);
      background: rgba(255, 255, 255, 0.2);
      font-size: 11px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.2s;
      color: white;
    }

    .storage-toggle-btn:hover {
      background: rgba(255, 255, 255, 0.3);
      transform: scale(1.05);
    }

    .logout-btn {
      padding: 8px 16px;
      border-radius: 980px;
      border: 1px solid rgba(255, 255, 255, 0.3);
      background: rgba(239, 68, 68, 0.3);
      backdrop-filter: blur(10px);
      color: white;
      font-weight: 600;
      font-size: 13px;
      cursor: pointer;
      transition: all 0.3s;
      box-shadow: 0 4px 12px rgba(239, 68, 68, 0.2);
    }

    .logout-btn:hover {
      background: rgba(239, 68, 68, 0.5);
      transform: translateY(-2px);
      box-shadow: 0 6px 20px rgba(239, 68, 68, 0.3);
    }

    .header { position: relative; }

    .basic-btn {
      position: absolute;
      top: 16px;
      right: 16px;
      padding: 8px 16px;
      border-radius: 980px;
      border: 1px solid rgba(255, 255, 255, 0.3);
      background: rgba(16, 185, 129, 0.3);
      backdrop-filter: blur(10px);
      color: white;
      font-weight: 600;
      font-size: 13px;
      cursor: pointer;
      transition: all 0.3s;
      box-shadow: 0 4px 12px rgba(16, 185, 129, 0.2);
      text-decoration: none;
    }

    .basic-btn:hover {
      background: rgba(16, 185, 129, 0.5);
      transform: translateY(-2px);
      box-shadow: 0 6px 20px rgba(16, 185, 129, 0.3);
    }

    /* User ID */
    .user-id-container {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 12px 16px;
      background: rgba(255, 255, 255, 0.15);
      backdrop-filter: blur(10px);
      border-radius: 10px;
      margin-top: 12px;
      border: 1px solid rgba(255, 255, 255, 0.2);
    }

    .user-id-container code {
      flex: 1;
      background: transparent;
      padding: 0;
      font-size: 13px;
      font-family: 'SF Mono', Monaco, monospace;
      color: white;
      font-weight: 600;
      word-break: break-all;
    }

    #copyNodeIdBtn {
      background: rgba(255, 255, 255, 0.2);
      border: 1px solid rgba(255, 255, 255, 0.3);
      cursor: pointer;
      padding: 6px 10px;
      border-radius: 6px;
      font-size: 16px;
      transition: all 0.2s;
      flex-shrink: 0;
    }

    #copyNodeIdBtn:hover {
      background: rgba(255, 255, 255, 0.3);
      transform: scale(1.1);
    }

    /* Raw Ideas Capture - Enhanced with glow */
    .raw-ideas-section {
      animation-delay: 0.2s;
      box-shadow:
        0 20px 60px rgba(16, 185, 129, 0.3),
        0 0 40px rgba(16, 185, 129, 0.2),
        inset 0 1px 0 rgba(255, 255, 255, 0.25);
    }

    .raw-ideas-section::after {
      content: '';
      position: absolute;
      top: -50%;
      left: -50%;
      width: 200%;
      height: 200%;
      background: radial-gradient(
        circle,
        rgba(16, 185, 129, 0.15) 0%,
        transparent 70%
      );
      animation: pulse 8s ease-in-out infinite;
      pointer-events: none;
    }

    @keyframes pulse {
      0%, 100% {
        transform: scale(1) rotate(0deg);
        opacity: 0.5;
      }
      50% {
        transform: scale(1.1) rotate(180deg);
        opacity: 0.8;
      }
    }

    .raw-ideas-section h2 {
      font-size: 20px;
      font-weight: 600;
      color: white;
      margin-bottom: 20px;
      position: relative;
      z-index: 1;
      text-shadow: 0 2px 8px rgba(0, 0, 0, 0.2),
        0 0 20px rgba(16, 185, 129, 0.4);
    }

    .raw-ideas-section h2::before {
      content: '\uD83D\uDCA1 ';
      font-size: 20px;
    }

    .raw-idea-form {
      display: flex;
      flex-direction: column;
      gap: 16px;
      position: relative;
      z-index: 1;
    }

    #rawIdeaInput {
      width: 100%;
      padding: 16px 20px;
      font-size: 16px;
      line-height: 1.6;
      border-radius: 12px;
      border: 2px solid rgba(255, 255, 255, 0.4);
      background: rgba(255, 255, 255, 0.25);
      backdrop-filter: blur(20px) saturate(150%);
      -webkit-backdrop-filter: blur(20px) saturate(150%);
      font-family: inherit;
      resize: vertical;
      min-height: 80px;
      max-height: 400px;
      transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
      box-shadow:
        0 4px 20px rgba(0, 0, 0, 0.15),
        inset 0 1px 0 rgba(255, 255, 255, 0.4);
      color: #5044c9;
      font-weight: 600;
      text-shadow:
        0 0 12px rgba(102, 126, 234, 0.7),
        0 0 20px rgba(102, 126, 234, 0.4),
        0 1px 3px rgba(255, 255, 255, 1),
        0 2px 8px rgba(80, 68, 201, 0.5);
      letter-spacing: 0.3px;
    }

    #rawIdeaInput:focus {
      outline: none;
      border-color: rgba(102, 126, 234, 0.6);
      backdrop-filter: blur(28px) saturate(170%);
      -webkit-backdrop-filter: blur(28px) saturate(170%);
      box-shadow:
        0 0 0 4px rgba(102, 126, 234, 0.25),
        0 0 40px rgba(102, 126, 234, 0.5),
        0 8px 30px rgba(102, 126, 234, 0.3),
        inset 0 1px 0 rgba(255, 255, 255, 0.6);
      transform: translateY(-2px);
    }

    #rawIdeaInput:focus::placeholder {
      color: rgba(80, 68, 201, 0.4);
    }

    #rawIdeaInput::placeholder {
      color: rgba(80, 68, 201, 0.4);
      font-weight: 400;
      text-shadow: 0 0 6px rgba(102, 126, 234, 0.25);
    }

    #rawIdeaInput:disabled {
      opacity: 0.4;
      cursor: not-allowed;
      background: rgba(255, 255, 255, 0.1);
      transform: none;
    }

    #rawIdeaInput:disabled::placeholder {
      color: rgba(80, 68, 201, 0.25);
    }

    /* Character counter */
    .char-counter {
      display: flex;
      justify-content: flex-end;
      align-items: center;
      margin-top: -8px;
      margin-bottom: 8px;
      font-size: 12px;
      color: rgba(255, 255, 255, 0.6);
      font-weight: 500;
      transition: color 0.2s;
    }

    .char-counter.warning {
      color: rgba(255, 193, 7, 0.9);
    }

    .char-counter.danger {
      color: rgba(239, 68, 68, 0.9);
      font-weight: 600;
    }

    .char-counter.disabled {
      opacity: 0.4;
    }

    /* Energy display */
    .energy-display {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      margin-left: 10px;
      padding: 2px 8px;
      background: rgba(255, 215, 79, 0.2);
      border: 1px solid rgba(255, 215, 79, 0.3);
      border-radius: 10px;
      font-size: 11px;
      font-weight: 600;
      color: rgba(255, 215, 79, 1);
      transition: all 0.2s;
    }

    .energy-display:empty {
      display: none;
    }

    .energy-display.file-energy {
      background: rgba(255, 220, 100, 0.9);
      border-color: rgba(255, 200, 50, 1);
      color: #1a1a1a;
      font-size: 13px;
      font-weight: 700;
      padding: 4px 12px;
      box-shadow: 0 2px 8px rgba(255, 200, 50, 0.4);
    }

    /* File selected badge */
    .file-selected-badge {
      display: none;
      align-items: center;
      gap: 6px;
      padding: 6px 12px;
      background: rgba(255, 255, 255, 0.15);
      border: 1px solid rgba(255, 255, 255, 0.25);
      border-radius: 20px;
      font-size: 12px;
      font-weight: 500;
      color: white;
    }

    .file-selected-badge.visible {
      display: inline-flex;
    }

    .file-selected-badge .file-name {
      max-width: 120px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .file-selected-badge .clear-file {
      background: rgba(255, 255, 255, 0.2);
      border: none;
      border-radius: 50%;
      width: 18px;
      height: 18px;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      font-size: 10px;
      color: white;
      transition: all 0.2s;
    }

    .file-selected-badge .clear-file:hover {
      background: rgba(239, 68, 68, 0.4);
    }

    .form-actions {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 12px;
      flex-wrap: wrap;
    }

    .file-input-wrapper {
      flex: 1;
      min-width: 180px;
      display: flex;
      align-items: center;
      gap: 8px;
    }

    input[type="file"] {
      font-size: 13px;
      color: rgba(255, 255, 255, 0.9);
      cursor: pointer;
    }

    input[type="file"]::file-selector-button {
      padding: 8px 16px;
      border-radius: 980px;
      border: 1px solid rgba(255, 255, 255, 0.3);
      background: rgba(255, 255, 255, 0.2);
      backdrop-filter: blur(10px);
      color: white;
      cursor: pointer;
      font-size: 13px;
      font-weight: 600;
      transition: all 0.2s;
      margin-right: 10px;
    }

    input[type="file"]::file-selector-button:hover {
      background: rgba(255, 255, 255, 0.3);
      transform: translateY(-1px);
    }

    input[type="file"].hidden-input {
      display: none;
    }

    .send-button {
      padding: 14px 32px;
      font-size: 16px;
      font-weight: 600;
      border-radius: 980px;
      border: 1px solid rgba(255, 255, 255, 0.3);
      background: rgba(16, 185, 129, 0.9);
      backdrop-filter: blur(10px);
      color: white;
      cursor: pointer;
      transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
      box-shadow: 0 4px 15px rgba(16, 185, 129, 0.4);
      white-space: nowrap;
      position: relative;
      overflow: hidden;
    }

    .send-button::before {
      content: "";
      position: absolute;
      inset: -40%;
      background: radial-gradient(
        120% 60% at 0% 0%,
        rgba(255, 255, 255, 0.35),
        transparent 60%
      );
      opacity: 0;
      transition: opacity 0.35s ease, transform 0.6s cubic-bezier(0.22, 1, 0.36, 1);
      pointer-events: none;
    }

    .send-button:hover {
      background: rgba(16, 185, 129, 1);
      transform: translateY(-2px);
      box-shadow: 0 6px 25px rgba(16, 185, 129, 0.5);
    }

    .send-button:hover::before {
      opacity: 1;
      transform: translateX(30%) translateY(10%);
    }

    /* Navigation Section */
    .nav-section {
      animation-delay: 0.3s;
    }

    .nav-section h2 {
      font-size: 18px;
      font-weight: 600;
      color: white;
      margin-bottom: 20px;
      text-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
    }

    .nav-links {
      list-style: none;
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
      gap: 12px;
    }

    .nav-links a {
      display: block;
      padding: 14px 18px;
      background: rgba(255, 255, 255, 0.2);
      backdrop-filter: blur(10px);
      border-radius: 980px;
      color: white;
      text-decoration: none;
      font-weight: 600;
      font-size: 14px;
      transition: all 0.3s;
      border: 1px solid rgba(255, 255, 255, 0.3);
      text-align: center;
      position: relative;
      overflow: hidden;
    }

    .nav-links a::before {
      content: "";
      position: absolute;
      inset: -40%;
      background: linear-gradient(
        120deg,
        transparent 40%,
        rgba(255, 255, 255, 0.25),
        transparent 60%
      );
      opacity: 0;
      transform: translateX(-100%);
      transition: opacity 0.3s, transform 0.6s;
    }

    .nav-links a:hover {
      background: rgba(255, 255, 255, 0.3);
      transform: translateY(-2px);
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
    }

    .nav-links a:hover::before {
      opacity: 1;
      transform: translateX(100%);
    }

    /* Roots Section */
    .roots-section {
      animation-delay: 0.4s;
    }

    .roots-section h2 {
      font-size: 20px;
      font-weight: 600;
      color: white;
      margin-bottom: 20px;
      text-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
    }

    .roots-section h2::before {
      content: '\uD83C\uDF33 ';
      font-size: 20px;
    }

    .roots-list {
      list-style: none;
      margin-bottom: 24px;
    }

    .roots-list li {
      margin-bottom: 10px;
    }

    .roots-list a {
      display: block;
      padding: 14px 18px;
      background: rgba(255, 255, 255, 0.2);
      backdrop-filter: blur(10px);
      border-radius: 12px;
      color: white;
      text-decoration: none;
      font-weight: 500;
      font-size: 15px;
      transition: all 0.3s;
      border: 1px solid rgba(255, 255, 255, 0.25);
      position: relative;
      overflow: hidden;
    }

    .roots-list a::before {
      content: "";
      position: absolute;
      inset: -40%;
      background: linear-gradient(
        120deg,
        transparent 40%,
        rgba(255, 255, 255, 0.25),
        transparent 60%
      );
      opacity: 0;
      transform: translateX(-100%);
      transition: opacity 0.3s, transform 0.6s;
    }

    .roots-list a:hover {
      background: rgba(255, 255, 255, 0.3);
      transform: translateX(4px);
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
    }

    .roots-list a:hover::before {
      opacity: 1;
      transform: translateX(100%);
    }

    .roots-list em {
      color: rgba(255, 255, 255, 0.7);
      font-style: italic;
      display: block;
      padding: 20px;
      text-align: center;
    }

    /* Create Root Form */
    .create-root-form {
      display: flex;
      gap: 12px;
      align-items: stretch;
    }

    .create-root-form input[type="text"] {
      flex: 1;
      padding: 14px 18px;
      font-size: 15px;
      border-radius: 12px;
      border: 2px solid rgba(255, 255, 255, 0.3);
      background: rgba(255, 255, 255, 0.9);
      font-family: inherit;
      transition: all 0.2s;
    }

    .create-root-form input[type="text"]:focus {
      outline: none;
      border-color: white;
      background: white;
      box-shadow: 0 0 0 4px rgba(255, 255, 255, 0.2),
        0 4px 20px rgba(0, 0, 0, 0.1);
    }

    .create-root-button {
      padding: 14px 20px;
      font-size: 24px;
      line-height: 1;
      border-radius: 12px;
      border: 1px solid rgba(255, 255, 255, 0.3);
      background: rgba(255, 255, 255, 0.25);
      backdrop-filter: blur(10px);
      color: white;
      cursor: pointer;
      transition: all 0.3s;
      font-weight: 300;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
      position: relative;
      overflow: hidden;
    }

    .create-root-button::before {
      content: "";
      position: absolute;
      inset: -40%;
      background: radial-gradient(
        120% 60% at 0% 0%,
        rgba(255, 255, 255, 0.35),
        transparent 60%
      );
      opacity: 0;
      transition: opacity 0.35s ease, transform 0.6s cubic-bezier(0.22, 1, 0.36, 1);
      pointer-events: none;
    }

    .create-root-button:hover {
      background: rgba(255, 255, 255, 0.35);
      transform: scale(1.05) translateY(-2px);
      box-shadow: 0 6px 20px rgba(0, 0, 0, 0.15);
    }

    .create-root-button:hover::before {
      opacity: 1;
      transform: translateX(30%) translateY(10%);
    }

    /* Responsive Design */


      a {
text-decoration: none;
        color: inherit;}`;

  const body = `
  <div class="container">
    <!-- Header -->
    <div class="glass-card header">
      <a href="/chat" target="_top" class="basic-btn">Back to Basic Chat</a>
      <div class="user-info">
       <a href="/api/v1/user/${userId}/llm${queryString}">
        <h1>@${safeUsername}</h1> </a>

        <div class="user-meta">
   <a href="/api/v1/user/${userId}/energy${queryString}">
  <span class="plan-badge plan-${plan}">
  ${plan.charAt(0).toUpperCase() + plan.slice(1)} Plan
</span></a>

          <span class="meta-item">
            <a href="/api/v1/user/${userId}/energy${queryString}">\u26A1 ${(energy?.amount ?? 0) + (extraEnergy?.amount ?? 0)} \u00B7 resets ${resetTimeLabel}
</a>
          </span>

          <span class="meta-item">
            \uD83D\uDCBE <span id="storageValue"></span>
            <button
              id="storageToggle"
              class="storage-toggle-btn"
              data-storage-kb="${storageUsedKB}"
            >
              MB
            </button>
            used
          </span>

          <button id="logoutBtn" class="logout-btn">
            Log out
          </button>
        </div>

        <div class="user-id-container">
          <code id="nodeIdCode">${user._id}</code>
          <button id="copyNodeIdBtn" title="Copy ID">\uD83D\uDCCB</button>
        </div>
      </div>
    </div>

    <!-- Raw Ideas Capture -->
    <div class="glass-card raw-ideas-section">
      <h2>Capture a Raw Idea</h2>
      <form
        method="POST"
        action="/api/v1/user/${userId}/raw-ideas${queryString}"
        enctype="multipart/form-data"
        class="raw-idea-form"
        id="rawIdeaForm"
      >
        <textarea
          name="content"
          placeholder="What's on your mind?"
          id="rawIdeaInput"
          rows="1"
          maxlength="5000"
          autofocus
        ></textarea>

        <div class="char-counter" id="charCounter">
          <span id="charCount">0</span> / 5000
          <span class="energy-display" id="energyDisplay"></span>
        </div>

        <div class="form-actions">
          <div class="file-input-wrapper">
            <input type="file" name="file" id="fileInput" />
            <div class="file-selected-badge" id="fileSelectedBadge">
              <span>\uD83D\uDCCE</span>
              <span class="file-name" id="fileName"></span>
              <button type="button" class="clear-file" id="clearFileBtn" title="Remove file">\u2715</button>
            </div>
          </div>
          <button type="submit" class="send-button" title="Save raw idea" id="rawIdeaSendBtn">
            <span class="send-label">Send</span>
            <span class="send-progress"></span>
          </button>
        </div>
      </form>
    </div>

    <!-- Navigation Links -->
    <div class="glass-card nav-section">
      <h2>Quick Links</h2>
      <ul class="nav-links">
        <li><a href="/api/v1/user/${userId}/apps${queryString}">Apps</a></li>
        <li><a href="/api/v1/user/${userId}/llm${queryString}">LLM</a></li>
        <li><a href="/api/v1/user/${userId}/raw-ideas${queryString}">Raw Ideas</a></li>
        <li><a href="/api/v1/user/${userId}/chats${queryString}">AI Chats</a></li>

        <li><a href="/api/v1/user/${userId}/notes${queryString}">Notes</a></li>
        <li><a href="/api/v1/user/${userId}/tags${queryString}">Mail</a></li>
        <li><a href="/api/v1/user/${userId}/contributions${queryString}">Contributions</a></li>
        <li><a href="/api/v1/user/${userId}/notifications${queryString}">Notifications</a></li>
        <li><a href="/api/v1/user/${userId}/invites${queryString}">Invites</a></li>
        <li><a href="/api/v1/user/${userId}/deleted${queryString}">Deleted</a></li>
        <li><a href="/api/v1/user/${userId}/api-keys${queryString}">API Keys</a></li>
        <li><a href="/api/v1/user/${userId}/shareToken${queryString}">Share Token</a></li>
        <li><a href="/api/v1/user/${userId}/inverse${queryString}">Inverse Profile</a></li>
      </ul>
    </div>

    <!-- Roots Section -->
    <div class="glass-card roots-section">
      <h2>My Roots</h2>
      ${
        roots.length > 0
          ? `
        <ul class="roots-list">
          ${roots
            .map(
              (r) => `
            <li>
              <a href="/api/v1/root/${r._id}${queryString}">
                  ${escapeHtml(r.name || "Untitled")}
              </a>
            </li>
          `,
            )
            .join("")}
        </ul>
      `
          : `<ul class="roots-list"><li><em>No roots yet \u2014 create your first one below!</em></li></ul>`
      }

      <form
        method="POST"
        action="/api/v1/user/${userId}/createRoot${queryString}"
        class="create-root-form"
      >
        <input
          type="text"
          name="name"
          placeholder="New root name..."
          required
        />
        <button type="submit" class="create-root-button" title="Create root">
          \uFF0B
        </button>
      </form>
    </div>
  </div>`;

  const js = `
    // Copy ID functionality
    document.getElementById("copyNodeIdBtn").addEventListener("click", () => {
      const code = document.getElementById("nodeIdCode");
      const btn = document.getElementById("copyNodeIdBtn");

      navigator.clipboard.writeText(code.textContent).then(() => {
        btn.textContent = "\u2714\uFE0F";
        setTimeout(() => (btn.textContent = "\uD83D\uDCCB"), 1000);
      });
    });

    // Storage toggle
    (() => {
      const toggleBtn = document.getElementById("storageToggle");
      const valueEl = document.getElementById("storageValue");
      const storageKB = Number(toggleBtn.dataset.storageKb || 0);
      let unit = "MB";

      function render() {
        if (unit === "MB") {
          const mb = storageKB / 1024;
          valueEl.textContent = mb.toFixed(mb < 10 ? 2 : 1);
          toggleBtn.textContent = "MB";
        } else {
          const gb = storageKB / (1024 * 1024);
          valueEl.textContent = gb.toFixed(gb < 1 ? 3 : 2);
          toggleBtn.textContent = "GB";
        }
      }

      toggleBtn.addEventListener("click", () => {
        unit = unit === "GB" ? "MB" : "GB";
        render();
      });

      render();
    })();

    // Logout
    document.getElementById("logoutBtn").addEventListener("click", async () => {
      try {
        await fetch("/api/v1/logout", {
          method: "POST",
          credentials: "include",
        });
        window.top.location.href = "/login";
      } catch (err) {
        console.error("Logout failed", err);
        alert("Logout failed. Please try again.");
      }
    });

    // Elements
    const form = document.getElementById('rawIdeaForm');
    const textarea = document.getElementById('rawIdeaInput');
    const charCounter = document.getElementById('charCounter');
    const charCount = document.getElementById('charCount');
    const energyDisplay = document.getElementById('energyDisplay');
    const fileInput = document.getElementById('fileInput');
    const fileSelectedBadge = document.getElementById('fileSelectedBadge');
    const fileName = document.getElementById('fileName');
    const clearFileBtn = document.getElementById('clearFileBtn');
    const sendBtn = document.getElementById('rawIdeaSendBtn');
    const progressBar = sendBtn.querySelector('.send-progress');

    const MAX_CHARS = 5000;
    let hasFile = false;

    // Auto-resize textarea
    function autoResize() {
      textarea.style.height = 'auto';
      const maxHeight = 400;
      const newHeight = Math.min(textarea.scrollHeight, maxHeight);
      textarea.style.height = newHeight + 'px';
      textarea.style.overflowY = textarea.scrollHeight > maxHeight ? 'auto' : 'hidden';
      updateCharCounter();
    }

    textarea.addEventListener('input', autoResize);
    autoResize();

    // Character counter with energy (1 per 1000 chars)
    function updateCharCounter() {
      const len = textarea.value.length;
      charCount.textContent = len;

      const remaining = MAX_CHARS - len;
      charCounter.classList.remove('warning', 'danger', 'disabled');

      if (hasFile) {
        charCounter.classList.add('disabled');
      } else if (remaining <= 100) {
        charCounter.classList.add('danger');
      } else if (remaining <= 500) {
        charCounter.classList.add('warning');
      }

      // Energy cost: 1 per 1000 chars (minimum 1 if any text)
      if (len > 0 && !hasFile) {
        const cost = Math.max(1, Math.ceil(len / 1000));
        energyDisplay.textContent = '\u26A1' + cost;
        energyDisplay.classList.remove('file-energy');
      } else if (!hasFile) {
        energyDisplay.textContent = '';
      }
    }

    // File energy calculation
    const FILE_MIN_COST = 5;
    const FILE_BASE_RATE = 1.5;
    const FILE_MID_RATE = 3;
    const SOFT_LIMIT_MB = 100;
    const HARD_LIMIT_MB = 1024;

    function calculateFileEnergy(sizeMB) {
      if (sizeMB <= SOFT_LIMIT_MB) {
        return Math.max(FILE_MIN_COST, Math.ceil(sizeMB * FILE_BASE_RATE));
      }
      if (sizeMB <= HARD_LIMIT_MB) {
        const base = SOFT_LIMIT_MB * FILE_BASE_RATE;
        const extra = (sizeMB - SOFT_LIMIT_MB) * FILE_MID_RATE;
        return Math.ceil(base + extra);
      }
      const base = SOFT_LIMIT_MB * FILE_BASE_RATE +
                   (HARD_LIMIT_MB - SOFT_LIMIT_MB) * FILE_MID_RATE;
      const overGB = sizeMB - HARD_LIMIT_MB;
      return Math.ceil(base + Math.pow(overGB / 50, 2) * 50);
    }

    // File selection - blocks text input
    fileInput.addEventListener('change', function() {
      if (this.files && this.files[0]) {
        const file = this.files[0];
        hasFile = true;

        // Disable textarea
        textarea.disabled = true;
        textarea.value = '';
        textarea.placeholder = 'File selected - text disabled';

        // Show file badge, hide file input
        fileInput.classList.add('hidden-input');
        fileSelectedBadge.classList.add('visible');

        // Truncate filename
        let displayName = file.name;
        if (displayName.length > 20) {
          displayName = displayName.substring(0, 17) + '...';
        }
        fileName.textContent = displayName;
        fileSelectedBadge.title = file.name;

        // Calculate and show energy (+1 for the note itself)
        const sizeMB = file.size / (1024 * 1024);
        const fileCost = calculateFileEnergy(sizeMB);
        const totalCost = fileCost + 1;
        energyDisplay.textContent = '~\u26A1' + totalCost;
        energyDisplay.classList.add('file-energy');

        updateCharCounter();
      }
    });

    // Clear file selection
    clearFileBtn.addEventListener('click', function() {
      hasFile = false;
      fileInput.value = '';
      fileInput.classList.remove('hidden-input');
      fileSelectedBadge.classList.remove('visible');

      textarea.disabled = false;
      textarea.placeholder = "What's on your mind?";

      energyDisplay.textContent = '';
      energyDisplay.classList.remove('file-energy');

      updateCharCounter();
    });

    // Submit with Enter (desktop only)
    textarea.addEventListener("keydown", (e) => {
      const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
      if (!isMobile && e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        form.requestSubmit();
      }
    });

    // Form submission with progress + cancel
    let activeXhr = null;

    sendBtn.addEventListener('click', (e) => {
      if (activeXhr) {
        e.preventDefault();
        activeXhr.abort();
        activeXhr = null;
        sendBtn.classList.remove('loading');
        sendBtn.querySelector('.send-label').textContent = 'Send';
        progressBar.style.width = '0%';
        return;
      }
    });

    form.addEventListener('submit', (e) => {
      e.preventDefault();

      sendBtn.classList.add('loading');
      sendBtn.querySelector('.send-label').textContent = 'Cancel';
      progressBar.style.width = '15%';

      const formData = new FormData(form);
      const xhr = new XMLHttpRequest();
      activeXhr = xhr;

      xhr.open('POST', form.action, true);

      xhr.upload.onprogress = (e) => {
        if (!e.lengthComputable) return;
        const realPercent = (e.loaded / e.total) * 100;
        const lagged = Math.min(90, Math.round(realPercent * 0.8));
        progressBar.style.width = lagged + '%';
      };

      xhr.onload = () => {
        activeXhr = null;
        if (xhr.status >= 200 && xhr.status < 300) {
          progressBar.style.width = '100%';
          setTimeout(() => document.location.reload(), 150);
        } else {
          fail();
        }
      };

      xhr.onerror = fail;
      xhr.onabort = () => {
        activeXhr = null;
      };

      function fail() {
        activeXhr = null;
        var msg = 'Send failed';
        try {
          var body = JSON.parse(xhr.responseText);
          if (body.error) msg = body.error.message || body.error;
        } catch(e) {}
        alert(msg);
        sendBtn.classList.remove('loading');
        sendBtn.querySelector('.send-label').textContent = 'Send';
        progressBar.style.width = '0%';
      }

      xhr.send(formData);
    });

    // Form reset handler
    form.addEventListener('reset', () => {
      hasFile = false;
      fileInput.classList.remove('hidden-input');
      fileSelectedBadge.classList.remove('visible');
      textarea.disabled = false;
      textarea.placeholder = "What's on your mind?";
      energyDisplay.textContent = '';
      energyDisplay.classList.remove('file-energy');
      charCount.textContent = '0';
      charCounter.classList.remove('warning', 'danger', 'disabled');
    });`;

  return page({
    title: `@${safeUsername} \u2014 Profile`,
    css,
    body,
    js,
  });
}
