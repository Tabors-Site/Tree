import { page } from "../layout.js";
import { esc, escapeHtml, actionColorClass } from "../utils.js";

export async function renderUserContributions({ userId, contributions, username, getNodeName, token }) {
  const tokenQS = token ? `?token=${encodeURIComponent(token)}&html` : `?html`;

  const link = (id, label) =>
    id
      ? `<a href="/api/v1/node/${id}${tokenQS}">${label || `<code>${esc(id)}</code>`}</a>`
      : `<code>unknown</code>`;

  const nodeLink = (id, name, version) => {
    if (!id) return `<code>unknown node</code>`;
    const v = version != null ? `/${version}` : "";
    const display = name || id;
    return `<a href="/api/v1/node/${id}${v}${tokenQS}"><code>${esc(display)}</code></a>`;
  };

  const userTag = (u) => {
    if (!u) return `<code>unknown user</code>`;
    if (typeof u === "object" && u.username)
      return `<a href="/api/v1/user/${u._id}${tokenQS}"><code>${esc(u.username)}</code></a>`;
    if (typeof u === "string")
      return `<a href="/api/v1/user/${u}${tokenQS}"><code>${esc(u)}</code></a>`;
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

    /* ─────────────────────────────────────────────── */
    /* ACTION RENDERER                                  */
    /* ─────────────────────────────────────────────── */

    const renderAction = (rawC, nodeName) => {
      // Merge extensionData into contribution so action renderers work
      const c = rawC.extensionData ? { ...rawC, ...rawC.extensionData } : rawC;
      const nId = c.nodeId?._id || c.nodeId;
      const v = Number(c.nodeVersion ?? 0);
      const nLink = nodeLink(nId, nodeName, v);

      switch (c.action) {
        case "create":
          return `Created ${nLink}`;

        case "editStatus":
          return `Marked ${nLink} as <code>${esc(c.statusEdited)}</code>`;

        case "editValue":
          return `Adjusted values on ${nLink} ${kvMap(c.valueEdited)}`;

        case "prestige":
          return `Prestiged ${nLink} to a new version`;

        case "trade":
          return `Traded on ${nLink}`;

        case "delete":
          return `Deleted ${nLink}`;

        case "invite": {
          const ia = c.inviteAction || {};
          const target = userTag(ia.receivingId);
          const labels = {
            invite: `Invited ${target} to collaborate on`,
            acceptInvite: `Accepted an invitation on`,
            denyInvite: `Declined an invitation on`,
            removeContributor: `Removed ${target} from`,
            switchOwner: `Transferred ownership of`,
          };
          const suffix = ia.action === "switchOwner" ? ` to ${target}` : "";
          return `${labels[ia.action] || "Updated collaboration on"} ${nLink}${suffix}`;
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
            ? `Set ${parts.join(" and ")} on ${nLink}`
            : `Updated the schedule on ${nLink}`;
        }

        case "editGoal":
          return `Set new goals on ${nLink} ${kvMap(c.goalEdited)}`;

        case "transaction": {
          const tm = c.transactionMeta;
          if (!tm) return `Recorded a transaction on ${nLink}`;
          const eventLabel = esc(tm.event || "unknown").replace(/_/g, " ");
          const counterparty = tm.counterpartyNodeId
            ? ` with ${link(tm.counterpartyNodeId)}`
            : "";
          const sent = kvMap(tm.valuesSent);
          const recv = kvMap(tm.valuesReceived);
          let flow = "";
          if (sent) flow += ` \u2014 sent ${sent}`;
          if (recv) flow += `${sent ? "," : " \u2014"} received ${recv}`;
          return `Transaction <code>${eventLabel}</code> as ${esc(tm.role)} (side ${esc(tm.side)}) on ${nLink}${counterparty}${flow}`;
        }

        case "note": {
          const na = c.noteAction || {};

          let verb;
          switch (na.action) {
            case "add":
              verb = "Added a note to";
              break;
            case "edit":
              verb = "Edited a note in";
              break;
            case "remove":
              verb = "Removed a note from";
              break;
            default:
              verb = "Updated a note in";
          }

          const noteRef = na.noteId
            ? ` <a href="/api/v1/node/${nId}/${v}/notes/${na.noteId}${tokenQS}"><code>${esc(na.noteId)}</code></a>`
            : "";

          return `${verb} ${nLink}${noteRef}`;
        }

        case "updateParent": {
          const up = c.updateParent || {};
          const from = up.oldParentId
            ? link(up.oldParentId)
            : `<code>none</code>`;
          const to = up.newParentId
            ? link(up.newParentId)
            : `<code>none</code>`;
          return `Moved ${nLink} from ${from} to ${to}`;
        }

        case "editScript": {
          const es = c.editScript || {};
          return `Edited script <code>${esc(es.scriptName || es.scriptId)}</code> on ${nLink}`;
        }

        case "executeScript": {
          const xs = c.executeScript || {};
          const icon = xs.success ? "\u2705" : "\u274C";
          let text = `${icon} Ran <code>${esc(xs.scriptName || xs.scriptId)}</code> on ${nLink}`;
          if (xs.error) text += ` \u2014 <code>${esc(xs.error)}</code>`;
          return text;
        }

        case "updateChild": {
          const uc = c.updateChild || {};
          return uc.action === "added"
            ? `Added ${link(uc.childId)} as a child of ${nLink}`
            : `Removed child ${link(uc.childId)} from ${nLink}`;
        }

        case "editName": {
          const en = c.editName || {};
          return `Renamed ${nLink} from <code>${esc(en.oldName)}</code> to <code>${esc(en.newName)}</code>`;
        }

        case "rawIdea": {
          const ri = c.rawIdeaAction || {};
          const ideaRef = `<a href="/api/v1/user/${userId}/raw-ideas/${ri.rawIdeaId}${tokenQS}"><code>${esc(ri.rawIdeaId)}</code></a>`;
          if (ri.action === "add") return `Captured a raw idea ${ideaRef}`;
          if (ri.action === "delete")
            return `Discarded raw idea <code>${esc(ri.rawIdeaId)}</code>`;
          if (ri.action === "placed") {
            const target = ri.targetNodeId ? link(ri.targetNodeId) : nLink;
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
            let text = `Retired branch ${nLink}`;
            if (bl.fromParentId) text += ` from ${link(bl.fromParentId)}`;
            return text;
          }
          if (bl.action === "revived") {
            let text = `Revived branch ${nLink}`;
            if (bl.toParentId) text += ` under ${link(bl.toParentId)}`;
            return text;
          }
          return `Revived ${nLink} as a new root`;
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
          const rootNode = um.rootNodeId || nId;
          const runId = um.understandingRunId;

          if (um.stage === "createRun") {
            const runLink =
              runId && rootNode
                ? `<a href="/api/v1/root/${rootNode}/understandings/run/${runId}${tokenQS}"><code>${esc(runId)}</code></a>`
                : `<code>unknown run</code>`;
            let text = `Started understanding run ${runLink}`;
            if (rootNode) text += ` on ${link(rootNode)}`;
            if (um.nodeCount != null)
              text += ` spanning <code>${um.nodeCount}</code> nodes`;
            if (um.perspective) text += ` \u2014 "${esc(um.perspective)}"`;
            return text;
          }

          if (um.stage === "processStep") {
            const uNodeId = um.understandingNodeId;
            const uNodeLink =
              uNodeId && runId && rootNode
                ? `<a href="/api/v1/root/${rootNode}/understandings/run/${runId}/${uNodeId}${tokenQS}"><code>${esc(uNodeId)}</code></a>`
                : uNodeId
                  ? `<code>${esc(uNodeId)}</code>`
                  : `<code>unknown</code>`;
            let text = `Understanding encoded ${uNodeLink}`;
            if (um.mode)
              text += ` <span class="kv-chip">${esc(um.mode)}</span>`;
            if (um.layer != null) text += ` at layer <code>${um.layer}</code>`;
            return text;
          }

          return `Understanding activity on ${nLink}`;
        }

        default:
          return `<code>${esc(c.action)}</code> on ${nLink}`;
      }
    };

    const items = await Promise.all(
      contributions.map(async (c) => {
        const nId = c.nodeId?._id || c.nodeId;
        const nodeName = nId ? await getNodeName(nId) : null;
        const time = new Date(c.date).toLocaleString();
        const actionHtml = renderAction(c, nodeName);
        const colorClass = actionColorClass(c.action);

        const aiBadge = c.wasAi ? `<span class="badge badge-ai">AI</span>` : "";
        const energyBadge =
          c.energyUsed != null && c.energyUsed > 0
            ? `<span class="badge badge-energy">\u26A1 ${c.energyUsed}</span>`
            : "";

        return `
      <li class="note-card ${colorClass}">
        <div class="note-content">
          <div class="contribution-action">${actionHtml}</div>
        </div>
        <div class="note-meta">
          ${time}
          ${aiBadge}${energyBadge}
          <span class="meta-separator">\u00B7</span>
          <code class="contribution-id">${esc(c._id)}</code>
        </div>
      </li>`;
      }),
    );

  const css2 = `
.header-subtitle {
  margin-bottom: 16px;
}


.nav-links {
  display: flex; flex-wrap: wrap; gap: 8px;
}

.nav-links a {
  display: inline-block;
  padding: 6px 14px;
  background: rgba(255,255,255,0.18);
  color: white; border-radius: 980px;
  font-size: 13px; font-weight: 600;
  text-decoration: none;
  border: 1px solid rgba(255,255,255,0.25);
  transition: all 0.2s;
}

.nav-links a:hover {
  background: rgba(255,255,255,0.32);
  transform: translateY(-1px);
}

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

/* Badges */

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

/* KV Chips */

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

/* Responsive */`;

  const bodyHtml = `
  <div class="container">
    <div class="back-nav">
      <a href="/api/v1/user/${userId}${tokenQS}" class="back-link">\u2190 Back to Profile</a>
    </div>

    <div class="header">
      <h1>
        Contributions by
        <a href="/api/v1/user/${userId}${tokenQS}">@${esc(username)}</a>
        ${contributions.length > 0 ? `<span class="message-count">${contributions.length}</span>` : ""}
      </h1>
      <div class="header-subtitle">Activity &amp; change history</div>

    </div>

    ${
      items.length
        ? `<ul class="notes-list">${items.join("")}</ul>`
        : `
    <div class="empty-state">
      <div class="empty-state-icon">\uD83D\uDCCA</div>
      <div class="empty-state-text">No contributions yet</div>
      <div class="empty-state-subtext">Contributions and activity will appear here</div>
    </div>`
    }
  </div>`;

  return page({
    title: `${esc(username)} \u2014 Contributions`,
    css: css2,
    body: bodyHtml,
  });
}
