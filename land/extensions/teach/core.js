// Teach Core
//
// Extract meta-knowledge from intelligence extensions into transferable lesson sets.
// Each lesson: { id, from, insight, confidence, sampleSize, extractedAt }
// LLM distills raw extension state into actionable natural language insights.

import log from "../../seed/log.js";
import { getExtMeta, setExtMeta } from "../../seed/tree/extensionMetadata.js";
import { getExtension } from "../loader.js";
import { parseJsonSafe } from "../../seed/orchestrators/helpers.js";
import { v4 as uuidv4 } from "uuid";

let Node = null;
let logContribution = async () => {};
let runChat = null;
let useEnergy = async () => ({ energyUsed: 0 });

export function setServices({ models, contributions, llm, energy }) {
  Node = models.Node;
  logContribution = contributions.logContribution;
  runChat = llm.runChat;
  if (energy?.useEnergy) useEnergy = energy.useEnergy;
}

const TEACH_VERSION = "1.0.0";

// ─────────────────────────────────────────────────────────────────────────
// EXTRACTION SOURCES
// Each collector reads an extension's accumulated state and returns
// a data summary string for the LLM to distill.
// ─────────────────────────────────────────────────────────────────────────

const COLLECTORS = [
  {
    extName: "evolution",
    label: "structural evolution patterns",
    collect: async (rootId) => {
      const ext = getExtension("evolution");
      if (!ext?.exports?.getEvolutionReport) return null;
      try {
        const report = await ext.exports.getEvolutionReport(rootId);
        if (!report || !report.fitness) return null;
        return JSON.stringify({
          fitness: report.fitness,
          patterns: report.patterns?.slice(0, 10),
          survivedStructures: report.survivedStructures?.slice(0, 5),
          revertedStructures: report.revertedStructures?.slice(0, 5),
        });
      } catch { return null; }
    },
  },
  {
    extName: "prune",
    label: "pruning history and dormancy patterns",
    collect: async (rootId) => {
      const root = await Node.findById(rootId).select("metadata").lean();
      if (!root) return null;
      const pruneMeta = getExtMeta(root, "prune");
      if (!pruneMeta?.history?.length) return null;
      return JSON.stringify({
        totalPruned: pruneMeta.history.reduce((s, h) => s + (h.pruned || 0), 0),
        totalAbsorbed: pruneMeta.history.reduce((s, h) => s + (h.absorbed || 0), 0),
        pruneCount: pruneMeta.history.length,
        recentHistory: pruneMeta.history.slice(-5),
        dormancyDays: pruneMeta.dormancyDays,
      });
    },
  },
  {
    extName: "purpose",
    label: "thesis coherence trends",
    collect: async (rootId) => {
      const ext = getExtension("purpose");
      if (!ext?.exports?.getThesis) return null;
      try {
        const thesis = await ext.exports.getThesis(rootId);
        if (!thesis) return null;
        return JSON.stringify({
          thesis: thesis.statement,
          coherence: thesis.coherence,
          lastChecked: thesis.lastCheckedAt,
          rederiveCount: thesis.rederiveCount,
        });
      } catch { return null; }
    },
  },
  {
    extName: "codebook",
    label: "language compression statistics",
    collect: async (rootId) => {
      const ext = getExtension("codebook");
      if (!ext?.exports?.getCodebookStats) return null;
      try {
        const stats = await ext.exports.getCodebookStats(rootId);
        if (!stats) return null;
        return JSON.stringify(stats);
      } catch { return null; }
    },
  },
  {
    extName: "boundary",
    label: "structural cohesion analysis",
    collect: async (rootId) => {
      const ext = getExtension("boundary");
      if (!ext?.exports?.getBoundaryReport) return null;
      try {
        const report = await ext.exports.getBoundaryReport(rootId);
        if (!report) return null;
        return JSON.stringify({
          overallCoherence: report.overallCoherence,
          branchCount: report.branchCount,
          findingsCount: report.findings?.length,
          topFindings: report.findings?.slice(0, 5),
        });
      } catch { return null; }
    },
  },
  {
    extName: "tree-compress",
    label: "compression patterns",
    collect: async (rootId) => {
      const ext = getExtension("tree-compress");
      if (!ext?.exports?.getCompressStatus) return null;
      try {
        const status = await ext.exports.getCompressStatus(rootId);
        if (!status) return null;
        return JSON.stringify(status);
      } catch { return null; }
    },
  },
  {
    extName: "phase",
    label: "activity phase patterns",
    collect: async (rootId) => {
      const ext = getExtension("phase");
      if (!ext?.exports?.getPhaseState) return null;
      try {
        const state = await ext.exports.getPhaseState(rootId);
        if (!state) return null;
        return JSON.stringify(state);
      } catch { return null; }
    },
  },
];

const EXTRACT_PROMPT = `You are analyzing accumulated data from a tree's intelligence extensions. Your job is to distill actionable lessons from the raw data.

For each data source below, produce 0-3 lessons. Each lesson must be:
- A concrete, specific insight (not generic advice)
- Derived from the data (not assumed)
- Useful to someone starting a similar tree from scratch

Data sources:
{sources}

Return a JSON array of lessons:
[
  {
    "from": "extension-name",
    "insight": "Specific actionable insight derived from the data",
    "confidence": 0.85,
    "sampleSize": 47
  }
]

Rules:
- confidence is 0-1 based on how much data supports the insight
- sampleSize is the approximate number of data points behind it
- If a data source has too little data for a meaningful insight, skip it
- Maximum 15 lessons total
- If no meaningful lessons can be extracted, return []`;

// ─────────────────────────────────────────────────────────────────────────
// EXPORT (extract lessons from a tree)
// ─────────────────────────────────────────────────────────────────────────

export async function extractLessons(rootId, userId, username) {
  await useEnergy({ userId, action: "teachExtract" });

  const root = await Node.findById(rootId).select("_id name rootOwner").lean();
  if (!root) throw new Error("Tree root not found");

  // Collect data from all available intelligence extensions
  const sources = [];
  for (const collector of COLLECTORS) {
    const data = await collector.collect(rootId);
    if (data) {
      sources.push({ extName: collector.extName, label: collector.label, data });
    }
  }

  if (sources.length === 0) {
    throw new Error("No intelligence extension data available to extract lessons from");
  }

  // Format sources for the LLM
  const sourcesText = sources.map(s =>
    `[${s.extName}] ${s.label}:\n${s.data}`
  ).join("\n\n");

  const prompt = EXTRACT_PROMPT.replace("{sources}", sourcesText);

  const result = await runChat({
    userId,
    username,
    message: prompt,
    mode: "tree:respond",
    rootId,
  });

  if (!result?.answer) throw new Error("Lesson extraction produced no result");

  const parsed = parseJsonSafe(result.answer);
  if (!Array.isArray(parsed)) throw new Error("Lesson extraction did not return a valid lesson array");

  // Add IDs and metadata to each lesson
  const lessons = parsed
    .filter(l => l && l.from && l.insight && typeof l.confidence === "number")
    .slice(0, 15)
    .map(l => ({
      id: uuidv4(),
      from: l.from,
      insight: l.insight,
      confidence: Math.max(0, Math.min(1, l.confidence)),
      sampleSize: l.sampleSize || 0,
      extractedAt: new Date().toISOString(),
    }));

  // Get land info
  let sourceLand = "unknown";
  try {
    const { getLandIdentity } = await import("../../canopy/identity.js");
    const identity = getLandIdentity();
    if (identity?.domain) sourceLand = identity.domain;
  } catch {}

  // Calculate tree age
  const treeAge = root.dateCreated
    ? Math.round((Date.now() - new Date(root.dateCreated).getTime()) / (30 * 24 * 60 * 60 * 1000))
    : null;

  const lessonSet = {
    teachVersion: TEACH_VERSION,
    source: `${root.name} tree, ${sourceLand}${treeAge ? `, ${treeAge} months active` : ""}`,
    sourceTreeId: rootId,
    sourceTreeName: root.name,
    sourceLand,
    exportedAt: new Date().toISOString(),
    exportedBy: username,
    extensionsQueried: sources.map(s => s.extName),
    lessons,
  };

  // Log contribution
  await logContribution({
    userId,
    nodeId: rootId,
    wasAi: true,
    action: "teach:exported",
    extensionData: {
      teach: {
        lessonCount: lessons.length,
        extensionsQueried: sources.map(s => s.extName),
      },
    },
  });

  log.info("Teach", `Extracted ${lessons.length} lesson(s) from ${root.name} (${sources.length} sources)`);

  return lessonSet;
}

// ─────────────────────────────────────────────────────────────────────────
// IMPORT (absorb lessons into a tree)
// ─────────────────────────────────────────────────────────────────────────

export async function importLessons(rootId, lessonSet, userId) {
  if (!lessonSet?.lessons?.length) throw new Error("No lessons in the provided set");

  const root = await Node.findById(rootId);
  if (!root) throw new Error("Tree root not found");

  const meta = getExtMeta(root, "teach");
  if (!meta.lessons) meta.lessons = [];
  if (!meta.dismissed) meta.dismissed = [];

  // Merge: add new lessons, skip duplicates by insight text
  const existingInsights = new Set(meta.lessons.map(l => l.insight));
  const dismissedInsights = new Set(meta.dismissed.map(l => l.insight));
  let added = 0;

  for (const lesson of lessonSet.lessons) {
    if (existingInsights.has(lesson.insight)) continue;
    if (dismissedInsights.has(lesson.insight)) continue;

    meta.lessons.push({
      ...lesson,
      id: lesson.id || uuidv4(),
      importedAt: new Date().toISOString(),
      importedFrom: lessonSet.source || "unknown",
    });
    added++;
  }

  await setExtMeta(root, "teach", meta);

  await logContribution({
    userId,
    nodeId: rootId,
    wasAi: false,
    action: "teach:imported",
    extensionData: {
      teach: {
        added,
        total: meta.lessons.length,
        source: lessonSet.source,
      },
    },
  });

  log.verbose("Teach", `Imported ${added} lesson(s) to ${root.name} (${meta.lessons.length} total)`);

  return { added, total: meta.lessons.length, source: lessonSet.source };
}

// ─────────────────────────────────────────────────────────────────────────
// SHARE (send lessons to a peered land via cascade)
// ─────────────────────────────────────────────────────────────────────────

export async function shareLessons(rootId, peerDomain, userId, username) {
  const lessonSet = await extractLessons(rootId, userId, username);

  // Send via deliverCascade with a teach-specific tag
  const { deliverCascade } = await import("../../seed/tree/cascade.js");
  const result = await deliverCascade({
    nodeId: rootId,
    signalId: uuidv4(),
    payload: {
      _teach: true,
      lessonSet,
      targetPeer: peerDomain,
    },
    source: rootId,
    depth: 0,
  });

  log.verbose("Teach", `Shared ${lessonSet.lessons.length} lesson(s) from ${rootId} to ${peerDomain}`);

  return {
    shared: true,
    lessonCount: lessonSet.lessons.length,
    targetPeer: peerDomain,
    cascadeStatus: result?.status,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// DISMISS (mark a lesson as not applicable)
// ─────────────────────────────────────────────────────────────────────────

export async function dismissLesson(rootId, lessonId, userId) {
  const root = await Node.findById(rootId);
  if (!root) throw new Error("Tree root not found");

  const meta = getExtMeta(root, "teach");
  if (!meta.lessons) return { dismissed: false };
  if (!meta.dismissed) meta.dismissed = [];

  const idx = meta.lessons.findIndex(l => l.id === lessonId);
  if (idx === -1) throw new Error("Lesson not found");

  const lesson = meta.lessons.splice(idx, 1)[0];
  lesson.dismissedAt = new Date().toISOString();
  lesson.dismissedBy = userId;
  meta.dismissed.push(lesson);

  await setExtMeta(root, "teach", meta);

  log.verbose("Teach", `Dismissed lesson "${lesson.insight.slice(0, 60)}..." at ${rootId}`);

  return { dismissed: true, lessonId, insight: lesson.insight };
}

// ─────────────────────────────────────────────────────────────────────────
// READ
// ─────────────────────────────────────────────────────────────────────────

export async function getLessons(rootId) {
  const root = await Node.findById(rootId).select("metadata").lean();
  if (!root) throw new Error("Tree root not found");

  const meta = getExtMeta(root, "teach");
  return {
    lessons: meta.lessons || [],
    dismissed: meta.dismissed || [],
    totalActive: (meta.lessons || []).length,
    totalDismissed: (meta.dismissed || []).length,
  };
}
