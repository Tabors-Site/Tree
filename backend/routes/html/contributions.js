/* ─────────────────────────────────────────────── */
/* HTML renderer for contributions page             */
/* ─────────────────────────────────────────────── */

const esc = (str = "") =>
  String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");

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

const actionColor = (action) => {
  switch (action) {
    case "create":
      return "glass-green";
    case "delete":
    case "branchLifecycle":
      return "glass-red";
    case "editStatus":
    case "editValue":
    case "editGoal":
    case "editSchedule":
    case "editNameNode":
    case "editScript":
      return "glass-blue";
    case "executeScript":
      return "glass-cyan";
    case "prestige":
      return "glass-gold";
    case "note":
    case "rawIdea":
      return "glass-purple";
    case "invite":
      return "glass-pink";
    case "transaction":
    case "trade":
      return "glass-orange";
    case "purchase":
      return "glass-emerald";
    case "updateParent":
    case "updateChildNode":
      return "glass-teal";
    case "understanding":
      return "glass-indigo";
    default:
      return "glass-default";
  }
};

function renderAction(c, { nodeId, parsedVersion, nextVersion, queryString }) {
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
    const colorClass = actionColor(c.action);

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
:root {
  --glass-alpha: 0.28;
  --glass-alpha-hover: 0.38;
}

* {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
  -webkit-tap-highlight-color: transparent;
}

html, body {
  background: #736fe6;
  margin: 0;
  padding: 0;
}

body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen', 'Ubuntu', 'Cantarell', sans-serif;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  min-height: 100vh;
  min-height: 100dvh;
  padding: 20px;
  color: #1a1a1a;
  position: relative;
  overflow-x: hidden;
  touch-action: manipulation;
}

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
  width: 600px; height: 600px;
  background: white;
  top: -300px; right: -200px;
  animation-delay: -5s;
}

body::after {
  width: 400px; height: 400px;
  background: white;
  bottom: -200px; left: -100px;
  animation-delay: -10s;
}

@keyframes float {
  0%, 100% { transform: translateY(0) rotate(0deg); }
  50% { transform: translateY(-30px) rotate(5deg); }
}

@keyframes fadeInUp {
  from { opacity: 0; transform: translateY(30px); }
  to { opacity: 1; transform: translateY(0); }
}

.container {
  max-width: 900px;
  margin: 0 auto;
  position: relative;
  z-index: 1;
}

/* ── Glass Back Nav ─────────────────────────────── */

.back-nav {
  display: flex;
  gap: 12px;
  margin-bottom: 20px;
  flex-wrap: wrap;
  animation: fadeInUp 0.5s ease-out both;
}

.back-link {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 10px 20px;
  background: rgba(115, 111, 230, var(--glass-alpha));
  backdrop-filter: blur(22px) saturate(140%);
  -webkit-backdrop-filter: blur(22px) saturate(140%);
  color: white;
  text-decoration: none;
  border-radius: 980px;
  font-weight: 600;
  font-size: 14px;
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  box-shadow: 0 8px 24px rgba(0,0,0,0.12),
    inset 0 1px 0 rgba(255,255,255,0.25);
  border: 1px solid rgba(255,255,255,0.28);
  position: relative;
  overflow: hidden;
}

.back-link::before {
  content: "";
  position: absolute; inset: -40%;
  background: radial-gradient(120% 60% at 0% 0%, rgba(255,255,255,0.35), transparent 60%);
  opacity: 0;
  transition: opacity 0.35s ease, transform 0.6s cubic-bezier(0.22,1,0.36,1);
  pointer-events: none;
}

.back-link:hover {
  background: rgba(115, 111, 230, var(--glass-alpha-hover));
  transform: translateY(-1px);
}

.back-link:hover::before { opacity: 1; transform: translateX(30%) translateY(10%); }

/* ── Glass Header ───────────────────────────────── */

.header {
  position: relative; overflow: hidden;
  background: rgba(115, 111, 230, var(--glass-alpha));
  backdrop-filter: blur(22px) saturate(140%);
  -webkit-backdrop-filter: blur(22px) saturate(140%);
  border-radius: 16px;
  padding: 32px;
  margin-bottom: 24px;
  box-shadow: 0 8px 32px rgba(0,0,0,0.12),
    inset 0 1px 0 rgba(255,255,255,0.25);
  border: 1px solid rgba(255,255,255,0.28);
  color: white;
  animation: fadeInUp 0.6s ease-out 0.1s both;
}

.header::before {
  content: "";
  position: absolute; inset: -40%;
  background: radial-gradient(120% 60% at 0% 0%, rgba(255,255,255,0.35), transparent 60%);
  opacity: 0;
  transition: opacity 0.35s ease, transform 0.6s cubic-bezier(0.22,1,0.36,1);
  pointer-events: none;
}

.header:hover::before { opacity: 1; transform: translateX(30%) translateY(10%); }

.header h1 {
  font-size: 28px; font-weight: 600; color: white;
  margin-bottom: 8px; line-height: 1.3; letter-spacing: -0.5px;
  text-shadow: 0 2px 8px rgba(0,0,0,0.2);
}

.header h1 a {
  color: white; text-decoration: none;
  border-bottom: 1px solid rgba(255,255,255,0.3);
  transition: all 0.2s;
}

.header h1 a:hover {
  border-bottom-color: white;
  text-shadow: 0 0 12px rgba(255,255,255,0.8);
}

.message-count {
  display: inline-block;
  padding: 6px 14px;
  background: rgba(255,255,255,0.25);
  color: white; border-radius: 980px;
  font-size: 14px; font-weight: 600;
  margin-left: 12px;
  border: 1px solid rgba(255,255,255,0.3);
}

.version-badge {
  display: inline-block;
  padding: 6px 14px;
  background: rgba(255,255,255,0.25);
  color: white; border-radius: 980px;
  font-size: 13px; font-weight: 600;
  border: 1px solid rgba(255,255,255,0.3);
  margin-right: 8px;
}

.header-subtitle {
  font-size: 14px; color: rgba(255,255,255,0.9);
  margin-bottom: 16px; font-weight: 400; line-height: 1.5;
}

/* ── Glass Cards — base ─────────────────────────── */

.notes-list {
  list-style: none;
  display: flex; flex-direction: column; gap: 16px;
}

.note-card {
  --card-rgb: 115, 111, 230;
  position: relative;
  background: rgba(var(--card-rgb), var(--glass-alpha));
  backdrop-filter: blur(22px) saturate(140%);
  -webkit-backdrop-filter: blur(22px) saturate(140%);
  border-radius: 16px;
  padding: 24px;
  box-shadow: 0 8px 24px rgba(0,0,0,0.12),
    inset 0 1px 0 rgba(255,255,255,0.25);
  border: 1px solid rgba(255,255,255,0.28);
  transition: all 0.3s cubic-bezier(0.4,0,0.2,1);
  color: white; overflow: hidden;
}

.notes-list {
  animation: fadeInUp 0.6s ease-out 0.2s both;
}

.note-card:nth-child(1) { animation-delay: 0.25s; }
.note-card:nth-child(2) { animation-delay: 0.3s; }
.note-card:nth-child(3) { animation-delay: 0.35s; }
.note-card:nth-child(4) { animation-delay: 0.4s; }
.note-card:nth-child(5) { animation-delay: 0.45s; }
.note-card:nth-child(n+6) { animation-delay: 0.5s; }

.note-card::before {
  content: "";
  position: absolute; inset: -40%;
  background: radial-gradient(120% 60% at 0% 0%, rgba(255,255,255,0.35), transparent 60%);
  opacity: 0;
  transition: opacity 0.35s ease, transform 0.6s cubic-bezier(0.22,1,0.36,1);
  pointer-events: none;
}

.note-card:hover {
  background: rgba(var(--card-rgb), var(--glass-alpha-hover));
  transform: translateY(-2px);
  box-shadow: 0 12px 32px rgba(0,0,0,0.18);
}

.note-card:hover::before { opacity: 1; transform: translateX(30%) translateY(10%); }

/* ── Color Variants ─────────────────────────────── */

.glass-default  { --card-rgb: 115, 111, 230; }
.glass-green    { --card-rgb: 72, 187, 120;  }
.glass-red      { --card-rgb: 200, 80, 80;   }
.glass-blue     { --card-rgb: 80, 130, 220;  }
.glass-cyan     { --card-rgb: 56, 189, 210;  }
.glass-gold     { --card-rgb: 200, 170, 50;  }
.glass-purple   { --card-rgb: 155, 100, 220; }
.glass-pink     { --card-rgb: 210, 100, 160; }
.glass-orange   { --card-rgb: 220, 140, 60;  }
.glass-emerald  { --card-rgb: 52, 190, 130;  }
.glass-teal     { --card-rgb: 60, 170, 180;  }
.glass-indigo   { --card-rgb: 100, 100, 210; }

/* ── Card Inner ─────────────────────────────────── */

.note-content {
  margin-bottom: 12px;
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

/* ── Note Meta ──────────────────────────────────── */

.note-meta {
  padding-top: 12px;
  border-top: 1px solid rgba(255,255,255,0.2);
  font-size: 12px; color: rgba(255,255,255,0.85);
  line-height: 1.8;
  display: flex; flex-wrap: wrap;
  align-items: center; gap: 6px;
}

.note-meta a {
  color: white; text-decoration: none; font-weight: 500;
  border-bottom: 1px solid rgba(255,255,255,0.3);
  transition: all 0.2s;
}

.note-meta a:hover {
  border-bottom-color: white;
  text-shadow: 0 0 12px rgba(255,255,255,0.8);
}

.meta-separator { color: rgba(255,255,255,0.5); }

.contribution-id {
  background: rgba(255,255,255,0.12);
  padding: 2px 6px; border-radius: 4px;
  font-size: 11px;
  font-family: 'SF Mono', 'Fira Code', monospace;
  color: rgba(255,255,255,0.6);
  border: 1px solid rgba(255,255,255,0.1);
}

/* ── Badges ─────────────────────────────────────── */

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

/* ── KV Chips ───────────────────────────────────── */

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

/* ── Empty State ────────────────────────────────── */

.empty-state {
  position: relative; overflow: hidden;
  background: rgba(115, 111, 230, var(--glass-alpha));
  backdrop-filter: blur(22px) saturate(140%);
  -webkit-backdrop-filter: blur(22px) saturate(140%);
  border-radius: 16px;
  padding: 60px 40px; text-align: center;
  box-shadow: 0 8px 32px rgba(0,0,0,0.12),
    inset 0 1px 0 rgba(255,255,255,0.25);
  border: 1px solid rgba(255,255,255,0.28);
  color: white;
  animation: fadeInUp 0.6s ease-out 0.2s both;
}

.empty-state::before {
  content: "";
  position: absolute; inset: -40%;
  background: radial-gradient(120% 60% at 0% 0%, rgba(255,255,255,0.35), transparent 60%);
  opacity: 0;
  transition: opacity 0.35s ease, transform 0.6s cubic-bezier(0.22,1,0.36,1);
  pointer-events: none;
}

.empty-state:hover::before { opacity: 1; transform: translateX(30%) translateY(10%); }

.empty-state-icon {
  font-size: 64px; margin-bottom: 16px;
  filter: drop-shadow(0 4px 12px rgba(0,0,0,0.2));
}

.empty-state-text {
  font-size: 20px; color: white;
  margin-bottom: 8px; font-weight: 600;
  text-shadow: 0 2px 8px rgba(0,0,0,0.2);
}

.empty-state-subtext {
  font-size: 14px; color: rgba(255,255,255,0.85);
}

/* ── Responsive ─────────────────────────────────── */

@media (max-width: 640px) {
  body { padding: 16px; }
  .header { padding: 24px 20px; }
  .header h1 { font-size: 24px; }
  .message-count { display: block; margin-left: 0; margin-top: 8px; width: fit-content; }
  .note-card { padding: 20px 16px; }
  .back-nav { flex-direction: column; }
  .back-link { width: 100%; justify-content: center; }
  .empty-state { padding: 40px 24px; }
}

@media (min-width: 641px) and (max-width: 1024px) {
  .container { max-width: 700px; }
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
