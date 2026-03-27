/* ------------------------------------------------- */
/* Tree Overview page (extracted from root.js)       */
/* ------------------------------------------------- */

import { page } from "../layout.js";
import { escapeHtml, rainbow } from "../utils.js";

export function renderRootOverview({
  allData,
  rootMeta,
  ancestors,
  isOwner,
  isDeleted,
  isRoot,
  isPublicAccess,
  queryAvailable,
  currentUserId,
  queryString,
  nodeId,
  userId,
  token,
  deferredItems,
  ownerConnections,
}) {
  const deferredHtml = deferredItems && deferredItems.length > 0
    ? `<ul class="deferred-list">${deferredItems.map((d) => `<li class="deferred-item"><div class="deferred-content">${escapeHtml(d.content || d.text || JSON.stringify(d.data || ""))}</div><div class="deferred-meta" style="font-size:11px;opacity:0.6;margin-top:4px;">${d.status || "pending"}${d.createdAt ? " . " + new Date(d.createdAt).toLocaleDateString() : ""}</div></li>`).join("")}</ul>`
    : '<div style="text-align:center;padding:20px;color:rgba(255,255,255,0.5);font-size:14px;">No short-term items</div>';

  let rootNameColor = "rgba(255, 255, 255, 0.4)";
  if (isDeleted) {
    rootNameColor = "#b00020";
  }

  const _txMeta = rootMeta?.metadata?.transactions || (rootMeta?.metadata instanceof Map ? rootMeta?.metadata?.get("transactions") : null) || {};
  const transactionPolicy = _txMeta.policy || "OWNER_ONLY";

  const renderParents = (chain) => {
    if (!chain || chain.length === 0) return "";
    if (chain.length === 1 && chain[0].isCurrent) return "";

    let html = '<div class="breadcrumb-constellation">';
    chain.forEach((node, idx) => {
      const isLast = idx === chain.length - 1;
      const color = rainbow[idx % rainbow.length];

      html += `
        <div class="breadcrumb-node ${isLast ? "current-node" : ""}" data-depth="${idx}">
          <div class="node-connector" style="background: linear-gradient(90deg, ${rainbow[(idx - 1 + rainbow.length) % rainbow.length]}, ${color});"></div>
          <div class="node-bubble" style="border-color: ${color}; box-shadow: 0 0 20px ${color}40;" data-node-id="${node._id}" data-is-current="${node.isCurrent ? "true" : "false"}">
            ${
              node.isCurrent
                ? `<a href="/api/v1/node/${node._id}${queryString}" class="node-link current">
                    <span class="node-icon">●</span>
                    <span class="node-name">${escapeHtml(node.name)}</span>
                    <span class="node-badge">YOU ARE HERE</span>
                  </a>`
                : `<a href="/api/v1/root/${node._id}${queryString}" class="node-link">
                    <span class="node-icon">○</span>
                    <span class="node-name">${escapeHtml(node.name)}</span>
                    <span class="depth-badge">Level ${idx + 1}</span>
                  </a>`
            }
          </div>
        </div>
      `;
    });
    html += "</div>";
    return html;
  };

  const renderTree = (node, depth = 0) => {
    const color = rainbow[depth % rainbow.length];
    let html = `
    <li
      class="tree-node"
        data-node-id="${node._id}"

      style="
        border-left: 4px solid ${color};
        padding-left: 12px;
        margin: 6px 0;
      "
    >


      <a href="/api/v1/node/${node._id}/${0}${queryString}">
        ${escapeHtml(node.name)}
      </a>
  `;
    if (node.children && node.children.length > 0) {
      html += `<ul>`;
      for (const c of node.children) {
        html += renderTree(c, depth + 1);
      }
      html += `</ul>`;
    }
    html += `</li>`;
    return html;
  };

  const inviteFormHtml = isOwner
    ? `
<form
  method="POST"
  action="/api/v1/root/${nodeId}/invite?token=${encodeURIComponent(token)}&html"
  style="display:flex; gap:8px; max-width:420px; margin-top:12px;"
>
  <input
    type="text"
    name="userReceiving"
    placeholder="username or user@other.land.com"
    required
  />

  <button type="submit">
    Invite
  </button>
</form>
<div style="font-size:11px; color:rgba(255,255,255,0.5); margin-top:4px;">
  Use username@domain to invite someone from another land.
</div>
`
    : ``;

  const policyHtml = isOwner
    ? `

<form
  method="POST"
  action="/api/v1/root/${nodeId}/transaction-policy?token=${encodeURIComponent(token)}&html"
  style="max-width: 420px;"
>
  <select
    name="policy"
    style="
      width:100%;
      padding:10px;
      border-radius:8px;
      border:1px solid #ccc;
      font-size:14px;
    "
  >
    <option value="OWNER_ONLY" ${
      transactionPolicy === "OWNER_ONLY" ? "selected" : ""
    }>
      Owner only
    </option>
    <option value="ANYONE" ${transactionPolicy === "ANYONE" ? "selected" : ""}>
      Anyone (single approval)
    </option>
    <option value="MAJORITY" ${
      transactionPolicy === "MAJORITY" ? "selected" : ""
    }>
      Majority of root members
    </option>
    <option value="ALL" ${transactionPolicy === "ALL" ? "selected" : ""}>
      All root members
    </option>
  </select>

  <button type="submit" style="margin-top:12px;">
    Update Policy
  </button>
</form>
`
    : ``;

  const ownerHtml = rootMeta?.rootOwner
    ? `<ul class="contributors-list">
  <li>
    <a href="/api/v1/user/${rootMeta.rootOwner._id}${queryString}">
      ${escapeHtml(rootMeta.rootOwner.username)}
    </a>
    <span style="font-size:12px;opacity:0.7;color:white;">Owner</span>
  </li>
</ul>`
    : ``;

  const contributorsHtml = rootMeta?.contributors?.length
    ? `
<ul class="contributors-list">
${rootMeta.contributors
  .map((u) => {
    const isSelf = u._id.toString() === userId?.toString();

    return `
<li>
<a href="/api/v1/user/${u._id}${queryString}">
  ${escapeHtml(u.username)}
</a>
${u.isRemote ? '<span style="font-size:11px;opacity:0.5;color:white;">(remote)</span>' : ""}
  <div class="contributors-actions">
    ${
      isOwner
        ? `
      <form
        method="POST"
        action="/api/v1/root/${nodeId}/transfer-owner?token=${encodeURIComponent(token)}&html"
onsubmit="return confirm('Transfer ownership to ${escapeHtml(u.username)}?')"
      >
        <input type="hidden" name="userReceiving" value="${u._id}" />
        <button type="submit">Transfer</button>
      </form>
      `
        : ""
    }

    ${
      isOwner || isSelf
        ? `
      <form
        method="POST"
        action="/api/v1/root/${nodeId}/remove-user?token=${encodeURIComponent(token)}&html"
        onsubmit="return confirm('${
          isSelf ? "Leave this root?" : `Remove ${escapeHtml(u.username)} from this root?`
        }')"
      >
        <input type="hidden" name="userReceiving" value="${u._id}" />
        <button type="submit">
          ${isSelf ? "Leave" : "Remove"}
        </button>
      </form>
      `
        : ""
    }
  </div>
</li>
`;
  })
  .join("")}
</ul>
`
    : ``;

  const retireHtml = isOwner
    ? `
<form
  method="POST"
  action="/api/v1/root/${nodeId}/retire?token=${encodeURIComponent(token)}&html"
  onsubmit="return confirm('This will retire the root. Continue?')"
  style="margin-top:12px;"
>
  <button
    type="submit"
    style="
      padding:8px 14px;
      border-radius:8px;
      border:1px solid rgba(239, 68, 68, 0.5);
      background:rgba(239, 68, 68, 0.25);
      color:white;
      font-weight:600;
      cursor:pointer;
    "
  >
    Retire
  </button>
</form>
`
    : "";

  // Tree AI Model section
  let treeLlmHtml = "";
  if (isOwner && rootMeta?.rootOwner && ownerConnections) {
    const ownerProfile = rootMeta.rootOwner;
    const llmSlots = [
      { key: "default", label: "Default", isDefault: true },
      { key: "placement", label: "Placement" },
      { key: "understanding", label: "Understanding" },
      { key: "respond", label: "Respond" },
      { key: "notes", label: "Notes" },
      { key: "cleanup", label: "Cleanup" },
      { key: "drain", label: "Drain" },
      { key: "notification", label: "Notification" },
    ];

    function buildSlotHtml(slot) {
      // Read from llmDefault for "default" slot, metadata.llm.slots for extension slots
      const current = slot.key === "default"
        ? (rootMeta.llmDefault || null)
        : (rootMeta.metadata?.llm?.slots?.[slot.key] || (rootMeta.metadata instanceof Map ? rootMeta.metadata.get("llm")?.slots?.[slot.key] : null) || null);
      const optHtml = ownerConnections.map(function(c) {
        return '<div class="custom-select-option' + (current === c._id ? ' selected' : '') + '" data-value="' + c._id + '">'
          + escapeHtml(c.name) + ' (' + escapeHtml(c.model) + ')</div>';
      }).join('');
      let label;
      if (current === "none") {
        label = 'Off (no AI)';
      } else if (current) {
        const m = ownerConnections.find(function(c){return c._id === current;});
        label = m ? escapeHtml(m.name) + ' (' + escapeHtml(m.model) + ')' : 'Account default';
      } else {
        label = slot.isDefault ? 'Account default' : 'Use default';
      }
      return `<p style="font-size:0.85em;opacity:0.6;margin-bottom:4px;margin-top:10px;">${slot.label}</p>
  <div class="custom-select" data-slot="${slot.key}" style="margin-bottom:4px;">
    <div class="custom-select-trigger">${label}</div>
    <div class="custom-select-options">
      <div class="custom-select-option${!current ? ' selected' : ''}" data-value="">${slot.isDefault ? 'Account default' : 'Use default'}</div>
      ${optHtml}
      ${slot.isDefault ? '<div class="custom-select-option' + (current === "none" ? ' selected' : '') + '" data-value="none" style="color:rgba(255,107,107,0.8);">Off (no AI)</div>' : ''}
    </div>
  </div>`;
    }

    treeLlmHtml = `
<h3>AI Models</h3>
<p style="font-size:0.85em;opacity:0.5;margin-bottom:8px;">Set a default LLM for the tree. All modes fall back to this. Per-mode overrides below. Set default to "Off" to disable AI entirely.</p>
${ownerConnections.length === 0
  ? '<p style="font-size:0.85em;opacity:0.5;">No custom connections -- <a href="/api/v1/user/${ownerProfile._id}${queryString ? queryString + "&" : "?"}html" style="color:inherit;">add one on your profile</a></p>'
  : llmSlots.map(buildSlotHtml).join('\n') + '\n  <div class="llm-assign-status" style="font-size:0.8em;margin-top:4px;display:none;"></div>'
}`;
  }

  const parentHtml = ancestors.length
    ? renderParents([
        ...ancestors.slice().reverse(),
        {
          _id: allData._id,
          name: allData.name,
          isCurrent: true,
        },
      ])
    : ``;

  const childrenInner = allData.children?.length
    ? `<ul>${allData.children.map((c) => renderTree(c)).join("")}</ul>`
    : ``;

  const treeHtml = `
      <ul class="tree-root" style="padding-left:0;">
        <li class="tree-node root-entry"
            data-node-id="${allData._id}"
            style="border-left: 4px solid ${rootNameColor}; padding-left: 6px; margin: 6px 0;">
          <a href="/api/v1/node/${allData._id}/0${queryString}">
            ${escapeHtml(allData.name)}
          </a>
          ${childrenInner}
        </li>
      </ul>`;

  const css = `
    .current {
    color: rgb(51, 66, 85);}

    /* Glass Content Cards */
    .content-card {
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
    }

    .content-card:nth-child(2) { animation-delay: 0.1s; }
    .content-card:nth-child(3) { animation-delay: 0.15s; }
    .content-card:nth-child(4) { animation-delay: 0.2s; }
    .content-card:nth-child(5) { animation-delay: 0.25s; }



  .content-card::before {
  content: "";
  position: absolute;
  inset: 0;
  border-radius: inherit;

  background:
    linear-gradient(
      180deg,
      rgba(255,255,255,0.18),
      rgba(255,255,255,0.05)
    );

  pointer-events: none;
}

    /* Header Section */
    .header-section {
      margin-bottom: 24px;
      padding-bottom: 20px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.2);
    }

    .section-header {
      margin-bottom: 20px;
      padding-bottom: 12px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.2);
    }

    .section-header h2 {
      margin: 0;
      font-size: 20px;
      font-weight: 600;
      color: white;
      text-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
      letter-spacing: -0.3px;
    }

    .section-header h2 a {
      color: white;
      text-decoration: none;
      transition: all 0.2s;
    }

    .section-header h2 a:hover {
      text-shadow: 0 0 12px rgba(255, 255, 255, 0.8);
    }

    /* ==========================================
       CONSTELLATION BREADCRUMB NAVIGATION
       ========================================== */

.breadcrumb-constellation {
  display: flex;
  align-items: center;
  gap: 0;
  padding: 24px 16px;
  overflow-x: auto;
  overflow-y: hidden;
  position: relative;
  min-height: 100px;

  /* Scrollbar styling */
  scrollbar-width: thin;
  scrollbar-color: rgba(255, 255, 255, 0.3) transparent;
}

    .breadcrumb-constellation::-webkit-scrollbar {
      height: 6px;
    }

    .breadcrumb-constellation::-webkit-scrollbar-track {
      background: rgba(255, 255, 255, 0.1);
      border-radius: 3px;
    }

    .breadcrumb-constellation::-webkit-scrollbar-thumb {
      background: rgba(255, 255, 255, 0.3);
      border-radius: 3px;
    }

    .breadcrumb-node {
      display: flex;
      align-items: center;
      flex-shrink: 0;
      animation: nodeSlideIn 0.5s cubic-bezier(0.34, 1.56, 0.64, 1);
      animation-fill-mode: both;
    }

    .breadcrumb-node:nth-child(1) { animation-delay: 0s; }
    .breadcrumb-node:nth-child(2) { animation-delay: 0.1s; }
    .breadcrumb-node:nth-child(3) { animation-delay: 0.2s; }
    .breadcrumb-node:nth-child(4) { animation-delay: 0.3s; }
    .breadcrumb-node:nth-child(5) { animation-delay: 0.4s; }
    .breadcrumb-node:nth-child(6) { animation-delay: 0.5s; }
    .breadcrumb-node:nth-child(n+7) { animation-delay: 0.6s; }

    @keyframes nodeSlideIn {
      from {
        opacity: 0;
        transform: translateX(-30px) scale(0.8);
      }
      to {
        opacity: 1;
        transform: translateX(0) scale(1);
      }
    }

    .node-connector {
      width: 40px;
      height: 3px;
      border-radius: 2px;
      position: relative;
      overflow: hidden;
    }

    .node-connector::after {
      content: '';
      position: absolute;
      top: 0;
      left: -100%;
      width: 100%;
      height: 100%;
      background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.6), transparent);
      animation: shimmer 2s infinite;
    }

    @keyframes shimmer {
      to {
        left: 100%;
      }
    }

    .breadcrumb-node:first-child .node-connector {
      display: none;
    }

    .node-bubble {
      background: rgba(255, 255, 255, 0.15);
      backdrop-filter: blur(10px);
      border: 2px solid;
      border-radius: 12px;
      padding: 12px 18px;
      position: relative;
      transition: all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
      cursor: pointer;
    }

    .bubble-scroll-zone {
      position: absolute;
      left: 0;
      top: 0;
      bottom: 0;
      width: 35%;
      z-index: 10;
      cursor: pointer;
    }

    .bubble-scroll-zone:hover {
      background: rgba(255, 255, 255, 0.1);
      border-radius: 12px 0 0 12px;
    }

    .node-bubble:hover {
      transform: scale(1.05) translateY(-3px);
      background: rgba(255, 255, 255, 0.25);
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2);
    }

    .current-node .node-bubble {
      background: rgba(255, 255, 255, 0.3);
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2),
                  inset 0 0 30px rgba(255, 255, 255, 0.3);
      animation: pulse 2s infinite;
    }

    @keyframes pulse {
      0%, 100% {
        box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2),
                    inset 0 0 30px rgba(255, 255, 255, 0.3);
      }
      50% {
        box-shadow: 0 12px 40px rgba(0, 0, 0, 0.3),
                    inset 0 0 40px rgba(255, 255, 255, 0.5);
      }
    }

    .node-link {
      display: flex;
      align-items: center;
      gap: 10px;
      color: white;
      text-decoration: none;
      font-weight: 600;
      font-size: 14px;
      white-space: nowrap;
      transition: all 0.2s;
    }

    .node-link:hover {
      text-shadow: 0 0 10px rgba(255, 255, 255, 0.8);
    }

    .node-link.current {
      font-weight: 700;
      font-size: 15px;
    }

    .node-icon {
      font-size: 20px;
      line-height: 1;
      transition: transform 0.3s;
    }

    .node-link:hover .node-icon {
      transform: scale(1.3);
    }

    .current-node .node-icon {
      animation: glow 2s infinite;
    }

    @keyframes glow {
      0%, 100% {
        filter: drop-shadow(0 0 3px rgba(255, 255, 255, 0.6));
      }
      50% {
        filter: drop-shadow(0 0 8px rgba(255, 255, 255, 1));
      }
    }

    .node-name {
      max-width: 150px;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .node-badge {
      background: rgba(255, 255, 255, 0.3);
      padding: 2px 8px;
      border-radius: 8px;
      font-size: 9px;
      font-weight: 700;
      letter-spacing: 0.5px;
      text-transform: uppercase;
      border: 1px solid rgba(255, 255, 255, 0.4);
    }

    .depth-badge {
      background: rgba(0, 0, 0, 0.2);
      padding: 2px 6px;
      border-radius: 6px;
      font-size: 10px;
      font-weight: 600;
      opacity: 0.7;
    }

    /* Mobile optimization */
    @media (max-width: 640px) {
      .breadcrumb-constellation {
        padding: 16px 8px;
        min-height: 80px;
      }

      .node-connector {
        width: 24px;
      }

      .node-bubble {
        padding: 8px 12px;
      }

      .node-link {
        font-size: 12px;
        gap: 6px;
      }

      .node-icon {
        font-size: 16px;
      }

      .node-name {
        max-width: 100px;
      }

      .node-badge {
        font-size: 8px;
        padding: 1px 6px;
      }
    }

    /* Glass Action Buttons */
   .action-button {
  background: rgba(255,255,255,0.22);
  border: 1px solid rgba(255,255,255,0.28);
  box-shadow:
    inset 0 1px 0 rgba(255,255,255,0.35),
    0 4px 12px rgba(0,0,0,0.12);
}


    .action-button::before {
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

    .action-button:hover {
      background: rgba(255, 255, 255, 0.35);
      transform: translateY(-2px);
    }

    .action-button:hover::before {
      opacity: 1;
      transform: translateX(30%) translateY(10%);
    }

    .owner-info {
      font-size: 14px;
      color: white;
      font-weight: 600;
      margin-bottom: 8px;
      text-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
    }

    .owner-info a {
      color: white;
      text-decoration: none;
      transition: all 0.2s;
      border-bottom: 1px solid rgba(255, 255, 255, 0.3);
    }

    .owner-info a:hover {
      border-bottom-color: white;
      text-shadow: 0 0 8px rgba(255, 255, 255, 0.8);
    }

    h1 {
      font-size: 28px;
      margin: 12px 0;
      font-weight: 600;
      line-height: 1.3;
      letter-spacing: -0.5px;
    }

    h1 a {
      color: white;
      text-decoration: none;
      transition: all 0.2s;
      text-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
    }

    h1 a:hover {
      text-shadow: 0 0 12px rgba(255, 255, 255, 0.8);
      transform: translateX(4px);
      display: inline-block;
    }

    code {
      background: transparent;
      padding: 0;
      border-radius: 0;
      font-size: 13px;
      font-family: 'SF Mono', Monaco, 'Cascadia Code', monospace;
      color: white;
      word-break: break-all;
    }

    /* Section Headers */
    h2 {
      font-size: 18px;
      margin: 24px 0 16px 0;
      font-weight: 600;
      color: white;
      text-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
      letter-spacing: -0.3px;
    }

    h3 {
      font-size: 16px;
      margin: 20px 0 12px 0;
      font-weight: 600;
      color: white;
      text-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
    }

    /* Filter Buttons */
    #filterButtons {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin: 16px 0;
    }

    #filterButtons a {
      display: inline-flex;
      align-items: center;
      padding: 8px 16px;
      font-size: 13px;
      border-radius: 980px;
      color: white;
      font-weight: 600;
transition:
  transform 0.3s cubic-bezier(0.4, 0, 0.2, 1),
  background-color 0.3s ease,
  opacity 0.3s ease;         text-decoration: none;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
      border: 1px solid rgba(255, 255, 255, 0.3);
      position: relative;
      overflow: hidden;
    }

    #filterButtons a::before {
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

    #filterButtons a:hover {
      transform: translateY(-2px);
    }

    #filterButtons a:hover::before {
      opacity: 1;
      transform: translateX(30%) translateY(10%);
    }

    /* Tree Structure - Keep rainbow colors */
    ul {
      list-style: none;
      padding-left: 16px;
      margin: 12px 0;
    }

    li {
      margin: 8px 0;
      word-wrap: break-word;
      overflow-wrap: break-word;
    }

    li a {
      color: white;
      text-decoration: none;
      font-weight: 500;
      transition: all 0.2s;
      position: relative;
      display: inline-block;
    }

    li a:hover {
      text-shadow: 0 0 8px rgba(255, 255, 255, 0.8);
      transform: translateX(4px);
    }

    /* Parents/Children with colored borders - keep the rainbow */
    li[style*="border-left"] {
      padding-left: 12px !important;
      margin: 6px 0 !important;
      position: relative;
      background: rgba(255, 255, 255, 0.05);
      border-radius: 6px;
      padding: 8px 12px !important;
      transition: all 0.2s;
    }

    li[style*="border-left"]:hover {
      background: rgba(255, 255, 255, 0.1);
      transform: translateX(4px);
    }

    /* Glass Forms */
    form {
      margin: 16px 0;
    }

    input[type="text"],
    select {
      width: 100%;
      padding: 12px 14px;
      font-size: 15px;
      border-radius: 10px;
      border: 2px solid rgba(255, 255, 255, 0.3);
      background: rgba(255, 255, 255, 0.15);
      font-family: inherit;
transition:
  transform 0.3s cubic-bezier(0.4, 0, 0.2, 1),
  background-color 0.3s ease,
  opacity 0.3s ease;
        color: white;
      font-weight: 500;
    }

    input[type="text"]::placeholder {
      color: rgba(255, 255, 255, 0.5);
    }

    input[type="text"]:focus,
    select:focus {
      outline: none;
      border-color: rgba(255, 255, 255, 0.6);
      background: rgba(255, 255, 255, 0.25);
      box-shadow: 0 0 0 3px rgba(255, 255, 255, 0.15);
      transform: translateY(-2px);
    }

    select option {
      background: #667eea;
      color: white;
    }

    button[type="submit"] {
      padding: 10px 18px;
      border-radius: 980px;
      border: 1px solid rgba(255, 255, 255, 0.3);
      background: rgba(255, 255, 255, 0.25);
      color: white;
      cursor: pointer;
      font-weight: 600;
      font-size: 14px;
transition:
  transform 0.3s cubic-bezier(0.4, 0, 0.2, 1),
  background-color 0.3s ease,
  opacity 0.3s ease;
        font-family: inherit;
      position: relative;
      overflow: hidden;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
    }

    button[type="submit"]::before {
      content: "";
      position: absolute;
      inset: -40%;

      opacity: 0;
      transform: translateX(-30%) translateY(-10%);
      transition: opacity 0.35s ease, transform 0.6s cubic-bezier(0.22, 1, 0.36, 1);
      pointer-events: none;
    }

    button[type="submit"]:hover {
      background: rgba(255, 255, 255, 0.35);
      transform: translateY(-1px);
    }

    button[type="submit"]:hover::before {
      opacity: 1;
      transform: translateX(30%) translateY(10%);
    }

    /* Invite Form */
    form[action*="/invite"] {
      display: flex;
      flex-direction: column;
      gap: 10px;
      max-width: 100%;
    }

    @media (min-width: 640px) {
      form[action*="/invite"] {
        flex-direction: row;
        max-width: 500px;
      }

      form[action*="/invite"] input[type="text"] {
        flex: 1;
      }

      form[action*="/invite"] button {
        width: auto;
      }
    }

    /* Contributors - Glass List Items */
    .contributors-list {
      list-style: none;
      padding-left: 0;
    }

    .contributors-list li {
      display: flex;
      flex-direction: column;
      gap: 8px;
      padding: 14px 16px;
      background: rgba(255, 255, 255, 0.12);
      border-radius: 10px;
      margin: 8px 0;
      border: 1px solid rgba(255, 255, 255, 0.25);
transition:
  transform 0.3s cubic-bezier(0.4, 0, 0.2, 1),
  background-color 0.3s ease,
  opacity 0.3s ease;
      }

    .contributors-list li:hover {
      background: rgba(255, 255, 255, 0.18);
      transform: translateX(4px);
    }

    @media (min-width: 640px) {
      .contributors-list li {
        flex-direction: row;
        align-items: center;
        justify-content: space-between;
      }
    }

    .contributors-list a {
      font-weight: 600;
      color: white;
      text-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
    }

    .contributors-list form {
      display: inline-block;
      margin: 0;
    }

    .contributors-list button {
      padding: 6px 12px;
      font-size: 13px;
      border-radius: 980px;
      border: 1px solid rgba(255, 255, 255, 0.3);
      cursor: pointer;
      transition: all 0.2s;
    }

    .contributors-list button:hover {
      transform: translateY(-1px);
    }

    .contributors-actions {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
    }

    /* Retire Button */
    form[action*="/retire"] button {
      background: rgba(239, 68, 68, 0.3) !important;
      border: 1px solid rgba(239, 68, 68, 0.5) !important;
    }

    form[action*="/retire"] button:hover {
      background: rgba(239, 68, 68, 0.5) !important;
      transform: translateY(-2px);
    }

.glass-shadow {
  position: absolute;
  inset: 0;
  border-radius: inherit;
  box-shadow: 0 12px 32px rgba(0,0,0,0.18);
  opacity: 0;
  transition: opacity 0.3s ease;
  pointer-events: none;
}
  :hover > .glass-shadow {
  opacity: 1;
}

    /* Responsive Design */
    @media (max-width: 640px) {
  ul {
    padding-left: 6px;
  }
}
  @media (max-width: 640px) {
  .tree-node {
    padding: 6px 8px;
  }
}
  @media (max-width: 640px) {
  .tree-node {
    margin-left: 0;
  }

  li[style*="border-left"] {
    padding-left: 8px !important;
  }
}
@media (max-width: 640px) {
  .tree-node,
  .tree-node:hover,
  li[style*="border-left"],
  li[style*="border-left"]:hover {
    transform: none !important;
  }
}
@media (max-width: 640px) {
  li[style*="border-left"] {
    padding-left: 8px !important;
    margin-left: 0 !important;
  }
}
@media (hover: none) {
  .tree-node:hover::before {
    opacity: 0;
    transform: none;
  }
}

    @media (max-width: 640px) {
      .content-card {
        padding: 20px;
      }

      h1 {
        font-size: 24px;
      }

      ul {
        padding-left: 8px;
      }
    }

.tree-node {
  position: relative;
  padding: 8px 12px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.12);
  border: 1px solid rgba(255, 255, 255, 0.22);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.35),
    0 4px 12px rgba(0, 0, 0, 0.12);

  transition:
    transform 0.25s cubic-bezier(0.4, 0, 0.2, 1),
    background-color 0.25s ease,
    box-shadow 0.25s ease;
}



  /* Custom dropdown (replaces native <select> to avoid iframe glitch on mobile) */
  .custom-select { position: relative; width: 100%; max-width: 360px; }
  .custom-select-trigger {
    padding: 12px 14px; font-size: 15px; border-radius: 10px;
    border: 2px solid rgba(255, 255, 255, 0.3);
    background: rgba(255, 255, 255, 0.15); color: white;
    cursor: pointer; display: flex; align-items: center;
    justify-content: space-between; gap: 8px;
    font-weight: 500;
    -webkit-user-select: none; user-select: none;
    transition: all 0.3s ease;
  }
  .custom-select-trigger::after { content: "\u25BE"; font-size: 11px; opacity: 0.6; flex-shrink: 0; }
  .custom-select.open .custom-select-trigger {
    border-color: rgba(255, 255, 255, 0.6);
    background: rgba(255, 255, 255, 0.25);
    box-shadow: 0 0 0 3px rgba(255, 255, 255, 0.15);
  }
  .custom-select.open .custom-select-trigger::after { content: "\u25B4"; }
  .custom-select-options {
    display: none; position: absolute; left: 0; right: 0;
    bottom: calc(100% + 4px);
    background: rgba(102, 126, 234, 0.95);
    backdrop-filter: blur(12px);
    border: 1px solid rgba(255, 255, 255, 0.3); border-radius: 10px;
    overflow: hidden; z-index: 100; max-height: 220px; overflow-y: auto;
    box-shadow: 0 -4px 16px rgba(0,0,0,0.2);
  }
  .custom-select.open .custom-select-options { display: block; }
  .custom-select-option {
    padding: 10px 14px; font-size: 14px; color: rgba(255, 255, 255, 0.85);
    cursor: pointer; transition: background 0.15s;
  }
  .custom-select-option:hover { background: rgba(255, 255, 255, 0.15); }
  .custom-select-option.selected { background: rgba(255, 255, 255, 0.2); color: white; font-weight: 600; }

  /* Root entry in tree */
  .root-entry {
    background: rgba(255, 255, 255, 0.18) !important;
    border: 1px solid rgba(255, 255, 255, 0.30);
    border-left: 4px solid !important;
  }
  .root-entry > a {
    font-weight: 700;
    font-size: 16px;
  }

  /* Settings groups inside ownership card */
  .settings-group {
    padding: 16px 0;
    border-bottom: 1px solid rgba(255, 255, 255, 0.15);
  }
  .settings-group:last-child {
    border-bottom: none;
    padding-bottom: 0;
  }
  .settings-group:first-child {
    padding-top: 0;
  }
  .settings-group h3 {
    margin-top: 0;
    margin-bottom: 12px;
    font-size: 15px;
    opacity: 0.85;
  }
  .settings-group h2 {
    margin-top: 0;
  }
`;

  const body = `
  <div class="container">
    ${
      currentUserId
        ? `
    <!-- Back Navigation -->
    <div class="back-nav">
      <a href="/api/v1/user/${currentUserId}${queryString}" class="back-link">
        <- Back to Profile
      </a>
        <a href="/api/v1/root/${allData._id}/calendar${queryString}" class="back-link">
        Calendar
      </a>
      </a>
        <a href="/api/v1/root/${allData._id}/book${queryString}" class="back-link">
        Book
      </a>
       </a>
        <a href="/api/v1/root/${allData._id}/values${queryString}" class="back-link">
        Global Values
      </a>
      </a>
        <a href="/api/v1/root/${allData._id}/understandings${queryString}" class="back-link">
        Understandings
      </a>
        <a href="/api/v1/root/${allData._id}/chats${queryString}" class="back-link">
        AI Chats
      </a>
    </div>
    `
        : ""
    }
    <!-- Navigation Path (only if not root) -->
    ${
      ancestors.length
        ? `
    <div class="content-card">
      <div class="section-header">
        <h2>Navigation Path</h2>
      </div>
      ${parentHtml}
    </div>
    `
        : ""
    }

    <!-- Tree Card (root + children unified) -->
    <div class="content-card">
      <div class="section-header">
        <h2>Tree: <a href="/api/v1/node/${allData._id}/0${queryString}">${escapeHtml(allData.name)}</a></h2>
      </div>
      <div id="filterButtons"></div>
      ${treeHtml}
    </div>

    ${isPublicAccess ? `
    <div style="text-align:center;padding:16px 20px;background:rgba(72,187,120,0.1);border:1px solid rgba(72,187,120,0.25);border-radius:12px;margin:16px 0;color:rgba(255,255,255,0.8);font-size:0.9rem;">
      Viewing public tree${queryAvailable ? ". You can query this tree using the API." : "."}
    </div>
    ` : ""}

    ${!isPublicAccess ? `
    <!-- Deferred Items (Short-Term Holdings) -->
    <div class="content-card">
      <div class="section-header">
        <h2>Short-Term Holdings ${deferredItems.length > 0 ? `<span style="font-size:0.7em;color:#ffb347;">(${deferredItems.length})</span>` : ""}</h2>
      </div>
      ${deferredHtml}
    </div>
    ` : ""}

    <!-- Tree Settings Section -->
${
  !isPublicAccess && (isOwner ||
  rootMeta?.contributors?.some(
    (c) => c._id.toString() === userId?.toString(),
  ))
    ? `

  ${isOwner ? `
<div class="content-card">
  <div class="section-header">
    <h2>Visibility</h2>
  </div>
  <p style="color:rgba(255,255,255,0.7);font-size:0.85rem;margin:0 0 12px">
    Public trees can be browsed and queried by anyone without authentication.
    If an LLM is assigned to the placement slot, anonymous visitors can query the tree (you pay energy).
  </p>
  <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
    <select id="visibilitySelect"
      style="padding:8px 12px;border-radius:8px;border:1px solid rgba(255,255,255,0.15);
             background:rgba(255,255,255,0.06);color:#fff;font-size:0.95rem;min-width:140px">
      <option value="private" ${rootMeta.visibility || "private" === "private" ? "selected" : ""}>Private</option>
      <option value="public" ${rootMeta.visibility === "public" ? "selected" : ""}>Public</option>
    </select>
    <button onclick="saveVisibility()" style="padding:8px 14px;border-radius:8px;
      border:1px solid rgba(72,187,120,0.4);background:rgba(72,187,120,0.15);
      color:rgba(72,187,120,0.9);font-weight:600;cursor:pointer">Save</button>
    <span id="visibilityStatus" style="display:none;font-size:0.85rem"></span>
  </div>
</div>

<div class="content-card">
  <div class="section-header">
    <h2>Tree Dream</h2>
  </div>
  <p style="color:rgba(255,255,255,0.7);font-size:0.85rem;margin:0 0 12px">
    Schedule a daily maintenance cycle: cleanup, process deferred items,
    and update tree understanding.
  </p>
  <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
    <input type="time" id="dreamTimeInput" value="${rootMeta.metadata?.dreams?.dreamTime || ""}"
      style="padding:8px 12px;border-radius:8px;border:1px solid rgba(255,255,255,0.15);
             background:rgba(255,255,255,0.06);color:#fff;font-size:0.95rem" />
    <button onclick="saveDreamTime()" style="padding:8px 14px;border-radius:8px;
      border:1px solid rgba(72,187,120,0.4);background:rgba(72,187,120,0.15);
      color:rgba(72,187,120,0.9);font-weight:600;cursor:pointer">Save</button>
    <button onclick="clearDreamTime()" style="padding:8px 14px;border-radius:8px;
      border:1px solid rgba(255,107,107,0.4);background:rgba(255,107,107,0.1);
      color:rgba(255,107,107,0.8);cursor:pointer">Disable</button>
    <span id="dreamTimeStatus" style="display:none;font-size:0.85rem"></span>
  </div>
  ${rootMeta.metadata?.dreams?.lastDreamAt ? `<p style="color:rgba(255,255,255,0.6);font-size:0.8rem;margin:8px 0 0">Last dream: ${new Date(rootMeta.metadata?.dreams?.lastDreamAt).toLocaleString()}</p>` : ""}
</div>
  ` : ""}

<div class="content-card">
  <div class="section-header">
    <h2>Team</h2>
  </div>
  ${ownerHtml}
  ${contributorsHtml}
  ${inviteFormHtml}
</div>

  ${policyHtml ? `
<div class="content-card">
  <div class="section-header">
    <h2>Transaction Policy</h2>
  </div>
  ${policyHtml}
</div>` : ""}

  ${treeLlmHtml ? `
<div class="content-card">
  <div class="section-header">
    <h2>Tree Models</h2>
  </div>
  ${treeLlmHtml}
</div>` : ""}

  ${isOwner ? `
<div class="content-card">
  <div class="section-header">
    <h2>Gateway</h2>
  </div>
  <p style="color:rgba(255,255,255,0.7);font-size:0.85rem;margin:0 0 12px">
    Manage output channels for this tree -- send dream summaries and notifications to Telegram, Discord, or your browser.
  </p>
  <a href="/api/v1/root/${nodeId}/gateway${queryString}"
     style="display:inline-block;padding:8px 16px;border-radius:8px;
            border:1px solid rgba(115,111,230,0.4);background:rgba(115,111,230,0.15);
            color:rgba(200,200,255,0.95);font-weight:600;text-decoration:none;
            font-size:0.9rem;cursor:pointer">
    Manage Channels
  </a>
</div>
  ` : ""}

  ${
    !isOwner && userId
      ? `
<div class="content-card">
  <div class="section-header">
    <h2>Leave Tree</h2>
  </div>
  <form
    method="POST"
    action="/api/v1/root/${nodeId}/remove-user?token=${encodeURIComponent(token)}&html"
    onsubmit="return confirm('Are you sure you want to leave this tree?')"
  >
    <input type="hidden" name="userReceiving" value="${userId}" />
    <button
      type="submit"
      style="
        padding:8px 14px;
        border-radius:8px;
        border:1px solid #900;
        background:rgba(239, 68, 68, 0.15);
        color:#ff6b6b;
        font-weight:600;
        cursor:pointer;
      "
    >
      Leave Tree
    </button>
  </form>
</div>
  `
      : ""
  }

  ${
    retireHtml
      ? `
<div class="content-card">
  <div class="section-header">
    <h2>Retire Tree</h2>
  </div>
  ${retireHtml}
</div>
  `
      : ""
  }
`
    : ""
}

  </div>
`;

  const js = `
// VISIBILITY
async function saveVisibility() {
  var select = document.getElementById("visibilitySelect");
  var status = document.getElementById("visibilityStatus");
  if (!select) return;
  try {
    var res = await fetch("/api/v1/root/${nodeId}/visibility", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ visibility: select.value }),
    });
    if (res.ok) {
      if (status) {
        status.style.display = "inline";
        status.style.color = "rgba(72, 187, 120, 0.9)";
        status.textContent = select.value === "public" ? "Now public" : "Now private";
        setTimeout(function() { status.style.display = "none"; }, 3000);
      }
    } else {
      var data = await res.json().catch(function() { return {}; });
      if (status) {
        status.style.display = "inline";
        status.style.color = "rgba(255, 107, 107, 0.9)";
        status.textContent = (data.error && data.error.message) || data.error || "Failed";
      }
    }
  } catch (err) {
    if (status) {
      status.style.display = "inline";
      status.style.color = "rgba(255, 107, 107, 0.9)";
      status.textContent = "Error";
    }
  }
}

// DREAM TIME
async function saveDreamTime() {
  var input = document.getElementById("dreamTimeInput");
  var status = document.getElementById("dreamTimeStatus");
  try {
    var res = await fetch("/api/v1/root/${nodeId}/dream-time", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dreamTime: input.value || null }),
    });
    if (res.ok) {
      if (status) {
        status.style.display = "inline";
        status.style.color = "rgba(72, 187, 120, 0.9)";
        status.textContent = input.value ? "Saved" : "Disabled";
        setTimeout(function() { status.style.display = "none"; }, 3000);
      }
    } else {
      var data = await res.json().catch(function() { return {}; });
      if (status) {
        status.style.display = "inline";
        status.style.color = "rgba(255, 107, 107, 0.9)";
        status.textContent = (data.error && data.error.message) || data.error || "Failed";
      }
    }
  } catch (err) {
    if (status) {
      status.style.display = "inline";
      status.style.color = "rgba(255, 107, 107, 0.9)";
      status.textContent = "Network error";
    }
  }
}
async function clearDreamTime() {
  document.getElementById("dreamTimeInput").value = "";
  saveDreamTime();
}

// ROOT LLM ASSIGNMENT
async function assignRootLlm(slot, connId) {
  var statusEl = document.querySelector(".llm-assign-status");
  try {
    var res = await fetch("/api/v1/root/${nodeId}/llm-assign", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slot: slot, connectionId: connId || null }),
    });
    if (res.ok) {
      if (statusEl) {
        statusEl.style.display = "block";
        statusEl.style.color = "rgba(72, 187, 120, 0.9)";
        statusEl.textContent = connId ? "\\u2713 Assigned" : "\\u2713 Using default";
        setTimeout(function() { statusEl.style.display = "none"; }, 3000);
      }
    } else {
      var data = await res.json().catch(function() { return {}; });
      if (statusEl) {
        statusEl.style.display = "block";
        statusEl.style.color = "rgba(255, 107, 107, 0.9)";
        statusEl.textContent = "\\u2715 " + ((data.error && data.error.message) || data.error || "Failed");
      }
    }
  } catch (err) {
    if (statusEl) {
      statusEl.style.display = "block";
      statusEl.style.color = "rgba(255, 107, 107, 0.9)";
      statusEl.textContent = "\\u2715 Network error";
    }
  }
}

// CUSTOM DROPDOWN HANDLER
(function() {
  document.querySelectorAll(".custom-select").forEach(function(sel) {
    var trigger = sel.querySelector(".custom-select-trigger");
    if (!trigger) return;
    trigger.addEventListener("click", function(e) {
      e.stopPropagation();
      var wasOpen = sel.classList.contains("open");
      document.querySelectorAll(".custom-select.open").forEach(function(s) { s.classList.remove("open"); });
      if (!wasOpen) sel.classList.add("open");
    });
    sel.querySelectorAll(".custom-select-option").forEach(function(opt) {
      opt.addEventListener("click", function(e) {
        e.stopPropagation();
        sel.querySelectorAll(".custom-select-option").forEach(function(o) { o.classList.remove("selected"); });
        opt.classList.add("selected");
        trigger.textContent = opt.textContent;
        sel.classList.remove("open");
        assignRootLlm(sel.getAttribute("data-slot") || "placement", opt.getAttribute("data-value"));
      });
    });
  });
  document.addEventListener("click", function() {
    document.querySelectorAll(".custom-select.open").forEach(function(s) { s.classList.remove("open"); });
  });
})();

// AUTO-SCROLL BREADCRUMB TO RIGHT ON LOAD
window.addEventListener('load', () => {
  const breadcrumb = document.querySelector('.breadcrumb-constellation');
  if (breadcrumb) {
    breadcrumb.scrollLeft = breadcrumb.scrollWidth;
  }
});

// HORIZONTAL SCROLL WITH MOUSE WHEEL - Breadcrumb
const breadcrumb = document.querySelector('.breadcrumb-constellation');
if (breadcrumb) {
  breadcrumb.addEventListener('wheel', (e) => {
    e.preventDefault();
    breadcrumb.scrollLeft += e.deltaY;
  });
}

// Breadcrumb bubble click handling - links work normally
document.addEventListener('click', (e) => {
  const link = e.target.closest('.node-link');
  if (link && !e.defaultPrevented) {
    // Just let the link work normally
    return;
  }
});

// Tree node click handling (existing)
document.addEventListener('click', (e) => {
  const node = e.target.closest('.tree-node');
  if (!node) return;

  // Ignore real navigation
  if (e.target.closest('a, button')) return;

  const link = node.querySelector(':scope > a');
  if (!link) return;

  e.preventDefault();

  const OFFSET = 50;

  const rect = link.getBoundingClientRect();
  const scrollTop = window.pageYOffset || document.documentElement.scrollTop;

  const targetY = rect.top + scrollTop - OFFSET;

  window.scrollTo({
    top: targetY,
    behavior: 'smooth'
  });

  // Optional glow pulse
  link.animate(
    [
      { boxShadow: '0 0 0 rgba(255,255,255,0)' },
      { boxShadow: '0 0 24px rgba(255,255,255,0.6)' },
      { boxShadow: '0 0 0 rgba(255,255,255,0)' }
    ],
    { duration: 900, easing: 'ease-out' }
  );
});

// Filter toggles
const params = new URLSearchParams(window.location.search);

function paramIsOn(param, current) {
  if (current === "true") return true;
  if (current === "false") return false;
  if (param === "active" || param === "completed") return true;
  return false;
}

function makeToggle(param) {
  const current = params.get(param);
  const isOn = paramIsOn(param, current);
  const nextValue = isOn ? "false" : "true";

  const newParams = new URLSearchParams(params);
  newParams.set(param, nextValue);

  const url = window.location.pathname + "?" + newParams.toString();
  const color = isOn ? "#4CAF50" : "#9E9E9E";

  return (
    '<a href="' + url + '" ' +
    'style="background:' + color + ';">' +
      param +
    '</a>'
  );
}

document.getElementById("filterButtons").innerHTML =
  makeToggle("active") +
  makeToggle("completed") +
  makeToggle("trimmed") +
  '<a href="#" id="copyNodeIdBtn" title="Copy Node ID" style="background:rgba(var(--glass-water-rgb),0.35);">\\ud83d\\udccb</a>';

document.getElementById("copyNodeIdBtn").addEventListener("click", function(e) {
  e.preventDefault();
  navigator.clipboard.writeText("${allData._id}").then(function() {
    var b = document.getElementById("copyNodeIdBtn");
    b.textContent = "\\u2714\\ufe0f";
    setTimeout(function() { b.textContent = "\\ud83d\\udccb"; }, 900);
  });
});
`;

  return page({
    title: `${escapeHtml(allData.name)} - TreeOS`,
    css,
    body,
    js,
  });
}
