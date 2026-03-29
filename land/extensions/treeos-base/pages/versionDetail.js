/* ------------------------------------------------------------------ */
/* renderVersionDetail -- Version detail page with status, schedule    */
/* ------------------------------------------------------------------ */

import { page } from "../../html-rendering/html/layout.js";

/* ── page-specific CSS ── */

const css = `

/* =========================================================
   UNIFIED GLASS BUTTON SYSTEM
   ========================================================= */

.glass-btn,
button,
.action-button,
.back-link,
.nav-links a,
.meta-value button,
.contributors-list button,
button[type="submit"],
.status-button,
.primary-button {
  position: relative;
  overflow: hidden;

  padding: 10px 20px;
  border-radius: 980px;

  display: inline-flex;
  align-items: center;
  justify-content: center;
  white-space: nowrap;

  background: rgba(var(--glass-water-rgb), var(--glass-alpha));
  backdrop-filter: blur(22px) saturate(140%);
  -webkit-backdrop-filter: blur(22px) saturate(140%);

  color: white;
  text-decoration: none;
  font-family: inherit;

  font-size: 15px;
  font-weight: 600;
  letter-spacing: -0.2px;

  border: 1px solid rgba(255, 255, 255, 0.28);

  box-shadow:
    0 8px 24px rgba(0, 0, 0, 0.12),
    inset 0 1px 0 rgba(255, 255, 255, 0.25);

  cursor: pointer;

  transition:
    background 0.3s cubic-bezier(0.4, 0, 0.2, 1),
    transform 0.3s cubic-bezier(0.4, 0, 0.2, 1),
    box-shadow 0.3s ease;
}

/* Liquid light layer */
.glass-btn::before,
button::before,
.action-button::before,
.back-link::before,
.nav-links a::before,
.meta-value button::before,
.contributors-list button::before,
button[type="submit"]::before,
.status-button::before,
.primary-button::before {
  content: "";
  position: absolute;
  inset: -40%;

  background:
    radial-gradient(
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
  transition:
    opacity 0.35s ease,
    transform 0.6s cubic-bezier(0.22, 1, 0.36, 1);

  pointer-events: none;
}

/* Hover motion */
.glass-btn:hover,
button:hover,
.action-button:hover,
.back-link:hover,
.nav-links a:hover,
.meta-value button:hover,
.contributors-list button:hover,
button[type="submit"]:hover,
.status-button:hover,
.primary-button:hover {
  background: rgba(var(--glass-water-rgb), var(--glass-alpha-hover));
  transform: translateY(-2px);
}

.glass-btn:hover::before,
button:hover::before,
.action-button:hover::before,
.back-link:hover::before,
.nav-links a:hover::before,
.meta-value button:hover::before,
.contributors-list button:hover::before,
button[type="submit"]:hover::before,
.status-button:hover::before,
.primary-button:hover::before {
  opacity: 1;
  transform: translateX(30%) translateY(10%);
}

/* Active press */
.glass-btn:active,
button:active,
.status-button:active,
.primary-button:active {
  background: rgba(var(--glass-water-rgb), 0.45);
  transform: translateY(0);
}

/* Emphasis variants */
.primary-button {
  --glass-water-rgb: 72, 187, 178;
  --glass-alpha: 0.34;
  --glass-alpha-hover: 0.46;
  font-weight: 600;
}

.legacy-btn {
  opacity: 0.85;
}
.legacy-btn:hover {
  opacity: 1;
}

/* =========================================================
   CONTENT CARDS - UPDATED TO MATCH ROOT ROUTE
   ========================================================= */

.header,
.nav-section,
.actions-section {
  background: rgba(var(--glass-water-rgb), var(--glass-alpha));
  backdrop-filter: blur(22px) saturate(140%);
  -webkit-backdrop-filter: blur(22px) saturate(140%);
  border-radius: 16px;
  padding: 28px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.12),
    inset 0 1px 0 rgba(255, 255, 255, 0.25);
  border: 1px solid rgba(255, 255, 255, 0.28);
  margin-bottom: 24px;
  animation: fadeInUp 0.6s ease-out;
  animation-fill-mode: both;
  position: relative;
  overflow: hidden;
}

.header {
  animation-delay: 0.1s;
}

.nav-section {
  animation-delay: 0.15s;
}

.actions-section {
  animation-delay: 0.2s;
}

.header::before,
.nav-section::before,
.actions-section::before {
  content: "";
  position: absolute;
  inset: 0;
  border-radius: inherit;
  background: linear-gradient(
    180deg,
    rgba(255, 255, 255, 0.18),
    rgba(255, 255, 255, 0.05)
  );
  pointer-events: none;
}

.meta-card {
  background: rgba(var(--glass-water-rgb), var(--glass-alpha));
  backdrop-filter: blur(22px) saturate(140%);
  -webkit-backdrop-filter: blur(22px) saturate(140%);
  border-radius: 12px;
  padding: 16px 20px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.12),
    inset 0 1px 0 rgba(255, 255, 255, 0.25);
  border: 1px solid rgba(255, 255, 255, 0.28);
  color: white;
  animation: fadeInUp 0.6s ease-out;
  animation-fill-mode: both;
  position: relative;
  overflow: hidden;
}

.meta-card::before {
  content: "";
  position: absolute;
  inset: 0;
  border-radius: inherit;
  background: linear-gradient(
    180deg,
    rgba(255, 255, 255, 0.18),
    rgba(255, 255, 255, 0.05)
  );
  pointer-events: none;
}

/* Stagger meta-card animations */
.meta-card:nth-child(1) { animation-delay: 0.2s; }
.meta-card:nth-child(2) { animation-delay: 0.25s; }

.header h1 {
  font-size: 28px;
  font-weight: 600;
  letter-spacing: -0.5px;
  line-height: 1.3;
  margin-bottom: 8px;
  text-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
}

.header h1 a {
  color: white;
  text-decoration: none;
  transition: opacity 0.2s;
}

.header h1 a:hover {
  opacity: 0.8;
}

.nav-section h2,
.actions-section h3 {
  font-size: 18px;
  font-weight: 600;
  color: white;
  margin-bottom: 16px;
  letter-spacing: -0.3px;
  text-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
}

/* =========================================================
   NAV + META
   ========================================================= */

.back-nav {
  display: flex;
  gap: 12px;
  margin-bottom: 20px;
  flex-wrap: wrap;
  animation: fadeInUp 0.5s ease-out;
}

.version-badge {
  display: inline-block;
  padding: 6px 14px;
  background: rgba(16, 185, 129, 0.25);
  backdrop-filter: blur(10px);
  color: white;
  border-radius: 20px;
  font-size: 14px;
  font-weight: 600;
  margin-top: 8px;
  border: 1px solid rgba(16, 185, 129, 0.4);
  position: relative;
  overflow: hidden;
  box-shadow: 0 4px 12px rgba(16, 185, 129, 0.15),
    inset 0 1px 0 rgba(255, 255, 255, 0.3);
}

/* Version badge colors matching status */
.version-badge.version-status-active {
  background: rgba(16, 185, 129, 0.25);
  border: 1px solid rgba(16, 185, 129, 0.4);
  box-shadow: 0 4px 12px rgba(16, 185, 129, 0.15),
    inset 0 1px 0 rgba(255, 255, 255, 0.3);
}

.version-badge.version-status-completed {
  background: rgba(139, 92, 246, 0.25);
  border: 1px solid rgba(139, 92, 246, 0.4);
  box-shadow: 0 4px 12px rgba(139, 92, 246, 0.15),
    inset 0 1px 0 rgba(255, 255, 255, 0.3);
}

.version-badge.version-status-trimmed {
  background: rgba(220, 38, 38, 0.25);
  border: 1px solid rgba(220, 38, 38, 0.4);
  box-shadow: 0 4px 12px rgba(220, 38, 38, 0.15),
    inset 0 1px 0 rgba(255, 255, 255, 0.3);
}

.version-badge::after {
  content: "";
  position: absolute;
  inset: 0;

  background: linear-gradient(
    100deg,
    transparent 40%,
    rgba(255, 255, 255, 0.5),
    transparent 60%
  );

  opacity: 0;
  transform: translateX(-100%);
  transition: transform 0.8s ease, opacity 0.3s ease;

  animation: openAppHoverShimmerClone 1.6s ease forwards;
  animation-delay: 0.5s;

  pointer-events: none;
}

@keyframes openAppHoverShimmerClone {
  0% {
    opacity: 0;
    transform: translateX(-100%);
  }

  100% {
    opacity: 1;
    transform: translateX(100%);
  }
}

.created-date {
  font-size: 13px;
  color: rgba(255, 255, 255, 0.7);
  margin-top: 10px;
  font-weight: 500;
}

.node-id-container {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 12px;
  flex-wrap: wrap;
  padding: 10px 14px;
  background: rgba(255, 255, 255, 0.15);
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.2);
  width: 100%;
}

code {
  background: transparent;
  padding: 0;
  border-radius: 0;
  font-size: 13px;
  font-family: 'SF Mono', Monaco, 'Cascadia Code', monospace;
  color: white;
  word-break: break-all;
  flex: 1;
  min-width: 0;
  overflow-wrap: break-word;
}

#copyNodeIdBtn {
  background: rgba(255, 255, 255, 0.2);
  border: 1px solid rgba(255, 255, 255, 0.3);
  cursor: pointer;
  padding: 6px 10px;
  border-radius: 6px;
  opacity: 1;
  font-size: 16px;
  transition: all 0.2s;
  flex-shrink: 0;
}

#copyNodeIdBtn:hover {
  background: rgba(255, 255, 255, 0.3);
  transform: scale(1.1);
}

#copyNodeIdBtn::before {
  display: none;
}

.meta-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
  gap: 16px;
  margin-bottom: 24px;
}

.meta-label {
  font-size: 12px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: rgba(255, 255, 255, 0.7);
  margin-bottom: 6px;
}

.meta-value {
  font-size: 15px;
  font-weight: 600;
  color: white;
  word-break: break-word;
  overflow-wrap: break-word;
}

.status-badge {
  display: inline-block;
  padding: 6px 12px;
  border-radius: 6px;
  font-size: 13px;
  font-weight: 600;
  text-transform: capitalize;
  background: rgba(255, 255, 255, 0.25);
  color: white;
  border: 1px solid rgba(255, 255, 255, 0.3);
}

/* Official status colors with glass effect - UPDATED COLORS */
.status-badge.status-active {
  background: rgba(16, 185, 129, 0.35);
  border: 1px solid rgba(16, 185, 129, 0.5);
  backdrop-filter: blur(10px);
  box-shadow: 0 0 12px rgba(16, 185, 129, 0.2);
}

.status-badge.status-completed {
  background: rgba(139, 92, 246, 0.35);
  border: 1px solid rgba(139, 92, 246, 0.5);
  backdrop-filter: blur(10px);
  box-shadow: 0 0 12px rgba(139, 92, 246, 0.2);
}

.status-badge.status-trimmed {
  background: rgba(220, 38, 38, 0.35);
  border: 1px solid rgba(220, 38, 38, 0.5);
  backdrop-filter: blur(10px);
  box-shadow: 0 0 12px rgba(220, 38, 38, 0.2);
}

.nav-links {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 12px;
}

.nav-links a {
  padding: 14px 18px;
  font-size: 15px;
  text-align: center;
}

/* =========================================================
   STATUS CARD WITH BUTTONS - UPDATED COLORS
   ========================================================= */

.status-controls {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  margin-top: 12px;
}

.status-controls button {
  padding: 8px 16px;
  font-size: 13px;
  position: relative;
}

/* Faint glass colors for status buttons - UPDATED */
.status-controls button[value="active"] {
  --glass-water-rgb: 16, 185, 129; /* green */
  --glass-alpha: 0.15;
  --glass-alpha-hover: 0.25;
}

.status-controls button[value="completed"] {
  --glass-water-rgb: 139, 92, 246; /* purple */
  --glass-alpha: 0.15;
  --glass-alpha-hover: 0.25;
}

.status-controls button[value="trimmed"] {
  --glass-water-rgb: 220, 38, 38; /* red */
  --glass-alpha: 0.15;
  --glass-alpha-hover: 0.25;
}

/* =========================================================
   SCHEDULE CARD
   ========================================================= */

.schedule-info {
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: 100%;
}

.schedule-row {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  width: 100%;
}

.schedule-text {
  flex: 1;
  min-width: 0;
  overflow: hidden;
}

.schedule-text .meta-value {
  word-break: break-word;
  overflow-wrap: break-word;
}

.repeat-text {
  font-size: 13px;
  color: rgba(255, 255, 255, 0.8);
  margin-top: 6px;
}

#editScheduleBtn {
  flex-shrink: 0;
}

/* =========================================================
   ACTIONS & FORMS
   ========================================================= */

.action-form {
  margin-bottom: 24px;
}

.action-form:last-child {
  margin-bottom: 0;
}

.button-group {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
}

button[type="submit"],
.status-button {
  padding: 12px 20px;
  font-size: 14px;
}

/* =========================================================
   MODAL
   ========================================================= */

#scheduleModal {
  display: none;
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  backdrop-filter: blur(8px);
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

#scheduleModal > div {
  background: rgba(var(--glass-water-rgb), var(--glass-alpha));
  backdrop-filter: blur(22px) saturate(140%);
  -webkit-backdrop-filter: blur(22px) saturate(140%);
  padding: 28px;
  border-radius: 16px;
  width: 320px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2),
    inset 0 1px 0 rgba(255, 255, 255, 0.25);
  border: 1px solid rgba(255, 255, 255, 0.28);
  position: relative;
  overflow: hidden;
}

#scheduleModal > div::before {
  content: "";
  position: absolute;
  inset: 0;
  border-radius: inherit;
  background: linear-gradient(
    180deg,
    rgba(255, 255, 255, 0.18),
    rgba(255, 255, 255, 0.05)
  );
  pointer-events: none;
}

#scheduleModal label {
  display: block;
  margin-bottom: 12px;
  color: white;
  font-weight: 600;
  font-size: 14px;
  letter-spacing: -0.2px;
  text-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
  position: relative;
}

#scheduleModal input {
  width: 100%;
  margin-top: 6px;
  padding: 12px 14px;
  border-radius: 10px;
  border: 2px solid rgba(255, 255, 255, 0.3);
  background: rgba(255, 255, 255, 0.15);
  font-size: 15px;
  font-family: inherit;
  font-weight: 500;
  transition: all 0.2s;
  color: white;
  position: relative;
}

#scheduleModal input::placeholder {
  color: rgba(255, 255, 255, 0.5);
}

#scheduleModal input:focus {
  outline: none;
  border-color: rgba(255, 255, 255, 0.6);
  background: rgba(255, 255, 255, 0.25);
  box-shadow: 0 0 0 3px rgba(255, 255, 255, 0.15);
  transform: translateY(-2px);
}

#scheduleModal button {
  padding: 10px 18px;
  border-radius: 980px;
  font-weight: 600;
  font-size: 14px;
  cursor: pointer;
  font-family: inherit;
  transition: all 0.2s;
  border: 1px solid rgba(255, 255, 255, 0.28);
  position: relative;
}

#scheduleModal button[type="button"] {
  background: rgba(255, 255, 255, 0.15);
  color: white;
  border: 1px solid rgba(255, 255, 255, 0.28) !important;
  box-shadow: none !important;
}

#scheduleModal button[type="button"]:hover {
  background: rgba(255, 255, 255, 0.25);
}

#scheduleModal button[type="button"]::before {
  display: none;
}

#scheduleModal > div > form > div {
  display: flex;
  gap: 10px;
  justify-content: flex-end;
  margin-top: 16px;
}

/* =========================================================
   RESPONSIVE
   ========================================================= */

@media (max-width: 640px) {
  .container {
    max-width: 100%;
  }

  .header,
  .nav-section,
  .actions-section {
    padding: 20px;
  }

  .meta-grid {
    grid-template-columns: 1fr;
    gap: 12px;
  }

  .meta-card {
    padding: 14px 16px;
  }

  .nav-links {
    grid-template-columns: 1fr;
  }

  .button-group {
    flex-direction: column;
  }

  button,
  .status-button,
  .primary-button {
    width: 100%;
  }

  .status-controls {
    flex-direction: column;
    align-items: stretch;
  }

  .status-controls button {
    width: 100%;
  }

  code {
    font-size: 12px;
    word-break: break-all;
  }

  .schedule-row {
    flex-direction: column;
    align-items: stretch;
    gap: 8px;
  }

  #editScheduleBtn {
    width: 100%;
    justify-content: center;
  }

  #scheduleModal > div {
    width: calc(100% - 40px);
    max-width: 320px;
  }
}

@media (min-width: 641px) and (max-width: 1024px) {
  .meta-grid {
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  }
}
`;

/* ── client-side JS ── */

const jsCode = `
    // Copy ID functionality
    const btn = document.getElementById("copyNodeIdBtn");
    const code = document.getElementById("nodeIdCode");

    btn.addEventListener("click", () => {
      navigator.clipboard.writeText(code.textContent).then(() => {
        btn.textContent = "✔️";
        setTimeout(() => (btn.textContent = "📋"), 900);
      });
    });

    // Schedule modal
    const editBtn = document.getElementById("editScheduleBtn");
    const modal = document.getElementById("scheduleModal");
    const cancelBtn = document.getElementById("cancelSchedule");

    if (editBtn) {
      editBtn.onclick = () => {
        modal.style.display = "flex";
      };
    }

    if (cancelBtn) {
      cancelBtn.onclick = () => {
        modal.style.display = "none";
      };
    }
`;

/* ================================================================== */
/* renderVersionDetail                                                 */
/* ================================================================== */

export function renderVersionDetail({
  node,
  nodeId,
  version,
  data,
  qs,
  backUrl,
  backTreeUrl,
  createdDate,
  scheduleHtml,
  reeffectTime,
  showPrestige,
  ALL_STATUSES,
  STATUS_LABELS,
}) {
  const body = `
  <div class="container">
    <!-- Back Navigation -->
    <div class="back-nav">
      ${backTreeUrl ? `<a href="${backTreeUrl}" class="back-link">← Back to Tree</a>` : ""}
      <a href="${backUrl}" class="back-link">
        View All Versions
      </a>
      <a href="/api/v1/node/${nodeId}/command-center${qs}" class="back-link">
        Command Center
      </a>
    </div>

    <!-- Header -->
    <div class="header">
      <h1
        id="nodeNameDisplay"
        style="cursor:pointer;"
        title="Click to rename"
        onclick="document.getElementById('nodeNameDisplay').style.display='none';document.getElementById('renameForm').style.display='flex';"
      >${node.name}</h1>
      <form
        id="renameForm"
        method="POST"
        action="/api/v1/node/${nodeId}/${version}/editName${qs}"
        style="display:none;align-items:center;gap:8px;margin-bottom:12px;"
      >
        <input
          type="text"
          name="name"
          value="${node.name.replace(/"/g, '&quot;')}"
          required
          style="flex:1;font-size:20px;font-weight:700;padding:8px 12px;border-radius:12px;border:1px solid rgba(255,255,255,0.2);background:rgba(255,255,255,0.1);color:white;"
        />
        <button type="submit" class="primary-button" style="padding:8px 16px;">Save</button>
        <button
          type="button"
          class="warning-button"
          style="padding:8px 16px;"
          onclick="document.getElementById('renameForm').style.display='none';document.getElementById('nodeNameDisplay').style.display='';"
        >Cancel</button>
      </form>

      <div class="meta-row" style="margin-top:4px;">
        <div class="meta-item">
          <div class="meta-label">Type</div>
          <div class="meta-value">${node.type ?? "None"}</div>
        </div>
      </div>

      <span class="version-badge version-status-${data.status}">Version ${version}</span>

      <div class="created-date">Created: ${createdDate}</div>

      <div class="node-id-container">
        <code id="nodeIdCode">${node._id}</code>
        <button id="copyNodeIdBtn" title="Copy ID">📋</button>
      </div>
    </div>

    <!-- Navigation Links -->
    <div class="nav-section">
      <h2>Quick Access</h2>
      <div class="nav-links">
        <a href="/api/v1/node/${nodeId}/${version}/notes${qs}">Notes</a>
        <a href="/api/v1/node/${nodeId}/${version}/values${qs}">Values / Goals</a>
        <a href="/api/v1/node/${nodeId}/${version}/contributions${qs}">Contributions</a>
        <a href="/api/v1/node/${nodeId}/${version}/transactions${qs}">Transactions</a>
        <a href="/api/v1/node/${nodeId}/chats${qs}">AI Chats</a>
      </div>
    </div>

    <!-- Metadata Grid -->
    <div class="meta-grid">
      <!-- Status Card with Controls -->
      <div class="meta-card">
        <div class="meta-label">Status</div>
        <div class="meta-value">
          <span class="status-badge status-${data.status}">${data.status}</span>
        </div>
        <form
          method="POST"
          action="/api/v1/node/${nodeId}/${version}/editStatus${qs}"
          onsubmit="return confirm('This will apply to all children. Is that ok?')"
          class="status-controls"
        >
          <input type="hidden" name="isInherited" value="true" />
          ${ALL_STATUSES.filter((s) => s !== data.status)
            .map(
              (s) => `
            <button type="submit" name="status" value="${s}" class="status-button">
              ${STATUS_LABELS[s]}
            </button>
          `,
            )
            .join("")}
        </form>
      </div>

      <!-- Schedule + Repeat Hours Card -->
      <div class="meta-card">
        <div class="meta-label">Schedule</div>
        <div class="schedule-info">
          <div class="schedule-row">
            <div class="schedule-text">
              <div class="meta-value">${scheduleHtml}</div>
              <div class="repeat-text">Repeat: ${reeffectTime} hours</div>
            </div>
            <button id="editScheduleBtn" style="padding:8px 12px;">✏️</button>
          </div>
        </div>
      </div>
    </div>

    ${
      showPrestige
        ? `
    <!-- Version Control Section -->
    <div class="actions-section">
      <h3>Version Control</h3>
      <form
        method="POST"
        action="/api/v1/node/${nodeId}/${version}/prestige${qs}"
        onsubmit="return confirm('This will complete the current version and create a new prestige level. Continue?')"
        class="action-form"
      >
        <button type="submit" class="primary-button">
          Add New Version
        </button>
      </form>
    </div>
    `
        : ""
    }
  </div>

  <!-- Schedule Modal -->
  <div id="scheduleModal">
    <div>
      <form
        method="POST"
        action="/api/v1/node/${nodeId}/${version}/editSchedule${qs}"
      >
        <label>
          TIME
          <input
            type="datetime-local"
            name="newSchedule"
            value="${
              data.schedule
                ? new Date(data.schedule).toISOString().slice(0, 16)
                : ""
            }"
          />
        </label>

        <label>
          REPEAT HOURS
          <input
            type="number"
            name="reeffectTime"
            min="0"
            value="${data.reeffectTime ?? 0}"
          />
        </label>

        <div style="display:flex;gap:10px;justify-content:flex-end;">
          <button type="button" id="cancelSchedule">Cancel</button>
          <button type="submit" class="primary-button">Save</button>
        </div>
      </form>
    </div>
  </div>
`;

  return page({
    title: `${node.name} v${version}`,
    css,
    body,
    js: jsCode,
  });
}
