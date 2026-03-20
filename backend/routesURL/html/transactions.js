/* ─────────────────────────────────────────────── */
/* HTML renderer for transactions pages              */
/* ─────────────────────────────────────────────── */

function normalizeValues(values) {
  if (!values) return {};
  if (values instanceof Map) {
    return Object.fromEntries(values.entries());
  }
  if (typeof values === "object") {
    return values;
  }
  return {};
}

function renderApprovalSummary(summary) {
  if (!summary || summary.length === 0) return "";

  return `
    <div class="approval-summary">
      ${summary
        .map(
          (approval) => `
        <div class="approval-item">
          <span class="approval-label">
            ${approval.isViewerGroup ? "Your Side" : "Counterparty"}:
          </span>
          <span class="approval-badge ${
            approval.resolved ? "resolved" : "pending"
          }">
            ${approval.approved}/${approval.required} approved
          </span>
          <span class="approval-policy">(${approval.policy})</span>
        </div>
      `
        )
        .join("")}
    </div>
  `;
}

/**
 * Render the transactions list page.
 */
export function renderTransactionsList({
  nodeId,
  version,
  nodeName,
  transactions,
  queryString,
}) {
  const parsedVersion = Number(version);

  // Sort transactions: pending first, then by date
  const sortedTransactions = [...transactions].sort((a, b) => {
    if (a.status === "pending" && b.status !== "pending") return -1;
    if (a.status !== "pending" && b.status === "pending") return 1;
    return new Date(b.createdAt) - new Date(a.createdAt);
  });

  const transactionsHtml =
    sortedTransactions.length > 0
      ? `
<ul class="transactions-list">
${sortedTransactions
  .map((tx) => {
    const txHref = `/api/v1/node/${nodeId}/${parsedVersion}/transactions/${tx._id}${queryString}`;

    return `
<li>
  <div
    class="transaction-card ${tx.status}"
    onclick="window.location.href='${txHref}'"
    style="cursor:pointer;"
  >
    <div class="transaction-header">
      <div class="transaction-date">
        ${new Date(tx.createdAt).toLocaleString()}
      </div>
      <div class="transaction-status status-${tx.status}">
        ${
          tx.canApprove
            ? "⏳ Pending"
            : tx.status === "rejected"
            ? "❌ Rejected"
            : "✅ Accepted"
        }
      </div>
    </div>

    <div class="transaction-body">
      <div class="transaction-parties">
        <div class="party">
          <div class="party-label">You</div>
          <a
            href="/api/v1/node/${nodeId}/${tx.versionSelf}${queryString}"
            class="party-link"
            onclick="event.stopPropagation()"
          >
            <code>${nodeName} v${tx.versionSelf}</code>
          </a>
        </div>

        <div class="party-arrow">⇄</div>

        <div class="party">
          <div class="party-label">
            ${tx.counterparty ? "Counterparty" : "Outside Source"}
          </div>
          ${
            tx.counterparty
              ? `
          <a
            href="/api/v1/node/${tx.counterparty._id}/${
                  tx.versionCounterparty
                }${queryString}"
            class="party-link"
            onclick="event.stopPropagation()"
          >
            <code>${tx.counterparty.name ?? tx.counterparty._id} v${
                  tx.versionCounterparty
                }</code>
          </a>
          `
              : `<em class="outside-source">External</em>`
          }
        </div>
      </div>

      <div class="transaction-values">
        <div class="value-box sent">
          <div class="value-label">Sent</div>
          <code>${JSON.stringify(tx.valuesSent)}</code>
        </div>
        <div class="value-box received">
          <div class="value-label">Received</div>
          <code>${JSON.stringify(tx.valuesReceived)}</code>
        </div>
      </div>

      ${tx.approvalSummary ? renderApprovalSummary(tx.approvalSummary) : ""}

      ${
        tx.canApprove
          ? `
      <div class="transaction-actions" onclick="event.stopPropagation()">
        <form
          method="POST"
          action="/api/v1/node/${nodeId}/${parsedVersion}/transactions/${tx._id}/approve${queryString}"
          style="display:inline;"
        >
          <button type="submit" class="btn-approve">✓ Approve</button>
        </form>

        <form
          method="POST"
          action="/api/v1/node/${nodeId}/${parsedVersion}/transactions/${tx._id}/deny${queryString}"
          style="display:inline;"
        >
          <button type="submit" class="btn-deny">✗ Deny</button>
        </form>
      </div>
      `
          : ""
      }
    </div>
  </div>
</li>
`;
  })
  .join("")}
</ul>`
      : `
<div class="empty-state">
  <div class="empty-state-icon">📊</div>
  <div class="empty-state-text">No transactions yet</div>
  <div class="empty-state-subtext">Transactions will appear here</div>
</div>`;

  return `
  <!DOCTYPE html>
  <html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta name="theme-color" content="#667eea">
    <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
    <title>Transactions - ${nodeName}</title>
    <style>
      * {
        box-sizing: border-box;
        margin: 0;
        padding: 0;
      }

      body {
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen', 'Ubuntu', 'Cantarell', sans-serif;
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        min-height: 100vh;
        padding: 20px;
        color: #1a1a1a;
      }

      .container {
        max-width: 900px;
        margin: 0 auto;
      }

      /* Header */
      .header {
        background: rgba(255, 255, 255, 0.95);
        backdrop-filter: blur(10px);
        border-radius: 16px;
        padding: 28px;
        margin-bottom: 24px;
        box-shadow: 0 8px 32px rgba(0, 0, 0, 0.1);
      }

      .header h1 {
        font-size: 28px;
        font-weight: 700;
        color: #1a1a1a;
        margin-bottom: 8px;
      }

      .header h1::before {
        content: '💱 ';
        font-size: 26px;
      }

      .header h1 a {
        color: #667eea;
        text-decoration: none;
        transition: color 0.2s;
      }

      .header h1 a:hover {
        color: #764ba2;
        text-decoration: underline;
      }

      .header-subtitle {
        font-size: 14px;
        color: #888;
        margin-top: 4px;
      }

      /* Section Titles */
      .section-title {
        font-size: 20px;
        font-weight: 600;
        color: #1a1a1a;
        margin-bottom: 16px;
        padding-left: 4px;
      }

      /* Transactions List */
      .transactions-list {
        list-style: none;
        margin-bottom: 32px;
      }

      .transaction-card {
        background: rgba(255, 255, 255, 0.95);
        backdrop-filter: blur(10px);
        border-radius: 12px;
        padding: 20px;
        margin-bottom: 16px;
        box-shadow: 0 4px 16px rgba(0, 0, 0, 0.08);
        transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
        border-left: 4px solid #667eea;
        position: relative;
        overflow: hidden;
      }

      .transaction-card.pending {
        border-left-color: #ffa500;
        background: linear-gradient(135deg, rgba(255, 255, 255, 0.98) 0%, rgba(255, 250, 240, 0.98) 100%);
      }

      .transaction-card.accepted {
        border-left-color: #10b981;
      }

      .transaction-card.rejected {
        border-left-color: #ef4444;
      }

      .transaction-card::before {
        content: '';
        position: absolute;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: linear-gradient(135deg, rgba(102, 126, 234, 0.03) 0%, rgba(118, 75, 162, 0.03) 100%);
        opacity: 0;
        transition: opacity 0.3s;
        pointer-events: none;
      }

      .transaction-card:hover {
        transform: translateX(8px) translateY(-4px);
        box-shadow: 0 12px 32px rgba(102, 126, 234, 0.2);
      }

      .transaction-card:hover::before {
        opacity: 1;
      }

      .transaction-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 16px;
        padding-bottom: 12px;
        border-bottom: 1px solid #e9ecef;
      }

      .transaction-date {
        font-size: 13px;
        color: #888;
      }

      .transaction-status {
        padding: 4px 12px;
        border-radius: 12px;
        font-size: 13px;
        font-weight: 600;
      }

      .status-pending {
        background: linear-gradient(135deg, #ffa500 0%, #ff8c00 100%);
        color: white;
      }

      .status-accepted {
        background: linear-gradient(135deg, #10b981 0%, #059669 100%);
        color: white;
      }

      .status-rejected {
        background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%);
        color: white;
      }

      .transaction-body {
        position: relative;
        z-index: 1;
      }

      .transaction-parties {
        display: flex;
        align-items: center;
        gap: 16px;
        margin-bottom: 16px;
        flex-wrap: wrap;
      }

      .party {
        flex: 1;
        min-width: 200px;
      }

      .party-label {
        font-size: 12px;
        color: #888;
        margin-bottom: 6px;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.5px;
      }

      .party-link {
        color: #667eea;
        text-decoration: none;
        transition: color 0.2s;
      }

      .party-link:hover {
        color: #764ba2;
        text-decoration: underline;
      }

      .party-arrow {
        font-size: 24px;
        color: #667eea;
        flex-shrink: 0;
      }

      .outside-source {
        color: #888;
        font-size: 14px;
      }

      .transaction-values {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 12px;
        margin-bottom: 16px;
      }

      .value-box {
        background: #f8f9fa;
        padding: 12px;
        border-radius: 8px;
        border: 1px solid #e9ecef;
      }

      .value-box.sent {
        border-left: 3px solid #ef4444;
      }

      .value-box.received {
        border-left: 3px solid #10b981;
      }

      .value-label {
        font-size: 12px;
        color: #888;
        margin-bottom: 6px;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.5px;
      }

      .value-box code {
        background: white;
        padding: 4px 8px;
        border-radius: 4px;
        font-size: 13px;
        color: #667eea;
        font-weight: 600;
        word-break: break-all;
      }

      /* Approval Summary */
      .approval-summary {
        background: linear-gradient(135deg, rgba(102, 126, 234, 0.05) 0%, rgba(118, 75, 162, 0.05) 100%);
        padding: 12px;
        border-radius: 8px;
        margin-bottom: 16px;
        border: 1px solid rgba(102, 126, 234, 0.1);
      }

      .approval-item {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-bottom: 8px;
        flex-wrap: wrap;
      }

      .approval-item:last-child {
        margin-bottom: 0;
      }

      .approval-label {
        font-size: 13px;
        font-weight: 600;
        color: #667eea;
        min-width: 100px;
      }

      .approval-badge {
        padding: 4px 10px;
        border-radius: 12px;
        font-size: 12px;
        font-weight: 600;
      }

      .approval-badge.resolved {
        background: linear-gradient(135deg, #10b981 0%, #059669 100%);
        color: white;
      }

      .approval-badge.pending {
        background: linear-gradient(135deg, #ffa500 0%, #ff8c00 100%);
        color: white;
      }

      .approval-policy {
        font-size: 12px;
        color: #888;
        font-style: italic;
      }

      /* Transaction Actions */
      .transaction-actions {
        display: flex;
        gap: 12px;
        margin-top: 16px;
        padding-top: 16px;
        border-top: 1px solid #e9ecef;
      }

      .btn-approve,
      .btn-deny {
        padding: 10px 20px;
        border: none;
        border-radius: 8px;
        font-weight: 600;
        font-size: 14px;
        cursor: pointer;
        transition: all 0.2s;
        display: inline-flex;
        align-items: center;
        gap: 6px;
      }

      .btn-approve {
        background: linear-gradient(135deg, #10b981 0%, #059669 100%);
        color: white;
        box-shadow: 0 4px 12px rgba(16, 185, 129, 0.3);
      }

      .btn-approve:hover {
        transform: translateY(-2px);
        box-shadow: 0 6px 20px rgba(16, 185, 129, 0.4);
      }

      .btn-deny {
        background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%);
        color: white;
        box-shadow: 0 4px 12px rgba(239, 68, 68, 0.3);
      }

      .btn-deny:hover {
        transform: translateY(-2px);
        box-shadow: 0 6px 20px rgba(239, 68, 68, 0.4);
      }

      /* Create Transaction Form */
      .create-form-container {
        background: rgba(255, 255, 255, 0.95);
        backdrop-filter: blur(10px);
        border-radius: 16px;
        padding: 28px;
        box-shadow: 0 8px 32px rgba(0, 0, 0, 0.1);
        position: relative;
        overflow: hidden;
      }

      .create-form-container::before {
        content: '';
        position: absolute;
        top: 0;
        left: 0;
        width: 100%;
        height: 4px;
        background: linear-gradient(90deg, #667eea 0%, #764ba2 100%);
      }

      .form-section {
        margin-bottom: 24px;
      }

      .form-section h3 {
        font-size: 16px;
        font-weight: 600;
        color: #667eea;
        margin-bottom: 12px;
      }

      .form-group {
        margin-bottom: 12px;
      }

      input,
      select,
      textarea {
        width: 100%;
        padding: 12px;
        border: 1px solid #e9ecef;
        border-radius: 8px;
        font-size: 14px;
        font-family: inherit;
        transition: border-color 0.2s;
      }

      input:focus,
      select:focus,
      textarea:focus {
        outline: none;
        border-color: #667eea;
      }

      textarea {
        resize: vertical;
        font-family: 'SF Mono', Monaco, monospace;
      }

      .form-divider {
        height: 1px;
        background: #e9ecef;
        margin: 24px 0;
      }

      .btn-submit {
        width: 100%;
        padding: 14px 24px;
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        color: white;
        border: none;
        border-radius: 10px;
        font-weight: 600;
        font-size: 15px;
        cursor: pointer;
        transition: all 0.2s;
        box-shadow: 0 4px 12px rgba(102, 126, 234, 0.3);
      }

      .btn-submit:hover {
        transform: translateY(-2px);
        box-shadow: 0 6px 20px rgba(102, 126, 234, 0.4);
      }

      /* Empty State */
      .empty-state {
        background: rgba(255, 255, 255, 0.95);
        backdrop-filter: blur(10px);
        border-radius: 16px;
        padding: 60px 40px;
        text-align: center;
        box-shadow: 0 8px 32px rgba(0, 0, 0, 0.1);
        margin-bottom: 32px;
      }

      .empty-state-icon {
        font-size: 64px;
        margin-bottom: 16px;
      }

      .empty-state-text {
        font-size: 18px;
        color: #666;
        margin-bottom: 8px;
      }

      .empty-state-subtext {
        font-size: 14px;
        color: #999;
      }

      /* Code */
      code {
        background: linear-gradient(135deg, rgba(102, 126, 234, 0.1) 0%, rgba(118, 75, 162, 0.1) 100%);
        padding: 4px 8px;
        border-radius: 6px;
        font-size: 13px;
        font-family: 'SF Mono', Monaco, monospace;
        color: #667eea;
        font-weight: 600;
      }

      /* Responsive */
      @media (max-width: 640px) {
        body {
          padding: 16px;
        }

        .header,
        .create-form-container {
          padding: 20px;
        }

        .header h1 {
          font-size: 24px;
        }

        .transaction-card {
          padding: 16px;
        }

        .transaction-parties {
          flex-direction: column;
          align-items: flex-start;
        }

        .party {
          width: 100%;
        }

        .party-arrow {
          transform: rotate(90deg);
          align-self: center;
        }

        .transaction-values {
          grid-template-columns: 1fr;
        }

        .transaction-actions {
          flex-direction: column;
        }

        .btn-approve,
        .btn-deny {
          width: 100%;
          justify-content: center;
        }

        .empty-state {
          padding: 40px 24px;
        }
      }

      @media (min-width: 641px) and (max-width: 1024px) {
        .container {
          max-width: 700px;
        }
      }
         /* Back Navigation */
    .back-nav {
      display: flex;
      gap: 12px;
      margin-bottom: 20px;
      flex-wrap: wrap;
    }

    .back-link {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 10px 16px;
      background: rgba(255, 255, 255, 0.95);
      backdrop-filter: blur(10px);
      color: #667eea;
      text-decoration: none;
      border-radius: 10px;
      font-weight: 600;
      font-size: 14px;
      transition: all 0.2s;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
    }

    .back-link:hover {
      background: white;
      transform: translateY(-2px);
      box-shadow: 0 6px 20px rgba(0, 0, 0, 0.15);
    }
    </style>
  </head>
  <body>
    <div class="container">
      <!-- Header -->
      <div class="back-nav">
  <a href="/api/v1/root/${nodeId}${queryString}" class="back-link">
    ← Back to Tree
  </a>
  <a href="/api/v1/node/${nodeId}/${parsedVersion}${queryString}" class="back-link">
    Back to Version
  </a>
</div>

   <div class="header">
  <h1>
    <a href="/api/v1/node/${nodeId}${queryString}">
      ${nodeName} v${parsedVersion}
    </a>
  </h1>
  <div class="header-subtitle">Transaction history and management</div>
</div>

 <!-- Create Transaction Form -->
      <div class="create-form-container">
            <div class="section-title">Create Transaction</div>

        <form method="POST" action="/api/v1/node/${nodeId}/${parsedVersion}/transactions${queryString}">
          <input type="hidden" name="sideA.kind" value="NODE" />
          <input type="hidden" name="sideA.nodeId" value="${nodeId}" />
          <input type="hidden" name="versionAIndex" value="${parsedVersion}" />

          <div class="form-section">
            <h3>Your Side</h3>
            <textarea name="valuesA" rows="3" placeholder='{"gold": 10, "silver": 5}'></textarea>
          </div>

          <div class="form-divider"></div>

          <div class="form-section">
            <h3>Counterparty</h3>
            <div class="form-group">
              <select name="sideB.kind" id="sideBKind">
                <option value="NODE">Node</option>
                <option value="OUTSIDE">Outside</option>
              </select>
            </div>

            <div id="nodeFields">
              <div class="form-group">
                <input name="sideB.nodeId" placeholder="Node ID" />
              </div>
              <div class="form-group">
                <input type="number" name="versionBIndex" placeholder="Version index (defaults to other node's latest verion if blank)" />
              </div>
            </div>

            <div id="outsideFields" style="display:none;">
              <div class="form-group">
                <select name="sideB.sourceType">
                  <option value="SOLANA">Solana</option>
                </select>
              </div>
              <div class="form-group">
                <input name="sideB.sourceId" placeholder="Wallet / reference" />
              </div>
            </div>

            <textarea name="valuesB" rows="3" placeholder='{"wood": 5, "stone": 3}'></textarea>
          </div>

          <button type="submit" class="btn-submit">Send Transaction</button>
        </form>
      </div>
      <!-- Transactions Section -->
      <div class="section-title">Transactions</div>
      ${transactionsHtml}


    </div>

    <script>
      const kind = document.getElementById("sideBKind");
      const node = document.getElementById("nodeFields");
      const out = document.getElementById("outsideFields");

      kind.addEventListener("change", () => {
        const isNode = kind.value === "NODE";
        node.style.display = isNode ? "block" : "none";
        out.style.display = isNode ? "none" : "block";
      });

      const form = document.querySelector("form");
      const valuesA = form.querySelector('[name="valuesA"]');
      const valuesB = form.querySelector('[name="valuesB"]');

      form.addEventListener("submit", (e) => {
        const a = valuesA.value.trim();
        const b = valuesB.value.trim();

        if (!a && !b) {
          e.preventDefault();
          alert("You must enter values on at least one side.");
          return;
        }
      });
    </script>
  </body>
  </html>
  `;
}

/**
 * Render the transaction detail page.
 */
export function renderTransactionDetail({
  nodeId,
  version,
  transactionId,
  tx,
  contributions,
  sideANodeName,
  sideBNodeName,
  queryString,
}) {
  // Render approval groups
  const renderApprovalGroup = (group) => {
    const approvedUserIds = new Set(group.approvals.map((a) => a.userId));
    const deniedUserIds = new Set(
      (group.denials || []).map((d) => d.userId)
    );

    return `
          <div class="approval-group ${
            group.resolved ? "resolved" : "pending"
          }">
            <div class="approval-group-header">
              <div class="approval-group-title">
                <span class="side-badge side-${group.side.toLowerCase()}">${
          group.side === "A" ? sideANodeName : sideBNodeName
        }</span>
                <span class="policy-badge">${group.policy}</span>
              </div>
              <div class="approval-status ${
                group.resolved ? "resolved" : "pending"
              }">
                ${group.approvals.length}/${group.requiredApprovals}
                ${group.resolved ? "✓ Complete" : "⏳ Pending"}
              </div>
            </div>

            <div class="approvers-list">
              ${group.eligibleApprovers
                .map((userId) => {
                  const hasApproved = approvedUserIds.has(userId);
                  const hasDenied = deniedUserIds.has(userId);
                  const approval = group.approvals.find(
                    (a) => a.userId === userId
                  );
                  const user = contributions.find(
                    (c) => c.userId._id === userId
                  )?.userId;
                  const username = user?.username || userId.substring(0, 8);

                  return `
  <div class="approver-item ${
    hasApproved ? "approved" : hasDenied ? "denied" : "pending"
  }">
    <div class="approver-info">
      <span class="approver-icon">
        ${hasApproved ? "✓" : hasDenied ? "✗" : "○"}
      </span>
      <a href="/api/v1/user/${userId}${queryString}" class="approver-name">
        @${username}
      </a>
    </div>

    ${
      hasApproved
        ? `<span class="approval-time">${new Date(
            approval.approvedAt
          ).toLocaleString()}</span>`
        : hasDenied
        ? `<span class="approval-time denied">${new Date(
            group.denials.find((d) => d.userId === userId).deniedAt
          ).toLocaleString()}</span>`
        : `<span class="approval-time pending">Not voted</span>`
    }
  </div>
`;
                })
                .join("")}
            </div>
          </div>
        `;
  };

  // Render transaction timeline
  const renderTimeline = () => {
    const events = contributions
      .filter((c) => c.nodeId?.toString() === nodeId)
      .sort((a, b) => new Date(a.date) - new Date(b.date))
      .map((contrib) => {
        const username = contrib.userId?.username || "Unknown";
        const event = contrib.transactionMeta?.event;

        let icon = "📝";
        let label = event;
        let cls = "event-neutral";

        if (event === "created") {
          icon = "🚀";
          label = "Proposed transaction";
          cls = "event-created";
        } else if (event === "approved") {
          icon = "✅";
          label = "Approved";
          cls = "event-approved";
        } else if (event === "denied") {
          icon = "❌";
          label = "Denied";
          cls = "event-denied";
        } else if (event === "execution_started") {
          icon = "⏳";
          label = "Execution started";
          cls = "event-executing";
        } else if (event === "succeeded") {
          icon = "⚡";
          label = "Transaction executed";
          cls = "event-executed";
        } else if (event === "failed") {
          icon = "💥";
          label = "Execution failed";
          cls = "event-failed";
        } else if (event === "accepted_by_policy") {
          icon = "📜";
          label = "Accepted by policy";
          cls = "event-policy-accepted";
        } else if (event === "rejected_by_policy") {
          icon = "📜";
          label = "Rejected by policy";
          cls = "event-policy-rejected";
        }
        return `
        <div class="timeline-item ${cls}">
          <div class="timeline-icon">${icon}</div>
          <div class="timeline-content">
            <div class="timeline-header">
              <a href="/api/v1/user/${
                contrib.userId._id
              }${queryString}" class="timeline-user">
                @${username}
              </a>
              <span class="timeline-event">${label}</span>
            </div>
            <div class="timeline-time">
              ${new Date(contrib.date).toLocaleString()}
            </div>
          </div>
        </div>
      `;
      })
      .join("");

    return events || '<div class="empty-timeline">No events yet</div>';
  };

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="theme-color" content="#667eea">
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
  <title>Transaction ${transactionId.substring(0, 8)}</title>
  <style>
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen', 'Ubuntu', 'Cantarell', sans-serif;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      min-height: 100vh;
      padding: 20px;
      color: #1a1a1a;
    }
.approver-item.denied {
  border-left: 3px solid #ef4444;
  background: rgba(239, 68, 68, 0.05);
}



    .container {
      max-width: 1000px;
      margin: 0 auto;
    }

    /* Back Navigation */
    .back-nav {
      display: flex;
      gap: 12px;
      margin-bottom: 20px;
      flex-wrap: wrap;
    }

    .back-link {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 10px 16px;
      background: rgba(255, 255, 255, 0.95);
      backdrop-filter: blur(10px);
      color: #667eea;
      text-decoration: none;
      border-radius: 10px;
      font-weight: 600;
      font-size: 14px;
      transition: all 0.2s;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
    }

    .back-link:hover {
      background: white;
      transform: translateY(-2px);
      box-shadow: 0 6px 20px rgba(0, 0, 0, 0.15);
    }

    /* Header */
    .header {
      background: rgba(255, 255, 255, 0.95);
      backdrop-filter: blur(10px);
      border-radius: 16px;
      padding: 28px;
      margin-bottom: 24px;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.1);
      position: relative;
      overflow: hidden;
    }

    .header::before {
      content: '';
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 4px;
      background: linear-gradient(90deg, #667eea 0%, #764ba2 100%);
    }

    .header-top {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      margin-bottom: 20px;
      flex-wrap: wrap;
      gap: 12px;
    }

    .header h1 {
      font-size: 28px;
      font-weight: 700;
      color: #1a1a1a;
    }



    .status-badge {
      padding: 8px 16px;
      border-radius: 12px;
      font-size: 14px;
      font-weight: 600;
      display: inline-flex;
      align-items: center;
      gap: 6px;
    }

    .status-badge.pending {
      background: linear-gradient(135deg, #ffa500 0%, #ff8c00 100%);
      color: white;
    }

    .status-badge.accepted {
      background: linear-gradient(135deg, #10b981 0%, #059669 100%);
      color: white;
    }

    .status-badge.rejected {
      background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%);
      color: white;
    }

    .transaction-id {
      font-size: 13px;
      color: #888;
      font-family: 'SF Mono', Monaco, monospace;
      margin-top: 8px;
    }

    /* Trade Overview */
    .trade-overview {
      display: grid;
      grid-template-columns: 1fr auto 1fr;
      gap: 24px;
      align-items: center;
      padding: 24px;
      background: #f8f9fa;
      border-radius: 12px;
      margin-top: 20px;
    }

    .trade-side {
      text-align: center;
    }

    .side-label {
      font-size: 12px;
      color: #888;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-bottom: 12px;
    }

    .side-node {
      font-size: 18px;
      font-weight: 700;
      color: #667eea;
      margin-bottom: 8px;
    }

    .side-version {
      font-size: 13px;
      color: #888;
      margin-bottom: 12px;
    }

    .side-values {
      background: white;
      padding: 12px;
      border-radius: 8px;
      border: 1px solid #e9ecef;
      margin-top: 12px;
    }

    .values-label {
      font-size: 11px;
      color: #888;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-bottom: 8px;
    }

    .values-content {
      font-family: 'SF Mono', Monaco, monospace;
      font-size: 13px;
      color: #1a1a1a;
      word-break: break-all;
    }

    .trade-arrow {
      font-size: 32px;
      color: #667eea;
    }

    /* Section */
    .section {
      background: rgba(255, 255, 255, 0.95);
      backdrop-filter: blur(10px);
      border-radius: 16px;
      padding: 28px;
      margin-bottom: 24px;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.1);
      position: relative;
      overflow: hidden;
    }

    .section::before {
      content: '';
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 4px;
      background: linear-gradient(90deg, #667eea 0%, #764ba2 100%);
    }

    .section-title {
      font-size: 20px;
      font-weight: 600;
      color: #1a1a1a;
      margin-bottom: 20px;
    }

    /* Approval Groups */
    .approval-groups {
      display: grid;
      gap: 20px;
    }

    .approval-group {
      background: #f8f9fa;
      border-radius: 12px;
      padding: 20px;
      border-left: 4px solid #667eea;
      transition: all 0.2s;
    }

    .approval-group.resolved {
      border-left-color: #10b981;
      background: linear-gradient(135deg, rgba(16, 185, 129, 0.05) 0%, rgba(5, 150, 105, 0.05) 100%);
    }

    .approval-group.pending {
      border-left-color: #ffa500;
      background: linear-gradient(135deg, rgba(255, 165, 0, 0.05) 0%, rgba(255, 140, 0, 0.05) 100%);
    }

    .approval-group-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 16px;
      padding-bottom: 12px;
      border-bottom: 1px solid #e9ecef;
      flex-wrap: wrap;
      gap: 12px;
    }

    .approval-group-title {
      display: flex;
      align-items: center;
      gap: 12px;
      flex-wrap: wrap;
    }

    .side-badge {
      padding: 6px 12px;
      border-radius: 8px;
      font-size: 13px;
      font-weight: 600;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
    }

    .side-badge.side-a {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    }

    .side-badge.side-b {
      background: linear-gradient(135deg, #764ba2 0%, #667eea 100%);
    }

    .policy-badge {
      padding: 4px 10px;
      border-radius: 12px;
      font-size: 12px;
      font-weight: 600;
      background: white;
      color: #667eea;
      border: 1px solid #e9ecef;
    }

    .approval-status {
      padding: 6px 14px;
      border-radius: 12px;
      font-size: 13px;
      font-weight: 600;
    }

    .approval-status.resolved {
      background: linear-gradient(135deg, #10b981 0%, #059669 100%);
      color: white;
    }

    .approval-status.pending {
      background: linear-gradient(135deg, #ffa500 0%, #ff8c00 100%);
      color: white;
    }

    /* Approvers List */
    .approvers-list {
      display: grid;
      gap: 12px;
    }

    .approver-item {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 12px;
      background: white;
      border-radius: 8px;
      border: 1px solid #e9ecef;
      transition: all 0.2s;
    }

    .approver-item:hover {
      transform: translateX(4px);
      box-shadow: 0 4px 12px rgba(102, 126, 234, 0.1);
    }

    .approver-item.approved {
      border-left: 3px solid #10b981;
    }

    .approver-item.pending {
      border-left: 3px solid #e9ecef;
      opacity: 0.7;
    }

    .approver-info {
      display: flex;
      align-items: center;
      gap: 12px;
    }

    .approver-icon {
      font-size: 18px;
      width: 24px;
      height: 24px;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .approver-item.approved .approver-icon {
      color: #10b981;
    }

    .approver-item.pending .approver-icon {
      color: #d1d5db;
    }

    .approver-name {
      color: #667eea;
      text-decoration: none;
      font-weight: 600;
      font-size: 14px;
      transition: color 0.2s;
    }

    .approver-name:hover {
      color: #764ba2;
      text-decoration: underline;
    }

    .approval-time {
      font-size: 12px;
      color: #888;
    }

    .approval-time.pending {
      font-style: italic;
      color: #aaa;
    }

    /* Timeline */
    .timeline {
      position: relative;
      padding-left: 40px;
    }

    .timeline::before {
      content: '';
      position: absolute;
      left: 11px;
      top: 0;
      bottom: 0;
      width: 2px;
      background: linear-gradient(180deg, #667eea 0%, #764ba2 100%);
    }

    .timeline-item {
      position: relative;
      margin-bottom: 24px;
    }

    .timeline-icon {
      position: absolute;
      left: -40px;
      width: 24px;
      height: 24px;
      background: white;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 14px;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
    }

    .timeline-content {
      background: #f8f9fa;
      padding: 12px 16px;
      border-radius: 8px;
      border: 1px solid #e9ecef;
    }

    .timeline-header {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 4px;
      flex-wrap: wrap;
    }

    .timeline-user {
      color: #667eea;
      text-decoration: none;
      font-weight: 600;
      font-size: 14px;
      transition: color 0.2s;
    }

    .timeline-user:hover {
      color: #764ba2;
      text-decoration: underline;
    }

    .timeline-event {
      font-size: 14px;
      color: #1a1a1a;
    }

    .timeline-time {
      font-size: 12px;
      color: #888;
    }

    .event-created .timeline-icon {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    }

    .event-approved .timeline-icon {
      background: linear-gradient(135deg, #10b981 0%, #059669 100%);
    }

    .event-denied .timeline-icon {
      background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%);
    }

    .event-executed .timeline-icon {
      background: linear-gradient(135deg, #ffa500 0%, #ff8c00 100%);
    }

    .empty-timeline {
      text-align: center;
      color: #888;
      padding: 40px;
      font-style: italic;
    }

    /* Responsive */
    @media (max-width: 768px) {
      body {
        padding: 16px;
      }

      .header,
      .section {
        padding: 20px;
      }

      .header h1 {
        font-size: 24px;
      }

      .trade-overview {
        grid-template-columns: 1fr;
        text-align: center;
      }

      .trade-arrow {
        transform: rotate(90deg);
      }

      .back-nav {
        flex-direction: column;
      }

      .back-link {
        justify-content: center;
      }

      .approval-group-header {
        flex-direction: column;
        align-items: flex-start;
      }

      .approver-item {
        flex-direction: column;
        align-items: flex-start;
        gap: 8px;
      }
    }

    @media (min-width: 769px) and (max-width: 1024px) {
      .container {
        max-width: 800px;
      }
    }
  </style>
</head>
<body>
  <div class="container">
    <!-- Back Navigation -->
    <div class="back-nav">
      <a href="/api/v1/node/${nodeId}/${version}/transactions${queryString}" class="back-link">
        ← Back to Transactions
      </a>
    </div>

    <!-- Header -->
    <div class="header">
      <div class="header-top">
        <div>
          <h1>Transaction Details</h1>
          <div class="transaction-id">ID: ${transactionId}</div>
        </div>
        <div class="status-badge ${tx.status}">
          ${
            tx.status === "pending"
              ? "⏳ Pending"
              : tx.status === "rejected"
              ? "❌ Rejected"
              : "✅ Accepted"
          }
        </div>
      </div>

      <!-- Trade Overview -->
      <div class="trade-overview">
        <div class="trade-side">
          <div class="side-label">Side A</div>
          <div class="side-node">${sideANodeName}</div>
          <div class="side-version">Version ${tx.versionAIndex}</div>
          <div class="side-values">
            <div class="values-label">Sending</div>
            <div class="values-content">${JSON.stringify(
              normalizeValues(tx.valuesTraded.sideA)
            )}</div>
          </div>
        </div>

        <div class="trade-arrow">⇄</div>

        <div class="trade-side">
          <div class="side-label">Side B</div>
          <div class="side-node">${sideBNodeName}</div>
          <div class="side-version">Version ${tx.versionBIndex}</div>
          <div class="side-values">
            <div class="values-label">Sending</div>
            <div class="values-content">${JSON.stringify(
              normalizeValues(tx.valuesTraded.sideB)
            )}</div>
          </div>
        </div>
      </div>
    </div>

    <!-- Approval Groups -->
    <div class="section">
      <div class="section-title">Approval Status</div>
      <div class="approval-groups">
        ${tx.approvalGroups.map((group) => renderApprovalGroup(group)).join("")}
      </div>
    </div>

    <!-- Timeline -->
    <div class="section">
      <div class="section-title">Transaction History</div>
      <div class="timeline">
        ${renderTimeline()}
      </div>
    </div>
  </div>
</body>
</html>
`;
}
