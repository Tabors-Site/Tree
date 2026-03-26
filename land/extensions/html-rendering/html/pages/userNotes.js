import { page } from "../layout.js";
import { esc, escapeHtml } from "../utils.js";

export function renderUserNotes({ userId, user, notes, processedNotes, query, token }) {
  const tokenQS = token ? `?token=${encodeURIComponent(token)}&html` : `?html`;

  const css = `

/* Glass Header Section */
.header {
  background: rgba(var(--glass-water-rgb), var(--glass-alpha));
  backdrop-filter: blur(22px) saturate(140%);
  -webkit-backdrop-filter: blur(22px) saturate(140%);
  border-radius: 16px;
  padding: 32px;
  margin-bottom: 24px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.12),
    inset 0 1px 0 rgba(255, 255, 255, 0.25);
  border: 1px solid rgba(255, 255, 255, 0.28);
  color: white;
  animation: fadeInUp 0.6s ease-out 0.1s both;
}

.header h1 {
  font-size: 28px;
  font-weight: 600;
  color: white;
  margin-bottom: 8px;
  line-height: 1.3;
  letter-spacing: -0.5px;
  text-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
}

.header h1 a {
  color: white;
  text-decoration: none;
  border-bottom: 1px solid rgba(255, 255, 255, 0.3);
  transition: all 0.2s;
}

.header h1 a:hover {
  border-bottom-color: white;
  text-shadow: 0 0 12px rgba(255, 255, 255, 0.8);
}

.header-subtitle {
  font-size: 14px;
  color: rgba(255, 255, 255, 0.9);
  margin-bottom: 20px;
  font-weight: 400;
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
  color: rgba(255, 255, 255, 0.6);
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

/* Card Actions (Edit + Delete buttons) */
.card-actions {
  position: absolute;
  top: 20px;
  right: 20px;
  display: flex;
  gap: 8px;
  z-index: 10;
}

.edit-button,
.delete-button {
  background: rgba(255, 255, 255, 0.2);
  border: 1px solid rgba(255, 255, 255, 0.3);
  border-radius: 50%;
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 16px;
  cursor: pointer;
  color: white;
  padding: 0;
  line-height: 1;
  opacity: 0.8;
  transition: all 0.3s;
  text-decoration: none;
}

.edit-button:hover {
  opacity: 1;
  background: rgba(72, 187, 178, 0.4);
  border-color: rgba(72, 187, 178, 0.6);
  transform: scale(1.1);
  box-shadow: 0 4px 12px rgba(72, 187, 178, 0.3);
}

.delete-button:hover {
  opacity: 1;
  background: rgba(239, 68, 68, 0.4);
  border-color: rgba(239, 68, 68, 0.6);
  transform: scale(1.1);
  box-shadow: 0 4px 12px rgba(239, 68, 68, 0.3);
}


.note-author {
  font-weight: 600;
  color: white;
  font-size: 13px;
  margin-bottom: 6px;
  opacity: 0.9;
  letter-spacing: -0.2px;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.2);
}

.note-link {
  color: white;
  text-decoration: none;
  font-size: 15px;
  line-height: 1.6;
  display: block;
  word-wrap: break-word;
  transition: all 0.2s;
  font-weight: 400;
}

.note-link:hover {
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

/* Responsive Design */
@media (max-width: 640px) {
  body {
    padding: 16px;
  }

  .header {
    padding: 24px 20px;
  }

  .header h1 {
    font-size: 24px;
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


  .card-actions {
    top: 16px;
    right: 16px;
    gap: 6px;
  }

  .edit-button,
  .delete-button {
    width: 28px;
    height: 28px;
    font-size: 14px;
  }

}`;

  const body = `
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
        Notes by
<a href="/api/v1/user/${userId}${tokenQS}">${escapeHtml(user.username)}</a>
      </h1>
      <div class="header-subtitle">
        View and manage your last 200notes across every tree
      </div>

      <!-- Search Form -->
      <form method="GET" action="/api/v1/user/${userId}/notes" class="search-form">
        <input type="hidden" name="token" value="${esc(token)}">
        <input type="hidden" name="html" value="">
        <input
          type="text"
          name="q"
          placeholder="Search notes..."
value="${escapeHtml(query)}"
        />
        <button type="submit">Search</button>
      </form>
    </div>

    <!-- Notes List -->
    ${
      notes.length > 0
        ? `
    <ul class="notes-list">
      ${processedNotes.join("")}
    </ul>
    `
        : `
    <div class="empty-state">
      <div class="empty-state-icon">\uD83D\uDCDD</div>
      <div class="empty-state-text">No notes yet</div>
      <div class="empty-state-subtext">
        ${
          query.trim() !== ""
            ? "Try a different search term"
            : "Notes will appear here as you create them"
        }
      </div>
    </div>
    `
    }
  </div>`;

  const js = `
    document.addEventListener("click", async (e) => {
      if (!e.target.classList.contains("delete-button")) return;

      const card = e.target.closest(".note-card");
      const noteId = card.dataset.noteId;
      const nodeId = card.dataset.nodeId;
      const version = card.dataset.version;

      // Debug: log what we're trying to delete

      if (!noteId || !nodeId || !version) {
        alert("Error: Missing note data. Please refresh and try again.");
        return;
      }

      if (!confirm("Delete this note? This cannot be undone.")) return;

      const token = new URLSearchParams(window.location.search).get("token") || "";
      const qs = token ? "?token=" + encodeURIComponent(token) : "";

      try {
        const url = "/api/v1/node/" + nodeId + "/notes/" + noteId + qs;

        const res = await fetch(url, { method: "DELETE" });

        const data = await res.json();
        if (!res.ok || data.status === "error") throw new Error((data.error && data.error.message) || data.error || "Delete failed");

        // Fade out animation
        card.style.transition = "all 0.3s ease";
        card.style.opacity = "0";
        card.style.transform = "translateX(-20px)";
        setTimeout(() => card.remove(), 300);
      } catch (err) {
        alert("Failed to delete: " + (err.message || "Unknown error"));
      }
    });`;

  return page({
    title: `${escapeHtml(user.username)} \u2014 Notes`,
    css,
    body,
    js,
  });
}
