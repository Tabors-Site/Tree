import { page } from "../../html-rendering/html/layout.js";
import { esc, escapeHtml } from "../../html-rendering/html/utils.js";

export function renderInvites({ userId, invites, token }) {
  const tokenQS = token ? `?token=${encodeURIComponent(token)}&html` : `?html`;

  const css = `
.header-subtitle {
  margin-bottom: 0;
}


@keyframes waterDrift {
  0% { transform: translateY(-1px); }
  100% { transform: translateY(1px); }
}

/* Glass Invites List */
.invites-list {
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.invite-card {
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
.invite-card.visible {
  animation: fadeInUp 0.6s cubic-bezier(0.4, 0, 0.2, 1) forwards;
}

.invite-card::before {
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

.invite-card:hover {
  background: rgba(var(--glass-water-rgb), var(--glass-alpha-hover));
  transform: translateY(-2px);
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.18);
}

.invite-card:hover::before {
  opacity: 1;
  transform: translateX(30%) translateY(10%);
}

.invite-text {
  font-size: 16px;
  line-height: 1.6;
  color: white;
  margin-bottom: 16px;
  font-weight: 400;
}

.invite-text strong {
  font-weight: 600;
  color: white;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.2);
}

.invite-actions {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}

.invite-actions form {
  margin: 0;
}

.accept-button,
.decline-button {
  position: relative;
  overflow: hidden;
  padding: 10px 20px;
  border-radius: 980px;
  font-weight: 600;
  font-size: 14px;
  cursor: pointer;
  transition: all 0.3s;
  font-family: inherit;
  border: 1px solid rgba(255, 255, 255, 0.3);
}

.accept-button {
  background: rgba(255, 255, 255, 0.3);
  backdrop-filter: blur(10px);
  color: white;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
}

.accept-button::before {
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

.accept-button:hover {
  background: rgba(255, 255, 255, 0.4);
  transform: translateY(-2px);
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.2);
}

.accept-button:hover::before {
  opacity: 1;
  transform: translateX(30%) translateY(10%);
}

.decline-button {
  background: rgba(255, 255, 255, 0.15);
  backdrop-filter: blur(10px);
  color: white;
  opacity: 0.85;
}

.decline-button:hover {
  background: rgba(239, 68, 68, 0.3);
  border-color: rgba(239, 68, 68, 0.5);
  opacity: 1;
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(239, 68, 68, 0.3);
}

/* Responsive Design */
@media (max-width: 640px) {
  body {
    padding: 16px;
  }

  .invite-card {
    padding: 20px 16px;
  }

  .invite-actions {
    flex-direction: column;
  }

  .accept-button,
  .decline-button {
    width: 100%;
  }

}`;

  const invitesList = invites.length > 0
    ? `<ul class="invites-list">
      ${invites.map((i) => {
        const remoteTag = i.userInviting.isRemote && i.userInviting.homeLand ? "@" + i.userInviting.homeLand : "";
        const landTag = i.userInviting.isRemote && i.userInviting.homeLand ? " on " + i.userInviting.homeLand : "";
        return `<li class="invite-card">
          <div class="invite-text">
            <strong>${esc(i.userInviting.username)}${esc(remoteTag)}</strong>
            invited you to
            <strong>${esc(i.rootId.name)}${esc(landTag)}</strong>
          </div>
          <div class="invite-actions">
            <form method="POST" action="/api/v1/user/${userId}/invites/${i._id}${tokenQS}">
              <input type="hidden" name="accept" value="true" />
              <button type="submit" class="accept-button">Accept</button>
            </form>
            <form method="POST" action="/api/v1/user/${userId}/invites/${i._id}${tokenQS}">
              <input type="hidden" name="accept" value="false" />
              <button type="submit" class="decline-button">Decline</button>
            </form>
          </div>
        </li>`;
      }).join("")}
    </ul>`
    : `<div class="empty-state">
      <div class="empty-state-icon">\uD83D\uDCEC</div>
      <div class="empty-state-text">No pending invites</div>
    </div>`;

  const body = `
  <div class="container">
    <div class="back-nav">
      <a href="/api/v1/user/${userId}${tokenQS}" class="back-link">
        \u2190 Back to Profile
      </a>
    </div>
    <div class="header">
      <h1>Invites</h1>
      <div class="header-subtitle">Join other people's trees</div>
    </div>
    ${invitesList}
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

    // Observe all invite cards
    document.querySelectorAll('.invite-card').forEach(card => {
      observer.observe(card);
    });`;

  return page({
    title: "Invites",
    css,
    body,
    js,
  });
}
