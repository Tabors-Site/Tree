// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// casSweep — retention for the content-addressable store.
//
// Replaces the old uploads orphan sweeper (uploadCleanup.js, retired
// with the multer-name upload system). Content blobs are addressed by
// hash and possibly shared by many matter rows across many histories
// (dedup), so the question is never "which file does this row own" —
// it is "does anything still reference this hash."
//
// Two retention policies, story-config `contentRetention`:
//
//   "all"    (default) — a blob stays while ANY fact on ANY history
//            names its hash. Full history: historical folds and
//            history rewinds can resolve every version's bytes.
//            Identical bytes still store once (the hash dedups), so
//            "keep all" costs one blob per DISTINCT version, not per
//            edit. The only blobs removed are ones no fact ever
//            referenced (crashed puts, abandoned two-step uploads)
//            plus anything the purge-content op already deleted.
//
//   "latest" — a blob stays only while some LIVE projection (any
//            history, non-tombstoned) carries its hash as the CURRENT
//            content. Old versions' bytes reclaim on the next sweep
//            (their facts remain — the chain still proves the hash,
//            size, and type; only the bytes are gone, and reads
//            return the purged marker). For realities that edit big
//            binaries (every mp4 tweak) and don't want the pileup.
//
// Targeted removal — "I accidentally posted that" — is NOT this
// sweeper's job: the purge-content DO op deletes specific blobs
// immediately, with a fact explaining why. The sweeper is the
// background policy; purge is the scalpel.
//
// Safety furniture carried over from the old sweeper:
//   - Grace period: blobs younger than graceMs are spared — they may
//     belong to a put whose fact hasn't sealed yet (the write path
//     puts BEFORE the fact by design).
//   - TOCTOU guard: re-stat before delete; skip if mtime moved.
//   - Per-cycle cap so one run cannot block for minutes.

import { getInternalConfigValue } from "../../internalConfig.js";
import { getStoryConfigValue } from "../../storyConfig.js";
import log from "../../seedStory/log.js";
import { listHashes, deleteContent, statContent } from "./contentStore.js";

let sweepTimer = null;

const DEFAULT_GRACE_MS = 60 * 60 * 1000;        // 1 hour
const DEFAULT_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours
function maxDeletionsPerCycle() {
  return Math.max(10, Math.min(Number(getInternalConfigValue("uploadCleanupBatchSize")) || 1000, 50000));
}

function retentionPolicy() {
  const v = getStoryConfigValue("contentRetention");
  return v === "latest" ? "latest" : "all";
}

/**
 * Every live history: main + every non-deleted history row. The curated
 * reader over the file-backed history store (histories.js) is the seam;
 * we never enumerate reels/<history> dirs ourselves. Content blobs are
 * shared across histories (the hash dedups), so the sweep's reference
 * set must union over ALL of them — a blob is dead only when NO history
 * references it.
 */
async function listSweepHistories() {
  const { listLiveHistories } = await import("../history/histories.js");
  const MAIN = "0";
  const out = [MAIN];
  try {
    for (const row of await listLiveHistories()) {
      if (row._id !== MAIN) out.push(row._id);
    }
  } catch (err) {
    log.warn("CAS", `history enumeration failed (sweeping main only): ${err.message}`);
  }
  return out;
}

/**
 * Collect every hash the chain references (policy "all"): any matter
 * fact whose params carry a cas content ref — create-matter and
 * set-matter content writes both put the ref at params.content (or
 * params.value for field=content set-matter facts).
 *
 * Curated route (no raw Fact.find): content refs ride matter reels, so
 * we enumerate each live history's matter ids (projections.listByType)
 * and read each matter reel through the curated fact seam
 * (facts.getFactsOnReelWhere), keeping the cas-ref-bearing facts. The
 * union across reels reproduces the old global `Fact.find({"params.
 * content.kind":"cas"})` scan, expressed through the one seam.
 */
async function referencedByFacts() {
  const { listByType } = await import("../projections.js");
  const { getFactsOnReelWhere } = await import("../../past/fact/facts.js");
  const referenced = new Set();
  const hasCasRef = (f) =>
    f?.params?.content?.kind === "cas" || f?.params?.value?.kind === "cas";
  for (const history of await listSweepHistories()) {
    let matterIds;
    try {
      matterIds = await listByType("matter", history);
    } catch (err) {
      log.warn("CAS", `listByType(matter, #${history}) failed: ${err.message}`);
      continue;
    }
    for (const occ of matterIds) {
      const id = occ?.id ?? occ;
      const facts = getFactsOnReelWhere(history, "matter", id, hasCasRef);
      for (const f of facts) {
        const h1 = f?.params?.content?.kind === "cas" ? f?.params?.content?.hash : null;
        const h2 = f?.params?.value?.kind === "cas" ? f?.params?.value?.hash : null;
        if (typeof h1 === "string") referenced.add(h1);
        if (typeof h2 === "string") referenced.add(h2);
      }
    }
  }
  return referenced;
}

/**
 * Collect every hash some live projection's CURRENT content carries
 * (policy "latest"), across ALL histories.
 *
 * Curated route (no raw Projection.find): enumerate each live history's
 * matter ids (projections.listByType, which already drops tombstones)
 * and fold each to its current state (projections.loadOrFold). The
 * lineage-aware loadOrFold gives the history's effective CURRENT content
 * — the same "live, non-tombstoned, current content" set the old global
 * `Projection.find({type:"matter", "state.content.kind":"cas"})` scan
 * produced, expressed through the one seam.
 */
async function referencedByLatestProjections() {
  const { listByType, loadOrFold } = await import("../projections.js");
  const referenced = new Set();
  for (const history of await listSweepHistories()) {
    let matterIds;
    try {
      matterIds = await listByType("matter", history);
    } catch (err) {
      log.warn("CAS", `listByType(matter, #${history}) failed: ${err.message}`);
      continue;
    }
    for (const occ of matterIds) {
      const id = occ?.id ?? occ;
      const slot = await loadOrFold("matter", id, history);
      if (!slot || slot.tombstoned) continue;
      const c = slot.state?.content;
      // A purged ref doesn't keep bytes alive — the op already removed
      // them; resurrecting via the sweep's reference set would be odd
      // but harmless (the blob is gone). Skip it for clarity.
      if (c?.kind === "cas" && typeof c.hash === "string" && c.purged !== true) {
        referenced.add(c.hash);
      }
    }
  }
  return referenced;
}

/**
 * One sweep cycle. Walks the store, deletes blobs the active policy
 * no longer retains.
 *
 * @param {object} [opts]
 * @param {number} [opts.graceMs]  minimum blob age before deletion
 * @returns {Promise<{scanned, deleted, freedKB, capped, policy}>}
 */
export async function sweepCas({ graceMs = DEFAULT_GRACE_MS } = {}) {
  const policy = retentionPolicy();
  const referenced = policy === "latest"
    ? await referencedByLatestProjections()
    : await referencedByFacts();

  const now = Date.now();
  let scanned = 0;
  let deleted = 0;
  let freedKB = 0;
  let capped = false;

  for await (const { hash, size, mtimeMs } of listHashes()) {
    scanned++;
    if (referenced.has(hash)) continue;
    if (deleted >= maxDeletionsPerCycle()) {
      capped = true;
      break;
    }
    // Grace: a fresh blob may belong to a put whose fact hasn't
    // sealed (or a two-step upload whose create-matter is coming).
    if (now - mtimeMs < graceMs) continue;
    try {
      // TOCTOU guard: re-stat; skip if the blob was touched since.
      const recheck = await statContent(hash);
      if (!recheck || recheck.mtimeMs !== mtimeMs) continue;
      const removed = await deleteContent(hash);
      if (removed) {
        deleted++;
        freedKB += Math.ceil(size / 1024);
      }
    } catch (err) {
      log.warn("CAS", `Failed to reclaim ${hash.slice(0, 12)}...: ${err.message}`);
    }
  }

  if (deleted > 0) {
    log.info(
      "CAS",
      `Reclaimed ${deleted} blob(s) (${freedKB} KB) under "${policy}" retention` +
      (capped ? " (cap reached, more next cycle)" : ""),
    );
  }
  return { scanned, deleted, freedKB, capped, policy };
}

/** Start the periodic sweep. */
export function startCasSweep({
  intervalMs = Number(getInternalConfigValue("uploadCleanupInterval")) || DEFAULT_INTERVAL_MS,
  graceMs    = Number(getInternalConfigValue("uploadGracePeriodMs"))   || DEFAULT_GRACE_MS,
} = {}) {
  if (sweepTimer) clearInterval(sweepTimer);
  sweepTimer = setInterval(() => {
    sweepCas({ graceMs }).catch((err) =>
      log.error("CAS", `Sweep error: ${err.message}`),
    );
  }, intervalMs);
  if (sweepTimer.unref) sweepTimer.unref();
  log.verbose("CAS", `Retention sweep started (every ${Math.round(intervalMs / 60000)}m, grace ${Math.round(graceMs / 60000)}m)`);
}

/** Stop the periodic sweep. */
export function stopCasSweep() {
  if (sweepTimer) {
    clearInterval(sweepTimer);
    sweepTimer = null;
  }
}
