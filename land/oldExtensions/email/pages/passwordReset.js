import { page } from "../../html-rendering/html/layout.js";
import { esc } from "../../html-rendering/html/utils.js";
import { baseStyles } from "../../html-rendering/html/baseStyles.js";

// All password reset functions use bare: true because they have a completely different layout

export function renderResetPasswordExpired() {
  const css = `
${baseStyles}

body {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
}


    @keyframes fadeInDown {
      from { opacity: 0; transform: translateY(-30px); }
      to { opacity: 1; transform: translateY(0); }
    }

    @keyframes slideUp {
      from { opacity: 0; transform: translateY(30px); }
      to { opacity: 1; transform: translateY(0); }
    }

    .brand-header {
      position: relative; z-index: 1;
      margin-bottom: 32px; text-align: center;
      animation: fadeInDown 0.8s ease-out;
    }

    .brand-logo {
      font-size: 80px; margin-bottom: 16px; display: inline-block;
      filter: drop-shadow(0 8px 32px rgba(0,0,0,0.2));
      animation: fadeInDown 0.5s ease-out both, grow 4.5s ease-in-out infinite;
    }

    @keyframes grow {
      0%, 100% { transform: scale(1); }
      50% { transform: scale(1.06); }
    }

    .brand-title {
      font-size: 56px; font-weight: 600; color: white;
      text-shadow: 0 2px 8px rgba(0,0,0,0.2);
      letter-spacing: -1.5px; margin-bottom: 8px;
    }

    .container {
      background: rgba(var(--glass-water-rgb), var(--glass-alpha));
      backdrop-filter: blur(22px) saturate(140%);
      -webkit-backdrop-filter: blur(22px) saturate(140%);
      padding: 48px;
      border-radius: 16px;
      width: 100%; max-width: 460px;
      box-shadow: 0 8px 32px rgba(0,0,0,0.12), inset 0 1px 0 rgba(255,255,255,0.25);
      border: 1px solid rgba(255,255,255,0.28);
      text-align: center;
      position: relative; z-index: 1;
      animation: slideUp 0.6s ease-out 0.2s both;
    }

    h2 {
      font-size: 32px; font-weight: 600; color: white;
      margin-bottom: 12px;
      text-shadow: 0 2px 8px rgba(0,0,0,0.2);
    }

    .subtitle {
      font-size: 15px; color: rgba(255,255,255,0.85);
      margin-bottom: 24px; line-height: 1.5;
    }

    .back-btn {
      display: inline-block;
      width: 100%;
      padding: 14px;
      margin-top: 16px;
      border-radius: 980px;
      border: 1px solid rgba(255,255,255,0.3);
      background: rgba(255,255,255,0.25);
      backdrop-filter: blur(10px);
      color: white;
      font-size: 16px; font-weight: 600;
      cursor: pointer;
      transition: all 0.3s;
      text-decoration: none;
      text-align: center;
      font-family: inherit;
    }

    .back-btn:hover {
      background: rgba(255,255,255,0.35);
      transform: translateY(-2px);
      box-shadow: 0 6px 20px rgba(0,0,0,0.18);
    }

    @media (max-width: 640px) {
      .brand-logo { font-size: 64px; }
      .brand-title { font-size: 42px; }
      .container { padding: 32px 24px; }
      h2 { font-size: 28px; }
    }`;

  const body = `
  <div class="brand-header">
    <a href="/" style="text-decoration: none;">
      <div class="brand-logo">\uD83C\uDF33</div>
      <h1 class="brand-title">TreeOS</h1>
    </a>
  </div>

  <div class="container">
    <h2>Link Expired</h2>
    <p class="subtitle">This reset link is invalid or has expired. Please request a new password reset.</p>
    <a href="/login" class="back-btn">\u2190 Back to Login</a>
  </div>`;

  return page({
    title: "TreeOS - Link Expired",
    css,
    body,
    bare: true,
  });
}

export function renderResetPasswordForm({ token }) {
  const css = `
${baseStyles}

body {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
}


    @keyframes fadeInDown {
      from { opacity: 0; transform: translateY(-30px); }
      to { opacity: 1; transform: translateY(0); }
    }

    @keyframes slideUp {
      from { opacity: 0; transform: translateY(30px); }
      to { opacity: 1; transform: translateY(0); }
    }

    @keyframes spin { to { transform: rotate(360deg); } }

    .brand-header {
      position: relative; z-index: 1;
      margin-bottom: 32px; text-align: center;
      animation: fadeInDown 0.8s ease-out;
    }

    .brand-logo {
      font-size: 80px; margin-bottom: 16px; display: inline-block;
      filter: drop-shadow(0 8px 32px rgba(0,0,0,0.2));
      animation: fadeInDown 0.5s ease-out both, grow 4.5s ease-in-out infinite;
    }

    @keyframes grow {
      0%, 100% { transform: scale(1); }
      50% { transform: scale(1.06); }
    }

    .brand-title {
      font-size: 56px; font-weight: 600; color: white;
      text-shadow: 0 2px 8px rgba(0,0,0,0.2);
      letter-spacing: -1.5px; margin-bottom: 8px;
    }

    .container {
      background: rgba(var(--glass-water-rgb), var(--glass-alpha));
      backdrop-filter: blur(22px) saturate(140%);
      -webkit-backdrop-filter: blur(22px) saturate(140%);
      padding: 48px;
      border-radius: 16px;
      width: 100%; max-width: 460px;
      box-shadow: 0 8px 32px rgba(0,0,0,0.12), inset 0 1px 0 rgba(255,255,255,0.25);
      border: 1px solid rgba(255,255,255,0.28);
      text-align: center;
      position: relative; z-index: 1;
      animation: slideUp 0.6s ease-out 0.2s both;
    }

    h2 {
      font-size: 32px; font-weight: 600; color: white;
      margin-bottom: 8px;
      text-shadow: 0 2px 8px rgba(0,0,0,0.2);
    }

    .subtitle {
      font-size: 15px; color: rgba(255,255,255,0.85);
      margin-bottom: 32px; line-height: 1.5;
    }

    .input-group {
      margin-bottom: 16px;
      text-align: left;
    }

    label {
      display: block;
      font-size: 14px; font-weight: 600; color: white;
      margin-bottom: 8px;
      text-shadow: 0 1px 3px rgba(0,0,0,0.2);
    }

    input {
      width: 100%;
      padding: 14px 18px;
      border-radius: 12px;
      border: 2px solid rgba(255,255,255,0.3);
      font-size: 16px;
      transition: all 0.3s cubic-bezier(0.4,0,0.2,1);
      background: rgba(255,255,255,0.15);
      backdrop-filter: blur(20px) saturate(150%);
      -webkit-backdrop-filter: blur(20px) saturate(150%);
      font-family: inherit;
      color: white;
      font-weight: 500;
      box-shadow: 0 4px 20px rgba(0,0,0,0.1), inset 0 1px 0 rgba(255,255,255,0.25);
    }

    input:focus {
      outline: none;
      border-color: rgba(255,255,255,0.6);
      background: rgba(255,255,255,0.25);
      box-shadow: 0 0 0 4px rgba(255,255,255,0.15), 0 8px 30px rgba(0,0,0,0.15), inset 0 1px 0 rgba(255,255,255,0.4);
      transform: translateY(-2px);
    }

    input::placeholder {
      color: rgba(255,255,255,0.5);
      font-weight: 400;
    }

    input.error {
      border-color: rgba(239,68,68,0.6);
      background: rgba(239,68,68,0.1);
    }

    .password-hint {
      font-size: 12px;
      color: rgba(255,255,255,0.7);
      margin-top: 6px;
      text-align: left;
    }

    button {
      width: 100%;
      padding: 16px;
      margin-top: 8px;
      border-radius: 980px;
      border: 1px solid rgba(255,255,255,0.3);
      background: rgba(255,255,255,0.25);
      backdrop-filter: blur(10px);
      color: white;
      font-size: 16px; font-weight: 600;
      cursor: pointer;
      transition: all 0.3s;
      box-shadow: 0 4px 12px rgba(0,0,0,0.12);
      font-family: inherit;
      position: relative;
      overflow: hidden;
    }

    button:hover {
      background: rgba(255,255,255,0.35);
      transform: translateY(-2px);
      box-shadow: 0 6px 20px rgba(0,0,0,0.18);
    }

    button:active { transform: translateY(0); }

    button.loading {
      color: transparent;
      pointer-events: none;
    }

    button.loading::after {
      content: '';
      position: absolute;
      width: 20px; height: 20px;
      top: 50%; left: 50%;
      margin-left: -10px; margin-top: -10px;
      border: 3px solid rgba(255,255,255,0.3);
      border-radius: 50%;
      border-top-color: white;
      animation: spin 0.8s linear infinite;
    }

    .message {
      margin-top: 16px;
      padding: 12px 16px;
      border-radius: 10px;
      font-size: 14px; font-weight: 600;
      text-align: left;
      display: none;
    }

    .error-message {
      color: white;
      background: rgba(239,68,68,0.3);
      backdrop-filter: blur(10px);
      border: 1px solid rgba(239,68,68,0.4);
    }

    .success-message {
      color: white;
      background: rgba(16,185,129,0.3);
      backdrop-filter: blur(10px);
      border: 1px solid rgba(16,185,129,0.4);
    }

    .message.show { display: block; }

    .back-btn {
      display: inline-block;
      width: 100%;
      padding: 12px;
      margin-top: 16px;
      border-radius: 980px;
      border: 1px solid rgba(255,255,255,0.3);
      background: rgba(255,255,255,0.15);
      color: white;
      font-size: 15px; font-weight: 600;
      cursor: pointer;
      transition: all 0.3s;
      text-decoration: none;
      text-align: center;
    }

    .back-btn:hover {
      background: rgba(255,255,255,0.25);
      transform: translateY(-2px);
    }

    @media (max-width: 640px) {
      .brand-logo { font-size: 64px; }
      .brand-title { font-size: 42px; }
      .container { padding: 32px 24px; }
      h2 { font-size: 28px; }
      input { font-size: 16px; }
    }`;

  const body = `
  <div class="brand-header">
    <a href="/" style="text-decoration: none;">
      <div class="brand-logo">\uD83C\uDF33</div>
      <h1 class="brand-title">TreeOS</h1>
    </a>
  </div>

  <div class="container">
    <h2>Reset Password</h2>
    <p class="subtitle">Enter your new password below</p>

    <form id="resetForm" data-token="${esc(token)}">
      <div class="input-group">
        <label for="password">New Password</label>
        <input
          type="password"
          id="password"
          placeholder="Enter new password"
          required
          autocomplete="new-password"
        />
        <div class="password-hint">Must be at least 8 characters</div>
      </div>

      <div class="input-group">
        <label for="confirm">Confirm Password</label>
        <input
          type="password"
          id="confirm"
          placeholder="Confirm new password"
          required
          autocomplete="new-password"
        />
      </div>

      <button type="submit" id="resetBtn">Reset Password</button>
    </form>

    <div id="errorMessage" class="message error-message"></div>
    <div id="successMessage" class="message success-message">
      \u2713 Password reset successful! Redirecting to login...
    </div>

    <a href="/login" class="back-btn">\u2190 Back to Login</a>
  </div>`;

  const js = `
    const form = document.getElementById("resetForm");
    const passwordInput = document.getElementById("password");
    const confirmInput = document.getElementById("confirm");
    const errorEl = document.getElementById("errorMessage");
    const successEl = document.getElementById("successMessage");
    const btn = document.getElementById("resetBtn");

    confirmInput.addEventListener("input", () => {
      if (confirmInput.value && passwordInput.value !== confirmInput.value) {
        confirmInput.classList.add("error");
      } else {
        confirmInput.classList.remove("error");
      }
    });

    form.addEventListener("submit", async (e) => {
      e.preventDefault();

      const password = passwordInput.value;
      const confirm = confirmInput.value;

      errorEl.classList.remove("show");
      successEl.classList.remove("show");
      passwordInput.classList.remove("error");
      confirmInput.classList.remove("error");

      if (password.length < 8) {
        errorEl.textContent = "Password must be at least 8 characters.";
        errorEl.classList.add("show");
        passwordInput.classList.add("error");
        passwordInput.focus();
        return;
      }

      if (password !== confirm) {
        errorEl.textContent = "Passwords do not match.";
        errorEl.classList.add("show");
        confirmInput.classList.add("error");
        confirmInput.focus();
        return;
      }

      btn.classList.add("loading");
      btn.disabled = true;

      try {
        const res = await fetch("/api/v1/user/reset-password", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token: form.dataset.token, password }),
        });

        const data = await res.json();

        if (!res.ok || data.status === "error") {
          errorEl.textContent = (data.error && data.error.message) || data.message || "Reset failed. Please try again.";
          errorEl.classList.add("show");
          btn.classList.remove("loading");
          btn.disabled = false;
          return;
        }

        successEl.classList.add("show");
        form.style.display = "none";

        setTimeout(() => {
          window.location.href = "/login";
        }, 2000);

      } catch (err) {
        errorEl.textContent = "An error occurred. Please try again.";
        errorEl.classList.add("show");
        btn.classList.remove("loading");
        btn.disabled = false;
      }
    });`;

  return page({
    title: "TreeOS - Reset Password",
    css,
    body,
    js,
    bare: true,
  });
}

export function renderResetPasswordMismatch({ token }) {
  return (`
        <html><body style="font-family:sans-serif; padding:20px;">
        <h2>Passwords Do Not Match</h2>
        <p><a href="/api/v1/user/reset-password/${encodeURIComponent(token)}">Try Again</a></p>
        </body></html>
      `);
}

export function renderResetPasswordInvalid() {
  return (`
        <html><body style="font-family:sans-serif; padding:20px;">
        <h2>Reset Link Expired or Invalid</h2>
        <p>Please request a new password reset.</p>
        </body></html>
      `);
}

export function renderResetPasswordSuccess() {
  return (`
      <html><body style="font-family:sans-serif; padding:20px;">
      <h2>Password Reset Successfully</h2>
      <p>You can now log in with your new password.</p>
      </body></html>
    `);
}
