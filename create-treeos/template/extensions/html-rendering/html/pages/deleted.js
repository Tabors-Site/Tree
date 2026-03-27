import { page } from "../layout.js";
import { escapeHtml } from "../utils.js";

export function renderDeletedBranches({ userId, user, deleted, token }) {
  const tokenQS = token ? `?token=${encodeURIComponent(token)}&html` : `?html`;

  const css = `
.header-subtitle {
  margin-bottom: 0;
}


@keyframes waterDrift {
  0% { transform: translateY(-1px); }
  100% { transform: translateY(1px); }
}

/* Glass Deleted List */
.deleted-list {
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.deleted-card {
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

/* When item becomes visible */
.deleted-card.visible {
  animation: fadeInUp 0.6s cubic-bezier(0.4, 0, 0.2, 1) forwards;
}

.deleted-card::before {
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

.deleted-card:hover {
  background: rgba(var(--glass-water-rgb), var(--glass-alpha-hover));
  transform: translateY(-2px);
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.18);
}

.deleted-card:hover::before {
  opacity: 1;
  transform: translateX(30%) translateY(10%);
}

.deleted-info {
  margin-bottom: 16px;
}

.deleted-name {
  font-size: 18px;
  font-weight: 600;
  margin-bottom: 6px;
}

.deleted-name a {
  color: white;
  text-decoration: none;
  transition: all 0.2s;
}

.deleted-name a:hover {
  text-shadow: 0 0 12px rgba(255, 255, 255, 0.8);
}

.deleted-id {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.75);
  font-family: 'SF Mono', Monaco, 'Cascadia Code', monospace;
  letter-spacing: -0.3px;
}

/* Revival Forms */
.revival-section {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding-top: 16px;
  border-top: 1px solid rgba(255, 255, 255, 0.15);
}

.revive-as-root-form button {
  position: relative;
  overflow: hidden;
  padding: 12px 24px;
  border-radius: 980px;
  border: 1px solid rgba(255, 255, 255, 0.3);
  background: rgba(255, 255, 255, 0.3);
  backdrop-filter: blur(10px);
  color: white;
  cursor: pointer;
  font-weight: 600;
  font-size: 14px;
  transition: all 0.3s;
  font-family: inherit;
  width: 100%;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
}

.revive-as-root-form button::before {
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

.revive-as-root-form button:hover {
  background: rgba(255, 255, 255, 0.4);
  transform: translateY(-2px);
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.2);
}

.revive-as-root-form button:hover::before {
  opacity: 1;
  transform: translateX(30%) translateY(10%);
}

.revive-into-branch-form {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  align-items: center;
}

.revive-into-branch-form input[type="text"] {
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

.revive-into-branch-form input[type="text"]::placeholder {
  color: rgba(255, 255, 255, 0.5);
  font-size: 13px;
}

.revive-into-branch-form input[type="text"]:focus {
  outline: none;
  border-color: rgba(255, 255, 255, 0.4);
  background: rgba(255, 255, 255, 0.2);
  box-shadow: 0 0 0 3px rgba(255, 255, 255, 0.1),
    inset 0 1px 0 rgba(255, 255, 255, 0.2);
}

.revive-into-branch-form button {
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

.revive-into-branch-form button:hover {
  background: rgba(255, 255, 255, 0.25);
  opacity: 1;
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1),
    inset 0 1px 0 rgba(255, 255, 255, 0.2);
}

/* Responsive Design */
`;

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
        Deleted Branches for
        <a href="/api/v1/user/${userId}${tokenQS}">${user.username}</a>
      </h1>
      <div class="header-subtitle">
        Recover deleted trees and branches as new trees or merge them into existing ones.
      </div>
    </div>

    <!-- Deleted Items List -->
    ${
      deleted.length > 0
        ? `
    <ul class="deleted-list">
      ${deleted
        .map(
          ({ _id, name }) => `
        <li class="deleted-card">
          <div class="deleted-info">
            <div class="deleted-name">
              <a href="/api/v1/root/${_id}${tokenQS}">
                ${name || "Untitled"}
              </a>
            </div>
            <div class="deleted-id">${_id}</div>
          </div>

          <div class="revival-section">
            <!-- Revive as Root -->
            <form
              method="POST"
              action="/api/v1/user/${userId}/deleted/${_id}/reviveAsRoot?token=${encodeURIComponent(token)}&html"
              class="revive-as-root-form"
            >
              <button type="submit">Revive as Root</button>
            </form>

            <!-- Revive into Branch -->
            <form
              method="POST"
              action="/api/v1/user/${userId}/deleted/${_id}/revive?token=${encodeURIComponent(token)}&html"
              class="revive-into-branch-form"
            >
              <input
                type="text"
                name="targetParentId"
                placeholder="Target parent node ID"
                required
              />
              <button type="submit">Revive into Branch</button>
            </form>
          </div>
        </li>
      `,
        )
        .join("")}
    </ul>
    `
        : `
    <div class="empty-state">
      <div class="empty-state-icon">\uD83D\uDDD1\uFE0F</div>
      <div class="empty-state-text">No deleted branches</div>
      <div class="empty-state-subtext">
        Deleted branches will appear here and can be revived
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
          // Add a small stagger delay based on order
          setTimeout(() => {
            entry.target.classList.add('visible');
          }, index * 50); // 50ms stagger between items

          // Stop observing once animated
          observer.unobserve(entry.target);
        }
      });
    }, observerOptions);

    // Observe all deleted cards
    document.querySelectorAll('.deleted-card').forEach(card => {
      observer.observe(card);
    });`;

  return page({
    title: `${user.username} \u2014 Deleted Branches`,
    css,
    body,
    js,
  });
}
