/* ─────────────────────────────────────────────── */
/* HTML renderer for contributions page             */
/* ─────────────────────────────────────────────── */

import {
  baseStyles,
  backNavStyles,
  glassHeaderStyles,
  glassCardStyles,
  emptyStateStyles,
  responsiveBase,
} from "../../../shared/html/baseStyles.js";
import { esc, actionColorClass } from "../../../shared/html/utils.js";

const link = (id, queryString) =>
  id
    ? `<a href="/api/v1/node/${id}${queryString}"><code>${esc(id)}</code></a>`
    : `<code>unknown</code>`;

const userTag = (u, queryString) => {
  if (!u) return `<code>unknown user</code>`;
  if (typeof u === "object" && u.username)
    return `<a href="/api/v1/user/${u._id}${queryString}"><code>${esc(u.username)}</code></a>`;
  if (typeof u === "string")
    return `<code>${esc(u)}</code>`;
  return `<code>unknown user</code>`;
};

const kvMap = (data) => {
  if (!data) return "";
  const entries =
    data instanceof Map
      ? [...data.entries()]
      : typeof data === "object"
        ? Object.entries(data)
        : [];
  if (entries.length === 0) return "";
  return entries
    .map(
      ([k, v]) =>
        `<span class="kv-chip"><code>${esc(k)}</code> ${esc(String(v))}</span>`,
    )
    .join(" ");
};

function renderAction(rawC, { nodeId, parsedVersion, nextVersion, queryString }) {
  // Merge extensionData so action renderers can access extension fields directly
  const c = rawC.extensionData ? { ...rawC, ...rawC.extensionData } : rawC;
  switch (c.action) {
    case "create":
      return `Created node`;

    case "editStatus":
      return `Marked as <code>${esc(c.statusEdited)}</code>`;

    case "editValue":
      return `Adjusted values ${kvMap(c.valueEdited)}`;

    case "prestige":
      return `Prestiged to <a href="/api/v1/node/${nodeId}/${nextVersion}${queryString}"><code>Version ${nextVersion}</code></a>`;

    case "trade":
      return `Traded on node`;

    case "delete":
      return `Deleted node`;

    case "invite": {
      const ia = c.inviteAction || {};
      const target = userTag(ia.receivingId, queryString);
      const labels = {
        invite: `Invited ${target} to collaborate`,
        acceptInvite: `Accepted an invitation`,
        denyInvite: `Declined an invitation`,
        removeContributor: `Removed ${target}`,
        switchOwner: `Transferred ownership to ${target}`,
      };
      return labels[ia.action] || "Updated collaboration";
    }

    case "editSchedule": {
      const s = c.scheduleEdited || {};
      const parts = [];
      if (s.date)
        parts.push(
          `date to <code>${new Date(s.date).toLocaleString()}</code>`,
        );
      if (s.reeffectTime != null)
        parts.push(`re-effect to <code>${s.reeffectTime}</code>`);
      return parts.length
        ? `Set ${parts.join(" and ")}`
        : `Updated the schedule`;
    }

    case "editGoal":
      return `Set new goals ${kvMap(c.goalEdited)}`;

    case "transaction": {
      const tm = c.transactionMeta;
      if (!tm) return `Recorded a transaction`;
      const eventLabel = esc(tm.event || "unknown").replace(/_/g, " ");
      const counterparty = tm.counterpartyNodeId
        ? ` with ${link(tm.counterpartyNodeId, queryString)}`
        : "";
      const sent = kvMap(tm.valuesSent);
      const recv = kvMap(tm.valuesReceived);
      let flow = "";
      if (sent) flow += ` — sent ${sent}`;
      if (recv) flow += `${sent ? "," : " —"} received ${recv}`;
      return `Transaction <code>${eventLabel}</code> as ${esc(tm.role)} (side ${esc(tm.side)})${counterparty}${flow}`;
    }

    case "note": {
      const na = c.noteAction || {};

      let verb;
      switch (na.action) {
        case "add":
          verb = "Added a note";
          break;
        case "edit":
          verb = "Edited a note";
          break;
        case "remove":
          verb = "Removed a note";
          break;
        default:
          verb = "Updated a note";
      }

      const noteRef = na.noteId
        ? ` <a href="/api/v1/node/${nodeId}/${parsedVersion}/notes/${na.noteId}${queryString}"><code>${esc(na.noteId)}</code></a>`
        : "";

      return `${verb}${noteRef}`;
    }

    case "updateParent": {
      const up = c.updateParent || {};
      const from = up.oldParentId
        ? link(up.oldParentId, queryString)
        : `<code>none</code>`;
      const to = up.newParentId
        ? link(up.newParentId, queryString)
        : `<code>none</code>`;
      return `Moved from ${from} to ${to}`;
    }

    case "editScript": {
      const es = c.editScript || {};
      return `Edited script <code>${esc(es.scriptName || es.scriptId)}</code>`;
    }

    case "executeScript": {
      const xs = c.executeScript || {};
      const icon = xs.success ? "✅" : "❌";
      let text = `${icon} Ran <code>${esc(xs.scriptName || xs.scriptId)}</code>`;
      if (xs.error) text += ` — <code>${esc(xs.error)}</code>`;
      return text;
    }

    case "updateChildNode": {
      const uc = c.updateChildNode || {};
      return uc.action === "added"
        ? `Added child ${link(uc.childId, queryString)}`
        : `Removed child ${link(uc.childId, queryString)}`;
    }

    case "editNameNode": {
      const en = c.editNameNode || {};
      return `Renamed from <code>${esc(en.oldName)}</code> to <code>${esc(en.newName)}</code>`;
    }

    case "rawIdea": {
      const ri = c.rawIdeaAction || {};
      const uId = c.userId?._id || c.userId;
      const ideaRef = ri.rawIdeaId && uId
        ? `<a href="/api/v1/user/${uId}/raw-ideas/${ri.rawIdeaId}${queryString}"><code>${esc(ri.rawIdeaId)}</code></a>`
        : ri.rawIdeaId
          ? `<code>${esc(ri.rawIdeaId)}</code>`
          : `<code>unknown</code>`;
      if (ri.action === "add") return `Captured a raw idea ${ideaRef}`;
      if (ri.action === "delete") return `Discarded raw idea ${ideaRef}`;
      if (ri.action === "placed") {
        const target = ri.targetNodeId ? link(ri.targetNodeId, queryString) : "node";
        return `Placed raw idea ${ideaRef} into ${target}`;
      }
      if (ri.action === "aiStarted")
        return `AI began processing raw idea ${ideaRef}`;
      if (ri.action === "aiFailed")
        return `AI failed to place raw idea ${ideaRef}`;
      return `Updated raw idea ${ideaRef}`;
    }

    case "branchLifecycle": {
      const bl = c.branchLifecycle || {};
      if (bl.action === "retired") {
        let text = `Retired branch`;
        if (bl.fromParentId) text += ` from ${link(bl.fromParentId, queryString)}`;
        return text;
      }
      if (bl.action === "revived") {
        let text = `Revived branch`;
        if (bl.toParentId) text += ` under ${link(bl.toParentId, queryString)}`;
        return text;
      }
      return `Revived as a new root`;
    }

    case "purchase": {
      const pm = c.purchaseMeta || {};
      const parts = [];
      if (pm.plan) parts.push(`the <code>${esc(pm.plan)}</code> plan`);
      if (pm.energyAmount)
        parts.push(`<code>${pm.energyAmount}</code> energy`);
      const price = pm.totalCents
        ? ` for $${(pm.totalCents / 100).toFixed(2)} ${esc(pm.currency || "usd").toUpperCase()}`
        : "";
      return parts.length
        ? `Purchased ${parts.join(" and ")}${price}`
        : `Made a purchase${price}`;
    }

    case "understanding": {
      const um = c.understandingMeta || {};
      const rootNode = um.rootNodeId || nodeId;
      const runId = um.understandingRunId;

      if (um.stage === "createRun") {
        const runLink =
          runId && rootNode
            ? `<a href="/api/v1/root/${rootNode}/understandings/run/${runId}${queryString}"><code>${esc(runId)}</code></a>`
            : `<code>unknown run</code>`;
        let text = `Started understanding run ${runLink}`;
        if (um.nodeCount != null)
          text += ` spanning <code>${um.nodeCount}</code> nodes`;
        if (um.perspective) text += ` — "${esc(um.perspective)}"`;
        return text;
      }

      if (um.stage === "processStep") {
        const uNodeId = um.understandingNodeId;
        const uNodeLink =
          uNodeId && runId && rootNode
            ? `<a href="/api/v1/root/${rootNode}/understandings/run/${runId}/${uNodeId}${queryString}"><code>${esc(uNodeId)}</code></a>`
            : uNodeId
              ? `<code>${esc(uNodeId)}</code>`
              : `<code>unknown</code>`;
        let text = `Understanding encoded ${uNodeLink}`;
        if (um.mode)
          text += ` <span class="kv-chip">${esc(um.mode)}</span>`;
        if (um.layer != null) text += ` at layer <code>${um.layer}</code>`;
        return text;
      }

      return `Understanding activity`;
    }

    default:
      return `<code>${esc(c.action)}</code>`;
  }
}

export function renderContributions({ nodeId, version, nodeName, contributions, queryString }) {
  const parsedVersion = Number(version);
  const nextVersion = parsedVersion + 1;

  const items = contributions.map((c) => {
    const time = new Date(c.date).toLocaleString();
    const actionHtml = renderAction(c, { nodeId, parsedVersion, nextVersion, queryString });
    const colorClass = actionColorClass(c.action);

    const aiBadge = c.wasAi ? `<span class="badge badge-ai">AI</span>` : "";
    const energyBadge =
      c.energyUsed != null && c.energyUsed > 0
        ? `<span class="badge badge-energy">⚡ ${c.energyUsed}</span>`
        : "";

    const user = userTag(c.userId, queryString);

    return `
      <li class="note-card ${colorClass}">
        <div class="note-content">
          <div class="contribution-action">${actionHtml}</div>
        </div>
        <div class="note-meta">
          ${user}
          <span class="meta-separator">·</span>
          ${time}
          ${aiBadge}${energyBadge}
          <span class="meta-separator">·</span>
          <code class="contribution-id">${esc(c._id)}</code>
        </div>
      </li>`;
  });

  const qs = queryString || "";
  const backTreeUrl = `/api/v1/root/${nodeId}${qs}`;
  const backUrl = `/api/v1/node/${nodeId}/${version}${qs}`;

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="theme-color" content="#667eea">
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
  <title>${esc(nodeName || nodeId)} — Contributions</title>
  <style>
${baseStyles}
${backNavStyles}
${glassHeaderStyles}
${glassCardStyles}
${emptyStateStyles}
${responsiveBase}

/* ── Page-specific: contributions ── */

.version-badge {
  display: inline-block;
  padding: 6px 14px;
  background: rgba(255,255,255,0.25);
  color: white; border-radius: 980px;
  font-size: 13px; font-weight: 600;
  border: 1px solid rgba(255,255,255,0.3);
  margin-right: 8px;
}

.header-subtitle { margin-bottom: 16px; }

.notes-list { animation: fadeInUp 0.6s ease-out 0.2s both; }

.note-card:nth-child(1) { animation-delay: 0.25s; }
.note-card:nth-child(2) { animation-delay: 0.3s; }
.note-card:nth-child(3) { animation-delay: 0.35s; }
.note-card:nth-child(4) { animation-delay: 0.4s; }
.note-card:nth-child(5) { animation-delay: 0.45s; }
.note-card:nth-child(n+6) { animation-delay: 0.5s; }

.contribution-action {
  font-size: 15px; line-height: 1.6;
  color: white; font-weight: 400;
  word-wrap: break-word;
}

.contribution-action a {
  color: white; text-decoration: none;
  border-bottom: 1px solid rgba(255,255,255,0.3);
  transition: all 0.2s;
}

.contribution-action a:hover {
  border-bottom-color: white;
  text-shadow: 0 0 12px rgba(255,255,255,0.8);
}

.contribution-action code {
  background: rgba(255,255,255,0.18);
  padding: 2px 7px; border-radius: 5px;
  font-size: 13px;
  font-family: 'SF Mono', 'Fira Code', 'Cascadia Code', monospace;
  border: 1px solid rgba(255,255,255,0.15);
}

.contribution-id {
  background: rgba(255,255,255,0.12);
  padding: 2px 6px; border-radius: 4px;
  font-size: 11px;
  font-family: 'SF Mono', 'Fira Code', monospace;
  color: rgba(255,255,255,0.6);
  border: 1px solid rgba(255,255,255,0.1);
}

.badge {
  display: inline-flex; align-items: center;
  padding: 3px 10px; border-radius: 980px;
  font-size: 11px; font-weight: 700; letter-spacing: 0.3px;
  border: 1px solid rgba(255,255,255,0.2);
}

.badge-ai {
  background: rgba(255,200,50,0.35);
  color: #fff;
  text-shadow: 0 1px 2px rgba(0,0,0,0.2);
}

.badge-energy {
  background: rgba(100,220,255,0.3);
  color: #fff;
  text-shadow: 0 1px 2px rgba(0,0,0,0.2);
}

.kv-chip {
  display: inline-block;
  padding: 2px 8px;
  background: rgba(255,255,255,0.15);
  border-radius: 6px; font-size: 12px;
  margin: 2px 2px;
  border: 1px solid rgba(255,255,255,0.15);
}

.kv-chip code {
  background: none !important;
  border: none !important;
  padding: 0 !important;
  font-weight: 600;
}
  </style>
</head>
<body>
  <div class="container">
    <div class="back-nav">
      <a href="${backTreeUrl}" class="back-link">← Back to Tree</a>
      <a href="${backUrl}" class="back-link">Back to Version</a>
    </div>

    <div class="header">
      <h1>
        Contributions on
        <a href="${backUrl}">${esc(nodeName || nodeId)}</a>
        ${contributions.length > 0 ? `<span class="message-count">${contributions.length}</span>` : ""}
      </h1>
      <div class="header-subtitle">
        <span class="version-badge">Version ${parsedVersion}</span>
        Activity &amp; change history
      </div>
    </div>

    ${
      items.length
        ? `<ul class="notes-list">${items.join("")}</ul>`
        : `
    <div class="empty-state">
      <div class="empty-state-icon">📊</div>
      <div class="empty-state-text">No contributions yet</div>
      <div class="empty-state-subtext">Contributions and activity will appear here</div>
    </div>`
    }
  </div>

</body>
</html>
`;
}
