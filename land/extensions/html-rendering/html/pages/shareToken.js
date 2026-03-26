import { page } from "../layout.js";
import { esc } from "../utils.js";
import { getLandUrl } from "../../../../canopy/identity.js";

export function renderShareToken({ userId, user, token, tokenQS }) {
  const css = `
body {
  display: flex;
  align-items: center;
  justify-content: center;
}


.container {
  max-width: 600px;
  width: 100%;
  position: relative;
  z-index: 1;
}

/* Glass Card */
.card {
  position: relative;
  overflow: hidden;
  background: rgba(var(--glass-water-rgb), var(--glass-alpha));
  backdrop-filter: blur(22px) saturate(140%);
  -webkit-backdrop-filter: blur(22px) saturate(140%);
  border-radius: 24px;
  padding: 48px;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.2),
    inset 0 1px 0 rgba(255, 255, 255, 0.25);
  border: 1px solid rgba(255, 255, 255, 0.28);
  color: white;
  animation: fadeInUp 0.6s ease-out;
}

.card::before {
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

.card:hover::before {
  opacity: 1;
  transform: translateX(30%) translateY(10%);
}

/* Header */
.header {
  text-align: center;
  margin-bottom: 32px;
}

.icon {
  font-size: 64px;
  margin-bottom: 20px;
  display: inline-block;
  filter: drop-shadow(0 4px 12px rgba(0, 0, 0, 0.2));
  animation: bounce 2s infinite;
}

@keyframes bounce {
  0%, 100% {
    transform: translateY(0);
  }
  50% {
    transform: translateY(-10px);
  }
}

h1 {
  font-size: 32px;
  font-weight: 600;
  color: white;
  margin-bottom: 8px;
  letter-spacing: -0.5px;
  text-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
}

.username {
  font-size: 16px;
  color: rgba(255, 255, 255, 0.85);
  font-weight: 500;
}

/* Description */
.description {
  color: rgba(255, 255, 255, 0.9);
  line-height: 1.6;
  margin-bottom: 28px;
  font-size: 15px;
  text-align: center;
}

/* Welcome Box */
.welcome-box {
  background: rgba(255, 255, 255, 0.15);
  backdrop-filter: blur(10px);
  padding: 24px;
  border-radius: 16px;
  margin-bottom: 28px;
  border: 1px solid rgba(255, 255, 255, 0.25);
}

.welcome-title {
  font-size: 18px;
  font-weight: 600;
  color: white;
  margin-bottom: 12px;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.2);
}

.welcome-text {
  color: rgba(255, 255, 255, 0.9);
  line-height: 1.6;
  font-size: 15px;
}

/* Token Section */
.token-section {
  margin-bottom: 28px;
}

.token-label {
  font-size: 13px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.85);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin-bottom: 10px;
}

.token-display {
  display: flex;
  align-items: center;
  gap: 12px;
  background: rgba(255, 255, 255, 0.15);
  backdrop-filter: blur(10px);
  padding: 16px 20px;
  border-radius: 12px;
  border: 1px solid rgba(255, 255, 255, 0.25);
  transition: all 0.3s;
}

.token-display:hover {
  border-color: rgba(255, 255, 255, 0.4);
  background: rgba(255, 255, 255, 0.2);
}

.token-text {
  flex: 1;
  font-family: 'SF Mono', Monaco, 'Cascadia Code', monospace;
  font-size: 14px;
  color: white;
  word-break: break-all;
  font-weight: 500;
}

.btn-copy {
  padding: 8px 16px;
  background: rgba(255, 255, 255, 0.25);
  color: white;
  border: 1px solid rgba(255, 255, 255, 0.3);
  border-radius: 980px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.3s;
  flex-shrink: 0;
}

.btn-copy:hover {
  background: rgba(255, 255, 255, 0.35);
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
}

/* Form Section */
.form-section {
  background: rgba(255, 255, 255, 0.1);
  backdrop-filter: blur(10px);
  padding: 24px;
  border-radius: 16px;
  border: 1px solid rgba(255, 255, 255, 0.2);
  margin-bottom: 24px;
}

.form-title {
  font-size: 16px;
  font-weight: 600;
  color: white;
  margin-bottom: 16px;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.2);
}

.form-row {
  display: flex;
  gap: 12px;
}

input {
  flex: 1;
  padding: 14px 18px;
  border-radius: 12px;
  border: 1px solid rgba(255, 255, 255, 0.25);
  font-size: 15px;
  font-family: 'SF Mono', Monaco, monospace;
  transition: all 0.3s;
  background: rgba(255, 255, 255, 0.15);
  backdrop-filter: blur(10px);
  color: white;
  font-weight: 500;
}

input::placeholder {
  color: rgba(255, 255, 255, 0.5);
}

input:focus {
  outline: none;
  border-color: rgba(255, 255, 255, 0.4);
  background: rgba(255, 255, 255, 0.2);
  box-shadow: 0 0 0 4px rgba(255, 255, 255, 0.1);
}

.btn-submit {
  padding: 14px 28px;
  border-radius: 980px;
  border: 1px solid rgba(255, 255, 255, 0.3);
  background: rgba(255, 255, 255, 0.3);
  backdrop-filter: blur(10px);
  color: white;
  font-weight: 600;
  font-size: 15px;
  cursor: pointer;
  transition: all 0.3s;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  flex-shrink: 0;
  position: relative;
  overflow: hidden;
}

.btn-submit::before {
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

.btn-submit:hover {
  background: rgba(255, 255, 255, 0.4);
  transform: translateY(-2px);
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.2);
}

.btn-submit:hover::before {
  opacity: 1;
  transform: translateX(30%) translateY(10%);
}

/* Info Box */
.info-box {
  background: rgba(255, 255, 255, 0.1);
  backdrop-filter: blur(10px);
  padding: 14px 18px;
  border-radius: 12px;
  border-left: 3px solid rgba(255, 255, 255, 0.5);
  margin-bottom: 24px;
}

.info-box-content {
  font-size: 14px;
  color: rgba(255, 255, 255, 0.85);
  line-height: 1.6;
}

/* Back Links */
.back-links {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.back-link {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 12px 20px;
  text-decoration: none;
  color: white;
  font-weight: 600;
  font-size: 14px;
  background: rgba(255, 255, 255, 0.15);
  backdrop-filter: blur(10px);
  border-radius: 980px;
  transition: all 0.3s;
  border: 1px solid rgba(255, 255, 255, 0.25);
}

.back-link:hover {
  background: rgba(255, 255, 255, 0.25);
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
}

/* Responsive */
@media (max-width: 640px) {
  body {
    padding: 16px;
    align-items: flex-start;
    padding-top: 40px;
  }

  .card {
    padding: 32px 24px;
  }

  h1 {
    font-size: 28px;
  }

  .icon {
    font-size: 56px;
  }

  .form-row {
    flex-direction: column;
  }

  .btn-submit {
    width: 100%;
  }

  .token-display {
    flex-direction: column;
    align-items: stretch;
  }

  .btn-copy {
    width: 100%;
  }
}`;

  const body = `
  <div class="container">
    <div class="card">
      <!-- Header -->
      <div class="header">
        <div class="icon">\uD83D\uDD10</div>
        <h1>Share Token</h1>
        <div class="username">@${user.username}</div>
      </div>

      ${
        token
          ? `
          <!-- Existing Token View -->
          <div class="description">
            Share read-only access to your content.
          </div>

          <div class="token-section">
            <div class="token-label">Your Token</div>
            <div class="token-display">
              <div class="token-text" id="tokenText">${esc(token)}</div>
              <button class="btn-copy" onclick="copyToken()">Copy</button>
            </div>
          </div>

          <div class="info-box">
            <div class="info-box-content">
              Change your token anytime to revoke shared URL access.
            </div>
          </div>

          <div class="form-section">
            <div class="form-title">Update Token</div>
            <form method="POST" action="/api/v1/user/${userId}/shareToken${tokenQS}">
              <div class="form-row">
                <input
                  name="htmlShareToken"
                  placeholder="Enter new token"
                  required
                />
                <button type="submit" class="btn-submit">Update</button>
              </div>
            </form>
          </div>
        `
          : `
          <!-- First Time View -->
          <div class="welcome-box">
            <div class="welcome-title">Create a Share Token</div>
            <div class="welcome-text">
              Share read-only access to your trees and notes. Change it anytime to revoke old links.
            </div>
          </div>

          <div class="form-section">
            <div class="form-title">Choose Your Token</div>
            <form method="POST" action="/api/v1/user/${userId}/shareToken${tokenQS}">
              <div class="form-row">
                <input
                  name="htmlShareToken"
                  placeholder="Enter a unique token"
                  required
                />
                <button type="submit" class="btn-submit">Create</button>
              </div>
            </form>
          </div>
        `
      }

      <div class="back-links">
        <a class="back-link" href="/api/v1/user/${userId}${tokenQS}">
          \u2190 Back to Profile
        </a>
        <a class="back-link" target="_top" href="/">
          \u2190 Back to ${new URL(getLandUrl()).hostname}
        </a>
      </div>
    </div>
  </div>`;

  const js = `
    function copyToken() {
      const tokenText = document.getElementById('tokenText').textContent;
      navigator.clipboard.writeText(tokenText).then(() => {
        const btn = document.querySelector('.btn-copy');
        const originalText = btn.textContent;
        btn.textContent = '\u2713 Copied';
        setTimeout(() => {
          btn.textContent = originalText;
        }, 2000);
      });
    }`;

  return page({
    title: `Share Token \u2014 @${esc(user.username)}`,
    css,
    body,
    js,
  });
}
