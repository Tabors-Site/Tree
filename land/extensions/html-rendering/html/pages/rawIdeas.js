import path from "path";
import mime from "mime-types";
import { page } from "../layout.js";
import { esc, escapeHtml, truncate } from "../utils.js";
import { getLandUrl } from "../../../../canopy/identity.js";
import { getUserMeta } from "../../../../seed/tree/userMetadata.js";
import { renderMedia as _renderMedia } from "../utils.js";

// user.js always renders immediately (no lazy loading)
const renderMedia = (fileUrl, mimeType) => _renderMedia(fileUrl, mimeType, { lazy: false });

// ═══════════════════════════════════════════════════════════════════
// Raw Ideas List - GET /user/:userId/raw-ideas
// ═══════════════════════════════════════════════════════════════════
export function renderRawIdeasList({ userId, user, rawIdeas, query, statusFilter, tabs, tabUrl, token, AUTO_PLACE_ELIGIBLE }) {
  const tokenQS = token ? `?token=${encodeURIComponent(token)}&html` : `?html`;

  const css = `
.header-subtitle {
  margin-bottom: 20px;
}


.auto-place-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  margin: 16px 0 0;
  padding: 14px 16px;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 12px;
}
.auto-place-label {
  font-size: 14px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.8);
}
.auto-place-hint {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.45);
  margin-top: 2px;
}
.auto-place-toggle {
  position: relative;
  width: 54px; height: 28px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.2);
  border: 1px solid rgba(255, 255, 255, 0.3);
  backdrop-filter: blur(18px);
  cursor: pointer;
  transition: all 0.25s ease;
  flex-shrink: 0;
}
.auto-place-toggle.active {
  background: rgba(72, 187, 178, 0.45);
  box-shadow: 0 0 16px rgba(72, 187, 178, 0.35);
}
.auto-place-toggle.muted {
  opacity: 0.4;
  cursor: not-allowed;
}
.auto-place-toggle-knob {
  position: absolute;
  top: 4px; left: 4px;
  width: 20px; height: 20px;
  border-radius: 50%;
  background: white;
  transition: all 0.25s cubic-bezier(0.22, 1, 0.36, 1);
}
.auto-place-toggle.active .auto-place-toggle-knob {
  left: 28px;
}

@keyframes waterDrift {
  0% { transform: translateY(-1px); }
  100% { transform: translateY(1px); }
}

/* Glass Search Form */
.search-form {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}

.search-form input[type="text"] {
  flex: 1;
  min-width: 200px;
  padding: 12px 16px;
  font-size: 16px;
  border-radius: 12px;
  border: 2px solid rgba(255, 255, 255, 0.3);
  background: rgba(255, 255, 255, 0.2);
  backdrop-filter: blur(20px) saturate(150%);
  -webkit-backdrop-filter: blur(20px) saturate(150%);
  font-family: inherit;
  color: white;
  font-weight: 500;
  transition: all 0.3s;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.1),
    inset 0 1px 0 rgba(255, 255, 255, 0.25);
}

.search-form input[type="text"]::placeholder {
  color: rgba(255, 255, 255, 0.65);
}

.search-form input[type="text"]:focus {
  outline: none;
  border-color: rgba(255, 255, 255, 0.6);
  background: rgba(255, 255, 255, 0.3);
  box-shadow: 0 0 0 4px rgba(255, 255, 255, 0.15),
    0 8px 30px rgba(0, 0, 0, 0.15),
    inset 0 1px 0 rgba(255, 255, 255, 0.4);
  transform: translateY(-2px);
}

.search-form button {
  position: relative;
  overflow: hidden;
  padding: 12px 28px;
  font-size: 15px;
  font-weight: 600;
  letter-spacing: -0.2px;
  border-radius: 980px;
  border: 1px solid rgba(255, 255, 255, 0.3);
  background: rgba(255, 255, 255, 0.25);
  backdrop-filter: blur(10px);
  color: white;
  cursor: pointer;
  transition: all 0.3s;
  font-family: inherit;
  white-space: nowrap;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.12);
}

.search-form button::before {
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

.search-form button:hover {
  background: rgba(255, 255, 255, 0.35);
  transform: translateY(-2px);
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.18);
}

.search-form button:hover::before {
  opacity: 1;
  transform: translateX(30%) translateY(10%);
}

/* Glass Ideas List */
.ideas-list {
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.idea-card {
  position: relative;
  background: rgba(var(--glass-water-rgb), var(--glass-alpha));
  backdrop-filter: blur(22px) saturate(140%);
  -webkit-backdrop-filter: blur(22px) saturate(140%);
  border-radius: 16px;
  padding: 24px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12),
    inset 0 1px 0 rgba(255, 255, 255, 0.25);
  border: 1px solid rgba(255, 255, 255, 0.28);
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  color: white;
  overflow: hidden;
  animation: fadeInUp 0.5s ease-out both;
}

.ideas-list {
  animation: fadeInUp 0.6s ease-out 0.2s both;
}

.idea-card:nth-child(1) { animation-delay: 0.25s; }
.idea-card:nth-child(2) { animation-delay: 0.3s; }
.idea-card:nth-child(3) { animation-delay: 0.35s; }
.idea-card:nth-child(4) { animation-delay: 0.4s; }
.idea-card:nth-child(5) { animation-delay: 0.45s; }
.idea-card:nth-child(n+6) { animation-delay: 0.5s; }


.idea-card::before {
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

.idea-card:hover {
  background: rgba(var(--glass-water-rgb), var(--glass-alpha-hover));
  transform: translateY(-2px);
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.18);
}

.idea-card:hover::before {
  opacity: 1;
  transform: translateX(30%) translateY(10%);
}

.delete-button {
  position: absolute;
  top: 20px;
  right: 20px;
  background: rgba(255, 255, 255, 0.2);
  border: 1px solid rgba(255, 255, 255, 0.3);
  border-radius: 50%;
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 18px;
  cursor: pointer;
  color: white;
  padding: 0;
  line-height: 1;
  opacity: 0.8;
  transition: all 0.3s;
  z-index: 10;
}

.delete-button:hover {
  opacity: 1;
  background: rgba(239, 68, 68, 0.4);
  border-color: rgba(239, 68, 68, 0.6);
  transform: scale(1.1);
  box-shadow: 0 4px 12px rgba(239, 68, 68, 0.3);
}

.idea-content {
  padding-right: 48px;
  margin-bottom: 16px;
}

.idea-link {
  color: white;
  text-decoration: none;
  font-size: 16px;
  line-height: 1.6;
  display: block;
  word-wrap: break-word;
  transition: all 0.2s;
  font-weight: 400;
}

.idea-link:hover {
  text-shadow: 0 0 12px rgba(255, 255, 255, 0.8);
}

.file-badge {
  display: inline-block;
  padding: 4px 10px;
  background: rgba(255, 255, 255, 0.25);
  color: white;
  border-radius: 6px;
  font-size: 11px;
  font-weight: 600;
  margin-right: 8px;
  border: 1px solid rgba(255, 255, 255, 0.3);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

/* Subtle Transfer Form */
.transfer-form {
  display: flex;
  gap: 8px;
  margin-top: 16px;
  padding-top: 16px;
  border-top: 1px solid rgba(255, 255, 255, 0.15);
  flex-wrap: wrap;
  align-items: center;
}

.transfer-form input[type="text"] {
  flex: 1;
  min-width: 180px;
  padding: 10px 14px;
  font-size: 14px;
  border-radius: 10px;
  border: 1px solid rgba(255, 255, 255, 0.25);
  background: rgba(255, 255, 255, 0.15);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  font-family: inherit;
  color: white;
  font-weight: 500;
  transition: all 0.3s;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.1);
}

.transfer-form input[type="text"]::placeholder {
  color: rgba(255, 255, 255, 0.5);
  font-size: 13px;
}

.transfer-form input[type="text"]:focus {
  outline: none;
  border-color: rgba(255, 255, 255, 0.4);
  background: rgba(255, 255, 255, 0.2);
  box-shadow: 0 0 0 3px rgba(255, 255, 255, 0.1),
    inset 0 1px 0 rgba(255, 255, 255, 0.2);
}

.transfer-form button {
  padding: 10px 18px;
  font-size: 13px;
  font-weight: 600;
  border-radius: 980px;
  border: 1px solid rgba(255, 255, 255, 0.25);
  background: rgba(255, 255, 255, 0.15);
  backdrop-filter: blur(10px);
  color: white;
  cursor: pointer;
  transition: all 0.3s;
  font-family: inherit;
  white-space: nowrap;
  opacity: 0.85;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.1);
}

.transfer-form button:hover {
  background: rgba(255, 255, 255, 0.25);
  opacity: 1;
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1),
    inset 0 1px 0 rgba(255, 255, 255, 0.2);
}

/* Metadata */
.idea-meta {
  margin-top: 12px;
  font-size: 12px;
  color: rgba(255, 255, 255, 0.75);
  display: flex;
  align-items: center;
  gap: 6px;
}

/* Status badges */
.status-badge {
  display: inline-block;
  margin-left: 10px;
  padding: 2px 8px;
  border-radius: 20px;
  font-size: 11px;
  font-weight: 600;
  vertical-align: middle;
  letter-spacing: 0.3px;
}
.status-badge--pending { background: rgba(255,255,255,0.15); color: rgba(255,255,255,0.7); }
.status-badge--processing { background: rgba(255,200,0,0.25); color: #ffe066; }
.status-badge--succeeded { background: rgba(50,220,120,0.25); color: #7effc0; }
.status-badge--stuck { background: rgba(255,140,0,0.25); color: #ffcf7e; }

/* Placed / stuck notices */
.placed-notice .chat-link {
  color: #7effc0;
  opacity: 0.8;
  text-decoration: underline;
  white-space: nowrap;
}
.placed-notice .chat-link:hover { opacity: 1; }
.placed-notice {
  margin-top: 12px;
  padding: 10px 14px;
  background: rgba(50,220,120,0.15);
  border-radius: 10px;
  font-size: 13px;
  color: #7effc0;
  border: 1px solid rgba(50,220,120,0.25);
}
.stuck-notice {
  margin-top: 12px;
  margin-bottom: 8px;
  padding: 10px 14px;
  background: rgba(255,140,0,0.15);
  border-radius: 10px;
  font-size: 13px;
  color: #ffcf7e;
  border: 1px solid rgba(255,140,0,0.25);
}
.processing-notice {
  margin-top: 12px;
  padding: 10px 14px;
  background: rgba(255,200,0,0.12);
  border-radius: 10px;
  font-size: 13px;
  color: #ffe066;
  border: 1px solid rgba(255,200,0,0.2);
}

/* Status filter tabs */
.filter-tabs {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  margin-top: 14px;
}
.filter-tab {
  padding: 5px 14px;
  border-radius: 980px;
  font-size: 12px;
  font-weight: 600;
  text-decoration: none;
  color: rgba(255,255,255,0.6);
  background: rgba(255,255,255,0.08);
  border: 1px solid rgba(255,255,255,0.12);
  transition: all 0.2s;
  letter-spacing: 0.3px;
}
.filter-tab:hover { background: rgba(255,255,255,0.16); color: rgba(255,255,255,0.9); }
.filter-tab--active { background: rgba(255,255,255,0.22); color: white; border-color: rgba(255,255,255,0.35); }

/* Auto-place button */
.auto-place-btn {
  margin-top: 14px;
  padding: 10px 20px;
  font-size: 13px;
  font-weight: 600;
  border-radius: 980px;
  border: 1px solid rgba(255,255,255,0.3);
  background: rgba(255,255,255,0.18);
  backdrop-filter: blur(10px);
  color: white;
  cursor: pointer;
  transition: all 0.3s;
  font-family: inherit;
}
.auto-place-btn:hover {
  background: rgba(255,255,255,0.28);
  transform: translateY(-1px);
}
.auto-place-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
  transform: none;
}

/* Responsive Design */
@media (max-width: 640px) {
  body {
    padding: 16px;
  }

  .search-form {
    flex-direction: column;
  }

  .search-form input[type="text"] {
    width: 100%;
    min-width: 0;
    font-size: 16px;
  }

  .search-form button {
    width: 100%;
  }

  .idea-card {
    padding: 20px 16px;
  }

  .delete-button {
    top: 16px;
    right: 16px;
    width: 28px;
    height: 28px;
    font-size: 16px;
  }

  .transfer-form {
    flex-direction: column;
  }

  .transfer-form input[type="text"] {
    width: 100%;
    min-width: 0;
  }

  .transfer-form button {
    width: 100%;
  }

}`;

  const bodyHtml = `
  <div class="container">
    <!-- Back Navigation -->
    <div class="back-nav">
      <a href="/api/v1/user/${userId}${tokenQS}" class="back-link">
        \u2190 Back to Profile
      </a>
    </div>

    <!-- Header Section -->
    <div class="header">
      <h1>
        Raw Ideas for
<a href="/api/v1/user/${userId}${tokenQS}">${escapeHtml(user.username)}</a>
      </h1>
      <div class="header-subtitle">
These will be placed onto your trees automatically while you dream (Standard+ plans)</div>

      <div class="auto-place-row">
        <div>
          <div class="auto-place-label">Auto-place ideas</div>
          <div class="auto-place-hint">${
            AUTO_PLACE_ELIGIBLE.includes((getUserMeta(user, "tiers").plan || "basic"))
              ? "Pending ideas are placed automatically every 15 minutes while you're offline."
              : "Available on Standard, Premium, and God plans."
          }</div>
        </div>
        <div
          id="autoPlaceToggle"
          class="auto-place-toggle${getUserMeta(user, "rawIdeas")?.autoPlace !== false ? " active" : ""}${!AUTO_PLACE_ELIGIBLE.includes((getUserMeta(user, "tiers").plan || "basic")) ? " muted" : ""}"
          onclick="${AUTO_PLACE_ELIGIBLE.includes((getUserMeta(user, "tiers").plan || "basic")) ? "toggleAutoPlace()" : ""}"
        >
          <div class="auto-place-toggle-knob"></div>
        </div>
      </div>

      <!-- Search Form -->
      <form method="GET" action="/api/v1/user/${userId}/raw-ideas" class="search-form">
        <input type="hidden" name="token" value="${esc(token)}">
        <input type="hidden" name="html" value="">
        ${statusFilter !== "pending" ? `<input type="hidden" name="status" value="${statusFilter}">` : ""}
        <input
          type="text"
          name="q"
          placeholder="Search raw ideas..."
          value="${query.replace(/"/g, "&quot;")}"
        />
        <button type="submit">Search</button>
      </form>

      <!-- Status Filter Tabs -->
      <div class="filter-tabs">
        ${tabs.map((t) => `<a href="${tabUrl(t.key)}" class="filter-tab${statusFilter === t.key ? " filter-tab--active" : ""}">${t.label}</a>`).join("")}
      </div>
    </div>

    <!-- Raw Ideas List -->
    ${
      rawIdeas.length > 0
        ? `
    <ul class="ideas-list">
      ${rawIdeas
        .map(
          (r) => `
        <li class="idea-card idea-card--${r.status || "pending"}" data-raw-idea-id="${r._id}" data-status="${r.status || "pending"}">
          ${!r.status || r.status === "pending" || r.status === "stuck" ? `<button class="delete-button" title="Delete raw idea">\u2715</button>` : ""}

          <div class="idea-content">
            <a
              href="/api/v1/user/${userId}/raw-ideas/${r._id}${tokenQS}"
              class="idea-link"
            >
             ${
               r.contentType === "file"
                 ? `<span class="file-badge">FILE</span>${escapeHtml(r.content)}`
                 : escapeHtml(r.content)
             }
            </a>
            <span class="status-badge status-badge--${r.status || "pending"}">
              ${r.status === "processing" ? "\u23F3 processing" : r.status === "succeeded" ? "\u2713 placed by AI" : r.status === "stuck" ? "\u26A0 stuck" : r.status === "deleted" ? "deleted" : "pending"}
            </span>
          </div>

          ${
            r.status === "succeeded"
              ? `
          <div class="placed-notice">Placed automatically by AI${r.placedAt ? ` on ${new Date(r.placedAt).toLocaleString()}` : ""}.${r.aiSessionId ? ` <a class="chat-link" href="/api/v1/user/${userId}/chats?sessionId=${r.aiSessionId}${token ? `&token=${encodeURIComponent(token)}` : ""}&html">View AI chat \u2192</a>` : ""}</div>
          `
              : r.status === "processing"
                ? `
          <div class="processing-notice">Being processed by AI \u2014 please wait.${r.aiSessionId ? ` <a class="chat-link" href="/api/v1/user/${userId}/chats?sessionId=${r.aiSessionId}${token ? `&token=${encodeURIComponent(token)}` : ""}&html">View AI chat \u2192</a>` : ""}</div>
          `
                : r.status === "deleted"
                  ? ``
                  : `
          ${r.status === "stuck" ? `<div class="stuck-notice">Auto-placement failed \u2014 place manually below.${r.aiSessionId ? ` <a class="chat-link" href="/api/v1/user/${userId}/chats?sessionId=${r.aiSessionId}${token ? `&token=${encodeURIComponent(token)}` : ""}&html">View AI chat \u2192</a>` : ""}</div>` : ""}

          ${
            (!r.status || r.status === "pending") && r.contentType !== "file"
              ? `
          <button
            class="auto-place-btn"
            data-raw-idea-id="${r._id}"
            data-token="${esc(token)}"
            data-user-id="${userId}"
          >\u2728 Auto-place</button>
          `
              : ""
          }

          <form
            method="POST"
            action="/api/v1/user/${userId}/raw-ideas/${
              r._id
            }/transfer?token=${encodeURIComponent(token)}&html"
            class="transfer-form"
          >
            <input
              type="text"
              name="nodeId"
              placeholder="Target node ID"
              required
            />
            <button type="submit">Transfer to Node</button>
          </form>
          `
          }

          <div class="idea-meta">
            ${new Date(r.createdAt).toLocaleString()}
          </div>
        </li>
      `,
        )
        .join("")}
    </ul>
    `
        : `
    <div class="empty-state">
      <div class="empty-state-icon">\uD83D\uDCAD</div>
      <div class="empty-state-text">No ${statusFilter === "pending" ? "" : statusFilter + " "}raw ideas</div>
      <div class="empty-state-subtext">
        ${
          query.trim() !== ""
            ? "Try a different search term"
            : statusFilter === "pending"
              ? "Start capturing your ideas from the user page"
              : "Nothing here yet"
        }
      </div>
    </div>
    `
    }
  </div>`;

  const js = `
    const urlToken = new URLSearchParams(window.location.search).get("token") || "";
    const tokenQs = urlToken ? "?token=" + encodeURIComponent(urlToken) : "";

    // Auto-refresh if any card is processing
    if (document.querySelector(".idea-card[data-status='processing']")) {
      setTimeout(() => window.location.reload(), 3000);
    }

    document.addEventListener("click", async function(e) {
      // Delete
      const deleteBtn = e.target.closest(".delete-button");
      if (deleteBtn) {
        e.preventDefault();
        e.stopPropagation();

        const card = deleteBtn.closest(".idea-card");
        if (!card) return;
        const rawIdeaId = card.dataset.rawIdeaId;

        if (!confirm("Delete this raw idea? This cannot be undone.")) return;

        try {
          const res = await fetch(
            "/api/v1/user/${userId}/raw-ideas/" + rawIdeaId + tokenQs,
            { method: "DELETE" }
          );
          const data = await res.json();
          if (!res.ok || data.status === "error") throw new Error((data.error && data.error.message) || data.error || "Delete failed");

          card.style.transition = "all 0.3s ease";
          card.style.opacity = "0";
          card.style.transform = "translateX(-20px)";
          setTimeout(() => card.remove(), 300);
        } catch (err) {
          alert("Failed to delete: " + (err.message || "Unknown error"));
        }
        return;
      }

      // Auto-place
      const autoBtn = e.target.closest(".auto-place-btn");
      if (autoBtn) {
        e.preventDefault();
        const rawIdeaId = autoBtn.dataset.rawIdeaId;
        const card = autoBtn.closest(".idea-card");

        autoBtn.disabled = true;
        autoBtn.textContent = "\u23F3 Starting\u2026";

        try {
          const res = await fetch(
            "/api/v1/user/${userId}/raw-ideas/" + rawIdeaId + "/place" + tokenQs,
            { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ source: "user" }) }
          );
          if (res.status === 202) {
            card.dataset.status = "processing";
            // Update badge
            const badge = card.querySelector(".status-badge");
            if (badge) { badge.className = "status-badge status-badge--processing"; badge.textContent = "\u23F3 processing"; }
            autoBtn.textContent = "\u23F3 Processing\u2026";
            // Reload after 4s to show result
            setTimeout(() => window.location.reload(), 4000);
          } else {
            const data = await res.json().catch(() => ({}));
            autoBtn.disabled = false;
            autoBtn.textContent = "\u2728 Auto-place";
            alert((data.error && data.error.message) || data.error || "Could not start orchestration");
          }
        } catch (err) {
          autoBtn.disabled = false;
          autoBtn.textContent = "\u2728 Auto-place";
          alert("Error: " + (err.message || "Unknown"));
        }
        return;
      }
    }, true);

    async function toggleAutoPlace() {
      var toggle = document.getElementById("autoPlaceToggle");
      if (!toggle || toggle.classList.contains("muted")) return;
      var isActive = toggle.classList.contains("active");
      var newEnabled = !isActive;
      toggle.classList.toggle("active");
      try {
        var res = await fetch(
          "/api/v1/user/${userId}/raw-ideas/auto-place" + tokenQs,
          { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enabled: newEnabled }) }
        );
        var data = await res.json();
        if (!res.ok || data.status === "error") {
          toggle.classList.toggle("active");
          alert((data.error && data.error.message) || data.error || "Failed to toggle");
        }
      } catch (err) {
        toggle.classList.toggle("active");
        alert("Error: " + (err.message || "Unknown"));
      }
    }`;

  return page({
    title: `${escapeHtml(user.username)} -- Raw Ideas`,
    css,
    body: bodyHtml,
    js,
  });
}

// ═══════════════════════════════════════════════════════════════════
// Single Raw Idea (text) - GET /user/:userId/raw-ideas/:rawIdeaId
// ═══════════════════════════════════════════════════════════════════
export function renderRawIdeaText({ userId, rawIdea, back, backText, userLink, hasToken, token }) {
  const tokenQS = token ? `?token=${encodeURIComponent(token)}&html` : `?html`;

  const css = `

    /* Raw Idea Card */
    .raw-idea-card {
      background: rgba(var(--glass-water-rgb), var(--glass-alpha));
      backdrop-filter: blur(22px) saturate(140%);
      -webkit-backdrop-filter: blur(22px) saturate(140%);
      border-radius: 16px;
      padding: 32px;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.12),
        inset 0 1px 0 rgba(255, 255, 255, 0.25);
      border: 1px solid rgba(255, 255, 255, 0.28);
      position: relative;
      overflow: hidden;
      animation: fadeInUp 0.6s ease-out 0.1s both;
    }

    /* User Info */
    .user-info {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 20px;
      padding-bottom: 16px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.2);
    }

    .user-info::before {
      content: '\uD83D\uDCA1';
      font-size: 18px;
    }

    .user-info a {
      color: white;
      text-decoration: none;
      font-weight: 600;
      font-size: 15px;
      transition: all 0.2s;
      text-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
    }

    .user-info a:hover {
      text-shadow: 0 0 12px rgba(255, 255, 255, 0.8);
      transform: translateX(2px);
    }

    .note-time {
      margin-left: auto;
      font-size: 13px;
      color: rgba(255, 255, 255, 0.6);
      font-weight: 400;
    }

    /* Status badge */
    .status-row {
      display: flex;
      align-items: center;
      gap: 10px;
      margin-bottom: 16px;
      flex-wrap: wrap;
    }
    .status-badge {
      display: inline-block;
      padding: 4px 12px;
      border-radius: 20px;
      font-size: 12px;
      font-weight: 600;
      letter-spacing: 0.03em;
    }
    .status-badge--pending   { background: rgba(255,255,255,0.15); color: rgba(255,255,255,0.8); border: 1px solid rgba(255,255,255,0.2); }
    .status-badge--processing{ background: rgba(255,200,0,0.25);   color: #ffe066;               border: 1px solid rgba(255,200,0,0.3); }
    .status-badge--succeeded { background: rgba(50,220,120,0.25);  color: #7effc0;               border: 1px solid rgba(50,220,120,0.3); }
    .status-badge--stuck     { background: rgba(255,140,0,0.25);   color: #ffcf7e;               border: 1px solid rgba(255,140,0,0.3); }
    .status-badge--deleted   { background: rgba(255,80,80,0.2);    color: #ff9ea0;               border: 1px solid rgba(255,80,80,0.25); }
    .ai-chat-link {
      display: inline-block;
      padding: 4px 12px;
      border-radius: 20px;
      font-size: 12px;
      font-weight: 600;
      background: rgba(255,255,255,0.15);
      color: rgba(255,255,255,0.9);
      border: 1px solid rgba(255,255,255,0.25);
      text-decoration: none;
      transition: background 0.2s;
    }
    .ai-chat-link:hover { background: rgba(255,255,255,0.25); }

    /* Copy Button Bar */
    .copy-bar {
      display: flex;
      justify-content: flex-end;
      gap: 8px;
      margin-bottom: 16px;
    }

    .copy-btn {
      background: rgba(255, 255, 255, 0.2);
      backdrop-filter: blur(10px);
      border: 1px solid rgba(255, 255, 255, 0.3);
      cursor: pointer;
      font-size: 20px;
      padding: 8px 12px;
      border-radius: 980px;
      transition: all 0.3s;
      position: relative;
      overflow: hidden;
    }

    .copy-btn::before {
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

    .copy-btn:hover {
      background: rgba(255, 255, 255, 0.3);
      transform: translateY(-2px);
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
    }

    .copy-btn:hover::before {
      opacity: 1;
      transform: translateX(30%) translateY(10%);
    }

    .copy-btn:active {
      transform: translateY(0);
    }

    #copyUrlBtn {
      background: rgba(255, 255, 255, 0.25);
    }

    /* Raw Idea Content */
    pre {
      background: rgba(255, 255, 255, 0.3);
      backdrop-filter: blur(20px) saturate(150%);
      -webkit-backdrop-filter: blur(20px) saturate(150%);
      padding: 20px;
      border-radius: 12px;
      font-size: 16px;
      line-height: 1.7;
      white-space: pre-wrap;
      word-wrap: break-word;
      border: 1px solid rgba(255, 255, 255, 0.3);
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen', 'Ubuntu', 'Cantarell', sans-serif;
      color: #3d2f8f;
      font-weight: 600;
      text-shadow:
        0 0 10px rgba(102, 126, 234, 0.4),
        0 1px 3px rgba(255, 255, 255, 1);
      box-shadow:
        0 4px 20px rgba(0, 0, 0, 0.1),
        inset 0 1px 0 rgba(255, 255, 255, 0.4);
      position: relative;
      overflow: hidden;
      transition: all 0.3s ease;
    }

    pre::before {
      content: "";
      position: absolute;
      inset: 0;
      background: linear-gradient(
        110deg,
        transparent 40%,
        rgba(255, 255, 255, 0.4),
        transparent 60%
      );
      opacity: 0;
      transform: translateX(-100%);
      pointer-events: none;
    }

    pre:hover {
      border-color: rgba(255, 255, 255, 0.5);
      box-shadow:
        0 8px 32px rgba(102, 126, 234, 0.2),
        inset 0 1px 0 rgba(255, 255, 255, 0.6);
    }

    pre.flash::before {
      opacity: 1;
      animation: glassShimmer 1.2s ease forwards;
    }

    pre:hover::before {
      opacity: 1;
      animation: glassShimmer 1.2s ease forwards;
    }

    pre.copied {
      animation: textGlow 0.8s ease-out;
    }

    @keyframes textGlow {
      0% {
        box-shadow:
          0 4px 20px rgba(0, 0, 0, 0.1),
          inset 0 1px 0 rgba(255, 255, 255, 0.4);
      }
      50% {
        box-shadow:
          0 0 40px rgba(102, 126, 234, 0.6),
          0 0 60px rgba(102, 126, 234, 0.4),
          inset 0 1px 0 rgba(255, 255, 255, 0.8);
        text-shadow:
          0 0 20px rgba(102, 126, 234, 0.8),
          0 0 30px rgba(102, 126, 234, 0.6),
          0 1px 3px rgba(255, 255, 255, 1);
      }
      100% {
        box-shadow:
          0 4px 20px rgba(0, 0, 0, 0.1),
          inset 0 1px 0 rgba(255, 255, 255, 0.4);
      }
    }

    @keyframes glassShimmer {
      0% {
        opacity: 0;
        transform: translateX(-120%) skewX(-15deg);
      }
      50% {
        opacity: 1;
      }
      100% {
        opacity: 0;
        transform: translateX(120%) skewX(-15deg);
      }
    }

    /* Responsive */`;

  const bodyHtml = `
  <div class="container">
    <!-- Back Navigation -->
    <div class="back-nav">
<a href="${back}" class="back-link">${backText}</a>
      <button id="copyUrlBtn" class="copy-btn" title="Copy URL to share">\uD83D\uDD17</button>
    </div>

    <!-- Raw Idea Card -->
    <div class="raw-idea-card">
      <div class="user-info">
        ${userLink}
        ${rawIdea.createdAt ? `<span class="note-time">${new Date(rawIdea.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })} at ${new Date(rawIdea.createdAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}</span>` : ""}
      </div>

      ${
        hasToken
          ? `<div class="status-row">
        <span class="status-badge status-badge--${rawIdea.status || "pending"}">
          ${rawIdea.status === "processing" ? "\u23F3 processing" : rawIdea.status === "succeeded" ? "\u2713 placed by AI" : rawIdea.status === "stuck" ? "\u26A0 stuck" : rawIdea.status === "deleted" ? "deleted" : "pending"}
        </span>
        ${rawIdea.aiSessionId && (rawIdea.status === "succeeded" || rawIdea.status === "stuck" || rawIdea.status === "processing") ? `<a class="ai-chat-link" href="/api/v1/user/${userId}/chats?sessionId=${rawIdea.aiSessionId}&token=${encodeURIComponent(token)}&html">View AI chat \u2192</a>` : ""}
      </div>`
          : ""
      }

      <div class="copy-bar">
        <button id="copyBtn" class="copy-btn" title="Copy raw idea">\uD83D\uDCCB</button>
      </div>

      <pre id="content">${escapeHtml(rawIdea.content)}</pre>
    </div>
  </div>`;

  const js = `
    const copyBtn = document.getElementById("copyBtn");
    const copyUrlBtn = document.getElementById("copyUrlBtn");
    const content = document.getElementById("content");

    copyBtn.addEventListener("click", () => {
      navigator.clipboard.writeText(content.textContent).then(() => {
        copyBtn.textContent = "\u2714\uFE0F";
        setTimeout(() => (copyBtn.textContent = "\uD83D\uDCCB"), 900);

        content.classList.add("copied");
        setTimeout(() => content.classList.remove("copied"), 800);

        setTimeout(() => {
          content.classList.remove("flash");
          void content.offsetWidth;
          content.classList.add("flash");
          setTimeout(() => content.classList.remove("flash"), 1300);
        }, 600);
      });
    });

    copyUrlBtn.addEventListener("click", () => {
      const url = new URL(window.location.href);
      url.searchParams.delete('token');
      if (!url.searchParams.has('html')) {
        url.searchParams.set('html', '');
      }
      navigator.clipboard.writeText(url.toString()).then(() => {
        copyUrlBtn.textContent = "\u2714\uFE0F";
        setTimeout(() => (copyUrlBtn.textContent = "\uD83D\uDD17"), 900);
      });
    });`;

  return page({
    title: `Raw Idea by ${escapeHtml(rawIdea.userId?.username || "User")} - TreeOS`,
    css,
    body: `
  <meta name="description" content="${escapeHtml((rawIdea.content || "").slice(0, 160))}" />
  <meta property="og:title" content="Raw Idea by ${escapeHtml(rawIdea.userId?.username || "User")} - TreeOS" />
  <meta property="og:description" content="${escapeHtml((rawIdea.content || "").slice(0, 160))}" />
  <meta property="og:type" content="article" />
  <meta property="og:site_name" content="TreeOS" />
  <meta property="og:image" content="${getLandUrl()}/tree.png" />
` + bodyHtml,
    js,
  });
}

// ═══════════════════════════════════════════════════════════════════
// Single Raw Idea (file) - GET /user/:userId/raw-ideas/:rawIdeaId
// ═══════════════════════════════════════════════════════════════════
export function renderRawIdeaFile({ userId, rawIdea, back, backText, userLink, hasToken, token }) {
  const tokenQS = token ? `?token=${encodeURIComponent(token)}&html` : `?html`;
  const fileDeleted = rawIdea.content === "File was deleted";
  const fileUrl = fileDeleted ? "" : `/api/v1/uploads/${rawIdea.content}`;
  const mimeType = fileDeleted
    ? ""
    : mime.lookup(rawIdea.content) || "application/octet-stream";
  const mediaHtml = fileDeleted ? "" : renderMedia(fileUrl, mimeType);
  const fileName = fileDeleted ? "File was deleted" : rawIdea.content;

  const css = `

    /* File Card */
    .file-card {
      background: rgba(var(--glass-water-rgb), var(--glass-alpha));
      backdrop-filter: blur(22px) saturate(140%);
      -webkit-backdrop-filter: blur(22px) saturate(140%);
      border-radius: 16px;
      padding: 32px;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.12),
        inset 0 1px 0 rgba(255, 255, 255, 0.25);
      border: 1px solid rgba(255, 255, 255, 0.28);
      position: relative;
      overflow: hidden;
      animation: fadeInUp 0.6s ease-out 0.1s both;
    }

    /* User Info */
    .user-info {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 20px;
      padding-bottom: 16px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.2);
    }

    .user-info::before {
      content: '\uD83D\uDC64';
      font-size: 18px;
    }

    .user-info a {
      color: white;
      text-decoration: none;
      font-weight: 600;
      font-size: 15px;
      transition: all 0.2s;
      text-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
    }

    .user-info a:hover {
      text-shadow: 0 0 12px rgba(255, 255, 255, 0.8);
      transform: translateX(2px);
    }

    .note-time {
      margin-left: auto;
      font-size: 13px;
      color: rgba(255, 255, 255, 0.6);
      font-weight: 400;
    }

    /* File Header */
    h1 {
      font-size: 24px;
      font-weight: 700;
      color: white;
      margin-bottom: 20px;
      word-break: break-word;
      text-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
    }

    /* Action Buttons */
    .action-bar {
      display: flex;
      gap: 12px;
      margin-bottom: 24px;
      flex-wrap: wrap;
    }

    .download {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 12px 20px;
      background: rgba(255, 255, 255, 0.25);
      backdrop-filter: blur(10px);
      color: white;
      text-decoration: none;
      border-radius: 980px;
      font-weight: 600;
      font-size: 15px;
      transition: all 0.3s;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.12);
      border: 1px solid rgba(255, 255, 255, 0.3);
      cursor: pointer;
      position: relative;
      overflow: hidden;
    }

    .download::after {
      content: '\u2B07\uFE0F';
      font-size: 16px;
      margin-left: 4px;
    }

    .download::before {
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

    .download:hover {
      background: rgba(255, 255, 255, 0.35);
      transform: translateY(-2px);
      box-shadow: 0 6px 20px rgba(0, 0, 0, 0.18);
    }

    .download:hover::before {
      opacity: 1;
      transform: translateX(30%) translateY(10%);
    }

    .copy-url-btn {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 12px 20px;
      background: rgba(255, 255, 255, 0.2);
      backdrop-filter: blur(10px);
      color: white;
      border: 1px solid rgba(255, 255, 255, 0.3);
      border-radius: 980px;
      font-weight: 600;
      font-size: 15px;
      transition: all 0.3s;
      cursor: pointer;
      position: relative;
      overflow: hidden;
    }

    .copy-url-btn::after {
      content: '\uD83D\uDD17';
      font-size: 16px;
      margin-left: 4px;
    }

    .copy-url-btn::before {
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

    .copy-url-btn:hover {
      background: rgba(255, 255, 255, 0.3);
      transform: translateY(-2px);
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
    }

    .copy-url-btn:hover::before {
      opacity: 1;
      transform: translateX(30%) translateY(10%);
    }

    /* Media Container */
    .media {
      margin-top: 24px;
      padding-top: 24px;
      border-top: 1px solid rgba(255, 255, 255, 0.2);
    }

    .media img,
    .media video,
    .media audio {
      max-width: 100%;
      border-radius: 12px;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2);
      border: 1px solid rgba(255, 255, 255, 0.2);
    }

    /* Responsive */


    .status-row {
      display: flex;
      align-items: center;
      gap: 10px;
      margin-bottom: 16px;
      flex-wrap: wrap;
    }
    .status-badge {
      display: inline-block;
      padding: 4px 12px;
      border-radius: 20px;
      font-size: 12px;
      font-weight: 600;
      letter-spacing: 0.03em;
    }
    .status-badge--pending   { background: rgba(255,255,255,0.15); color: rgba(255,255,255,0.8); border: 1px solid rgba(255,255,255,0.2); }
    .status-badge--processing{ background: rgba(255,200,0,0.25);   color: #ffe066;               border: 1px solid rgba(255,200,0,0.3); }
    .status-badge--succeeded { background: rgba(50,220,120,0.25);  color: #7effc0;               border: 1px solid rgba(50,220,120,0.3); }
    .status-badge--stuck     { background: rgba(255,140,0,0.25);   color: #ffcf7e;               border: 1px solid rgba(255,140,0,0.3); }
    .status-badge--deleted   { background: rgba(255,80,80,0.2);    color: #ff9ea0;               border: 1px solid rgba(255,80,80,0.25); }`;

  const bodyHtml = `
  <div class="container">
    <!-- Back Navigation -->
    <div class="back-nav">
<a href="${back}" class="back-link">${backText}</a>
    </div>

    <!-- File Card -->
    <div class="file-card">
      <div class="user-info">
        ${userLink}
        ${rawIdea.createdAt ? `<span class="note-time">${new Date(rawIdea.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })} at ${new Date(rawIdea.createdAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}</span>` : ""}
      </div>

      ${
        hasToken
          ? `<div class="status-row">
        <span class="status-badge status-badge--${rawIdea.status || "pending"}">
          ${rawIdea.status === "processing" ? "\u23F3 processing" : rawIdea.status === "succeeded" ? "\u2713 placed by AI" : rawIdea.status === "stuck" ? "\u26A0 stuck" : rawIdea.status === "deleted" ? "deleted" : "pending"}
        </span>
      </div>`
          : ""
      }

      <h1>${escapeHtml(fileName)}</h1>

      ${
        fileDeleted
          ? ""
          : `<div class="action-bar">
        <a class="download" href="${fileUrl}" download>Download</a>
        <button id="copyUrlBtn" class="copy-url-btn">Share</button>
      </div>`
      }

      <div class="media">
        ${fileDeleted ? `<p style="color:rgba(255,255,255,0.6); padding:40px 0;">File was deleted</p>` : mediaHtml}
      </div>
    </div>
  </div>`;

  const js = `
    const copyUrlBtn = document.getElementById("copyUrlBtn");

    copyUrlBtn.addEventListener("click", () => {
      const url = new URL(window.location.href);
      url.searchParams.delete('token');
      if (!url.searchParams.has('html')) {
        url.searchParams.set('html', '');
      }
      navigator.clipboard.writeText(url.toString()).then(() => {
        const originalText = copyUrlBtn.textContent;
        copyUrlBtn.textContent = "\u2714\uFE0F Copied!";
        setTimeout(() => (copyUrlBtn.textContent = originalText), 900);
      });
    });`;

  return page({
    title: `${escapeHtml(fileName)}`,
    css,
    body: bodyHtml,
    js,
  });
}
