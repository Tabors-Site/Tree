/* ------------------------------------------------------------------ */
/* renderNodeChats -- AI chat sessions for a node                      */
/* ------------------------------------------------------------------ */

import { page } from "../../html-rendering/html/layout.js";
import {
  esc,
  truncate,
  formatTime,
  formatDuration,
  modeLabel,
  sourceLabel,
  actionLabel,
  actionColorHex,
  groupIntoChains,
} from "../../html-rendering/html/utils.js";

/* ── helpers (local to this page) ── */

const linkifyNodeIds = (html, token) =>
  html.replace(
    /Placed on node ([0-9a-f-]{36})/g,
    (_, id) =>
      `Placed on node <a class="node-link" href="/api/v1/root/${id}${token ? `?token=${encodeURIComponent(token)}&html` : "?html"}">${id}</a>`,
  );

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

const groupStepsIntoPhases = (steps) => {
  const phases = [];
  let currentPlan = null;
  for (const step of steps) {
    const mode = step.aiContext?.mode || "";
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
          <span class="chain-step-mode">${modeLabel(chat.aiContext?.mode)}</span>
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
              <span class="chain-phase-label">${modeLabel(m.aiContext?.mode)}</span>
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
              <span class="chain-phase-label">${modeLabel(s.aiContext?.mode)}</span>
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
            return `${icon}${modeLabel(s.aiContext?.mode)}`;
          })
          .join(" > ");
        const label = targetName ? `P ${esc(targetName)}` : "P";
        return sub ? `${label}: ${sub}` : label;
      }
      if (p.type === "respond") return "R";
      return modeLabel(p.step?.aiContext?.mode);
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
      const color = actionColorHex(c.action);
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
            <span class="chat-mode">${modeLabel(chat.aiContext?.mode)}</span>
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
            <span class="msg-label">${chat.userId?._id ? `<a href="/api/v1/user/${chat.userId._id}${tokenQS}" class="msg-user-link">${esc(chat.userId.username || "User")}</a>` : esc("User")}</span>
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

/* ── page-specific CSS ── */

const css = `
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

.notes-list { padding: 16px; }
.note-card { opacity: 0; transform: translateY(30px); }
.note-card.visible { animation: fadeInUp 0.6s cubic-bezier(0.4,0,0.2,1) forwards; }

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
.msg-user-link { color: inherit; text-decoration: none; }
.msg-user-link:hover { text-decoration: underline; }
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

.contribution-id {
  background: rgba(255,255,255,0.12); padding: 2px 6px; border-radius: 4px;
  font-size: 11px; font-family: 'SF Mono', 'Fira Code', monospace;
  color: rgba(255,255,255,0.6); border: 1px solid rgba(255,255,255,0.1);
}

@media (max-width: 640px) {
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
`;

/* ── client-side JS ── */

const js = `
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
`;

/* ================================================================== */
/* renderNodeChats                                                     */
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

  const body = `
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
`;

  return page({
    title: `${esc(nodeName)} -- AI Chats`,
    css,
    body,
    js,
  });
}

/**
 * Alias for tree-root chat history.
 * The route passes rootId/rootName; we map to nodeId/nodeName.
 */
export function renderRootChats({ rootId, rootName, sessions, allChats, token, tokenQS }) {
  return renderNodeChats({
    nodeId: rootId,
    nodeName: rootName,
    nodePath: rootName,
    sessions,
    allChats,
    token,
    tokenQS,
  });
}
