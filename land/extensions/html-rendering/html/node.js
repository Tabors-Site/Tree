/* ------------------------------------------------------------------ */
/* HTML renderers for node routes                                      */
/* ------------------------------------------------------------------ */

const esc = (str = "") =>
  String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

const truncate = (str, len = 200) => {
  if (!str) return "";
  const clean = esc(str);
  return clean.length > len ? clean.slice(0, len) + "..." : clean;
};

const linkifyNodeIds = (html, token) =>
  html.replace(
    /Placed on node ([0-9a-f-]{36})/g,
    (_, id) =>
      `Placed on node <a class="node-link" href="/api/v1/root/${id}${token ? `?token=${token}&html` : "?html"}">${id}</a>`,
  );

const formatTime = (d) => (d ? new Date(d).toLocaleString() : "--");

const formatDuration = (start, end) => {
  if (!start || !end) return null;
  const ms = new Date(end) - new Date(start);
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
};

const formatContent = (str) => {
  if (!str) return "";
  const s = String(str).trim();
  if (
    (s.startsWith("{") && s.endsWith("}")) ||
    (s.startsWith("[") && s.endsWith("]"))
  ) {
    try {
      const parsed = JSON.parse(s);
      const pretty = JSON.stringify(parsed, null, 2);
      return `<span class="chain-json">${esc(pretty)}</span>`;
    } catch (_) {}
  }
  return esc(s);
};

const modeLabel = (path) => {
  if (!path) return "unknown";
  if (path === "translator") return "Translator";
  if (path.startsWith("tree:orchestrator:plan:")) {
    const num = path.split(":")[3];
    return `Plan Step ${num}`;
  }
  const parts = path.split(":");
  const labels = { home: "Home", tree: "Tree", rawIdea: "Raw Idea" };
  const subLabels = {
    default: "Default",
    chat: "Chat",
    structure: "Structure",
    edit: "Edit",
    be: "Be",
    reflect: "Reflect",
    navigate: "Navigate",
    understand: "Understand",
    getContext: "Context",
    respond: "Respond",
    notes: "Notes",
    start: "Start",
    chooseRoot: "Choose Root",
    complete: "Placed",
    stuck: "Stuck",
  };
  const big = labels[parts[0]] || parts[0];
  const sub = subLabels[parts[1]] || parts[1] || "";
  return sub ? `${big} ${sub}` : big;
};

const sourceLabel = (src) => {
  const map = {
    user: "User",
    api: "API",
    orchestrator: "Chain",
    background: "Background",
    script: "Script",
    system: "System",
  };
  return map[src] || src;
};

const actionLabel = (action) => {
  const map = {
    create: "Created",
    editStatus: "Status",
    editValue: "Values",
    prestige: "Prestige",
    trade: "Trade",
    delete: "Deleted",
    invite: "Invite",
    editSchedule: "Schedule",
    editGoal: "Goal",
    transaction: "Transaction",
    note: "Note",
    updateParent: "Moved",
    editScript: "Script",
    executeScript: "Ran script",
    updateChildNode: "Child",
    editNameNode: "Renamed",
    rawIdea: "Raw idea",
    branchLifecycle: "Branch",
    purchase: "Purchase",
    understanding: "Understanding",
  };
  return map[action] || action;
};

const actionColor = (action) => {
  switch (action) {
    case "create":
      return "#48bb78";
    case "delete":
    case "branchLifecycle":
      return "#c85050";
    case "editStatus":
    case "editValue":
    case "editGoal":
    case "editSchedule":
    case "editNameNode":
    case "editScript":
      return "#5082dc";
    case "executeScript":
      return "#38bdd2";
    case "prestige":
      return "#c8aa32";
    case "note":
    case "rawIdea":
      return "#9b64dc";
    case "invite":
      return "#d264a0";
    case "transaction":
    case "trade":
      return "#dc8c3c";
    case "purchase":
      return "#34be82";
    case "updateParent":
    case "updateChildNode":
      return "#3caab4";
    case "understanding":
      return "#6464d2";
    default:
      return "#736fe6";
  }
};

const renderTreeContext = (tc, tokenQS) => {
  if (!tc) return "";
  const parts = [];
  const tcNodeId = tc.targetNodeId?._id || tc.targetNodeId;
  const tcNodeName = tc.targetNodeId?.name || tc.targetNodeName;
  if (tcNodeId && tcNodeName && typeof tcNodeId === "string") {
    parts.push(
      `<a href="/api/v1/node/${tcNodeId}${tokenQS}" class="tree-target-link">${esc(tcNodeName)}</a>`,
    );
  } else if (tcNodeName) {
    parts.push(`<span class="tree-target-name">${esc(tcNodeName)}</span>`);
  } else if (tc.targetPath) {
    const pathParts = tc.targetPath.split(" / ");
    const last = pathParts[pathParts.length - 1];
    parts.push(`<span class="tree-target-name">${esc(last)}</span>`);
  }
  if (tc.planStepIndex != null && tc.planTotalSteps != null) {
    parts.push(
      `<span class="badge badge-step">${tc.planStepIndex}/${tc.planTotalSteps}</span>`,
    );
  }
  if (tc.stepResult) {
    const resultClasses = {
      success: "badge-done",
      failed: "badge-stopped",
      skipped: "badge-skipped",
      pending: "badge-pending",
    };
    const resultIcons = {
      success: "done",
      failed: "failed",
      skipped: "skip",
      pending: "...",
    };
    parts.push(
      `<span class="badge ${resultClasses[tc.stepResult] || "badge-pending"}">${resultIcons[tc.stepResult] || ""} ${tc.stepResult}</span>`,
    );
  }
  if (parts.length === 0) return "";
  return `<div class="tree-context-bar">${parts.join("")}</div>`;
};

const renderDirective = (tc) => {
  if (!tc?.directive) return "";
  return `<div class="tree-directive">${esc(tc.directive)}</div>`;
};

const getTargetName = (tc) => {
  if (!tc) return null;
  return tc.targetNodeId?.name || tc.targetNodeName || null;
};

const renderModelBadge = (chat) => {
  const connName = chat.llmProvider?.connectionId?.name;
  const model = connName || chat.llmProvider?.model;
  if (!model) return "";
  return `<span class="chain-model">${esc(model)}</span>`;
};

const groupIntoChains = (chats) => {
  const chainMap = new Map();
  const chainOrder = [];
  for (const chat of chats) {
    const key = chat.rootChatId || chat._id;
    if (!chainMap.has(key)) {
      chainMap.set(key, { root: null, steps: [] });
      chainOrder.push(key);
    }
    const chain = chainMap.get(key);
    if (chat.chainIndex === 0 || chat._id === key) {
      chain.root = chat;
    } else {
      chain.steps.push(chat);
    }
  }
  return chainOrder
    .map((key) => {
      const chain = chainMap.get(key);
      chain.steps.sort((a, b) => a.chainIndex - b.chainIndex);
      return chain;
    })
    .filter((c) => c.root);
};

const groupStepsIntoPhases = (steps) => {
  const phases = [];
  let currentPlan = null;
  for (const step of steps) {
    const mode = step.aiContext?.path || "";
    if (mode === "translator") {
      currentPlan = null;
      phases.push({ type: "translate", step });
    } else if (mode.startsWith("tree:orchestrator:plan:")) {
      currentPlan = { type: "plan", marker: step, substeps: [] };
      phases.push(currentPlan);
    } else if (mode === "tree:respond") {
      currentPlan = null;
      phases.push({ type: "respond", step });
    } else if (currentPlan) {
      currentPlan.substeps.push(step);
    } else {
      phases.push({ type: "step", step });
    }
  }
  return phases;
};

const renderSubstep = (chat, tokenQS) => {
  const duration = formatDuration(
    chat.startMessage?.time,
    chat.endMessage?.time,
  );
  const stopped = chat.endMessage?.stopped;
  const tc = chat.treeContext;
  const dotClass = stopped
    ? "chain-dot-stopped"
    : tc?.stepResult === "failed"
      ? "chain-dot-stopped"
      : tc?.stepResult === "skipped"
        ? "chain-dot-skipped"
        : chat.endMessage?.time
          ? "chain-dot-done"
          : "chain-dot-pending";
  const targetName = getTargetName(tc);
  const inputFull = formatContent(chat.startMessage?.content);
  const outputFull = formatContent(chat.endMessage?.content);

  return `
      <details class="chain-substep">
        <summary class="chain-substep-summary">
          <span class="chain-dot ${dotClass}"></span>
          <span class="chain-step-mode">${modeLabel(chat.aiContext?.path)}</span>
          ${targetName ? `<span class="chain-step-target">${esc(targetName)}</span>` : ""}
          ${tc?.stepResult === "failed" ? `<span class="chain-step-failed">FAILED</span>` : ""}
          ${tc?.resultDetail && tc.stepResult === "failed" ? `<span class="chain-step-fail-reason">${truncate(tc.resultDetail, 60)}</span>` : ""}
          ${renderModelBadge(chat)}
          ${duration ? `<span class="chain-step-duration">${duration}</span>` : ""}
        </summary>
        <div class="chain-step-body">
          ${renderTreeContext(tc, tokenQS)}
          ${renderDirective(tc)}
          <div class="chain-step-input"><span class="chain-io-label chain-io-in">IN</span>${inputFull}</div>
          ${outputFull ? `<div class="chain-step-output"><span class="chain-io-label chain-io-out">OUT</span>${outputFull}</div>` : ""}
        </div>
      </details>`;
};

const renderPhases = (steps, tokenQS) => {
  const phases = groupStepsIntoPhases(steps);
  if (phases.length === 0) return "";

  const phaseHtml = phases
    .map((phase) => {
      if (phase.type === "translate") {
        const s = phase.step;
        const tc = s.treeContext;
        const duration = formatDuration(
          s.startMessage?.time,
          s.endMessage?.time,
        );
        const outputFull = formatContent(s.endMessage?.content);
        return `
          <details class="chain-phase chain-phase-translate">
            <summary class="chain-phase-summary">
              <span class="chain-phase-icon">T</span>
              <span class="chain-phase-label">Translator</span>
              ${tc?.planTotalSteps ? `<span class="chain-step-counter">${tc.planTotalSteps}-step plan</span>` : ""}
              ${tc?.directive ? `<span class="chain-plan-summary-text">${truncate(tc.directive, 80)}</span>` : ""}
              ${renderModelBadge(s)}
              ${duration ? `<span class="chain-step-duration">${duration}</span>` : ""}
            </summary>
            ${outputFull ? `<div class="chain-step-body"><div class="chain-step-output"><span class="chain-io-label chain-io-out">PLAN</span>${outputFull}</div></div>` : ""}
          </details>`;
      }

      if (phase.type === "plan") {
        const m = phase.marker;
        const tc = m.treeContext;
        const targetName = getTargetName(tc);
        const hasSubsteps = phase.substeps.length > 0;
        const counts = { success: 0, failed: 0, skipped: 0 };
        for (const sub of phase.substeps) {
          const r = sub.treeContext?.stepResult;
          if (r && counts[r] !== undefined) counts[r]++;
        }
        const countBadges = [
          counts.success > 0
            ? `<span class="badge badge-done">${counts.success} done</span>`
            : "",
          counts.failed > 0
            ? `<span class="badge badge-stopped">${counts.failed} failed</span>`
            : "",
          counts.skipped > 0
            ? `<span class="badge badge-skipped">${counts.skipped} skipped</span>`
            : "",
        ]
          .filter(Boolean)
          .join("");

        const directiveText = tc?.directive || "";
        const inputFull = directiveText
          ? esc(directiveText)
          : formatContent(m.startMessage?.content);

        return `
          <div class="chain-phase chain-phase-plan">
            <div class="chain-phase-header">
              <span class="chain-phase-icon">P</span>
              <span class="chain-phase-label">${modeLabel(m.aiContext?.path)}</span>
              ${targetName ? `<span class="chain-step-target">${esc(targetName)}</span>` : ""}
              ${tc?.planStepIndex != null && tc?.planTotalSteps != null ? `<span class="chain-step-counter">Step ${tc.planStepIndex} of ${tc.planTotalSteps}</span>` : ""}
              ${countBadges}
              ${renderModelBadge(m)}
            </div>
            <div class="chain-plan-directive">${inputFull}</div>
            ${hasSubsteps ? `<div class="chain-substeps">${phase.substeps.map((s) => renderSubstep(s, tokenQS)).join("")}</div>` : ""}
          </div>`;
      }

      if (phase.type === "respond") {
        const s = phase.step;
        const tc = s.treeContext;
        const duration = formatDuration(
          s.startMessage?.time,
          s.endMessage?.time,
        );
        const inputFull = formatContent(s.startMessage?.content);
        const outputFull = formatContent(s.endMessage?.content);
        return `
          <details class="chain-phase chain-phase-respond">
            <summary class="chain-phase-summary">
              <span class="chain-phase-icon">R</span>
              <span class="chain-phase-label">${modeLabel(s.aiContext?.path)}</span>
              ${renderModelBadge(s)}
              ${duration ? `<span class="chain-step-duration">${duration}</span>` : ""}
            </summary>
            <div class="chain-step-body">
              ${renderTreeContext(tc, tokenQS)}
              ${inputFull ? `<div class="chain-step-input"><span class="chain-io-label chain-io-in">IN</span>${inputFull}</div>` : ""}
              ${outputFull ? `<div class="chain-step-output"><span class="chain-io-label chain-io-out">OUT</span>${outputFull}</div>` : ""}
            </div>
          </details>`;
      }

      return renderSubstep(phase.step, tokenQS);
    })
    .join("");

  const summaryParts = phases
    .map((p) => {
      if (p.type === "translate") {
        const tc = p.step.treeContext;
        return tc?.planTotalSteps ? `T ${tc.planTotalSteps}-step` : "T";
      }
      if (p.type === "plan") {
        const tc = p.marker.treeContext;
        const targetName = getTargetName(tc);
        const sub = p.substeps
          .map((s) => {
            const stc = s.treeContext;
            const icon =
              stc?.stepResult === "failed"
                ? "X "
                : stc?.stepResult === "skipped"
                  ? "- "
                  : stc?.stepResult === "success"
                    ? "v "
                    : "";
            return `${icon}${modeLabel(s.aiContext?.path)}`;
          })
          .join(" > ");
        const label = targetName ? `P ${esc(targetName)}` : "P";
        return sub ? `${label}: ${sub}` : label;
      }
      if (p.type === "respond") return "R";
      return modeLabel(p.step?.aiContext?.path);
    })
    .join("  ");

  return `
      <details class="chain-dropdown">
        <summary class="chain-summary">
          ${phases.length} phase${phases.length !== 1 ? "s" : ""}
          <span class="chain-modes">${summaryParts}</span>
        </summary>
        <div class="chain-phases">${phaseHtml}</div>
      </details>`;
};

const renderChain = (chain, tokenQS, token) => {
  const chat = chain.root;
  const steps = chain.steps;
  const duration = formatDuration(
    chat.startMessage?.time,
    chat.endMessage?.time,
  );
  const stopped = chat.endMessage?.stopped;
  const contribs = chat.contributions || [];
  const hasContribs = contribs.length > 0;
  const hasSteps = steps.length > 0;
  const modelName =
    chat.llmProvider?.connectionId?.name ||
    chat.llmProvider?.model ||
    "unknown";

  const tc = chat.treeContext;
  const treeNodeId = tc?.targetNodeId?._id || tc?.targetNodeId;
  const treeNodeName = tc?.targetNodeId?.name || tc?.targetNodeName;
  const treeLink =
    treeNodeId && treeNodeName
      ? `<a href="/api/v1/node/${treeNodeId}${tokenQS}" class="tree-target-link">${esc(treeNodeName)}</a>`
      : treeNodeName
        ? `<span class="tree-target-name">${esc(treeNodeName)}</span>`
        : "";

  const statusBadge = stopped
    ? `<span class="badge badge-stopped">Stopped</span>`
    : chat.endMessage?.time
      ? `<span class="badge badge-done">Done</span>`
      : `<span class="badge badge-pending">Pending</span>`;

  const contribRows = contribs
    .map((c) => {
      const nId = c.nodeId?._id || c.nodeId;
      const nName = c.nodeId?.name || nId || "--";
      const nodeRef = nId
        ? `<a href="/api/v1/node/${nId}${tokenQS}">${esc(nName)}</a>`
        : `<span style="opacity:0.5">--</span>`;
      const aiBadge = c.wasAi
        ? `<span class="mini-badge mini-ai">AI</span>`
        : "";
      const cEnergyBadge =
        c.energyUsed > 0
          ? `<span class="mini-badge mini-energy">E${c.energyUsed}</span>`
          : "";
      const understandingLink =
        c.action === "understanding" &&
        c.understandingMeta?.understandingRunId &&
        c.understandingMeta?.rootNodeId
          ? ` <a class="understanding-link" href="/api/v1/root/${c.understandingMeta.rootNodeId}/understandings/run/${c.understandingMeta.understandingRunId}${tokenQS}">View run</a>`
          : "";
      const color = actionColor(c.action);
      return `
        <tr class="contrib-row">
          <td><span class="action-dot" style="background:${color}"></span>${esc(actionLabel(c.action))}${understandingLink}</td>
          <td>${nodeRef}</td>
          <td>${aiBadge}${cEnergyBadge}</td>
          <td class="contrib-time">${formatTime(c.date)}</td>
        </tr>`;
    })
    .join("");

  const stepsHtml = hasSteps ? renderPhases(steps, tokenQS) : "";

  return `
      <li class="note-card">
        <div class="chat-header">
          <div class="chat-header-left">
            <span class="chat-mode">${modeLabel(chat.aiContext?.path)}</span>
            ${treeLink}
            <span class="chat-model">${esc(modelName)}</span>
          </div>
          <div class="chat-badges">
            ${statusBadge}
            ${duration ? `<span class="badge badge-duration">${duration}</span>` : ""}
            <span class="badge badge-source">${sourceLabel(chat.startMessage?.source)}</span>
          </div>
        </div>

        <div class="note-content">
          <div class="chat-message chat-user">
            <span class="msg-label">You</span>
            <div class="msg-text msg-clamp">${esc(chat.startMessage?.content || "")}</div>
            ${(chat.startMessage?.content || "").length > 300 ? `<button class="expand-btn" onclick="toggleExpand(this)">Show more</button>` : ""}
          </div>
          ${
            chat.endMessage?.content
              ? `
          <div class="chat-message chat-ai">
            <span class="msg-label">AI</span>
            <div class="msg-text msg-clamp">${linkifyNodeIds(esc(chat.endMessage.content), token)}</div>
            ${chat.endMessage.content.length > 300 ? `<button class="expand-btn" onclick="toggleExpand(this)">Show more</button>` : ""}
          </div>`
              : ""
          }
        </div>

        ${stepsHtml}

        ${
          hasContribs
            ? `
        <details class="contrib-dropdown">
          <summary class="contrib-summary">
            ${contribs.length} contribution${contribs.length !== 1 ? "s" : ""} during this chat
          </summary>
          <div class="contrib-table-wrap">
            <table class="contrib-table">
              <thead><tr><th>Action</th><th>Node</th><th></th><th>Time</th></tr></thead>
              <tbody>${contribRows}</tbody>
            </table>
          </div>
        </details>`
            : ""
        }

        <div class="note-meta">
          ${formatTime(chat.startMessage?.time)}
          <span class="meta-separator">|</span>
          <code class="contribution-id">${esc(chat._id)}</code>
        </div>
      </li>`;
};

/* ================================================================== */
/* 1. renderNodeChats                                                  */
/* ================================================================== */

export function renderNodeChats({
  nodeId,
  nodeName,
  nodePath,
  sessions,
  allChats,
  token,
  tokenQS,
}) {
  const sessionGroups = sessions;

  const renderedSections = sessionGroups
    .map((group) => {
      const chatCount = group.chatCount;
      const sessionTime = formatTime(group.startTime);
      const shortId = group.sessionId.slice(0, 8);
      const chains = groupIntoChains(group.chats);
      const chatCards = chains.map((c) => renderChain(c, tokenQS, token)).join("");

      return `
      <div class="session-group">
        <div class="session-pane">
          <div class="session-pane-header">
            <div class="session-header-left">
              <span class="session-id">${esc(shortId)}</span>
              <span class="session-info">${chatCount} chat${chatCount !== 1 ? "s" : ""}</span>
            </div>
            <span class="session-time">${sessionTime}</span>
          </div>
          <ul class="notes-list">${chatCards}</ul>
        </div>
      </div>`;
    })
    .join("");

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="theme-color" content="#667eea">
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
  <title>${esc(nodeName)} -- AI Chats</title>
  <style>
:root {
  --glass-alpha: 0.28;
  --glass-alpha-hover: 0.38;
}

* { box-sizing: border-box; margin: 0; padding: 0; -webkit-tap-highlight-color: transparent; }
html, body { background: #736fe6; margin: 0; padding: 0; }

body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen', 'Ubuntu', 'Cantarell', sans-serif;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  min-height: 100vh; min-height: 100dvh;
  padding: 20px; color: #1a1a1a;
  position: relative; overflow-x: hidden; touch-action: manipulation;
}

body::before, body::after {
  content: ''; position: fixed; border-radius: 50%; opacity: 0.08;
  animation: float 20s infinite ease-in-out; pointer-events: none;
}
body::before { width: 600px; height: 600px; background: white; top: -300px; right: -200px; animation-delay: -5s; }
body::after { width: 400px; height: 400px; background: white; bottom: -200px; left: -100px; animation-delay: -10s; }

@keyframes float {
  0%, 100% { transform: translateY(0) rotate(0deg); }
  50% { transform: translateY(-30px) rotate(5deg); }
}
@keyframes fadeInUp {
  from { opacity: 0; transform: translateY(30px); }
  to { opacity: 1; transform: translateY(0); }
}

.container { max-width: 900px; margin: 0 auto; position: relative; z-index: 1; }

.back-nav { display: flex; gap: 12px; margin-bottom: 20px; flex-wrap: wrap; animation: fadeInUp 0.5s ease-out; }
.back-link {
  display: inline-flex; align-items: center; gap: 6px; padding: 10px 20px;
  background: rgba(115,111,230,var(--glass-alpha)); backdrop-filter: blur(22px) saturate(140%);
  -webkit-backdrop-filter: blur(22px) saturate(140%); color: white; text-decoration: none;
  border-radius: 980px; font-weight: 600; font-size: 14px;
  transition: all 0.3s cubic-bezier(0.4,0,0.2,1);
  box-shadow: 0 8px 24px rgba(0,0,0,0.12), inset 0 1px 0 rgba(255,255,255,0.25);
  border: 1px solid rgba(255,255,255,0.28); position: relative; overflow: hidden;
}
.back-link::before {
  content: ""; position: absolute; inset: -40%;
  background: radial-gradient(120% 60% at 0% 0%, rgba(255,255,255,0.35), transparent 60%);
  opacity: 0; transition: opacity 0.35s ease, transform 0.6s cubic-bezier(0.22,1,0.36,1); pointer-events: none;
}
.back-link:hover { background: rgba(115,111,230,var(--glass-alpha-hover)); transform: translateY(-1px); }
.back-link:hover::before { opacity: 1; transform: translateX(30%) translateY(10%); }

.header {
  position: relative; overflow: hidden;
  background: rgba(115,111,230,var(--glass-alpha)); backdrop-filter: blur(22px) saturate(140%);
  -webkit-backdrop-filter: blur(22px) saturate(140%);
  border-radius: 16px; padding: 32px; margin-bottom: 24px;
  box-shadow: 0 8px 32px rgba(0,0,0,0.12), inset 0 1px 0 rgba(255,255,255,0.25);
  border: 1px solid rgba(255,255,255,0.28); color: white;
  animation: fadeInUp 0.6s ease-out 0.1s both;
}
.header::before {
  content: ""; position: absolute; inset: -40%;
  background: radial-gradient(120% 60% at 0% 0%, rgba(255,255,255,0.35), transparent 60%);
  opacity: 0; transition: opacity 0.35s ease, transform 0.6s cubic-bezier(0.22,1,0.36,1); pointer-events: none;
}
.header:hover::before { opacity: 1; transform: translateX(30%) translateY(10%); }
.header h1 {
  font-size: 28px; font-weight: 600; color: white; margin-bottom: 8px;
  line-height: 1.3; letter-spacing: -0.5px; text-shadow: 0 2px 8px rgba(0,0,0,0.2);
}
.header h1 a { color: white; text-decoration: none; border-bottom: 1px solid rgba(255,255,255,0.3); transition: all 0.2s; }
.header h1 a:hover { border-bottom-color: white; text-shadow: 0 0 12px rgba(255,255,255,0.8); }
.message-count {
  display: inline-block; padding: 6px 14px; background: rgba(255,255,255,0.25); color: white;
  border-radius: 980px; font-size: 14px; font-weight: 600; margin-left: 12px; border: 1px solid rgba(255,255,255,0.3);
}
.header-subtitle { font-size: 14px; color: rgba(255,255,255,0.9); margin-bottom: 8px; font-weight: 400; line-height: 1.5; }
.header-path { font-size: 12px; color: rgba(255,255,255,0.6); margin-top: 4px; font-family: 'SF Mono', 'Fira Code', monospace; }

.session-group { margin-bottom: 20px; animation: fadeInUp 0.6s ease-out both; }
.session-pane {
  background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.12);
  border-radius: 20px; overflow: hidden; backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px);
}
.session-pane-header {
  display: flex; align-items: center; justify-content: space-between; padding: 14px 20px;
  background: rgba(255,255,255,0.08); border-bottom: 1px solid rgba(255,255,255,0.1);
}
.session-header-left { display: flex; align-items: center; gap: 10px; }
.session-id {
  font-family: 'SF Mono', 'Fira Code', monospace; font-size: 11px; font-weight: 600;
  color: rgba(255,255,255,0.55); background: rgba(255,255,255,0.1); padding: 3px 8px;
  border-radius: 6px; border: 1px solid rgba(255,255,255,0.12);
}
.session-info { font-size: 13px; color: rgba(255,255,255,0.7); font-weight: 600; }
.session-time { font-size: 12px; color: rgba(255,255,255,0.4); font-weight: 500; }

.notes-list { list-style: none; display: flex; flex-direction: column; gap: 16px; padding: 16px; }
.note-card {
  --card-rgb: 115, 111, 230; position: relative;
  background: rgba(var(--card-rgb), var(--glass-alpha)); backdrop-filter: blur(22px) saturate(140%);
  -webkit-backdrop-filter: blur(22px) saturate(140%); border-radius: 16px; padding: 24px;
  box-shadow: 0 8px 24px rgba(0,0,0,0.12), inset 0 1px 0 rgba(255,255,255,0.25);
  border: 1px solid rgba(255,255,255,0.28); transition: all 0.3s cubic-bezier(0.4,0,0.2,1);
  color: white; overflow: hidden; opacity: 0; transform: translateY(30px);
}
.note-card.visible { animation: fadeInUp 0.6s cubic-bezier(0.4,0,0.2,1) forwards; }
.note-card::before {
  content: ""; position: absolute; inset: -40%;
  background: radial-gradient(120% 60% at 0% 0%, rgba(255,255,255,0.35), transparent 60%);
  opacity: 0; transition: opacity 0.35s ease, transform 0.6s cubic-bezier(0.22,1,0.36,1); pointer-events: none;
}
.note-card:hover { background: rgba(var(--card-rgb), var(--glass-alpha-hover)); transform: translateY(-2px); box-shadow: 0 12px 32px rgba(0,0,0,0.18); }
.note-card:hover::before { opacity: 1; transform: translateX(30%) translateY(10%); }

.chat-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; flex-wrap: wrap; gap: 8px; }
.chat-header-left { display: flex; align-items: center; gap: 8px; }
.chat-mode {
  font-size: 11px; font-weight: 600; color: rgba(255,255,255,0.7); background: rgba(255,255,255,0.1);
  padding: 3px 10px; border-radius: 980px; border: 1px solid rgba(255,255,255,0.15);
}
.chat-model {
  font-size: 11px; font-weight: 500; color: rgba(255,255,255,0.45);
  font-family: 'SF Mono', 'Fira Code', monospace; overflow: hidden;
  text-overflow: ellipsis; white-space: nowrap; max-width: 200px;
}
.chat-badges { display: flex; flex-wrap: wrap; gap: 6px; }

.note-content { margin-bottom: 16px; display: flex; flex-direction: column; gap: 14px; }
.chat-message { display: flex; gap: 10px; align-items: flex-start; }
.msg-label {
  flex-shrink: 0; font-weight: 700; font-size: 10px; text-transform: uppercase;
  letter-spacing: 0.5px; padding: 3px 10px; border-radius: 980px; margin-top: 3px;
}
.chat-user .msg-label { background: rgba(255,255,255,0.2); color: white; }
.chat-ai .msg-label   { background: rgba(100,220,255,0.25); color: white; }
.msg-text { color: rgba(255,255,255,0.95); word-wrap: break-word; min-width: 0; font-size: 15px; line-height: 1.65; font-weight: 400; }
.msg-clamp {
  display: -webkit-box; -webkit-line-clamp: 4; -webkit-box-orient: vertical;
  overflow: hidden; max-height: calc(1.65em * 4); transition: max-height 0.3s ease;
}
.msg-clamp.expanded { -webkit-line-clamp: unset; max-height: none; overflow: visible; }
.expand-btn {
  background: none; border: none; color: rgba(100,220,255,0.9); cursor: pointer;
  font-size: 12px; font-weight: 600; padding: 2px 0; margin-top: 2px; transition: color 0.2s;
}
.expand-btn:hover { color: rgba(100,220,255,1); text-decoration: underline; }
.node-link { color: #7effc0; text-decoration: none; background: rgba(50,220,120,0.15); padding: 1px 6px; border-radius: 4px; font-family: monospace; font-size: 13px; }
.node-link:hover { background: rgba(50,220,120,0.3); }
.understanding-link {
  color: rgba(100,100,210,0.9); text-decoration: none; font-size: 11px; font-weight: 500;
  margin-left: 4px; transition: color 0.2s;
}
.understanding-link:hover { color: rgba(130,130,255,1); text-decoration: underline; }
.chat-user .msg-text { font-weight: 500; }

.chain-dropdown { margin-bottom: 12px; }
.chain-summary {
  cursor: pointer; font-size: 13px; font-weight: 600;
  color: rgba(255,255,255,0.85); padding: 8px 14px;
  background: rgba(255,255,255,0.1); border-radius: 10px;
  border: 1px solid rgba(255,255,255,0.15);
  transition: all 0.2s; list-style: none;
  display: flex; align-items: center; gap: 8px;
}
.chain-summary::-webkit-details-marker { display: none; }
.chain-summary::before { content: ">"; font-size: 10px; transition: transform 0.15s; display: inline-block; }
details[open] > .chain-summary::before { transform: rotate(90deg); }
.chain-summary:hover { background: rgba(255,255,255,0.18); }
.chain-modes { font-size: 11px; color: rgba(255,255,255,0.5); font-weight: 400; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.chain-phases { margin-top: 12px; display: flex; flex-direction: column; gap: 12px; }

.chain-phase { border-radius: 10px; overflow: hidden; }
.chain-phase-header {
  display: flex; align-items: center; gap: 8px; padding: 8px 12px; font-size: 12px; font-weight: 600; flex-wrap: wrap;
}
.chain-phase-icon { font-size: 14px; }
.chain-phase-label { color: rgba(255,255,255,0.85); }
.chain-phase-translate { background: rgba(100,100,220,0.12); border: 1px solid rgba(100,100,220,0.2); }
.chain-phase-plan { background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.12); }
.chain-phase-respond { background: rgba(72,187,120,0.1); border: 1px solid rgba(72,187,120,0.2); }
.chain-plan-directive { padding: 6px 12px 10px; font-size: 12px; color: rgba(255,255,255,0.6); line-height: 1.5; white-space: pre-wrap; }

.chain-phase-summary, .chain-substep-summary {
  cursor: pointer; list-style: none;
  display: flex; align-items: center; gap: 8px;
  padding: 8px 12px; font-size: 12px; font-weight: 600; flex-wrap: wrap;
}
.chain-phase-summary::-webkit-details-marker,
.chain-substep-summary::-webkit-details-marker { display: none; }
.chain-phase-summary::before,
.chain-substep-summary::before {
  content: ">"; font-size: 8px; color: rgba(255,255,255,0.35);
  transition: transform 0.15s; display: inline-block;
}
details[open] > .chain-phase-summary::before,
details[open] > .chain-substep-summary::before { transform: rotate(90deg); }
.chain-phase-summary:hover, .chain-substep-summary:hover { background: rgba(255,255,255,0.05); }

.chain-substeps { display: flex; flex-direction: column; gap: 2px; padding: 0 8px 8px; }
.chain-substep { border-radius: 6px; background: rgba(255,255,255,0.04); }
.chain-substep:hover { background: rgba(255,255,255,0.07); }

.chain-dot {
  display: inline-block; width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0;
  border: 2px solid rgba(255,255,255,0.3);
}
.chain-dot-done    { background: rgba(72,187,120,0.8); border-color: rgba(72,187,120,0.4); }
.chain-dot-stopped { background: rgba(200,80,80,0.8); border-color: rgba(200,80,80,0.4); }
.chain-dot-pending { background: rgba(255,200,50,0.8); border-color: rgba(255,200,50,0.4); }
.chain-dot-skipped { background: rgba(160,160,160,0.6); border-color: rgba(160,160,160,0.3); }

.chain-step-mode {
  font-size: 11px; font-weight: 600; color: rgba(255,255,255,0.8);
  background: rgba(255,255,255,0.12); padding: 2px 8px; border-radius: 6px;
}
.chain-step-duration { font-size: 10px; color: rgba(255,255,255,0.45); }
.chain-model {
  font-size: 10px; font-family: 'SF Mono', 'Fira Code', monospace;
  color: rgba(255,255,255,0.4); margin-left: auto; white-space: nowrap;
  overflow: hidden; text-overflow: ellipsis; max-width: 150px;
}

.chain-step-body { padding: 10px 12px; border-top: 1px solid rgba(255,255,255,0.08); }
.chain-io-label {
  display: inline-block; font-size: 9px; font-weight: 700; letter-spacing: 0.5px;
  padding: 1px 6px; border-radius: 4px; margin-right: 8px; vertical-align: middle;
}
.chain-io-in  { background: rgba(100,220,255,0.2); color: rgba(100,220,255,0.9); }
.chain-io-out { background: rgba(72,187,120,0.2); color: rgba(72,187,120,0.9); }

.chain-step-input {
  font-size: 12px; color: rgba(255,255,255,0.8); line-height: 1.6;
  word-break: break-word; white-space: pre-wrap;
  font-family: 'SF Mono', 'Fira Code', monospace;
}
.chain-step-output {
  font-size: 12px; color: rgba(255,255,255,0.65); line-height: 1.6;
  margin-top: 8px; padding-top: 8px; border-top: 1px solid rgba(255,255,255,0.1);
  word-break: break-word; white-space: pre-wrap;
  font-family: 'SF Mono', 'Fira Code', monospace;
}
.chain-json { color: rgba(255,255,255,0.8); }

.tree-context-bar {
  display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
  padding: 6px 12px; margin-bottom: 6px;
  background: rgba(255,255,255,0.06); border-radius: 6px; font-size: 12px;
}
.tree-target-link {
  color: rgba(100,220,255,0.95); text-decoration: none;
  border-bottom: 1px solid rgba(100,220,255,0.3);
  font-weight: 600; font-size: 12px; transition: all 0.2s;
}
.tree-target-link:hover {
  border-bottom-color: rgba(100,220,255,0.8);
  text-shadow: 0 0 8px rgba(100,220,255,0.5);
}
.tree-target-name { color: rgba(255,255,255,0.8); font-weight: 600; font-size: 12px; }
.tree-directive {
  padding: 4px 12px 8px; font-size: 11px; color: rgba(255,255,255,0.55);
  line-height: 1.5; font-style: italic;
  border-left: 2px solid rgba(255,255,255,0.15); margin: 0 12px 8px;
}
.chain-step-counter {
  font-size: 10px; color: rgba(255,255,255,0.5); font-weight: 500;
  background: rgba(255,255,255,0.08); padding: 2px 8px; border-radius: 4px;
}
.chain-step-target {
  font-size: 10px; color: rgba(100,220,255,0.7); font-weight: 500;
  max-width: 150px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.chain-step-failed {
  font-size: 9px; font-weight: 700; color: rgba(200,80,80,0.9);
  background: rgba(200,80,80,0.15); padding: 1px 6px; border-radius: 4px; letter-spacing: 0.5px;
}
.chain-step-fail-reason {
  font-size: 10px; color: rgba(200,80,80,0.7); font-weight: 400;
  font-style: italic; max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.badge-step {
  background: rgba(255,255,255,0.12); color: rgba(255,255,255,0.7);
  font-family: 'SF Mono', 'Fira Code', monospace; font-size: 10px;
}
.badge-skipped { background: rgba(160,160,160,0.25); color: rgba(255,255,255,0.7); }
.chain-plan-summary-text {
  font-size: 11px; color: rgba(255,255,255,0.45); font-weight: 400;
  font-style: italic; overflow: hidden; text-overflow: ellipsis;
  white-space: nowrap; max-width: 300px;
}

.contrib-dropdown { margin-bottom: 12px; }
.contrib-summary {
  cursor: pointer; font-size: 13px; font-weight: 600;
  color: rgba(255,255,255,0.85); padding: 8px 14px;
  background: rgba(255,255,255,0.1); border-radius: 10px;
  border: 1px solid rgba(255,255,255,0.15);
  transition: all 0.2s; list-style: none;
  display: flex; align-items: center; gap: 6px;
}
.contrib-summary::-webkit-details-marker { display: none; }
.contrib-summary::before { content: ">"; font-size: 10px; transition: transform 0.2s; display: inline-block; }
details[open] .contrib-summary::before { transform: rotate(90deg); }
.contrib-summary:hover { background: rgba(255,255,255,0.18); }
.contrib-table-wrap { margin-top: 10px; overflow-x: auto; -webkit-overflow-scrolling: touch; }
.contrib-table { width: 100%; border-collapse: collapse; font-size: 13px; }
.contrib-table thead th {
  text-align: left; font-size: 11px; font-weight: 600; text-transform: uppercase;
  letter-spacing: 0.5px; color: rgba(255,255,255,0.55); padding: 6px 10px;
  border-bottom: 1px solid rgba(255,255,255,0.15);
}
.contrib-row td {
  padding: 7px 10px; border-bottom: 1px solid rgba(255,255,255,0.08);
  color: rgba(255,255,255,0.88); vertical-align: middle; white-space: nowrap;
}
.contrib-row:last-child td { border-bottom: none; }
.contrib-row a { color: white; text-decoration: none; border-bottom: 1px solid rgba(255,255,255,0.3); transition: all 0.2s; }
.contrib-row a:hover { border-bottom-color: white; text-shadow: 0 0 12px rgba(255,255,255,0.8); }
.contrib-time { font-size: 11px; color: rgba(255,255,255,0.5); }
.action-dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 6px; vertical-align: middle; }

.mini-badge {
  display: inline-flex; align-items: center; padding: 1px 7px; border-radius: 980px;
  font-size: 10px; font-weight: 700; letter-spacing: 0.2px; margin-right: 3px;
}
.mini-ai    { background: rgba(255,200,50,0.35); color: #fff; }
.mini-energy { background: rgba(100,220,255,0.3); color: #fff; }

.badge {
  display: inline-flex; align-items: center; padding: 3px 10px; border-radius: 980px;
  font-size: 11px; font-weight: 700; letter-spacing: 0.3px; border: 1px solid rgba(255,255,255,0.2);
}
.badge-done     { background: rgba(72,187,120,0.35); color: #fff; }
.badge-stopped  { background: rgba(200,80,80,0.35); color: #fff; }
.badge-pending  { background: rgba(255,200,50,0.3); color: #fff; }
.badge-duration { background: rgba(255,255,255,0.15); color: rgba(255,255,255,0.9); }
.badge-source   { background: rgba(100,100,210,0.3); color: #fff; }

.note-meta {
  padding-top: 12px; border-top: 1px solid rgba(255,255,255,0.2);
  font-size: 12px; color: rgba(255,255,255,0.85); line-height: 1.8;
  display: flex; flex-wrap: wrap; align-items: center; gap: 6px;
}
.meta-separator { color: rgba(255,255,255,0.5); }
.contribution-id {
  background: rgba(255,255,255,0.12); padding: 2px 6px; border-radius: 4px;
  font-size: 11px; font-family: 'SF Mono', 'Fira Code', monospace;
  color: rgba(255,255,255,0.6); border: 1px solid rgba(255,255,255,0.1);
}

.empty-state {
  position: relative; overflow: hidden;
  background: rgba(115,111,230,var(--glass-alpha)); backdrop-filter: blur(22px) saturate(140%);
  -webkit-backdrop-filter: blur(22px) saturate(140%);
  border-radius: 16px; padding: 60px 40px; text-align: center;
  box-shadow: 0 8px 32px rgba(0,0,0,0.12), inset 0 1px 0 rgba(255,255,255,0.25);
  border: 1px solid rgba(255,255,255,0.28); color: white;
}
.empty-state::before {
  content: ""; position: absolute; inset: -40%;
  background: radial-gradient(120% 60% at 0% 0%, rgba(255,255,255,0.35), transparent 60%);
  opacity: 0; transition: opacity 0.35s ease, transform 0.6s cubic-bezier(0.22,1,0.36,1); pointer-events: none;
}
.empty-state:hover::before { opacity: 1; transform: translateX(30%) translateY(10%); }
.empty-state-icon { font-size: 64px; margin-bottom: 16px; filter: drop-shadow(0 4px 12px rgba(0,0,0,0.2)); }
.empty-state-text { font-size: 20px; color: white; margin-bottom: 8px; font-weight: 600; text-shadow: 0 2px 8px rgba(0,0,0,0.2); }
.empty-state-subtext { font-size: 14px; color: rgba(255,255,255,0.85); }

@media (max-width: 640px) {
  body { padding: 16px; }
  .header { padding: 24px 20px; }
  .header h1 { font-size: 24px; }
  .message-count { display: block; margin-left: 0; margin-top: 8px; width: fit-content; }
  .note-card { padding: 20px 16px; }
  .back-nav { flex-direction: column; }
  .back-link { width: 100%; justify-content: center; }
  .empty-state { padding: 40px 24px; }
  .chat-header { flex-direction: column; align-items: flex-start; }
  .contrib-row td { font-size: 12px; padding: 5px 6px; }
  .session-pane-header { flex-direction: column; align-items: flex-start; gap: 6px; padding: 12px 16px; }
  .notes-list { padding: 12px; gap: 12px; }
  .chat-model { max-width: 140px; }
  .msg-text { font-size: 14px; }
  .chain-plan-directive { font-size: 11px; }
  .chain-step-target { max-width: 100px; }
  .chain-plan-summary-text { max-width: 160px; }
  .chain-step-fail-reason { max-width: 120px; }
}
@media (min-width: 641px) and (max-width: 1024px) {
  .container { max-width: 700px; }
}
  </style>
</head>
<body>
  <div class="container">
    <div class="back-nav">
      <a href="/api/v1/node/${nodeId}${tokenQS}" class="back-link">&lt;- Back to Node</a>
    </div>

    <div class="header">
      <h1>
        AI Chats for
        <a href="/api/v1/node/${nodeId}${tokenQS}">${esc(nodeName)}</a>
        ${allChats.length > 0 ? `<span class="message-count">${allChats.length}</span>` : ""}
      </h1>
      <div class="header-subtitle">
        AI sessions that targeted or modified this node.
      </div>
      <div class="header-path">${esc(nodePath)}</div>
    </div>

    ${
      sessionGroups.length
        ? renderedSections
        : `
    <div class="empty-state">
      <div class="empty-state-icon">AI</div>
      <div class="empty-state-text">No AI chats yet</div>
      <div class="empty-state-subtext">AI conversations involving this node will appear here</div>
    </div>`
    }
  </div>

  <script>
    var observer = new IntersectionObserver(function(entries) {
      entries.forEach(function(entry, index) {
        if (entry.isIntersecting) {
          setTimeout(function() { entry.target.classList.add('visible'); }, index * 50);
          observer.unobserve(entry.target);
        }
      });
    }, { root: null, rootMargin: '50px', threshold: 0.1 });
    document.querySelectorAll('.note-card').forEach(function(card) { observer.observe(card); });

    function toggleExpand(btn) {
      var text = btn.previousElementSibling;
      if (!text) return;
      var expanded = text.classList.toggle('expanded');
      btn.textContent = expanded ? 'Show less' : 'Show more';
    }
  </script>
</body>
</html>
`;
}

/* ================================================================== */
/* 2. renderNodeDetail                                                 */
/* ================================================================== */

export function renderNodeDetail({ node, nodeId, qs, parentName, rootUrl, isPublicAccess }) {
  const _nodeScripts = (node.metadata instanceof Map ? node.metadata?.get("scripts") : node.metadata?.scripts)?.list || [];
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="theme-color" content="#667eea">
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
  <title>${node.name} — Node</title>
  <style>
    /* =========================================================
   GLOBAL VARIABLES — matches root route
   ========================================================= */

:root {
  --glass-water-rgb: 115, 111, 230;
  --glass-alpha: 0.28;
  --glass-alpha-hover: 0.38;
}

/* =========================================================
   RESET & BASE
   ========================================================= */

* {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
  -webkit-tap-highlight-color: transparent;
}

body {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Roboto",
    "Oxygen", "Ubuntu", "Cantarell", sans-serif;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  min-height: 100vh;
  min-height: 100dvh;
  padding: 20px;
  color: #1a1a1a;
  position: relative;
  overflow-x: hidden;
  touch-action: manipulation;
}

/* =========================================================
   ANIMATED BACKGROUND
   ========================================================= */

body::before,
body::after {
  content: "";
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
  0%,
  100% {
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

/* =========================================================
   LAYOUT
   ========================================================= */

.container {
  max-width: 900px;
  margin: 0 auto;
  position: relative;
  z-index: 1;
}

/* =========================================================
   UNIFIED GLASS BUTTON SYSTEM
   ========================================================= */

.glass-btn,
button,
.action-button,
.back-link,
.versions-list a,
.children-list a,
button[type="submit"],
.primary-button,
.warning-button,
.danger-button {
  position: relative;
  overflow: hidden;

  padding: 10px 20px;
  border-radius: 980px;

  display: inline-flex;
  align-items: center;
  justify-content: center;
  white-space: nowrap;

  background: rgba(var(--glass-water-rgb), var(--glass-alpha));
  backdrop-filter: blur(22px) saturate(140%);
  -webkit-backdrop-filter: blur(22px) saturate(140%);

  color: white;
  text-decoration: none;
  font-family: inherit;

  font-size: 15px;
  font-weight: 600;
  letter-spacing: -0.2px;

  border: 1px solid rgba(255, 255, 255, 0.28);

  box-shadow:
    0 8px 24px rgba(0, 0, 0, 0.12),
    inset 0 1px 0 rgba(255, 255, 255, 0.25);

  cursor: pointer;

  transition:
    background 0.3s cubic-bezier(0.4, 0, 0.2, 1),
    transform 0.3s cubic-bezier(0.4, 0, 0.2, 1),
    box-shadow 0.3s ease;
}

/* Liquid light layer */
.glass-btn::before,
button::before,
.action-button::before,
.back-link::before,
.versions-list a::before,
.children-list a::before,
button[type="submit"]::before,
.primary-button::before,
.warning-button::before,
.danger-button::before {
  content: "";
  position: absolute;
  inset: -40%;

  background:
    radial-gradient(
      120% 60% at 0% 0%,
      rgba(255, 255, 255, 0.35),
      transparent 60%
    ),
    linear-gradient(
      120deg,
      transparent 30%,
      rgba(255, 255, 255, 0.25),
      transparent 70%
    );

  opacity: 0;
  transform: translateX(-30%) translateY(-10%);
  transition:
    opacity 0.35s ease,
    transform 0.6s cubic-bezier(0.22, 1, 0.36, 1);

  pointer-events: none;
}

/* Hover motion */
.glass-btn:hover,
button:hover,
.action-button:hover,
.back-link:hover,
.versions-list a:hover,
.children-list a:hover,
button[type="submit"]:hover,
.primary-button:hover,
.warning-button:hover,
.danger-button:hover {
  background: rgba(var(--glass-water-rgb), var(--glass-alpha-hover));
  transform: translateY(-2px);
}

.glass-btn:hover::before,
button:hover::before,
.action-button:hover::before,
.back-link:hover::before,
.versions-list a:hover::before,
.children-list a:hover::before,
button[type="submit"]:hover::before,
.primary-button:hover::before,
.warning-button:hover::before,
.danger-button:hover::before {
  opacity: 1;
  transform: translateX(30%) translateY(10%);
}

/* Active press */
.glass-btn:active,
button:active,
.primary-button:active,
.warning-button:active,
.danger-button:active {
  background: rgba(var(--glass-water-rgb), 0.45);
  transform: translateY(0);
}

/* Emphasis variants */
.primary-button {
  --glass-water-rgb: 72, 187, 178;
  --glass-alpha: 0.34;
  --glass-alpha-hover: 0.46;
  font-weight: 600;
}

.warning-button {
  --glass-water-rgb: 100, 116, 139;
  font-weight: 600;
}

.danger-button {
  --glass-water-rgb: 198, 40, 40;
  font-weight: 600;
}

/* =========================================================
   CONTENT CARDS - UPDATED TO MATCH ROOT ROUTE
   ========================================================= */

.header,
.hierarchy-section,
.versions-section,
.scripts-section,
.actions-section {
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

.header {
  animation-delay: 0.1s;
}

.versions-section {
  animation-delay: 0.15s;
}

.hierarchy-section {
  animation-delay: 0.2s;
}

.scripts-section {
  animation-delay: 0.25s;
}

.actions-section {
  animation-delay: 0.3s;
}

.header::before,
.hierarchy-section::before,
.versions-section::before,
.scripts-section::before,
.actions-section::before {
  content: "";
  position: absolute;
  inset: 0;
  border-radius: inherit;
  background: linear-gradient(
    180deg,
    rgba(255, 255, 255, 0.18),
    rgba(255, 255, 255, 0.05)
  );
  pointer-events: none;
}

.meta-card {
  background: rgba(255, 255, 255, 0.15);
  backdrop-filter: blur(22px) saturate(140%);
  -webkit-backdrop-filter: blur(22px) saturate(140%);
  border-radius: 12px;
  padding: 16px 20px;
  border: 1px solid rgba(255, 255, 255, 0.28);
  color: white;
}

.header h1 {
  font-size: 28px;
  font-weight: 600;
  letter-spacing: -0.5px;
  line-height: 1.3;
  margin-bottom: 8px;
  text-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
  color: white;
}

.hierarchy-section h2,
.versions-section h2,
.scripts-section h2,
.actions-section h3 {
  font-size: 18px;
  font-weight: 600;
  color: white;
  margin-bottom: 16px;
  letter-spacing: -0.3px;
  text-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
}

.hierarchy-section h3 {
  font-size: 16px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.9);
  margin: 24px 0 12px 0;
}

/* =========================================================
   NAV + META
   ========================================================= */

.back-nav {
  display: flex;
  gap: 12px;
  margin-bottom: 20px;
  flex-wrap: wrap;
  animation: fadeInUp 0.5s ease-out;
}

.node-id-container {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 12px;
  flex-wrap: wrap;
  padding: 10px 14px;
  background: rgba(255, 255, 255, 0.15);
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.2);
}

code {
  background: transparent;
  padding: 0;
  border-radius: 0;
  font-size: 13px;
  font-family: 'SF Mono', Monaco, 'Cascadia Code', monospace;
  color: white;
  word-break: break-all;
  flex: 1;
}

#copyNodeIdBtn {
  background: rgba(255, 255, 255, 0.2);
  border: 1px solid rgba(255, 255, 255, 0.3);
  cursor: pointer;
  padding: 6px 10px;
  border-radius: 6px;
  opacity: 1;
  font-size: 16px;
  transition: all 0.2s;
  flex-shrink: 0;
}

#copyNodeIdBtn:hover {
  background: rgba(255, 255, 255, 0.3);
  transform: scale(1.1);
}

#copyNodeIdBtn::before {
  display: none;
}

.meta-row {
  display: flex;
  gap: 24px;
  flex-wrap: wrap;
  padding-top: 12px;
  border-top: 1px solid rgba(255, 255, 255, 0.2);
}

.meta-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.meta-label {
  font-size: 12px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: rgba(255, 255, 255, 0.7);
}

.meta-value {
  font-size: 16px;
  font-weight: 600;
  color: white;
}

/* =========================================================
   LISTS
   ========================================================= */

.versions-list {
  list-style: none;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: 10px;
}

.versions-list li {
  margin: 0;
}

.versions-list a {
  display: block;
  padding: 14px 18px;
  text-align: center;
}

.children-list {
  list-style: none;
  margin-bottom: 20px;
}

.children-list li {
  margin: 0 0 8px 0;
}

.children-list a {
  display: block;
  padding: 12px 16px;
}

.hierarchy-section a {
  color: white;
  text-decoration: none;
  font-weight: 600;
  transition: opacity 0.2s;
}

.hierarchy-section a:hover {
  opacity: 0.8;
}

.hierarchy-section em {
  color: rgba(255, 255, 255, 0.7);
  font-style: normal;
}

.hierarchy-section > p {
  margin-bottom: 16px;
}

/* =========================================================
   SCRIPTS
   ========================================================= */

.scripts-list {
  list-style: none;
}

.scripts-list li {
  margin-bottom: 16px;
  padding: 16px;
  background: rgba(255, 255, 255, 0.1);
  border-radius: 10px;
  border: 1px solid rgba(255, 255, 255, 0.2);
}

.scripts-list li:last-child {
  margin-bottom: 0;
}

.scripts-list a {
  color: white;
  text-decoration: none;
  display: block;
}

.scripts-list a:hover {
  opacity: 0.9;
}

.scripts-list strong {
  display: block;
  margin-bottom: 8px;
  color: white;
  font-size: 15px;
}

.scripts-list pre {
  background: rgba(0, 0, 0, 0.3);
  color: #e0e0e0;
  padding: 14px;
  border-radius: 8px;
  overflow-x: auto;
  font-size: 13px;
  line-height: 1.5;
  font-family: 'SF Mono', Monaco, 'Cascadia Code', monospace;
  border: 1px solid rgba(255, 255, 255, 0.1);
}

.scripts-list em {
  color: rgba(255, 255, 255, 0.6);
  font-style: normal;
}

.scripts-section h2 a {
  color: white;
  text-decoration: none;
}

.scripts-section h2 a:hover {
  opacity: 0.8;
}

/* =========================================================
   FORMS
   ========================================================= */

.action-form {
  display: flex;
  gap: 10px;
  align-items: stretch;
  margin-top: 12px;
  flex-wrap: wrap;
}

.action-form input[type="text"] {
  flex: 1;
  min-width: 200px;
  padding: 12px 14px;
  font-size: 15px;
  border-radius: 10px;
  border: 2px solid rgba(255, 255, 255, 0.3);
  background: rgba(255, 255, 255, 0.15);
  color: white;
  font-family: inherit;
  font-weight: 500;
  transition: all 0.2s;
}

.action-form input[type="text"]::placeholder {
  color: rgba(255, 255, 255, 0.5);
}

.action-form input[type="text"]:focus {
  outline: none;
  border-color: rgba(255, 255, 255, 0.6);
  background: rgba(255, 255, 255, 0.25);
  box-shadow: 0 0 0 3px rgba(255, 255, 255, 0.15);
  transform: translateY(-2px);
}

/* =========================================================
   RESPONSIVE
   ========================================================= */

@media (max-width: 640px) {
  body {
    padding: 16px;
  }

  .container {
    max-width: 100%;
  }

  .header,
  .hierarchy-section,
  .versions-section,
  .scripts-section,
  .actions-section {
    padding: 20px;
  }

  .header h1 {
    font-size: 24px;
  }

  .back-nav {
    flex-direction: column;
  }

  .back-link {
    width: 100%;
    justify-content: center;
  }

  .meta-row {
    flex-direction: column;
    gap: 12px;
  }

  .versions-list {
    grid-template-columns: 1fr;
  }

  .action-form {
    flex-direction: column;
  }

  .action-form input[type="text"] {
    width: 100%;
    min-width: 0;
  }

  .action-form button {
    width: 100%;
  }

  code {
    font-size: 11px;
    max-width: 180px;
    overflow: hidden;
    text-overflow: ellipsis;
  }
}

@media (min-width: 641px) and (max-width: 1024px) {
  .container {
    max-width: 700px;
  }

  .versions-list {
    grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
  }
}

html, body {
  background: #736fe6;
  margin: 0;
  padding: 0;
}
  </style>
</head>
<body>
  <div class="container">
    <!-- Back Navigation -->
    <div class="back-nav">
      <a href="${rootUrl}" class="back-link">
        ← Back to Tree
      </a>
      <a href="/api/v1/node/${nodeId}/chats${qs}" class="back-link">
        AI Chats
      </a>
    </div>

    <!-- Header -->
    <div class="header">
      <h1
        id="nodeNameDisplay"
        ${!isPublicAccess ? `style="cursor:pointer;" title="Click to rename" onclick="document.getElementById('nodeNameDisplay').style.display='none';document.getElementById('renameForm').style.display='flex';"` : ""}
      >${node.name}</h1>
      ${!isPublicAccess ? `<form
        id="renameForm"
        method="POST"
        action="/api/v1/node/${nodeId}/${0}/editName${qs}"
        style="display:none;align-items:center;gap:8px;margin-bottom:12px;"
      >
        <input
          type="text"
          name="name"
          value="${node.name.replace(/"/g, '&quot;')}"
          required
          style="flex:1;font-size:20px;font-weight:700;padding:8px 12px;border-radius:12px;border:1px solid rgba(255,255,255,0.2);background:rgba(255,255,255,0.1);color:white;"
        />
        <button type="submit" class="primary-button" style="padding:8px 16px;">Save</button>
        <button
          type="button"
          class="warning-button"
          style="padding:8px 16px;"
          onclick="document.getElementById('renameForm').style.display='none';document.getElementById('nodeNameDisplay').style.display='';"
        >Cancel</button>
      </form>` : ""}

      <div class="node-id-container">
        <code id="nodeIdCode">${node._id}</code>
        <button id="copyNodeIdBtn" title="Copy ID">📋</button>
      </div>

      <div class="meta-row">
        <div class="meta-item">
          <div class="meta-label">Type</div>
          <div class="meta-value">${node.type ?? "None"}</div>
        </div>
        <div class="meta-item">
          <div class="meta-label">Status</div>
          <div class="meta-value">${node.status || "active"}</div>
        </div>
      </div>
    </div>

    ${!isPublicAccess ? `<!-- Edit Type -->
    <div class="hierarchy-section">
      <h2>Node Type</h2>
      <form
        method="POST"
        action="/api/v1/node/${nodeId}/editType${qs}"
        class="action-form"
      >
        <select name="type" style="flex:1;padding:10px 14px;border-radius:12px;border:1px solid rgba(255,255,255,0.2);background:rgba(255,255,255,0.1);color:white;font-size:14px;">
          <option value="" ${!node.type ? "selected" : ""}>None</option>
          <option value="goal" ${node.type === "goal" ? "selected" : ""}>goal</option>
          <option value="plan" ${node.type === "plan" ? "selected" : ""}>plan</option>
          <option value="task" ${node.type === "task" ? "selected" : ""}>task</option>
          <option value="knowledge" ${node.type === "knowledge" ? "selected" : ""}>knowledge</option>
          <option value="resource" ${node.type === "resource" ? "selected" : ""}>resource</option>
          <option value="identity" ${node.type === "identity" ? "selected" : ""}>identity</option>
        </select>
        <input
          type="text"
          name="customType"
          placeholder="or custom type..."
          style="flex:1;"
        />
        <button type="submit" class="primary-button">Set Type</button>
      </form>
    </div>` : ""}

    <!-- Versions Section (prestige extension) -->
    ${(() => {
      const meta = node.metadata instanceof Map ? Object.fromEntries(node.metadata) : (node.metadata || {});
      const prestige = meta.prestige || { current: 0, history: [] };
      const history = prestige.history || [];
      return `<div class="versions-section">
        <h2>Versions</h2>
        <ul class="versions-list">
          ${[...Array(prestige.current + 1)].map((_, i) =>
            `<li><a href="/api/v1/node/${nodeId}/${i}${qs}">Version ${i}${i === prestige.current ? " (current)" : ""}</a></li>`
          ).reverse().join("")}
        </ul>
        ${!isPublicAccess ? `<form
          method="POST"
          action="/api/v1/node/${nodeId}/prestige${qs}"
          onsubmit="return confirm('This will complete the current version and create a new prestige level. Continue?')"
          style="margin-top: 16px;">
          <button type="submit" class="primary-button">Add New Version</button>
        </form>` : ""}
      </div>`;
    })()}

    <!-- Parent Section -->
    <div class="hierarchy-section">
      <h2>Parent</h2>
      ${
        node.parent
          ? `<a href="/api/v1/node/${node.parent}${qs}" style="display:block;padding:12px 16px;margin-bottom:16px;">${parentName}</a>`
          : `<p style="margin-bottom:16px;"><em>None (This is a root node)</em></p>`
      }

      ${!isPublicAccess ? `<h3>Change Parent</h3>
      <form
        method="POST"
        action="/api/v1/node/${nodeId}/updateParent${qs}"
        class="action-form"
      >
        <input
          type="text"
          name="newParentId"
          placeholder="New parent node ID"
          required
        />
        <button type="submit" class="warning-button">
          Move Node
        </button>
      </form>` : ""}
    </div>

    <!-- Children Section -->
    <div class="hierarchy-section">
      <h2>Children</h2>
      <ul class="children-list">
        ${
          node.children && node.children.length
            ? node.children
                .map(
                  (c) =>
                    `<li><a href="/api/v1/node/${c._id}${qs}">${c.name}</a></li>`,
                )
                .join("")
            : `<li><em>No children yet</em></li>`
        }
      </ul>

      <h3>Add Child</h3>
      <form
        method="POST"
        action="/api/v1/node/${nodeId}/createChild${qs}"
        class="action-form"
      >
        <input
          type="text"
          name="name"
          placeholder="Child name"
          required
        />
        <button type="submit" class="primary-button">
          Create Child
        </button>
      </form>
    </div>

    <!-- Scripts Section -->
    <div class="scripts-section">
      <h2><a href="/api/v1/node/${node._id}/scripts/help${qs}">Scripts</a></h2>
      <form
        method="POST"
        action="/api/v1/node/${nodeId}/script/create${qs}"
        style="display:flex;gap:8px;align-items:center;margin-bottom:16px;"
      >
        <input
          type="text"
          name="name"
          placeholder="New script name"
          required
          style="
            padding:12px 16px;
            border-radius:10px;
            border:1px solid rgba(255,255,255,0.3);
            background:rgba(255,255,255,0.2);
            color:white;
            font-size:15px;
            min-width:200px;
            flex:1;
          "
        />
        <button
          type="submit"
          class="primary-button"
          title="Create script"
          style="padding:10px 18px;font-size:16px;"
        >
          ➕
        </button>
      </form>
      <ul class="scripts-list">
        ${
          _nodeScripts.length
            ? _nodeScripts
                .map(
                  (s) => `
            <a href="/api/v1/node/${node._id}/script/${s._id}${qs}">
              <li>
                <strong>${s.name}</strong>
                <pre>${s.script}</pre>
              </li>
            </a>`,
                )
                .join("")
            : `<li><em>No scripts defined</em></li>`
        }
      </ul>
    </div>

    ${!isPublicAccess ? `<!-- Delete Section -->
    <div class="actions-section">
      <h3>Delete</h3>
      <form
        method="POST"
        action="/api/v1/node/${nodeId}/delete${qs}"
        onsubmit="return confirm('Delete this node and its branch? This can be revived later.')"
      >
        <button type="submit" class="danger-button">
          Delete Node
        </button>
      </form>
    </div>` : ""}
  </div>

  <script>
    // Copy ID functionality
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
`;
}

/* ================================================================== */
/* 3. renderVersionDetail                                              */
/* ================================================================== */

export function renderVersionDetail({
  node,
  nodeId,
  version,
  data,
  qs,
  backUrl,
  backTreeUrl,
  createdDate,
  scheduleHtml,
  reeffectTime,
  showPrestige,
  ALL_STATUSES,
  STATUS_LABELS,
}) {
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="theme-color" content="#667eea">
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
  <title>${node.name} v${version}</title>
  <style>
    /* =========================================================
   GLOBAL VARIABLES — matches root route
   ========================================================= */

:root {
  --glass-water-rgb: 115, 111, 230;
  --glass-alpha: 0.28;
  --glass-alpha-hover: 0.38;
}

/* =========================================================
   RESET & BASE
   ========================================================= */

* {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
  -webkit-tap-highlight-color: transparent;
}

body {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Roboto",
    "Oxygen", "Ubuntu", "Cantarell", sans-serif;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  min-height: 100vh;
  min-height: 100dvh;
  padding: 20px;
  color: #1a1a1a;
  position: relative;
  overflow-x: hidden;
  touch-action: manipulation;
}

/* =========================================================
   ANIMATED BACKGROUND
   ========================================================= */

body::before,
body::after {
  content: "";
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
  0%,
  100% {
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

/* =========================================================
   LAYOUT
   ========================================================= */

.container {
  max-width: 900px;
  margin: 0 auto;
  position: relative;
  z-index: 1;
}

/* =========================================================
   UNIFIED GLASS BUTTON SYSTEM
   ========================================================= */

.glass-btn,
button,
.action-button,
.back-link,
.nav-links a,
.meta-value button,
.contributors-list button,
button[type="submit"],
.status-button,
.primary-button {
  position: relative;
  overflow: hidden;

  padding: 10px 20px;
  border-radius: 980px;

  display: inline-flex;
  align-items: center;
  justify-content: center;
  white-space: nowrap;

  background: rgba(var(--glass-water-rgb), var(--glass-alpha));
  backdrop-filter: blur(22px) saturate(140%);
  -webkit-backdrop-filter: blur(22px) saturate(140%);

  color: white;
  text-decoration: none;
  font-family: inherit;

  font-size: 15px;
  font-weight: 600;
  letter-spacing: -0.2px;

  border: 1px solid rgba(255, 255, 255, 0.28);

  box-shadow:
    0 8px 24px rgba(0, 0, 0, 0.12),
    inset 0 1px 0 rgba(255, 255, 255, 0.25);

  cursor: pointer;

  transition:
    background 0.3s cubic-bezier(0.4, 0, 0.2, 1),
    transform 0.3s cubic-bezier(0.4, 0, 0.2, 1),
    box-shadow 0.3s ease;
}

/* Liquid light layer */
.glass-btn::before,
button::before,
.action-button::before,
.back-link::before,
.nav-links a::before,
.meta-value button::before,
.contributors-list button::before,
button[type="submit"]::before,
.status-button::before,
.primary-button::before {
  content: "";
  position: absolute;
  inset: -40%;

  background:
    radial-gradient(
      120% 60% at 0% 0%,
      rgba(255, 255, 255, 0.35),
      transparent 60%
    ),
    linear-gradient(
      120deg,
      transparent 30%,
      rgba(255, 255, 255, 0.25),
      transparent 70%
    );

  opacity: 0;
  transform: translateX(-30%) translateY(-10%);
  transition:
    opacity 0.35s ease,
    transform 0.6s cubic-bezier(0.22, 1, 0.36, 1);

  pointer-events: none;
}

/* Hover motion */
.glass-btn:hover,
button:hover,
.action-button:hover,
.back-link:hover,
.nav-links a:hover,
.meta-value button:hover,
.contributors-list button:hover,
button[type="submit"]:hover,
.status-button:hover,
.primary-button:hover {
  background: rgba(var(--glass-water-rgb), var(--glass-alpha-hover));
  transform: translateY(-2px);
}

.glass-btn:hover::before,
button:hover::before,
.action-button:hover::before,
.back-link:hover::before,
.nav-links a:hover::before,
.meta-value button:hover::before,
.contributors-list button:hover::before,
button[type="submit"]:hover::before,
.status-button:hover::before,
.primary-button:hover::before {
  opacity: 1;
  transform: translateX(30%) translateY(10%);
}

/* Active press */
.glass-btn:active,
button:active,
.status-button:active,
.primary-button:active {
  background: rgba(var(--glass-water-rgb), 0.45);
  transform: translateY(0);
}

/* Emphasis variants */
.primary-button {
  --glass-water-rgb: 72, 187, 178;
  --glass-alpha: 0.34;
  --glass-alpha-hover: 0.46;
  font-weight: 600;
}

.legacy-btn {
  opacity: 0.85;
}
.legacy-btn:hover {
  opacity: 1;
}

/* =========================================================
   CONTENT CARDS - UPDATED TO MATCH ROOT ROUTE
   ========================================================= */

.header,
.nav-section,
.actions-section {
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

.header {
  animation-delay: 0.1s;
}

.nav-section {
  animation-delay: 0.15s;
}

.actions-section {
  animation-delay: 0.2s;
}

.header::before,
.nav-section::before,
.actions-section::before {
  content: "";
  position: absolute;
  inset: 0;
  border-radius: inherit;
  background: linear-gradient(
    180deg,
    rgba(255, 255, 255, 0.18),
    rgba(255, 255, 255, 0.05)
  );
  pointer-events: none;
}

.meta-card {
  background: rgba(var(--glass-water-rgb), var(--glass-alpha));
  backdrop-filter: blur(22px) saturate(140%);
  -webkit-backdrop-filter: blur(22px) saturate(140%);
  border-radius: 12px;
  padding: 16px 20px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.12),
    inset 0 1px 0 rgba(255, 255, 255, 0.25);
  border: 1px solid rgba(255, 255, 255, 0.28);
  color: white;
  animation: fadeInUp 0.6s ease-out;
  animation-fill-mode: both;
  position: relative;
  overflow: hidden;
}

.meta-card::before {
  content: "";
  position: absolute;
  inset: 0;
  border-radius: inherit;
  background: linear-gradient(
    180deg,
    rgba(255, 255, 255, 0.18),
    rgba(255, 255, 255, 0.05)
  );
  pointer-events: none;
}

/* Stagger meta-card animations */
.meta-card:nth-child(1) { animation-delay: 0.2s; }
.meta-card:nth-child(2) { animation-delay: 0.25s; }

.header h1 {
  font-size: 28px;
  font-weight: 600;
  letter-spacing: -0.5px;
  line-height: 1.3;
  margin-bottom: 8px;
  text-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
}

.header h1 a {
  color: white;
  text-decoration: none;
  transition: opacity 0.2s;
}

.header h1 a:hover {
  opacity: 0.8;
}

.nav-section h2,
.actions-section h3 {
  font-size: 18px;
  font-weight: 600;
  color: white;
  margin-bottom: 16px;
  letter-spacing: -0.3px;
  text-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
}

/* =========================================================
   NAV + META
   ========================================================= */

.back-nav {
  display: flex;
  gap: 12px;
  margin-bottom: 20px;
  flex-wrap: wrap;
  animation: fadeInUp 0.5s ease-out;
}

.version-badge {
  display: inline-block;
  padding: 6px 14px;
  background: rgba(16, 185, 129, 0.25);
  backdrop-filter: blur(10px);
  color: white;
  border-radius: 20px;
  font-size: 14px;
  font-weight: 600;
  margin-top: 8px;
  border: 1px solid rgba(16, 185, 129, 0.4);
  position: relative;
  overflow: hidden;
  box-shadow: 0 4px 12px rgba(16, 185, 129, 0.15),
    inset 0 1px 0 rgba(255, 255, 255, 0.3);
}

/* Version badge colors matching status */
.version-badge.version-status-active {
  background: rgba(16, 185, 129, 0.25);
  border: 1px solid rgba(16, 185, 129, 0.4);
  box-shadow: 0 4px 12px rgba(16, 185, 129, 0.15),
    inset 0 1px 0 rgba(255, 255, 255, 0.3);
}

.version-badge.version-status-completed {
  background: rgba(139, 92, 246, 0.25);
  border: 1px solid rgba(139, 92, 246, 0.4);
  box-shadow: 0 4px 12px rgba(139, 92, 246, 0.15),
    inset 0 1px 0 rgba(255, 255, 255, 0.3);
}

.version-badge.version-status-trimmed {
  background: rgba(220, 38, 38, 0.25);
  border: 1px solid rgba(220, 38, 38, 0.4);
  box-shadow: 0 4px 12px rgba(220, 38, 38, 0.15),
    inset 0 1px 0 rgba(255, 255, 255, 0.3);
}

.version-badge::after {
  content: "";
  position: absolute;
  inset: 0;

  background: linear-gradient(
    100deg,
    transparent 40%,
    rgba(255, 255, 255, 0.5),
    transparent 60%
  );

  opacity: 0;
  transform: translateX(-100%);
  transition: transform 0.8s ease, opacity 0.3s ease;

  animation: openAppHoverShimmerClone 1.6s ease forwards;
  animation-delay: 0.5s;

  pointer-events: none;
}

@keyframes openAppHoverShimmerClone {
  0% {
    opacity: 0;
    transform: translateX(-100%);
  }

  100% {
    opacity: 1;
    transform: translateX(100%);
  }
}

.created-date {
  font-size: 13px;
  color: rgba(255, 255, 255, 0.7);
  margin-top: 10px;
  font-weight: 500;
}

.node-id-container {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 12px;
  flex-wrap: wrap;
  padding: 10px 14px;
  background: rgba(255, 255, 255, 0.15);
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.2);
  width: 100%;
}

code {
  background: transparent;
  padding: 0;
  border-radius: 0;
  font-size: 13px;
  font-family: 'SF Mono', Monaco, 'Cascadia Code', monospace;
  color: white;
  word-break: break-all;
  flex: 1;
  min-width: 0;
  overflow-wrap: break-word;
}

#copyNodeIdBtn {
  background: rgba(255, 255, 255, 0.2);
  border: 1px solid rgba(255, 255, 255, 0.3);
  cursor: pointer;
  padding: 6px 10px;
  border-radius: 6px;
  opacity: 1;
  font-size: 16px;
  transition: all 0.2s;
  flex-shrink: 0;
}

#copyNodeIdBtn:hover {
  background: rgba(255, 255, 255, 0.3);
  transform: scale(1.1);
}

#copyNodeIdBtn::before {
  display: none;
}

.meta-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
  gap: 16px;
  margin-bottom: 24px;
}

.meta-label {
  font-size: 12px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: rgba(255, 255, 255, 0.7);
  margin-bottom: 6px;
}

.meta-value {
  font-size: 15px;
  font-weight: 600;
  color: white;
  word-break: break-word;
  overflow-wrap: break-word;
}

.status-badge {
  display: inline-block;
  padding: 6px 12px;
  border-radius: 6px;
  font-size: 13px;
  font-weight: 600;
  text-transform: capitalize;
  background: rgba(255, 255, 255, 0.25);
  color: white;
  border: 1px solid rgba(255, 255, 255, 0.3);
}

/* Official status colors with glass effect - UPDATED COLORS */
.status-badge.status-active {
  background: rgba(16, 185, 129, 0.35);
  border: 1px solid rgba(16, 185, 129, 0.5);
  backdrop-filter: blur(10px);
  box-shadow: 0 0 12px rgba(16, 185, 129, 0.2);
}

.status-badge.status-completed {
  background: rgba(139, 92, 246, 0.35);
  border: 1px solid rgba(139, 92, 246, 0.5);
  backdrop-filter: blur(10px);
  box-shadow: 0 0 12px rgba(139, 92, 246, 0.2);
}

.status-badge.status-trimmed {
  background: rgba(220, 38, 38, 0.35);
  border: 1px solid rgba(220, 38, 38, 0.5);
  backdrop-filter: blur(10px);
  box-shadow: 0 0 12px rgba(220, 38, 38, 0.2);
}

.nav-links {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 12px;
}

.nav-links a {
  padding: 14px 18px;
  font-size: 15px;
  text-align: center;
}

/* =========================================================
   STATUS CARD WITH BUTTONS - UPDATED COLORS
   ========================================================= */

.status-controls {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  margin-top: 12px;
}

.status-controls button {
  padding: 8px 16px;
  font-size: 13px;
  position: relative;
}

/* Faint glass colors for status buttons - UPDATED */
.status-controls button[value="active"] {
  --glass-water-rgb: 16, 185, 129; /* green */
  --glass-alpha: 0.15;
  --glass-alpha-hover: 0.25;
}

.status-controls button[value="completed"] {
  --glass-water-rgb: 139, 92, 246; /* purple */
  --glass-alpha: 0.15;
  --glass-alpha-hover: 0.25;
}

.status-controls button[value="trimmed"] {
  --glass-water-rgb: 220, 38, 38; /* red */
  --glass-alpha: 0.15;
  --glass-alpha-hover: 0.25;
}

/* =========================================================
   SCHEDULE CARD
   ========================================================= */

.schedule-info {
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: 100%;
}

.schedule-row {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  width: 100%;
}

.schedule-text {
  flex: 1;
  min-width: 0;
  overflow: hidden;
}

.schedule-text .meta-value {
  word-break: break-word;
  overflow-wrap: break-word;
}

.repeat-text {
  font-size: 13px;
  color: rgba(255, 255, 255, 0.8);
  margin-top: 6px;
}

#editScheduleBtn {
  flex-shrink: 0;
}

/* =========================================================
   ACTIONS & FORMS
   ========================================================= */

.action-form {
  margin-bottom: 24px;
}

.action-form:last-child {
  margin-bottom: 0;
}

.button-group {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
}

button[type="submit"],
.status-button {
  padding: 12px 20px;
  font-size: 14px;
}

/* =========================================================
   MODAL
   ========================================================= */

#scheduleModal {
  display: none;
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  backdrop-filter: blur(8px);
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

#scheduleModal > div {
  background: rgba(var(--glass-water-rgb), var(--glass-alpha));
  backdrop-filter: blur(22px) saturate(140%);
  -webkit-backdrop-filter: blur(22px) saturate(140%);
  padding: 28px;
  border-radius: 16px;
  width: 320px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2),
    inset 0 1px 0 rgba(255, 255, 255, 0.25);
  border: 1px solid rgba(255, 255, 255, 0.28);
  position: relative;
  overflow: hidden;
}

#scheduleModal > div::before {
  content: "";
  position: absolute;
  inset: 0;
  border-radius: inherit;
  background: linear-gradient(
    180deg,
    rgba(255, 255, 255, 0.18),
    rgba(255, 255, 255, 0.05)
  );
  pointer-events: none;
}

#scheduleModal label {
  display: block;
  margin-bottom: 12px;
  color: white;
  font-weight: 600;
  font-size: 14px;
  letter-spacing: -0.2px;
  text-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
  position: relative;
}

#scheduleModal input {
  width: 100%;
  margin-top: 6px;
  padding: 12px 14px;
  border-radius: 10px;
  border: 2px solid rgba(255, 255, 255, 0.3);
  background: rgba(255, 255, 255, 0.15);
  font-size: 15px;
  font-family: inherit;
  font-weight: 500;
  transition: all 0.2s;
  color: white;
  position: relative;
}

#scheduleModal input::placeholder {
  color: rgba(255, 255, 255, 0.5);
}

#scheduleModal input:focus {
  outline: none;
  border-color: rgba(255, 255, 255, 0.6);
  background: rgba(255, 255, 255, 0.25);
  box-shadow: 0 0 0 3px rgba(255, 255, 255, 0.15);
  transform: translateY(-2px);
}

#scheduleModal button {
  padding: 10px 18px;
  border-radius: 980px;
  font-weight: 600;
  font-size: 14px;
  cursor: pointer;
  font-family: inherit;
  transition: all 0.2s;
  border: 1px solid rgba(255, 255, 255, 0.28);
  position: relative;
}

#scheduleModal button[type="button"] {
  background: rgba(255, 255, 255, 0.15);
  color: white;
  border: 1px solid rgba(255, 255, 255, 0.28) !important;
  box-shadow: none !important;
}

#scheduleModal button[type="button"]:hover {
  background: rgba(255, 255, 255, 0.25);
}

#scheduleModal button[type="button"]::before {
  display: none;
}

#scheduleModal > div > form > div {
  display: flex;
  gap: 10px;
  justify-content: flex-end;
  margin-top: 16px;
}

/* =========================================================
   RESPONSIVE
   ========================================================= */

@media (max-width: 640px) {
  body {
    padding: 16px;
  }

  .container {
    max-width: 100%;
  }

  .header,
  .nav-section,
  .actions-section {
    padding: 20px;
  }

  .header h1 {
    font-size: 24px;
  }

  .back-nav {
    flex-direction: column;
  }

  .back-link {
    width: 100%;
    justify-content: center;
  }

  .meta-grid {
    grid-template-columns: 1fr;
    gap: 12px;
  }

  .meta-card {
    padding: 14px 16px;
  }

  .nav-links {
    grid-template-columns: 1fr;
  }

  .button-group {
    flex-direction: column;
  }

  button,
  .status-button,
  .primary-button {
    width: 100%;
  }

  .status-controls {
    flex-direction: column;
    align-items: stretch;
  }

  .status-controls button {
    width: 100%;
  }

  code {
    font-size: 12px;
    word-break: break-all;
  }

  .schedule-row {
    flex-direction: column;
    align-items: stretch;
    gap: 8px;
  }

  #editScheduleBtn {
    width: 100%;
    justify-content: center;
  }

  #scheduleModal > div {
    width: calc(100% - 40px);
    max-width: 320px;
  }
}

@media (min-width: 641px) and (max-width: 1024px) {
  .container {
    max-width: 700px;
  }

  .meta-grid {
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  }
}

html, body {
  background: #736fe6;
  margin: 0;
  padding: 0;
}
  </style>
</head>
<body>
  <div class="container">
    <!-- Back Navigation -->
    <div class="back-nav">
      <a href="${backTreeUrl}" class="back-link">
        ← Back to Tree
      </a>
      <a href="${backUrl}" class="back-link">
        View All Versions
      </a>
    </div>

    <!-- Header -->
    <div class="header">
      <h1
        id="nodeNameDisplay"
        style="cursor:pointer;"
        title="Click to rename"
        onclick="document.getElementById('nodeNameDisplay').style.display='none';document.getElementById('renameForm').style.display='flex';"
      >${node.name}</h1>
      <form
        id="renameForm"
        method="POST"
        action="/api/v1/node/${nodeId}/${version}/editName${qs}"
        style="display:none;align-items:center;gap:8px;margin-bottom:12px;"
      >
        <input
          type="text"
          name="name"
          value="${node.name.replace(/"/g, '&quot;')}"
          required
          style="flex:1;font-size:20px;font-weight:700;padding:8px 12px;border-radius:12px;border:1px solid rgba(255,255,255,0.2);background:rgba(255,255,255,0.1);color:white;"
        />
        <button type="submit" class="primary-button" style="padding:8px 16px;">Save</button>
        <button
          type="button"
          class="warning-button"
          style="padding:8px 16px;"
          onclick="document.getElementById('renameForm').style.display='none';document.getElementById('nodeNameDisplay').style.display='';"
        >Cancel</button>
      </form>

      <div class="meta-row" style="margin-top:4px;">
        <div class="meta-item">
          <div class="meta-label">Type</div>
          <div class="meta-value">${node.type ?? "None"}</div>
        </div>
      </div>

      <span class="version-badge version-status-${data.status}">Version ${version}</span>

      <div class="created-date">Created: ${createdDate}</div>

      <div class="node-id-container">
        <code id="nodeIdCode">${node._id}</code>
        <button id="copyNodeIdBtn" title="Copy ID">📋</button>
      </div>
    </div>

    <!-- Navigation Links -->
    <div class="nav-section">
      <h2>Quick Access</h2>
      <div class="nav-links">
        <a href="/api/v1/node/${nodeId}/${version}/notes${qs}">Notes</a>
        <a href="/api/v1/node/${nodeId}/${version}/values${qs}">Values / Goals</a>
        <a href="/api/v1/node/${nodeId}/${version}/contributions${qs}">Contributions</a>
        <a href="/api/v1/node/${nodeId}/${version}/transactions${qs}">Transactions</a>
        <a href="/api/v1/node/${nodeId}/chats${qs}">AI Chats</a>
      </div>
    </div>

    <!-- Metadata Grid -->
    <div class="meta-grid">
      <!-- Status Card with Controls -->
      <div class="meta-card">
        <div class="meta-label">Status</div>
        <div class="meta-value">
          <span class="status-badge status-${data.status}">${data.status}</span>
        </div>
        <form
          method="POST"
          action="/api/v1/node/${nodeId}/${version}/editStatus${qs}"
          onsubmit="return confirm('This will apply to all children. Is that ok?')"
          class="status-controls"
        >
          <input type="hidden" name="isInherited" value="true" />
          ${ALL_STATUSES.filter((s) => s !== data.status)
            .map(
              (s) => `
            <button type="submit" name="status" value="${s}" class="status-button">
              ${STATUS_LABELS[s]}
            </button>
          `,
            )
            .join("")}
        </form>
      </div>

      <!-- Schedule + Repeat Hours Card -->
      <div class="meta-card">
        <div class="meta-label">Schedule</div>
        <div class="schedule-info">
          <div class="schedule-row">
            <div class="schedule-text">
              <div class="meta-value">${scheduleHtml}</div>
              <div class="repeat-text">Repeat: ${reeffectTime} hours</div>
            </div>
            <button id="editScheduleBtn" style="padding:8px 12px;">✏️</button>
          </div>
        </div>
      </div>
    </div>

    ${
      showPrestige
        ? `
    <!-- Version Control Section -->
    <div class="actions-section">
      <h3>Version Control</h3>
      <form
        method="POST"
        action="/api/v1/node/${nodeId}/${version}/prestige${qs}"
        onsubmit="return confirm('This will complete the current version and create a new prestige level. Continue?')"
        class="action-form"
      >
        <button type="submit" class="primary-button">
          Add New Version
        </button>
      </form>
    </div>
    `
        : ""
    }
  </div>

  <!-- Schedule Modal -->
  <div id="scheduleModal">
    <div>
      <form
        method="POST"
        action="/api/v1/node/${nodeId}/${version}/editSchedule${qs}"
      >
        <label>
          TIME
          <input
            type="datetime-local"
            name="newSchedule"
            value="${
              data.schedule
                ? new Date(data.schedule).toISOString().slice(0, 16)
                : ""
            }"
          />
        </label>

        <label>
          REPEAT HOURS
          <input
            type="number"
            name="reeffectTime"
            min="0"
            value="${data.reeffectTime ?? 0}"
          />
        </label>

        <div style="display:flex;gap:10px;justify-content:flex-end;">
          <button type="button" id="cancelSchedule">Cancel</button>
          <button type="submit" class="primary-button">Save</button>
        </div>
      </form>
    </div>
  </div>

  <script>
    // Copy ID functionality
    const btn = document.getElementById("copyNodeIdBtn");
    const code = document.getElementById("nodeIdCode");

    btn.addEventListener("click", () => {
      navigator.clipboard.writeText(code.textContent).then(() => {
        btn.textContent = "✔️";
        setTimeout(() => (btn.textContent = "📋"), 900);
      });
    });

    // Schedule modal
    const editBtn = document.getElementById("editScheduleBtn");
    const modal = document.getElementById("scheduleModal");
    const cancelBtn = document.getElementById("cancelSchedule");

    if (editBtn) {
      editBtn.onclick = () => {
        modal.style.display = "flex";
      };
    }

    if (cancelBtn) {
      cancelBtn.onclick = () => {
        modal.style.display = "none";
      };
    }
  </script>
</body>
</html>
`;
}

/* ================================================================== */
/* 4. renderScriptDetail                                               */
/* ================================================================== */

export function renderScriptDetail({
  nodeId,
  script,
  contributions,
  qsWithQ,
}) {
  const editHistory = contributions.filter((c) => c.type === "edit");
  const executionHistory = contributions.filter((c) => c.type === "execute");

  const editHistoryHtml = editHistory.length
    ? editHistory
        .map(
          (c, i) => `
<li class="history-item">
  <div class="history-header">
    <div class="history-title">
      <span class="edit-number">Edit ${editHistory.length - i}</span>
      ${c.scriptName ? `<span class="script-name">${c.scriptName}</span>` : ""}
      ${i === 0 ? `<span class="current-badge">Current</span>` : ""}
    </div>
    <div class="history-meta">
      <span class="version-badge">v${c.nodeVersion}</span>
      <span class="timestamp">${new Date(c.createdAt).toLocaleString()}</span>
    </div>
  </div>

  ${
    c.contents
      ? `
  <details>
    <summary>
      <span class="summary-icon">▶</span>
      View code
    </summary>
    <pre class="history-code">${c.contents}</pre>
  </details>`
      : `<div class="empty-history-item">Empty script</div>`
  }
</li>
`,
        )
        .join("")
    : `<li class="empty-history">No edit history yet</li>`;

  const executionHistoryHtml = executionHistory.length
    ? executionHistory
        .map(
          (c, i) => `
<li class="history-item ${c.success ? "success" : "failure"}">
  <div class="history-header">
    <div class="history-title">
      <span class="edit-number">Run ${executionHistory.length - i}</span>
      ${c.scriptName ? `<span class="script-name">${c.scriptName}</span>` : ""}
      ${
        c.success
          ? `<span class="current-badge success-badge">Success</span>`
          : `<span class="current-badge failure-badge">Failed</span>`
      }
    </div>
    <div class="history-meta">
      <span class="version-badge">v${c.nodeVersion}</span>
      <span class="timestamp">${new Date(c.createdAt).toLocaleString()}</span>
    </div>
  </div>

  ${
    c.logs && c.logs.length
      ? `
  <details>
    <summary>
      <span class="summary-icon">▶</span>
      View logs (${c.logs.length} ${c.logs.length === 1 ? "entry" : "entries"})
    </summary>
    <pre class="history-code">${c.logs.join("\n")}</pre>
  </details>`
      : ""
  }

  ${
    c.error
      ? `<div class="error-message">
          <div class="error-label">Error:</div>
          <pre class="error-code">${c.error}</pre>
        </div>`
      : ""
  }

  ${
    !c.logs?.length && !c.error
      ? `<div class="empty-history-item">No logs or output</div>`
      : ""
  }
</li>
`,
        )
        .join("")
    : `<li class="empty-history">No executions yet</li>`;

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="theme-color" content="#667eea">
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
  <title>${script.name} — Script</title>
  <style>
    /* =========================================================
   GLOBAL VARIABLES
   ========================================================= */

:root {
  --glass-water-rgb: 115, 111, 230;
  --glass-alpha: 0.28;
  --glass-alpha-hover: 0.38;
}

/* =========================================================
   RESET & BASE
   ========================================================= */

* {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
  -webkit-tap-highlight-color: transparent;
}

body {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Roboto",
    "Oxygen", "Ubuntu", "Cantarell", sans-serif;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  min-height: 100vh;
  min-height: 100dvh;
  padding: 20px;
  color: #1a1a1a;
  position: relative;
  overflow-x: hidden;
  touch-action: manipulation;
}

/* =========================================================
   ANIMATED BACKGROUND
   ========================================================= */

body::before,
body::after {
  content: "";
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
  0%,
  100% {
    transform: translateY(0) rotate(0deg);
  }
  50% {
    transform: translateY(-30px) rotate(5deg);
  }
}

/* =========================================================
   LAYOUT
   ========================================================= */

.container {
  max-width: 1000px;
  margin: 0 auto;
  position: relative;
  z-index: 1;
}

/* =========================================================
   UNIFIED GLASS BUTTON SYSTEM
   ========================================================= */

.glass-btn,
button,
.back-link,
.btn-copy,
.btn-execute,
.btn-save {
  position: relative;
  overflow: hidden;

  padding: 10px 20px;
  border-radius: 980px;

  display: inline-flex;
  align-items: center;
  justify-content: center;
  white-space: nowrap;

  background: rgba(var(--glass-water-rgb), var(--glass-alpha));
  backdrop-filter: blur(22px) saturate(140%);
  -webkit-backdrop-filter: blur(22px) saturate(140%);

  color: white;
  text-decoration: none;
  font-family: inherit;

  font-size: 15px;
  font-weight: 500;
  letter-spacing: -0.2px;

  border: 1px solid rgba(255, 255, 255, 0.28);

  box-shadow:
    0 8px 24px rgba(0, 0, 0, 0.12),
    inset 0 1px 0 rgba(255, 255, 255, 0.25);

  cursor: pointer;

  transition:
    background 0.3s cubic-bezier(0.4, 0, 0.2, 1),
    transform 0.3s cubic-bezier(0.4, 0, 0.2, 1),
    box-shadow 0.3s ease;
}

/* Liquid light layer */
.glass-btn::before,
button::before,
.back-link::before,
.btn-copy::before,
.btn-execute::before,
.btn-save::before {
  content: "";
  position: absolute;
  inset: -40%;

  background:
    radial-gradient(
      120% 60% at 0% 0%,
      rgba(255, 255, 255, 0.35),
      transparent 60%
    ),
    linear-gradient(
      120deg,
      transparent 30%,
      rgba(255, 255, 255, 0.25),
      transparent 70%
    );

  opacity: 0;
  transform: translateX(-30%) translateY(-10%);
  transition:
    opacity 0.35s ease,
    transform 0.6s cubic-bezier(0.22, 1, 0.36, 1);

  pointer-events: none;
}

/* Hover motion */
.glass-btn:hover,
button:hover,
.back-link:hover,
.btn-copy:hover,
.btn-execute:hover,
.btn-save:hover {
  background: rgba(var(--glass-water-rgb), var(--glass-alpha-hover));
  transform: translateY(-1px);
  animation: waterDrift 2.2s ease-in-out infinite alternate;
}

.glass-btn:hover::before,
button:hover::before,
.back-link:hover::before,
.btn-copy:hover::before,
.btn-execute:hover::before,
.btn-save:hover::before {
  opacity: 1;
  transform: translateX(30%) translateY(10%);
}

/* Active press */
.glass-btn:active,
button:active,
.btn-copy:active,
.btn-execute:active,
.btn-save:active {
  background: rgba(var(--glass-water-rgb), 0.45);
  transform: translateY(0);
  animation: none;
}

@keyframes waterDrift {
  0% { transform: translateY(-1px); }
  100% { transform: translateY(1px); }
}

/* Button variants */
.btn-execute {
  --glass-water-rgb: 16, 185, 129;
  font-weight: 600;
}

.btn-save {
  --glass-alpha: 0.34;
  --glass-alpha-hover: 0.46;
  font-weight: 600;
}

.btn-copy {
  padding: 6px 12px;
  font-size: 13px;
}

/* =========================================================
   CONTENT CARDS
   ========================================================= */

.header,
.section {
  background: rgba(255, 255, 255, 0.15);
  backdrop-filter: blur(22px) saturate(140%);
  -webkit-backdrop-filter: blur(22px) saturate(140%);
  border-radius: 14px;
  padding: 28px;
  border: 1px solid rgba(255, 255, 255, 0.28);
  color: white;
  margin-bottom: 24px;
}

.header h1 {
  font-size: 28px;
  font-weight: 600;
  letter-spacing: -0.5px;
  line-height: 1.3;
  margin-bottom: 12px;
  text-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
  color: white;
  word-break: break-word;
}

.header h1::before {
  content: '⚡ ';
  font-size: 26px;
}

.script-id {
  font-size: 13px;
  color: rgba(255, 255, 255, 0.8);
  font-family: 'SF Mono', Monaco, monospace;
  background: rgba(255, 255, 255, 0.1);
  padding: 6px 12px;
  border-radius: 6px;
  display: inline-block;
  margin-top: 8px;
  border: 1px solid rgba(255, 255, 255, 0.2);
}

.section-title {
  font-size: 18px;
  font-weight: 600;
  color: white;
  margin-bottom: 20px;
  letter-spacing: -0.3px;
  text-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
}

/* =========================================================
   NAV
   ========================================================= */

.back-nav {
  display: flex;
  gap: 12px;
  margin-bottom: 20px;
  flex-wrap: wrap;
}

/* =========================================================
   CODE DISPLAY
   ========================================================= */

.code-container {
  position: relative;
}

.code-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}

.code-label {
  font-size: 14px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.7);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

pre {
  background: rgba(0, 0, 0, 0.3);
  color: #e0e0e0;
  padding: 20px;
  border-radius: 12px;
  overflow-x: auto;
  font-size: 14px;
  line-height: 1.6;
  font-family: 'SF Mono', Monaco, 'Cascadia Code', Consolas, monospace;
  border: 1px solid rgba(255, 255, 255, 0.1);
}

/* =========================================================
   ACTION BUTTONS
   ========================================================= */

.action-bar {
  display: flex;
  gap: 12px;
  margin-top: 20px;
  flex-wrap: wrap;
}

.btn-execute::before {
  content: '▶ ';
  font-size: 14px;
}

/* =========================================================
   FORMS
   ========================================================= */

.edit-form {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.form-label {
  font-size: 14px;
  font-weight: 600;
  color: white;
}

input[type="text"],
textarea {
  width: 100%;
  padding: 12px 16px;
  border: 1px solid rgba(255, 255, 255, 0.3);
  border-radius: 10px;
  font-size: 15px;
  font-family: inherit;
  transition: all 0.2s;
  background: rgba(255, 255, 255, 0.2);
  color: white;
}

input[type="text"]::placeholder,
textarea::placeholder {
  color: rgba(255, 255, 255, 0.6);
}

textarea {
  font-family: 'SF Mono', Monaco, 'Cascadia Code', Consolas, monospace;
  resize: vertical;
  min-height: 300px;
}

input[type="text"]:focus,
textarea:focus {
  outline: none;
  border-color: rgba(255, 255, 255, 0.5);
  background: rgba(255, 255, 255, 0.25);
  box-shadow: 0 0 0 3px rgba(255, 255, 255, 0.1);
}

/* =========================================================
   HISTORY
   ========================================================= */

.history-list {
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.history-item {
  background: rgba(255, 255, 255, 0.1);
  border-radius: 12px;
  padding: 16px;
  border: 1px solid rgba(255, 255, 255, 0.2);
  transition: all 0.2s;
}

.history-item:hover {
  background: rgba(255, 255, 255, 0.15);
  transform: translateX(4px);
}

.history-item.success {
  border-left: 4px solid #10b981;
}

.history-item.failure {
  border-left: 4px solid #ef4444;
}

.history-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
  flex-wrap: wrap;
  gap: 12px;
}

.history-title {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

.edit-number {
  font-weight: 600;
  color: white;
  font-size: 15px;
}

.script-name {
  font-size: 13px;
  color: white;
  background: rgba(255, 255, 255, 0.2);
  padding: 4px 10px;
  border-radius: 8px;
  font-weight: 600;
  border: 1px solid rgba(255, 255, 255, 0.3);
}

.current-badge {
  padding: 4px 10px;
  background: rgba(16, 185, 129, 0.9);
  color: white;
  border-radius: 12px;
  font-size: 12px;
  font-weight: 600;
}

.success-badge {
  background: rgba(16, 185, 129, 0.9);
}

.failure-badge {
  background: rgba(239, 68, 68, 0.9);
}

.history-meta {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

.version-badge {
  padding: 4px 10px;
  background: rgba(255, 255, 255, 0.2);
  color: white;
  border-radius: 8px;
  font-size: 12px;
  font-weight: 600;
  border: 1px solid rgba(255, 255, 255, 0.3);
}

.timestamp {
  font-size: 13px;
  color: rgba(255, 255, 255, 0.8);
}

details {
  margin-top: 8px;
}

details summary {
  cursor: pointer;
  font-weight: 600;
  color: white;
  font-size: 14px;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 0;
  user-select: none;
  transition: opacity 0.2s;
}

details summary:hover {
  opacity: 0.8;
}

.summary-icon {
  font-size: 10px;
  transition: transform 0.2s;
}

details[open] .summary-icon {
  transform: rotate(90deg);
}

details summary::-webkit-details-marker {
  display: none;
}

.history-code {
  margin-top: 12px;
  font-size: 13px;
}

.empty-history {
  text-align: center;
  padding: 40px;
  color: rgba(255, 255, 255, 0.7);
  font-style: italic;
  background: rgba(255, 255, 255, 0.1);
  border-radius: 12px;
  border: 1px solid rgba(255, 255, 255, 0.2);
}

.empty-history-item {
  text-align: center;
  padding: 20px;
  color: rgba(255, 255, 255, 0.7);
  font-style: italic;
  font-size: 14px;
}

/* =========================================================
   ERROR MESSAGES
   ========================================================= */

.error-message {
  margin-top: 12px;
  padding: 12px;
  background: rgba(239, 68, 68, 0.2);
  border-left: 3px solid #ef4444;
  border-radius: 8px;
}

.error-label {
  font-size: 12px;
  font-weight: 600;
  color: #ff6b6b;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin-bottom: 8px;
}

.error-code {
  color: #ffcccb;
  background: rgba(0, 0, 0, 0.2);
  padding: 12px;
  border-radius: 6px;
  font-size: 13px;
  margin: 0;
}

/* =========================================================
   RESPONSIVE
   ========================================================= */

@media (max-width: 640px) {
  body {
    padding: 16px;
  }

  .container {
    max-width: 100%;
  }

  .header,
  .section {
    padding: 20px;
  }

  .header h1 {
    font-size: 24px;
  }

  .back-nav {
    flex-direction: column;
  }

  .back-link {
    width: 100%;
    justify-content: center;
  }

  .action-bar {
    flex-direction: column;
  }

  .btn-execute,
  .btn-save {
    width: 100%;
    justify-content: center;
  }

  .history-header {
    flex-direction: column;
    align-items: flex-start;
  }

  .history-title {
    width: 100%;
  }

  pre {
    font-size: 12px;
    padding: 16px;
  }

  textarea {
    min-height: 200px;
  }
}

@media (min-width: 641px) and (max-width: 1024px) {
  .container {
    max-width: 800px;
  }
}

html, body {
  background: #736fe6;
  margin: 0;
  padding: 0;
}
  </style>
</head>
<body>
  <div class="container">
    <!-- Back Navigation -->
    <div class="back-nav">
      <a href="/api/v1/node/${nodeId}${qsWithQ}" class="back-link">
        ← Back to Node
      </a>
      <a href="/api/v1/node/${nodeId}/scripts/help${qsWithQ}" class="back-link">
        📚 Help
      </a>
    </div>

    <!-- Header -->
    <div class="header">
      <h1>${script.name}</h1>
      <div class="script-id">ID: ${script.id}</div>
    </div>

    <!-- Current Script -->
    <div class="section">
      <div class="code-container">
        <div class="code-header">
          <div class="code-label">Current Script</div>
          <button class="btn-copy" onclick="copyCode()">📋 Copy</button>
        </div>
        <pre id="scriptCode">${script.script}</pre>
      </div>

      <!-- Execute Button -->
      <div class="action-bar">
        <form
          method="POST"
          action="/api/v1/node/${nodeId}/script/${script.id}/execute${qsWithQ}"
          onsubmit="return confirm('Execute this script now?')"
          style="margin: 0;"
        >
          <button type="submit" class="btn-execute">Run Script</button>
        </form>
      </div>
    </div>

    <!-- Edit Script -->
    <div class="section">
      <div class="section-title">Edit Script</div>
      <form
        method="POST"
        action="/api/v1/node/${nodeId}/script/${script.id}/edit${qsWithQ}"
        class="edit-form"
      >
        <div class="form-group">
          <label class="form-label">Script Name</label>
          <input
            type="text"
            name="name"
            value="${script.name}"
            placeholder="Enter script name"
            required
          />
        </div>

        <div class="form-group">
          <label class="form-label">Script Code</label>
          <textarea
            name="script"
            rows="14"
            placeholder="// Enter your script code here"
            required
          >${script.script}</textarea>
        </div>

        <button type="submit" class="btn-save">💾 Save Changes</button>
      </form>
    </div>

    <!-- Execution History -->
    <div class="section">
      <div class="section-title">Execution History</div>
      <ul class="history-list">
        ${executionHistoryHtml}
      </ul>
    </div>

    <!-- Edit History -->
    <div class="section">
      <div class="section-title">Edit History</div>
      <ul class="history-list">
        ${editHistoryHtml}
      </ul>
    </div>
  </div>

  <script>
    function copyCode() {
      const code = document.getElementById('scriptCode').textContent;
      navigator.clipboard.writeText(code).then(() => {
        const btn = document.querySelector('.btn-copy');
        const originalText = btn.textContent;
        btn.textContent = '✓ Copied!';
        setTimeout(() => {
          btn.textContent = originalText;
        }, 2000);
      });
    }
  </script>
</body>
</html>
      `;
}

/* ================================================================== */
/* 5. renderScriptHelp                                                 */
/* ================================================================== */

export function renderScriptHelp({ nodeId, nodeName, data, qsWithQ }) {
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="theme-color" content="#667eea">
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
  <title>Script Help — ${nodeName}</title>
  <style>
    /* =========================================================
   GLOBAL VARIABLES
   ========================================================= */

:root {
  --glass-water-rgb: 115, 111, 230;
  --glass-alpha: 0.28;
  --glass-alpha-hover: 0.38;
}

/* =========================================================
   RESET & BASE
   ========================================================= */

* {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
  -webkit-tap-highlight-color: transparent;
}

body {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Roboto",
    "Oxygen", "Ubuntu", "Cantarell", sans-serif;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  min-height: 100vh;
  min-height: 100dvh;
  padding: 20px;
  color: #1a1a1a;
  position: relative;
  overflow-x: hidden;
  touch-action: manipulation;
}

/* =========================================================
   ANIMATED BACKGROUND
   ========================================================= */

body::before,
body::after {
  content: "";
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
  0%,
  100% {
    transform: translateY(0) rotate(0deg);
  }
  50% {
    transform: translateY(-30px) rotate(5deg);
  }
}

/* =========================================================
   LAYOUT
   ========================================================= */

.container {
  max-width: 1100px;
  margin: 0 auto;
  position: relative;
  z-index: 1;
}

/* =========================================================
   UNIFIED GLASS BUTTON SYSTEM
   ========================================================= */

.glass-btn,
button,
.back-link,
.quick-nav-item,
.btn-copy {
  position: relative;
  overflow: hidden;

  padding: 10px 20px;
  border-radius: 980px;

  display: inline-flex;
  align-items: center;
  justify-content: center;
  white-space: nowrap;

  background: rgba(var(--glass-water-rgb), var(--glass-alpha));
  backdrop-filter: blur(22px) saturate(140%);
  -webkit-backdrop-filter: blur(22px) saturate(140%);

  color: white;
  text-decoration: none;
  font-family: inherit;

  font-size: 15px;
  font-weight: 500;
  letter-spacing: -0.2px;

  border: 1px solid rgba(255, 255, 255, 0.28);

  box-shadow:
    0 8px 24px rgba(0, 0, 0, 0.12),
    inset 0 1px 0 rgba(255, 255, 255, 0.25);

  cursor: pointer;

  transition:
    background 0.3s cubic-bezier(0.4, 0, 0.2, 1),
    transform 0.3s cubic-bezier(0.4, 0, 0.2, 1),
    box-shadow 0.3s ease;
}

/* Liquid light layer */
.glass-btn::before,
button::before,
.back-link::before,
.quick-nav-item::before,
.btn-copy::before {
  content: "";
  position: absolute;
  inset: -40%;

  background:
    radial-gradient(
      120% 60% at 0% 0%,
      rgba(255, 255, 255, 0.35),
      transparent 60%
    ),
    linear-gradient(
      120deg,
      transparent 30%,
      rgba(255, 255, 255, 0.25),
      transparent 70%
    );

  opacity: 0;
  transform: translateX(-30%) translateY(-10%);
  transition:
    opacity 0.35s ease,
    transform 0.6s cubic-bezier(0.22, 1, 0.36, 1);

  pointer-events: none;
}

/* Hover motion */
.glass-btn:hover,
button:hover,
.back-link:hover,
.quick-nav-item:hover,
.btn-copy:hover {
  background: rgba(var(--glass-water-rgb), var(--glass-alpha-hover));
  transform: translateY(-1px);
  animation: waterDrift 2.2s ease-in-out infinite alternate;
}

.glass-btn:hover::before,
button:hover::before,
.back-link:hover::before,
.quick-nav-item:hover::before,
.btn-copy:hover::before {
  opacity: 1;
  transform: translateX(30%) translateY(10%);
}

/* Active press */
.glass-btn:active,
button:active,
.btn-copy:active,
.quick-nav-item:active {
  background: rgba(var(--glass-water-rgb), 0.45);
  transform: translateY(0);
  animation: none;
}

@keyframes waterDrift {
  0% { transform: translateY(-1px); }
  100% { transform: translateY(1px); }
}

/* Button variants */
.btn-copy {
  padding: 6px 12px;
  font-size: 13px;
}

/* =========================================================
   CONTENT CARDS
   ========================================================= */

.header,
.section {
  background: rgba(255, 255, 255, 0.15);
  backdrop-filter: blur(22px) saturate(140%);
  -webkit-backdrop-filter: blur(22px) saturate(140%);
  border-radius: 14px;
  padding: 28px;
  border: 1px solid rgba(255, 255, 255, 0.28);
  color: white;
  margin-bottom: 24px;
}

.header h1 {
  font-size: 28px;
  font-weight: 600;
  letter-spacing: -0.5px;
  line-height: 1.3;
  margin-bottom: 8px;
  text-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
  color: white;
}

.header h1::before {
  content: '📚 ';
  font-size: 26px;
}

.header-subtitle {
  font-size: 14px;
  color: rgba(255, 255, 255, 0.8);
}

.section-title {
  font-size: 18px;
  font-weight: 600;
  color: white;
  margin-bottom: 16px;
  letter-spacing: -0.3px;
  text-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
}

.section-description {
  font-size: 14px;
  color: rgba(255, 255, 255, 0.9);
  line-height: 1.6;
  margin-bottom: 16px;
  padding: 12px;
  background: rgba(255, 255, 255, 0.1);
  border-radius: 8px;
  border-left: 3px solid rgba(255, 255, 255, 0.5);
}

/* =========================================================
   NAV
   ========================================================= */

.back-nav {
  display: flex;
  gap: 12px;
  margin-bottom: 20px;
  flex-wrap: wrap;
}

/* =========================================================
   QUICK NAV
   ========================================================= */

.quick-nav {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 12px;
}

.quick-nav-item {
  padding: 12px 16px;
  text-align: center;
}

/* =========================================================
   TABLES
   ========================================================= */

table {
  width: 100%;
  border-collapse: collapse;
  background: rgba(255, 255, 255, 0.1);
  border-radius: 8px;
  overflow: hidden;
  border: 1px solid rgba(255, 255, 255, 0.2);
}

thead {
  background: rgba(255, 255, 255, 0.15);
}

th {
  padding: 14px 16px;
  text-align: left;
  font-weight: 600;
  color: white;
  font-size: 14px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  border-bottom: 2px solid rgba(255, 255, 255, 0.2);
}

td {
  padding: 14px 16px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
  font-size: 14px;
  line-height: 1.6;
  vertical-align: top;
  color: rgba(255, 255, 255, 0.95);
}

tbody tr:last-child td {
  border-bottom: none;
}

tbody tr {
  transition: background 0.2s;
}

tbody tr:hover {
  background: rgba(255, 255, 255, 0.05);
}

code {
  background: rgba(255, 255, 255, 0.2);
  padding: 3px 8px;
  border-radius: 4px;
  font-size: 13px;
  font-family: 'SF Mono', Monaco, 'Cascadia Code', Consolas, monospace;
  color: white;
  font-weight: 600;
  border: 1px solid rgba(255, 255, 255, 0.3);
}

pre {
  background: rgba(0, 0, 0, 0.3);
  color: #e0e0e0;
  padding: 20px;
  border-radius: 12px;
  overflow-x: auto;
  font-size: 14px;
  line-height: 1.6;
  font-family: 'SF Mono', Monaco, 'Cascadia Code', Consolas, monospace;
  border: 1px solid rgba(255, 255, 255, 0.1);
  margin-top: 12px;
}

pre code {
  background: none;
  padding: 0;
  color: inherit;
  font-weight: normal;
  border: none;
}

/* =========================================================
   INFO BOX
   ========================================================= */

.info-box {
  background: rgba(255, 193, 7, 0.2);
  padding: 16px;
  border-radius: 10px;
  border-left: 4px solid #ffa500;
  margin-bottom: 16px;
}

.info-box-title {
  font-weight: 600;
  color: #ffd700;
  margin-bottom: 8px;
  display: flex;
  align-items: center;
  gap: 8px;
}

.info-box-title::before {
  content: '⚠️';
  font-size: 16px;
}

.info-box-content {
  font-size: 14px;
  color: rgba(255, 255, 255, 0.9);
  line-height: 1.6;
}

/* =========================================================
   EXAMPLE BOX
   ========================================================= */

.example-box {
  margin-top: 12px;
}

.example-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}

.example-label {
  font-size: 14px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.7);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

/* =========================================================
   RESPONSIVE
   ========================================================= */

@media (max-width: 640px) {
  body {
    padding: 16px;
  }

  .container {
    max-width: 100%;
  }

  .header,
  .section {
    padding: 20px;
  }

  .header h1 {
    font-size: 24px;
  }

  .back-nav {
    flex-direction: column;
  }

  .back-link {
    width: 100%;
    justify-content: center;
  }

  table {
    font-size: 13px;
  }

  th, td {
    padding: 10px;
  }

  pre {
    font-size: 12px;
    padding: 16px;
  }

  .quick-nav {
    grid-template-columns: 1fr;
  }
}

@media (min-width: 641px) and (max-width: 1024px) {
  .container {
    max-width: 900px;
  }
}

html, body {
  background: #736fe6;
  margin: 0;
  padding: 0;
}
  </style>
</head>
<body>
  <div class="container">
    <!-- Back Navigation -->
    <div class="back-nav">
      <a href="/api/v1/node/${nodeId}${qsWithQ}" class="back-link">
        ← Back to Node
      </a>
    </div>

    <!-- Header -->
    <div class="header">
      <h1>Script Help</h1>
      <div class="header-subtitle">Learn how to write scripts for your nodes</div>
    </div>

    <!-- Quick Navigation -->
    <div class="section">
      <div class="section-title">Quick Jump</div>
      <div class="quick-nav">
        <a href="#node-data" class="quick-nav-item">Node Data</a>
        <a href="#version-properties" class="quick-nav-item">Version Properties</a>
        <a href="#other-properties" class="quick-nav-item">Other Properties</a>
        <a href="#functions" class="quick-nav-item">Built-in Functions</a>
        <a href="#example" class="quick-nav-item">Example Script</a>
      </div>
    </div>

    <!-- Node Data -->
    <div class="section" id="node-data">
      <div class="section-title">Accessing Node Data</div>

      <div class="info-box">
        <div class="info-box-title">Important</div>
        <div class="info-box-content">
          ${data.importantNote}
        </div>
      </div>

      <table>
        <thead>
          <tr>
            <th>Property</th>
            <th>Description</th>
          </tr>
        </thead>
        <tbody>
          ${data.nodeProperties.basic
            .map(
              (item) => `
            <tr>
              <td><code>${item.property}</code></td>
              <td>${item.description}</td>
            </tr>
          `,
            )
            .join("")}
        </tbody>
      </table>
    </div>

    <!-- Version Properties -->
    <div class="section" id="version-properties">
      <div class="section-title">Version Properties</div>

      <div class="section-description">
        Access version data using index <code>i</code>. Use <code>0</code> for the first version,
        or <code>0</code> for the latest version.
      </div>

      <table>
        <thead>
          <tr>
            <th>Property</th>
            <th>Description</th>
          </tr>
        </thead>
        <tbody>
          ${data.nodeProperties.version
            .map(
              (item) => `
            <tr>
              <td><code>${item.property}</code></td>
              <td>${item.description}${
                item.example ? `: <code>${item.example}</code>` : ""
              }</td>
            </tr>
          `,
            )
            .join("")}
        </tbody>
      </table>
    </div>

    <!-- Other Properties -->
    <div class="section" id="other-properties">
      <div class="section-title">Other Node Properties</div>

      <table>
        <thead>
          <tr>
            <th>Property</th>
            <th>Description</th>
          </tr>
        </thead>
        <tbody>
          ${data.nodeProperties.other
            .map(
              (item) => `
            <tr>
              <td><code>${item.property}</code></td>
              <td>${item.description}${
                item.example ? `: <code>${item.example}</code>` : ""
              }</td>
            </tr>
          `,
            )
            .join("")}
        </tbody>
      </table>
    </div>

    <!-- Built-in Functions -->
    <div class="section" id="functions">
      <div class="section-title">Built-in Functions</div>

      <div class="section-description">
        These functions are available globally in all scripts and provide access to node operations.
      </div>

      <table>
        <thead>
          <tr>
            <th style="width: 40%;">Function</th>
            <th>Description</th>
          </tr>
        </thead>
        <tbody>
          ${data.builtInFunctions
            .map(
              (fn) => `
            <tr>
              <td><code>${fn.name}</code></td>
              <td>${fn.description}</td>
            </tr>
          `,
            )
            .join("")}
        </tbody>
      </table>
    </div>

    <!-- Example Script -->
    <div class="section" id="example">
      <div class="section-title">Example Script</div>

      <div class="section-description">
        This example demonstrates a script that tapers a value over time by increasing it by 5%
        each time it runs, then schedules itself to run again.
      </div>

      <div class="example-box">
        <div class="example-header">
          <div class="example-label">Tapering Script</div>
          <button class="btn-copy" onclick="copyExample()">📋 Copy</button>
        </div>
        <pre id="exampleCode">${data.exampleScript}</pre>
      </div>
    </div>
  </div>

  <script>
    function copyExample() {
      const code = document.getElementById('exampleCode').textContent;
      navigator.clipboard.writeText(code).then(() => {
        const btn = document.querySelector('.btn-copy');
        const originalText = btn.textContent;
        btn.textContent = '✓ Copied!';
        setTimeout(() => {
          btn.textContent = originalText;
        }, 2000);
      });
    }

    // Smooth scroll for quick nav
    document.querySelectorAll('.quick-nav-item').forEach(link => {
      link.addEventListener('click', (e) => {
        e.preventDefault();
        const target = document.querySelector(link.getAttribute('href'));
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    });
  </script>
</body>
</html>
      `;
}
