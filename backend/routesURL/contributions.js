import express from "express";
import urlAuth from "../middleware/urlAuth.js";
import { getContributions } from "../core/contributions.js";
import getNodeName from "./helpers/getNameById.js";

const router = express.Router();
const allowedParams = ["token", "html"];

const escapeHtml = (str = "") =>
  String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

/* ------------------------- GENERIC HELPERS ------------------------- */

const renderUser = (user) => {
  if (!user) return `<code>unknown user</code>`;

  // populated user object
  if (typeof user === "object") {
    if (user.username) {
      return `<code>${escapeHtml(user.username)}</code>`;
    }
    if (user._id) {
      return `<code>${escapeHtml(user._id)}</code>`;
    }
  }

  // string id
  if (typeof user === "string") {
    return `<code>${escapeHtml(user)}</code>`;
  }

  return `<code>unknown user</code>`;
};

const renderLink = (id, queryString) =>
  id
    ? `<a href="/api/${id}${queryString}"><code>${id}</code></a>`
    : `<code>unknown</code>`;

const renderVersionLink = (
  nodeId,
  version,
  queryString,
  label = `Version ${version}`
) =>
  `<a href="/api/${nodeId}/${version}${queryString}">
    <code>${label}</code>
  </a>`;

/* ------------------------- DETAIL HELPERS ------------------------- */

const renderKeyValueMap = (data) => {
  if (!data) return "";

  const entries =
    data instanceof Map
      ? [...data.entries()]
      : typeof data === "object"
      ? Object.entries(data)
      : [];

  if (entries.length === 0) return "";

  return `
    <ul>
      ${entries
        .map(
          ([key, value]) =>
            `<li><code>${escapeHtml(key)}</code>: <code>${escapeHtml(
              value
            )}</code></li>`
        )
        .join("")}
    </ul>
  `;
};

const renderDetails = (c, queryString) => {
  switch (c.action) {
    case "editValue":
      return `
        <div style="margin-left:12px;">
          <strong>Values updated</strong>
          ${renderKeyValueMap(c.valueEdited)}
        </div>
      `;

    case "editGoal":
      return `
        <div style="margin-left:12px;">
          <strong>Goal updated</strong>
          ${renderKeyValueMap(c.goalEdited)}
        </div>
      `;

    case "editSchedule":
      return `
        <div style="margin-left:12px;">
          ${
            c.scheduleEdited?.date
              ? `<div>Date: <code>${new Date(
                  c.scheduleEdited.date
                ).toLocaleString()}</code></div>`
              : ""
          }
          ${
            c.scheduleEdited?.reeffectTime !== undefined
              ? `<div>Re-effect time: <code>${c.scheduleEdited.reeffectTime}</code></div>`
              : ""
          }
        </div>
      `;

    case "executeScript":
      return `
        <div style="margin-left:12px;">
          <div>Status: <code>${
            c.executeScript?.success ? "success" : "failed"
          }</code></div>
          ${
            c.executeScript?.logs?.length
              ? `<pre><code>${escapeHtml(
                  c.executeScript.logs.join("\n")
                )}</code></pre>`
              : ""
          }
          ${
            c.executeScript?.error
              ? `<div>Error: <code>${escapeHtml(
                  c.executeScript.error
                )}</code></div>`
              : ""
          }
        </div>
      `;

    case "branchLifecycle":
      return `
        <div style="margin-left:12px;">
          ${
            c.branchLifecycle?.fromParentId
              ? `From: ${renderLink(
                  c.branchLifecycle.fromParentId,
                  queryString
                )}<br/>`
              : ""
          }
          ${
            c.branchLifecycle?.toParentId
              ? `To: ${renderLink(c.branchLifecycle.toParentId, queryString)}`
              : ""
          }
        </div>
      `;

    default:
      return "";
  }
};

/* --------------------------- ROUTE --------------------------- */

router.get("/:nodeId/:version/contributions", urlAuth, async (req, res) => {
  try {
    const { nodeId, version } = req.params;
    const parsedVersion = Number(version);

    const nextVersion = parsedVersion + 1;

    if (isNaN(parsedVersion)) {
      return res.status(400).json({ error: "Invalid version" });
    }

    const rawLimit = req.query.limit;
    const limit = rawLimit !== undefined ? Number(rawLimit) : undefined;

    if (limit !== undefined && (isNaN(limit) || limit <= 0)) {
      return res.status(400).json({ error: "Invalid limit" });
    }

    const filtered = Object.entries(req.query)
      .filter(([k]) => allowedParams.includes(k))
      .map(([k, v]) => (v === "" ? k : `${k}=${v}`))
      .join("&");

    const queryString = filtered ? `?${filtered}` : "";

    const result = await getContributions({
      nodeId,
      version: parsedVersion,
      limit,
      startDate: req.query.startDate,
      endDate: req.query.endDate,
    });

    const wantHtml = Object.prototype.hasOwnProperty.call(req.query, "html");

    if (!wantHtml) {
      return res.json({ nodeId, version: parsedVersion, ...result });
    }

    const nodeName = await getNodeName(nodeId);
    const contributions = result.contributions || [];

    /* ---------------------- ACTION RENDERERS ---------------------- */

    const renderers = {
      create: () => `created node`,
      editStatus: (c) => `changed status to <code>${c.statusEdited}</code>`,
      editValue: () => `updated values`,
      prestige: () =>
        `added new version ${renderVersionLink(
          nodeId,
          nextVersion,
          queryString
        )}`,

      transaction: () =>
        `completed <a href="/api/${nodeId}/${parsedVersion}/transactions${queryString}">
          <code>transaction</code>
        </a>`,
      delete: () => `deleted node`,
      editSchedule: () => `updated schedule`,
      editGoal: () => `updated goal`,
      editNameNode: (c) =>
        `renamed node from <code>${c.editNameNode?.oldName}</code> to <code>${c.editNameNode?.newName}</code>`,
      updateParent: (c) =>
        `changed parent from ${renderLink(
          c.updateParent?.oldParentId,
          queryString
        )} to ${renderLink(c.updateParent?.newParentId, queryString)}`,
      updateChildNode: (c) =>
        `${c.updateChildNode?.action} child ${renderLink(
          c.updateChildNode?.childId,
          queryString
        )}`,
      note: (c) =>
        `${c.noteAction?.action === "add" ? "added" : "removed"} note
        <a href="/api/${nodeId}/${parsedVersion}/notes/${
          c.noteAction?.noteId
        }${queryString}">
          <code>${c.noteAction?.noteId}</code>
        </a>`,
      editScript: (c) =>
        `updated script <code>${c.editScript?.scriptName}</code>
         <pre><code>${escapeHtml(c.editScript?.contents)}</code></pre>`,
      executeScript: (c) =>
        `executed script <code>${c.executeScript?.scriptName}</code>`,
      rawIdeaAction: (c) =>
        c.rawIdeaAction?.action === "add"
          ? "added idea"
          : c.rawIdeaAction?.action === "delete"
          ? "deleted idea"
          : "placed idea into node",
      branchLifecycle: (c) =>
        c.branchLifecycle?.action === "retired"
          ? "retired branch"
          : c.branchLifecycle?.action === "revived"
          ? "revived branch"
          : "revived branch as root",
      invite: (c) => {
        const { action, receivingId } = c.inviteAction || {};
        const target = renderUser(receivingId);

        if (action === "invite") return `invited contributor ${target}`;
        if (action === "acceptInvite")
          return `accepted invitation from ${target}`;
        if (action === "denyInvite")
          return `declined invitation from ${target}`;
        if (action === "removeContributor")
          return `removed contributor ${target}`;
        if (action === "switchOwner")
          return `transferred ownership to ${target}`;

        return "updated collaboration";
      },
    };

    const contributionsHtml =
      contributions.length > 0
        ? `<ul>
            ${contributions
              .map((c) => {
                const user = c.username || "Unknown user";
                const time = new Date(c.date).toLocaleString();
                const render = renderers[c.action] || (() => c.action);
                const details = renderDetails(c, queryString);

                return `
                  <li>
                    <strong>${user}</strong>
                    ${render(c)}
                    <br/>
                    <small>${time}</small>
                    ${details}
                  </li>
                `;
              })
              .join("")}
          </ul>`
        : `<p>No contributions found</p>`;

    // Replace the HTML send in your /:nodeId/:version/contributions route with this:
    const qs = queryString || "";
    const backTreeUrl = `/api/root/${nodeId}${qs}`;
    const backUrl = `/api/${nodeId}/${version}${qs}`;
    res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="theme-color" content="#667eea">
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
  <title>${nodeName || nodeId} — Contributions</title>
<style>
  * {
    box-sizing: border-box;
    margin: 0;
    padding: 0;
  }

  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto',
      'Oxygen', 'Ubuntu', 'Cantarell', sans-serif;
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

  /* Header Section */
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
    line-height: 1.3;
  }

  .header h1 a {
    color: #1a1a1a;
    text-decoration: none;
    transition: color 0.2s;
  }

  .header h1 a:hover {
    color: #667eea;
  }

  .section-title {
    font-size: 18px;
    font-weight: 600;
    color: #667eea;
    margin-top: 8px;
  }

  /* Version Badge */
  .version-badge {
    display: inline-block;
    padding: 6px 14px;
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    color: white;
    border-radius: 20px;
    font-size: 14px;
    font-weight: 600;
    margin-top: 8px;
  }

  /* Node ID + Copy */
  .node-id-container {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 12px;
    flex-wrap: wrap;
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

  /* Contributions List */
  .contributions-section {
    background: rgba(255, 255, 255, 0.95);
    backdrop-filter: blur(10px);
    border-radius: 16px;
    padding: 24px;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.1);
  }

  .contributions-list {
    list-style: none;
  }

  .contribution-item {
    background: #f8f9fa;
    border-radius: 12px;
    padding: 16px 20px;
    margin-bottom: 12px;
    border-left: 4px solid #667eea;
    transition: all 0.2s;
  }

  .contribution-item:hover {
    background: white;
    transform: translateX(4px);
    box-shadow: 0 4px 12px rgba(102, 126, 234, 0.15);
  }

  .contribution-user {
    font-weight: 700;
    color: #667eea;
    font-size: 15px;
    margin-bottom: 4px;
  }

  .contribution-action {
    font-size: 15px;
    line-height: 1.6;
    color: #1a1a1a;
    margin-bottom: 6px;
  }

  .contribution-time {
    font-size: 13px;
    color: #888;
    margin-top: 8px;
    display: block;
  }

  .contribution-details {
    margin-top: 12px;
    padding-top: 12px;
    border-top: 1px solid #e0e0e0;
  }

  .contribution-details strong {
    color: #667eea;
    font-size: 14px;
    display: block;
    margin-bottom: 8px;
  }

  .contribution-details ul {
    list-style: none;
    padding-left: 0;
    margin-top: 8px;
  }

  .contribution-details li {
    padding: 6px 12px;
    background: white;
    border-radius: 6px;
    margin-bottom: 4px;
    font-size: 14px;
  }

  /* Code + Links */
  code {
    background: #f0f0f0;
    padding: 6px 12px;
    border-radius: 6px;
    font-size: 13px;
    font-family: 'SF Mono', Monaco, 'Cascadia Code', monospace;
    color: #667eea;
    font-weight: 600;
    word-break: break-word;
  }

  pre {
    background: #2d2d2d;
    color: #a9b7c6;
    padding: 12px;
    border-radius: 8px;
    overflow-x: auto;
    margin-top: 8px;
    font-size: 13px;
    line-height: 1.5;
  }

  pre code {
    background: none;
    color: inherit;
    padding: 0;
    font-weight: 400;
  }

  a {
    color: #667eea;
    text-decoration: none;
    font-weight: 500;
    transition: color 0.2s;
  }

  a:hover {
    color: #764ba2;
    text-decoration: underline;
  }

  /* Empty State */
  .empty-state {
    text-align: center;
    padding: 60px 40px;
    color: #999;
  }

  .empty-state-icon {
    font-size: 64px;
    margin-bottom: 16px;
  }

  .empty-state-text {
    font-size: 18px;
    color: #666;
  }

  /* Responsive */
  @media (max-width: 640px) {
    body {
      padding: 16px;
    }

    .header,
    .contributions-section {
      padding: 20px;
    }

    .header h1 {
      font-size: 24px;
    }

    .back-nav {
      flex-direction: column;
    }

    .back-link {
      justify-content: center;
    }

    code {
      font-size: 12px;
    }

    pre {
      font-size: 12px;
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
    <!-- Back Navigation -->
<div class="back-nav">
  <a href="${backTreeUrl}" class="back-link">← Back to Tree</a>
  <a href="${backUrl}" class="back-link">Back to Version</a>
</div>

<div class="header">
  <h1>
    <a href="${backUrl}">${nodeName}</a>
  </h1>

  <span class="version-badge">Version ${parsedVersion}</span>

  <div class="node-id-container">
    <code id="nodeIdCode">${nodeId}</code>
    <button id="copyNodeIdBtn" title="Copy ID">📋</button>
  </div>
</div>


    <!-- Contributions Section -->
    <div class="contributions-section">
      ${
        contributions.length > 0
          ? `
        <ul class="contributions-list">
          ${contributions
            .map((c) => {
              const user = c.username || "Unknown user";
              const time = new Date(c.date).toLocaleString();
              const render = renderers[c.action] || (() => c.action);
              const details = renderDetails(c, queryString);

              return `
                <li class="contribution-item">
                  <div class="contribution-user">${user}</div>
                  <div class="contribution-action">${render(c)}</div>
                  <span class="contribution-time">${time}</span>
                  ${
                    details
                      ? `<div class="contribution-details">${details}</div>`
                      : ""
                  }
                </li>
              `;
            })
            .join("")}
        </ul>
      `
          : `
        <div class="empty-state">
          <div class="empty-state-icon">📝</div>
          <div class="empty-state-text">No contributions yet</div>
        </div>
      `
      }
    </div>
  </div>
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
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
