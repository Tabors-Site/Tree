/**
 * AI Forensics — the capture side of chat observability.
 *
 * Four kernel hooks feed this module:
 *
 *   beforeLLMCall  — starts a pending capture with promptMessages
 *                    (the "what the AI sees" snapshot)
 *   beforeToolCall — opens a tool-call entry + snapshots signalInbox
 *   afterToolCall  — closes the tool-call entry with result + signals
 *                    that fired during it (diff'd via signalInbox)
 *   afterLLMCall   — finalizes the capture with responseText and
 *                    writes to the AiCapture collection
 *
 * Correlation happens via chatId + sessionId fields that the kernel's
 * `conversation.js` now includes in hook data. The pending capture
 * lives in a module-level Map keyed by chatId; stale entries get swept
 * every 60 seconds.
 *
 * Everything is best-effort: every operation is wrapped in try/catch,
 * every failure is logged at debug level, never thrown into the hook
 * chain. The worst case is a missed capture — never a blocked LLM call.
 *
 * The `recordBranchEvent` export is called directly by the swarm
 * runner (not via a hook) every time it upserts a branch status
 * transition. It finds the matching pending capture and appends to
 * branchEvents[], or attaches to the most-recently-finalized capture
 * if no pending exists.
 */

import log from "../../seed/log.js";
import Node from "../../seed/models/node.js";
import AiCapture, { CAPTURE_LIMITS } from "./models/aiCapture.js";

// ─────────────────────────────────────────────────────────────────────
// Module state — in-memory pending captures
// ─────────────────────────────────────────────────────────────────────

/**
 * Pending captures keyed by chatId. Each entry is a draft AiCapture
 * being assembled as the hooks fire. Finalized by afterLLMCall.
 *
 * Multiple captures can coexist if multiple chat steps are running in
 * parallel (different sessions, different users). The chatId is unique
 * per chat record so collisions are impossible within a single LLM
 * call cycle.
 */
const pendingCaptures = new Map();

/**
 * How long to wait before sweeping a pending capture that never got
 * its afterLLMCall. Tool loops with a generous maxSteppedRuns can
 * easily cross a minute, so the sweep window must be long enough to
 * cover an entire multi-step pipeline, not just a single LLM call.
 * 10 minutes matches the kernel's LLM_TIMEOUT_MS ceiling.
 */
const PENDING_TTL_MS = 10 * 60 * 1000;

let _sweepTimer = null;

/**
 * Start the sweep timer. Called once during treeos-base init.
 * Idempotent: subsequent calls are no-ops.
 */
export function startForensicsSweep() {
  if (_sweepTimer) return;
  _sweepTimer = setInterval(async () => {
    const now = Date.now();
    for (const [key, capture] of pendingCaptures.entries()) {
      const age = now - (capture._createdAt || now);
      if (age < PENDING_TTL_MS) continue;
      // Expired. Finalize as stopped + delete.
      try {
        capture.stopped = true;
        capture.abortReason = `capture expired after ${Math.round(age / 1000)}s without afterLLMCall`;
        capture.endedAt = new Date();
        await AiCapture.create(capture);
        log.debug("AiForensics", `Swept expired capture for chat ${key.slice(0, 8)}`);
      } catch (err) {
        log.debug("AiForensics", `sweep failed for ${key}: ${err.message}`);
      }
      pendingCaptures.delete(key);
    }
  }, 30 * 1000);
  _sweepTimer.unref?.();
}

export function stopForensicsSweep() {
  if (_sweepTimer) {
    clearInterval(_sweepTimer);
    _sweepTimer = null;
  }
  pendingCaptures.clear();
}

// ─────────────────────────────────────────────────────────────────────
// Truncation helpers
// ─────────────────────────────────────────────────────────────────────

function byteLen(s) {
  if (typeof s !== "string") return 0;
  return Buffer.byteLength(s, "utf8");
}

function truncateString(s, max) {
  if (typeof s !== "string") return { value: "", truncated: false };
  if (byteLen(s) <= max) return { value: s, truncated: false };
  // Slice by chars (conservative for multi-byte) then add a marker
  const slice = s.slice(0, Math.floor(max * 0.9));
  return { value: slice + "\n… (truncated)", truncated: true };
}

/**
 * Clone + truncate a single message from the OpenAI chat format. Keeps
 * role, content, name, tool_call_id, tool_calls. Content gets
 * per-message cap; tool_calls passes through as-is (already bounded by
 * the LLM response size).
 */
function cleanMessage(m) {
  if (!m || typeof m !== "object") return null;
  const out = { role: m.role || "unknown" };
  if (m.name) out.name = m.name;
  if (m.tool_call_id) out.tool_call_id = m.tool_call_id;
  if (m.tool_calls) out.tool_calls = m.tool_calls;
  if (m.content != null) {
    const contentStr = typeof m.content === "string"
      ? m.content
      : (() => {
          try { return JSON.stringify(m.content); } catch { return String(m.content); }
        })();
    const r = truncateString(contentStr, CAPTURE_LIMITS.PER_MESSAGE_BYTES);
    out.content = r.value;
    out.truncated = r.truncated;
  }
  return out;
}

/**
 * Clean + truncate the full messages array, enforcing both per-message
 * and total-prompt byte caps. Returns { messages, totalBytes, truncated }.
 */
function cleanMessages(messages) {
  if (!Array.isArray(messages)) return { messages: [], totalBytes: 0, truncated: false };
  const out = [];
  let totalBytes = 0;
  let truncated = false;
  for (const m of messages) {
    const cleaned = cleanMessage(m);
    if (!cleaned) continue;
    const msgBytes = byteLen(cleaned.content || "");
    if (totalBytes + msgBytes > CAPTURE_LIMITS.PROMPT_TOTAL_BYTES) {
      // Total cap reached — keep what we have, mark truncated, stop.
      truncated = true;
      break;
    }
    out.push(cleaned);
    totalBytes += msgBytes;
    if (cleaned.truncated) truncated = true;
  }
  return { messages: out, totalBytes, truncated };
}

/**
 * Clone + truncate arbitrary JSON-ish args into a bounded form.
 * Large objects become `{ _truncated: true, _bytes: N, preview: "..." }`.
 */
function cleanArgs(args) {
  if (args == null) return { value: null, truncated: false };
  let serialized;
  try {
    serialized = JSON.stringify(args);
  } catch {
    return { value: { _unserializable: true }, truncated: false };
  }
  if (byteLen(serialized) <= CAPTURE_LIMITS.TOOL_ARGS_BYTES) {
    return { value: args, truncated: false };
  }
  return {
    value: {
      _truncated: true,
      _bytes: byteLen(serialized),
      preview: serialized.slice(0, 1024) + "…",
    },
    truncated: true,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Signal diff — "what signals fired because of this tool call"
// ─────────────────────────────────────────────────────────────────────

/**
 * Read the signalInbox array length and id set for a node. Used
 * as a "snapshot" for pre/post diff to detect signals that fired
 * during a tool call.
 *
 * Returns { count, knownIds } or null if the node isn't a code-workspace
 * node or the read fails. Returning null means "no snapshot taken" —
 * the diff step will skip.
 */
async function snapshotSignalInbox(nodeId) {
  if (!nodeId) return null;
  try {
    const n = await Node.findById(nodeId).select("metadata").lean();
    if (!n) return null;
    const meta = n.metadata instanceof Map
      ? n.metadata.get("code-workspace")
      : n.metadata?.["code-workspace"];
    if (!meta) return null;
    const cascaded = Array.isArray(meta.signalInbox) ? meta.signalInbox : [];
    return {
      count: cascaded.length,
      // A signal's identity is its at+kind+filePath — enough to tell
      // "this is a new entry" from "this is an old one that was still
      // there when the snapshot was taken"
      knownKeys: new Set(
        cascaded.map((s) => `${s.at || ""}|${s.kind || ""}|${s.filePath || ""}`),
      ),
    };
  } catch (err) {
    log.debug("AiForensics", `snapshotSignalInbox failed: ${err.message}`);
    return null;
  }
}

/**
 * Given a pre-tool snapshot, read the current signalInbox and
 * return only the entries that appear after the snapshot was taken.
 * These are the signals that fired during (or immediately after) the
 * tool call.
 *
 * Returns a bounded array of cleaned signal entries, or [] on failure.
 */
async function diffSignalInbox(nodeId, snapshot) {
  if (!nodeId || !snapshot) return [];
  try {
    const n = await Node.findById(nodeId).select("metadata").lean();
    if (!n) return [];
    const meta = n.metadata instanceof Map
      ? n.metadata.get("code-workspace")
      : n.metadata?.["code-workspace"];
    if (!meta) return [];
    const cascaded = Array.isArray(meta.signalInbox) ? meta.signalInbox : [];
    const fresh = [];
    for (const s of cascaded) {
      const key = `${s.at || ""}|${s.kind || ""}|${s.filePath || ""}`;
      if (snapshot.knownKeys.has(key)) continue;
      fresh.push({
        kind: s.kind || "unknown",
        filePath: s.filePath || null,
        summary: summarizeSignal(s),
        payload: s.payload || null,
        at: s.at ? new Date(s.at) : new Date(),
      });
      if (fresh.length >= 10) break; // cap per tool call
    }
    return fresh;
  } catch (err) {
    log.debug("AiForensics", `diffSignalInbox failed: ${err.message}`);
    return [];
  }
}

/**
 * One-line summary of a signal for the renderer, so the UI doesn't
 * have to know how to decode every payload shape. The renderer can
 * still show the raw payload; this is the compact label.
 */
function summarizeSignal(s) {
  const p = s?.payload;
  if (!p || typeof p !== "object") {
    return typeof p === "string" ? p.slice(0, 120) : (s?.kind || "signal");
  }
  switch (s.kind) {
    case "syntax-error":
      return `${p.file || "?"}:${p.line || "?"} ${p.message || "syntax error"}`.slice(0, 160);
    case "dead-receiver":
      return (p.message || "dead receiver").slice(0, 160);
    case "contract-mismatch":
      return `${p.contract?.method || "?"} ${p.contract?.endpoint || "?"} — ${p.key || p.kind || "mismatch"}`.slice(0, 160);
    case "probe-failure":
      return `${p.method || "?"} ${p.path || "?"} → ${p.status || "err"}: ${p.reason || ""}`.slice(0, 160);
    case "test-failure":
      return `${p.name || p.message || "test failed"}`.slice(0, 160);
    case "contract":
      return (typeof p === "string" ? p : JSON.stringify(p)).slice(0, 160);
    case "runtime-error":
      return `${p.file || "?"}:${p.line || "?"} ${p.message || "runtime error"}`.slice(0, 160);
    default:
      return (s.kind || "signal").slice(0, 160);
  }
}

// ─────────────────────────────────────────────────────────────────────
// Hook handlers — exported, wired into treeos-base/index.js
// ─────────────────────────────────────────────────────────────────────

/**
 * beforeLLMCall handler. Creates a pending capture keyed by chatId,
 * stamps the promptMessages snapshot, and stores until afterLLMCall
 * finalizes it.
 *
 * Skips silently if chatId is missing (background jobs, scout,
 * understanding, and other non-chat LLM callers don't have a chatId).
 */
export async function onBeforeLLMCall(data) {
  if (!data?.chatId) return;
  try {
    const { messages, totalBytes, truncated } = cleanMessages(data.messages || []);
    const draft = {
      chatId: data.chatId,
      sessionId: data.sessionId || null,
      userId: data.userId || null,
      rootId: data.rootId || null,
      nodeId: data.nodeId || null,
      mode: data.mode || null,
      startedAt: new Date(),
      promptMessages: messages,
      promptBytes: totalBytes,
      promptTruncated: truncated,
      modelUsed: data.model || null,
      toolCalls: [],
      branchEvents: [],
      _createdAt: Date.now(),
    };
    // If an existing pending capture exists for this chatId (e.g., a
    // retry after an abort), replace it cleanly.
    pendingCaptures.set(data.chatId, draft);
  } catch (err) {
    log.debug("AiForensics", `onBeforeLLMCall failed: ${err.message}`);
  }
}

/**
 * beforeToolCall handler. Opens a new tool-call entry on the pending
 * capture and stashes a signalInbox snapshot so the afterToolCall
 * can compute signal deltas.
 */
export async function onBeforeToolCall(data) {
  if (!data?.chatId) return;
  try {
    const capture = pendingCaptures.get(data.chatId);
    if (!capture) return;

    // Snapshot signalInbox on the current tree node so we can diff
    // it after the tool call to find new signals.
    const snap = await snapshotSignalInbox(data.nodeId || capture.nodeId);

    const cleanedArgs = cleanArgs(data.args);
    const entry = {
      tool: data.toolName || "unknown",
      args: cleanedArgs.value,
      argsTruncated: cleanedArgs.truncated,
      result: "",
      resultTruncated: false,
      success: null,
      error: null,
      ms: 0,
      startedAt: new Date(),
      endedAt: null,
      signals: [],
      _cascadedSnapshot: snap, // hidden, stripped before save
      _cascadedNodeId: data.nodeId || capture.nodeId || null,
    };
    capture.toolCalls.push(entry);
  } catch (err) {
    log.debug("AiForensics", `onBeforeToolCall failed: ${err.message}`);
  }
}

/**
 * afterToolCall handler. Finds the open tool entry (last one without
 * endedAt) and closes it with result + signals that fired during the
 * call.
 */
export async function onAfterToolCall(data) {
  if (!data?.chatId) return;
  try {
    const capture = pendingCaptures.get(data.chatId);
    if (!capture) return;

    // Find the most recent open entry that matches this tool name
    let entry = null;
    for (let i = capture.toolCalls.length - 1; i >= 0; i--) {
      const e = capture.toolCalls[i];
      if (!e.endedAt && e.tool === (data.toolName || "unknown")) {
        entry = e;
        break;
      }
    }
    if (!entry) return;

    const resultText = typeof data.result === "string"
      ? data.result
      : (data.result ? JSON.stringify(data.result) : "");
    const truncated = truncateString(resultText, CAPTURE_LIMITS.TOOL_RESULT_BYTES);

    entry.result = truncated.value;
    entry.resultTruncated = truncated.truncated;
    entry.success = data.success === true;
    entry.error = data.error || null;
    entry.endedAt = new Date();
    entry.ms = entry.endedAt.getTime() - (entry.startedAt?.getTime?.() || entry.endedAt.getTime());

    // Diff signalInbox to find signals that fired during the call
    if (entry._cascadedSnapshot && entry._cascadedNodeId) {
      entry.signals = await diffSignalInbox(entry._cascadedNodeId, entry._cascadedSnapshot);
    }

    // Strip the hidden fields before the final write
    delete entry._cascadedSnapshot;
    delete entry._cascadedNodeId;
  } catch (err) {
    log.debug("AiForensics", `onAfterToolCall failed: ${err.message}`);
  }
}

/**
 * afterLLMCall handler. Writes the final AiCapture doc and deletes
 * the pending entry. This is where the capture becomes observable
 * to the renderer.
 */
export async function onAfterLLMCall(data) {
  if (!data?.chatId) return;
  try {
    const capture = pendingCaptures.get(data.chatId);
    if (!capture) return;

    // Capture the response text if available via _failedGeneration or
    // the data.response (not currently in hook data; see note below)
    if (data.model) capture.modelUsed = data.model;
    if (data.usage) capture.tokenUsage = data.usage;
    if (!capture.responseText && data.responseText) {
      const r = truncateString(data.responseText, CAPTURE_LIMITS.RESPONSE_BYTES);
      capture.responseText = r.value;
      capture.responseTruncated = r.truncated;
    }
    capture.endedAt = new Date();

    // Strip hidden state + save
    const toWrite = { ...capture };
    delete toWrite._createdAt;
    if (Array.isArray(toWrite.toolCalls)) {
      toWrite.toolCalls = toWrite.toolCalls.map((tc) => {
        const { _cascadedSnapshot, _cascadedNodeId, ...rest } = tc;
        return rest;
      });
    }
    await AiCapture.create(toWrite);
    pendingCaptures.delete(data.chatId);
  } catch (err) {
    log.debug("AiForensics", `onAfterLLMCall failed: ${err.message}`);
  }
}

/**
 * Directly capture the LLM response text — called from conversation.js
 * after the LLM call succeeds and before the response is processed.
 * This bypass exists because the afterLLMCall hook data doesn't include
 * the response content (it just includes metering info). We expose a
 * direct function the kernel can call when it has the full response
 * text in hand.
 *
 * Safe to call repeatedly; later calls overwrite earlier ones.
 */
export function recordLLMResponse({ chatId, responseText }) {
  if (!chatId || !responseText) return;
  try {
    const capture = pendingCaptures.get(chatId);
    if (!capture) return;
    const r = truncateString(responseText, CAPTURE_LIMITS.RESPONSE_BYTES);
    capture.responseText = r.value;
    capture.responseTruncated = r.truncated;
  } catch (err) {
    log.debug("AiForensics", `recordLLMResponse failed: ${err.message}`);
  }
}

/**
 * Record a swarm branch status transition onto the current pending
 * capture. Called directly by swarm.js — not via a hook — every time
 * `upsertSubPlanEntry` is called with a status change.
 *
 * If no pending capture exists for this chatId, we silently skip. If
 * the chatId is the root orchestrator's chat, the transition attaches
 * to that. The renderer shows these as a timeline on the chat step.
 */
export function recordBranchEvent({ chatId, branchName, from, to, reason }) {
  if (!chatId || !branchName || !to) return;
  try {
    const capture = pendingCaptures.get(chatId);
    if (!capture) return;
    capture.branchEvents.push({
      branchName,
      from: from || null,
      to,
      reason: reason || null,
      at: new Date(),
    });
  } catch (err) {
    log.debug("AiForensics", `recordBranchEvent failed: ${err.message}`);
  }
}

/**
 * Diagnostic: how many captures are pending right now? Useful for
 * operators checking for stuck hooks or memory leaks.
 */
export function pendingCaptureCount() {
  return pendingCaptures.size;
}
