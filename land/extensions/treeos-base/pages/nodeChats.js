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
import { buildLink } from "../../html-rendering/htmlHelpers.js";

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

/**
 * Render the unified audit block for a single chat step: "What the AI
 * saw". One source of truth, no duplicate system prompts.
 *
 * Priority order when rendering the prompt + conversation:
 *  1. If a forensics capture exists: use it. Forensics already inlines
 *     the full message array (system + user + assistant + tool) plus
 *     rich tool call bodies and the final LLM response. That IS the
 *     definitive "what AI saw" view.
 *  2. Otherwise: fall back to the structured fields (chat.systemPrompt,
 *     chat.toolCalls). Older records and background jobs that have no
 *     forensics attached still get a usable audit trail.
 *
 * On top of whichever prompt source we pick, we always surface the
 * fields that aren't inside forensics' message array:
 *   • enrichedContext  — the accumulated hook output as a raw object
 *   • modeHistory      — mode switches within this step's chain
 *   • room link        — when a room-agent produced this chat
 *
 * Returns "" if there's genuinely nothing to show.
 */
const renderAiAudit = (chat, capture, tokenQS, token) => {
  const sections = [];

  // Primary prompt source. When forensics capture is present its
  // message list covers system prompt + conversation + tool traces.
  if (capture) {
    // Reuse the existing forensics renderer; it handles the full
    // promptMessages + tool call pairing + response + correlation.
    sections.push(renderForensicsSections(capture, { tokenQS, token }));
  } else if (chat.systemPrompt || (Array.isArray(chat.toolCalls) && chat.toolCalls.length > 0)) {
    // Fallback: structured fields.
    const blocks = [];
    if (chat.systemPrompt) {
      blocks.push(`
        <details class="audit-sub" open>
          <summary><span class="audit-sub-label">System prompt</span></summary>
          <pre class="audit-pre">${esc(String(chat.systemPrompt))}</pre>
        </details>`);
    }
    if (Array.isArray(chat.toolCalls) && chat.toolCalls.length > 0) {
      const rows = chat.toolCalls.map((tc) => {
        const ok = tc.success !== false;
        const icon = ok ? "✓" : "✗";
        const iconClass = ok ? "audit-tc-ok" : "audit-tc-fail";
        const argHint = formatToolArgHint(tc.args);
        const ms = tc.ms ? `${tc.ms}ms` : "";
        const argsBlock = tc.argsFull != null
          ? `<pre class="audit-pre">${esc(typeof tc.argsFull === "string" ? tc.argsFull : JSON.stringify(tc.argsFull, null, 2))}</pre>`
          : "";
        const resultBlock = tc.resultFull
          ? `<pre class="audit-pre">${esc(tc.resultFull)}</pre>`
          : "";
        const errBlock = !ok && tc.error ? `<div class="audit-tc-error">${esc(String(tc.error))}</div>` : "";
        const truncMark = tc.truncated ? ` <span class="audit-trunc">[truncated]</span>` : "";
        return `
          <details class="audit-sub">
            <summary>
              <span class="audit-tc-icon ${iconClass}">${icon}</span>
              <span class="audit-tc-name">${esc(tc.tool || "?")}</span>
              ${argHint ? `<span class="audit-tc-args">${esc(argHint)}</span>` : ""}
              ${ms ? `<span class="audit-tc-ms">${ms}</span>` : ""}
              ${truncMark}
            </summary>
            ${argsBlock ? `<div class="audit-sub-label">args</div>${argsBlock}` : ""}
            ${resultBlock ? `<div class="audit-sub-label">result</div>${resultBlock}` : ""}
            ${errBlock}
          </details>`;
      }).join("");
      blocks.push(`
        <div class="audit-toolcalls">
          <div class="audit-block-label">🔧 Tool calls (${chat.toolCalls.length})</div>
          ${rows}
        </div>`);
    }
    sections.push(blocks.join(""));
  }

  // enrichContext — the accumulated extension context, raw object.
  if (chat.enrichedContext && typeof chat.enrichedContext === "object") {
    const keys = Object.keys(chat.enrichedContext);
    if (keys.length > 0) {
      let body;
      try { body = JSON.stringify(chat.enrichedContext, null, 2); }
      catch { body = "(unserializable)"; }
      sections.push(`
        <details class="audit-sub">
          <summary><span class="audit-sub-label">enrichContext</span> <span class="audit-sub-hint">${keys.length} key${keys.length !== 1 ? "s" : ""}: ${esc(keys.slice(0, 6).join(", "))}</span></summary>
          <pre class="audit-pre">${esc(body)}</pre>
        </details>`);
    }
  }

  // modeHistory — timeline of mode switches within this step.
  if (Array.isArray(chat.modeHistory) && chat.modeHistory.length > 1) {
    const items = chat.modeHistory
      .map((m) => `<li><span class="mh-mode">${esc(m.modeKey)}</span>${m.reason ? ` <span class="mh-reason">${esc(m.reason)}</span>` : ""}${m.at ? ` <span class="mh-at">${esc(formatTime(m.at))}</span>` : ""}</li>`)
      .join("");
    sections.push(`
      <details class="audit-sub">
        <summary><span class="audit-sub-label">Mode history</span> <span class="audit-sub-hint">${chat.modeHistory.length} switches</span></summary>
        <ul class="audit-mode-history">${items}</ul>
      </details>`);
  }

  // Room link — surfaces when a room-agent produced this chat.
  const roomId = chat.treeContext?.roomNodeId;
  if (roomId) {
    const href = `/rooms/${roomId}${tokenQS}`;
    sections.push(`
      <div class="audit-room-link">via room <a href="${href}">${esc(String(roomId).slice(0, 8))}</a></div>`);
  }

  const body = sections.filter(Boolean).join("");
  if (!body) return "";
  return body;
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


const renderSubstep = (chat, tokenQS, capturesByChatId, childrenByParent, stepIds, ctx) => {
  const capture = capturesByChatId?.get?.(String(chat._id)) || null;
  const allKids = childrenByParent?.get?.(String(chat._id)) || [];
  // Split children into "in this page's session set" (inline-render as
  // nested substeps) vs "elsewhere" (fallback to link previews). The
  // in-session kids are what gives the page a real dispatch tree —
  // architect → [backend, frontend, lobby] shown nested — without
  // rendering them twice.
  const inSessionKids = stepIds
    ? allKids.filter((k) => stepIds.has(String(k._id)))
    : [];
  const offSessionKids = stepIds
    ? allKids.filter((k) => !stepIds.has(String(k._id)))
    : allKids;
  const dispatchedChildren = offSessionKids;
  const duration = formatDuration(
    chat.startMessage?.time,
    chat.endMessage?.time,
  );
  const stopped = chat.endMessage?.stopped;
  const tc = chat.treeContext;
  const targetName = getTargetName(tc);
  const inputFull = formatContent(chat.startMessage?.content);
  const outputFull = formatContent(chat.endMessage?.content);

  // Tool-call counts used in the mini header; the full per-tool
  // rendering lives inside renderAiAudit now (forensics when present,
  // structured-field fallback otherwise).
  const toolCalls = Array.isArray(chat.toolCalls) ? chat.toolCalls : [];
  const dispatchedToHtml = dispatchedChildren.length > 0
    ? renderDispatchedTo(dispatchedChildren, tokenQS)
    : "";

  // Nested child chats — chats this one dispatched that ARE in this
  // page's set. Rendered inline under the parent as a visual dispatch
  // tree so the reader sees architect → [backend, frontend, ...] as
  // nesting, not flat siblings.
  const nestedKidsHtml = inSessionKids.length > 0
    ? `<div class="chain-children">${inSessionKids
        .slice()
        .sort((a, b) => {
          const ta = new Date(a.startMessage?.time || 0).getTime();
          const tb = new Date(b.startMessage?.time || 0).getTime();
          return ta - tb;
        })
        .map((k) => renderSubstep(k, tokenQS, capturesByChatId, childrenByParent, stepIds, ctx))
        .join("")}</div>`
    : "";

  // Self-link: clicking the chat's own id jumps into its focused
  // subtree view. Only rendered when ctx knows the parent nodeId so we
  // can build the /node/:nodeId/chats/chat/:chatId URL.
  const focusHref = ctx?.nodeId && ctx?.req
    ? buildLink(ctx.req, `/api/v1/node/${ctx.nodeId}/chats/chat/${chat._id}`)
    : null;

  // Role tag — used for color-coding the card's top stripe so the
  // operator can distinguish architect / branch / worker / translator
  // at a glance without reading the mode label.
  const mode = chat.aiContext?.mode || "";
  const origin = chat.dispatchOrigin || "";
  const roleClass =
    mode === "translator" ? "card-role-translator"
    : origin === "branch-swarm" ? "card-role-branch"
    : origin === "continuation" && inSessionKids.length > 0 ? "card-role-architect"
    : origin === "continuation" ? "card-role-worker"
    : "card-role-step";

  const statusTag = stopped
    ? `<span class="card-status card-status-stopped">stopped</span>`
    : tc?.stepResult === "failed"
      ? `<span class="card-status card-status-failed">failed</span>`
      : chat.endMessage?.time
        ? `<span class="card-status card-status-done">done</span>`
        : `<span class="card-status card-status-pending">pending</span>`;

  const shortChatId = String(chat._id).slice(0, 8);

  return `
      <article class="chat-card ${roleClass}">
        <header class="chat-card-header">
          <span class="chat-card-dot"></span>
          <span class="chat-card-role">${modeLabel(mode)}</span>
          ${targetName ? `<span class="chat-card-target">${esc(targetName)}</span>` : ""}
          ${statusTag}
          ${duration ? `<span class="chat-card-duration">${duration}</span>` : ""}
          <span class="chat-card-spacer"></span>
          ${renderModelBadge(chat)}
          ${toolCalls.length ? `<span class="chat-card-counts">${toolCalls.length} tool${toolCalls.length !== 1 ? "s" : ""}</span>` : ""}
          ${inSessionKids.length ? `<span class="chat-card-counts">↳ ${inSessionKids.length}</span>` : ""}
          ${capture ? `<span class="chat-card-counts" title="AI forensics capture available">📸</span>` : ""}
          ${focusHref
            ? `<a class="chat-card-id" href="${focusHref}" title="Zoom to this chat + its dispatch subtree">${shortChatId}</a>`
            : `<span class="chat-card-id">${shortChatId}</span>`}
        </header>
        <div class="chat-card-body">
          <section class="chat-section chat-section-in">
            <div class="chat-section-label">INPUT</div>
            <div class="chat-section-content">${inputFull}</div>
          </section>
          ${outputFull ? `
          <section class="chat-section chat-section-out">
            <div class="chat-section-label">RESULT</div>
            <div class="chat-section-content">${outputFull}</div>
          </section>` : ""}
          ${(() => {
            // One consolidated "What the AI saw" toggle. Input/output
            // above stay always-visible; everything else lives here:
            // the audit trail (system prompt + conversation + tool
            // calls + enrichContext + mode history), tree context,
            // directive, and dispatched-to children. No more splitting
            // system prompt across two blocks.
            const audit = renderAiAudit(chat, capture, tokenQS, ctx?.req?.query?.token);
            const extras = [
              renderTreeContext(tc, tokenQS),
              renderDirective(tc),
              audit,
              dispatchedToHtml,
            ].filter(Boolean).join("");
            if (!extras) return "";
            return `
              <details class="chat-expand">
                <summary class="chat-expand-summary">What the AI saw</summary>
                <div class="chat-expand-body">${extras}</div>
              </details>`;
          })()}
        </div>
        ${nestedKidsHtml}
      </article>`;
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

const renderForensicsSections = (capture, ctx = {}) => {
  const ctxReq = ctx.req || { query: {} };
  const ctxNodeId = ctx.nodeId || null;
  const chatLink = (chatId) =>
    ctxNodeId
      ? buildLink(ctxReq, `/api/v1/node/${ctxNodeId}/chats/chat/${chatId}`)
      : "#";
  const nodeLink = (nodeId) => buildLink(ctxReq, `/api/v1/node/${nodeId}/chats`);
  const signalLink = (signalId) => buildLink(ctxReq, `/api/v1/flow/signal/${signalId}`);
  if (!capture) return "";
  const parts = [];

  // Build a toolCalls lookup so assistant-tool-calls in the conversation
  // can be annotated with the matching capture.toolCalls entry (which
  // carries the richer data: signals, duration, error).
  const richToolCalls = Array.isArray(capture.toolCalls) ? capture.toolCalls.slice() : [];
  const shiftRichCall = () => richToolCalls.shift() || null;

  // Conversation timeline — every promptMessage rendered inline in
  // chronological order, no collapsibles. Tool-role messages show
  // their result. Assistant messages with tool_calls show the call
  // inline with the rich result (from capture.toolCalls) right below.
  const pm = Array.isArray(capture.promptMessages) ? capture.promptMessages : [];
  if (pm.length > 0) {
    const bytesLabel = capture.promptBytes
      ? `${Math.round(capture.promptBytes / 1024)}KB${capture.promptTruncated ? " · truncated" : ""}`
      : "";

    const msgHtml = pm.map((m) => {
      const role = String(m.role || "unknown").toLowerCase();
      const roleClass = `fx-msg-${esc(role)}`;
      const truncMark = m.truncated ? ' <span class="fx-trunc">[truncated]</span>' : "";
      const sizeBadge = m.content
        ? `<span class="fx-msg-size">${Buffer.byteLength(m.content || "", "utf8")}b</span>`
        : "";
      const nameBadge = m.name ? `<span class="fx-msg-name">${esc(m.name)}</span>` : "";
      const contentBlock = m.content ? `<pre class="fx-msg-content">${esc(m.content)}</pre>` : "";

      // Tool call emitted by the assistant — show the name + args, and
      // try to inline the matching rich tool-call entry with result.
      let toolCallsBlock = "";
      if (m.tool_calls && Array.isArray(m.tool_calls) && m.tool_calls.length > 0) {
        const rows = m.tool_calls.map((tc) => {
          const name = esc(tc.function?.name || tc.name || "?");
          let argsStr = tc.function?.arguments ?? tc.arguments ?? "";
          if (typeof argsStr !== "string") {
            try { argsStr = JSON.stringify(argsStr, null, 2); } catch { argsStr = String(argsStr); }
          }
          // Pair with the next rich call entry (same order).
          const rich = shiftRichCall();
          const richBlock = rich ? renderRichToolCall(rich) : "";
          return `
            <div class="fx-toolcall-inline">
              <div class="fx-toolcall-name">→ <strong>${name}</strong></div>
              <pre class="fx-toolcall-args">${esc(argsStr)}</pre>
              ${richBlock}
            </div>`;
        }).join("");
        toolCallsBlock = `<div class="fx-toolcalls-inline">${rows}</div>`;
      }

      return `
        <div class="fx-message ${roleClass}">
          <div class="fx-msg-header">
            <span class="fx-msg-role">${esc(role)}</span>
            ${nameBadge}${truncMark}${sizeBadge}
          </div>
          ${contentBlock}
          ${toolCallsBlock}
        </div>`;
    }).join("");

    parts.push(`
        <div class="fx-section fx-section-prompt">
          <div class="fx-section-header">📖 What the AI saw${bytesLabel ? ` <span class="fx-section-meta">(${bytesLabel})</span>` : ""}</div>
          <div class="fx-messages">${msgHtml}</div>
        </div>`);
  }

  // Any rich tool-call entries we didn't pair with a promptMessages
  // tool_call (can happen when the capture was truncated) — render the
  // leftovers so their results aren't lost.
  if (richToolCalls.length > 0) {
    const rows = richToolCalls.map(renderRichToolCall).join("");
    parts.push(`
        <div class="fx-section fx-section-tools">
          <div class="fx-section-header">🔧 Tool calls (unpaired)</div>
          <div class="fx-toolcalls">${rows}</div>
        </div>`);
  }

  // Final LLM response — raw, inline, no collapse.
  if (capture.responseText && capture.responseText.length > 0) {
    const truncMark = capture.responseTruncated ? ' <span class="fx-trunc">[truncated]</span>' : "";
    parts.push(`
        <div class="fx-section fx-section-response">
          <div class="fx-section-header">💬 LLM response${truncMark}</div>
          <pre class="fx-response">${esc(capture.responseText)}</pre>
        </div>`);
  }

  // Lineage and correlation — one-line inline rows at the bottom.
  // Every ID in here is a real link so the operator can walk the
  // dispatch tree and cascade trails by clicking.
  const correlationRows = [];
  if (capture.parentChatId) {
    const pid = String(capture.parentChatId);
    correlationRows.push(`<div class="fx-correlation">↑ dispatched from <a class="fx-id-link" href="${chatLink(pid)}">${esc(pid.slice(0, 8))}</a></div>`);
  }
  if (Array.isArray(capture.cascadesEmitted) && capture.cascadesEmitted.length > 0) {
    for (const c of capture.cascadesEmitted) {
      const sid = String(c.signalId);
      correlationRows.push(`<div class="fx-correlation">📡 cascade emitted <a class="fx-id-link" href="${signalLink(sid)}">${esc(sid.slice(0, 8))}</a>${c.status ? ` · ${esc(c.status)}` : ""}</div>`);
    }
  }
  if (Array.isArray(capture.cascadesReceived) && capture.cascadesReceived.length > 0) {
    for (const c of capture.cascadesReceived) {
      const sid = String(c.signalId);
      const src = c.sourceNodeId
        ? ` from <a class="fx-id-link" href="${nodeLink(String(c.sourceNodeId))}">${esc(String(c.sourceNodeId).slice(0, 8))}</a>`
        : "";
      correlationRows.push(`<div class="fx-correlation">📥 cascade received <a class="fx-id-link" href="${signalLink(sid)}">${esc(sid.slice(0, 8))}</a>${src}</div>`);
    }
  }
  if (Array.isArray(capture.swarmSignalsEmitted) && capture.swarmSignalsEmitted.length > 0) {
    for (const s of capture.swarmSignalsEmitted) {
      const fp = s.filePath ? ` · ${esc(s.filePath)}` : "";
      const toId = String(s.toNodeId);
      correlationRows.push(`<div class="fx-correlation">↪ ${esc(s.kind)} → <a class="fx-id-link" href="${nodeLink(toId)}">${esc(toId.slice(0, 8))}</a>${fp}</div>`);
    }
  }
  if (Array.isArray(capture.branchEvents) && capture.branchEvents.length > 0) {
    for (const ev of capture.branchEvents) {
      const fromTxt = ev.from ? `${esc(ev.from)} → ` : "";
      const reason = ev.reason ? ` <span class="fx-branch-reason">— ${esc(truncate(ev.reason, 120))}</span>` : "";
      correlationRows.push(`<div class="fx-correlation">🌿 <strong>${esc(ev.branchName)}</strong>: ${fromTxt}${esc(ev.to)}${reason}</div>`);
    }
  }
  if (correlationRows.length > 0) {
    parts.push(`
        <div class="fx-section fx-section-correlation">
          <div class="fx-correlation-rows">${correlationRows.join("")}</div>
        </div>`);
  }

  if (capture.abortReason) {
    parts.push(`
        <div class="fx-section fx-section-abort">
          <span class="fx-abort-label">⚠️ Aborted:</span> <span class="fx-abort-reason">${esc(capture.abortReason)}</span>
        </div>`);
  }

  if (parts.length === 0) return "";
  return `<div class="fx-forensics">${parts.join("\n")}</div>`;
};

// Single rich tool-call entry renderer — args + result + signals inline,
// no <details> wrapper. Used both inline (paired with assistant
// tool_calls) and in the unpaired fallback.
const renderRichToolCall = (tc) => {
  const ok = tc.success !== false;
  const ms = tc.ms ? `${tc.ms}ms` : "";
  const argsTruncMark = tc.argsTruncated ? ' <span class="fx-trunc">[args truncated]</span>' : "";
  const resultTruncMark = tc.resultTruncated ? ' <span class="fx-trunc">[result truncated]</span>' : "";
  const argsBlock = tc.args != null
    ? `<pre class="fx-tc-args">${esc(typeof tc.args === "string" ? tc.args : JSON.stringify(tc.args, null, 2))}</pre>`
    : "";
  const resultBlock = tc.result
    ? `<pre class="fx-tc-result">${esc(tc.result)}</pre>`
    : "";
  const errBlock = !ok && tc.error
    ? `<div class="fx-tc-error">${esc(String(tc.error))}</div>`
    : "";
  const signals = Array.isArray(tc.signals) && tc.signals.length > 0
    ? `<div class="fx-tc-signals">${tc.signals.map((s) => {
        const icn = SIGNAL_ICONS[s.kind] || "•";
        return `<div class="fx-signal">${icn} <span class="fx-signal-kind">${esc(s.kind || "?")}</span> ${esc(s.summary || "")}</div>`;
      }).join("")}</div>`
    : "";
  return `
    <div class="fx-rich-tool ${ok ? "" : "fx-rich-tool-failed"}">
      <div class="fx-rich-tool-head">
        <span class="fx-tc-icon ${ok ? "fx-tc-ok" : "fx-tc-fail"}">${ok ? "✓" : "✗"}</span>
        <span class="fx-tc-name">${esc(tc.tool || "?")}</span>
        ${ms ? `<span class="fx-tc-ms">${ms}</span>` : ""}
        ${argsTruncMark}${resultTruncMark}
      </div>
      ${argsBlock ? `<div class="fx-rich-label">args</div>${argsBlock}` : ""}
      ${resultBlock ? `<div class="fx-rich-label">result</div>${resultBlock}` : ""}
      ${errBlock}
      ${signals}
    </div>`;
};

// Flat chain render — every top-level step becomes a chat-card and each
// card recursively renders its in-page children via renderSubstep's
// nestedKidsHtml branch. No more phase-type dispatch or dropdown wrap.
const renderPhases = (steps, tokenQS, capturesByChatId, childrenByParent, ctx) => {
  const stepIds = new Set(steps.map((s) => String(s._id)));
  const topLevel = steps.filter((s) => {
    const pid = s.parentChatId ? String(s.parentChatId) : null;
    return !pid || !stepIds.has(pid);
  });
  if (topLevel.length === 0) return "";
  topLevel.sort((a, b) => {
    const ta = new Date(a.startMessage?.time || 0).getTime();
    const tb = new Date(b.startMessage?.time || 0).getTime();
    if (ta !== tb) return ta - tb;
    return (a.chainIndex || 0) - (b.chainIndex || 0);
  });
  return `<div class="chat-card-tree">${
    topLevel.map((s) => renderSubstep(s, tokenQS, capturesByChatId, childrenByParent, stepIds, ctx)).join("")
  }</div>`;
};

const renderChain = (chain, tokenQS, token, capturesByChatId, childrenByParent, parentByChatId, ctx) => {
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

  // Tool-call counts for the header badge; the full per-tool listing
  // lives inside renderAiAudit (either via the forensics capture or
  // the structured-field fallback).
  const toolCalls = Array.isArray(chat.toolCalls) ? chat.toolCalls : [];

  // The root chat's own audit block (system prompt, enrichContext,
  // tool calls, forensics). Rendered inside the chain-expand so the
  // default view stays input/output only.
  const rootAudit = renderAiAudit(
    chat,
    capturesByChatId?.get?.(String(chat._id)) || null,
    tokenQS,
    token,
  );

  const stepsHtml = hasSteps ? renderPhases(steps, tokenQS, capturesByChatId, childrenByParent, ctx) : "";

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

  // Assemble the chain-level expand once. Default view is just the
  // user's question + the final answer; expand reveals:
  //   • root chat's audit (systemPrompt + conversation + tool calls)
  //   • each continuation step as its own card (with its own audit)
  //   • contributions table
  const contribsSection = hasContribs
    ? `
        <section class="chain-inner-section">
          <div class="chain-inner-label">CONTRIBUTIONS <span class="chain-inner-count">${contribs.length}</span></div>
          <div class="contrib-table-wrap">
            <table class="contrib-table">
              <thead><tr><th>Action</th><th>Node</th><th></th><th>Time</th></tr></thead>
              <tbody>${contribRows}</tbody>
            </table>
          </div>
        </section>`
    : "";

  const expandParts = [rootAudit, stepsHtml, contribsSection].filter(Boolean).join("");
  const stepCount = steps.length;
  const expandLabel = stepCount > 0
    ? `Show ${stepCount} step${stepCount !== 1 ? "s" : ""} + audit`
    : "What the AI saw";

  const expandBlock = expandParts ? `
        <details class="chain-expand">
          <summary class="chain-expand-summary">${expandLabel}</summary>
          <div class="chain-expand-body">${expandParts}</div>
        </details>` : "";

  const toolsBadge = toolCalls.length
    ? `<span class="badge badge-count">${toolCalls.length} tool${toolCalls.length !== 1 ? "s" : ""}</span>` : "";
  const stepsBadge = stepCount
    ? `<span class="badge badge-count">${stepCount} step${stepCount !== 1 ? "s" : ""}</span>` : "";

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
            ${toolsBadge}
            ${stepsBadge}
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

        ${expandBlock}

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
/* Cards render at full opacity immediately. Previously .note-card
   started at opacity:0 and an IntersectionObserver added .visible to
   fade them in; big cards (long system prompts, many nested kids)
   would sometimes fail to trigger the observer and stayed invisible.
   Correctness wins over the fade-in flourish. */
.note-card { opacity: 1; transform: none; }

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

/* Tree-context strip shown above chat cards when a chat targets a
   specific node. Kept because renderTreeContext still emits it. */
.tree-context-bar {
  display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
  padding: 6px 10px; margin: 0 0 6px 0;
  background: rgba(255,255,255,0.04); border-radius: 4px; font-size: 11px;
}
.tree-target-link {
  color: rgba(100,220,255,0.95); text-decoration: none;
  border-bottom: 1px dotted rgba(100,220,255,0.3);
  font-weight: 600; font-size: 11px;
}
.tree-target-link:hover { border-bottom-color: rgba(100,220,255,0.8); color: rgba(180,235,255,1); }
.tree-target-name { color: rgba(255,255,255,0.8); font-weight: 600; font-size: 11px; }
.tree-directive {
  padding: 4px 10px 6px; font-size: 11px; color: rgba(255,255,255,0.55);
  line-height: 1.5; font-style: italic;
  border-left: 2px solid rgba(255,255,255,0.15); margin: 0 0 6px 0;
}

/* Fallback lean tool-call list shown for chats WITHOUT a forensic
   capture. Captures render the rich flat version instead. */
.chain-step-tool-calls {
  display: flex; flex-direction: column; gap: 3px;
  margin: 6px 0; padding: 6px 8px;
  background: rgba(0,0,0,0.22); border-radius: 4px;
  border-left: 2px solid rgba(150,150,200,0.35);
}
.tc-title { font-size: 9px; font-weight: 700; color: rgba(255,255,255,0.45); letter-spacing: 0.8px; margin-bottom: 2px; }
.tc-row { display: flex; gap: 6px; align-items: center; font-size: 11px; color: rgba(255,255,255,0.8); font-family: ui-monospace, Menlo, monospace; flex-wrap: wrap; }
.tc-icon { font-weight: 700; }
.tc-ok { color: rgba(125,220,155,0.95); }
.tc-fail { color: rgba(240,140,140,0.95); }
.tc-name { font-weight: 600; color: rgba(200,200,230,0.9); }
.tc-args { color: rgba(255,255,255,0.55); font-size: 10px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 320px; }
.tc-ms { color: rgba(255,255,255,0.35); font-size: 10px; margin-left: auto; }
.tc-error { font-size: 10px; color: rgba(240,140,140,0.9); margin-top: 4px; white-space: pre-wrap; }

/* Model badge — shared by chat-card headers. */
.chain-model {
  font-size: 10px; font-family: ui-monospace, Menlo, monospace;
  color: rgba(255,255,255,0.4); white-space: nowrap;
  overflow: hidden; text-overflow: ellipsis; max-width: 140px;
}

.badge-step { background: rgba(255,255,255,0.1); color: rgba(255,255,255,0.7); font-family: ui-monospace, Menlo, monospace; font-size: 10px; }
.badge-skipped { background: rgba(160,160,160,0.18); color: rgba(255,255,255,0.7); }

/* Root-chat "inline sections" — tool calls + contributions under the
   root card, always visible, no disclosure triangles. */
.root-section { margin-top: 10px; }
.root-section-label {
  font-size: 9px; font-weight: 700; letter-spacing: 0.8px;
  color: rgba(255,255,255,0.45);
  padding: 0 2px 4px 2px;
  display: flex; align-items: center; gap: 6px;
}
.root-section-count {
  background: rgba(255,255,255,0.08); color: rgba(255,255,255,0.65);
  padding: 1px 6px; border-radius: 3px; font-size: 10px; font-weight: 600;
  letter-spacing: 0;
}
.root-section-tools .root-section-label { color: rgba(150,200,255,0.7); }
.root-section-contribs .root-section-label { color: rgba(255,200,150,0.7); }
.toolcall-list {
  padding: 8px 10px;
  background: rgba(0,0,0,0.22); border-radius: 4px;
  border-left: 2px solid rgba(150,200,255,0.35);
  font-family: ui-monospace, Menlo, monospace; font-size: 11px;
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

.contrib-table-wrap {
  padding: 8px 10px;
  background: rgba(0,0,0,0.22); border-radius: 4px;
  border-left: 2px solid rgba(255,200,150,0.35);
  overflow-x: auto; -webkit-overflow-scrolling: touch;
}
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
  .chain-model { max-width: 140px; }
  .msg-text { font-size: 14px; }
  .chat-card-header { gap: 6px; padding: 6px 8px; }
  .chat-card-body { padding: 10px 10px; }
  .chat-card-target { max-width: 120px; overflow: hidden; text-overflow: ellipsis; }
}

/* ── AI Forensics sections — FLAT inline layout, no nested dropdowns ── */
.fx-forensics {
  margin-top: 10px;
  border-top: 1px dashed rgba(255,255,255,0.12);
  padding-top: 10px;
  display: flex; flex-direction: column; gap: 10px;
}
.fx-section {
  display: flex; flex-direction: column; gap: 6px;
}
.fx-section-header {
  font-size: 11px; font-weight: 600;
  color: rgba(255,255,255,0.7); padding: 6px 10px;
  background: rgba(100,150,255,0.08); border-radius: 6px;
}
.fx-section-meta { font-weight: 400; opacity: 0.7; }
.fx-section-prompt .fx-section-header { background: rgba(100,200,150,0.10); }
.fx-section-response .fx-section-header { background: rgba(200,150,100,0.10); }
.fx-section-tools .fx-section-header { background: rgba(150,150,200,0.10); }
.fx-section-correlation .fx-section-header { background: rgba(100,180,220,0.10); }
.fx-section-abort {
  padding: 8px 10px; background: rgba(255,100,100,0.12);
  border-radius: 6px; font-size: 12px; color: rgba(255,200,200,0.95);
}
.fx-abort-label { font-weight: 700; }
.fx-messages { display: flex; flex-direction: column; gap: 6px; padding: 0 0 0 10px; }
.fx-message {
  background: rgba(0,0,0,0.2); border-radius: 4px; padding: 8px 10px;
  border-left: 2px solid rgba(255,255,255,0.15);
  font-size: 11px;
  display: flex; flex-direction: column; gap: 6px;
}
.fx-msg-header {
  display: flex; align-items: center; gap: 8px;
  color: rgba(255,255,255,0.65);
}
.fx-msg-system { border-left-color: rgba(100,200,150,0.6); }
.fx-msg-user { border-left-color: rgba(100,150,255,0.6); }
.fx-msg-assistant { border-left-color: rgba(200,150,100,0.6); }
.fx-msg-tool { border-left-color: rgba(150,150,200,0.6); }
.fx-msg-system .fx-msg-content { max-height: 240px; }
.fx-toolcalls-inline { display: flex; flex-direction: column; gap: 8px; margin-top: 4px; }
.fx-toolcall-inline {
  background: rgba(0,0,0,0.22); border-radius: 4px;
  padding: 6px 10px;
  border-left: 2px solid rgba(200,200,120,0.5);
  font-size: 11px;
}
.fx-toolcall-name { color: rgba(255,255,255,0.85); margin-bottom: 4px; }
.fx-toolcall-args {
  margin: 0; padding: 6px 8px;
  background: rgba(0,0,0,0.3); border-radius: 3px;
  font-family: ui-monospace, Menlo, monospace; font-size: 10px;
  color: rgba(255,255,255,0.75); white-space: pre-wrap; word-break: break-word;
  max-height: 160px; overflow: auto;
}
.fx-rich-tool {
  margin-top: 6px; padding: 6px 8px;
  background: rgba(0,0,0,0.28); border-radius: 3px;
  border-left: 2px solid rgba(100,200,100,0.5);
  display: flex; flex-direction: column; gap: 4px;
}
.fx-rich-tool-failed { border-left-color: rgba(255,100,100,0.7); }
.fx-rich-tool-head { display: flex; align-items: center; gap: 8px; font-size: 11px; }
.fx-rich-label {
  font-size: 9px; font-weight: 700; text-transform: uppercase;
  letter-spacing: 0.5px; color: rgba(255,255,255,0.45);
  margin-top: 2px;
}
.fx-correlation-rows {
  display: flex; flex-direction: column; gap: 4px;
  padding: 6px 10px;
}
.fx-correlation {
  font-size: 11px; color: rgba(255,255,255,0.7);
  padding: 2px 0;
}
.fx-correlation code {
  font-family: ui-monospace, Menlo, monospace; font-size: 10px;
  color: rgba(150,200,255,0.9);
  background: rgba(0,0,0,0.3); padding: 1px 4px; border-radius: 2px;
}
.fx-id-link {
  font-family: ui-monospace, Menlo, monospace; font-size: 10px;
  color: rgba(150,200,255,0.95);
  background: rgba(100,150,255,0.12); padding: 1px 5px; border-radius: 3px;
  text-decoration: none;
  border-bottom: 1px dotted rgba(150,200,255,0.4);
}
.fx-id-link:hover {
  color: rgba(200,225,255,1);
  background: rgba(100,150,255,0.22);
  border-bottom-color: rgba(200,225,255,0.8);
}

/* ── Nested child chats (dispatch tree) ── */
.chain-children {
  margin-top: 10px; padding-left: 18px;
  border-left: 2px solid rgba(200,200,255,0.18);
  display: flex; flex-direction: column; gap: 6px;
}
.chain-step-kidcount {
  font-size: 10px; color: rgba(255,255,255,0.55);
  background: rgba(200,200,255,0.08); padding: 1px 5px; border-radius: 3px;
  margin-left: 4px;
}
.chain-step-focus {
  margin-left: auto; font-size: 12px;
  color: rgba(150,200,255,0.7);
  text-decoration: none;
  padding: 0 6px;
}
.chain-step-focus:hover { color: rgba(200,225,255,1); }

/* ── Zoom breadcrumb (shown when ?chat or ?session focus is active) ── */
.chat-breadcrumb {
  font-size: 12px; color: rgba(255,255,255,0.7);
  padding: 10px 14px; margin: 0 0 12px 0;
  background: rgba(100,150,255,0.06);
  border: 1px solid rgba(100,150,255,0.16);
  border-radius: 6px;
  display: flex; gap: 6px; align-items: center; flex-wrap: wrap;
}
.chat-breadcrumb .crumb {
  color: rgba(150,200,255,0.9);
  text-decoration: none;
  padding: 2px 6px; border-radius: 3px;
  background: rgba(100,150,255,0.08);
}
.chat-breadcrumb .crumb:hover { background: rgba(100,150,255,0.18); color: rgba(200,225,255,1); }
.chat-breadcrumb .crumb-sep { color: rgba(255,255,255,0.35); }
.chat-breadcrumb .crumb-focus {
  color: rgba(200,225,255,1); font-weight: 600;
  padding: 2px 6px; border-radius: 3px;
  background: rgba(100,150,255,0.18);
}
.breadcrumb-escape {
  margin-left: auto; font-size: 11px;
  color: rgba(200,150,100,0.9); text-decoration: underline dotted;
}
.breadcrumb-escape:hover { color: rgba(255,200,150,1); }
.session-id-link {
  color: inherit; text-decoration: none;
  border-bottom: 1px dotted rgba(255,255,255,0.2);
}
.session-id-link:hover { border-bottom-color: rgba(200,225,255,0.8); color: rgba(200,225,255,1); }

/* ─────────────────────────────────────────────────────────────────── */
/* Chat Card — flat, always-visible, color-coded by role, nests into */
/* a dispatch tree via .chain-children indentation.                   */
/* ─────────────────────────────────────────────────────────────────── */
.chat-card {
  display: block;
  margin: 8px 0;
  background: rgba(255,255,255,0.025);
  border: 1px solid rgba(255,255,255,0.08);
  border-left: 3px solid rgba(255,255,255,0.2);
  border-radius: 6px;
  overflow: hidden;
}
.chat-card + .chat-card { margin-top: 6px; }
.chat-card.card-role-translator { border-left-color: rgba(100,100,220,0.55); }
.chat-card.card-role-architect   { border-left-color: rgba(200,150,100,0.7); background: rgba(200,150,100,0.04); }
.chat-card.card-role-branch      { border-left-color: rgba(100,200,150,0.7); background: rgba(100,200,150,0.035); }
.chat-card.card-role-worker      { border-left-color: rgba(150,150,200,0.55); }
.chat-card.card-role-step        { border-left-color: rgba(255,255,255,0.2); }

.chat-card-header {
  display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
  padding: 8px 12px;
  background: rgba(0,0,0,0.2);
  border-bottom: 1px solid rgba(255,255,255,0.06);
  font-size: 12px;
}
.chat-card-dot {
  width: 6px; height: 6px; border-radius: 50%;
  background: rgba(255,255,255,0.35); flex-shrink: 0;
}
.card-role-architect .chat-card-dot { background: rgba(200,150,100,0.9); }
.card-role-branch    .chat-card-dot { background: rgba(100,200,150,0.9); }
.card-role-worker    .chat-card-dot { background: rgba(150,150,200,0.9); }
.card-role-translator .chat-card-dot { background: rgba(100,100,220,0.9); }

.chat-card-role {
  font-size: 11px; font-weight: 600;
  color: rgba(255,255,255,0.85);
  background: rgba(255,255,255,0.1);
  padding: 2px 8px; border-radius: 4px;
}
.chat-card-target {
  font-size: 11px; font-weight: 500;
  color: rgba(100,220,255,0.85);
  padding: 2px 6px;
  border-radius: 3px;
  background: rgba(100,220,255,0.08);
}
.chat-card-duration {
  font-size: 10px; color: rgba(255,255,255,0.4);
  font-family: ui-monospace, Menlo, monospace;
}
.chat-card-spacer { flex: 1; }
.chat-card-counts {
  font-size: 10px; color: rgba(255,255,255,0.55);
  background: rgba(255,255,255,0.06);
  padding: 2px 6px; border-radius: 3px;
}
.chat-card-id {
  font-family: ui-monospace, Menlo, monospace; font-size: 10px;
  color: rgba(150,200,255,0.85);
  background: rgba(100,150,255,0.1);
  padding: 2px 7px; border-radius: 3px;
  text-decoration: none;
  border: 1px solid rgba(100,150,255,0.18);
}
a.chat-card-id:hover {
  color: rgba(200,225,255,1);
  background: rgba(100,150,255,0.22);
  border-color: rgba(150,200,255,0.4);
}

.card-status {
  font-size: 10px; font-weight: 600;
  padding: 2px 6px; border-radius: 3px;
  text-transform: uppercase; letter-spacing: 0.4px;
}
.card-status-done    { background: rgba(72,187,120,0.18); color: rgba(125,220,155,0.95); }
.card-status-failed  { background: rgba(220,90,90,0.18);  color: rgba(240,140,140,0.95); }
.card-status-stopped { background: rgba(220,90,90,0.14);  color: rgba(230,130,130,0.9); }
.card-status-pending { background: rgba(255,200,50,0.15); color: rgba(255,220,120,0.9); }

.chat-card-body {
  padding: 12px 14px;
  display: flex; flex-direction: column; gap: 10px;
}

.chat-section {
  display: flex; flex-direction: column; gap: 4px;
}
.chat-section-label {
  font-size: 9px; font-weight: 700; letter-spacing: 0.8px;
  color: rgba(255,255,255,0.45);
  padding: 0 2px;
}
.chat-section-content {
  font-size: 12px; color: rgba(255,255,255,0.88);
  line-height: 1.55;
  word-break: break-word; white-space: pre-wrap;
  font-family: ui-monospace, Menlo, monospace;
  background: rgba(0,0,0,0.2);
  border-radius: 4px;
  padding: 8px 10px;
  max-height: 280px; overflow: auto;
}
.chat-section-in .chat-section-label  { color: rgba(100,180,230,0.75); }
.chat-section-in .chat-section-content {
  background: rgba(100,180,230,0.05);
  border-left: 2px solid rgba(100,180,230,0.35);
}
.chat-section-out .chat-section-label { color: rgba(125,220,155,0.75); }
.chat-section-out .chat-section-content {
  background: rgba(125,220,155,0.05);
  border-left: 2px solid rgba(125,220,155,0.35);
}

/* Nested children — tree rail + indentation. The ::before pseudo adds
   the vertical rail so the dispatch tree is visually obvious. */
.chat-card > .chain-children {
  margin: 0; padding: 6px 0 6px 20px;
  border-left: 2px dashed rgba(255,255,255,0.08);
  margin-left: 14px; margin-bottom: 10px; margin-right: 10px;
  background: rgba(0,0,0,0.1);
  border-radius: 0 0 4px 4px;
}

/* Forensics block inside the card — flatten panel, remove heavy
   section-header pills so it reads as a continuation of the body. */
.chat-card-body .fx-forensics {
  margin-top: 0; padding-top: 0; border-top: none;
  gap: 10px;
}
.chat-card-body .fx-section-header {
  font-size: 9px; font-weight: 700; letter-spacing: 0.8px;
  color: rgba(255,255,255,0.45);
  background: transparent;
  padding: 0 2px;
}
.chat-card-body .fx-messages { padding: 0; }
.chat-card-body .fx-message {
  background: rgba(0,0,0,0.22);
  padding: 8px 10px;
  border-left-width: 2px;
}
.chat-card-body .fx-msg-content {
  max-height: 240px; overflow: auto;
  background: rgba(0,0,0,0.3);
  font-size: 11px; line-height: 1.55;
}
.chat-card-body .fx-section-correlation {
  background: rgba(100,180,220,0.05);
  border: 1px solid rgba(100,180,220,0.15);
  border-radius: 5px; padding: 6px 10px;
}
.chat-card-body .fx-section-correlation .fx-section-header { display: none; }
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

/* ── chat-card expand (per step card inside the chain-expand).
   Default state = input/output only; the toggle below reveals the
   step's full audit + any dispatched children. */
.chat-expand, .chain-expand {
  margin-top: 8px;
  border-top: 1px dashed rgba(255,255,255,0.08);
  padding-top: 4px;
}
.chat-expand-summary, .chain-expand-summary {
  cursor: pointer; user-select: none;
  font-size: 11px; font-weight: 600; letter-spacing: 0.4px;
  color: rgba(255,255,255,0.55);
  padding: 6px 2px;
  list-style: none;
}
.chat-expand-summary::before, .chain-expand-summary::before {
  content: "▸"; display: inline-block; width: 10px;
  transition: transform 0.15s; margin-right: 4px;
}
.chat-expand[open] > .chat-expand-summary::before,
.chain-expand[open] > .chain-expand-summary::before { transform: rotate(90deg); }
.chat-expand-summary:hover, .chain-expand-summary:hover { color: rgba(255,255,255,0.85); }
.chat-expand-body, .chain-expand-body {
  padding-top: 6px;
  display: flex; flex-direction: column; gap: 10px;
}

/* ── audit block (per-chat "what the AI saw"). Contains the forensics
   capture (if present) plus the structured fields (enrichContext,
   modeHistory, room link). Every sub-section is a <details> with a
   consistent look. */
.audit-sub {
  background: rgba(255,255,255,0.025);
  border-left: 2px solid rgba(150,200,255,0.25);
  border-radius: 3px;
  padding: 4px 8px;
  font-size: 11px;
}
.audit-sub + .audit-sub { margin-top: 3px; }
.audit-sub > summary {
  cursor: pointer; user-select: none;
  color: rgba(255,255,255,0.72);
  padding: 3px 0;
  list-style: none;
  font-weight: 500;
}
.audit-sub > summary::before {
  content: "▸"; display: inline-block; width: 10px;
  transition: transform 0.15s; margin-right: 4px;
}
.audit-sub[open] > summary::before { transform: rotate(90deg); }
.audit-sub > summary:hover { color: rgba(255,255,255,0.95); }
.audit-sub-label { font-weight: 600; color: rgba(200,220,255,0.9); }
.audit-sub-hint { color: rgba(255,255,255,0.5); margin-left: 6px; font-weight: 400; }
.audit-pre {
  max-height: 360px; overflow: auto;
  background: rgba(0,0,0,0.35);
  padding: 8px 10px; margin: 4px 0 2px 0;
  font-size: 11px; line-height: 1.55;
  white-space: pre-wrap;
  border-radius: 3px;
  color: rgba(230,235,240,0.92);
}
.audit-block-label {
  font-size: 10px; font-weight: 700; letter-spacing: 0.6px;
  color: rgba(200,220,255,0.85);
  padding: 6px 0 2px 0;
}
.audit-toolcalls { display: flex; flex-direction: column; gap: 2px; margin-top: 4px; }
.audit-tc-icon { display: inline-block; width: 14px; font-weight: 700; }
.audit-tc-ok { color: rgba(125,220,155,0.95); }
.audit-tc-fail { color: rgba(240,130,130,0.95); }
.audit-tc-name { font-family: 'SF Mono', 'Fira Code', monospace; color: rgba(255,255,255,0.8); margin-right: 4px; }
.audit-tc-args { color: rgba(255,255,255,0.55); font-family: 'SF Mono', 'Fira Code', monospace; font-size: 10px; }
.audit-tc-ms { color: rgba(255,255,255,0.4); font-size: 10px; margin-left: 4px; }
.audit-tc-error {
  color: rgba(240,130,130,0.9); font-size: 11px;
  background: rgba(240,130,130,0.08);
  padding: 4px 8px; margin-top: 4px; border-radius: 3px;
}
.audit-trunc {
  background: rgba(255,200,120,0.15); color: rgba(255,210,140,0.95);
  padding: 1px 4px; border-radius: 3px; font-size: 9px;
  font-weight: 600; margin-left: 4px;
}
.audit-mode-history { margin: 4px 0 2px 0; padding-left: 18px; }
.audit-mode-history li { margin: 2px 0; color: rgba(255,255,255,0.85); font-family: 'SF Mono', 'Fira Code', monospace; font-size: 11px; }
.audit-mode-history .mh-mode { color: rgba(160,220,255,0.95); font-weight: 600; }
.audit-mode-history .mh-reason { color: rgba(255,255,255,0.5); margin-left: 6px; font-weight: 400; }
.audit-mode-history .mh-at { color: rgba(255,255,255,0.35); margin-left: 6px; font-size: 10px; }
.audit-room-link {
  font-size: 11px; color: rgba(255,255,255,0.6);
  padding: 4px 8px;
  background: rgba(150,200,255,0.05);
  border-left: 2px solid rgba(150,200,255,0.3);
  border-radius: 3px;
}
.audit-room-link a { color: rgba(160,210,255,0.95); }

/* Chain-level inner sections (contributions table inside the expand) */
.chain-inner-section {
  background: rgba(255,255,255,0.02);
  border-radius: 4px;
  padding: 8px 10px;
}
.chain-inner-label {
  font-size: 10px; font-weight: 700; letter-spacing: 0.6px;
  color: rgba(255,255,255,0.55);
  margin-bottom: 6px;
}
.chain-inner-count {
  background: rgba(255,255,255,0.08);
  padding: 1px 6px; border-radius: 8px; font-size: 9px;
  color: rgba(255,255,255,0.7); margin-left: 4px;
}
.badge-count {
  background: rgba(255,255,255,0.06);
  border: 1px solid rgba(255,255,255,0.1);
  padding: 2px 6px; border-radius: 8px; font-size: 10px;
  color: rgba(255,255,255,0.7); font-weight: 500;
}
`;

/* ── client-side JS ── */

const js = `
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
  req,
  focusChatId,
  focusSessionId,
  ancestors,
}) {
  const sessionGroups = sessions;

  // ctx flows into every renderer so buildLink can append auth-preserving
  // URLs without each function rebuilding the query string. req can be
  // missing on legacy calls (tests etc.) — fall back to a stub that
  // returns `{}` for query so buildLink emits just the path + `?html`.
  const ctx = {
    req: req || { query: token ? { token, html: "" } : { html: "" } },
    nodeId,
    tokenQS,
    focusChatId: focusChatId || null,
    focusSessionId: focusSessionId || null,
  };

  const renderedSections = sessionGroups
    .map((group) => {
      const chatCount = group.chatCount;
      const sessionTime = formatTime(group.startTime);
      const shortId = group.sessionId.slice(0, 8);
      const sessionHref = buildLink(ctx.req, `/api/v1/node/${nodeId}/chats/session/${group.sessionId}`);
      const chains = groupIntoChains(group.chats);
      const chatCards = chains.map((c) => renderChain(c, tokenQS, token, capturesByChatId, childrenByParent, parentByChatId, ctx)).join("");

      return `
      <div class="session-group">
        <div class="session-pane">
          <div class="session-pane-header">
            <div class="session-header-left">
              <a class="session-id session-id-link" href="${sessionHref}" title="Focus this session">${esc(shortId)}</a>
              <span class="session-info">${chatCount} chat${chatCount !== 1 ? "s" : ""}</span>
            </div>
            <span class="session-time">${sessionTime}</span>
          </div>
          <ul class="notes-list">${chatCards}</ul>
        </div>
      </div>`;
    })
    .join("");

  // Breadcrumb — only rendered when we're focused on a specific chat.
  // Each crumb links to that ancestor's focus URL so the operator can
  // walk up the dispatch lineage one hop at a time. The trailing
  // "Show full session" link clears the chat focus back to the whole
  // session view.
  let breadcrumbHtml = "";
  if (focusChatId && Array.isArray(ancestors) && ancestors.length > 0) {
    const sid = ancestors[0]?.sessionId || (sessions[0]?.sessionId);
    const sessionHref = sid
      ? buildLink(ctx.req, `/api/v1/node/${nodeId}/chats/session/${sid}`)
      : buildLink(ctx.req, `/api/v1/node/${nodeId}/chats`);
    const crumbLinks = ancestors.map((a) => {
      const href = buildLink(ctx.req, `/api/v1/node/${nodeId}/chats/chat/${a._id}`);
      const label = modeLabel(a.aiContext?.mode) || "chat";
      const target = getTargetName(a.treeContext);
      const text = target ? `${label} ${target}` : label;
      return `<a class="crumb" href="${href}">${esc(text)}</a>`;
    }).join(`<span class="crumb-sep">/</span>`);
    const sessionCrumb = `<a class="crumb" href="${sessionHref}">session ${esc(String(sid || "?").slice(0, 8))}</a>`;
    breadcrumbHtml = `
      <div class="chat-breadcrumb">
        ${sessionCrumb}
        ${crumbLinks ? `<span class="crumb-sep">/</span>${crumbLinks}` : ""}
        <span class="crumb-sep">/</span>
        <span class="crumb-focus">[focused chat]</span>
        <a class="breadcrumb-escape" href="${sessionHref}">Show full session</a>
      </div>`;
  } else if (focusSessionId) {
    const clearHref = buildLink(ctx.req, `/api/v1/node/${nodeId}/chats`);
    breadcrumbHtml = `
      <div class="chat-breadcrumb">
        <span class="crumb-focus">session ${esc(focusSessionId.slice(0, 8))}</span>
        <a class="breadcrumb-escape" href="${clearHref}">Show all sessions</a>
      </div>`;
  }

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

    ${breadcrumbHtml}

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
export function renderRootChats({ rootId, rootName, sessions, allChats, token, tokenQS, capturesByChatId, childrenByParent, parentByChatId, req }) {
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
    req,
  });
}
