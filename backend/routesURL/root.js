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
<ul>
${rootMeta.contributors
  .map((u) => {
    const isSelf = u._id.toString() === req.userId?.toString();

    return `
<li style="display:flex; align-items:center; gap:10px;">
  <a href="/api/user/${u._id}${queryString}">
    ${u.username}
  </a>

  ${
    isOwner
      ? `
    <!-- TRANSFER (owner only) -->
    <form
      method="POST"
      action="/api/root/${nodeId}/transfer-owner?token=${
          req.query.token ?? ""
        }&html"
      style="margin:0;"
      onsubmit="return confirm('Transfer ownership to ${u.username}?')"
    >
      <input type="hidden" name="userReceiving" value="${u._id}" />
      <button type="submit" style="padding:4px 8px;font-size:12px;">
        Transfer
      </button>
    </form>
    `
      : ""
  }

  ${
    isOwner || isSelf
      ? `
    <!-- REMOVE (owner OR self) -->
    <form
      method="POST"
      action="/api/root/${nodeId}/remove-user?token=${
          req.query.token ?? ""
        }&html"
      style="margin:0;"
      onsubmit="return confirm('${
        isSelf ? "Leave this root?" : `Remove ${u.username} from this root?`
      }')"
    >
      <input type="hidden" name="userReceiving" value="${u._id}" />
      <button
        type="submit"
        style="
          padding:4px 8px;
          font-size:12px;
          border-radius:6px;
          border:1px solid #999;
          background:#f5f5f5;
          cursor:pointer;
        "
      >
        ${isSelf ? "Unvite yourself (can't be undone)" : "Remove"}
      </button>
    </form>
    `
      : ""
  }
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
          body {
            font-family: system-ui, sans-serif;
            padding: 20px;
            line-height: 1.6;
            background: #fafafa;
          }

          h1 { margin-bottom: 4px; }
          h2 { margin-top: 32px; }

          a {
            color: #0077cc;
            text-decoration: none;
            font-weight: 500;
          }

          a:hover { text-decoration: underline; }

          ul {
            list-style: none;
            padding-left: 18px;
            margin: 6px 0;
          }

          code {
            background: #eee;
            padding: 2px 6px;
            border-radius: 4px;
            font-size: 12px;
          }

          .json-box {
            margin-top: 40px;
            padding: 20px;
            background: #111;
            color: #0f0;
            border-radius: 8px;
            white-space: pre;
            overflow-x: auto;
            font-size: 13px;
          }

          .button {
            display: inline-block;
            padding: 10px 16px;
            margin-top: 14px;
            background: #0077cc;
            color: white;
            border-radius: 8px;
            text-decoration: none;
            font-weight: 600;
          }

          .button:hover {
            background: #005fa3;
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
