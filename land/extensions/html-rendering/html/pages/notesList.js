/* --------------------------------------------------------- */
/* Notes list page                                           */
/* --------------------------------------------------------- */

import { page } from "../layout.js";
import { escapeHtml } from "../utils.js";

export function renderNotesList({
  nodeId,
  version,
  token,
  nodeName,
  notes,
  currentUserId,
}) {
  const base = `/api/v1/node/${nodeId}/${version}`;

  const css = `
/* ── Notes list overrides on base ── */
body {
  height: 100vh;
  height: 100dvh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  padding: 0;
  min-height: auto;
}

/* Glass Top Navigation */
.top-nav {
  background: rgba(var(--glass-water-rgb), var(--glass-alpha));
  backdrop-filter: blur(22px) saturate(140%);
  -webkit-backdrop-filter: blur(22px) saturate(140%);
  padding: 16px 20px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12),
    inset 0 1px 0 rgba(255, 255, 255, 0.25);
  border-bottom: 1px solid rgba(255, 255, 255, 0.28);
  flex-shrink: 0;
}

.top-nav-content {
  max-width: 900px;
  margin: 0 auto;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

.nav-left {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}

/* Glass Navigation Buttons */
.nav-button,
.book-button {
  position: relative;
  overflow: hidden;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 10px 20px;
  border-radius: 980px;
  background: rgba(var(--glass-water-rgb), var(--glass-alpha));
  backdrop-filter: blur(22px) saturate(140%);
  -webkit-backdrop-filter: blur(22px) saturate(140%);
  color: white;
  text-decoration: none;
  font-size: 15px;
  font-weight: 500;
  letter-spacing: -0.2px;
  border: 1px solid rgba(255, 255, 255, 0.28);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12),
    inset 0 1px 0 rgba(255, 255, 255, 0.25);
  cursor: pointer;
  transition: background 0.3s cubic-bezier(0.4, 0, 0.2, 1),
    transform 0.3s cubic-bezier(0.4, 0, 0.2, 1),
    box-shadow 0.3s ease;
  white-space: nowrap;
}

.nav-button::before,
.book-button::before {
  content: "";
  position: absolute;
  inset: -40%;
  background: radial-gradient(
      120% 60% at 0% 0%,
      rgba(255, 255, 255, 0.35),
      transparent 60%
    ),
    linear-gradient(
      120deg,
      transparent 30%,
      rgba(255, 255, 255, 0.25),
      transparent 70%
    );
  opacity: 0;
  transform: translateX(-30%) translateY(-10%);
  transition: opacity 0.35s ease, transform 0.6s cubic-bezier(0.22, 1, 0.36, 1);
  pointer-events: none;
}

.nav-button:hover,
.book-button:hover {
  background: rgba(var(--glass-water-rgb), var(--glass-alpha-hover));
  transform: translateY(-1px);
  animation: waterDrift 2.2s ease-in-out infinite alternate;
}

.nav-button:hover::before,
.book-button:hover::before {
  opacity: 1;
  transform: translateX(30%) translateY(10%);
}

@keyframes waterDrift {
  0% { transform: translateY(-1px); }
  100% { transform: translateY(1px); }
}

.book-button {
  --glass-alpha: 0.34;
  --glass-alpha-hover: 0.46;
  font-weight: 600;
}

.page-title {
  width: 100%;
  margin-top: 12px;
  font-size: 18px;
  font-weight: 600;
  color: white;
  letter-spacing: -0.3px;
  text-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
}

.page-title a {
  color: white;
  text-decoration: none;
  border-bottom: 1px solid rgba(255, 255, 255, 0.3);
  transition: all 0.2s;
}

.page-title a:hover {
  border-bottom-color: white;
  text-shadow: 0 0 8px rgba(255, 255, 255, 0.8);
}

/* Notes Container */
.notes-container {
  flex: 1;
  overflow-y: auto;
  padding: 20px;
  position: relative;
  z-index: 1;
}

.notes-wrapper {
  max-width: 900px;
  margin: 0 auto;
  width: 100%;
}

.notes-list {
  list-style: none;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

/* Glass Note Messages */
.note-item {
  display: flex;
  animation: slideIn 0.3s ease-out;
}

@keyframes slideIn {
  from {
    opacity: 0;
    transform: translateY(10px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.note-item.self {
  flex-direction: row-reverse;
}

.note-bubble {
  position: relative;
  max-width: 70%;
  padding: 14px 18px;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.15);
  backdrop-filter: blur(22px) saturate(140%);
  -webkit-backdrop-filter: blur(22px) saturate(140%);
  border: 1px solid rgba(255, 255, 255, 0.28);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.1),
    inset 0 1px 0 rgba(255, 255, 255, 0.25);
  color: white;
  word-wrap: break-word;
  overflow-wrap: break-word;
}

/* Self messages - slightly more opaque */
.note-item.self .note-bubble {
  background: rgba(255, 255, 255, 0.2);
}

/* Reflection messages - golden tint */
.note-item.reflection .note-bubble {
  background: rgba(255, 215, 79, 0.25);
  border-color: rgba(255, 215, 79, 0.4);
  box-shadow: 0 4px 16px rgba(255, 193, 7, 0.2),
    inset 0 1px 0 rgba(255, 255, 255, 0.3);
}

.file-badge {
  display: inline-block;
  padding: 4px 10px;
  background: rgba(255, 255, 255, 0.2);
  border-radius: 12px;
  font-size: 11px;
  font-weight: 600;
  margin-bottom: 8px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  border: 1px solid rgba(255, 255, 255, 0.3);
}

.note-author {
  font-weight: 600;
  margin-bottom: 6px;
  font-size: 13px;
  opacity: 0.85;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.2);
  letter-spacing: -0.2px;
}

.note-author a {
  color: inherit;
  text-decoration: none;
  border-bottom: 1px solid rgba(255, 255, 255, 0.3);
}

.note-author a:hover {
  border-bottom-color: white;
}

.note-item.self .note-author {
  display: none;
}

.note-content {
  font-size: 15px;
  line-height: 1.5;
  margin-bottom: 6px;
  font-weight: 400;
}

.note-content a {
  color: inherit;
  text-decoration: none;
}

.note-content a:hover {
  text-shadow: 0 0 8px rgba(255, 255, 255, 0.8);
}

.note-meta {
  font-size: 11px;
  opacity: 0.7;
  margin-top: 6px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
}

.delete-button {
  background: rgba(255, 255, 255, 0.15);
  border: 1px solid rgba(255, 255, 255, 0.25);
  border-radius: 50%;
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  padding: 0;
  opacity: 0.7;
  transition: all 0.2s;
  font-size: 12px;
  color: white;
}

/* Character counter */
.char-counter {
  display: flex;
  justify-content: flex-end;
  align-items: center;
  margin-top: 6px;
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

/* Energy display (shared between text and file) */
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

/* File selected indicator */
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

@keyframes fadeIn {
  from { opacity: 0; transform: scale(0.95); }
  to { opacity: 1; transform: scale(1); }
}

.delete-button:hover {
  opacity: 1;
  background: rgba(239, 68, 68, 0.3);
  border-color: rgba(239, 68, 68, 0.5);
  transform: scale(1.1);
}

/* Glass Input Bar */
.input-bar {
  background: rgba(var(--glass-water-rgb), var(--glass-alpha));
  backdrop-filter: blur(22px) saturate(140%);
  -webkit-backdrop-filter: blur(22px) saturate(140%);
  padding: 20px;
  border-top: 1px solid rgba(255, 255, 255, 0.28);
  box-shadow: 0 -8px 24px rgba(0, 0, 0, 0.12),
    inset 0 1px 0 rgba(255, 255, 255, 0.25);
  flex-shrink: 0;
}

.input-form {
  max-width: 900px;
  margin: 0 auto;
}

textarea {
  width: 100%;
  padding: 14px 16px;
  border: 2px solid rgba(255, 255, 255, 0.3);
  border-radius: 12px;
  font-family: inherit;
  font-size: 16px;
  line-height: 1.5;
  resize: none;
  transition: all 0.3s;
  background: rgba(255, 255, 255, 0.15);
  backdrop-filter: blur(20px) saturate(150%);
  -webkit-backdrop-filter: blur(20px) saturate(150%);
  color: white;
  font-weight: 500;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.1),
    inset 0 1px 0 rgba(255, 255, 255, 0.25);
  height: 56px;
  max-height: 120px;
  overflow-y: hidden;
}

textarea::placeholder {
  color: rgba(255, 255, 255, 0.5);
}

textarea:focus {
  outline: none;
  border-color: rgba(255, 255, 255, 0.6);
  background: rgba(255, 255, 255, 0.25);
  box-shadow: 0 0 0 4px rgba(255, 255, 255, 0.15),
    0 8px 30px rgba(0, 0, 0, 0.15),
    inset 0 1px 0 rgba(255, 255, 255, 0.4);
  transform: translateY(-2px);
}

textarea:disabled {
  opacity: 0.4;
  cursor: not-allowed;
  background: rgba(255, 255, 255, 0.08);
  transform: none;
}

textarea:disabled::placeholder {
  color: rgba(255, 255, 255, 0.3);
}

.input-controls {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  margin-top: 12px;
  flex-wrap: wrap;
}

.input-options {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
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

/* Hide file input when file is selected, show badge instead */
input[type="file"].hidden-input {
  display: none;
}

/* Glass Send Button */
.send-button {
  position: relative;
  overflow: hidden;
  padding: 12px 28px;
  border-radius: 980px;
  background: rgba(255, 255, 255, 0.25);
  backdrop-filter: blur(10px);
  color: white;
  border: 1px solid rgba(255, 255, 255, 0.3);
  font-size: 15px;
  font-weight: 600;
  letter-spacing: -0.2px;
  cursor: pointer;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.12);
  white-space: nowrap;
  transition: all 0.3s;
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
  transform: translateX(-30%) translateY(-10%);
  transition: opacity 0.35s ease, transform 0.6s cubic-bezier(0.22, 1, 0.36, 1);
  pointer-events: none;
}

.send-button:hover {
  background: rgba(255, 255, 255, 0.35);
  transform: translateY(-2px);
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.18);
}

.send-button:hover::before {
  opacity: 1;
  transform: translateX(30%) translateY(10%);
}

.send-button.loading .send-label {
  opacity: 0;
}

/* Progress bar */
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

/* Loading state */
.send-button.loading {
  cursor: default;
  animation: none;
  transform: none;
}

/* Responsive Design */
@media (max-width: 768px) {
  .top-nav {
    padding: 12px 16px;
  }

  .nav-button,
  .book-button {
    padding: 8px 16px;
    font-size: 14px;
  }

  .page-title {
    font-size: 16px;
  }

  .notes-container {
    padding: 16px 12px;
  }

  .note-bubble {
    max-width: 85%;
    padding: 12px 16px;
  }

  .input-bar {
    padding: 16px;
  }

  .input-controls {
    flex-direction: column;
    align-items: stretch;
  }

  .input-options {
    flex-direction: column;
    align-items: flex-start;
    gap: 10px;
  }

  .send-button {
    width: 100%;
  }

  textarea {
    font-size: 16px;
    height: 60px;
  }
}

@media (max-width: 480px) {
  .nav-left {
    width: 100%;
    flex-direction: column;
  }

  .nav-button,
  .book-button {
    width: 100%;
    justify-content: center;
  }
}
     html, body {
        background: #736fe6;
        margin: 0;
        padding: 0;
      }
        .editor-open-btn {
  width: 44px; height: 44px;
  border-radius: 50%;
  border: 1px solid rgba(255, 255, 255, 0.3);
  background: rgba(255, 255, 255, 0.2);
  backdrop-filter: blur(10px);
  color: white; font-size: 18px;
  cursor: pointer; transition: all 0.3s;
  display: flex; align-items: center; justify-content: center;
  flex-shrink: 0;
}

.editor-open-btn:hover {
  background: rgba(255, 255, 255, 0.35);
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
}
  @media (max-width: 768px) {
  .input-controls {
    flex-direction: row;
    align-items: center;
    flex-wrap: nowrap;
  }

  .input-options {
    flex-direction: row;
    align-items: center;
    gap: 8px;
    flex: 1;
    min-width: 0;
  }

  .input-options input[type="file"] {
    max-width: 140px;
    font-size: 0;
  }

  .input-options input[type="file"]::file-selector-button {
    margin-right: 0;
    padding: 8px 12px;
    font-size: 12px;
  }

  .send-button {
    width: auto;
    padding: 10px 20px;
    flex-shrink: 0;
  }
}
  `;

  const body = `
  <!-- Top Navigation -->
  <div class="top-nav">
    <div class="top-nav-content">
      <div class="nav-left">
        <a href="/api/v1/root/${nodeId}?token=${encodeURIComponent(token)}&html" class="nav-button">
          \u2190 Back to Tree
        </a>
        <a href="${base}?token=${encodeURIComponent(token)}&html" class="nav-button">
          Back to Version
        </a>
      </div>

      <div class="page-title">
        Notes for <a href="${base}?token=${encodeURIComponent(token)}&html">${escapeHtml(nodeName)} v${version}</a>
      </div>
    </div>
  </div>

  <!-- Notes Container -->
  <div class="notes-container">
    <div class="notes-wrapper">
      <ul class="notes-list">
      ${notes
        .map((n) => {
          const noteUserId = typeof n.userId === "object" ? n.userId?._id?.toString() : n.userId?.toString();
          const noteUsername = (typeof n.userId === "object" ? n.userId?.username : null) || n.username;
          const isSelf =
            currentUserId && noteUserId && noteUserId === currentUserId;
          const rawPreview =
            n.contentType === "text"
              ? n.content.length > 169
                ? n.content.substring(0, 500) + "..."
                : n.content
              : n.content.split("/").pop();
          const preview = escapeHtml(rawPreview);

          const userLabel = noteUserId
            ? `<a href="/api/v1/user/${noteUserId}?token=${encodeURIComponent(token)}&html">${escapeHtml(noteUsername ?? noteUserId)}</a>`
            : escapeHtml(noteUsername ?? "Unknown user");

          return `
          <li
            class="note-item ${isSelf ? "self" : "other"} ${
              n.metadata?.treeos?.isReflection ? "reflection" : ""
            }"
            data-note-id="${n._id}"
            data-node-id="${n.nodeId}"
          >
            <div class="note-bubble">
              ${
                n.contentType === "file"
                  ? '<div class="file-badge">\ud83d\udcce File</div>'
                  : ""
              }
              ${!isSelf ? `<div class="note-author">${userLabel}</div>` : ""}
              <div class="note-content">
                <a href="${base}/notes/${n._id}?token=${encodeURIComponent(token)}&html">
                  ${preview}
                </a>
              </div>
              <div class="note-meta">
                <span>${new Date(n.createdAt).toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                })}</span>
                <button class="delete-button" title="Delete note">\u2715</button>
              </div>
            </div>
          </li>
        `;
        })
        .join("")}
    </ul>
    </div>
  </div>

  <!-- Input Bar -->
  <div class="input-bar">
    <form
      method="POST"
      action="/api/v1/node/${nodeId}/${version}/notes?token=${encodeURIComponent(token)}&html"
      enctype="multipart/form-data"
      class="input-form"
      id="noteForm"
    >
      <textarea
        name="content"
        rows="1"
        placeholder="Write a note..."
        id="noteTextarea"
        maxlength="5000"
      ></textarea>
      <div class="char-counter" id="charCounter">
        <span id="charCount">0</span> / 5000
        <span class="energy-display" id="energyDisplay"></span>
      </div>

      <div class="input-controls">
        <div class="input-options">
          <input type="file" name="file" id="fileInput" />
          <div class="file-selected-badge" id="fileSelectedBadge">
            <span>\ud83d\udcce</span>
            <span class="file-name" id="fileName"></span>
            <button type="button" class="clear-file" id="clearFileBtn" title="Remove file">\u2715</button>
          </div>
          <button type="button" class="editor-open-btn" id="openEditorBtn" title="Open in Editor">\u270f\ufe0f</button>
        </div>
        <button type="submit" class="send-button" id="sendBtn">
          <span class="send-label">Send</span>
          <span class="send-progress"></span>
        </button>
      </div>
    </form>
  </div>
  `;

  const js = `
    // Auto-scroll to bottom on load
    const container = document.querySelector('.notes-container');
    container.scrollTop = container.scrollHeight;

    // Elements
    const form = document.getElementById('noteForm');
    const textarea = document.getElementById('noteTextarea');
    const charCounter = document.getElementById('charCounter');
    const charCount = document.getElementById('charCount');
    const energyDisplay = document.getElementById('energyDisplay');
    const fileInput = document.getElementById('fileInput');
    const fileSelectedBadge = document.getElementById('fileSelectedBadge');
    const fileName = document.getElementById('fileName');
    const clearFileBtn = document.getElementById('clearFileBtn');
    const sendBtn = document.getElementById('sendBtn');
    const progressBar = sendBtn.querySelector('.send-progress');

    const MAX_CHARS = 5000;
    let hasFile = false;

    // Auto-resize textarea
    textarea.addEventListener('input', function() {
      this.style.height = 'auto';
      const newHeight = Math.min(this.scrollHeight, 120);
      this.style.height = newHeight + 'px';
      this.style.overflowY = this.scrollHeight > 120 ? 'auto' : 'hidden';
      updateCharCounter();
    });

    // Character counter with energy (1 energy per 1000 chars)
    function updateCharCounter() {
      const len = textarea.value.length;
      charCount.textContent = len;

      // Styling based on remaining
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
        energyDisplay.textContent = '\u26a1' + cost;
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

        // Truncate filename for display
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
        energyDisplay.textContent = '~\u26a1' + totalCost;
        energyDisplay.classList.add('file-energy');

        // Update char counter state
        updateCharCounter();
      }
    });

    // Clear file selection
    clearFileBtn.addEventListener('click', function() {
      hasFile = false;
      fileInput.value = '';
      fileInput.classList.remove('hidden-input');
      fileSelectedBadge.classList.remove('visible');

      // Re-enable textarea
      textarea.disabled = false;
      textarea.placeholder = 'Write a note...';

      // Clear energy display
      energyDisplay.textContent = '';
      energyDisplay.classList.remove('file-energy');

      updateCharCounter();
    });

    // Delete note functionality
    document.addEventListener('click', async (e) => {
      if (!e.target.classList.contains('delete-button')) return;

      const noteItem = e.target.closest('.note-item');
      const noteId = noteItem.dataset.noteId;
      const nodeId = noteItem.dataset.nodeId;
      const version = noteItem.dataset.version;

      if (!confirm('Delete this note? This cannot be undone.')) return;

      const token = new URLSearchParams(window.location.search).get('token') || '';
      const qs = token ? '?token=' + encodeURIComponent(token) : '';

      try {
        const res = await fetch(
          '/api/v1/node/' + nodeId + '/' + version + '/notes/' + noteId + qs,
          { method: 'DELETE' }
        );

        const data = await res.json();
        if (!res.ok || data.status === 'error') throw new Error((data.error && data.error.message) || data.error || 'Delete failed');

        noteItem.style.opacity = '0';
        noteItem.style.transform = 'translateY(-10px)';
        setTimeout(() => noteItem.remove(), 300);
      } catch (err) {
        alert('Failed to delete: ' + (err.message || 'Unknown error'));
      }
    });

    // Form submission with progress
    form.addEventListener('submit', (e) => {
      e.preventDefault();

      sendBtn.classList.add('loading');
      sendBtn.disabled = true;

      const formData = new FormData(form);
      const xhr = new XMLHttpRequest();

      xhr.open('POST', form.action, true);

      xhr.upload.onprogress = (e) => {
        if (!e.lengthComputable) return;
        const percent = Math.round((e.loaded / e.total) * 100);
        progressBar.style.width = percent + '%';
      };

      xhr.onload = () => {
        document.location.reload();
      };

      xhr.onerror = () => {
        alert('Send failed');
        sendBtn.classList.remove('loading');
        sendBtn.disabled = false;
        progressBar.style.width = '0%';
      };

      xhr.send(formData);
    });

    // Enter to submit
    textarea.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        form.requestSubmit();
      }
    });

    // Editor button
    document.getElementById("openEditorBtn").addEventListener("click", function() {
      var token = new URLSearchParams(window.location.search).get("token") || "";
      var qs = token ? "?token=" + encodeURIComponent(token) + "&html" : "?html";
      var content = textarea.value.trim();
      var editorUrl = "/api/v1/node/${nodeId}/${version}/notes/editor" + qs;

      if (content) {
        sessionStorage.setItem("tree-editor-draft", content);
      }

      window.location.href = editorUrl;
    });

    // Form reset handler
    form.addEventListener('reset', () => {
      hasFile = false;
      fileInput.classList.remove('hidden-input');
      fileSelectedBadge.classList.remove('visible');
      textarea.disabled = false;
      textarea.placeholder = 'Write a note...';
      energyDisplay.textContent = '';
      energyDisplay.classList.remove('file-energy');
      charCount.textContent = '0';
      charCounter.classList.remove('warning', 'danger', 'disabled');
    });
  `;

  return page({
    title: `${escapeHtml(nodeName)} \u2014 Notes`,
    css,
    body,
    js,
  });
}
