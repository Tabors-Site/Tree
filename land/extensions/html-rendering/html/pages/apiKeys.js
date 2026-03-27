import { page } from "../layout.js";
import { esc } from "../utils.js";

export function renderApiKeyCreated({ userId, safeName, rawKey, token }) {
  const tokenQS = token ? `?token=${encodeURIComponent(token)}&html` : `?html`;

  const css = `
.container { max-width: 600px; margin: 0 auto; position: relative; z-index: 1; }

.card {
  position: relative;
  background: rgba(115,111,230,var(--glass-alpha));
  backdrop-filter: blur(22px) saturate(140%);
  -webkit-backdrop-filter: blur(22px) saturate(140%);
  border-radius: 20px; padding: 40px;
  box-shadow: 0 20px 60px rgba(0,0,0,0.2), inset 0 1px 0 rgba(255,255,255,0.25);
  border: 1px solid rgba(255,255,255,0.28);
  color: white; animation: fadeInUp 0.6s ease-out 0.1s both;
}
.card-title {
  font-size: 22px; font-weight: 700; margin-bottom: 6px;
  letter-spacing: -0.3px;
}
.card-name {
  font-size: 14px; color: rgba(255,255,255,0.6); margin-bottom: 20px;
}
.warning {
  display: flex; align-items: center; gap: 10px;
  padding: 12px 16px; margin-bottom: 20px;
  background: rgba(255,179,71,0.15); border: 1px solid rgba(255,179,71,0.3);
  border-radius: 10px; font-size: 13px; font-weight: 500;
  color: rgba(255,220,150,0.95); line-height: 1.5;
}
.key-block {
  position: relative;
  background: rgba(0,0,0,0.25); border: 1px solid rgba(255,255,255,0.15);
  border-radius: 10px; padding: 16px 60px 16px 16px;
  font-family: 'SF Mono', 'Fira Code', 'Courier New', monospace;
  font-size: 14px; color: rgba(255,255,255,0.95);
  word-break: break-all; line-height: 1.6;
  margin-bottom: 24px;
}
.copy-btn {
  position: absolute; top: 10px; right: 10px;
  background: rgba(255,255,255,0.15); border: 1px solid rgba(255,255,255,0.25);
  border-radius: 8px; padding: 8px 14px;
  color: white; font-size: 12px; font-weight: 600;
  cursor: pointer; transition: all 0.2s;
  backdrop-filter: blur(10px);
}
.copy-btn:hover {
  background: rgba(255,255,255,0.25); transform: translateY(-1px);
}
.copy-btn.copied {
  background: rgba(72,187,120,0.3); border-color: rgba(72,187,120,0.4);
}
@media (max-width: 640px) {
  body { padding: 16px; }
  .card { padding: 28px 20px; }

}`;

  const body = `
  <div class="container">
    <div class="back-nav">
      <a href="/api/v1/user/${userId}${tokenQS}" class="back-link">&lt;- Back to Profile</a>
      <a href="/api/v1/user/${userId}/api-keys${tokenQS}" class="back-link">API Keys</a>
    </div>

    <div class="card">
      <div class="card-title">API Key Created</div>
      <div class="card-name">${esc(safeName)}</div>

      <div class="warning">
        This key will only be shown once. Copy it now and store it securely.
      </div>

      <div class="key-block" id="keyBlock">
        ${esc(rawKey)}
        <button class="copy-btn" id="copyBtn" onclick="copyKey()">\uD83D\uDCCB</button>
      </div>
    </div>
  </div>`;

  const js = `
    function copyKey() {
      var block = document.getElementById("keyBlock");
      var btn = document.getElementById("copyBtn");
      var key = block.textContent.replace(btn.textContent, "").trim();
      navigator.clipboard.writeText(key).then(function() {
        var btn = document.getElementById("copyBtn");
        btn.textContent = "\u2705";
        btn.classList.add("copied");
        setTimeout(function() {
          btn.textContent = "\uD83D\uDCCB";
          btn.classList.remove("copied");
        }, 2000);
      });
    }`;

  return page({
    title: `API Key Created`,
    css,
    body,
    js,
  });
}

export function renderApiKeysList({ userId, user, apiKeys, token, errorParam }) {
  const tokenQS = token ? `?token=${encodeURIComponent(token)}&html` : `?html`;

  const css = `
.header-subtitle {
  margin-bottom: 0;
}


@keyframes waterDrift {
  0% { transform: translateY(-1px); }
  100% { transform: translateY(1px); }
}

/* Create Form Card */
.create-card {
  position: relative;
  overflow: hidden;
  background: rgba(var(--glass-water-rgb), var(--glass-alpha));
  backdrop-filter: blur(22px) saturate(140%);
  -webkit-backdrop-filter: blur(22px) saturate(140%);
  border-radius: 16px;
  padding: 24px;
  margin-bottom: 24px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12),
    inset 0 1px 0 rgba(255, 255, 255, 0.25);
  border: 1px solid rgba(255, 255, 255, 0.28);
  color: white;
}

.create-card::before {
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

.create-card:hover::before {
  opacity: 1;
  transform: translateX(30%) translateY(10%);
}

.create-form {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  margin-bottom: 12px;
}

.create-form input {
  flex: 1;
  min-width: 200px;
  padding: 12px 16px;
  font-size: 15px;
  border-radius: 12px;
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

.create-form input::placeholder {
  color: rgba(255, 255, 255, 0.5);
}

.create-form input:focus {
  outline: none;
  border-color: rgba(255, 255, 255, 0.4);
  background: rgba(255, 255, 255, 0.2);
  box-shadow: 0 0 0 3px rgba(255, 255, 255, 0.1),
    inset 0 1px 0 rgba(255, 255, 255, 0.2);
}

.create-form button {
  position: relative;
  overflow: hidden;
  padding: 12px 24px;
  font-size: 15px;
  font-weight: 600;
  border-radius: 980px;
  border: 1px solid rgba(255, 255, 255, 0.3);
  background: rgba(255, 255, 255, 0.3);
  backdrop-filter: blur(10px);
  color: white;
  cursor: pointer;
  transition: all 0.3s;
  font-family: inherit;
  white-space: nowrap;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
}

.create-form button::before {
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

.create-form button:hover {
  background: rgba(255, 255, 255, 0.4);
  transform: translateY(-2px);
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.2);
}

.create-form button:hover::before {
  opacity: 1;
  transform: translateX(30%) translateY(10%);
}

.create-hint {
  font-size: 13px;
  color: rgba(255, 255, 255, 0.75);
}

/* API Keys List */
.keys-list {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.key-card {
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

  /* Start hidden for lazy loading */
  opacity: 0;
  transform: translateY(30px);
}

/* Active keys get green glass tint */
.key-card.active {
  background: rgba(76, 175, 80, 0.2);
  border-color: rgba(76, 175, 80, 0.35);
}

.key-card.active::after {
  content: "";
  position: absolute;
  inset: 0;
  background: radial-gradient(
    circle at top right,
    rgba(76, 175, 80, 0.15),
    transparent 70%
  );
  pointer-events: none;
}

/* When item becomes visible */
.key-card.visible {
  animation: fadeInUp 0.6s cubic-bezier(0.4, 0, 0.2, 1) forwards;
}

.key-card::before {
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

.key-card:hover {
  background: rgba(var(--glass-water-rgb), var(--glass-alpha-hover));
  transform: translateY(-2px);
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.18);
}

.key-card.active:hover {
  background: rgba(76, 175, 80, 0.28);
  box-shadow: 0 12px 32px rgba(76, 175, 80, 0.15);
}

.key-card:hover::before {
  opacity: 1;
  transform: translateX(30%) translateY(10%);
}

.key-name {
  font-size: 18px;
  font-weight: 600;
  color: white;
  margin-bottom: 12px;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.2);
}

.key-meta {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 12px;
}

.meta-item {
  font-size: 13px;
  color: rgba(255, 255, 255, 0.85);
  display: flex;
  align-items: center;
  gap: 8px;
}

.badge {
  display: inline-flex;
  align-items: center;
  padding: 4px 12px;
  font-size: 12px;
  border-radius: 980px;
  font-weight: 600;
  border: 1px solid rgba(255, 255, 255, 0.3);
}

.badge.active {
  background: rgba(76, 175, 80, 0.25);
  color: white;
  border-color: rgba(76, 175, 80, 0.4);
}

.badge.revoked {
  background: rgba(239, 68, 68, 0.25);
  color: white;
  border-color: rgba(239, 68, 68, 0.4);
}

.key-actions {
  margin-top: 16px;
  padding-top: 16px;
  border-top: 1px solid rgba(255, 255, 255, 0.15);
}

.revoke-button {
  padding: 10px 20px;
  font-size: 14px;
  font-weight: 600;
  border-radius: 980px;
  border: 1px solid rgba(239, 68, 68, 0.4);
  background: rgba(239, 68, 68, 0.25);
  color: white;
  cursor: pointer;
  transition: all 0.3s;
  font-family: inherit;
}

.revoke-button:hover {
  background: rgba(239, 68, 68, 0.35);
  border-color: rgba(239, 68, 68, 0.5);
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(239, 68, 68, 0.3);
}

/* Responsive Design */
@media (max-width: 640px) {
  body {
    padding: 16px;
  }

  .create-form {
    flex-direction: column;
  }

  .create-form input {
    width: 100%;
    min-width: 0;
  }

  .create-form button {
    width: 100%;
  }

  .key-card {
    padding: 20px 16px;
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

    <!-- Header -->
    <div class="header">
      <h1>API Keys</h1>
      <div class="header-subtitle">
        Manage programmatic access to your account
      </div>
    </div>

    <!-- Create API Key -->
    <div class="create-card">
      <form class="create-form" method="POST" action="/api/v1/user/${
        userId
      }/api-keys?token=${encodeURIComponent(token)}&html">
        <input type="text" name="name" placeholder="Key name (optional)" />
        <button type="submit">Create Key</button>
      </form>
      <div class="create-hint">
        You'll only see the key once after creation.
      </div>
    </div>

    <!-- API Keys List -->
    ${
      apiKeys.length > 0
        ? `
    <div class="keys-list">
      ${apiKeys
        .map(
          (k) => `
        <div class="key-card${!k.revoked ? " active" : ""}">
          <div class="key-name">${k.name || "Untitled Key"}</div>

          <div class="key-meta">
            <div class="meta-item">
              Created ${new Date(k.createdAt).toLocaleDateString()}
            </div>
            <div class="meta-item">
              Used ${k.usageCount} ${k.usageCount === 1 ? "time" : "times"}
            </div>
            <div class="meta-item">
              <span class="badge ${k.revoked ? "revoked" : "active"}">
                ${k.revoked ? "Revoked" : "Active"}
              </span>
            </div>
          </div>

          ${
            !k.revoked
              ? `
          <div class="key-actions">
            <button class="revoke-button" data-key-id="${k._id}">
              Revoke Key
            </button>
          </div>
          `
              : ""
          }
        </div>
      `,
        )
        .join("")}
    </div>
    `
        : `
    <div class="empty-state">
      <div class="empty-state-icon">\uD83D\uDD11</div>
      <div class="empty-state-text">No API keys yet</div>
      <div class="empty-state-subtext">
        Create one above to get started
      </div>
    </div>
    `
    }
  </div>`;

  const js = `
    // Intersection Observer for lazy loading animations
    const observerOptions = {
      root: null,
      rootMargin: '50px',
      threshold: 0.1
    };

    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry, index) => {
        if (entry.isIntersecting) {
          setTimeout(() => {
            entry.target.classList.add('visible');
          }, index * 50);
          observer.unobserve(entry.target);
        }
      });
    }, observerOptions);

    // Observe all key cards
    document.querySelectorAll('.key-card').forEach(card => {
      observer.observe(card);
    });

    // Revoke button handler
    document.addEventListener("click", async (e) => {
      if (!e.target.classList.contains("revoke-button")) return;

      const keyId = e.target.dataset.keyId;

      if (!confirm("Revoke this API key? This cannot be undone.")) return;

      const token = new URLSearchParams(window.location.search).get("token") || "";
      const qs = token ? "?token=" + encodeURIComponent(token) : "";

      try {
        const res = await fetch(
          "/api/v1/user/${userId}/api-keys/" + keyId + qs,
          { method: "DELETE" }
        );

        const data = await res.json();
        if (data.status === "error") throw new Error((data.error && data.error.message) || "Revoke failed");

        location.reload();
      } catch (err) {
        alert("Failed to revoke API key");
      }
    });`;

  return page({
    title: `${user.username} \u2014 API Keys`,
    css,
    body,
    js,
  });
}
