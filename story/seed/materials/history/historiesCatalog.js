// historiesCatalog.js — read-side helper that returns the branch graph
// as a plain object. Powers the synthetic `<story>/.branches[/<path>]`
// SEE catalog the portal uses to draw its chip row.
//
// Returns:
//   {
//     current: { path, parent, anchor, label, paused, isLive, createdAt },
//     lineage: [ "0", ..., <path> ],
//     children: [ ...same shape as current ],
//   }
//

import History from "./history.js";
import {
  MAIN,
  loadHistory,
  resolveHistoryLineage,
  commonAncestor,
  divergentFactsSince,
} from "./histories.js";
import { readPointers } from "./historyRegistry.js";

export async function describeHistoriesCatalog(historyPath = MAIN) {
  const path =
    typeof historyPath === "string" && historyPath.length > 0 ? historyPath : MAIN;
  const isMainPath = path === MAIN;

  // Lineage: just ["0"] for main; ["0", ..., path] for everything else.
  const lineage = isMainPath ? [MAIN] : await resolveHistoryLineage(path);

  // Current branch row. Main starts implicit (no document), but
  // pause-branch upserts a row when the operator first pauses main.
  // If a real row exists, surface it; otherwise synthesize the
  // implicit-live default. Either way the portal renders main and
  // non-main with the same shape.
  let current;
  if (isMainPath) {
    const mainRow = await loadHistory(MAIN).catch(() => null);
    if (mainRow) {
      current = _serializeHistory(mainRow);
      // Even after a pause row exists, main's structural fields stay
      // implicit (parent=null, no anchor, the synthetic label).
      current.parent = null;
      current.anchor = null;
      if (!current.label) current.label = "main";
    } else {
      current = {
        path: MAIN,
        parent: null,
        anchor: null,
        label: "main",
        paused: false,
        deleted: false,
        createdAt: null,
        isLive: true,
      };
    }
  } else {
    const row = await loadHistory(path);
    if (!row) {
      // Caller is asking about a branch that doesn't exist. Return a
      // not-found shape rather than throwing; SEE callers can render
      // "unknown branch" without an error envelope.
      return {
        current: null,
        lineage: [MAIN],
        children: [],
        notFound: true,
      };
    }
    current = _serializeHistory(row);
  }

  // Direct children: rows whose parent is this path. Main's children
  // carry parent=null (main has no row).
  //
  // Deleted branches drop from the default listing. They still exist
  // in the chain and SEE on a specific deleted path still resolves
  // (current slot above honors the direct lookup), but they don't
  // clutter the branch picker. Undelete brings them back.
  const childRows = await History.find({
    ...(isMainPath ? { parent: null } : { parent: path }),
    deleted: { $ne: true },
  })
    .sort({ path: 1 })
    .lean();
  const children = childRows.map(_serializeHistory);

  // The named-pointer map ({ main: "0", prod: "7", ... }). One read; the
  // client filters names whose value === a branch path to show "pointers
  // aimed here." Surfaced for the full "see branch" info view.
  const pointers = await readPointers().catch(() => ({}));

  // Chain fingerprints (past/fact/chainRoots.js): this branch's root
  // hash and the whole story's root. Same root = same chain state;
  // two substrates compare worlds in one number. TTL-memoized inside
  // chainRoots so this stays cheap on the hot SEE path.
  let rootHash = null;
  let chainStoryRoot = null;
  try {
    const { historyRoot, storyRoot } = await import("../../past/fact/chainRoots.js");
    rootHash = await historyRoot(isMainPath ? MAIN : path);
    chainStoryRoot = await storyRoot();
  } catch { /* fingerprints are additive — never block the catalog */ }

  return {
    current,
    lineage,
    children,
    pointers,
    rootHash,
    storyRoot: chainStoryRoot,
  };
}

function _serializeHistory(row) {
  if (!row) return null;
  const bp =
    row.branchPoint instanceof Map
      ? Object.fromEntries(row.branchPoint)
      : row.branchPoint || {};
  return {
    path: row.path,
    parent: row.parent || null,
    anchor: bp,
    label: row.label || null,
    paused: !!row.paused,
    deleted: !!row.deleted,
    isLive: !!row.isLive,
    createdAt: row.createdAt ? new Date(row.createdAt).toISOString() : null,
    createdBy: row.createdBy || null,
    mergeSources: Array.isArray(row.mergeSources) ? [...row.mergeSources] : [],
    // Full-info fields for the "see branch" view. Cheap to surface (all
    // on the row); a thin chip-row renderer just ignores them.
    scope: row.scope || null,
    pausedBy: row.pausedBy || null,
    pausedAt: row.pausedAt ? new Date(row.pausedAt).toISOString() : null,
    deletedBy: row.deletedBy || null,
    deletedAt: row.deletedAt ? new Date(row.deletedAt).toISOString() : null,
    archivedBecause: row.archivedBecause || null,
  };
}

/**
 * Return the conflict catalog for a merged branch. Reads the branch's
 * `mergeSources` to identify the two source branches, computes their
 * common ancestor, runs `divergentFactsSince` for both sides, and
 * groups by reel key into one of three categories:
 *
 *   - "clean-A": only source A touched this reel since the ancestor.
 *                The merged branch already inherits source A's state
 *                through reel-lineage when the operator chooses to
 *                propagate it; suggestedStrategy is "take-A".
 *   - "clean-B": symmetric.
 *   - "conflict": both sources touched it. User must resolve.
 *
 * Reset reels (state that's branch-private by nature, like inhabit-
 * state) get their own category in Phase 5; this returns "conflict"
 * for them today.
 *
 * @param {string} historyPath  the merged branch's path
 * @returns {Promise<object>}
 */
export async function describeMergeConflicts(historyPath) {
  const row = await loadHistory(historyPath);
  if (!row) {
    return { branch: historyPath, notFound: true, conflicts: [] };
  }
  const sources = Array.isArray(row.mergeSources) ? row.mergeSources : [];
  if (sources.length !== 2) {
    return {
      branch: historyPath,
      notAMerge: true,
      reason: "branch has no mergeSources (was not created by merge-branches)",
      conflicts: [],
    };
  }
  const [sourceA, sourceB] = sources;
  const ancestor = await commonAncestor(sourceA, sourceB);

  const [diffA, diffB] = await Promise.all([
    divergentFactsSince(sourceA, ancestor),
    divergentFactsSince(sourceB, ancestor),
  ]);

  // Union of reel keys touched on either side.
  const allReels = new Set([...diffA.keys(), ...diffB.keys()]);

  // Walk reconciliation facts on the merged branch's reels so the
  // catalog reports which conflicts are RESOLVED vs still OPEN. A
  // reconciliation fact is any normal action fact stamped on the
  // merged branch that carries `params._merge`. The mediator and
  // the user stamp these identically; the catalog doesn't care which.
  //
  // This makes the catalog a live decision log: the UI re-renders
  // when a fact lands, and the next mediator call SEEs the current
  // state and picks up at the first open conflict.
  const resolutions = await _readMergeResolutions(historyPath, allReels);
  const conflicts = [];
  for (const reelKey of allReels) {
    const factsA = diffA.get(reelKey) || [];
    const factsB = diffB.get(reelKey) || [];
    const inA = factsA.length > 0;
    const inB = factsB.length > 0;
    let side, suggestedStrategy;
    if (inA && inB) {
      side = "conflict";
      suggestedStrategy = "compose";
    } else if (inA) {
      side = "clean-A";
      suggestedStrategy = "take-A";
    } else {
      side = "clean-B";
      suggestedStrategy = "take-B";
    }
    const resolutionFact = resolutions.get(reelKey) || null;
    const status = resolutionFact ? "resolved" : "open";
    conflicts.push({
      reelKey,
      side,
      status,
      suggestedStrategy,
      factCountA: factsA.length,
      factCountB: factsB.length,
      // Last fact on each side is the most-recent divergent write; the
      // mediator surfaces it as the "current value" candidate. Full fact
      // lists are reachable via the reel-explorer SEE catalog if the
      // operator wants to dig deeper.
      lastFactA:
        factsA.length > 0 ? _summarizeFact(factsA[factsA.length - 1]) : null,
      lastFactB:
        factsB.length > 0 ? _summarizeFact(factsB[factsB.length - 1]) : null,
      resolution: resolutionFact ? _summarizeResolution(resolutionFact) : null,
    });
  }

  // Sort: open conflicts first (the work to do), then resolved
  // conflicts, then clean reels grouped by side. Within each group,
  // alphabetical by reel key for stable rendering. The UI scrolls to
  // the first open conflict on render so the mediator and operator
  // always pick up at the right row.
  const order = { conflict: 0, "clean-A": 1, "clean-B": 2 };
  const statusOrder = { open: 0, resolved: 1 };
  conflicts.sort((a, b) => {
    const ss = statusOrder[a.status] - statusOrder[b.status];
    if (ss !== 0) return ss;
    const o = order[a.side] - order[b.side];
    return o !== 0 ? o : a.reelKey.localeCompare(b.reelKey);
  });

  const openConflicts = conflicts.filter(c => c.side === "conflict" && c.status === "open").length;
  const resolvedConflicts = conflicts.filter(c => c.side === "conflict" && c.status === "resolved").length;
  return {
    branch: historyPath,
    sourceA,
    sourceB,
    ancestor,
    conflicts,
    totals: {
      total: conflicts.length,
      conflicts: conflicts.filter((c) => c.side === "conflict").length,
      conflictsOpen: openConflicts,
      conflictsResolved: resolvedConflicts,
      cleanA: conflicts.filter((c) => c.side === "clean-A").length,
      cleanB: conflicts.filter((c) => c.side === "clean-B").length,
    },
  };
}

function _summarizeFact(fact) {
  return {
    seq: fact.seq,
    verb: fact.verb,
    act: fact.act,
    branch: fact.history,
    date: fact.date ? new Date(fact.date).toISOString() : null,
    through: fact.through || null,
    params: fact.params || null,
  };
}

// Read reconciliation facts on the merged branch's reels. A reel is
// considered resolved when there's at least one fact stamped on the
// merged branch's storage for that reel carrying `params._merge`.
// Returns a Map<reelKey, latest-resolution-fact>.
//
// Implementation: ONE query against Fact with branch=mergedHistory and
// params._merge exists, filtered to the conflict reel set. Cheaper than
// per-reel queries; bounded by the number of reconciliation facts in
// the merged branch (small even for large merges).
async function _readMergeResolutions(mergedHistory, reelKeys) {
  if (!reelKeys || reelKeys.size === 0) return new Map();
  const { default: Fact } = await import("../../past/fact/fact.js");
  // Decompose reel keys ("kind:id") into target filters. Build a single
  // $in query per kind so the round-trip stays one read.
  const kindToIds = new Map();
  for (const key of reelKeys) {
    const sepIdx = key.indexOf(":");
    if (sepIdx < 0) continue;
    const kind = key.slice(0, sepIdx);
    const id = key.slice(sepIdx + 1);
    if (!kindToIds.has(kind)) kindToIds.set(kind, []);
    kindToIds.get(kind).push(id);
  }
  if (kindToIds.size === 0) return new Map();
  const orClauses = [];
  for (const [kind, ids] of kindToIds) {
    orClauses.push({ "of.kind": kind, "of.id": { $in: ids } });
  }
  const facts = await Fact.find({
    history: mergedHistory,
    "params._merge": { $exists: true },
    $or: orClauses,
  }).sort({ seq: 1, date: 1 }).lean();
  // Latest fact per reel wins (if a conflict was resolved more than
  // once, the most recent decision is what's authoritative).
  const byReel = new Map();
  for (const f of facts) {
    const key = `${f.of.kind}:${f.of.id}`;
    byReel.set(key, f);
  }
  return byReel;
}

function _summarizeResolution(fact) {
  return {
    seq: fact.seq,
    act: fact.act,
    branch: fact.history,
    date: fact.date ? new Date(fact.date).toISOString() : null,
    through: fact.through || null,
    strategy: fact.params?._merge?.strategy || null,
    sourceHistory: fact.params?._merge?.sourceHistory || null,
    note: fact.params?._merge?.note || null,
    // Surface the actual values the resolution chose (params minus the
    // _merge metadata block) so the UI can render "Resolution: position
    // set to (5, 3)" without re-folding the reel.
    value: _extractResolutionValue(fact.params),
  };
}

function _extractResolutionValue(params) {
  if (!params || typeof params !== "object") return null;
  const { _merge, ...rest } = params;
  return rest;
}
