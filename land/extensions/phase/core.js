// Phase Core
//
// Detects whether the user is in awareness (gathering), attention (producing),
// or scattered (bouncing) from their behavior. No toggle. No setting.
// The tree watches what you do and tells you what it sees.
//
// Rolling window of last N interactions per user. Each interaction is typed:
//   navigate, read, write, create, tool, query
//
// The ratio of types determines the phase. The phase injects into enrichContext
// so the AI adapts its behavior.

import log from "../../seed/log.js";
import { getUserMeta, setUserMeta } from "../../seed/tree/userMetadata.js";
import { getExtension } from "../loader.js";

let User = null;
export function setModels(models) { User = models.User; }

// ─────────────────────────────────────────────────────────────────────────
// CONFIG (land-configurable)
// ─────────────────────────────────────────────────────────────────────────

let _getLandConfig = () => null;
export function setLandConfig(fn) { _getLandConfig = fn; }

function cfg(key, fallback) {
  const v = _getLandConfig(key);
  return v != null ? Number(v) : fallback;
}

function windowSize() { return cfg("phaseWindowSize", 20); }
function awarenessThreshold() { return cfg("phaseAwarenessThreshold", 0.7); }
function attentionThreshold() { return cfg("phaseAttentionThreshold", 0.7); }
function scatteredBranchThreshold() { return cfg("phaseScatteredBranchThreshold", 4); }
function historyMax() { return cfg("phaseHistoryMax", 200); }
function transitionSummaryEnabled() {
  const v = _getLandConfig("phaseTransitionSummary");
  return v === true || v === "true" || v == null; // default on
}

// ─────────────────────────────────────────────────────────────────────────
// SIGNAL RECORDING
// ─────────────────────────────────────────────────────────────────────────

/**
 * Record an interaction signal for a user.
 * Called from hook handlers (afterNote, afterNodeCreate, etc.)
 *
 * @param {string} userId
 * @param {string} type - "navigate" | "write" | "create" | "tool" | "query" | "read"
 * @param {string} [nodeId] - which node the interaction happened at
 */
export async function recordSignal(userId, type, nodeId) {
  if (!userId || !User) return;

  const user = await User.findById(userId);
  if (!user) return;

  const phaseMeta = getUserMeta(user, "phase");
  if (!phaseMeta.window) phaseMeta.window = [];

  const signal = {
    type,
    nodeId: nodeId || null,
    at: Date.now(),
  };

  phaseMeta.window.push(signal);

  // Trim to window size
  const max = windowSize();
  if (phaseMeta.window.length > max) {
    phaseMeta.window = phaseMeta.window.slice(-max);
  }

  // Detect phase from window
  const previousPhase = phaseMeta.currentPhase || null;
  const detected = detectPhase(phaseMeta.window);
  phaseMeta.currentPhase = detected.phase;
  phaseMeta.phaseConfidence = detected.confidence;
  phaseMeta.phaseDetectedAt = Date.now();

  // Track transition
  if (previousPhase && previousPhase !== detected.phase) {
    recordTransition(phaseMeta, previousPhase, detected.phase);
  }

  setUserMeta(user, "phase", phaseMeta);
  await user.save();

  // Feed inverse-tree if installed
  if (previousPhase !== detected.phase) {
    try {
      const inverse = getExtension("inverse-tree");
      if (inverse?.exports?.recordSignal) {
        inverse.exports.recordSignal(userId, "phase-transition", {
          from: previousPhase,
          to: detected.phase,
          confidence: detected.confidence,
        });
      }
    } catch {}
  }
}

// ─────────────────────────────────────────────────────────────────────────
// PHASE DETECTION
// ─────────────────────────────────────────────────────────────────────────

const READ_TYPES = new Set(["navigate", "read", "query"]);
const WRITE_TYPES = new Set(["write", "create", "tool"]);

function detectPhase(window) {
  if (!window || window.length < 3) {
    return { phase: "awareness", confidence: 0.5 };
  }

  let reads = 0;
  let writes = 0;
  const branches = new Set();

  for (const signal of window) {
    if (READ_TYPES.has(signal.type)) reads++;
    if (WRITE_TYPES.has(signal.type)) writes++;
    if (signal.nodeId) branches.add(signal.nodeId);
  }

  const total = reads + writes;
  if (total === 0) return { phase: "awareness", confidence: 0.5 };

  const readRatio = reads / total;
  const writeRatio = writes / total;

  // Check for scattered first: many branches, no depth
  if (branches.size >= scatteredBranchThreshold() && writeRatio < 0.3) {
    return { phase: "scattered", confidence: Math.min(0.9, branches.size / (scatteredBranchThreshold() * 2)) };
  }

  // Awareness: mostly reading/navigating
  if (readRatio >= awarenessThreshold()) {
    return { phase: "awareness", confidence: readRatio };
  }

  // Attention: mostly writing/creating/tooling
  if (writeRatio >= attentionThreshold()) {
    return { phase: "attention", confidence: writeRatio };
  }

  // Mixed but not scattered (some depth in a few branches)
  if (writeRatio > readRatio) {
    return { phase: "attention", confidence: writeRatio };
  }

  return { phase: "awareness", confidence: readRatio };
}

// ─────────────────────────────────────────────────────────────────────────
// TRANSITIONS
// ─────────────────────────────────────────────────────────────────────────

function recordTransition(phaseMeta, from, to) {
  if (!phaseMeta.history) phaseMeta.history = [];

  // Close the previous phase entry
  const last = phaseMeta.history[phaseMeta.history.length - 1];
  if (last && !last.endAt) {
    last.endAt = Date.now();
    last.durationMs = last.endAt - last.startAt;
  }

  // Start new phase entry
  phaseMeta.history.push({
    phase: to,
    startAt: Date.now(),
    endAt: null,
    durationMs: null,
    transitionFrom: from,
  });

  // Trim history
  const max = historyMax();
  if (phaseMeta.history.length > max) {
    phaseMeta.history = phaseMeta.history.slice(-max);
  }

  log.debug("Phase", `Phase transition: ${from} -> ${to}`);
}

// ─────────────────────────────────────────────────────────────────────────
// CONTEXT INJECTION
// ─────────────────────────────────────────────────────────────────────────

/**
 * Build the phase context string for enrichContext.
 * Returns null if no phase data available.
 */
export function buildPhaseContext(phaseMeta) {
  if (!phaseMeta?.currentPhase) return null;

  const phase = phaseMeta.currentPhase;
  const confidence = phaseMeta.phaseConfidence || 0;

  let context = `User phase: ${phase}`;

  if (phase === "awareness") {
    context += ". The user is exploring and gathering context. Show, surface, connect. Don't push action.";
  } else if (phase === "attention") {
    context += ". The user is focused and producing. Do, build, execute. Don't pause to explain.";
  } else if (phase === "scattered") {
    context += ". The user is bouncing between branches without depth. Gently observe this pattern if appropriate.";
  }

  // Note transition if recent
  const history = phaseMeta.history || [];
  const last = history[history.length - 1];
  if (last?.transitionFrom && last.startAt && (Date.now() - last.startAt) < 120000) {
    context += ` Just transitioned from ${last.transitionFrom}.`;
    if (last.transitionFrom === "awareness" && phase === "attention") {
      context += " The user was gathering context and is now ready to work. Crystallize what they explored.";
    } else if (last.transitionFrom === "attention" && phase === "awareness") {
      context += " The user was focused and is now exploring. Summarize what they just built.";
    }
  }

  return context;
}

// ─────────────────────────────────────────────────────────────────────────
// READ (for routes)
// ─────────────────────────────────────────────────────────────────────────

export async function getPhaseState(userId) {
  if (!User) return null;
  const user = await User.findById(userId).lean();
  if (!user) return null;
  return getUserMeta(user, "phase");
}

export function computeCycleStats(history) {
  if (!history || history.length === 0) return { awareness: 0, attention: 0, scattered: 0, total: 0 };

  let awareness = 0;
  let attention = 0;
  let scattered = 0;

  for (const entry of history) {
    const dur = entry.durationMs || 0;
    if (entry.phase === "awareness") awareness += dur;
    else if (entry.phase === "attention") attention += dur;
    else if (entry.phase === "scattered") scattered += dur;
  }

  const total = awareness + attention + scattered;
  if (total === 0) return { awareness: 0, attention: 0, scattered: 0, total: 0 };

  return {
    awareness: Math.round(awareness / total * 100),
    attention: Math.round(attention / total * 100),
    scattered: Math.round(scattered / total * 100),
    total,
    awarenessMs: awareness,
    attentionMs: attention,
    scatteredMs: scattered,
  };
}
