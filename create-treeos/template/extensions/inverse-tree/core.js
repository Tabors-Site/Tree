/**
 * Inverse Tree Core
 *
 * Builds a model of the user from observing their behavior.
 * Stores in user metadata["inverse-tree"]. Compressed every N interactions.
 */

import log from "../../seed/log.js";
import User from "../../seed/models/user.js";
import { getUserMeta, setUserMeta } from "../../seed/tree/userMetadata.js";
import { parseJsonSafe } from "../../seed/orchestrators/helpers.js";

let _runChat = null;
export function setRunChat(fn) { _runChat = fn; }

// ─────────────────────────────────────────────────────────────────────────
// CONFIG
// ─────────────────────────────────────────────────────────────────────────

const DEFAULTS = {
  compressionInterval: 50,     // interactions between compression passes
  maxSignals: 200,             // rolling buffer cap before forced compression
  maxProfileBytes: 8192,       // cap on the compressed profile
  profileZones: ["home", "tree"],  // zones where profile injects. "land" excluded by default.
};

export function getInverseConfig(landConfig) {
  return { ...DEFAULTS, ...(landConfig || {}) };
}

// ─────────────────────────────────────────────────────────────────────────
// STATE ACCESS
// ─────────────────────────────────────────────────────────────────────────

const META_KEY = "inverse-tree";

async function loadUser(userId) {
  return User.findById(userId);
}

export function getInverseData(user) {
  return getUserMeta(user, META_KEY);
}

function emptyState() {
  return {
    profile: {},
    signals: [],
    stats: {
      totalInteractions: 0,
      interactionsSinceCompression: 0,
      lastCompressed: null,
      activeHours: {},
      topTrees: {},
      topTools: {},
    },
    corrections: [],
    lastUpdated: null,
  };
}

function ensureState(data) {
  if (!data || typeof data !== "object") return emptyState();
  if (!data.profile) data.profile = {};
  if (!Array.isArray(data.signals)) data.signals = [];
  if (!data.stats) data.stats = { totalInteractions: 0, interactionsSinceCompression: 0, lastCompressed: null, activeHours: {}, topTrees: {}, topTools: {} };
  if (!Array.isArray(data.corrections)) data.corrections = [];
  return data;
}

async function saveState(userId, data) {
  const user = await loadUser(userId);
  if (!user) return;
  data.lastUpdated = new Date().toISOString();
  setUserMeta(user, META_KEY, data);
  await user.save();
}

// ─────────────────────────────────────────────────────────────────────────
// SIGNAL RECORDING
// ─────────────────────────────────────────────────────────────────────────

/**
 * Record a signal from user behavior. Lightweight. No AI call.
 * Returns true if compression threshold was reached.
 */
export async function recordSignal(userId, signal, config) {
  const user = await loadUser(userId);
  if (!user) return false;

  const data = ensureState(getInverseData(user));

  // Add signal to rolling buffer
  data.signals.push({ ...signal, timestamp: new Date().toISOString() });

  // Cap buffer
  if (data.signals.length > config.maxSignals) {
    data.signals = data.signals.slice(-config.maxSignals);
  }

  // Update stats
  data.stats.totalInteractions++;
  data.stats.interactionsSinceCompression++;

  // Track active hour
  const hour = new Date().getHours();
  data.stats.activeHours[hour] = (data.stats.activeHours[hour] || 0) + 1;

  // Track tree usage
  if (signal.rootId) {
    data.stats.topTrees[signal.rootId] = (data.stats.topTrees[signal.rootId] || 0) + 1;
  }

  // Track tool usage
  if (signal.type === "tool" && signal.toolName) {
    data.stats.topTools[signal.toolName] = (data.stats.topTools[signal.toolName] || 0) + 1;
  }

  data.lastUpdated = new Date().toISOString();
  setUserMeta(user, META_KEY, data);
  await user.save();

  return data.stats.interactionsSinceCompression >= config.compressionInterval;
}

// ─────────────────────────────────────────────────────────────────────────
// COMPRESSION
// ─────────────────────────────────────────────────────────────────────────

// In-flight guard
const _compressing = new Set();

/**
 * Run a compression pass. AI reads accumulated signals + current profile
 * and produces an updated user model.
 */
export async function compress(userId) {
  if (_compressing.has(userId)) return null;
  _compressing.add(userId);

  try {
    if (!_runChat) return null;

    const user = await loadUser(userId);
    if (!user) return null;

    const data = ensureState(getInverseData(user));
    if (data.signals.length === 0 && Object.keys(data.profile).length === 0) return null;

    // Build stats summary
    const hourEntries = Object.entries(data.stats.activeHours).sort((a, b) => b[1] - a[1]);
    const peakHours = hourEntries.slice(0, 3).map(([h, c]) => `${h}:00 (${c})`).join(", ");

    const toolEntries = Object.entries(data.stats.topTools).sort((a, b) => b[1] - a[1]);
    const topTools = toolEntries.slice(0, 5).map(([t, c]) => `${t} (${c})`).join(", ");

    // Separate intentions from other signals for the goalsVsActions analysis
    const intentions = data.signals.filter((s) => s.type === "intention");
    const otherSignals = data.signals.filter((s) => s.type !== "intention");

    const signalSummary = otherSignals
      .map((s) => `[${s.type}] ${s.value || s.toolName || s.topic || JSON.stringify(s)}`)
      .join("\n");

    const intentionSummary = intentions.length > 0
      ? `\n\nStated intentions (${intentions.length}):\n` +
        intentions.map((s) => `- "${s.value}" (at ${s.topic}, ${s.timestamp})`).join("\n")
      : "";

    const existingProfile = Object.keys(data.profile).length > 0
      ? `\nExisting profile (update, refine, do not discard valid observations):\n${JSON.stringify(data.profile, null, 2)}`
      : "";

    const corrections = data.corrections.length > 0
      ? `\nUser corrections (these are ground truth, override inferences):\n${data.corrections.map((c) => `- "${c.text}"`).join("\n")}`
      : "";

    const prompt =
      `You are building a behavioral model of a user from observed signals.\n\n` +
      `Username: ${user.username}\n` +
      `Total interactions: ${data.stats.totalInteractions}\n` +
      `Peak activity hours: ${peakHours || "unknown"}\n` +
      `Most used tools: ${topTools || "none"}\n` +
      existingProfile +
      corrections +
      `\n\nRecent activity signals (${otherSignals.length}):\n${signalSummary}` +
      intentionSummary +
      `\n\nUpdate the user profile. Return JSON with these category keys (add only categories you have evidence for):\n` +
      `{\n` +
      `  "values": "what this user cares about, stated and inferred",\n` +
      `  "knowledge": "domains of expertise and learning edges",\n` +
      `  "habits": "behavioral patterns, when/how they work",\n` +
      `  "communicationStyle": "how they prefer to interact with AI",\n` +
      `  "unresolvedQuestions": "topics they keep returning to without resolution",\n` +
      `  "recurringFrustrations": "what triggers negative reactions",\n` +
      `  "goalsVsActions": "stated intentions versus observed behavior"\n` +
      `}\n\n` +
      `Each value should be a concise string (1-3 sentences). Only include categories with evidence.\n` +
      `User corrections are ground truth. If the user said "I prefer direct feedback", that overrides ` +
      `any inference about communication style.\n\n` +
      `For goalsVsActions: compare the stated intentions above against the actual activity signals. ` +
      `If the user said "I will start running three times a week" but the activity shows no fitness-related ` +
      `notes or tool usage in the weeks since, that is an action gap. If they followed through, note that too. ` +
      `Be specific about which intentions have evidence of follow-through and which do not.`;

    const { answer } = await _runChat({
      userId,
      username: user.username,
      message: prompt,
      mode: "home:default",
    });

    if (!answer) return null;

    const newProfile = parseJsonSafe(answer);
    if (!newProfile || typeof newProfile !== "object" || Array.isArray(newProfile)) return null;

    // Cap profile size
    const profileStr = JSON.stringify(newProfile);
    if (Buffer.byteLength(profileStr, "utf8") > 8192) {
      // Trim to fit: keep only the categories with the most content
      const entries = Object.entries(newProfile).sort((a, b) =>
        String(b[1]).length - String(a[1]).length,
      );
      while (entries.length > 0 && Buffer.byteLength(JSON.stringify(Object.fromEntries(entries)), "utf8") > 8192) {
        entries.pop();
      }
    }

    // Update state
    data.profile = newProfile;
    data.signals = [];  // Clear buffer after compression
    data.stats.interactionsSinceCompression = 0;
    data.stats.lastCompressed = new Date().toISOString();

    data.lastUpdated = new Date().toISOString();
    setUserMeta(user, META_KEY, data);
    await user.save();

    log.verbose("InverseTree", `Compressed profile for ${user.username}: ${Object.keys(newProfile).length} categories`);
    return newProfile;
  } catch (err) {
    log.error("InverseTree", `Compression failed for ${userId}: ${err.message}`);
    return null;
  } finally {
    _compressing.delete(userId);
  }
}

// ─────────────────────────────────────────────────────────────────────────
// USER CORRECTIONS
// ─────────────────────────────────────────────────────────────────────────

export async function addCorrection(userId, text) {
  const user = await loadUser(userId);
  if (!user) throw new Error("User not found");
  const data = ensureState(getInverseData(user));
  data.corrections.push({ text, timestamp: new Date().toISOString() });
  // Cap corrections
  if (data.corrections.length > 50) data.corrections = data.corrections.slice(-50);
  data.lastUpdated = new Date().toISOString();
  setUserMeta(user, META_KEY, data);
  await user.save();
  return data.corrections;
}

// ─────────────────────────────────────────────────────────────────────────
// PROFILE ACCESS
// ─────────────────────────────────────────────────────────────────────────

export async function getProfile(userId) {
  const user = await User.findById(userId).lean();
  if (!user) return null;
  const meta = user.metadata instanceof Map
    ? user.metadata.get(META_KEY) || {}
    : user.metadata?.[META_KEY] || {};
  return {
    profile: meta.profile || {},
    stats: meta.stats || {},
    corrections: meta.corrections || [],
    lastUpdated: meta.lastUpdated,
  };
}

export async function resetProfile(userId) {
  const user = await loadUser(userId);
  if (!user) throw new Error("User not found");
  setUserMeta(user, META_KEY, emptyState());
  await user.save();
}
