import { page } from "../../html-rendering/html/layout.js";
import { esc, escapeHtml } from "../../html-rendering/html/utils.js";
import { getUserMeta } from "../../../seed/tree/userMetadata.js";
import { resolveSlots } from "../slots.js";

export function renderUserProfile({ userId, user, roots, queryString, storageUsedKB }) {
  const safeUsername = escapeHtml(user.username);

  const css = `
    html { overflow-y: auto; height: 100%; }

    /* Card Base */
    .glass-card {
      background: #161b24;
      border-radius: 12px;
      padding: 24px 28px;
      margin-bottom: 16px;
      border: 1px solid #232a38;
      position: relative;
      animation: fadeInUp 0.35s ease-out both;
    }

    /* Header Section */
    .header {
      animation-delay: 0.05s;
    }

    .user-info h1 {
      font-size: 22px;
      font-weight: 600;
      color: #e6e8eb;
      margin-bottom: 14px;
      letter-spacing: -0.3px;
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
      padding: 5px 12px;
      border-radius: 980px;
      font-weight: 600;
      font-size: 12px;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      background: #161b24;
      color: #9ba1ad;
      border: 1px solid #232a38;
      letter-spacing: 0.3px;
    }
.plan-basic {
  background: #161b24;
  color: #9ba1ad;
  border: 1px solid #232a38;
}

/* STANDARD */
.plan-standard {
  background: rgba(122, 146, 184, 0.12);
  color: #a8c0e0;
  border: 1px solid rgba(122, 146, 184, 0.35);
}

/* PREMIUM */
.plan-premium {
  background: rgba(158, 130, 196, 0.12);
  color: #c4afde;
  border: 1px solid rgba(158, 130, 196, 0.35);
}

/* GOD */
.plan-god {
  background: rgba(212, 165, 116, 0.12);
  color: #e0c290;
  border: 1px solid rgba(212, 165, 116, 0.45);
}
    .meta-item {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 6px 12px;
      background: #161b24;
      border-radius: 980px;
      font-size: 12px;
      font-weight: 500;
      color: #9ba1ad;
      border: 1px solid #232a38;
    }

    .storage-toggle-btn {
      padding: 2px 8px;
      margin-left: 4px;
      border-radius: 6px;
      border: 1px solid #232a38;
      background: #161b24;
      font-size: 11px;
      font-weight: 600;
      cursor: pointer;
      transition: background 150ms ease, border-color 150ms ease;
      color: #9ba1ad;
    }

    .storage-toggle-btn:hover {
      background: #1c222e;
      border-color: #2f3849;
      color: #e6e8eb;
    }

    .logout-btn {
      padding: 7px 14px;
      border-radius: 8px;
      border: 1px solid rgba(201, 126, 106, 0.35);
      background: rgba(201, 126, 106, 0.1);
      color: #c97e6a;
      font-weight: 600;
      font-size: 12px;
      cursor: pointer;
      transition: background 150ms ease, border-color 150ms ease;
    }

    .logout-btn:hover {
      background: rgba(201, 126, 106, 0.18);
      border-color: rgba(201, 126, 106, 0.55);
    }

    .header { position: relative; }

    .basic-btn {
      position: absolute;
      top: 16px;
      right: 16px;
      padding: 7px 14px;
      border-radius: 8px;
      border: 1px solid rgba(125, 211, 133, 0.4);
      background: rgba(125, 211, 133, 0.12);
      color: #9ce0a2;
      font-weight: 600;
      font-size: 12px;
      cursor: pointer;
      transition: background 150ms ease, border-color 150ms ease;
      text-decoration: none;
    }

    .basic-btn:hover {
      background: rgba(125, 211, 133, 0.2);
      border-color: #7dd385;
    }

    /* User ID */
    .user-id-container {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 10px 14px;
      background: #0d1117;
      border-radius: 8px;
      margin-top: 12px;
      border: 1px solid #232a38;
    }

    .user-id-container code {
      flex: 1;
      background: transparent;
      padding: 0;
      font-size: 12px;
      font-family: 'SF Mono', Monaco, monospace;
      color: #c4c8d0;
      font-weight: 500;
      word-break: break-all;
    }

    #copyNodeIdBtn {
      background: #161b24;
      border: 1px solid #232a38;
      cursor: pointer;
      padding: 5px 9px;
      border-radius: 6px;
      font-size: 14px;
      transition: background 150ms ease, border-color 150ms ease;
      flex-shrink: 0;
      color: #9ba1ad;
    }

    #copyNodeIdBtn:hover {
      background: #1c222e;
      border-color: #2f3849;
    }

    /* Raw Ideas Capture - subtle accent border, no glow */
    .raw-ideas-section {
      animation-delay: 0.15s;
      border: 1px solid rgba(125, 211, 133, 0.25);
    }

    .raw-ideas-section h2 {
      font-size: 16px;
      font-weight: 600;
      color: #e6e8eb;
      margin-bottom: 14px;
      position: relative;
      z-index: 1;
      letter-spacing: -0.2px;
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
      border-radius: 10px;
      border: 1px solid #232a38;
      background: #0d1117;
      font-family: inherit;
      resize: vertical;
      min-height: 80px;
      max-height: 400px;
      transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
      box-shadow:
        0 4px 20px rgba(0, 0, 0, 0.15),
        inset 0 1px 0 rgba(255, 255, 255, 0.4);
      color: #e6e8eb;
      font-weight: 500;
      letter-spacing: 0;
    }

    #rawIdeaInput:focus {
      outline: none;
      border-color: rgba(125, 211, 133, 0.5);
      box-shadow:
        0 0 0 3px rgba(125, 211, 133, 0.15);
    }

    #rawIdeaInput:focus::placeholder {
      color: rgba(155, 161, 173, 0.6);
    }

    #rawIdeaInput::placeholder {
      color: rgba(155, 161, 173, 0.6);
      font-weight: 400;
    }

    #rawIdeaInput:disabled {
      opacity: 0.4;
      cursor: not-allowed;
      background: rgba(255, 255, 255, 0.04);
    }

    #rawIdeaInput:disabled::placeholder {
      color: rgba(155, 161, 173, 0.3);
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
      background: rgba(212, 165, 116, 0.12);
      border: 1px solid rgba(212, 165, 116, 0.4);
      border-radius: 10px;
      font-size: 11px;
      font-weight: 600;
      color: #d4a574;
      transition: all 0.2s;
    }

    .energy-display:empty {
      display: none;
    }

    .energy-display.file-energy {
      background: rgba(212, 165, 116, 0.18);
      border-color: rgba(212, 165, 116, 0.55);
      color: #e0c290;
      font-size: 12px;
      font-weight: 700;
      padding: 4px 12px;
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
      padding: 12px 28px;
      font-size: 14px;
      font-weight: 600;
      border-radius: 10px;
      border: 1px solid #7dd385;
      background: #7dd385;
      color: #0d1117;
      cursor: pointer;
      transition: background 200ms ease, box-shadow 200ms ease, transform 150ms ease;
      box-shadow: 0 0 20px rgba(125, 211, 133, 0.35);
      white-space: nowrap;
    }

    .send-button:hover {
      background: #9ce0a2;
      border-color: #9ce0a2;
      box-shadow: 0 0 28px rgba(125, 211, 133, 0.55);
      transform: translateY(-1px);
    }

    .send-button:active {
      transform: translateY(0);
    }

    .send-button:disabled {
      opacity: 0.4;
      cursor: not-allowed;
      box-shadow: none;
      transform: none;
    }

    /* Navigation Section */
    .nav-section {
      animation-delay: 0.3s;
    }

    .nav-section h2 {
      font-size: 16px;
      font-weight: 600;
      color: #e6e8eb;
      margin-bottom: 14px;
      letter-spacing: -0.2px;
    }

    .nav-links {
      list-style: none;
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
      gap: 12px;
      padding: 0;
      margin: 0;
    }

    .nav-links li {
      list-style: none;
    }

    .nav-links a {
      display: block;
      padding: 10px 14px;
      background: #161b24;
      border-radius: 8px;
      color: #c4c8d0;
      text-decoration: none;
      font-weight: 500;
      font-size: 13px;
      transition: background 150ms ease, border-color 150ms ease, color 150ms ease;
      border: 1px solid #232a38;
      text-align: center;
    }

    .nav-links a:hover {
      background: #1c222e;
      border-color: #2f3849;
      color: #e6e8eb;
    }

    /* Roots Section */
    .roots-section {
      animation-delay: 0.4s;
    }

    .roots-section h2 {
      font-size: 16px;
      font-weight: 600;
      color: #e6e8eb;
      margin-bottom: 14px;
      letter-spacing: -0.2px;
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
      padding: 12px 16px;
      background: #161b24;
      border-radius: 10px;
      color: #c4c8d0;
      text-decoration: none;
      font-weight: 500;
      font-size: 14px;
      transition: background 150ms ease, border-color 150ms ease, color 150ms ease;
      border: 1px solid #232a38;
      border-left: 3px solid #232a38;
    }

    .roots-list a:hover {
      background: #1c222e;
      border-color: #2f3849;
      border-left-color: #7dd385;
      color: #e6e8eb;
    }

    .roots-list em {
      color: #5d6371;
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
      padding: 12px 16px;
      font-size: 14px;
      border-radius: 10px;
      border: 1px solid #232a38;
      background: #0d1117;
      color: #e6e8eb;
      font-family: inherit;
      transition: border-color 150ms ease, background 150ms ease;
    }

    .create-root-form input[type="text"]::placeholder {
      color: #5d6371;
    }

    .create-root-form input[type="text"]:focus {
      outline: none;
      border-color: rgba(125, 211, 133, 0.5);
      background: #0d1117;
      box-shadow: 0 0 0 3px rgba(125, 211, 133, 0.15);
    }

    .create-root-button {
      padding: 12px 18px;
      font-size: 20px;
      line-height: 1;
      border-radius: 10px;
      border: 1px solid #232a38;
      background: #161b24;
      color: #9ba1ad;
      cursor: pointer;
      transition: background 150ms ease, border-color 150ms ease, color 150ms ease;
      font-weight: 300;
    }

    .create-root-button:hover {
      background: #1c222e;
      border-color: #2f3849;
      color: #e6e8eb;
    }

    /* Responsive Design */


      a {
text-decoration: none;
        color: inherit;}`;

  const body = `
  <div class="container">
    <!-- Header -->
    <div class="glass-card header">
      <button class="basic-btn" onclick="try{window.top.location='/chat'}catch(e){window.location='/chat'}">Back to Basic Chat</button>
      <div class="user-info">
        <h1>@${safeUsername}</h1>

        <div class="user-meta">
          ${resolveSlots("user-profile-badge", { userId, queryString, user }) ||
            `<span class="plan-badge plan-basic">${user.isAdmin ? "Admin" : "User"}</span>`}

          ${resolveSlots("user-profile-energy", { userId, queryString, user })}

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

    <!-- Extension sections (raw ideas capture, etc.) -->
    ${resolveSlots("user-profile-sections", { userId, queryString, user })}

    <!-- Navigation Links -->
    <div class="glass-card nav-section">
      <h2>Quick Links</h2>
      <ul class="nav-links">
        <li><a href="/api/v1/user/${userId}/apps${queryString}">Apps</a></li>
        <li><a href="/api/v1/user/${userId}/llm${queryString}">LLM</a></li>
        ${resolveSlots("user-quick-links", { userId, queryString }, { raw: true })}
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
