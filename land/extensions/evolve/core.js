/**
 * Evolve Core
 *
 * Two phases:
 * 1. Pattern detection: afterNote and afterLLMCall record behavioral signals
 *    in a rolling window. When a pattern repeats enough times, it becomes
 *    a detected pattern stored on the land root metadata.
 *
 * 2. Proposal generation: a background job reads detected patterns, searches
 *    Horizon for matching extensions, and either suggests installation or
 *    generates a spec for an extension that doesn't exist yet.
 */

import log from "../../seed/log.js";
import Node from "../../seed/models/node.js";
import Note from "../../seed/models/note.js";
import { SYSTEM_ROLE, CONTENT_TYPE } from "../../seed/protocol.js";
import { parseJsonSafe } from "../../seed/orchestrators/helpers.js";
import { v4 as uuidv4 } from "uuid";

let _runChat = null;
let _metadata = null;
export function setRunChat(fn) { _runChat = fn; }
export function configure({ metadata }) { _metadata = metadata; }

const MAX_PATTERNS = 30;
const MAX_PROPOSALS = 20;
const MIN_OCCURRENCES = 10; // pattern must appear this many times before action
const WINDOW_SIZE = 200;    // rolling signal window

// ─────────────────────────────────────────────────────────────────────────
// SIGNAL RECORDING
// ─────────────────────────────────────────────────────────────────────────

// In-memory rolling window of behavioral signals
let signalWindow = [];

/**
 * Record a behavioral signal from a note or LLM interaction.
 */
export function recordSignal(signal) {
  signalWindow.push({ ...signal, ts: Date.now() });
  if (signalWindow.length > WINDOW_SIZE) {
    signalWindow = signalWindow.slice(-WINDOW_SIZE);
  }
}

/**
 * Detect behavioral patterns from the signal window.
 * Returns array of { type, description, count, examples }.
 */
function detectPatterns() {
  if (signalWindow.length < MIN_OCCURRENCES) return [];

  const patterns = [];

  // Pattern: notes containing dollar amounts (values extension gap)
  const dollarNotes = signalWindow.filter(s =>
    s.type === "note" && s.content && /\$\d+|\d+\s*dollars?/i.test(s.content)
  );
  if (dollarNotes.length >= MIN_OCCURRENCES) {
    patterns.push({
      type: "numeric-values",
      description: "Notes frequently contain dollar amounts or numeric values",
      count: dollarNotes.length,
      suggestedExtension: "values",
      examples: dollarNotes.slice(-3).map(s => s.content?.slice(0, 80)),
    });
  }

  // Pattern: notes containing dates/schedules
  const dateNotes = signalWindow.filter(s =>
    s.type === "note" && s.content && /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow|next week|deadline|due|by \d|schedule)\b/i.test(s.content)
  );
  if (dateNotes.length >= MIN_OCCURRENCES) {
    patterns.push({
      type: "scheduling",
      description: "Notes frequently reference dates, deadlines, or schedules",
      count: dateNotes.length,
      suggestedExtension: "schedules",
      examples: dateNotes.slice(-3).map(s => s.content?.slice(0, 80)),
    });
  }

  // Pattern: notes containing URLs
  const urlNotes = signalWindow.filter(s =>
    s.type === "note" && s.content && /https?:\/\/[^\s]+/i.test(s.content)
  );
  if (urlNotes.length >= MIN_OCCURRENCES) {
    patterns.push({
      type: "url-content",
      description: "Notes frequently contain URLs that could be auto-extracted",
      count: urlNotes.length,
      suggestedExtension: null, // no existing extension for this
      examples: urlNotes.slice(-3).map(s => s.content?.slice(0, 80)),
    });
  }

  // Pattern: AI frequently says "I don't have information about..."
  const silenceResponses = signalWindow.filter(s =>
    s.type === "llm-response" && s.hadAnswer === false
  );
  if (silenceResponses.length >= MIN_OCCURRENCES) {
    patterns.push({
      type: "knowledge-gap",
      description: "AI frequently cannot answer questions at certain positions",
      count: silenceResponses.length,
      suggestedExtension: "learn",
      examples: silenceResponses.slice(-3).map(s => s.query?.slice(0, 80)),
    });
  }

  // Pattern: user frequently switches between two branches
  const navSignals = signalWindow.filter(s => s.type === "navigation");
  if (navSignals.length >= 20) {
    const pathPairs = new Map();
    for (let i = 1; i < navSignals.length; i++) {
      const from = navSignals[i - 1].nodeId;
      const to = navSignals[i].nodeId;
      if (from && to && from !== to) {
        const key = [from, to].sort().join(":");
        pathPairs.set(key, (pathPairs.get(key) || 0) + 1);
      }
    }
    for (const [pair, count] of pathPairs) {
      if (count >= 5) {
        patterns.push({
          type: "frequent-path",
          description: `User frequently navigates between the same two positions (${count} times)`,
          count,
          suggestedExtension: "channels",
          examples: [pair],
        });
        break; // only report the most frequent
      }
    }
  }

  return patterns;
}

// ─────────────────────────────────────────────────────────────────────────
// PATTERN STORAGE
// ─────────────────────────────────────────────────────────────────────────

async function getLandRoot() {
  return Node.findOne({ systemRole: SYSTEM_ROLE.LAND_ROOT });
}

/**
 * Run detection from the signal window and store results.
 * Called by the background job.
 */
export async function detectAndStorePatterns() {
  const patterns = detectPatterns();
  if (patterns.length > 0) {
    await storePatterns(patterns);
  }
  return patterns;
}

/**
 * Write detected patterns to land root metadata.
 */
export async function storePatterns(patterns) {
  const landRoot = await getLandRoot();
  if (!landRoot) return;

  const meta = _metadata.getExtMeta(landRoot, "evolve") || {};
  const existing = meta.patterns || [];
  const dismissed = new Set((meta.dismissed || []).map(d => d.type));

  // Merge: update existing patterns, add new ones, skip dismissed
  for (const p of patterns) {
    if (dismissed.has(p.type)) continue;
    const idx = existing.findIndex(e => e.type === p.type);
    if (idx >= 0) {
      existing[idx].count = p.count;
      existing[idx].lastSeen = new Date().toISOString();
      existing[idx].examples = p.examples;
    } else {
      existing.push({
        id: uuidv4(),
        ...p,
        firstSeen: new Date().toISOString(),
        lastSeen: new Date().toISOString(),
        status: "detected", // detected, proposed, approved, dismissed
      });
    }
  }

  meta.patterns = existing.slice(0, MAX_PATTERNS);
  await _metadata.setExtMeta(landRoot, "evolve", meta);
  await landRoot.save();
}

// ─────────────────────────────────────────────────────────────────────────
// PROPOSAL GENERATION
// ─────────────────────────────────────────────────────────────────────────

/**
 * For each detected pattern, either suggest an existing extension
 * or generate a spec for a new one.
 */
export async function generateProposals() {
  const landRoot = await getLandRoot();
  if (!landRoot) return [];

  const meta = _metadata.getExtMeta(landRoot, "evolve") || {};
  const patterns = (meta.patterns || []).filter(p => p.status === "detected" && p.count >= MIN_OCCURRENCES);

  if (patterns.length === 0) return [];
  if (!_runChat) return [];

  // Check which extensions are installed
  let installedNames = new Set();
  try {
    const { getLoadedManifests } = await import("../../extensions/loader.js");
    installedNames = new Set(getLoadedManifests().map(m => m.name));
  } catch {}

  // Check Horizon for matching extensions
  let registryExts = [];
  try {
    const horizonUrl = process.env.HORIZON_URL?.split(",")[0]?.trim();
    if (horizonUrl) {
      const res = await fetch(`${horizonUrl}/extensions?limit=100`, {
        signal: AbortSignal.timeout(10000),
      });
      if (res.ok) {
        const data = await res.json();
        registryExts = data.extensions || [];
      }
    }
  } catch {}

  const registryNames = new Set(registryExts.map(e => e.name));
  const proposals = meta.proposals || [];

  for (const pattern of patterns) {
    // Already proposed?
    if (proposals.some(p => p.patternType === pattern.type)) continue;

    if (pattern.suggestedExtension) {
      // Known extension suggestion
      if (installedNames.has(pattern.suggestedExtension)) {
        // Already installed. Pattern might be a false positive. Skip.
        pattern.status = "resolved";
        continue;
      }

      const inRegistry = registryNames.has(pattern.suggestedExtension);
      proposals.push({
        id: uuidv4(),
        patternType: pattern.type,
        type: "install",
        extensionName: pattern.suggestedExtension,
        inRegistry,
        reason: pattern.description,
        occurrences: pattern.count,
        createdAt: new Date().toISOString(),
        status: "pending",
      });
      pattern.status = "proposed";
    } else {
      // No known extension. Generate a spec via AI.
      try {
        const prompt =
          `A tree user exhibits this behavioral pattern:\n` +
          `Pattern: ${pattern.description}\n` +
          `Occurrences: ${pattern.count}\n` +
          `Examples: ${(pattern.examples || []).join("; ")}\n\n` +
          `No existing extension handles this. Design one.\n\n` +
          `Return ONLY JSON following this format:\n` +
          `{\n` +
          `  "name": "extension-name",\n` +
          `  "description": "one sentence",\n` +
          `  "hooks": { "listens": ["afterNote"], "fires": [] },\n` +
          `  "tools": [{ "name": "tool-name", "description": "what it does" }],\n` +
          `  "cli": [{ "command": "cmd-name", "description": "what it does" }],\n` +
          `  "enrichContext": "what it injects into AI context",\n` +
          `  "needs": { "services": ["hooks"], "models": ["Node"] },\n` +
          `  "rationale": "why this extension would help"\n` +
          `}`;

        const { answer } = await _runChat({
          userId: "SYSTEM",
          username: "evolve",
          message: prompt,
          mode: "tree:respond",
          rootId: null,
        });

        const spec = answer ? parseJsonSafe(answer) : null;
        if (spec && spec.name) {
          proposals.push({
            id: uuidv4(),
            patternType: pattern.type,
            type: "spec",
            spec,
            reason: pattern.description,
            occurrences: pattern.count,
            createdAt: new Date().toISOString(),
            status: "pending",
          });
          pattern.status = "proposed";
        }
      } catch (err) {
        log.debug("Evolve", `Spec generation failed for ${pattern.type}: ${err.message}`);
      }
    }
  }

  meta.proposals = proposals.slice(0, MAX_PROPOSALS);
  meta.patterns = meta.patterns; // preserve updates
  await _metadata.setExtMeta(landRoot, "evolve", meta);
  await landRoot.save();

  return proposals.filter(p => p.status === "pending");
}

// ─────────────────────────────────────────────────────────────────────────
// READ / MANAGE
// ─────────────────────────────────────────────────────────────────────────

export async function getPatterns() {
  const landRoot = await getLandRoot();
  if (!landRoot) return [];
  const meta = _metadata.getExtMeta(landRoot, "evolve") || {};
  return (meta.patterns || []).filter(p => p.status !== "dismissed" && p.status !== "resolved");
}

export async function getProposals() {
  const landRoot = await getLandRoot();
  if (!landRoot) return [];
  const meta = _metadata.getExtMeta(landRoot, "evolve") || {};
  return (meta.proposals || []).filter(p => p.status === "pending");
}

export async function dismissPattern(patternId) {
  const landRoot = await getLandRoot();
  if (!landRoot) return null;

  const meta = _metadata.getExtMeta(landRoot, "evolve") || {};
  const pattern = (meta.patterns || []).find(p => p.id === patternId);
  if (!pattern) return null;

  pattern.status = "dismissed";
  if (!meta.dismissed) meta.dismissed = [];
  meta.dismissed.push({ type: pattern.type, dismissedAt: new Date().toISOString() });

  // Also dismiss any proposals for this pattern
  for (const p of (meta.proposals || [])) {
    if (p.patternType === pattern.type) p.status = "dismissed";
  }

  await _metadata.setExtMeta(landRoot, "evolve", meta);
  await landRoot.save();
  return pattern;
}

export async function approveProposal(proposalId) {
  const landRoot = await getLandRoot();
  if (!landRoot) return null;

  const meta = _metadata.getExtMeta(landRoot, "evolve") || {};
  const proposal = (meta.proposals || []).find(p => p.id === proposalId);
  if (!proposal) return null;

  proposal.status = "approved";
  proposal.approvedAt = new Date().toISOString();

  await _metadata.setExtMeta(landRoot, "evolve", meta);
  await landRoot.save();
  return proposal;
}
