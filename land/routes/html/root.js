/* ------------------------------------------------- */
/* HTML renderers for root.js pages                   */
/* ------------------------------------------------- */

function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// Rainbow colors by depth
const rainbow = [
  "#ff3b30",
  "#ff9500",
  "#ffcc00",
  "#34c759",
  "#32ade6",
  "#5856d6",
  "#af52de",
];

// ─────────────────────────────────────────────────────────────────────────
// 1. renderRootOverview
// ─────────────────────────────────────────────────────────────────────────

export function renderRootOverview({
  allData,
  rootMeta,
  ancestors,
  isOwner,
  isDeleted,
  isRoot,
  currentUserId,
  queryString,
  nodeId,
  userId,
  token,
  deferredItems,
  deferredHtml,
  ownerConnections,
}) {
  let rootNameColor = "rgba(255, 255, 255, 0.4)";
  if (isDeleted) {
    rootNameColor = "#b00020";
  }

  const transactionPolicy = rootMeta?.transactionPolicy ?? "OWNER_ONLY";

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


      <a href="/api/v1/node/${node._id}/${node.prestige}${queryString}">
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
  action="/api/v1/root/${nodeId}/invite?token=${token}&html"
  style="display:flex; gap:8px; max-width:420px; margin-top:12px;"
>
  <input
    type="text"
    name="userReceiving"
    placeholder="Username or User ID"
    required
  />

  <button type="submit">
    Invite
  </button>
</form>
`
    : ``;

  const policyHtml = isOwner
    ? `

<form
  method="POST"
  action="/api/v1/root/${nodeId}/transaction-policy?token=${token}&html"
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
  <div class="contributors-actions">
    ${
      isOwner
        ? `
      <form
        method="POST"
        action="/api/v1/root/${nodeId}/transfer-owner?token=${token}&html"
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
        action="/api/v1/root/${nodeId}/remove-user?token=${token}&html"
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
  action="/api/v1/root/${nodeId}/retire?token=${token}&html"
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
      { key: "placement", label: "Placement" },
      { key: "understanding", label: "Understanding" },
      { key: "respond", label: "Respond" },
      { key: "notes", label: "Notes" },
      { key: "cleanup", label: "Cleanup" },
      { key: "drain", label: "Drain" },
      { key: "notification", label: "Notification" },
    ];

    function buildSlotHtml(slot) {
      const current = rootMeta.llmAssignments?.[slot.key] || null;
      const optHtml = ownerConnections.map(function(c) {
        return '<div class="custom-select-option' + (current === c._id ? ' selected' : '') + '" data-value="' + c._id + '">'
          + escapeHtml(c.name) + ' (' + escapeHtml(c.model) + ')</div>';
      }).join('');
      const label = current
        ? (function() { var m = ownerConnections.find(function(c){return c._id === current;}); return m ? escapeHtml(m.name) + ' (' + escapeHtml(m.model) + ')' : 'Account default'; })()
        : 'Account default';
      return `<p style="font-size:0.85em;opacity:0.6;margin-bottom:4px;margin-top:10px;">${slot.label}</p>
  <div class="custom-select" data-slot="${slot.key}" style="margin-bottom:4px;">
    <div class="custom-select-trigger">${label}</div>
    <div class="custom-select-options">
      <div class="custom-select-option${!current ? ' selected' : ''}" data-value="">Account default</div>
      ${optHtml}
    </div>
  </div>`;
    }

    treeLlmHtml = `
<h3>AI Models</h3>
<p style="font-size:0.85em;opacity:0.5;margin-bottom:8px;">If set to account default, your account's main LLM is used. To allow contributors access to AI on this tree, you must explicitly assign a model to each slot.</p>
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
          <a href="/api/v1/node/${allData._id}/${allData.prestige}${queryString}">
            ${escapeHtml(allData.name)}
          </a>
          ${childrenInner}
        </li>
      </ul>`;

  const jsonDump = JSON.stringify(allData, null, 2)
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="theme-color" content="#667eea">
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<title>${escapeHtml(allData.name)} - TreeOS</title>
  <style>
   :root {
      --glass-water-rgb: 115, 111, 230;
      --glass-alpha: 0.28;
      --glass-alpha-hover: 0.38;
    }

    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
      -webkit-tap-highlight-color: transparent;
    }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen', 'Ubuntu', 'Cantarell', sans-serif;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      min-height: 100vh;
      padding: 20px;
      color: #1a1a1a;
      position: relative;
      overflow-x: hidden;
      touch-action: manipulation;
    }

    /* Animated background */
    body::before,
    body::after {
      content: '';
      position: fixed;
      border-radius: 50%;
      opacity: 0.08;
      animation: float 20s infinite ease-in-out;
      pointer-events: none;
    }

    body::before {
      width: 600px;
      height: 600px;
      background: white;
      top: -300px;
      right: -200px;
      animation-delay: -5s;
    }

    body::after {
      width: 400px;
      height: 400px;
      background: white;
      bottom: -200px;
      left: -100px;
      animation-delay: -10s;
    }

    .current {
    color: rgb(51, 66, 85);}

    @keyframes float {
      0%, 100% {
        transform: translateY(0) rotate(0deg);
      }
      50% {
        transform: translateY(-30px) rotate(5deg);
      }
    }

    @keyframes fadeInUp {
      from {
        opacity: 0;
        transform: translateY(30px);
      }
      to {
        opacity: 1;
        transform: translateY(0);
      }
    }

    .container {
      max-width: 900px;
      margin: 0 auto;
      position: relative;
      z-index: 1;
    }

    /* Glass Back Navigation */
    .back-nav {
      display: flex;
      gap: 12px;
      margin-bottom: 20px;
      flex-wrap: wrap;
      animation: fadeInUp 0.5s ease-out;
    }

    .back-link {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 10px 16px;
      background: rgba(var(--glass-water-rgb), var(--glass-alpha));
      color: white;
      text-decoration: none;
      border-radius: 980px;
      font-weight: 600;
      font-size: 14px;
transition:
  transform 0.3s cubic-bezier(0.4, 0, 0.2, 1),
  background-color 0.3s ease,
  opacity 0.3s ease;
     box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12),
        inset 0 1px 0 rgba(255, 255, 255, 0.25);
      border: 1px solid rgba(255, 255, 255, 0.28);
      position: relative;
      overflow: hidden;
      touch-action: manipulation;
    }

    .back-link::before {
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

    .back-link:hover {
      background: rgba(var(--glass-water-rgb), var(--glass-alpha-hover));
      transform: translateY(-2px);
    }

    .back-link:hover::before {
      opacity: 1;
      transform: translateX(30%) translateY(10%);
    }

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
  overflow: hidden;
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
   html, body {
        background: #736fe6;
        margin: 0;
        padding: 0;
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
      body {
        padding: 16px;
      }

      .content-card {
        padding: 20px;
      }

      h1 {
        font-size: 24px;
      }

      .back-nav {
        flex-direction: column;
      }

      .back-link {
        justify-content: center;
      }

      ul {
        padding-left: 8px;
      }

    }

    @media (min-width: 641px) and (max-width: 1024px) {
      .container {
        max-width: 700px;
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
  .custom-select-trigger::after { content: "▾"; font-size: 11px; opacity: 0.6; flex-shrink: 0; }
  .custom-select.open .custom-select-trigger {
    border-color: rgba(255, 255, 255, 0.6);
    background: rgba(255, 255, 255, 0.25);
    box-shadow: 0 0 0 3px rgba(255, 255, 255, 0.15);
  }
  .custom-select.open .custom-select-trigger::after { content: "▴"; }
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

  </style>
</head>
<body>
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
        <h2>Tree: <a href="/api/v1/node/${allData._id}/${allData.prestige}${queryString}">${escapeHtml(allData.name)}</a></h2>
      </div>
      <div id="filterButtons"></div>
      ${treeHtml}
    </div>

    <!-- Deferred Items (Short-Term Holdings) -->
    <div class="content-card">
      <div class="section-header">
        <h2>Short-Term Holdings ${deferredItems.length > 0 ? `<span style="font-size:0.7em;color:#ffb347;">(${deferredItems.length})</span>` : ""}</h2>
      </div>
      ${deferredHtml}
    </div>

    <!-- Tree Settings Section -->
${
  isOwner ||
  rootMeta?.contributors?.some(
    (c) => c._id.toString() === userId?.toString(),
  )
    ? `

  ${isOwner ? `
<div class="content-card">
  <div class="section-header">
    <h2>Tree Dream</h2>
  </div>
  <p style="color:rgba(255,255,255,0.7);font-size:0.85rem;margin:0 0 12px">
    Schedule a daily maintenance cycle: cleanup, process deferred items,
    and update tree understanding.
  </p>
  <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
    <input type="time" id="dreamTimeInput" value="${rootMeta.dreamTime || ""}"
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
  ${rootMeta.lastDreamAt ? `<p style="color:rgba(255,255,255,0.6);font-size:0.8rem;margin:8px 0 0">Last dream: ${new Date(rootMeta.lastDreamAt).toLocaleString()}</p>` : ""}
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
    action="/api/v1/root/${nodeId}/remove-user?token=${token}&html"
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


<script>
// DREAM TIME
async function saveDreamTime() {
  var input = document.getElementById("dreamTimeInput");
  var status = document.getElementById("dreamTimeStatus");
  try {
    var res = await fetch("/api/v1/root/${nodeId}/dream-time", {
      method: "POST",
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
        status.textContent = data.error || "Failed";
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
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slot: slot, connectionId: connId || null }),
    });
    if (res.ok) {
      if (statusEl) {
        statusEl.style.display = "block";
        statusEl.style.color = "rgba(72, 187, 120, 0.9)";
        statusEl.textContent = connId ? "✓ Assigned" : "✓ Using default";
        setTimeout(function() { statusEl.style.display = "none"; }, 3000);
      }
    } else {
      var data = await res.json().catch(function() { return {}; });
      if (statusEl) {
        statusEl.style.display = "block";
        statusEl.style.color = "rgba(255, 107, 107, 0.9)";
        statusEl.textContent = "✕ " + (data.error || "Failed");
      }
    }
  } catch (err) {
    if (statusEl) {
      statusEl.style.display = "block";
      statusEl.style.color = "rgba(255, 107, 107, 0.9)";
      statusEl.textContent = "✕ Network error";
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
</script>

  <script>
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
      '<a href="#" id="copyNodeIdBtn" title="Copy Node ID" style="background:rgba(var(--glass-water-rgb),0.35);">📋</a>';

    document.getElementById("copyNodeIdBtn").addEventListener("click", function(e) {
      e.preventDefault();
      navigator.clipboard.writeText("${allData._id}").then(function() {
        var b = document.getElementById("copyNodeIdBtn");
        b.textContent = "✔️";
        setTimeout(function() { b.textContent = "📋"; }, 900);
      });
    });
  </script>

</body>
</html>
`;
}


// ─────────────────────────────────────────────────────────────────────────
// 2. renderCalendar
// ─────────────────────────────────────────────────────────────────────────

export function renderCalendar({ rootId, queryString, month, year, byDay }) {
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="theme-color" content="#667eea">
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
  <title>Calendar</title>
  <style>
    :root {
      --glass-water-rgb: 115, 111, 230;
      --glass-alpha: 0.28;
      --glass-alpha-hover: 0.38;
    }

    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
      -webkit-tap-highlight-color: transparent;
    }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen', 'Ubuntu', 'Cantarell', sans-serif;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      min-height: 100vh;
      padding: 20px;
      color: white;
      position: relative;
      overflow-x: hidden;
    }

    /* Animated background */
    body::before,
    body::after {
      content: '';
      position: fixed;
      border-radius: 50%;
      opacity: 0.08;
      animation: float 20s infinite ease-in-out;
      pointer-events: none;
    }

    body::before {
      width: 600px;
      height: 600px;
      background: white;
      top: -300px;
      right: -200px;
      animation-delay: -5s;
    }

    body::after {
      width: 400px;
      height: 400px;
      background: white;
      bottom: -200px;
      left: -100px;
      animation-delay: -10s;
    }

    @keyframes float {
      0%, 100% {
        transform: translateY(0) rotate(0deg);
      }
      50% {
        transform: translateY(-30px) rotate(5deg);
      }
    }

    @keyframes fadeInUp {
      from {
        opacity: 0;
        transform: translateY(30px);
      }
      to {
        opacity: 1;
        transform: translateY(0);
      }
    }

    .container {
      max-width: 1200px;
      margin: 0 auto;
      position: relative;
      z-index: 1;
    }

    /* Glass Card Base */
    .glass-card {
      background: rgba(var(--glass-water-rgb), var(--glass-alpha));
      backdrop-filter: blur(22px) saturate(140%);
      -webkit-backdrop-filter: blur(22px) saturate(140%);
      border-radius: 16px;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.12),
        inset 0 1px 0 rgba(255, 255, 255, 0.25);
      border: 1px solid rgba(255, 255, 255, 0.28);
      position: relative;
      overflow: hidden;
    }

    .glass-card::before {
      content: "";
      position: absolute;
      inset: 0;
      border-radius: inherit;
      background: linear-gradient(
        180deg,
        rgba(255,255,255,0.18),
        rgba(255,255,255,0.05)
      );
      pointer-events: none;
    }

    /* Header */
    .header {
      padding: 24px 28px;
      margin-bottom: 20px;
      animation: fadeInUp 0.5s ease-out;
    }

    .header-top {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 16px;
      flex-wrap: wrap;
    }

    .back-link {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 10px 16px;
      background: rgba(var(--glass-water-rgb), var(--glass-alpha));
      color: white;
      text-decoration: none;
      border-radius: 980px;
      font-weight: 600;
      font-size: 14px;
      transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1),
                  background-color 0.3s ease;
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12),
        inset 0 1px 0 rgba(255, 255, 255, 0.25);
      border: 1px solid rgba(255, 255, 255, 0.28);
      position: relative;
      overflow: hidden;
    }

    .back-link::before {
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

    .back-link:hover {
      background: rgba(var(--glass-water-rgb), var(--glass-alpha-hover));
      transform: translateY(-2px);
    }

    .back-link:hover::before {
      opacity: 1;
      transform: translateX(30%) translateY(10%);
    }

    .nav-controls {
      display: flex;
      align-items: center;
      gap: 16px;
    }

    .nav-button {
      width: 40px;
      height: 40px;
      border-radius: 50%;
      border: 1px solid rgba(255, 255, 255, 0.3);
      background: rgba(255, 255, 255, 0.2);
      color: white;
      font-size: 18px;
      font-weight: 700;
      cursor: pointer;
      transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
      display: flex;
      align-items: center;
      justify-content: center;
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.15),
        inset 0 1px 0 rgba(255, 255, 255, 0.3);
    }

    .nav-button:hover {
      background: rgba(255, 255, 255, 0.3);
      transform: scale(1.1);
      box-shadow: 0 6px 20px rgba(0, 0, 0, 0.2);
    }

    .month-label {
      font-size: 20px;
      font-weight: 700;
      color: white;
      min-width: 200px;
      text-align: center;
      text-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
      letter-spacing: -0.3px;
    }

    .clock {
      font-size: 14px;
      color: rgba(255, 255, 255, 0.9);
      font-weight: 500;
      text-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
    }

    /* Calendar Grid - Desktop */
    .calendar-grid {
      display: grid;
      grid-template-columns: repeat(7, 1fr);
      gap: 12px;
      padding: 24px;
      animation: fadeInUp 0.6s ease-out;
    }

    .day-header {
      background: rgba(255, 255, 255, 0.2);
      backdrop-filter: blur(10px);
      border-radius: 10px;
      padding: 12px;
      text-align: center;
      font-weight: 700;
      font-size: 14px;
      color: white;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1),
        inset 0 1px 0 rgba(255, 255, 255, 0.3);
      border: 1px solid rgba(255, 255, 255, 0.25);
      text-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
    }

    .day-cell {
      background: rgba(255, 255, 255, 0.15);
      backdrop-filter: blur(10px);
      border-radius: 12px;
      padding: 12px;
      min-height: 120px;
      cursor: pointer;
      transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1),
        inset 0 1px 0 rgba(255, 255, 255, 0.25);
      border: 1px solid rgba(255, 255, 255, 0.2);
      position: relative;
      overflow: hidden;
    }

    .day-cell::before {
      content: "";
      position: absolute;
      inset: 0;
      border-radius: inherit;
      background: linear-gradient(
        180deg,
        rgba(255,255,255,0.15),
        rgba(255,255,255,0.05)
      );
      pointer-events: none;
    }

    .day-cell:hover {
      transform: translateY(-4px);
      box-shadow: 0 12px 32px rgba(0, 0, 0, 0.2);
      background: rgba(255, 255, 255, 0.25);
      border-color: rgba(255, 255, 255, 0.4);
    }

    .day-cell.other-month {
      opacity: 0.4;
    }

    .day-number {
      font-weight: 700;
      font-size: 16px;
      color: white;
      margin-bottom: 8px;
      text-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
      position: relative;
      z-index: 1;
    }

    .day-cell.today .day-number {
      background: rgba(255, 255, 255, 0.3);
      color: white;
      width: 32px;
      height: 32px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 14px;
      box-shadow: 0 0 20px rgba(255, 255, 255, 0.5),
        inset 0 1px 0 rgba(255, 255, 255, 0.4);
      border: 2px solid rgba(255, 255, 255, 0.5);
      animation: pulse 2s infinite;
    }

    @keyframes pulse {
      0%, 100% {
        box-shadow: 0 0 20px rgba(255, 255, 255, 0.5),
                    inset 0 1px 0 rgba(255, 255, 255, 0.4);
      }
      50% {
        box-shadow: 0 0 30px rgba(255, 255, 255, 0.7),
                    inset 0 1px 0 rgba(255, 255, 255, 0.6);
      }
    }

    .node-item {
      display: block;
      margin: 4px 0;
      padding: 6px 10px;
      border-radius: 8px;
      background: rgba(255, 255, 255, 0.25);
      color: white;
      font-size: 12px;
      font-weight: 600;
      text-decoration: none;
      transition: all 0.2s;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
      border: 1px solid rgba(255, 255, 255, 0.2);
      position: relative;
      z-index: 1;
    }

    .node-item:hover {
      background: rgba(255, 255, 255, 0.35);
      transform: translateX(2px);
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
    }

    .node-count {
      display: inline-block;
      margin-top: 4px;
      padding: 4px 8px;
      background: rgba(255, 255, 255, 0.2);
      color: white;
      font-size: 11px;
      font-weight: 700;
      border-radius: 12px;
      border: 1px solid rgba(255, 255, 255, 0.25);
      position: relative;
      z-index: 1;
    }

    /* List View - Mobile */
    .calendar-list {
      display: none;
      padding: 16px;
      gap: 12px;
    }

    .list-day {
      background: rgba(255, 255, 255, 0.15);
      backdrop-filter: blur(10px);
      border-radius: 12px;
      padding: 16px;
      cursor: pointer;
      transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.1),
        inset 0 1px 0 rgba(255, 255, 255, 0.25);
      border: 1px solid rgba(255, 255, 255, 0.2);
      position: relative;
      overflow: hidden;
    }

    .list-day::before {
      content: "";
      position: absolute;
      inset: 0;
      border-radius: inherit;
      background: linear-gradient(
        180deg,
        rgba(255,255,255,0.15),
        rgba(255,255,255,0.05)
      );
      pointer-events: none;
    }

    .list-day:hover {
      transform: translateY(-2px);
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.15);
      background: rgba(255, 255, 255, 0.2);
    }

    .list-day-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 12px;
      position: relative;
      z-index: 1;
    }

    .list-day-date {
      font-weight: 700;
      font-size: 16px;
      color: white;
      text-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
    }

    .list-day-badge {
      padding: 4px 12px;
      background: rgba(255, 255, 255, 0.25);
      color: white;
      border-radius: 12px;
      font-size: 12px;
      font-weight: 700;
      border: 1px solid rgba(255, 255, 255, 0.3);
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
    }

    /* Day View */
    .day-view {
      padding: 24px;
      animation: fadeInUp 0.6s ease-out;
    }

    .hour-row {
      display: flex;
      border-bottom: 1px solid rgba(255, 255, 255, 0.15);
      padding: 12px 0;
      min-height: 60px;
      transition: background 0.2s;
    }

    .hour-row:hover {
      background: rgba(255, 255, 255, 0.08);
      border-radius: 8px;
    }

    .hour-label {
      width: 80px;
      font-weight: 700;
      color: white;
      font-size: 14px;
      flex-shrink: 0;
      text-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
    }

    .hour-content {
      flex: 1;
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

    .empty-state {
      text-align: center;
      padding: 60px 40px;
      color: rgba(255, 255, 255, 0.8);
    }

    .empty-state-icon {
      font-size: 64px;
      margin-bottom: 16px;
      opacity: 0.6;
    }

    /* Mobile Responsive */
    @media (max-width: 768px) {
      body {
        padding: 12px;
      }

      .header {
        padding: 16px;
      }

      .header-top {
        flex-direction: column;
        align-items: stretch;
      }

      .nav-controls {
        justify-content: center;
      }

      .clock {
        text-align: center;
      }

      /* Switch to list view on mobile */
      .calendar-grid {
        display: none;
      }

      .calendar-list {
        display: flex;
        flex-direction: column;
      }

      .day-view {
        padding: 16px;
      }

      .hour-label {
        width: 60px;
        font-size: 12px;
      }

      .month-label {
        font-size: 18px;
      }

      .nav-button {
        width: 36px;
        height: 36px;
        font-size: 16px;
      }
    }
  </style>
</head>
<body>
  <div class="container">
    <!-- Header -->
    <div class="glass-card header">
      <div class="header-top">
        <a href="/api/v1/root/${rootId}${queryString}" class="back-link" id="backLink">
          <- Back to Tree
        </a>

        <div class="nav-controls">
          <button class="nav-button" id="prevMonth"><-</button>
          <div class="month-label" id="monthLabel"></div>
          <button class="nav-button" id="nextMonth">-></button>
        </div>

        <div class="clock" id="clock"></div>
      </div>
    </div>

    <!-- Calendar Container -->
    <div class="glass-card" id="calendarContainer"></div>
  </div>

  <script>
    const params = new URLSearchParams(window.location.search);
    const dayMode = params.get("day");
    const calendarData = ${JSON.stringify(byDay)};
    const month = ${month};
    const year = ${year};

    const monthNames = ["January","February","March","April","May","June","July","August","September","October","November","December"];
    const dayNames = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];

    const container = document.getElementById("calendarContainer");
    const monthLabel = document.getElementById("monthLabel");
    const backLink = document.getElementById("backLink");

    // Clock
    function tick() {
      document.getElementById("clock").textContent = new Date().toLocaleString();
    }
    tick();
    setInterval(tick, 1000);

    // Format hour for day view
    function formatHour(h) {
      if (h === 0) return "12 AM";
      if (h < 12) return h + " AM";
      if (h === 12) return "12 PM";
      return (h - 12) + " PM";
    }

    // Render Day View
    function renderDayView(dayKey) {
      monthLabel.textContent = dayKey;
      backLink.textContent = "<- Back to Month";
      backLink.onclick = (e) => {
        e.preventDefault();
        const p = new URLSearchParams(window.location.search);
        p.delete("day");
        window.location.search = p.toString();
      };

      const items = (calendarData[dayKey] || []).slice().sort(
        (a, b) => new Date(a.schedule) - new Date(b.schedule)
      );

      const byHour = {};
      for (const item of items) {
        const d = new Date(item.schedule);
        const h = d.getHours();
        if (!byHour[h]) byHour[h] = [];
        byHour[h].push(item);
      }

      let html = '<div class="day-view">';

      if (items.length === 0) {
        html += '<div class="empty-state"><div class="empty-state-icon">📅</div><div>No scheduled items for this day</div></div>';
      } else {
        for (let h = 0; h < 24; h++) {
          html += \`
            <div class="hour-row">
              <div class="hour-label">\${formatHour(h)}</div>
              <div class="hour-content">
          \`;

          (byHour[h] || []).forEach(item => {
            html += \`<a class="node-item" href="/api/v1/node/\${item.nodeId}/\${item.versionIndex}${queryString}">\${item.name}</a>\`;
          });

          html += '</div></div>';
        }
      }

      html += '</div>';
      container.innerHTML = html;
    }

    // Render Month View
    function renderMonthView() {
      monthLabel.textContent = monthNames[month] + " " + year;

      const firstDay = new Date(year, month, 1);
      const start = new Date(firstDay);
      start.setDate(1 - firstDay.getDay());

      const today = new Date();
      const todayStr = today.toISOString().slice(0, 10);

      const isMobile = window.innerWidth <= 768;

      if (isMobile) {
        // List view for mobile
        let html = '<div class="calendar-list">';

        const daysWithEvents = [];
        for (let i = 0; i < 42; i++) {
          const d = new Date(start);
          d.setDate(start.getDate() + i);
          const key = d.toISOString().slice(0, 10);
          const items = calendarData[key] || [];

          if (items.length > 0 || d.getMonth() === month) {
            daysWithEvents.push({ date: d, key, items });
          }
        }

        if (daysWithEvents.length === 0) {
          html += '<div class="empty-state"><div class="empty-state-icon">📅</div><div>No scheduled items this month</div></div>';
        } else {
          daysWithEvents.forEach(({ date, key, items }) => {
            const dayOfWeek = dayNames[date.getDay()];
            const isToday = key === todayStr;

            html += \`
              <div class="list-day" onclick="goToDay('\${key}')">
                <div class="list-day-header">
                  <div class="list-day-date">
                    \${dayOfWeek}, \${monthNames[date.getMonth()]} \${date.getDate()}
                    \${isToday ? ' <span style="text-shadow: 0 0 10px rgba(255,255,255,0.8);">✨ Today</span>' : ''}
                  </div>
                  \${items.length > 0 ? \`<span class="list-day-badge">\${items.length} item\${items.length !== 1 ? 's' : ''}</span>\` : ''}
                </div>
            \`;

            if (items.length > 0) {
              items.slice(0, 3).forEach(item => {
                html += \`<a class="node-item" href="/api/v1/node/\${item.nodeId}/\${item.versionIndex}${queryString}" onclick="event.stopPropagation()">\${item.name}</a>\`;
              });

              if (items.length > 3) {
                html += \`<div class="node-count">+\${items.length - 3} more</div>\`;
              }
            }

            html += '</div>';
          });
        }

        html += '</div>';
        container.innerHTML = html;
      } else {
        // Grid view for desktop
        let html = '<div class="calendar-grid">';

        // Day headers
        dayNames.forEach(day => {
          html += \`<div class="day-header">\${day}</div>\`;
        });

        // Days
        for (let i = 0; i < 42; i++) {
          const d = new Date(start);
          d.setDate(start.getDate() + i);
          const key = d.toISOString().slice(0, 10);
          const items = calendarData[key] || [];
          const isOtherMonth = d.getMonth() !== month;
          const isToday = key === todayStr;

          html += \`
            <div class="day-cell \${isOtherMonth ? 'other-month' : ''} \${isToday ? 'today' : ''}" onclick="goToDay('\${key}')">
              <div class="day-number">\${d.getDate()}</div>
          \`;

          items.slice(0, 3).forEach(item => {
            html += \`<a class="node-item" href="/api/v1/node/\${item.nodeId}/\${item.versionIndex}${queryString}" onclick="event.stopPropagation()">\${item.name}</a>\`;
          });

          if (items.length > 3) {
            html += \`<div class="node-count">+\${items.length - 3} more</div>\`;
          }

          html += '</div>';
        }

        html += '</div>';
        container.innerHTML = html;
      }
    }

    // Navigate to day
    function goToDay(key) {
      const p = new URLSearchParams(window.location.search);
      p.set("day", key);
      window.location.search = p.toString();
    }

    // Navigation buttons
    document.getElementById("prevMonth").onclick = () => {
      const p = new URLSearchParams(window.location.search);

      if (dayMode) {
        const d = new Date(dayMode);
        d.setDate(d.getDate() - 1);
        p.set("day", d.toISOString().slice(0, 10));
      } else {
        let m = month - 1;
        let y = year;
        if (m < 0) { m = 11; y--; }
        p.set("month", m);
        p.set("year", y);
      }

      window.location.search = p.toString();
    };

    document.getElementById("nextMonth").onclick = () => {
      const p = new URLSearchParams(window.location.search);

      if (dayMode) {
        const d = new Date(dayMode);
        d.setDate(d.getDate() + 1);
        p.set("day", d.toISOString().slice(0, 10));
      } else {
        let m = month + 1;
        let y = year;
        if (m > 11) { m = 0; y++; }
        p.set("month", m);
        p.set("year", y);
      }

      window.location.search = p.toString();
    };

    // Initial render
    if (dayMode) {
      renderDayView(dayMode);
    } else {
      renderMonthView();
    }

    // Re-render on resize
    let resizeTimer;
    window.addEventListener('resize', () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        if (!dayMode) renderMonthView();
      }, 250);
    });
  </script>
</body>
</html>
`;
}


// ─────────────────────────────────────────────────────────────────────────
// 3. renderGateway
// ─────────────────────────────────────────────────────────────────────────

export function renderGateway({ rootId, rootName, queryString, channels }) {
  const channelRows = channels.length === 0
    ? '<p style="color:rgba(255,255,255,0.5);font-size:0.9rem;">No channels configured yet. Add one below.</p>'
    : channels.map(function(ch) {
        var typeBadge = ch.type === "telegram" ? "TG"
          : ch.type === "discord" ? "DC"
          : "WEB";
        var typeColor = ch.type === "telegram" ? "rgba(0,136,204,0.8)"
          : ch.type === "discord" ? "rgba(88,101,242,0.8)"
          : "rgba(72,187,120,0.8)";
        var statusDot = ch.enabled
          ? '<span style="color:rgba(72,187,120,0.9);">&#9679;</span>'
          : '<span style="color:rgba(255,107,107,0.9);">&#9679;</span>';
        var notifList = (ch.notificationTypes || []).join(", ");
        var lastDispatch = ch.lastDispatchAt
          ? new Date(ch.lastDispatchAt).toLocaleString()
          : "Never";
        var lastErr = ch.lastError
          ? '<span style="color:rgba(255,107,107,0.8);font-size:0.75rem;">' + escapeHtml(ch.lastError) + '</span>'
          : '';

        var dirLabel = ch.direction === "input-output" ? "I/O"
          : ch.direction === "input" ? "IN"
          : "OUT";
        var modeLabel = ch.mode === "read-write" ? "CHAT"
          : ch.mode === "read" ? "QUERY"
          : "PLACE";

        return `
<div class="channel-row" data-id="${ch._id}" style="
  background:rgba(255,255,255,0.06);border-radius:12px;padding:16px;margin-bottom:12px;
  border:1px solid rgba(255,255,255,0.1);position:relative;">
  <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;">
    <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
      ${statusDot}
      <span style="font-weight:600;color:#fff;">${escapeHtml(ch.name)}</span>
      <span style="background:${typeColor};color:#fff;font-size:0.7rem;padding:2px 8px;border-radius:4px;font-weight:600;">${typeBadge}</span>
      <span style="background:rgba(255,255,255,0.12);color:rgba(255,255,255,0.7);font-size:0.65rem;padding:2px 6px;border-radius:4px;">${dirLabel}</span>
      <span style="background:rgba(255,255,255,0.08);color:rgba(255,255,255,0.5);font-size:0.65rem;padding:2px 6px;border-radius:4px;">${modeLabel}</span>
    </div>
    <div style="display:flex;gap:8px;">
      <button onclick="testChannel('${ch._id}')" style="
        padding:4px 12px;border-radius:6px;border:1px solid rgba(115,111,230,0.4);
        background:rgba(115,111,230,0.15);color:rgba(200,200,255,0.9);font-size:0.8rem;cursor:pointer;">
        Test</button>
      <button onclick="toggleChannel('${ch._id}', ${!ch.enabled})" style="
        padding:4px 12px;border-radius:6px;border:1px solid rgba(255,179,71,0.4);
        background:rgba(255,179,71,0.1);color:rgba(255,179,71,0.9);font-size:0.8rem;cursor:pointer;">
        ${ch.enabled ? "Disable" : "Enable"}</button>
      <button onclick="deleteChannel('${ch._id}')" style="
        padding:4px 12px;border-radius:6px;border:1px solid rgba(255,107,107,0.4);
        background:rgba(255,107,107,0.1);color:rgba(255,107,107,0.8);font-size:0.8rem;cursor:pointer;">
        Delete</button>
    </div>
  </div>
  <div style="margin-top:8px;font-size:0.8rem;color:rgba(255,255,255,0.5);">
    ${ch.config?.displayIdentifier ? escapeHtml(ch.config.displayIdentifier) + ' &middot; ' : ''}
    ${notifList} &middot; Last sent: ${lastDispatch}
  </div>
  ${lastErr ? '<div style="margin-top:4px;">' + lastErr + '</div>' : ''}
</div>`;
      }).join('\n');

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="theme-color" content="#667eea">
  <title>Gateway -- ${escapeHtml(rootName)}</title>
  <style>
    :root {
      --glass-water-rgb: 115, 111, 230;
      --glass-alpha: 0.28;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; -webkit-tap-highlight-color: transparent; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', sans-serif;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      min-height: 100vh; padding: 20px; color: #fff;
      position: relative; overflow-x: hidden;
    }
    body::before, body::after {
      content: ''; position: fixed; border-radius: 50%; opacity: 0.08;
      animation: float 20s infinite ease-in-out; pointer-events: none;
    }
    body::before { width: 600px; height: 600px; background: white; top: -300px; right: -200px; }
    body::after { width: 400px; height: 400px; background: white; bottom: -200px; left: -100px; }
    @keyframes float {
      0%, 100% { transform: translateY(0) rotate(0deg); }
      50% { transform: translateY(-30px) rotate(5deg); }
    }
    @keyframes fadeInUp {
      from { opacity: 0; transform: translateY(30px); }
      to { opacity: 1; transform: translateY(0); }
    }
    .container { max-width: 900px; margin: 0 auto; position: relative; z-index: 1; }
    .content-card {
      background: rgba(var(--glass-water-rgb), var(--glass-alpha));
      backdrop-filter: blur(22px) saturate(140%);
      border-radius: 16px; padding: 28px;
      box-shadow: 0 8px 32px rgba(0,0,0,0.12), inset 0 1px 0 rgba(255,255,255,0.25);
      border: 1px solid rgba(255,255,255,0.28);
      margin-bottom: 24px; animation: fadeInUp 0.6s ease-out both;
    }
    .section-header h2 { color: #fff; font-size: 1.3rem; font-weight: 700; margin-bottom: 16px; }
    .back-nav {
      display: flex; gap: 12px; margin-bottom: 20px; animation: fadeInUp 0.5s ease-out;
    }
    .back-nav a {
      background: rgba(var(--glass-water-rgb), 0.25);
      backdrop-filter: blur(12px); border-radius: 10px; padding: 8px 16px;
      color: rgba(255,255,255,0.9); text-decoration: none; font-size: 0.85rem;
      border: 1px solid rgba(255,255,255,0.15); font-weight: 500;
    }
    .back-nav a:hover { background: rgba(var(--glass-water-rgb), 0.35); }
    label { display: block; font-size: 0.85rem; color: rgba(255,255,255,0.7); margin-bottom: 4px; margin-top: 12px; }
    input, select {
      width: 100%; padding: 10px 14px; border-radius: 8px;
      border: 1px solid rgba(255,255,255,0.15); background: rgba(255,255,255,0.08);
      color: #fff; font-size: 0.9rem; outline: none;
    }
    input::placeholder { color: rgba(255,255,255,0.7); }
    input:focus, select:focus { border-color: rgba(115,111,230,0.6); }
    select option { background: #3a3a6e; color: #fff; }
    .btn-primary {
      padding: 10px 20px; border-radius: 8px; border: 1px solid rgba(72,187,120,0.4);
      background: rgba(72,187,120,0.15); color: rgba(72,187,120,0.95);
      font-weight: 600; cursor: pointer; font-size: 0.9rem; margin-top: 16px;
    }
    .btn-primary:hover { background: rgba(72,187,120,0.25); }
    .checkbox-row {
      display: flex; align-items: center; gap: 8px; margin-top: 6px;
    }
    .checkbox-row input[type="checkbox"] { width: auto; }
    #gatewayStatus {
      display: none; font-size: 0.85rem; margin-top: 12px; padding: 8px 12px;
      border-radius: 8px;
    }
  </style>
</head>
<body>
<div class="container">

  <div class="back-nav">
    <a href="/api/v1/root/${rootId}${queryString}">Back to Tree</a>
  </div>

  <div class="content-card">
    <div class="section-header">
      <h2>Gateway Channels</h2>
    </div>
    <p style="color:rgba(255,255,255,0.6);font-size:0.85rem;margin-bottom:16px;">
      Output channels push notifications from this tree to external services.
    </p>
    <div id="channelList">
      ${channelRows}
    </div>
  </div>

  <div class="content-card" style="animation-delay:0.1s;">
    <div class="section-header">
      <h2>Add Channel</h2>
    </div>

    <label for="channelName">Channel Name</label>
    <input type="text" id="channelName" placeholder="e.g. My Discord Updates" maxlength="100" />

    <label for="channelType">Type</label>
    <select id="channelType" onchange="updateFormFields()">
      <option value="telegram">Telegram</option>
      <option value="discord">Discord</option>
      <option value="webapp">Web Push (this browser)</option>
    </select>

    <label for="channelDirection">Direction</label>
    <select id="channelDirection" onchange="updateFormFields()">
      <option value="output">Output (send notifications out)</option>
      <option value="input">Input (receive messages in)</option>
      <option value="input-output">Input/Output (bidirectional chat)</option>
    </select>

    <label for="channelMode">Mode</label>
    <select id="channelMode">
      <option value="write">Place (scans tree, makes edits, no response)</option>
      <option value="read">Query (reads tree, responds, no edits)</option>
      <option value="read-write">Chat (reads tree, makes edits, responds)</option>
    </select>

    <div id="telegramFields" style="margin-top:8px;">
      <label for="tgBotToken">Bot Token</label>
      <input type="password" id="tgBotToken" placeholder="123456:ABC-DEF..." />
      <label for="tgChatId">Chat ID</label>
      <input type="text" id="tgChatId" placeholder="-1001234567890" />
    </div>

    <div id="discordOutputFields" style="display:none;">
      <label for="dcWebhookUrl">Webhook URL</label>
      <input type="password" id="dcWebhookUrl" placeholder="https://discord.com/api/webhooks/..." />
    </div>

    <div id="discordInputFields" style="display:none;">
      <div style="background:rgba(255,255,255,0.05);border-radius:8px;padding:12px;margin-top:8px;margin-bottom:12px;border:1px solid rgba(255,255,255,0.1);">
        <div style="color:rgba(255,255,255,0.8);font-size:0.82rem;font-weight:600;margin-bottom:8px;">How to get your Discord bot details:</div>
        <ol style="color:rgba(255,255,255,0.6);font-size:0.8rem;margin:0;padding-left:18px;line-height:1.6;">
          <li>Go to <a href="https://discord.com/developers/applications" target="_blank" style="color:#1a1a1a;">Discord Developer Portal</a></li>
          <li>Create a New Application, then go to the <strong>Bot</strong> tab</li>
          <li>Click "Reset Token" to get your bot token and copy it</li>
          <li>Enable <strong>Message Content Intent</strong> under Privileged Gateway Intents</li>
          <li>Go to <strong>Installation</strong> tab, set integration type to <strong>Guild Install</strong></li>
          <li>Go to <strong>OAuth2</strong> tab, check <em>bot</em> scope, then under Bot Permissions check <strong>Read Message History</strong> and <strong>Send Messages</strong></li>
          <li>Copy the generated URL and open it to invite the bot to your server</li>
          <li>In Discord, right-click the channel you want, click "Copy Channel ID"<br/>(Enable Developer Mode in Discord Settings > Advanced if you don't see it)</li>
        </ol>
      </div>
      <label for="dcBotToken">Bot Token</label>
      <input type="password" id="dcBotToken" placeholder="Discord bot token..." />
      <label for="dcChannelId">Discord Channel ID</label>
      <input type="text" id="dcChannelId" placeholder="1234567890123456789" />
      <p style="color:rgba(255,179,71,0.7);font-size:0.8rem;margin-top:6px;">
        Discord input requires Standard, Premium, or God tier.
      </p>
    </div>

    <div id="webappFields" style="display:none;">
      <p style="color:rgba(255,255,255,0.6);font-size:0.85rem;margin-top:12px;">
        Your browser will ask for notification permission when you add this channel.
      </p>
    </div>

    <div id="outputNotifSection" style="display:none;">
      <label style="margin-top:16px;">Notification Types</label>
      <div class="checkbox-row">
        <input type="checkbox" id="notifSummary" checked /> <label for="notifSummary" style="margin:0;">Dream Summary</label>
      </div>
      <div class="checkbox-row">
        <input type="checkbox" id="notifThought" checked /> <label for="notifThought" style="margin:0;">Dream Thought</label>
      </div>
    </div>

    <div id="inputConfigSection" style="display:none;">
      <label for="queueBehavior" style="margin-top:16px;">When Busy (2+ messages processing)</label>
      <select id="queueBehavior">
        <option value="respond">Respond with busy message</option>
        <option value="silent">Stay silent</option>
      </select>
    </div>

    <button class="btn-primary" onclick="addChannel()">Add Channel</button>
    <div id="gatewayStatus"></div>
  </div>

</div>

<script>
var ROOT_ID = "${rootId}";

function updateFormFields() {
  var type = document.getElementById("channelType").value;
  var direction = document.getElementById("channelDirection").value;
  var hasOutput = direction === "output" || direction === "input-output";

  // Webapp can only be output
  var dirSelect = document.getElementById("channelDirection");
  var modeSelect = document.getElementById("channelMode");
  var modeLabel = document.querySelector('label[for="channelMode"]');
  if (type === "webapp") {
    dirSelect.value = "output";
    dirSelect.disabled = true;
    hasOutput = true;
  } else {
    dirSelect.disabled = false;
  }

  // Mode only relevant for channels with input capability
  var hasInput = direction === "input" || direction === "input-output";
  modeSelect.style.display = hasInput ? "block" : "none";
  modeLabel.style.display = hasInput ? "block" : "none";

  // Smart defaults per direction
  if (direction === "input") {
    modeSelect.value = "write";
  } else if (direction === "input-output") {
    modeSelect.value = "read-write";
  }

  // Telegram: always show (same bot token + chat ID for input and output)
  document.getElementById("telegramFields").style.display = type === "telegram" ? "block" : "none";

  // Discord: show different fields based on direction
  document.getElementById("discordOutputFields").style.display = (type === "discord" && !hasInput) ? "block" : "none";
  document.getElementById("discordInputFields").style.display = (type === "discord" && hasInput) ? "block" : "none";

  // Webapp: only on output
  document.getElementById("webappFields").style.display = (type === "webapp" && hasOutput) ? "block" : "none";

  // Notification types: only for output channels
  document.getElementById("outputNotifSection").style.display = hasOutput ? "block" : "none";

  // Queue behavior: only for input channels
  document.getElementById("inputConfigSection").style.display = hasInput ? "block" : "none";
}

function showStatus(msg, isError) {
  var el = document.getElementById("gatewayStatus");
  el.style.display = "block";
  el.style.background = isError ? "rgba(255,107,107,0.15)" : "rgba(72,187,120,0.15)";
  el.style.color = isError ? "rgba(255,107,107,0.95)" : "rgba(72,187,120,0.95)";
  el.textContent = msg;
  if (!isError) setTimeout(function() { el.style.display = "none"; }, 4000);
}

async function getWebPushSubscription() {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
    throw new Error("Push notifications are not supported in this browser");
  }

  var permission = await Notification.requestPermission();
  if (permission !== "granted") {
    throw new Error("Notification permission denied");
  }

  var reg = await navigator.serviceWorker.register("/sw.js");
  await navigator.serviceWorker.ready;

  var vapidKey = await fetch("/api/v1/root/" + ROOT_ID + "/gateway/vapid-key")
    .then(function(r) { return r.json(); });

  if (!vapidKey.key) throw new Error("VAPID key not configured on server");

  var sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(vapidKey.key),
  });

  return sub.toJSON();
}

function urlBase64ToUint8Array(base64String) {
  var padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  var base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  var rawData = atob(base64);
  var outputArray = new Uint8Array(rawData.length);
  for (var i = 0; i < rawData.length; i++) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

async function addChannel() {
  var name = document.getElementById("channelName").value.trim();
  var type = document.getElementById("channelType").value;
  var direction = document.getElementById("channelDirection").value;
  var mode = document.getElementById("channelMode").value;
  var hasOutput = direction === "output" || direction === "input-output";
  var hasInput = direction === "input" || direction === "input-output";

  if (!name) { showStatus("Please enter a channel name", true); return; }

  var config = {};

  try {
    if (type === "telegram") {
      // Telegram always needs bot token + chat ID
      var botToken = document.getElementById("tgBotToken").value.trim();
      var chatId = document.getElementById("tgChatId").value.trim();
      if (!botToken || !chatId) { showStatus("Bot token and chat ID are required", true); return; }
      config = { botToken: botToken, chatId: chatId };
    } else if (type === "discord") {
      if (hasInput) {
        // Discord input: bot token + channel ID
        var dcBotToken = document.getElementById("dcBotToken").value.trim();
        var dcChannelId = document.getElementById("dcChannelId").value.trim();
        if (!dcBotToken || !dcChannelId) { showStatus("Bot token and channel ID are required for Discord input", true); return; }
        config = { botToken: dcBotToken, discordChannelId: dcChannelId };
        // For input-output, optionally add webhook URL for output side
        if (hasOutput) {
          var webhookUrl = document.getElementById("dcWebhookUrl").value.trim();
          if (webhookUrl) config.webhookUrl = webhookUrl;
        }
      } else {
        // Discord output-only: webhook URL
        var webhookUrl = document.getElementById("dcWebhookUrl").value.trim();
        if (!webhookUrl) { showStatus("Webhook URL is required", true); return; }
        config = { webhookUrl: webhookUrl };
      }
    } else if (type === "webapp") {
      var subscription = await getWebPushSubscription();
      config = { subscription: subscription, displayIdentifier: navigator.userAgent.split(" ").pop() || "Browser" };
    }
  } catch (err) {
    showStatus(err.message, true);
    return;
  }

  var notificationTypes = [];
  if (hasOutput) {
    if (document.getElementById("notifSummary").checked) notificationTypes.push("dream-summary");
    if (document.getElementById("notifThought").checked) notificationTypes.push("dream-thought");
    if (notificationTypes.length === 0 && direction === "output") { showStatus("Select at least one notification type", true); return; }
  }

  var queueBehavior = hasInput ? document.getElementById("queueBehavior").value : "respond";

  try {
    var res = await fetch("/api/v1/root/" + ROOT_ID + "/gateway/channels", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: name, type: type, direction: direction, mode: mode, config: config, notificationTypes: notificationTypes, queueBehavior: queueBehavior }),
    });
    var data = await res.json();
    if (!res.ok) { showStatus(data.error || "Failed to add channel", true); return; }
    showStatus("Channel added successfully");
    setTimeout(function() { location.reload(); }, 1000);
  } catch (err) {
    showStatus("Network error: " + err.message, true);
  }
}

async function testChannel(channelId) {
  try {
    var res = await fetch("/api/v1/root/" + ROOT_ID + "/gateway/channels/" + channelId + "/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    var data = await res.json();
    if (!res.ok) { alert(data.error || "Test failed"); return; }
    alert("Test notification sent!");
  } catch (err) { alert("Network error"); }
}

async function toggleChannel(channelId, enabled) {
  try {
    var res = await fetch("/api/v1/root/" + ROOT_ID + "/gateway/channels/" + channelId, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: enabled }),
    });
    if (res.ok) location.reload();
    else { var data = await res.json(); alert(data.error || "Failed"); }
  } catch (err) { alert("Network error"); }
}

async function deleteChannel(channelId) {
  if (!confirm("Delete this channel?")) return;
  try {
    var res = await fetch("/api/v1/root/" + ROOT_ID + "/gateway/channels/" + channelId, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
    });
    if (res.ok) location.reload();
    else { var data = await res.json(); alert(data.error || "Failed"); }
  } catch (err) { alert("Network error"); }
}
</script>
</body>
</html>
`;
}


// ─────────────────────────────────────────────────────────────────────────
// 4. renderValuesPage
// ─────────────────────────────────────────────────────────────────────────

export function renderValuesPage({ nodeId, queryString, result }) {
  const rootNodeName = result.tree.nodeName || "Unknown";

  const flatSummary =
    Object.entries(result.flat).length > 0
      ? Object.entries(result.flat)
          .sort(([, a], [, b]) => b - a)
          .map(
            ([key, value]) => `
            <div class="value-card">
              <div class="value-key">${key}</div>
              <div class="value-amount">${value.toLocaleString()}</div>
            </div>
          `,
          )
          .join("")
      : `<div class="empty-state-small">No values yet</div>`;

  function renderTree(node, depth = 0) {
    const hasChildren = node.children && node.children.length > 0;
    const hasLocalValues =
      node.localValues && Object.keys(node.localValues).length > 0;
    const hasTotalValues =
      node.totalValues && Object.keys(node.totalValues).length > 0;

    let localValuesHtml = "";
    if (hasLocalValues) {
      localValuesHtml = Object.entries(node.localValues)
        .map(
          ([k, v]) => `
            <div class="node-value-item" title="${k}: ${v.toLocaleString()}">
              <span class="value-key-small">${k}</span>
              <span class="value-amount-small">${v.toLocaleString()}</span>
            </div>
          `,
        )
        .join("");
    }

    let totalValuesHtml = "";
    if (hasTotalValues) {
      totalValuesHtml = Object.entries(node.totalValues)
        .map(
          ([k, v]) => `
            <div class="node-value-item" title="${k}: ${v.toLocaleString()}">
              <span class="value-key-small">${k}</span>
              <span class="value-amount-small">${v.toLocaleString()}</span>
            </div>
          `,
        )
        .join("");
    }

    const childrenHtml = hasChildren
      ? node.children.map((c) => renderTree(c, depth + 1)).join("")
      : "";

    const valueCount = Math.max(
      Object.keys(node.localValues || {}).length,
      Object.keys(node.totalValues || {}).length,
    );

    return `
        <div class="tree-node" data-depth="${depth}">
          <div class="tree-node-header ${hasChildren ? "has-children" : ""}">
            ${
              hasChildren
                ? `<button class="tree-toggle" onclick="toggleNode(this)" aria-label="Toggle children">▼</button>`
                : '<span class="tree-spacer"></span>'
            }
            <div class="tree-node-info">
              <a href="/api/v1/node/${
                node.nodeId
              }${queryString}" class="tree-node-name" title="${node.nodeName}">
                ${node.nodeName}
              </a>
              ${
                valueCount > 0
                  ? `<span class="value-count">${valueCount} value${
                      valueCount !== 1 ? "s" : ""
                    }</span>`
                  : ""
              }
            </div>
          </div>

          ${
            hasLocalValues || hasTotalValues
              ? `
            <div class="tree-node-values local-values">
              ${
                localValuesHtml ||
                '<div class="empty-values">No local values</div>'
              }
            </div>
            <div class="tree-node-values total-values" style="display: none;">
              ${
                totalValuesHtml ||
                '<div class="empty-values">No total values</div>'
              }
            </div>
          `
              : ""
          }

          ${
            hasChildren
              ? `
            <div class="tree-children">
              ${childrenHtml}
            </div>
          `
              : ""
          }
        </div>
      `;
  }

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="theme-color" content="#667eea">
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
  <title>Global Values - ${rootNodeName}</title>
  <style>
    :root {
      --glass-water-rgb: 115, 111, 230;
      --glass-alpha: 0.28;
      --glass-alpha-hover: 0.38;
    }

    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
      -webkit-tap-highlight-color: transparent;
    }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen', 'Ubuntu', 'Cantarell', sans-serif;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      min-height: 100vh;
      padding: 20px;
      color: white;
      position: relative;
      overflow-x: hidden;
    }

    /* Animated background */
    body::before,
    body::after {
      content: '';
      position: fixed;
      border-radius: 50%;
      opacity: 0.08;
      animation: float 20s infinite ease-in-out;
      pointer-events: none;
    }

    body::before {
      width: 600px;
      height: 600px;
      background: white;
      top: -300px;
      right: -200px;
      animation-delay: -5s;
    }

    body::after {
      width: 400px;
      height: 400px;
      background: white;
      bottom: -200px;
      left: -100px;
      animation-delay: -10s;
    }

    @keyframes float {
      0%, 100% {
        transform: translateY(0) rotate(0deg);
      }
      50% {
        transform: translateY(-30px) rotate(5deg);
      }
    }

    @keyframes fadeInUp {
      from {
        opacity: 0;
        transform: translateY(30px);
      }
      to {
        opacity: 1;
        transform: translateY(0);
      }
    }

    .container {
      max-width: 1000px;
      margin: 0 auto;
      position: relative;
      z-index: 1;
    }

    /* Glass Card Base */
    .glass-card {
      background: rgba(var(--glass-water-rgb), var(--glass-alpha));
      backdrop-filter: blur(22px) saturate(140%);
      -webkit-backdrop-filter: blur(22px) saturate(140%);
      border-radius: 16px;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.12),
        inset 0 1px 0 rgba(255, 255, 255, 0.25);
      border: 1px solid rgba(255, 255, 255, 0.28);
      position: relative;
      overflow: hidden;
    }

    .glass-card::before {
      content: "";
      position: absolute;
      inset: 0;
      border-radius: inherit;
      background: linear-gradient(
        180deg,
        rgba(255,255,255,0.18),
        rgba(255,255,255,0.05)
      );
      pointer-events: none;
    }

    /* Back Navigation */
    .back-nav {
      display: flex;
      gap: 12px;
      margin-bottom: 20px;
      flex-wrap: wrap;
      animation: fadeInUp 0.5s ease-out;
    }

    .back-link {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 10px 16px;
      background: rgba(var(--glass-water-rgb), var(--glass-alpha));
      color: white;
      text-decoration: none;
      border-radius: 980px;
      font-weight: 600;
      font-size: 14px;
      transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1),
                  background-color 0.3s ease;
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12),
        inset 0 1px 0 rgba(255, 255, 255, 0.25);
      border: 1px solid rgba(255, 255, 255, 0.28);
      position: relative;
      overflow: hidden;
    }

    .back-link::before {
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

    .back-link:hover {
      background: rgba(var(--glass-water-rgb), var(--glass-alpha-hover));
      transform: translateY(-2px);
    }

    .back-link:hover::before {
      opacity: 1;
      transform: translateX(30%) translateY(10%);
    }

    /* Header */
    .header {
      padding: 28px;
      margin-bottom: 24px;
      animation: fadeInUp 0.6s ease-out;
      animation-delay: 0.1s;
      animation-fill-mode: both;
    }

    .header h1 {
      font-size: 28px;
      font-weight: 700;
      color: white;
      margin-bottom: 8px;
      text-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
      letter-spacing: -0.5px;
    }

    .header h1::before {
      content: '💎 ';
      font-size: 26px;
    }

    .header-subtitle {
      font-size: 14px;
      color: rgba(255, 255, 255, 0.85);
      text-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
    }

    /* Section */
    .section {
      padding: 28px;
      margin-bottom: 24px;
      animation: fadeInUp 0.6s ease-out;
      animation-fill-mode: both;
    }

    .section:nth-child(3) { animation-delay: 0.2s; }
    .section:nth-child(4) { animation-delay: 0.3s; }

    .section-title {
      font-size: 20px;
      font-weight: 600;
      color: white;
      margin-bottom: 20px;
      text-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
      letter-spacing: -0.3px;
    }

    /* Flat Summary Cards */
    .flat-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
      gap: 16px;
    }

    .value-card {
      background: rgba(255, 255, 255, 0.15);
      backdrop-filter: blur(10px);
      padding: 20px;
      border-radius: 12px;
      border: 1px solid rgba(255, 255, 255, 0.2);
      transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1),
        inset 0 1px 0 rgba(255, 255, 255, 0.25);
      position: relative;
      overflow: hidden;
    }

    .value-card::before {
      content: "";
      position: absolute;
      inset: 0;
      border-radius: inherit;
      background: linear-gradient(
        180deg,
        rgba(255,255,255,0.15),
        rgba(255,255,255,0.05)
      );
      pointer-events: none;
    }

    .value-card:hover {
      transform: translateY(-4px);
      box-shadow: 0 12px 28px rgba(0, 0, 0, 0.2);
      background: rgba(255, 255, 255, 0.25);
      border-color: rgba(255, 255, 255, 0.4);
    }

    .value-key {
      font-size: 14px;
      font-weight: 600;
      color: white;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-bottom: 8px;
      word-break: break-all;
      overflow-wrap: break-word;
      hyphens: auto;
      text-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
      position: relative;
      z-index: 1;
    }

    .value-amount {
      font-size: 32px;
      font-weight: 700;
      color: white;
      font-family: 'SF Mono', Monaco, monospace;
      text-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
      position: relative;
      z-index: 1;
    }

    /* Tree View */
    .tree-container {
      position: relative;
    }

    .tree-node {
      position: relative;
      margin-bottom: 4px;
    }

    .tree-node-header {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 12px 16px;
      background: rgba(255, 255, 255, 0.12);
      border-radius: 8px;
      transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
      border: 1px solid rgba(255, 255, 255, 0.15);
    }

    .tree-node-header:hover {
      background: rgba(255, 255, 255, 0.2);
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
      transform: translateX(4px);
      border-color: rgba(255, 255, 255, 0.3);
    }

    .tree-toggle {
      width: 24px;
      height: 24px;
      background: rgba(255, 255, 255, 0.2);
      border: 1px solid rgba(255, 255, 255, 0.25);
      border-radius: 6px;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 12px;
      transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
      flex-shrink: 0;
      color: white;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
    }

    .tree-toggle:hover {
      background: rgba(255, 255, 255, 0.3);
      transform: scale(1.1);
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
    }

    .tree-toggle.collapsed {
      transform: rotate(-90deg);
    }

    .tree-toggle.collapsed:hover {
      transform: rotate(-90deg) scale(1.1);
    }

    .tree-spacer {
      width: 24px;
      flex-shrink: 0;
    }

    .tree-node-info {
      flex: 1;
      display: flex;
      align-items: center;
      gap: 12px;
      flex-wrap: wrap;
      min-width: 0;
    }

    .tree-node-name {
      font-size: 15px;
      font-weight: 600;
      color: white;
      text-decoration: none;
      transition: all 0.2s;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      max-width: 300px;
      text-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
    }

    .tree-node-name:hover {
      text-shadow: 0 0 10px rgba(255, 255, 255, 0.8);
      transform: translateX(2px);
    }

    .value-count {
      font-size: 12px;
      color: white;
      padding: 2px 8px;
      background: rgba(255, 255, 255, 0.15);
      border-radius: 10px;
      border: 1px solid rgba(255, 255, 255, 0.2);
      flex-shrink: 0;
      text-shadow: 0 1px 2px rgba(0, 0, 0, 0.1);
    }

    .tree-node-values {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
      gap: 8px;
      margin: 12px 0 12px 36px;
      padding: 12px;
      background: rgba(255, 255, 255, 0.1);
      border-radius: 8px;
      border-left: 3px solid rgba(255, 255, 255, 0.4);
    }

    .tree-node-values.total-values {
      border-left-color: rgba(16, 185, 129, 0.6);
    }

    .node-value-item {
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: 4px;
      padding: 10px 12px;
      background: rgba(255, 255, 255, 0.15);
      border-radius: 6px;
      transition: all 0.2s;
      min-height: 60px;
      cursor: help;
      overflow: hidden;
      border: 1px solid rgba(255, 255, 255, 0.15);
    }

    .node-value-item:hover {
      background: rgba(255, 255, 255, 0.25);
      transform: translateY(-2px);
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
    }

    .value-key-small {
      font-size: 11px;
      font-weight: 600;
      color: white;
      letter-spacing: 0.3px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      max-width: 100%;
      line-height: 1.3;
      text-shadow: 0 1px 2px rgba(0, 0, 0, 0.2);
    }

    .value-amount-small {
      font-size: 16px;
      font-weight: 700;
      color: white;
      font-family: 'SF Mono', Monaco, monospace;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      max-width: 100%;
      text-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
    }

    .empty-values {
      font-size: 13px;
      color: rgba(255, 255, 255, 0.6);
      font-style: italic;
      padding: 8px;
    }

    .tree-children {
      margin-left: 20px;
      padding-left: 12px;
      border-left: 2px solid rgba(255, 255, 255, 0.2);
      margin-top: 4px;
      transition: all 0.3s;
    }

    .tree-children.collapsed {
      display: none;
    }

    /* Empty States */
    .empty-state-small {
      text-align: center;
      padding: 40px;
      color: rgba(255, 255, 255, 0.7);
      font-style: italic;
    }

    /* Controls */
    .tree-controls {
      display: flex;
      gap: 12px;
      margin-bottom: 16px;
      flex-wrap: wrap;
    }

    .btn-control {
      padding: 8px 16px;
      background: rgba(255, 255, 255, 0.15);
      border: 1px solid rgba(255, 255, 255, 0.2);
      border-radius: 980px;
      font-size: 14px;
      font-weight: 600;
      color: white;
      cursor: pointer;
      transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1),
        inset 0 1px 0 rgba(255, 255, 255, 0.2);
      position: relative;
      overflow: hidden;
    }

    .btn-control::before {
      content: "";
      position: absolute;
      inset: -40%;
      background: radial-gradient(
        120% 60% at 0% 0%,
        rgba(255, 255, 255, 0.3),
        transparent 60%
      );
      opacity: 0;
      transform: translateX(-30%) translateY(-10%);
      transition: opacity 0.35s ease, transform 0.6s cubic-bezier(0.22, 1, 0.36, 1);
      pointer-events: none;
    }

    .btn-control:hover {
      background: rgba(255, 255, 255, 0.25);
      transform: translateY(-2px);
      box-shadow: 0 6px 20px rgba(0, 0, 0, 0.15);
    }

    .btn-control:hover::before {
      opacity: 1;
      transform: translateX(30%) translateY(10%);
    }

    .btn-control.active {
      background: rgba(255, 255, 255, 0.3);
      box-shadow: 0 6px 20px rgba(0, 0, 0, 0.2),
        inset 0 1px 0 rgba(255, 255, 255, 0.4);
    }

    .controls-group {
      display: flex;
      gap: 8px;
      background: rgba(255, 255, 255, 0.1);
      padding: 4px;
      border-radius: 980px;
      border: 1px solid rgba(255, 255, 255, 0.2);
    }

    .controls-group .btn-control {
      border: none;
      background: transparent;
      box-shadow: none;
    }

    .controls-group .btn-control:hover {
      background: rgba(255, 255, 255, 0.2);
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
    }

    .controls-group .btn-control.active {
      background: rgba(255, 255, 255, 0.25);
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
    }

    /* Responsive */
    @media (max-width: 640px) {
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

      .flat-grid {
        grid-template-columns: 1fr;
      }

      .tree-children {
        margin-left: 20px;
        padding-left: 12px;
      }

      .tree-node-values {
        margin-left: 36px;
        grid-template-columns: 1fr;
      }

      .back-nav {
        flex-direction: column;
      }

      .back-link {
        justify-content: center;
      }

      .value-amount {
        font-size: 24px;
      }

      .tree-node-name {
        max-width: 200px;
      }

      .tree-controls {
        flex-direction: column;
      }

      .controls-group {
        width: 100%;
      }

      .controls-group .btn-control {
        flex: 1;
        text-align: center;
      }
    }

    @media (min-width: 641px) and (max-width: 1024px) {
      .container {
        max-width: 800px;
      }

      .flat-grid {
        grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
      }
    }
  </style>
</head>
<body>
  <div class="container">
    <!-- Back Navigation -->
    <div class="back-nav">
      <a href="/api/v1/root/${nodeId}${queryString}" class="back-link">
        <- Back to Tree
      </a>
    </div>

    <!-- Header -->
    <div class="glass-card header">
      <h1>Global Values</h1>
      <div class="header-subtitle">Cumulative values across all nodes</div>
    </div>

    <!-- Flat Summary -->
    <div class="glass-card section">
      <div class="section-title">Total Summary</div>
      <div class="flat-grid">
        ${flatSummary}
      </div>
    </div>

    <!-- Tree View -->
    <div class="glass-card section">
      <div class="tree-controls">
        <div class="controls-group">
          <button class="btn-control active" id="showLocalBtn" onclick="showLocalValues()">
            Local Values
          </button>
          <button class="btn-control" id="showTotalBtn" onclick="showTotalValues()">
            Total Values
          </button>
        </div>
        <button class="btn-control" onclick="expandAll()">Expand All</button>
        <button class="btn-control" onclick="collapseAll()">Collapse All</button>
      </div>
      <div class="tree-container">
        ${renderTree(result.tree)}
      </div>
    </div>
  </div>

  <script>
    let currentView = 'local';

    function showLocalValues() {
      currentView = 'local';
      document.getElementById('showLocalBtn').classList.add('active');
      document.getElementById('showTotalBtn').classList.remove('active');

      document.querySelectorAll('.local-values').forEach(el => {
        el.style.display = 'grid';
      });
      document.querySelectorAll('.total-values').forEach(el => {
        el.style.display = 'none';
      });
    }

    function showTotalValues() {
      currentView = 'total';
      document.getElementById('showTotalBtn').classList.add('active');
      document.getElementById('showLocalBtn').classList.remove('active');

      document.querySelectorAll('.local-values').forEach(el => {
        el.style.display = 'none';
      });
      document.querySelectorAll('.total-values').forEach(el => {
        el.style.display = 'grid';
      });
    }

    function toggleNode(button) {
      button.classList.toggle('collapsed');
      const treeNode = button.closest('.tree-node');
      const children = treeNode.querySelector('.tree-children');
      if (children) {
        children.classList.toggle('collapsed');
      }
    }

    function expandAll() {
      document.querySelectorAll('.tree-toggle').forEach(btn => {
        btn.classList.remove('collapsed');
      });
      document.querySelectorAll('.tree-children').forEach(children => {
        children.classList.remove('collapsed');
      });
    }

    function collapseAll() {
      document.querySelectorAll('.tree-toggle').forEach(btn => {
        btn.classList.add('collapsed');
      });
      document.querySelectorAll('.tree-children').forEach(children => {
        children.classList.add('collapsed');
      });
    }
  </script>
</body>
</html>
    `;
}
