/**
 * Rings Core
 *
 * The ring forms from the inside out, driven by the tree's own rhythm.
 * Not by the calendar. By the life.
 *
 * Four phases: growth, peak, hardening, dormant.
 * Phase detection is rate-based, not threshold-based.
 * The ring solidifies when the tree completes a full cycle.
 *
 * Activity rate rising for 2+ weeks:     growth
 * Activity rate high and stable:         peak
 * Activity rate declining for 2+ weeks:  hardening
 * Activity rate near zero for 1+ week:   dormant
 */

import log from "../../seed/log.js";
import { parseJsonSafe } from "../../seed/orchestrators/helpers.js";

let _Node = null;
let _Note = null;
let _runChat = null;
let _metadata = null;
let _getExtension = null;

export function configure({ Node, Note, runChat, metadata, getExtension }) {
  _Node = Node;
  _Note = Note;
  _runChat = runChat;
  _metadata = metadata;
  _getExtension = getExtension;
}

const RINGS_NODE_NAME = ".rings";
const PHASE_WINDOW_DAYS = 14;        // rate measured over 2 weeks
const DORMANT_THRESHOLD_DAYS = 7;    // near-zero activity for 1 week
const MAX_RING_AGE_MONTHS = 12;      // force hardening after 12 months without dormancy
const RATE_SAMPLES = 4;              // compare last 4 rate windows

// ── Phase detection ──

/**
 * Detect phase from activity rate history.
 * rates: array of recent activity counts per window (newest first)
 */
export function detectPhase(rates) {
  if (!rates || rates.length < 2) return "growth"; // not enough data

  const current = rates[0];
  const previous = rates[1];
  const avg = rates.reduce((a, b) => a + b, 0) / rates.length;

  // Dormant: current rate near zero
  if (current <= 1) return "dormant";

  // Growth: rate increasing
  if (current > previous * 1.2 && current > avg * 0.8) return "growth";

  // Hardening: rate declining
  if (current < previous * 0.8 && current < avg) return "hardening";

  // Peak: rate high and stable
  return "peak";
}

// ── Ring state management ──

export function getDefaultRingState() {
  return {
    started: new Date().toISOString(),
    phase: "growth",
    accumulator: {
      notesWritten: 0,
      nodesCreated: 0,
      nodesLost: 0,
      cascadeSignals: 0,
      contradictions: 0,
      topicMentions: {},
    },
    rateSamples: [],   // activity counts per window, newest first
    phaseHistory: [
      { phase: "growth", started: new Date().toISOString(), duration: null },
    ],
    hardeningProgress: 0,  // 0-4 (weeks of hardening work)
    character: null,
    essence: null,
  };
}

// ── Find or create .rings node ──

async function getRingsNode(rootId, userId) {
  const children = await _Node.find({ parent: rootId }).select("_id name systemRole").lean();
  let ringsNode = children.find(c => c.name === RINGS_NODE_NAME);
  if (!ringsNode) {
    const { createSystemNode } = await import("../../seed/tree/treeManagement.js");
    ringsNode = await createSystemNode({ name: RINGS_NODE_NAME, parentId: rootId });
    log.verbose("Rings", `Created ${RINGS_NODE_NAME} node under ${String(rootId).slice(0, 8)}`);
  }
  return ringsNode;
}

// ── Read completed rings ──

export async function getRings(rootId) {
  const children = await _Node.find({ parent: rootId }).select("_id name").lean();
  const ringsNode = children.find(c => c.name === RINGS_NODE_NAME);
  if (!ringsNode) return { rings: [], annual: [] };

  const notes = await _Note.find({ nodeId: ringsNode._id, contentType: "text" })
    .sort({ createdAt: -1 }).lean();

  const rings = [];
  const annual = [];

  for (const note of notes) {
    try {
      const ring = JSON.parse(note.content);
      if (ring.period === "year") annual.push(ring);
      else if (ring.period === "ring") rings.push(ring);
    } catch {}
  }

  return { rings, annual };
}

// ── Increment accumulator (called from hooks) ──

export async function incrementAccumulator(rootId, field, amount = 1) {
  if (!_metadata) return;
  try {
    const root = await _Node.findById(rootId).select("metadata").lean();
    if (!root) return;
    const ringState = _metadata.getExtMeta(root, "rings");
    if (!ringState?.accumulator) return;
    await _metadata.incExtMeta(rootId, "rings", `accumulator.${field}`, amount);
  } catch {}
}

export async function addTopicMention(rootId, word) {
  if (!_metadata || !word) return;
  try {
    const root = await _Node.findById(rootId).select("metadata").lean();
    if (!root) return;
    const ringState = _metadata.getExtMeta(root, "rings");
    if (!ringState?.accumulator) return;
    const mentions = ringState.accumulator.topicMentions || {};
    mentions[word] = (mentions[word] || 0) + 1;
    await _metadata.mergeExtMeta(root, "rings", { accumulator: { ...ringState.accumulator, topicMentions: mentions } });
  } catch {}
}

// ── Exhale tick: update rate, detect phase, progress hardening ──

export async function onExhale(rootId, userId, username) {
  if (!_Node || !_metadata) return;

  const root = await _Node.findById(rootId).select("metadata dateCreated children").lean();
  if (!root) return;

  let ringState = _metadata.getExtMeta(root, "rings");

  // Initialize ring state if missing
  if (!ringState || !ringState.started) {
    ringState = getDefaultRingState();
    await _metadata.setExtMeta(root, "rings", ringState);
    return;
  }

  // Calculate current activity rate (total accumulator activity)
  const acc = ringState.accumulator || {};
  const currentRate = (acc.notesWritten || 0) + (acc.nodesCreated || 0) + (acc.cascadeSignals || 0);

  // Add rate sample (keep last RATE_SAMPLES)
  const rates = [currentRate, ...(ringState.rateSamples || [])].slice(0, RATE_SAMPLES);

  // Detect phase
  const newPhase = detectPhase(rates);
  const oldPhase = ringState.phase;

  // Phase transition
  if (newPhase !== oldPhase) {
    const history = ringState.phaseHistory || [];
    // Close previous phase
    if (history.length > 0) {
      const last = history[history.length - 1];
      if (!last.duration) {
        const started = new Date(last.started);
        last.duration = `${Math.round((Date.now() - started.getTime()) / (24 * 60 * 60 * 1000))} days`;
      }
    }
    // Open new phase
    history.push({ phase: newPhase, started: new Date().toISOString(), duration: null });
    ringState.phaseHistory = history.slice(-20); // cap history
    ringState.phase = newPhase;

    log.verbose("Rings", `${String(rootId).slice(0, 8)} phase: ${oldPhase} -> ${newPhase}`);
  }

  ringState.rateSamples = rates;

  // ── Hardening work ──
  if (newPhase === "hardening" && ringState.hardeningProgress < 4) {
    ringState.hardeningProgress = (ringState.hardeningProgress || 0) + 1;

    if (ringState.hardeningProgress === 3 && !ringState.character) {
      // Week 3: synthesize character
      try {
        const charData = await buildCharacterData(rootId, ringState);
        const synthesized = await synthesizeCharacter(charData, rootId, userId, username);
        ringState.character = synthesized.character;
        ringState.essence = synthesized.essence;
      } catch (err) {
        log.warn("Rings", `Character synthesis failed: ${err.message}`);
      }
    }
  }

  // ── Dormancy: solidify ring ──
  if (newPhase === "dormant" && ringState.character) {
    await solidifyRing(rootId, userId, ringState);
    // Reset for new ring
    const fresh = getDefaultRingState();
    await _metadata.setExtMeta(root, "rings", fresh);
    return;
  }

  // ── Force ring after MAX_RING_AGE_MONTHS ──
  const started = new Date(ringState.started);
  const ageMs = Date.now() - started.getTime();
  if (ageMs > MAX_RING_AGE_MONTHS * 30 * 24 * 60 * 60 * 1000) {
    log.info("Rings", `${String(rootId).slice(0, 8)} hasn't rested in ${MAX_RING_AGE_MONTHS} months. Forcing ring.`);
    if (!ringState.character) {
      try {
        const charData = await buildCharacterData(rootId, ringState);
        const synthesized = await synthesizeCharacter(charData, rootId, userId, username);
        ringState.character = synthesized.character;
        ringState.essence = synthesized.essence;
      } catch {}
    }
    await solidifyRing(rootId, userId, ringState);
    const fresh = getDefaultRingState();
    await _metadata.setExtMeta(root, "rings", fresh);
    return;
  }

  await _metadata.setExtMeta(root, "rings", ringState);
}

// ── Build character data from tree state ──

async function buildCharacterData(rootId, ringState) {
  const root = await _Node.findById(rootId).select("_id name metadata dateCreated children").lean();
  const meta = root.metadata instanceof Map ? Object.fromEntries(root.metadata) : (root.metadata || {});

  // Tree age
  const createdAt = root.dateCreated ? new Date(root.dateCreated) : new Date();
  const ageMs = Date.now() - createdAt.getTime();
  const ageMonths = Math.floor(ageMs / (30 * 24 * 60 * 60 * 1000));
  const treeAge = ageMonths < 12 ? `${ageMonths} months` : `${Math.floor(ageMonths / 12)} years, ${ageMonths % 12} months`;

  // Structure
  const topChildren = await _Node.find({ parent: rootId }).select("name systemRole").lean();
  const branches = topChildren.filter(c => !c.systemRole && !c.name.startsWith(".")).map(c => c.name);
  const totalNodes = await _Node.countDocuments({ $or: [{ _id: rootId }] }); // simplified count

  // Read from other extensions
  const acc = ringState.accumulator || {};
  const topTopics = Object.entries(acc.topicMentions || {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([word]) => word);

  return {
    treeAge,
    branches,
    totalNodes,
    accumulator: acc,
    topTopics,
    thesis: meta.purpose?.thesis || null,
    coherence: meta.purpose?.coherence || null,
    patterns: (meta.evolution?.patterns || []).slice(0, 3).map(p => p.pattern || p),
    phaseHistory: ringState.phaseHistory || [],
    ringDuration: `${Math.round((Date.now() - new Date(ringState.started).getTime()) / (24 * 60 * 60 * 1000))} days`,
  };
}

// ── Public: assemble current ring data from live state ──

export async function assembleRingData(rootId) {
  if (!_Node || !_metadata) return null;
  const root = await _Node.findById(rootId).select("metadata").lean();
  if (!root) return null;
  const ringState = _metadata.getExtMeta(root, "rings");
  return buildCharacterData(rootId, ringState || getDefaultRingState());
}

// ── LLM character synthesis ──

async function synthesizeCharacter(data, rootId, userId, username) {
  if (!_runChat) return { character: "Character synthesis unavailable.", essence: "Data collected." };

  const prompt = `You are analyzing a tree's growth ring. This ring formed over ${data.ringDuration} through natural activity phases. Based on the data, write:

1. CHARACTER: 2-3 sentences. What the tree focused on. How it grew. What changed. Third person.
2. ESSENCE: One sentence. The ring in one breath.

Tree age: ${data.treeAge}
Branches: ${data.branches.join(", ")}
Notes written: ${data.accumulator.notesWritten}, Nodes created: ${data.accumulator.nodesCreated}
Cascade signals: ${data.accumulator.cascadeSignals}
Dominant topics: ${data.topTopics.join(", ") || "unknown"}
Thesis: ${data.thesis || "none set"}
Thesis coherence: ${data.coherence ?? "unknown"}
Patterns discovered: ${data.patterns.join("; ") || "none"}
Phase history: ${data.phaseHistory.map(p => `${p.phase} (${p.duration || "current"})`).join(" -> ")}

Respond with JSON only: { "character": "...", "essence": "..." }`;

  try {
    const { answer } = await _runChat({
      userId, username, message: prompt,
      mode: "tree:respond", rootId,
      slot: "rings", llmPriority: 4,
    });
    const parsed = parseJsonSafe(answer);
    return {
      character: parsed?.character || "Character synthesis failed.",
      essence: parsed?.essence || "Ring formed.",
    };
  } catch (err) {
    log.warn("Rings", `Synthesis failed: ${err.message}`);
    return { character: "Character synthesis unavailable.", essence: "Data collected." };
  }
}

// ── Solidify a completed ring ──

async function solidifyRing(rootId, userId, ringState) {
  const data = await buildCharacterData(rootId, ringState);
  const ringsNode = await getRingsNode(rootId, userId);
  const { createNote } = await import("../../seed/tree/notes.js");

  const ring = {
    period: "ring",
    started: ringState.started,
    ended: new Date().toISOString(),
    duration: data.ringDuration,
    treeAge: data.treeAge,
    structure: { branches: data.branches, totalNodes: data.totalNodes },
    accumulator: ringState.accumulator,
    phaseHistory: ringState.phaseHistory,
    dominantTopics: data.topTopics,
    character: ringState.character,
    essence: ringState.essence,
  };

  await createNote({
    nodeId: String(ringsNode._id),
    content: JSON.stringify(ring, null, 2),
    contentType: "text",
    userId,
  });

  log.info("Rings", `Ring solidified for ${String(rootId).slice(0, 8)}: ${ring.started} to ${ring.ended} (${ring.duration})`);

  // Check for annual compression
  const year = new Date().getFullYear() - 1;
  const { rings } = await getRings(rootId);
  const yearRings = rings.filter(r => {
    const d = new Date(r.ended || r.started);
    return d.getFullYear() === year;
  });
  if (yearRings.length >= 2) {
    await compressAnnual(rootId, userId, ringState, yearRings, year);
  }
}

// ── Annual compression ──

async function compressAnnual(rootId, userId, ringState, yearRings, year) {
  const summaries = yearRings.map(r =>
    `${r.started} to ${r.ended} (${r.duration}): ${r.character || "no character"}`
  ).join("\n");

  let character = `Year ${year}: ${yearRings.length} rings completed.`;
  let essence = `Year ${year}.`;

  if (_runChat) {
    try {
      const owner = await _Node.findById(rootId).select("rootOwner").lean();
      const user = owner?.rootOwner ? await (await import("../../seed/models/user.js")).default.findById(owner.rootOwner).select("username").lean() : null;

      const { answer } = await _runChat({
        userId, username: user?.username || "unknown",
        message: `Compress these ${yearRings.length} tree rings into one annual ring for year ${year}.\n\nRings:\n${summaries}\n\nWrite:\n1. CHARACTER: 3-4 sentences. The year's arc.\n2. ESSENCE: One sentence. The year in one breath.\n\nJSON only: { "character": "...", "essence": "..." }`,
        mode: "tree:respond", rootId, slot: "rings", llmPriority: 4,
      });
      const parsed = parseJsonSafe(answer);
      if (parsed?.character) character = parsed.character;
      if (parsed?.essence) essence = parsed.essence;
    } catch {}
  }

  const annualRing = {
    period: "year",
    year,
    ringsCount: yearRings.length,
    character,
    essence,
  };

  const ringsNode = await getRingsNode(rootId, userId);
  const { createNote } = await import("../../seed/tree/notes.js");
  await createNote({
    nodeId: String(ringsNode._id),
    content: JSON.stringify(annualRing, null, 2),
    contentType: "text",
    userId,
  });

  // Delete individual rings for this year
  const allNotes = await _Note.find({ nodeId: ringsNode._id, contentType: "text" }).lean();
  for (const note of allNotes) {
    try {
      const r = JSON.parse(note.content);
      if (r.period === "ring") {
        const d = new Date(r.ended || r.started);
        if (d.getFullYear() === year) {
          await _Note.findByIdAndDelete(note._id);
        }
      }
    } catch {}
  }

  log.info("Rings", `Annual ring for ${year}: ${yearRings.length} rings compressed.`);
}
