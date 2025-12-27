import express from "express";
import urlAuth from "../middleware/urlAuth.js";
import authenticate from "../middleware/authenticate.js";
import { getAllData } from "../controllers/treeDataFetching.js";
import { createInvite } from "../core/invites.js";

import Node from "../db/models/node.js";

const router = express.Router();

// Only allow these params to remain in querystring
const allowedParams = ["token", "html", "trimmed", "active", "completed"];

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
      .select("rootOwner contributors")
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

    // SEND HTML
    return res.send(`
      <html>
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1.0">

        <title>${allData.name} — Tree</title>
       <style>
  * {
    box-sizing: border-box;
  }

  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen', 'Ubuntu', 'Cantarell', sans-serif;
    padding: 16px;
    line-height: 1.6;
    background: #f5f5f5;
    color: #1a1a1a;
    margin: 0;
    max-width: 1200px;
    margin: 0 auto;
  }

  @media (min-width: 768px) {
    body {
      padding: 32px 40px;
    }
  }

  /* Typography */
  h1 {
    font-size: 24px;
    margin: 16px 0 8px 0;
    font-weight: 700;
    line-height: 1.3;
  }

  @media (min-width: 768px) {
    h1 {
      font-size: 32px;
      margin: 20px 0 12px 0;
    }
  }

  h2 {
    font-size: 18px;
    margin: 32px 0 12px 0;
    font-weight: 600;
    color: #333;
  }

  @media (min-width: 768px) {
    h2 {
      font-size: 20px;
      margin: 40px 0 16px 0;
    }
  }

  h3 {
    font-size: 16px;
    margin: 24px 0 8px 0;
    font-weight: 600;
    color: #555;
  }

  @media (min-width: 768px) {
    h3 {
      font-size: 18px;
    }
  }

  /* Links */
  a {
    color: #0066cc;
    text-decoration: none;
    font-weight: 500;
    transition: color 0.2s ease;
  }

  a:hover {
    color: #0052a3;
    text-decoration: underline;
  }

  a:active {
    color: #003d7a;
  }

  /* Tree Lists */
  ul {
    list-style: none;
    padding-left: 12px;
    margin: 8px 0;
  }

  @media (min-width: 768px) {
    ul {
      padding-left: 20px;
      margin: 12px 0;
    }
  }

  li {
    margin: 8px 0;
    word-wrap: break-word;
    overflow-wrap: break-word;
  }

  /* Code and ID Display */
  code {
    background: #e8e8e8;
    padding: 4px 8px;
    border-radius: 4px;
    font-size: 13px;
    font-family: 'SF Mono', Monaco, 'Cascadia Code', 'Courier New', monospace;
    word-break: break-all;
  }

  @media (min-width: 768px) {
    code {
      font-size: 14px;
    }
  }

  /* Node ID Container */
  #nodeIdCode {
    display: inline-block;
    max-width: 200px;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  @media (min-width: 768px) {
    #nodeIdCode {
      max-width: none;
    }
  }

  /* Buttons */
  button {
    font-family: inherit;
    transition: all 0.2s ease;
  }

  button:hover {
    opacity: 0.9;
    transform: translateY(-1px);
  }

  button:active {
    transform: translateY(0);
  }

  #copyNodeIdBtn {
    background: none;
    border: none;
    cursor: pointer;
    padding: 4px 6px;
    opacity: 0.6;
    font-size: 16px;
    line-height: 1;
  }

  #copyNodeIdBtn:hover {
    opacity: 1;
    transform: none;
  }

  /* Filter Buttons */
  #filterButtons {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-top: 8px;
  }

  #filterButtons a {
    display: inline-flex;
    align-items: center;
    padding: 8px 16px;
    font-size: 14px;
    border-radius: 6px;
    color: white;
    font-weight: 500;
    transition: all 0.2s ease;
    text-decoration: none;
    min-height: 36px;
  }

  #filterButtons a:hover {
    transform: translateY(-2px);
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
    text-decoration: none;
  }

  /* Forms */
  form {
    margin: 12px 0;
  }

  input[type="text"] {
    width: 100%;
    padding: 10px 12px;
    font-size: 15px;
    border-radius: 6px;
    border: 1px solid #d0d0d0;
    background: white;
    font-family: inherit;
    transition: border-color 0.2s ease;
  }

  @media (min-width: 768px) {
    input[type="text"] {
      font-size: 16px;
      padding: 12px 14px;
    }
  }

  input[type="text"]:focus {
    outline: none;
    border-color: #0066cc;
    box-shadow: 0 0 0 3px rgba(0, 102, 204, 0.1);
  }

  button[type="submit"] {
    padding: 10px 16px;
    border-radius: 6px;
    border: 1px solid #999;
    background: #f0f0f0;
    cursor: pointer;
    font-weight: 500;
    font-size: 14px;
    white-space: nowrap;
  }

  @media (min-width: 768px) {
    button[type="submit"] {
      padding: 12px 18px;
      font-size: 15px;
    }
  }

  button[type="submit"]:hover {
    background: #e0e0e0;
    border-color: #777;
  }

  /* Invite Form */
  form[action*="/invite"] {
    display: flex;
    flex-direction: column;
    gap: 10px;
    max-width: 100%;
    margin-top: 12px;
  }

  @media (min-width: 640px) {
    form[action*="/invite"] {
      flex-direction: row;
      max-width: 500px;
    }

    form[action*="/invite"] input[type="text"] {
      flex: 1;
      width: auto;
    }

    form[action*="/invite"] button {
      width: auto;
    }
  }

  /* Contributors List */
  .contributors-list li {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 12px;
    background: white;
    border-radius: 8px;
    margin: 8px 0;
    border: 1px solid #e0e0e0;
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
  }

  .contributors-list form {
    display: inline-block;
    margin: 0;
  }

  .contributors-list button {
    padding: 6px 12px;
    font-size: 13px;
    border-radius: 5px;
    border: 1px solid #ccc;
    background: white;
    white-space: nowrap;
  }

  .contributors-actions {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
  }

  /* Retire Button */
  button[style*="900"] {
    padding: 10px 18px !important;
    border-radius: 8px !important;
    border: 1px solid #c62828 !important;
    background: #fff5f5 !important;
    color: #c62828 !important;
    font-weight: 600 !important;
    cursor: pointer !important;
    font-size: 14px !important;
  }

  @media (min-width: 768px) {
    button[style*="900"] {
      font-size: 15px !important;
    }
  }

  /* Tree Structure */
  li[style*="border-left"] {
    padding-left: 12px !important;
    margin: 6px 0 !important;
    position: relative;
  }

  @media (min-width: 768px) {
    li[style*="border-left"] {
      padding-left: 16px !important;
    }
  }

  /* Paragraphs */
  p {
    margin: 12px 0;
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }

  p em {
    color: #666;
  }

  /* Container for better mobile spacing */
  .section {
    margin: 24px 0;
  }

  @media (min-width: 768px) {
    .section {
      margin: 32px 0;
    }
  }

  /* Responsive improvements for tree depth */
  @media (max-width: 640px) {
    ul ul {
      padding-left: 8px;
    }

    li[style*="border-left"] {
      font-size: 14px;
    }
  }

  /* Loading states and interactions */
  button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  /* Print styles */
  @media print {
    body {
      background: white;
      padding: 20px;
    }

    button, form {
      display: none;
    }

    a {
      color: #000;
      text-decoration: underline;
    }
  }
    /* Jump buttons */
#jumpTop,
#jumpBottom {
  position: fixed;
  right: 16px;
  width: 44px;
  height: 44px;
  border-radius: 50%;
  border: none;
  background: #0066cc;
  color: white;
  font-size: 18px;
  cursor: pointer;
  box-shadow: 0 4px 10px rgba(0,0,0,0.2);
  opacity: 0.8;
  transition: opacity 0.2s ease, transform 0.2s ease;
  z-index: 999;
}

#jumpTop:hover,
#jumpBottom:hover {
  opacity: 1;
  transform: translateY(-2px);
}

#jumpTop {
  top: 16px;      /* 🔝 top-right */
}

#jumpBottom {
  bottom: 16px;   /* 🔻 bottom-right */
}

/* Hide on print */
@media print {
  #jumpTop,
  #jumpBottom {
    display: none;
  }
}

</style>
      </head>
      <body>
              ${parentHtml}

         <h3>${ownerHtml}</h3>
 <h1>
  <a
    href="/api/${allData._id}/${allData.prestige}${queryString}"
    style="
      color: ${rootNameColor};
      font-weight: 700;
    "
  >
    ${allData.name}
  </a>
</h1>


    <p style="display:flex;align-items:center;gap:6px;">
  <code id="nodeIdCode">${allData._id}</code>

  <button id="copyNodeIdBtn" style="
    background:none;
    border:none;
    cursor:pointer;
    padding:2px;
    opacity:0.6;
  " title="Copy ID">
    📋
  </button>
</p>


     
        <h2>Filters</h2>

<div id="filterButtons"></div>
<button id="jumpTop" title="Jump to top">TOP</button>
<button id="jumpBottom" title="Jump to bottom">BOT</button>

<script>
  document.getElementById("jumpTop").addEventListener("click", () => {
    window.scrollTo({
      top: 0,
      behavior: "smooth"
    });
  });

  document.getElementById("jumpBottom").addEventListener("click", () => {
    window.scrollTo({
      top: document.body.scrollHeight,
      behavior: "smooth"
    });
  });
</script>

<script>
  const params = new URLSearchParams(window.location.search);

  // Default logic: active & completed default to true
  function paramIsOn(param, current) {
    if (current === "true") return true;
    if (current === "false") return false;

    // Defaults:
    if (param === "active" || param === "completed") return true;

    return false; // trimmed defaults to false
  }

  function makeToggle(param) {
    const current = params.get(param);      
    const isOn = paramIsOn(param, current);   
    const nextValue = isOn ? "false" : "true";

    const newParams = new URLSearchParams(params);
    newParams.set(param, nextValue);

    const url = window.location.pathname + "?" + newParams.toString();

const color = isOn ? "#4CAF50" : "#9E9E9E"; // green on, gray off

    return (
      '<a href="' + url + '" ' +
      'style="display:inline-block;padding:4px 8px;margin-right:6px;' +
      'font-size:12px;border-radius:5px;color:white;background:' + color + ';">' +
        param +
      '</a>'
    );
  }

  document.getElementById("filterButtons").innerHTML =
   
    makeToggle("active") +
    makeToggle("completed") +
     makeToggle("trimmed");
</script>



   
     

        <h2>Children</h2>
        ${childrenHtml}
           
      
       
     ${inviteFormHtml}

        ${contributorsHtml}
        
${retireHtml}
      

       

    

       
<script>
  const btn = document.getElementById("copyNodeIdBtn");
  const code = document.getElementById("nodeIdCode");

  btn.addEventListener("click", () => {
    navigator.clipboard.writeText(code.textContent).then(() => {
      btn.textContent = "✔️";
      setTimeout(() => (btn.textContent = "📋"), 900);
    });
  });
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

export default router;
