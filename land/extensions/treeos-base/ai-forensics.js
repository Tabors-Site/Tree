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

// Live stream emitter. Every incremental update to a pending capture
// fires this WS event so the node-chats page (and any dashboard) can
// re-fetch the capture and render the delta in real time. Filled in at
// init() by treeos-base/index.js — we can't import seed/ws directly
// here without circular-import risk during module load.
let _emitToUser = null;
export function setCaptureEmitter(fn) {
  _emitToUser = typeof fn === "function" ? fn : null;
}
function emitCaptureUpdated(capture) {
  if (!_emitToUser || !capture) return;
  try {
    _emitToUser(capture.userId, "captureUpdated", {
      chatId: capture.chatId,
      captureId: String(capture._id || ""),
      rootId: capture.rootId || null,
      sessionId: capture.sessionId || null,
      at: Date.now(),
    });
  } catch (err) {
    log.debug("AiForensics", `emitCaptureUpdated failed: ${err.message}`);
  }
}

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
      // If the kernel passes parentChatId (continuations, branch-swarm
      // dispatches, summarizer rescues), record it so the forensics
      // timeline can walk the dispatch lineage across LLM calls.
      parentChatId: data.parentChatId || null,
      startedAt: new Date(),
      promptMessages: messages,
      promptBytes: totalBytes,
      promptTruncated: truncated,
      modelUsed: data.model || null,
      toolCalls: [],
      branchEvents: [],
      cascadesEmitted: [],
      cascadesReceived: [],
      swarmSignalsEmitted: [],
      _createdAt: Date.now(),
    };

    // Incremental persistence: write the capture doc NOW so the chat
    // page can show it live. Each subsequent hook atomically updates
    // the same doc. If the server crashes mid-call, we still have
    // partial forensics instead of losing the whole capture.
    try {
      const doc = await AiCapture.create({
        chatId: draft.chatId,
        sessionId: draft.sessionId,
        userId: draft.userId,
        rootId: draft.rootId,
        nodeId: draft.nodeId,
        mode: draft.mode,
        parentChatId: draft.parentChatId,
        startedAt: draft.startedAt,
        promptMessages: draft.promptMessages,
        promptBytes: draft.promptBytes,
        promptTruncated: draft.promptTruncated,
        modelUsed: draft.modelUsed,
      });
      draft._id = doc._id;
    } catch (err) {
      log.debug("AiForensics", `onBeforeLLMCall create failed: ${err.message}`);
    }

    pendingCaptures.set(data.chatId, draft);
    emitCaptureUpdated(draft);
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

    // Persist the new tool entry live. Strip hidden fields for DB.
    if (capture._id) {
      const { _cascadedSnapshot, _cascadedNodeId, ...persistable } = entry;
      AiCapture.updateOne(
        { _id: capture._id },
        { $push: { toolCalls: persistable } },
      ).catch(() => {});
      emitCaptureUpdated(capture);
    }
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
    let entryIndex = -1;
    for (let i = capture.toolCalls.length - 1; i >= 0; i--) {
      const e = capture.toolCalls[i];
      if (!e.endedAt && e.tool === (data.toolName || "unknown")) {
        entry = e;
        entryIndex = i;
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

    // Strip the hidden fields before the DB write
    delete entry._cascadedSnapshot;
    delete entry._cascadedNodeId;

    // Persist the closed entry live. Using positional $set with the
    // known index because we have the authoritative in-memory copy —
    // no other writer races us on this doc's toolCalls array.
    if (capture._id && entryIndex >= 0) {
      AiCapture.updateOne(
        { _id: capture._id },
        { $set: { [`toolCalls.${entryIndex}`]: entry } },
      ).catch(() => {});
      emitCaptureUpdated(capture);
    }
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

    // Finalize: the doc was created on beforeLLMCall and updated live
    // through every hook; all we need now is to $set the closing
    // fields. If the doc wasn't created (DB was down at the start),
    // fall back to a single create call with the full in-memory state.
    if (capture._id) {
      AiCapture.updateOne(
        { _id: capture._id },
        {
          $set: {
            endedAt: capture.endedAt,
            responseText: capture.responseText || "",
            responseTruncated: capture.responseTruncated || false,
            modelUsed: capture.modelUsed,
            tokenUsage: capture.tokenUsage,
          },
        },
      ).catch((err) => log.debug("AiForensics", `onAfterLLMCall finalize failed: ${err.message}`));
      emitCaptureUpdated(capture);
    } else {
      // Cold-start fallback: doc never got created; write everything now.
      const toWrite = { ...capture };
      delete toWrite._createdAt;
      delete toWrite._id;
      if (Array.isArray(toWrite.toolCalls)) {
        toWrite.toolCalls = toWrite.toolCalls.map((tc) => {
          const { _cascadedSnapshot, _cascadedNodeId, ...rest } = tc;
          return rest;
        });
      }
      await AiCapture.create(toWrite);
    }

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
    if (capture._id) {
      AiCapture.updateOne(
        { _id: capture._id },
        { $set: { responseText: r.value, responseTruncated: r.truncated } },
      ).catch(() => {});
      emitCaptureUpdated(capture);
    }
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
    const event = {
      branchName,
      from: from || null,
      to,
      reason: reason || null,
      at: new Date(),
    };
    capture.branchEvents.push(event);
    if (capture._id) {
      AiCapture.updateOne({ _id: capture._id }, { $push: { branchEvents: event } }).catch(() => {});
      emitCaptureUpdated(capture);
    }
  } catch (err) {
    log.debug("AiForensics", `recordBranchEvent failed: ${err.message}`);
  }
}

/**
 * Record a cascade signal this call emitted (a local write at a
 * cascade-enabled node fired checkCascade which wrote to .flow). Called
 * from the onCascade listener below; also exposed for anything else
 * that wants to attribute a cascade to the active capture.
 *
 * Matching is by chatId — we attach to the pending capture only if one
 * exists for the given chat. No-op otherwise (background jobs that
 * don't pass chatId through).
 */
export function recordCascadeEmitted({ chatId, signalId, nodeId, status }) {
  if (!chatId || !signalId) return;
  try {
    const capture = pendingCaptures.get(chatId);
    if (!capture) return;
    const entry = {
      signalId,
      nodeId: nodeId || null,
      status: status || null,
      at: new Date(),
    };
    capture.cascadesEmitted.push(entry);
    if (capture._id) {
      AiCapture.updateOne({ _id: capture._id }, { $push: { cascadesEmitted: entry } }).catch(() => {});
      emitCaptureUpdated(capture);
    }
  } catch (err) {
    log.debug("AiForensics", `recordCascadeEmitted failed: ${err.message}`);
  }
}

/**
 * Record a cascade signal that landed at this call's node. Used by the
 * propagation extension when a deliverCascade arrives and the local
 * position has a pending capture.
 */
export function recordCascadeReceived({ chatId, signalId, sourceNodeId }) {
  if (!chatId || !signalId) return;
  try {
    const capture = pendingCaptures.get(chatId);
    if (!capture) return;
    const entry = {
      signalId,
      sourceNodeId: sourceNodeId || null,
      at: new Date(),
    };
    capture.cascadesReceived.push(entry);
    if (capture._id) {
      AiCapture.updateOne({ _id: capture._id }, { $push: { cascadesReceived: entry } }).catch(() => {});
      emitCaptureUpdated(capture);
    }
  } catch (err) {
    log.debug("AiForensics", `recordCascadeReceived failed: ${err.message}`);
  }
}

/**
 * Record a lateral swarm signal this call dropped into a sibling's
 * inbox. Supplements the receiver-side view (toolCalls[].signals) with
 * the emitter-side view: "this capture informed node Y with kind K".
 *
 * Called by swarm's appendSignal path (via getExtension("treeos-base"))
 * when the current visitor's chat has a pending capture.
 */
export function recordSwarmSignalEmitted({ chatId, toNodeId, kind, filePath }) {
  if (!chatId || !toNodeId || !kind) return;
  try {
    const capture = pendingCaptures.get(chatId);
    if (!capture) return;
    const entry = {
      toNodeId,
      kind,
      filePath: filePath || null,
      at: new Date(),
    };
    capture.swarmSignalsEmitted.push(entry);
    if (capture._id) {
      AiCapture.updateOne({ _id: capture._id }, { $push: { swarmSignalsEmitted: entry } }).catch(() => {});
      emitCaptureUpdated(capture);
    }
  } catch (err) {
    log.debug("AiForensics", `recordSwarmSignalEmitted failed: ${err.message}`);
  }
}

/**
 * onCascade handler. The kernel fires onCascade whenever checkCascade
 * sees a write at a cascade-enabled node (emission, depth=0) or
 * deliverCascade drops a signal into a node (reception, depth>0).
 * Emission goes into `cascadesEmitted[]`, reception into
 * `cascadesReceived[]` — so the forensics timeline answers both
 * "which call emitted this cascade?" and "which call saw it arrive?".
 *
 * When the hookData doesn't carry chatId (current kernel path), we
 * fall back to matching by nodeId against every pending capture.
 *
 * Best-effort: never blocks, never throws. A missed attachment just
 * leaves the capture's cascade arrays empty.
 */
export async function onCascadeSignal(data) {
  if (!data?.signalId) return;
  try {
    const isReception = (data.depth || 0) > 0;
    const attach = (chatId) => {
      if (isReception) {
        recordCascadeReceived({
          chatId,
          signalId: data.signalId,
          sourceNodeId: data.source || null,
        });
      } else {
        recordCascadeEmitted({
          chatId,
          signalId: data.signalId,
          nodeId: data.nodeId,
          status: data._resultStatus,
        });
      }
    };
    const chatId = data.chatId;
    if (chatId) {
      attach(chatId);
      return;
    }
    // No direct chatId on hookData — attach to any pending capture whose
    // active nodeId matches the target node (emission = the writer's
    // capture; reception = whatever capture happens to be running at the
    // receiving node, if any).
    for (const [activeChatId, capture] of pendingCaptures.entries()) {
      if (capture.nodeId && String(capture.nodeId) === String(data.nodeId)) {
        attach(activeChatId);
        return;
      }
    }
  } catch (err) {
    log.debug("AiForensics", `onCascadeSignal failed: ${err.message}`);
  }
}

/**
 * Diagnostic: how many captures are pending right now? Useful for
 * operators checking for stuck hooks or memory leaks.
 */
export function pendingCaptureCount() {
  return pendingCaptures.size;
}
