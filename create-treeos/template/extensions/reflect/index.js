/**
 * Reflect
 *
 * Tracks conversational patterns per session. No LLM calls.
 * Records message lengths, response lengths, tool counts, timestamps.
 * Detects state from the rolling window: flowing, compressed, searching, resistant.
 * Injects conversationalState into enrichContext.
 */

import log from "../../seed/log.js";

// Per-session rolling windows. Map<sessionId, entry[]>
const windows = new Map();
const WINDOW_SIZE = 12;    // last 12 exchanges
const WINDOW_TTL = 30 * 60 * 1000; // 30 min, then reset (new conversation feel)

// Cleanup stale sessions periodically
const CLEANUP_INTERVAL = 10 * 60 * 1000;
let _cleanupTimer = null;

function cleanup() {
  const cutoff = Date.now() - WINDOW_TTL;
  for (const [key, entries] of windows) {
    if (entries.length === 0 || entries[entries.length - 1].ts < cutoff) {
      windows.delete(key);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────
// STATE DETECTION
// ─────────────────────────────────────────────────────────────────────────

/**
 * Detect conversational state from the rolling window.
 *
 * flowing:     user and AI matched pace, messages substantial, steady rhythm
 * compressed:  user messages getting shorter, possible frustration or efficiency
 * searching:   user asking questions, topic shifting, exploring
 * resistant:   very short user messages, long gaps, or repeated circling
 */
function detectState(entries) {
  if (entries.length < 3) return null; // not enough data

  const recent = entries.slice(-6); // focus on last 6 exchanges
  const older = entries.length > 6 ? entries.slice(-12, -6) : [];

  // Compute averages
  const avgUserLen = recent.reduce((s, e) => s + e.userLen, 0) / recent.length;
  const avgResponseLen = recent.reduce((s, e) => s + e.responseLen, 0) / recent.length;
  const avgToolCount = recent.reduce((s, e) => s + e.toolCount, 0) / recent.length;

  // Compute trends (are user messages getting shorter?)
  let userLenTrend = 0;
  if (recent.length >= 4) {
    const firstHalf = recent.slice(0, Math.floor(recent.length / 2));
    const secondHalf = recent.slice(Math.floor(recent.length / 2));
    const firstAvg = firstHalf.reduce((s, e) => s + e.userLen, 0) / firstHalf.length;
    const secondAvg = secondHalf.reduce((s, e) => s + e.userLen, 0) / secondHalf.length;
    userLenTrend = secondAvg - firstAvg; // negative = compressing
  }

  // Time gaps between messages
  const gaps = [];
  for (let i = 1; i < recent.length; i++) {
    gaps.push(recent[i].ts - recent[i - 1].ts);
  }
  const avgGap = gaps.length > 0 ? gaps.reduce((s, g) => s + g, 0) / gaps.length : 0;

  // Mode switch frequency (different modes in recent window)
  const modes = new Set(recent.map(e => e.mode).filter(Boolean));
  const modeSwitches = modes.size;

  // Ratio of user length to response length
  const ratio = avgResponseLen > 0 ? avgUserLen / avgResponseLen : 1;

  // ── Detection rules ────────────────────────────────────────────────

  // Resistant: very short messages, getting shorter, or long gaps
  if (avgUserLen < 20 && userLenTrend < -10) return "resistant";
  if (avgUserLen < 15 && avgGap > 120000) return "resistant"; // <15 chars avg + 2min gaps

  // Compressed: messages getting shorter but still engaged
  if (userLenTrend < -20 && avgUserLen < 50) return "compressed";
  if (ratio < 0.1 && avgUserLen < 30) return "compressed"; // user writing 10% of what AI writes

  // Searching: frequent mode switches, questions, topic shifts
  if (modeSwitches >= 3) return "searching";
  if (avgToolCount > 2 && avgUserLen > 50) return "searching"; // lots of tool calls, substantial messages

  // Flowing: steady pace, matched lengths, no trend
  if (Math.abs(userLenTrend) < 15 && avgUserLen > 30) return "flowing";
  if (ratio > 0.15 && ratio < 2.0 && avgUserLen > 40) return "flowing";

  // Default: if we can't tell, don't inject
  return null;
}

// ─────────────────────────────────────────────────────────────────────────
// INIT
// ─────────────────────────────────────────────────────────────────────────

export async function init(core) {
  // afterLLMCall: record the exchange pattern
  core.hooks.register("afterLLMCall", async ({ userId, sessionId, message, answer, mode, usage }) => {
    if (!sessionId || !userId || userId === "SYSTEM") return;

    const key = sessionId;
    if (!windows.has(key)) windows.set(key, []);
    const window = windows.get(key);

    window.push({
      ts: Date.now(),
      userLen: (message || "").length,
      responseLen: (answer || "").length,
      toolCount: usage?.toolCalls || 0,
      mode: mode || null,
    });

    // Trim to window size
    if (window.length > WINDOW_SIZE) {
      windows.set(key, window.slice(-WINDOW_SIZE));
    }
  }, "reflect");

  // enrichContext: inject conversational state
  core.hooks.register("enrichContext", async ({ context, userId }) => {
    if (!userId) return;

    // Find the session for this user. We check all sessions since
    // enrichContext doesn't receive sessionId directly.
    // Use the most recently active session for this user.
    let bestWindow = null;
    let bestTs = 0;

    for (const [key, entries] of windows) {
      if (entries.length === 0) continue;
      const lastEntry = entries[entries.length - 1];
      // Session key format varies, but we check recency
      if (lastEntry.ts > bestTs && Date.now() - lastEntry.ts < WINDOW_TTL) {
        bestWindow = entries;
        bestTs = lastEntry.ts;
      }
    }

    if (!bestWindow || bestWindow.length < 3) return;

    const state = detectState(bestWindow);
    if (!state) return;

    context.conversationalState = state;
  }, "reflect");

  // Start cleanup timer
  _cleanupTimer = setInterval(cleanup, CLEANUP_INTERVAL);
  if (_cleanupTimer.unref) _cleanupTimer.unref();

  log.verbose("Reflect", "Reflect loaded");

  return {
    stop: () => {
      if (_cleanupTimer) {
        clearInterval(_cleanupTimer);
        _cleanupTimer = null;
      }
      windows.clear();
    },
  };
}
