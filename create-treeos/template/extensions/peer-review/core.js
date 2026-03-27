import log from "../../seed/log.js";
import { v4 as uuidv4 } from "uuid";
import { parseJsonSafe } from "../../seed/orchestrators/helpers.js";

// ── Service references (wired by index.js init) ──

let _runChat = null;
let _deliverCascade = null;
let _setExtMeta = null;
let _getExtMeta = null;
let _mergeExtMeta = null;
let _emitToUser = null;
let _hooks = null;
let _Node = null;
let _Note = null;

export function setServices(s) {
  _runChat = s.runChat;
  _deliverCascade = s.deliverCascade;
  _setExtMeta = s.setExtMeta;
  _getExtMeta = s.getExtMeta;
  _mergeExtMeta = s.mergeExtMeta;
  _emitToUser = s.emitToUser;
  _hooks = s.hooks;
  _Node = s.Node;
  _Note = s.Note;
}

// ── Defaults ──

const MAX_CONTENT_CHARS = 8000;
const MAX_HISTORY_ENTRIES = 20;

function defaultConfig() {
  return {
    partner: null,
    trigger: "afterNote",
    maxRounds: 5,
    autoApply: false,
    reviewPrompt: null,
    status: "idle",
    currentReviewId: null,
    history: [],
  };
}

// ── Read helpers ──

export function getReviewConfig(node) {
  const raw = typeof _getExtMeta === "function" ? _getExtMeta(node, "peer-review") : null;
  if (!raw || typeof raw !== "object") return defaultConfig();
  return { ...defaultConfig(), ...raw };
}

function truncate(text, max) {
  if (!text || typeof text !== "string") return "";
  return text.length > max ? text.slice(0, max) + "\n... (truncated)" : text;
}

// ── Status updates ──

async function setStatus(node, status, extra = {}) {
  const config = getReviewConfig(node);
  const update = { ...config, status, ...extra };
  await _setExtMeta(node, "peer-review", update);
  return update;
}

async function addHistoryEntry(node, entry) {
  const config = getReviewConfig(node);
  const history = Array.isArray(config.history) ? [...config.history] : [];
  history.push(entry);
  // Cap history
  while (history.length > MAX_HISTORY_ENTRIES) history.shift();
  await _setExtMeta(node, "peer-review", { ...config, history });
}

async function addRoundToHistory(node, reviewId, roundData) {
  const config = getReviewConfig(node);
  const history = Array.isArray(config.history) ? [...config.history] : [];
  const session = history.find((h) => h.id === reviewId);
  if (session) {
    session.rounds.push(roundData);
  }
  await _setExtMeta(node, "peer-review", { ...config, history });
}

// ── Resolve root for a node ──

async function resolveRoot(nodeId) {
  let cursor = nodeId;
  const visited = new Set();
  while (cursor && !visited.has(cursor)) {
    visited.add(cursor);
    const n = await _Node.findById(cursor).select("parent rootOwner systemRole").lean();
    if (!n) return null;
    if (n.rootOwner) return String(n._id);
    if (!n.parent || n.systemRole) return null;
    cursor = n.parent;
  }
  return null;
}

// ── 1. TRIGGER REVIEW ──
// Called by afterNote hook. Sends review request to partner.

export async function triggerReview(nodeId, note, userId) {
  const node = await _Node.findById(nodeId);
  if (!node) return;

  const config = getReviewConfig(node);
  if (!config.partner) return;
  if (config.status !== "idle") return;
  if (config.trigger !== "afterNote") return;

  // Validate partner exists
  const partner = await _Node.findById(config.partner).select("systemRole").lean();
  if (!partner) {
    log.warn("PeerReview", `Partner ${config.partner} not found for node ${nodeId}`);
    await addHistoryEntry(node, {
      id: uuidv4(), noteId: String(note._id), partnerId: config.partner,
      rounds: [], finalVerdict: null, error: "partner_not_found",
      startedAt: new Date().toISOString(), completedAt: new Date().toISOString(),
    });
    return;
  }
  if (partner.systemRole) {
    log.warn("PeerReview", `Partner ${config.partner} is a system node`);
    return;
  }

  const reviewId = uuidv4();
  const content = truncate(note.content || "", MAX_CONTENT_CHARS);
  if (!content) return;

  // Set status to reviewing and record the session
  const historyEntry = {
    id: reviewId, noteId: String(note._id), notePreview: truncate(content, 200),
    partnerId: config.partner, rounds: [], finalVerdict: null,
    startedAt: new Date().toISOString(), completedAt: null,
  };
  const history = Array.isArray(config.history) ? [...config.history] : [];
  history.push(historyEntry);
  while (history.length > MAX_HISTORY_ENTRIES) history.shift();
  await _setExtMeta(node, "peer-review", {
    ...config, status: "reviewing", currentReviewId: reviewId, history,
  });

  // Build and send cascade signal
  const payload = {
    action: "peer-review:request",
    tags: ["peer-review"],
    reviewId,
    sourceNodeId: nodeId,
    targetNodeId: config.partner,
    noteId: String(note._id),
    noteContent: content,
    round: 1,
    reviewPrompt: config.reviewPrompt || null,
  };

  let result;
  try {
    result = await _deliverCascade({
      nodeId: config.partner,
      signalId: reviewId,
      payload,
      source: nodeId,
      depth: 0,
    });
  } catch (err) {
    log.warn("PeerReview", `Cascade delivery failed: ${err.message}`);
    await setStatus(node, "idle", { currentReviewId: null });
    return;
  }

  if (result?.status === "failed" || result?.status === "rejected") {
    log.warn("PeerReview", `Cascade ${result.status}: ${result.payload?.reason || "unknown"}`);
    // Record the failure
    const freshNode = await _Node.findById(nodeId);
    if (freshNode) {
      const cfg = getReviewConfig(freshNode);
      const sess = (cfg.history || []).find((h) => h.id === reviewId);
      if (sess) { sess.error = result.payload?.reason; sess.completedAt = new Date().toISOString(); }
      await _setExtMeta(freshNode, "peer-review", { ...cfg, status: "idle", currentReviewId: null });
    }
    return;
  }

  // Signal sent. Set awaiting-response.
  const updated = await _Node.findById(nodeId);
  if (updated) await setStatus(updated, "awaiting-response");
}

// ── 2. HANDLE REVIEW REQUEST ──
// Called by onCascade at the reviewer node.

export async function handleReviewRequest(hookData) {
  const { nodeId, payload, depth } = hookData;
  if (payload.targetNodeId !== nodeId) return; // not for us

  const { reviewId, sourceNodeId, noteContent, round, reviewPrompt, revisedContent } = payload;
  const contentToReview = revisedContent || noteContent;

  const rootId = await resolveRoot(nodeId);

  // Build the review message
  let message = "";
  if (reviewPrompt) message += `REVIEW INSTRUCTIONS: ${reviewPrompt}\n\n`;
  message += `Review the following content from node ${sourceNodeId} (round ${round}):\n\n${contentToReview}`;

  let answer;
  try {
    const result = await _runChat({
      userId: "SYSTEM",
      username: "peer-review",
      message,
      mode: "tree:review",
      rootId,
      nodeId,
    });
    answer = result?.answer;
  } catch (err) {
    log.warn("PeerReview", `Review AI call failed at ${nodeId}: ${err.message}`);
    answer = null;
  }

  // Parse structured feedback
  let feedback;
  if (answer) {
    feedback = parseJsonSafe(answer);
  }
  if (!feedback || !feedback.verdict) {
    feedback = {
      verdict: "approve",
      confidence: 0,
      suggestions: [],
      summary: answer ? "Review produced non-structured output" : "Review AI call failed",
    };
  }

  // Send response back to source
  const responsePayload = {
    action: "peer-review:response",
    tags: ["peer-review"],
    reviewId,
    sourceNodeId: nodeId,
    targetNodeId: sourceNodeId,
    round,
    verdict: feedback.verdict,
    confidence: feedback.confidence || 0,
    suggestions: Array.isArray(feedback.suggestions) ? feedback.suggestions : [],
    summary: feedback.summary || "",
  };

  try {
    await _deliverCascade({
      nodeId: sourceNodeId,
      signalId: reviewId,
      payload: responsePayload,
      source: nodeId,
      depth: (depth || 0) + 1,
    });
  } catch (err) {
    log.warn("PeerReview", `Response delivery failed: ${err.message}`);
  }
}

// ── 3. HANDLE REVIEW RESPONSE ──
// Called by onCascade at the source node (the one that requested review).

export async function handleReviewResponse(hookData) {
  const { nodeId, payload } = hookData;
  if (payload.targetNodeId !== nodeId) return; // not for us

  const { reviewId, round, verdict, suggestions, summary } = payload;

  const node = await _Node.findById(nodeId);
  if (!node) return;

  const config = getReviewConfig(node);

  // Verify this is the active review
  if (config.currentReviewId !== reviewId) {
    log.debug("PeerReview", `Stale review response at ${nodeId}: got ${reviewId}, expected ${config.currentReviewId}`);
    return;
  }

  // Record this round in history
  const roundData = {
    round,
    verdict,
    summary: summary || "",
    suggestions: Array.isArray(suggestions) ? suggestions.slice(0, 20) : [],
    timestamp: new Date().toISOString(),
  };
  await addRoundToHistory(node, reviewId, roundData);

  // Check if done
  const maxRounds = config.maxRounds || 5;
  const isDone = verdict === "approve" || verdict === "reject" || round >= maxRounds;

  if (isDone || !config.autoApply) {
    // Review complete
    const freshNode = await _Node.findById(nodeId);
    if (freshNode) {
      const cfg = getReviewConfig(freshNode);
      const sess = (cfg.history || []).find((h) => h.id === reviewId);
      if (sess) {
        sess.finalVerdict = verdict;
        sess.completedAt = new Date().toISOString();
      }
      await _setExtMeta(freshNode, "peer-review", {
        ...cfg, status: "idle", currentReviewId: null,
      });
    }

    // Fire custom hook
    if (_hooks) {
      _hooks.run("peer-review:afterReview", {
        nodeId, partnerId: config.partner,
        feedback: { verdict, suggestions, summary },
        round, consensus: verdict === "approve",
      }).catch(() => {});
    }

    // Notify user
    const label = verdict === "approve"
      ? `Review approved after ${round} round(s).`
      : verdict === "reject"
        ? `Review rejected after ${round} round(s). ${summary}`
        : round >= maxRounds
          ? `Review hit max rounds (${maxRounds}). Last verdict: ${verdict}. ${summary}`
          : `Review feedback (${round} round(s)): ${summary}`;

    if (_emitToUser && config._lastUserId) {
      _emitToUser(config._lastUserId, "peer-review:complete", {
        nodeId, reviewId, verdict, round, summary, label,
      });
    }

    log.verbose("PeerReview", `Review ${reviewId} at ${nodeId}: ${verdict} after ${round} round(s)`);
    return;
  }

  // autoApply: revise and send next round
  // Set status to "revising" BEFORE the revision happens.
  // If the revision writes a note edit, afterNote fires and sees "revising", not "idle".
  // This prevents re-triggering.
  const revisingNode = await _Node.findById(nodeId);
  if (revisingNode) await setStatus(revisingNode, "revising");

  let revisedContent;
  try {
    revisedContent = await reviseContent(nodeId, config, suggestions, round);
  } catch (err) {
    log.warn("PeerReview", `Revision failed at ${nodeId}: ${err.message}`);
    const errNode = await _Node.findById(nodeId);
    if (errNode) {
      const cfg = getReviewConfig(errNode);
      const sess = (cfg.history || []).find((h) => h.id === reviewId);
      if (sess) { sess.error = "revision_failed"; sess.completedAt = new Date().toISOString(); }
      await _setExtMeta(errNode, "peer-review", { ...cfg, status: "idle", currentReviewId: null });
    }
    return;
  }

  // Send next round to reviewer
  const nextPayload = {
    action: "peer-review:request",
    tags: ["peer-review"],
    reviewId,
    sourceNodeId: nodeId,
    targetNodeId: config.partner,
    noteId: payload.noteId || null,
    noteContent: payload.noteContent || "",
    revisedContent: truncate(revisedContent, MAX_CONTENT_CHARS),
    round: round + 1,
    reviewPrompt: config.reviewPrompt || null,
  };

  // Set status to reviewing before sending
  const sendNode = await _Node.findById(nodeId);
  if (sendNode) await setStatus(sendNode, "reviewing");

  try {
    await _deliverCascade({
      nodeId: config.partner,
      signalId: reviewId,
      payload: nextPayload,
      source: nodeId,
      depth: (hookData.depth || 0) + 1,
    });
  } catch (err) {
    log.warn("PeerReview", `Next round delivery failed: ${err.message}`);
    const failNode = await _Node.findById(nodeId);
    if (failNode) await setStatus(failNode, "idle", { currentReviewId: null });
    return;
  }

  const awaitNode = await _Node.findById(nodeId);
  if (awaitNode) await setStatus(awaitNode, "awaiting-response");
}

// ── 4. REVISE CONTENT ──
// AI at the source node revises based on reviewer feedback.

async function reviseContent(nodeId, config, suggestions, round) {
  const rootId = await resolveRoot(nodeId);

  // Load the original note to get current content
  const sess = (config.history || []).find((h) => h.id === config.currentReviewId);
  let originalContent = sess?.notePreview || "";
  if (sess?.noteId) {
    try {
      const note = await _Note.findById(sess.noteId).select("content").lean();
      if (note?.content) originalContent = truncate(note.content, MAX_CONTENT_CHARS);
    } catch {}
  }

  const message = [
    `You received peer review feedback (round ${round}). Revise your content based on the suggestions.`,
    "",
    "ORIGINAL:",
    originalContent,
    "",
    "FEEDBACK:",
    JSON.stringify(suggestions, null, 2),
    "",
    "Return ONLY the revised content. No explanations. No JSON wrapper. Just the revised text.",
  ].join("\n");

  const result = await _runChat({
    userId: "SYSTEM",
    username: "peer-review",
    message,
    mode: "tree:respond",
    rootId,
    nodeId,
  });

  return result?.answer || originalContent;
}

// ── Exports for routes/tools ──

export function getReviewHistory(node, limit = 10) {
  const config = getReviewConfig(node);
  const history = Array.isArray(config.history) ? config.history : [];
  return history.slice(-limit);
}
