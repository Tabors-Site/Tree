import express from "express";
import urlAuth from "../middleware/urlAuth.js";
import authenticate from "../middleware/authenticate.js";
import { getAllData } from "../controllers/treeDataFetching.js";
import { createInvite } from "../core/invites.js";
import { getCalendar } from "../core/schedules.js";
import { setTransactionPolicy } from "../core/transactions.js";

import Node from "../db/models/node.js";

const router = express.Router();

// Only allow these params to remain in querystring
const allowedParams = [
  "token",
  "html",
  "trimmed",
  "active",
  "completed",
  "startDate",
  "endDate",
  "month",
  "year",
];

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

router.get("/root/:nodeId", urlAuth, async (req, res) => {
  try {
    const { nodeId } = req.params;

    // CLEAN QUERY STRING (keep only token + html)
    const filtered = Object.entries(req.query)
      .filter(([key]) => allowedParams.includes(key))
      .map(([key, val]) => (val === "" ? key : `${key}=${val}`))
      .join("&");

    const queryString = filtered ? `?${filtered}` : "";

    // CALL getAllData(rootId)
    const fakeReq = { ...req, body: { rootId: nodeId } };
    let allData = null;

    const fakeRes = {
      json(data) {
        allData = data;
      },
    };

    await getAllData(fakeReq, fakeRes);
    if (!allData) return res.status(500).send("getAllData failed");

    // Load owner + contributors
    const rootMeta = await Node.findById(nodeId)
      .populate("rootOwner", "username _id")
      .populate("contributors", "username _id")
      .select("rootOwner contributors transactionPolicy")
      .lean()
      .exec();
    const rootNode = await Node.findById(nodeId).select("parent").lean();
    const isDeleted = rootNode.parent === "deleted";

    const isRoot = rootNode.parent === null;
    let rootNameColor = "#000"; // default

    if (isDeleted) {
      rootNameColor = "#b00020"; // red
    } else if (isRoot) {
      rootNameColor = "#2e7d32"; // green
    }

    // JSON MODE
    const wantHtml = Object.prototype.hasOwnProperty.call(req.query, "html");
    if (!wantHtml) {
      return res.json({
        ...allData,
        rootOwner: rootMeta?.rootOwner || null,
        contributors: rootMeta?.contributors || [],
      });
    }
    const transactionPolicy = rootMeta?.transactionPolicy ?? "OWNER_ONLY";

    const renderParents = (chain) => {
      let html = "<h3>Parents</h3>";
      let depth = 0;

      for (const node of chain) {
        const color = rainbow[depth % rainbow.length];

        html += `
      <ul>
        <li style="
          border-left: 4px solid ${color};
          padding-left: 12px;
          margin: 6px 0;
          font-weight: ${node.isCurrent ? "700" : "500"};
        ">
       ${
         node.isCurrent
           ? `<a href="/api/${node._id}${queryString}">
<strong><u>${node.name}</u></strong>
       </a> (current)`
           : `<a href="/api/root/${node._id}${queryString}">
         ${node.name}
       </a>`
       }

    `;
        depth++;
      }

      // close all opened tags
      for (let i = 0; i < chain.length; i++) {
        html += `</li></ul>`;
      }

      return html;
    };

    // DEPTH-AWARE TREE RENDERING (children only)
    const renderTree = (node, depth = 0) => {
      const color = rainbow[depth % rainbow.length];

      let html = `
        <li style="
          border-left: 4px solid ${color};
          padding-left: 12px;
          margin: 6px 0;
        ">
          <a href="/api/${node._id}/${node.prestige}${queryString}">
            ${node.name}
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
    const isOwner =
      rootMeta?.rootOwner?._id?.toString() === req.userId?.toString();

    const inviteFormHtml = isOwner
      ? `
<h2>Invite Contributor</h2>

<form
  method="POST"
  action="/api/root/${nodeId}/invite?token=${req.query.token ?? ""}&html"
  style="display:flex; gap:8px; max-width:420px; margin-top:8px;"
>
  <input
    type="text"
    name="userReceiving"
    placeholder="Username or User ID"
    required
    style="
      flex:1;
      padding:8px 10px;
      font-size:14px;
      border-radius:6px;
      border:1px solid #ccc;
    "
  />

  <button
    type="submit"
    style="
      padding:8px 14px;
      border-radius:6px;
      border:1px solid #999;
      background:#eee;
      cursor:pointer;
    "
  >
    Invite
  </button>
</form>
`
      : ``;

    const policyHtml = isOwner
      ? `

<form
  method="POST"
  action="/api/root/${nodeId}/transaction-policy?token=${
          req.query.token ?? ""
        }&html"
  style="max-width: 420px;"
>
  <label style="font-weight:600; display:block; margin-bottom:8px;">
    Transaction Approval Mode
  </label>

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
      : `

`;

    // OWNER + CONTRIBUTORS
    const ownerHtml = rootMeta?.rootOwner
      ? `
   
      Root Owner: <a href="/api/user/${rootMeta.rootOwner._id}${queryString}">
        ${rootMeta.rootOwner.username}
      </a>

    
  `
      : ``;

    const contributorsHtml = rootMeta?.contributors?.length
      ? `
<h2>Contributors</h2>
<ul class="contributors-list">
${rootMeta.contributors
  .map((u) => {
    const isSelf = u._id.toString() === req.userId?.toString();

    return `
<li>
  <a href="/api/user/${u._id}${queryString}">
    ${u.username}
  </a>

  <div class="contributors-actions">
    ${
      isOwner
        ? `
      <form
        method="POST"
        action="/api/root/${nodeId}/transfer-owner?token=${
            req.query.token ?? ""
          }&html"
        onsubmit="return confirm('Transfer ownership to ${u.username}?')"
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
        action="/api/root/${nodeId}/remove-user?token=${
            req.query.token ?? ""
          }&html"
        onsubmit="return confirm('${
          isSelf ? "Leave this root?" : `Remove ${u.username} from this root?`
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

    const ancestors = allData.ancestors || [];
    const retireHtml = isOwner
      ? `
<form
  method="POST"
  action="/api/root/${nodeId}/retire?token=${req.query.token ?? ""}&html"
  onsubmit="return confirm('This will retire the root. Continue?')"
  style="margin-top:12px;"
>
  <button
    type="submit"
    style="
      padding:8px 14px;
      border-radius:8px;
      border:1px solid #900;
      background:#fff0f0;
      color:#900;
      font-weight:600;
      cursor:pointer;
    "
  >
    Retire Root
  </button>
</form>
`
      : "";

    const parentHtml = ancestors.length
      ? renderParents([
          ...ancestors.slice().reverse(), // root → parent
          {
            _id: allData._id,
            name: allData.name,
            isCurrent: true,
          },
        ])
      : ``;

    // CHILDREN
    const childrenHtml = allData.children?.length
      ? `<ul>${allData.children.map((c) => renderTree(c)).join("")}</ul>`
      : `<p><em>No children</em></p>`;

    // SAFE JSON
    const jsonDump = JSON.stringify(allData, null, 2)
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");

    // Replace the HTML return in your /root/:nodeId route with this:

    // Add at the top of the route handler to get userId
    const currentUserId = req.userId ? req.userId.toString() : null;

    // SEND HTML
    return res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="theme-color" content="#667eea">
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
  <title>${allData.name} — Tree</title>
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

    /* Main Content Card */
    .content-card {
      background: rgba(255, 255, 255, 0.95);
      backdrop-filter: blur(10px);
      border-radius: 16px;
      padding: 28px;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.1);
      margin-bottom: 24px;
    }

    /* Header Section */
    .header-section {
      margin-bottom: 24px;
      padding-bottom: 20px;
      border-bottom: 2px solid #e0e0e0;
    }

    .owner-info {
      font-size: 14px;
      color: #667eea;
      font-weight: 600;
      margin-bottom: 8px;
    }

    .owner-info a {
      color: #667eea;
      text-decoration: none;
      transition: color 0.2s;
    }

    .owner-info a:hover {
      color: #764ba2;
      text-decoration: underline;
    }

    h1 {
      font-size: 28px;
      margin: 12px 0;
      font-weight: 700;
      line-height: 1.3;
    }

    h1 a {
      color: ${rootNameColor};
      text-decoration: none;
      transition: color 0.2s;
    }

    h1 a:hover {
      opacity: 0.8;
    }

    .node-id-container {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-top: 12px;
    }

    code {
      background: #f0f0f0;
      padding: 6px 12px;
      border-radius: 6px;
      font-size: 13px;
      font-family: 'SF Mono', Monaco, 'Cascadia Code', monospace;
      color: #666;
      word-break: break-all;
    }

    #copyNodeIdBtn {
      background: none;
      border: none;
      cursor: pointer;
      padding: 6px;
      opacity: 0.6;
      font-size: 18px;
      transition: opacity 0.2s, transform 0.2s;
    }

    #copyNodeIdBtn:hover {
      opacity: 1;
      transform: scale(1.1);
    }

    /* Section Headers */
    h2 {
      font-size: 18px;
      margin: 24px 0 16px 0;
      font-weight: 700;
      color: #1a1a1a;
    }

    h3 {
      font-size: 16px;
      margin: 20px 0 12px 0;
      font-weight: 600;
      color: #667eea;
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
      border-radius: 8px;
      color: white;
      font-weight: 600;
      transition: all 0.2s;
      text-decoration: none;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
    }

    #filterButtons a:hover {
      transform: translateY(-2px);
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
      text-decoration: none;
    }

    /* Tree Structure */
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
      color: #667eea;
      text-decoration: none;
      font-weight: 500;
      transition: color 0.2s;
    }

    li a:hover {
      color: #764ba2;
      text-decoration: underline;
    }

    /* Parents/Children with colored borders */
    li[style*="border-left"] {
      padding-left: 12px !important;
      margin: 6px 0 !important;
      position: relative;
    }

    /* Forms */
    form {
      margin: 16px 0;
    }

    input[type="text"] {
      width: 100%;
      padding: 12px 14px;
      font-size: 15px;
      border-radius: 8px;
      border: 1px solid #d0d0d0;
      background: white;
      font-family: inherit;
      transition: all 0.2s;
    }

    input[type="text"]:focus {
      outline: none;
      border-color: #667eea;
      box-shadow: 0 0 0 3px rgba(102, 126, 234, 0.1);
    }

    button[type="submit"] {
      padding: 10px 18px;
      border-radius: 8px;
      border: none;
      background: #667eea;
      color: white;
      cursor: pointer;
      font-weight: 600;
      font-size: 14px;
      transition: all 0.2s;
      font-family: inherit;
    }

    button[type="submit"]:hover {
      background: #5856d6;
      transform: translateY(-1px);
      box-shadow: 0 4px 12px rgba(102, 126, 234, 0.3);
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

    /* Contributors */
    .contributors-list {
      list-style: none;
      padding-left: 0;
    }

    .contributors-list li {
      display: flex;
      flex-direction: column;
      gap: 8px;
      padding: 14px 16px;
      background: #f8f9fa;
      border-radius: 10px;
      margin: 8px 0;
      border: 1px solid #e0e0e0;
      transition: all 0.2s;
    }

    .contributors-list li:hover {
      background: white;
      transform: translateX(4px);
      box-shadow: 0 4px 12px rgba(102, 126, 234, 0.1);
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
      color: #667eea;
    }

    .contributors-list form {
      display: inline-block;
      margin: 0;
    }

    .contributors-list button {
      padding: 6px 12px;
      font-size: 13px;
      border-radius: 6px;
      border: 1px solid #d0d0d0;
      background: white;
      color: #666;
      cursor: pointer;
      transition: all 0.2s;
    }

    .contributors-list button:hover {
      background: #f0f0f0;
      border-color: #999;
    }

    .contributors-actions {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
    }

    /* Retire Button */
    form[action*="/retire"] button {
      background: #fff5f5 !important;
      color: #c62828 !important;
      border: 1px solid #c62828 !important;
    }

    form[action*="/retire"] button:hover {
      background: #ffebee !important;
      transform: translateY(-2px);
      box-shadow: 0 4px 12px rgba(198, 40, 40, 0.3) !important;
    }

    /* Jump Buttons */
    #jumpTop,
    #jumpBottom {
      position: fixed;
      right: 20px;
      width: 48px;
      height: 48px;
      border-radius: 50%;
      border: none;
      background: rgba(102, 126, 234, 0.95);
      backdrop-filter: blur(10px);
      color: white;
      font-size: 12px;
      font-weight: 700;
      cursor: pointer;
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.2);
      opacity: 0.9;
      transition: all 0.2s;
      z-index: 999;
    }

    #jumpTop:hover,
    #jumpBottom:hover {
      opacity: 1;
      transform: translateY(-3px) scale(1.05);
      box-shadow: 0 6px 20px rgba(0, 0, 0, 0.3);
    }

    #jumpTop {
      top: 20px;
    }

    #jumpBottom {
      bottom: 20px;
    }

    /* Responsive Design */
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

      #jumpTop,
      #jumpBottom {
        width: 44px;
        height: 44px;
        right: 16px;
        font-size: 11px;
      }

      #jumpTop {
        top: 16px;
      }

      #jumpBottom {
        bottom: 16px;
      }
    }

    @media (min-width: 641px) and (max-width: 1024px) {
      .container {
        max-width: 700px;
      }
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
      <a href="/api/user/${currentUserId}${queryString}" class="back-link">
        ← Back to Profile
      </a>
        <a href="/api/root/${allData._id}/calendar${queryString}" class="back-link">
        Calendar
      </a>
    </div>
    `
        : ""
    }

    <!-- Main Content Card -->
    <div class="content-card">
      <!-- Header Section -->
      <div class="header-section">
        ${parentHtml}
        
        <div class="owner-info">${ownerHtml}</div>
        
        <h1>
          <a href="/api/${allData._id}/${allData.prestige}${queryString}">
            ${allData.name}
          </a>
        </h1>

        <div class="node-id-container">
          <code id="nodeIdCode">${allData._id}</code>
          <button id="copyNodeIdBtn" title="Copy ID">📋</button>
        </div>
      </div>

      <!-- Filters -->
      <h2>Filters</h2>
      <div id="filterButtons"></div>

      <!-- Children Tree -->
      <h2>Children</h2>
      ${childrenHtml}

      <!-- Invite Form -->
      ${inviteFormHtml}

      <!-- Contributors -->
      ${contributorsHtml}

      <!-- Transaction Policy -->
${policyHtml}

      <!-- Retire Button -->
      ${retireHtml}
    </div>

    <!-- Jump Buttons -->
    <button id="jumpTop" title="Jump to top">TOP</button>
    <button id="jumpBottom" title="Jump to bottom">BOT</button>
  </div>

  <script>
    // Jump buttons
    document.getElementById("jumpTop").addEventListener("click", () => {
      window.scrollTo({ top: 0, behavior: "smooth" });
    });

    document.getElementById("jumpBottom").addEventListener("click", () => {
      window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" });
    });

    // Copy ID
    const btn = document.getElementById("copyNodeIdBtn");
    const code = document.getElementById("nodeIdCode");

    btn.addEventListener("click", () => {
      navigator.clipboard.writeText(code.textContent).then(() => {
        btn.textContent = "✔️";
        setTimeout(() => (btn.textContent = "📋"), 900);
      });
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
      makeToggle("trimmed");
  </script>
</body>
</html>
`);
  } catch (err) {
    console.error("Error in /root/:nodeId:", err);
    res.status(500).json({ error: err.message });
  }
});

// POST /root/:rootId/invite
router.post("/root/:rootId/invite", authenticate, async (req, res) => {
  try {
    const { rootId } = req.params;
    const { userReceiving } = req.body;

    if (!userReceiving) {
      return res.status(400).json({
        success: false,
        error: "userReceiving is required",
      });
    }

    await createInvite({
      userInvitingId: req.userId,
      userReceiving, // username OR userId
      rootId,
      isToBeOwner: false,
      isUninviting: false,
    });

    // HTML redirect support
    if ("html" in req.query) {
      return res.redirect(
        `/api/root/${rootId}?token=${req.query.token ?? ""}&html`
      );
    }

    return res.json({ success: true });
  } catch (err) {
    return res.status(400).json({
      success: false,
      error: err.message,
    });
  }
});

// POST /root/:rootId/transfer-owner
router.post("/root/:rootId/transfer-owner", authenticate, async (req, res) => {
  try {
    const { rootId } = req.params;
    const { userReceiving } = req.body;

    if (!userReceiving) {
      return res.status(400).json({
        success: false,
        error: "userReceiving is required",
      });
    }

    await createInvite({
      userInvitingId: req.userId,
      userReceiving, // username OR userId
      rootId,
      isToBeOwner: true, // ⭐ THIS is the key
      isUninviting: false,
    });

    // HTML redirect support
    if ("html" in req.query) {
      return res.redirect(
        `/api/root/${rootId}?token=${req.query.token ?? ""}&html`
      );
    }

    return res.json({ success: true });
  } catch (err) {
    return res.status(400).json({
      success: false,
      error: err.message,
    });
  }
});

// POST /root/:rootId/remove-user
router.post("/root/:rootId/remove-user", authenticate, async (req, res) => {
  try {
    const { rootId } = req.params;
    const { userReceiving } = req.body;

    if (!userReceiving) {
      return res.status(400).json({
        success: false,
        error: "userReceiving is required",
      });
    }

    await createInvite({
      userInvitingId: req.userId,
      userReceiving, // userId
      rootId,
      isToBeOwner: false,
      isUninviting: true, // ⭐ THIS triggers removal logic
    });

    if ("html" in req.query) {
      return res.redirect(
        `/api/user/${req.userId}?token=${req.query.token ?? ""}&html`
      );
    }

    return res.json({ success: true });
  } catch (err) {
    return res.status(400).json({
      success: false,
      error: err.message,
    });
  }
});

// POST /root/:rootId/retire
router.post("/root/:rootId/retire", authenticate, async (req, res) => {
  try {
    const { rootId } = req.params;

    await createInvite({
      userInvitingId: req.userId,
      userReceiving: req.userId,
      rootId,
      isToBeOwner: false,
      isUninviting: true,
    });

    if ("html" in req.query) {
      return res.redirect(
        `/api/user/${req.userId}?token=${req.query.token ?? ""}&html`
      );
    }

    return res.json({ success: true });
  } catch (err) {
    return res.status(400).json({
      success: false,
      error: err.message,
    });
  }
});

router.get("/root/:rootId/calendar", urlAuth, async (req, res) => {
  try {
    const { rootId } = req.params;

    // ✅ SAME QUERY CLEANING LOGIC AS /root/:nodeId
    const filtered = Object.entries(req.query)
      .filter(([key]) => allowedParams.includes(key))
      .map(([key, val]) => (val === "" ? key : `${key}=${val}`))
      .join("&");

    const queryString = filtered ? `?${filtered}` : "";

    const now = new Date();

    let month = Number(req.query.month);
    let year = Number(req.query.year);

    if (!Number.isInteger(month) || month < 0 || month > 11) {
      month = now.getMonth();
    }

    if (!Number.isInteger(year) || year < 1970 || year > 3000) {
      year = now.getFullYear();
    }

    // ✅ Month → date range (this matches your core getCalendar)
    const startDate = new Date(year, month, 1);
    const endDate = new Date(year, month + 1, 0, 23, 59, 59, 999);

    const calendar = await getCalendar({
      rootNodeId: rootId,
      startDate,
      endDate,
    });

    // JSON MODE
    if (!("html" in req.query)) {
      return res.json({
        calendar,
      });
    }

    // Group by YYYY-MM-DD
    const byDay = {};
    for (const item of calendar) {
      const day = new Date(item.schedule).toISOString().slice(0, 10);
      if (!byDay[day]) byDay[day] = [];
      byDay[day].push(item);
    }

    // Replace the HTML return in your /root/:rootId/calendar route with this:

    return res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="theme-color" content="#667eea">
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
  <title>Calendar</title>
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
      max-width: 1200px;
      margin: 0 auto;
    }

    /* Header */
    .header {
      background: rgba(255, 255, 255, 0.95);
      backdrop-filter: blur(10px);
      border-radius: 16px;
      padding: 20px 24px;
      margin-bottom: 20px;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.1);
    }

    .header-top {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 16px;
      flex-wrap: wrap;
      margin-bottom: 16px;
    }

    .back-link {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 10px 16px;
      background: #f8f9fa;
      color: #667eea;
      text-decoration: none;
      border-radius: 10px;
      font-weight: 600;
      font-size: 14px;
      transition: all 0.2s;
      border: 1px solid transparent;
    }

    .back-link:hover {
      background: white;
      border-color: #667eea;
      transform: translateY(-2px);
      box-shadow: 0 4px 12px rgba(102, 126, 234, 0.2);
    }

    .nav-controls {
      display: flex;
      align-items: center;
      gap: 16px;
    }

    .nav-button {
      width: 36px;
      height: 36px;
      border-radius: 50%;
      border: none;
      background: #667eea;
      color: white;
      font-size: 18px;
      cursor: pointer;
      transition: all 0.2s;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .nav-button:hover {
      background: #5856d6;
      transform: scale(1.1);
    }

    .month-label {
      font-size: 18px;
      font-weight: 700;
      color: #1a1a1a;
      min-width: 180px;
      text-align: center;
    }

    .clock {
      font-size: 14px;
      color: #666;
      font-weight: 500;
    }

    /* Calendar Grid - Desktop */
    .calendar-grid {
      display: grid;
      grid-template-columns: repeat(7, 1fr);
      gap: 12px;
    }

    .day-header {
      background: rgba(255, 255, 255, 0.95);
      backdrop-filter: blur(10px);
      border-radius: 10px;
      padding: 12px;
      text-align: center;
      font-weight: 700;
      font-size: 14px;
      color: #667eea;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
    }

    .day-cell {
      background: rgba(255, 255, 255, 0.95);
      backdrop-filter: blur(10px);
      border-radius: 12px;
      padding: 12px;
      min-height: 120px;
      cursor: pointer;
      transition: all 0.2s;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
      position: relative;
      overflow: hidden;
    }

    .day-cell:hover {
      transform: translateY(-2px);
      box-shadow: 0 8px 24px rgba(102, 126, 234, 0.2);
      outline: 2px solid #667eea;
    }

    .day-cell.other-month {
      opacity: 0.4;
    }

    .day-number {
      font-weight: 700;
      font-size: 16px;
      color: #1a1a1a;
      margin-bottom: 8px;
    }

    .day-cell.today .day-number {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      width: 28px;
      height: 28px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 14px;
    }

    .node-item {
      display: block;
      margin: 4px 0;
      padding: 6px 10px;
      border-radius: 8px;
      background: #667eea;
      color: white;
      font-size: 12px;
      text-decoration: none;
      transition: all 0.2s;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .node-item:hover {
      background: #5856d6;
      transform: translateX(2px);
    }

    .node-count {
      display: inline-block;
      margin-top: 4px;
      padding: 4px 8px;
      background: rgba(102, 126, 234, 0.15);
      color: #667eea;
      font-size: 11px;
      font-weight: 700;
      border-radius: 12px;
    }

    /* List View - Mobile */
    .calendar-list {
      display: none;
    }

    .list-day {
      background: rgba(255, 255, 255, 0.95);
      backdrop-filter: blur(10px);
      border-radius: 12px;
      padding: 16px;
      margin-bottom: 12px;
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.08);
      cursor: pointer;
      transition: all 0.2s;
    }

    .list-day:hover {
      transform: translateY(-2px);
      box-shadow: 0 6px 24px rgba(0, 0, 0, 0.12);
    }

    .list-day-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 12px;
    }

    .list-day-date {
      font-weight: 700;
      font-size: 16px;
      color: #1a1a1a;
    }

    .list-day-badge {
      padding: 4px 12px;
      background: #667eea;
      color: white;
      border-radius: 12px;
      font-size: 12px;
      font-weight: 700;
    }

    /* Day View */
    .day-view {
      background: rgba(255, 255, 255, 0.95);
      backdrop-filter: blur(10px);
      border-radius: 16px;
      padding: 24px;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.1);
    }

    .hour-row {
      display: flex;
      border-bottom: 1px solid #e0e0e0;
      padding: 12px 0;
      min-height: 60px;
      transition: background 0.2s;
    }

    .hour-row:hover {
      background: rgba(102, 126, 234, 0.05);
    }

    .hour-label {
      width: 80px;
      font-weight: 700;
      color: #667eea;
      font-size: 14px;
      flex-shrink: 0;
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
      color: #999;
    }

    .empty-state-icon {
      font-size: 64px;
      margin-bottom: 16px;
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
        display: block;
      }

      .day-view {
        padding: 16px;
      }

      .hour-label {
        width: 60px;
        font-size: 12px;
      }

      .month-label {
        font-size: 16px;
      }
    }
  </style>
</head>
<body>
  <div class="container">
    <!-- Header -->
    <div class="header">
      <div class="header-top">
        <a href="/api/root/${rootId}${queryString}" class="back-link" id="backLink">
          ← Back to Tree
        </a>

        <div class="nav-controls">
          <button class="nav-button" id="prevMonth">←</button>
          <div class="month-label" id="monthLabel"></div>
          <button class="nav-button" id="nextMonth">→</button>
        </div>

        <div class="clock" id="clock"></div>
      </div>
    </div>

    <!-- Calendar Container -->
    <div id="calendarContainer"></div>
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
      backLink.textContent = "← Back to Month";
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
            html += \`<a class="node-item" href="/api/\${item.nodeId}/\${item.versionIndex}${queryString}">\${item.name}</a>\`;
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
                    \${isToday ? ' <span style="color: #667eea;">(Today)</span>' : ''}
                  </div>
                  \${items.length > 0 ? \`<span class="list-day-badge">\${items.length} item\${items.length !== 1 ? 's' : ''}</span>\` : ''}
                </div>
            \`;

            if (items.length > 0) {
              items.slice(0, 3).forEach(item => {
                html += \`<a class="node-item" href="/api/\${item.nodeId}/\${item.versionIndex}${queryString}" onclick="event.stopPropagation()">\${item.name}</a>\`;
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
            html += \`<a class="node-item" href="/api/\${item.nodeId}/\${item.versionIndex}${queryString}" onclick="event.stopPropagation()">\${item.name}</a>\`;
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
`);
  } catch (err) {
    console.error("Calendar error:", err);
    res.status(err.status || 500).json({ error: err.message });
  }
});

router.post(
  "/root/:nodeId/transaction-policy",
  authenticate,
  async (req, res) => {
    try {
      const { nodeId } = req.params;
      const { policy } = req.body;

      const result = await setTransactionPolicy({
        rootNodeId: nodeId,
        policy,
        userId: req.userId,
      });

      // HTML fallback
      if ("html" in req.query) {
        return res.redirect(
          `/api/root/${nodeId}?token=${req.query.token ?? ""}&html`
        );
      }

      return res.json({ success: true, ...result });
    } catch (err) {
      console.error("Change policy error:", err);
      res.status(400).json({ error: err.message });
    }
  }
);

export default router;
