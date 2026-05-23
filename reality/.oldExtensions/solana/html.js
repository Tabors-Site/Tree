/* ------------------------------------------------- */
/* HTML renderers for solana wallet pages              */
/* ------------------------------------------------- */

import { baseStyles } from "../html-rendering/html/baseStyles.js";

export function renderSolanaNoWallet({
  nodeId,
  parsedVersion,
  queryString,
  token,
}) {
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="theme-color" content="#667eea">
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
  <title>Solana Wallet — Version ${parsedVersion}</title>
  <style>
${baseStyles}

/* =========================================================
   UNIFIED GLASS BUTTON SYSTEM
   ========================================================= */

.glass-btn,
button,
.back-link,
.create-button {
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
  font-weight: 500;
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
.back-link::before,
.create-button::before {
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
.back-link:hover,
.create-button:hover {
  background: rgba(var(--glass-water-rgb), var(--glass-alpha-hover));
  transform: translateY(-1px);
  animation: waterDrift 2.2s ease-in-out infinite alternate;
}

.glass-btn:hover::before,
button:hover::before,
.back-link:hover::before,
.create-button:hover::before {
  opacity: 1;
  transform: translateX(30%) translateY(10%);
}

/* Active press */
.glass-btn:active,
button:active,
.create-button:active {
  background: rgba(var(--glass-water-rgb), 0.45);
  transform: translateY(0);
  animation: none;
}

@keyframes waterDrift {
  0% { transform: translateY(-1px); }
  100% { transform: translateY(1px); }
}

/* Button variants */
.create-button {
  --glass-alpha: 0.34;
  --glass-alpha-hover: 0.46;
  font-weight: 600;
  padding: 14px 32px;
  font-size: 16px;
}

/* =========================================================
   CONTENT CARDS
   ========================================================= */

.header,
.empty-state {
  background: rgba(255, 255, 255, 0.15);
  backdrop-filter: blur(22px) saturate(140%);
  -webkit-backdrop-filter: blur(22px) saturate(140%);
  border-radius: 14px;
  padding: 28px;
  border: 1px solid rgba(255, 255, 255, 0.28);
  color: white;
  margin-bottom: 24px;
}

.header h1 {
  font-size: 28px;
  font-weight: 600;
  letter-spacing: -0.5px;
  line-height: 1.3;
  margin-bottom: 8px;
  text-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
  color: white;
}

.version-badge {
  display: inline-block;
  padding: 6px 14px;
  background: rgba(255, 255, 255, 0.25);
  backdrop-filter: blur(10px);
  color: white;
  border-radius: 20px;
  font-size: 14px;
  font-weight: 600;
  margin-top: 8px;
  border: 1px solid rgba(255, 255, 255, 0.3);
}

.empty-state {
  padding: 60px 40px;
  text-align: center;
}

.empty-state-icon {
  font-size: 64px;
  margin-bottom: 16px;
}

.empty-state-text {
  font-size: 18px;
  color: rgba(255, 255, 255, 0.9);
  margin-bottom: 24px;
}

/* =========================================================
   NAV
   ========================================================= */

.back-nav {
  display: flex;
  gap: 12px;
  margin-bottom: 20px;
  flex-wrap: wrap;
}

/* =========================================================
   RESPONSIVE
   ========================================================= */

@media (max-width: 640px) {
  body {
    padding: 16px;
  }

  .container {
    max-width: 100%;
  }

  .header,
  .empty-state {
    padding: 20px;
  }

  .header h1 {
    font-size: 24px;
  }

  .empty-state {
    padding: 40px 24px;
  }

  .back-nav {
    flex-direction: column;
  }

  .back-link {
    width: 100%;
    justify-content: center;
  }
}
  </style>
</head>
<body>
  <div class="container">
    <div class="back-nav">
      <a href="/api/v1/root/${nodeId}${queryString}" class="back-link">← Back to Tree</a>
      <a href="/api/v1/node/${nodeId}/${parsedVersion}/values${queryString}" class="back-link">Back to Values</a>
    </div>

    <div class="header">
      <h1>🪙 Solana Wallet</h1>
      <span class="version-badge">Version ${parsedVersion}</span>
    </div>

    <div class="empty-state">
      <div class="empty-state-icon">👛</div>
      <div class="empty-state-text">No wallet exists for this version</div>
      <form method="POST" action="/api/v1/node/${nodeId}/${parsedVersion}/values/solana?token=${token}&html">
        <button type="submit" class="create-button">Create Wallet</button>
      </form>
    </div>
  </div>
</body>
</html>
`;
}

export function renderSolanaWallet({
  nodeId,
  parsedVersion,
  queryString,
  token,
  walletInfo,
  successMsg,
  errorMsg,
}) {
  const alertsHtml = [
    successMsg
      ? `
      <div class="alert alert-success">
        <strong>Swap successful!</strong><br/>
        ${
          successMsg.sig
            ? `<a href="https://solscan.io/tx/${successMsg.sig}" target="_blank">
                View transaction
              </a>`
            : ""
        }
      </div>
    `
      : "",
    errorMsg
      ? `
      <div class="alert alert-error">
        <strong>Transaction failed:</strong><br/>
        ${errorMsg}
      </div>
    `
      : "",
  ].join("");

  const tokensHtml = walletInfo.tokens?.length
    ? `
        <table>
          <thead>
            <tr>
              <th>Token</th>
              <th>Amount</th>
              <th>USD Value</th>
            </tr>
          </thead>
          <tbody>
            ${walletInfo.tokens
              .map(
                (t) => `
              <tr>
                <td>
                  <a href="https://solscan.io/token/${
                    t.mint
                  }" target="_blank" rel="noopener noreferrer" style="text-decoration: none;">
                    <span class="token-mint">${t.mint.slice(
                      0,
                      6,
                    )}…${t.mint.slice(-4)}</span>
                  </a>
                </td>
                <td>${Number(t.uiAmount)
                  .toFixed(6)
                  .replace(/\.?0+$/, "")}</td>
                <td>${t.usd != null ? `$${t.usd.toFixed(2)}` : "—"}</td>
              </tr>
            `,
              )
              .join("")}
          </tbody>
        </table>
      `
    : `<div class="empty-tokens">No SPL tokens found</div>`;

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="theme-color" content="#667eea">
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
  <title>Solana Wallet — Version ${parsedVersion}</title>
  <style>
${baseStyles}

/* =========================================================
   UNIFIED GLASS BUTTON SYSTEM
   ========================================================= */

.glass-btn,
button,
.back-link,
.external-link {
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
  font-weight: 500;
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
.back-link::before,
.external-link::before {
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
.back-link:hover,
.external-link:hover {
  background: rgba(var(--glass-water-rgb), var(--glass-alpha-hover));
  transform: translateY(-1px);
  animation: waterDrift 2.2s ease-in-out infinite alternate;
}

.glass-btn:hover::before,
button:hover::before,
.back-link:hover::before,
.external-link:hover::before {
  opacity: 1;
  transform: translateX(30%) translateY(10%);
}

/* Active press */
.glass-btn:active,
button:active,
.external-link:active {
  background: rgba(var(--glass-water-rgb), 0.45);
  transform: translateY(0);
  animation: none;
}

@keyframes waterDrift {
  0% { transform: translateY(-1px); }
  100% { transform: translateY(1px); }
}

/* Button variants */
button[type="submit"] {
  --glass-alpha: 0.34;
  --glass-alpha-hover: 0.46;
  font-weight: 600;
  padding: 14px 24px;
  width: 100%;
  margin-top: 8px;
}

.external-link {
  padding: 8px 16px;
  font-size: 13px;
}

/* =========================================================
   CONTENT CARDS
   ========================================================= */

.header,
.card {
  background: rgba(255, 255, 255, 0.15);
  backdrop-filter: blur(22px) saturate(140%);
  -webkit-backdrop-filter: blur(22px) saturate(140%);
  border-radius: 14px;
  padding: 28px;
  border: 1px solid rgba(255, 255, 255, 0.28);
  color: white;
  margin-bottom: 24px;
}

.card {
  padding: 24px;
  margin-bottom: 16px;
}

.header h1 {
  font-size: 28px;
  font-weight: 600;
  letter-spacing: -0.5px;
  line-height: 1.3;
  margin-bottom: 8px;
  text-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
  color: white;
}

.card h3 {
  font-size: 18px;
  font-weight: 600;
  margin-bottom: 16px;
  color: white;
  letter-spacing: -0.3px;
  text-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
}

.version-badge {
  display: inline-block;
  padding: 6px 14px;
  background: rgba(255, 255, 255, 0.25);
  backdrop-filter: blur(10px);
  color: white;
  border-radius: 20px;
  font-size: 14px;
  font-weight: 600;
  margin-top: 8px;
  border: 1px solid rgba(255, 255, 255, 0.3);
}

/* =========================================================
   NAV
   ========================================================= */

.back-nav {
  display: flex;
  gap: 12px;
  margin-bottom: 20px;
  flex-wrap: wrap;
}

/* =========================================================
   WALLET COMPONENTS
   ========================================================= */

.address-box {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 12px;
  flex-wrap: wrap;
}

.address-code {
  flex: 1;
  min-width: 0;
  background: rgba(255, 255, 255, 0.2);
  padding: 12px 16px;
  border-radius: 10px;
  font-family: 'SF Mono', Monaco, 'Cascadia Code', monospace;
  font-size: 13px;
  color: white;
  word-break: break-all;
  font-weight: 600;
  border: 1px solid rgba(255, 255, 255, 0.3);
}

.balance-display {
  margin-top: 20px;
  padding: 20px;
  background: rgba(255, 255, 255, 0.15);
  border-radius: 12px;
  border: 2px solid rgba(255, 255, 255, 0.3);
}

.balance-label {
  font-size: 14px;
  color: rgba(255, 255, 255, 0.8);
  margin-bottom: 6px;
}

.balance-amount {
  font-size: 32px;
  font-weight: 700;
  color: white;
}

/* =========================================================
   TABLES
   ========================================================= */

table {
  width: 100%;
  margin-top: 16px;
  border-collapse: separate;
  border-spacing: 0;
  background: rgba(255, 255, 255, 0.1);
  border-radius: 8px;
  overflow: hidden;
}

th {
  text-align: left;
  font-size: 13px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.8);
  padding: 12px 8px;
  border-bottom: 2px solid rgba(255, 255, 255, 0.2);
  background: rgba(255, 255, 255, 0.15);
}

td {
  padding: 14px 8px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
  font-size: 14px;
  color: white;
}

tr:last-child td {
  border-bottom: none;
}

tbody tr {
  transition: background 0.2s;
}

tbody tr:hover {
  background: rgba(255, 255, 255, 0.05);
}

.token-mint {
  font-family: 'SF Mono', Monaco, monospace;
  font-size: 12px;
  color: white;
  font-weight: 600;
}

.token-mint:hover {
  opacity: 0.8;
}

.empty-tokens {
  text-align: center;
  padding: 40px 20px;
  color: rgba(255, 255, 255, 0.7);
  font-style: italic;
}

/* =========================================================
   FORMS
   ========================================================= */

.form-group {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.form-row {
  display: flex;
  gap: 10px;
  align-items: stretch;
}

input,
select {
  padding: 12px 16px;
  border-radius: 10px;
  border: 1px solid rgba(255, 255, 255, 0.3);
  font-size: 15px;
  font-family: inherit;
  transition: all 0.2s;
  background: rgba(255, 255, 255, 0.2);
  color: white;
}

input::placeholder {
  color: rgba(255, 255, 255, 0.6);
}

input:focus,
select:focus {
  outline: none;
  border-color: rgba(255, 255, 255, 0.5);
  background: rgba(255, 255, 255, 0.25);
  box-shadow: 0 0 0 3px rgba(255, 255, 255, 0.1);
}

select {
  appearance: none;
  background-image: url("data:image/svg+xml,%3Csvg width='12' height='8' viewBox='0 0 12 8' fill='none' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M1 1L6 6L11 1' stroke='white' stroke-width='2' stroke-linecap='round'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 12px center;
  padding-right: 36px;
}

.swap-arrow {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 12px;
  font-size: 20px;
  color: white;
  font-weight: 700;
}

.info-box {
  margin-top: 16px;
  padding: 16px;
  background: rgba(255, 193, 7, 0.2);
  border-left: 4px solid #ffa500;
  border-radius: 8px;
  font-size: 14px;
  line-height: 1.6;
  color: rgba(255, 255, 255, 0.9);
}

.info-box strong {
  color: white;
}

.swap-container {
  background: rgba(255, 255, 255, 0.1);
  border-radius: 12px;
  padding: 20px;
  margin-top: 8px;
}

.swap-input-group {
  background: rgba(255, 255, 255, 0.15);
  padding: 16px;
  border-radius: 10px;
  margin-bottom: 12px;
  border: 1px solid rgba(255, 255, 255, 0.2);
}

.swap-label {
  font-size: 12px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.8);
  margin-bottom: 8px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

/* =========================================================
   ALERTS
   ========================================================= */

.alert {
  padding: 12px 14px;
  border-radius: 10px;
  margin-bottom: 16px;
  font-size: 14px;
  border: 1px solid;
}

.alert-success {
  background: rgba(16, 185, 129, 0.2);
  border-color: rgba(16, 185, 129, 0.5);
  color: white;
}

.alert-error {
  background: rgba(239, 68, 68, 0.2);
  border-color: rgba(239, 68, 68, 0.5);
  color: white;
}

.alert strong {
  font-weight: 600;
}

.alert a {
  color: white;
  text-decoration: underline;
}

/* =========================================================
   RESPONSIVE
   ========================================================= */

@media (max-width: 640px) {
  body {
    padding: 16px;
  }

  .container {
    max-width: 100%;
  }

  .header,
  .card {
    padding: 20px;
  }

  .header h1 {
    font-size: 24px;
  }

  .balance-amount {
    font-size: 24px;
  }

  .back-nav {
    flex-direction: column;
  }

  .back-link {
    width: 100%;
    justify-content: center;
  }

  .address-box {
    flex-direction: column;
  }

  .external-link {
    width: 100%;
    text-align: center;
  }

  .form-row {
    flex-direction: column;
  }

  .swap-arrow {
    transform: rotate(90deg);
  }

  table {
    font-size: 12px;
  }

  th,
  td {
    padding: 10px 6px;
  }
}
  </style>
</head>
<body>
  <div class="container">
${alertsHtml}

    <div class="back-nav">
      <a href="/api/v1/root/${nodeId}${queryString}" class="back-link">← Back to Tree</a>
      <a href="/api/v1/node/${nodeId}/${parsedVersion}/values${queryString}" class="back-link">Back to Values</a>
    </div>

    <div class="header">
      <h1>🪙 Solana Wallet</h1>
      <span class="version-badge">Version ${parsedVersion}</span>
    </div>

    <!-- Wallet Address -->
    <div class="card">
      <h3>Wallet Address</h3>
      <div class="address-box">
        <div class="address-code">${walletInfo.publicKey}</div>
        <a href="https://solscan.io/account/${
          walletInfo.publicKey
        }" target="_blank" rel="noopener noreferrer" class="external-link">
          View on Solscan →
        </a>
      </div>

      <div class="balance-display">
        <div class="balance-label">SOL Balance</div>
        <div class="balance-amount">${(walletInfo.solBalance / 1e9).toFixed(
          4,
        )} SOL</div>
      </div>
    </div>

    <!-- Token Balances -->
    <div class="card">
      <h3>Token Balances</h3>
      ${tokensHtml}
    </div>

    <!-- Send SOL -->
    <div class="card">
      <h3>💸 Send SOL</h3>
      <form method="POST" action="/api/v1/node/${nodeId}/${parsedVersion}/values/solana/send?token=${token}&html">
        <div class="form-group">
          <input type="text" name="destination" placeholder="Destination address or node ID" required />
          <input type="number" name="amount" step="any" min="0" placeholder="Amount in SOL" required />
          <button type="submit">Send SOL</button>
        </div>
      </form>
      <div class="info-box">
        <strong>Transaction Fee:</strong> Each transaction requires a small network fee. Minimum balance of 0.001 SOL recommended. New wallets require 0.0009 SOL rent-exempt minimum.
      </div>
    </div>

    <!-- Swap -->
    <div class="card">
      <h3>🔄 Swap Tokens</h3>
      <form method="POST" action="/api/v1/node/${nodeId}/${parsedVersion}/values/solana/transaction?token=${token}&html">
        <div class="swap-container">
          <div class="swap-input-group">
            <div class="swap-label">From</div>
            <div class="form-row">
              <select name="fromType" id="fromType" required style="flex: 1;">
                <option value="sol">SOL</option>
                <option value="token">Token</option>
              </select>
              <input type="number" name="amount" step="any" min="0" placeholder="Amount" required style="flex: 2;" />
            </div>
            <input type="text" name="inputMint" id="fromTokenMint" placeholder="Token Mint Address" style="display:none; margin-top: 8px;" />
          </div>

          <div class="swap-arrow">↓</div>

          <div class="swap-input-group">
            <div class="swap-label">To</div>
            <div class="form-row">
              <select name="toType" id="toType" required style="flex: 1;">
                <option value="token">Token</option>
                <option value="sol">SOL</option>
              </select>
              <input type="text" name="outputMint" id="toTokenMint" placeholder="Token Mint Address" style="flex: 2;" />
            </div>
          </div>
        </div>

        <button type="submit">Execute Swap</button>
      </form>

    </div>
  </div>

  <script>
    const fromType = document.getElementById("fromType");
    const toType = document.getElementById("toType");
    const fromTokenMint = document.getElementById("fromTokenMint");
    const toTokenMint = document.getElementById("toTokenMint");
    const SOL_MINT = "So11111111111111111111111111111111111111112";

    function updateSwapFields() {
      // Prevent SOL -> SOL
      if (fromType.value === "sol" && toType.value === "sol") {
        toType.value = "token";
      }

      // FROM field
      if (fromType.value === "token") {
        fromTokenMint.style.display = "block";
        fromTokenMint.required = true;
        if (fromTokenMint.value === SOL_MINT) {
          fromTokenMint.value = "";
        }
      } else {
        fromTokenMint.style.display = "none";
        fromTokenMint.required = false;
        fromTokenMint.value = SOL_MINT;
      }

      // TO field
      if (toType.value === "token") {
        toTokenMint.style.display = "block";
        toTokenMint.required = true;
        if (toTokenMint.value === SOL_MINT) {
          toTokenMint.value = "";
        }
      } else {
        toTokenMint.style.display = "none";
        toTokenMint.required = false;
        toTokenMint.value = SOL_MINT;
      }
    }

    fromType.addEventListener("change", updateSwapFields);
    toType.addEventListener("change", updateSwapFields);
    updateSwapFields();
  </script>
</body>
</html>
`;
}
