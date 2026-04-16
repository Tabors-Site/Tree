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

const formatToolArgHint = (args) => {
  if (!args || typeof args !== "object") return "";
  if (args._truncated) return "(truncated)";
  for (const key of ["filePath", "path", "subdir", "name", "query", "command", "binary"]) {
    if (args[key] != null && typeof args[key] !== "object") {
      const v = String(args[key]);
      return v.length > 60 ? v.slice(0, 57) + "..." : v;
    }
  }
  const keys = Object.keys(args).filter(
    (k) => !["userId", "rootId", "nodeId", "chatId", "sessionId"].includes(k),
  );
  if (!keys.length) return "";
  return "(" + keys.slice(0, 3).join(",") + ")";
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

const renderSubstep = (chat, tokenQS, capturesByChatId, childrenByParent) => {
  const capture = capturesByChatId?.get?.(String(chat._id)) || null;
  const dispatchedChildren = childrenByParent?.get?.(String(chat._id)) || [];
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

  // Tool calls for this specific continuation step. Without this, the
  // chain only shows the first step's tool calls and every following
  // write/read stays invisible in the frontend.
  const toolCalls = Array.isArray(chat.toolCalls) ? chat.toolCalls : [];
  const toolCallsHtml = toolCalls.length === 0 ? "" : `
          <div class="chain-step-tool-calls">
            <div class="tc-title">${toolCalls.length} tool call${toolCalls.length !== 1 ? "s" : ""}</div>
            ${toolCalls
              .map((tc) => {
                const ok = tc.success !== false;
                const icon = ok ? "→" : "✗";
                const iconClass = ok ? "tc-ok" : "tc-fail";
                const argHint = formatToolArgHint(tc.args);
                const ms = tc.ms ? `${tc.ms}ms` : "";
                const err = !ok && tc.error ? `<div class="tc-error">${esc(String(tc.error).slice(0, 200))}</div>` : "";
                return `
                  <div class="tc-row">
                    <span class="tc-icon ${iconClass}">${icon}</span>
                    <span class="tc-name">${esc(tc.tool || "?")}</span>
                    ${argHint ? `<span class="tc-args">${esc(argHint)}</span>` : ""}
                    ${ms ? `<span class="tc-ms">${ms}</span>` : ""}
                    ${err}
                  </div>`;
              })
              .join("")}
          </div>`;

  const forensicsHtml = capture ? renderForensicsSections(capture, chat) : "";
  const dispatchedToHtml = dispatchedChildren.length > 0
    ? renderDispatchedTo(dispatchedChildren, tokenQS)
    : "";

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
          ${toolCalls.length ? `<span class="chain-step-toolcount">${toolCalls.length} tool${toolCalls.length !== 1 ? "s" : ""}</span>` : ""}
          ${capture ? `<span class="chain-step-captured" title="AI forensics capture available">📸</span>` : ""}
        </summary>
        <div class="chain-step-body">
          ${renderTreeContext(tc, tokenQS)}
          ${renderDirective(tc)}
          <div class="chain-step-input"><span class="chain-io-label chain-io-in">IN</span>${inputFull}</div>
          ${outputFull ? `<div class="chain-step-output"><span class="chain-io-label chain-io-out">OUT</span>${outputFull}</div>` : ""}
          ${toolCallsHtml}
          ${forensicsHtml}
          ${dispatchedToHtml}
        </div>
      </details>`;
};

/**
 * Render the "Dispatched to N branches" block under a chat step that
 * spawned one or more child chat chains. Used for branch dispatches
 * (swarm), plan expansions, retries. Each child becomes a clickable
 * link that jumps the operator to the child's chat page — at the
 * child's OWN node, not the parent's.
 */
const renderDispatchedTo = (children, tokenQS) => {
  if (!Array.isArray(children) || children.length === 0) return "";
  const originLabel = (() => {
    const kinds = new Set(children.map((c) => c.dispatchOrigin).filter(Boolean));
    if (kinds.size === 1) {
      const k = [...kinds][0];
      return ({
        "branch-swarm": "Dispatched to branches",
        "plan-expand": "Expanded into plan items",
        "retry": "Retried",
        "continuation": "Continued into",
      })[k] || "Dispatched to";
    }
    return "Dispatched to";
  })();
  const rows = children.map((c) => {
    const cTc = c.treeContext;
    const cNodeId = cTc?.targetNodeId || null;
    const cNodeName = cTc?.targetNodeName || cNodeId?.slice?.(0, 8) || "(unnamed)";
    const cMode = c.aiContext?.mode ? modeLabel(c.aiContext.mode) : "";
    const stopped = c.endMessage?.stopped ? " (stopped)" : "";
    const linkHref = cNodeId
      ? `/api/v1/node/${cNodeId}/chats${tokenQS}`
      : "#";
    return `
      <a class="lineage-to-row" href="${linkHref}">
        <span class="lineage-icon">▶</span>
        <span class="lineage-to-name">${esc(cNodeName)}</span>
        ${cMode ? `<span class="lineage-to-mode">${esc(cMode)}</span>` : ""}
        <span class="lineage-to-chain">chainIndex ${c.chainIndex ?? "?"}${stopped}</span>
      </a>`;
  }).join("");
  return `
      <div class="lineage-to">
        <div class="lineage-to-label">${esc(originLabel)} (${children.length})</div>
        ${rows}
      </div>`;
};

// ─────────────────────────────────────────────────────────────────────
// AI Forensics rendering — the "first person" view of what the AI saw
// and did. Only fires when an AiCapture exists for this chat step.
// ─────────────────────────────────────────────────────────────────────

const SIGNAL_ICONS = {
  "syntax-error": "🔴",
  "dead-receiver": "👻",
  "contract-mismatch": "🔗",
  "contract": "📜",
  "probe-failure": "🔴",
  "test-failure": "🧪",
  "runtime-error": "💥",
};

const renderForensicsSections = (capture, chat) => {
  if (!capture) return "";
  const parts = [];

  // 1. What the AI saw
  const pm = Array.isArray(capture.promptMessages) ? capture.promptMessages : [];
  if (pm.length > 0) {
    const bytesLabel = capture.promptBytes
      ? ` (${Math.round(capture.promptBytes / 1024)}KB${capture.promptTruncated ? ", truncated" : ""})`
      : "";
    const messagesHtml = pm
      .map((m) => {
        const role = esc(m.role || "unknown");
        const truncMark = m.truncated ? ' <span class="fx-trunc">[truncated]</span>' : "";
        const content = m.content ? `<pre class="fx-msg-content">${esc(m.content)}</pre>` : "";
        const toolCallsJson = m.tool_calls
          ? `<pre class="fx-msg-toolcalls">${esc(JSON.stringify(m.tool_calls, null, 2))}</pre>`
          : "";
        return `
            <details class="fx-message fx-msg-${role}">
              <summary>
                <span class="fx-msg-role">${role}</span>
                ${m.name ? `<span class="fx-msg-name">${esc(m.name)}</span>` : ""}
                ${truncMark}
                ${m.content ? `<span class="fx-msg-size">${Buffer.byteLength(m.content || "", "utf8")}b</span>` : ""}
              </summary>
              ${content}
              ${toolCallsJson}
            </details>`;
      })
      .join("");
    parts.push(`
        <details class="fx-section fx-section-prompt">
          <summary>📖 What the AI saw${bytesLabel}</summary>
          <div class="fx-messages">${messagesHtml}</div>
        </details>`);
  }

  // 2. Full LLM response (if different from chat.endMessage)
  if (capture.responseText && capture.responseText.length > 0) {
    const truncMark = capture.responseTruncated ? ' <span class="fx-trunc">[truncated]</span>' : "";
    parts.push(`
        <details class="fx-section fx-section-response">
          <summary>💬 Full LLM response${truncMark}</summary>
          <pre class="fx-response">${esc(capture.responseText)}</pre>
        </details>`);
  }

  // 3. Tool calls — expanded with full args, full results, and signals
  if (Array.isArray(capture.toolCalls) && capture.toolCalls.length > 0) {
    const rowsHtml = capture.toolCalls
      .map((tc) => {
        const ok = tc.success !== false;
        const icon = ok ? "✓" : "✗";
        const iconClass = ok ? "fx-tc-ok" : "fx-tc-fail";
        const ms = tc.ms ? ` ${tc.ms}ms` : "";
        const argsJson = tc.args != null
          ? `<pre class="fx-tc-args">${esc(JSON.stringify(tc.args, null, 2))}</pre>`
          : "";
        const argsTruncMark = tc.argsTruncated ? ' <span class="fx-trunc">[args truncated]</span>' : "";
        const resultHtml = tc.result
          ? `<pre class="fx-tc-result">${esc(tc.result)}</pre>`
          : "";
        const resultTruncMark = tc.resultTruncated ? ' <span class="fx-trunc">[result truncated]</span>' : "";
        const errorHtml = !ok && tc.error
          ? `<div class="fx-tc-error">${esc(String(tc.error))}</div>`
          : "";
        const signalsHtml = Array.isArray(tc.signals) && tc.signals.length > 0
          ? `<div class="fx-tc-signals">
              <div class="fx-section-label">Signals fired:</div>
              ${tc.signals
                .map((s) => {
                  const icn = SIGNAL_ICONS[s.kind] || "•";
                  return `<div class="fx-signal">${icn} <span class="fx-signal-kind">${esc(s.kind || "?")}</span> ${esc(s.summary || "")}</div>`;
                })
                .join("")}
            </div>`
          : "";
        return `
            <details class="fx-toolcall ${ok ? "" : "fx-toolcall-failed"}">
              <summary>
                <span class="fx-tc-icon ${iconClass}">${icon}</span>
                <span class="fx-tc-name">${esc(tc.tool || "?")}</span>
                <span class="fx-tc-ms">${ms}</span>
                ${argsTruncMark}${resultTruncMark}
              </summary>
              <div class="fx-tc-body">
                ${argsJson ? `<div class="fx-section-label">Args:</div>${argsJson}` : ""}
                ${resultHtml ? `<div class="fx-section-label">Result:</div>${resultHtml}` : ""}
                ${errorHtml ? `<div class="fx-section-label">Error:</div>${errorHtml}` : ""}
                ${signalsHtml}
              </div>
            </details>`;
      })
      .join("");
    parts.push(`
        <details class="fx-section fx-section-tools" open>
          <summary>🔧 Tool calls (${capture.toolCalls.length})</summary>
          <div class="fx-toolcalls">${rowsHtml}</div>
        </details>`);
  }

  // 4. Branch transitions
  if (Array.isArray(capture.branchEvents) && capture.branchEvents.length > 0) {
    const rowsHtml = capture.branchEvents
      .map((ev) => {
        const fromTxt = ev.from ? `${ev.from} → ` : "";
        const reason = ev.reason ? ` <span class="fx-branch-reason">— ${esc(truncate(ev.reason, 120))}</span>` : "";
        return `<div class="fx-branch-event">🎯 <span class="fx-branch-name">${esc(ev.branchName)}</span>: ${esc(fromTxt)}<span class="fx-branch-to">${esc(ev.to)}</span>${reason}</div>`;
      })
      .join("");
    parts.push(`
        <details class="fx-section fx-section-branches">
          <summary>🌿 Branch transitions (${capture.branchEvents.length})</summary>
          <div class="fx-branch-events">${rowsHtml}</div>
        </details>`);
  }

  // 5. Abort reason
  if (capture.abortReason) {
    parts.push(`
        <div class="fx-section fx-section-abort">
          <span class="fx-abort-label">⚠️ Aborted:</span> <span class="fx-abort-reason">${esc(capture.abortReason)}</span>
        </div>`);
  }

  if (parts.length === 0) return "";
  return `<div class="fx-forensics">${parts.join("\n")}</div>`;
};

const renderPhases = (steps, tokenQS, capturesByChatId, childrenByParent) => {
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
            ${hasSubsteps ? `<div class="chain-substeps">${phase.substeps.map((s) => renderSubstep(s, tokenQS, capturesByChatId, childrenByParent)).join("")}</div>` : ""}
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

      return renderSubstep(phase.step, tokenQS, capturesByChatId, childrenByParent);
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

const renderChain = (chain, tokenQS, token, capturesByChatId, childrenByParent, parentByChatId) => {
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

  const toolCalls = Array.isArray(chat.toolCalls) ? chat.toolCalls : [];
  const hasToolCalls = toolCalls.length > 0;
  const toolCallRows = toolCalls
    .map((tc) => {
      const ok = tc.success !== false;
      const icon = ok ? "→" : "✗";
      const iconClass = ok ? "tc-ok" : "tc-fail";
      const argHint = formatToolArgHint(tc.args);
      const ms = tc.ms ? `${tc.ms}ms` : "";
      const err =
        !ok && tc.error
          ? `<div class="tc-error">${esc(String(tc.error).slice(0, 200))}</div>`
          : "";
      return `
        <div class="tc-row">
          <span class="tc-icon ${iconClass}">${icon}</span>
          <span class="tc-name">${esc(tc.tool || "?")}</span>
          ${argHint ? `<span class="tc-args">${esc(argHint)}</span>` : ""}
          ${ms ? `<span class="tc-ms">${ms}</span>` : ""}
          ${err}
        </div>`;
    })
    .join("");

  const stepsHtml = hasSteps ? renderPhases(steps, tokenQS, capturesByChatId, childrenByParent) : "";

  // Dispatched-from block: if this chat was spawned by another chat
  // (branch dispatch, plan expansion, retry, continuation), render a
  // backlink at the top of the chain so the operator can walk up the
  // lineage. Looks at chat.parentChatId → parentByChatId map.
  const dispatchedFromHtml = (() => {
    if (!chat.parentChatId || !parentByChatId) return "";
    const parent = parentByChatId.get(String(chat.parentChatId));
    if (!parent) return "";
    const parentNodeId = parent.treeContext?.targetNodeId || null;
    const parentMode = parent.aiContext?.mode ? `${esc(parent.aiContext.zone || "")}:${esc(parent.aiContext.mode)}` : "";
    const originLabel = ({
      "branch-swarm": "🌿 Dispatched from swarm",
      "plan-expand": "📋 Dispatched from plan item",
      "retry": "🔁 Retry of",
      "continuation": "↪ Continuation of",
    })[chat.dispatchOrigin] || "◀ Dispatched from";
    const linkHref = parentNodeId
      ? `/api/v1/node/${parentNodeId}/chats${tokenQS}`
      : `/api/v1/root/${esc(parent.sessionId || "")}/chats${tokenQS}`;
    return `
      <div class="lineage-from">
        <a class="lineage-from-link" href="${linkHref}">
          <span class="lineage-icon">◀</span>
          <span class="lineage-text">${originLabel} ${parentMode ? `<span class="lineage-mode">${parentMode}</span>` : ""} (chainIndex ${parent.chainIndex ?? "?"})</span>
        </a>
      </div>`;
  })();

  return `
      <li class="note-card">
        ${dispatchedFromHtml}
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
          hasToolCalls
            ? `
        <details class="toolcall-dropdown">
          <summary class="toolcall-summary">
            ${toolCalls.length} tool call${toolCalls.length !== 1 ? "s" : ""}
          </summary>
          <div class="toolcall-list">${toolCallRows}</div>
        </details>`
            : ""
        }

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

.toolcall-dropdown { margin-bottom: 12px; }
.toolcall-summary {
  cursor: pointer; font-size: 13px; font-weight: 600;
  color: rgba(255,255,255,0.85); padding: 8px 14px;
  background: rgba(100,200,255,0.08); border-radius: 10px;
  border: 1px solid rgba(100,200,255,0.2);
  transition: all 0.2s; list-style: none;
  display: flex; align-items: center; gap: 6px;
}
.toolcall-summary::-webkit-details-marker { display: none; }
.toolcall-summary::before { content: ">"; font-size: 10px; transition: transform 0.2s; display: inline-block; }
details[open] .toolcall-summary::before { transform: rotate(90deg); }
.toolcall-summary:hover { background: rgba(100,200,255,0.15); }
.toolcall-list {
  margin-top: 10px; padding: 10px 14px;
  background: rgba(0,0,0,0.2); border-radius: 8px;
  font-family: 'SF Mono', 'Fira Code', monospace; font-size: 12px;
}
.tc-row {
  display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
  padding: 4px 0; color: rgba(255,255,255,0.85);
}
.tc-icon { font-weight: bold; width: 14px; display: inline-block; }
.tc-icon.tc-ok { color: rgba(255,255,255,0.5); }
.tc-icon.tc-fail { color: #ff6b6b; }
.tc-name { color: #7cc7ff; font-weight: 600; }
.tc-args { color: rgba(255,255,255,0.6); }
.tc-ms { color: rgba(255,255,255,0.4); font-size: 11px; }
.tc-error { flex-basis: 100%; padding-left: 22px; color: #ff9999; font-size: 11px; }

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

/* ── AI Forensics sections ── */
.chain-step-captured { opacity: 0.7; margin-left: 4px; font-size: 11px; }
.fx-forensics {
  margin-top: 10px;
  border-top: 1px dashed rgba(255,255,255,0.12);
  padding-top: 10px;
  display: flex; flex-direction: column; gap: 8px;
}
.fx-section > summary {
  cursor: pointer; font-size: 11px; font-weight: 600;
  color: rgba(255,255,255,0.7); padding: 6px 10px;
  background: rgba(100,150,255,0.08); border-radius: 6px;
  list-style: none;
}
.fx-section > summary::-webkit-details-marker { display: none; }
.fx-section > summary::before {
  content: "▸"; display: inline-block; margin-right: 6px;
  transition: transform 0.15s; color: rgba(255,255,255,0.4);
}
.fx-section[open] > summary::before { transform: rotate(90deg); }
.fx-section[open] > summary { background: rgba(100,150,255,0.14); }
.fx-section-prompt > summary { background: rgba(100,200,150,0.08); }
.fx-section-prompt[open] > summary { background: rgba(100,200,150,0.14); }
.fx-section-response > summary { background: rgba(200,150,100,0.08); }
.fx-section-response[open] > summary { background: rgba(200,150,100,0.14); }
.fx-section-tools > summary { background: rgba(150,150,200,0.08); }
.fx-section-tools[open] > summary { background: rgba(150,150,200,0.14); }
.fx-section-branches > summary { background: rgba(100,200,100,0.08); }
.fx-section-branches[open] > summary { background: rgba(100,200,100,0.14); }
.fx-section-abort {
  padding: 8px 10px; background: rgba(255,100,100,0.12);
  border-radius: 6px; font-size: 12px; color: rgba(255,200,200,0.95);
}
.fx-abort-label { font-weight: 700; }
.fx-messages { padding: 6px 0 6px 10px; display: flex; flex-direction: column; gap: 4px; }
.fx-message {
  background: rgba(0,0,0,0.2); border-radius: 4px; padding: 6px 10px;
  border-left: 2px solid rgba(255,255,255,0.15);
  font-size: 11px;
}
.fx-message > summary {
  cursor: pointer; list-style: none;
  display: flex; align-items: center; gap: 8px;
  color: rgba(255,255,255,0.65);
}
.fx-message > summary::-webkit-details-marker { display: none; }
.fx-msg-system { border-left-color: rgba(100,200,150,0.6); }
.fx-msg-user { border-left-color: rgba(100,150,255,0.6); }
.fx-msg-assistant { border-left-color: rgba(200,150,100,0.6); }
.fx-msg-tool { border-left-color: rgba(150,150,200,0.6); }
.fx-msg-role {
  font-weight: 600; text-transform: uppercase; font-size: 10px;
  letter-spacing: 0.5px; color: rgba(255,255,255,0.8);
}
.fx-msg-name { font-size: 10px; color: rgba(255,255,255,0.5); }
.fx-msg-size { font-size: 10px; color: rgba(255,255,255,0.4); margin-left: auto; }
.fx-msg-content, .fx-msg-toolcalls, .fx-response, .fx-tc-args, .fx-tc-result {
  margin: 6px 0 0; padding: 8px 10px;
  background: rgba(0,0,0,0.35); border-radius: 4px;
  font-family: ui-monospace, Menlo, monospace; font-size: 11px;
  color: rgba(255,255,255,0.85); white-space: pre-wrap; word-break: break-word;
  max-height: 400px; overflow: auto;
}
.fx-response { max-height: 500px; }
.fx-trunc {
  color: rgba(255,180,100,0.8); font-size: 10px; font-weight: 600;
  margin-left: 4px;
}
.fx-toolcalls { padding: 6px 0 6px 10px; display: flex; flex-direction: column; gap: 4px; }
.fx-toolcall {
  background: rgba(0,0,0,0.25); border-radius: 4px; padding: 6px 10px;
  border-left: 2px solid rgba(100,200,100,0.5);
}
.fx-toolcall-failed { border-left-color: rgba(255,100,100,0.7); }
.fx-toolcall > summary {
  cursor: pointer; list-style: none;
  display: flex; align-items: center; gap: 8px;
  color: rgba(255,255,255,0.85); font-size: 11px;
}
.fx-toolcall > summary::-webkit-details-marker { display: none; }
.fx-tc-icon { font-weight: 700; }
.fx-tc-ok { color: rgba(100,255,150,0.9); }
.fx-tc-fail { color: rgba(255,120,120,0.9); }
.fx-tc-name { font-weight: 600; font-family: ui-monospace, Menlo, monospace; }
.fx-tc-ms { color: rgba(255,255,255,0.4); font-size: 10px; margin-left: auto; }
.fx-tc-body { padding: 6px 0 0; }
.fx-tc-error {
  padding: 6px 10px; background: rgba(255,100,100,0.15);
  border-radius: 4px; color: rgba(255,220,220,0.95); font-size: 11px;
}
.fx-tc-signals { margin-top: 8px; padding: 6px 10px;
  background: rgba(255,150,100,0.08); border-radius: 4px; font-size: 11px;
}
.fx-signal { padding: 2px 0; color: rgba(255,220,180,0.9); }
.fx-signal-kind {
  display: inline-block; padding: 1px 6px; margin: 0 4px;
  background: rgba(255,255,255,0.1); border-radius: 3px;
  font-size: 10px; font-weight: 600; text-transform: uppercase;
}
.fx-section-label {
  font-size: 10px; font-weight: 600; color: rgba(255,255,255,0.5);
  text-transform: uppercase; letter-spacing: 0.5px;
  margin: 6px 0 2px;
}
.fx-branch-events { padding: 6px 10px; display: flex; flex-direction: column; gap: 4px; }
.fx-branch-event { font-size: 11px; color: rgba(255,255,255,0.85); }
.fx-branch-name { font-weight: 600; color: rgba(150,220,200,0.95); }
.fx-branch-to {
  font-weight: 700; padding: 1px 6px; border-radius: 3px;
  background: rgba(100,200,150,0.15); color: rgba(150,255,200,0.95);
}
.fx-branch-reason { color: rgba(255,255,255,0.5); font-style: italic; }

/* ── Dispatch lineage (dispatched from / to) ── */
.lineage-from {
  padding: 6px 12px; margin-bottom: 8px;
  background: rgba(150,100,255,0.08);
  border-left: 3px solid rgba(150,100,255,0.5);
  border-radius: 4px;
  font-size: 11px;
}
.lineage-from-link {
  color: rgba(220,200,255,0.95);
  text-decoration: none;
  display: inline-flex; align-items: center; gap: 6px;
}
.lineage-from-link:hover {
  text-shadow: 0 0 8px rgba(200,150,255,0.5);
}
.lineage-icon {
  font-weight: 700; color: rgba(200,150,255,0.8);
}
.lineage-mode {
  background: rgba(255,255,255,0.1); padding: 1px 6px;
  border-radius: 3px; font-family: ui-monospace, Menlo, monospace;
  font-size: 10px; margin: 0 4px;
}
.lineage-to {
  margin-top: 10px; padding: 8px 10px;
  background: rgba(100,200,150,0.08);
  border-left: 3px solid rgba(100,200,150,0.5);
  border-radius: 4px;
}
.lineage-to-label {
  font-size: 11px; font-weight: 600;
  color: rgba(180,255,200,0.9);
  text-transform: uppercase; letter-spacing: 0.5px;
  margin-bottom: 6px;
}
.lineage-to-row {
  display: flex; align-items: center; gap: 8px;
  padding: 4px 6px; border-radius: 3px;
  text-decoration: none; font-size: 11px;
  color: rgba(220,255,230,0.9);
  transition: background 0.15s;
}
.lineage-to-row:hover {
  background: rgba(100,200,150,0.15);
}
.lineage-to-name {
  font-weight: 600; font-family: ui-monospace, Menlo, monospace;
  color: rgba(180,255,200,0.95);
}
.lineage-to-mode {
  background: rgba(255,255,255,0.08); padding: 1px 6px;
  border-radius: 3px; font-size: 10px;
  color: rgba(255,255,255,0.7);
}
.lineage-to-chain {
  margin-left: auto; font-size: 10px; color: rgba(255,255,255,0.4);
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
  capturesByChatId,
  childrenByParent,
  parentByChatId,
}) {
  const sessionGroups = sessions;

  const renderedSections = sessionGroups
    .map((group) => {
      const chatCount = group.chatCount;
      const sessionTime = formatTime(group.startTime);
      const shortId = group.sessionId.slice(0, 8);
      const chains = groupIntoChains(group.chats);
      const chatCards = chains.map((c) => renderChain(c, tokenQS, token, capturesByChatId, childrenByParent, parentByChatId)).join("");

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
export function renderRootChats({ rootId, rootName, sessions, allChats, token, tokenQS, capturesByChatId, childrenByParent, parentByChatId }) {
  return renderNodeChats({
    nodeId: rootId,
    nodeName: rootName,
    nodePath: rootName,
    sessions,
    allChats,
    token,
    tokenQS,
    capturesByChatId,
    childrenByParent,
    parentByChatId,
  });
}
