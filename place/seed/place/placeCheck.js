// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// Checking the place. The reconciler for the world I form.
//
// Three primitives carry a dual-pointer tree:
//
//   Space   parent           + children[]
//   Matter  parentMatterId   + children[]
//   Being   parentBeingId    + children[]
//
// If a parent and its children[] array disagree, everything built
// on the tree fails silently. I verify pointer agreement across
// all three at genesis and again on a daily cadence, and
// auto-repair where safe. Where it isn't safe I log loudly and
// leave the breach for the operator.
//
// Pointer-agreement repair (uniform across primitives):
//   parent says A but A's children[] is missing this  →  add to children[]
//   children[] includes ID but that record is gone    →  remove from children[]
//   children[] includes ID but child's parent differs →  remove from children[]
//
// Orphan handling (no parent, not a root) is primitive-specific:
//   Space orphan   parent = DELETED (soft-delete sentinel)
//   Matter orphan  spaceId + beingId = DELETED
//   Being orphan   no auto-repair. Beings are durable identities;
//                  log loudly, leave to the operator.
//
// Streams via cursor (memory-bounded on large places). Progress
// logged every 10K records.
//
// Runs at genesis, then daily, and on demand via
// core.system.checkPlace().

import log from "../system/log.js";
import Space from "../models/space.js";
import Matter from "../models/matter.js";
import Being from "../models/being.js";
import { invalidateAll } from "./space/ancestorCache.js";
import { getPlaceConfigValue } from "../placeConfig.js";
import { SEED_SPACE, DELETED } from "./space/seedSpaces.js";

const MAX_DETAILS = 500;
const PROGRESS_INTERVAL = 10000;

// ────────────────────────────────────────────────────────────────
// Primitive descriptors
// ────────────────────────────────────────────────────────────────
//
// Each entry tells the generic walker how to read parent/children
// pointers and how to repair orphans for that primitive. Adding a
// fourth tree-shaped primitive is one new entry here plus an import.

const PRIMITIVES = [
  {
    label:        "Space",
    Model:        Space,
    parentField:  "parent",
    selectFields: "_id parent children seedSpace name",
    findPlaceRoot: (records) => {
      for (const [id, r] of records) {
        if (r.raw.seedSpace === SEED_SPACE.PLACE_ROOT) return id;
      }
      return null;
    },
    isRoot:       (doc, placeRootId) =>
      doc.seedSpace === SEED_SPACE.PLACE_ROOT || String(doc._id) === placeRootId,
    softDeleteOrphan: async (id) => {
      await Space.updateOne({ _id: id }, { $set: { parent: DELETED } });
    },
  },
  {
    label:        "Matter",
    Model:        Matter,
    parentField:  "parentMatterId",
    selectFields: "_id parentMatterId children name spaceId beingId",
    findPlaceRoot: () => null,
    // Matter is root-shaped when parentMatterId is null AND it isn't
    // already soft-deleted (spaceId !== DELETED).
    isRoot:       (doc) => !doc.parentMatterId && doc.spaceId !== DELETED,
    softDeleteOrphan: async (id) => {
      await Matter.updateOne({ _id: id }, { $set: { spaceId: DELETED, beingId: DELETED } });
    },
  },
  {
    label:        "Being",
    Model:        Being,
    parentField:  "parentBeingId",
    selectFields: "_id parentBeingId children name",
    findPlaceRoot: () => null,
    // The single root being has parentBeingId === null.
    isRoot:       (doc) => !doc.parentBeingId,
    // Beings are durable identities; log orphans but do not auto-
    // repair. Operator decides whether to re-parent or remove.
    softDeleteOrphan: null,
  },
];

/**
 * Run a full integrity check across every tree-shaped primitive.
 *
 * @param {object} [opts]
 * @param {boolean} [opts.repair=true]  - auto-repair safe inconsistencies
 * @param {boolean} [opts.silent=false] - suppress log output
 * @returns {Promise<{ duration, byPrimitive: { [label]: report } }>}
 */
export async function checkPlace({ repair = true, silent = false } = {}) {
  const startMs = Date.now();
  const byPrimitive = {};

  for (const def of PRIMITIVES) {
    byPrimitive[def.label] = await checkOnePrimitive(def, { repair, silent });
  }

  // Any repair on the Space tree means ancestor caches must drop.
  if (byPrimitive.Space?.repaired > 0) invalidateAll();

  return {
    duration: Date.now() - startMs,
    byPrimitive,
  };
}

/**
 * One primitive's integrity pass.
 */
async function checkOnePrimitive(def, { repair, silent }) {
  const report = {
    checked: 0,
    issues: 0,
    repaired: 0,
    orphans: [],
    details: [],
    durationMs: 0,
  };
  const startMs = Date.now();
  const addDetail = (msg) => { if (report.details.length < MAX_DETAILS) report.details.push(msg); };

  // Stream all records into an in-memory map. The cross-check between
  // parent and children[] requires both halves visible at once, so we
  // pay the memory cost (bounded by collection size). For very large
  // collections this can become two passes (one to map, one to scan);
  // not yet warranted.
  const records = new Map();
  const cursor = def.Model.find({}).select(def.selectFields).lean().cursor();
  for await (const r of cursor) {
    const id = String(r._id);
    records.set(id, {
      parent:   r[def.parentField] ? String(r[def.parentField]) : null,
      children: new Set((r.children || []).map(String)),
      raw:      r,
    });
  }
  report.checked = records.size;

  // Resolve place-root id once (Space-only; others return null).
  const placeRootId = def.findPlaceRoot(records);

  let processed = 0;
  for (const [id, rec] of records) {
    processed++;
    if (!silent && processed % PROGRESS_INTERVAL === 0) {
      log.verbose("Integrity", `[${def.label}] progress: ${processed}/${report.checked}`);
    }

    // Skip already-soft-deleted records. Space uses parent=DELETED;
    // Matter uses spaceId=DELETED. Being has no soft-delete state.
    if (rec.parent === DELETED) continue;
    if (def.label === "Matter" && rec.raw.spaceId === DELETED) continue;

    // ── 1. Parent must exist and list this record in its children[] ──
    if (rec.parent) {
      const parent = records.get(rec.parent);

      if (!parent) {
        report.issues++;
        report.orphans.push(id);
        addDetail(`[${def.label}] ${rec.raw.name || id}: parent ${rec.parent} does not exist`);

        if (repair && def.softDeleteOrphan) {
          await def.softDeleteOrphan(id);
          report.repaired++;
          if (!silent) log.warn("Integrity", `[${def.label}] soft-deleted ${id} (dangling parent ${rec.parent})`);
        }
      } else if (!parent.children.has(id)) {
        report.issues++;
        addDetail(`[${def.label}] ${rec.raw.name || id}: parent missing this in children[]`);

        if (repair) {
          await def.Model.updateOne({ _id: rec.parent }, { $addToSet: { children: id } });
          report.repaired++;
          if (!silent) log.warn("Integrity", `[${def.label}] added ${id} to parent's children[]`);
        }
      }
    } else if (!def.isRoot(rec.raw, placeRootId)) {
      report.orphans.push(id);
      addDetail(`[${def.label}] ${rec.raw.name || id}: orphan (no parent, not a root)`);

      if (repair && def.softDeleteOrphan) {
        await def.softDeleteOrphan(id);
        report.repaired++;
        if (!silent) log.warn("Integrity", `[${def.label}] soft-deleted orphan ${id}`);
      }
    }

    // ── 2. children[] must point at records whose parent points back ──
    if (rec.children.size > 0) {
      const phantoms = [];
      const mispointed = [];

      for (const cid of rec.children) {
        const child = records.get(cid);
        if (!child) {
          phantoms.push(cid);
        } else if (child.parent !== id) {
          mispointed.push({ id: cid, name: child.raw.name, actualParent: child.parent });
        }
      }

      if (phantoms.length > 0) {
        report.issues += phantoms.length;
        addDetail(`[${def.label}] ${rec.raw.name || id}: ${phantoms.length} phantom child reference(s)`);
        if (repair) {
          await def.Model.updateOne({ _id: id }, { $pullAll: { children: phantoms } });
          report.repaired += phantoms.length;
          if (!silent) log.warn("Integrity", `[${def.label}] removed ${phantoms.length} phantom children from ${id}`);
        }
      }

      if (mispointed.length > 0) {
        report.issues += mispointed.length;
        for (const m of mispointed) {
          addDetail(`[${def.label}] ${rec.raw.name || id}: child ${m.name || m.id} parent points to ${m.actualParent}`);
        }
        if (repair) {
          await def.Model.updateOne({ _id: id }, { $pullAll: { children: mispointed.map((m) => m.id) } });
          report.repaired += mispointed.length;
          if (!silent) log.warn("Integrity", `[${def.label}] removed ${mispointed.length} mispointed children from ${id}`);
        }
      }
    }
  }

  if (report.details.length >= MAX_DETAILS) {
    report.details.push(`... (capped at ${MAX_DETAILS} details)`);
  }
  report.durationMs = Date.now() - startMs;

  if (!silent) {
    if (report.issues === 0) {
      log.verbose("Integrity", `[${def.label}] ${report.checked} records, no issues (${report.durationMs}ms)`);
    } else {
      log.warn("Integrity",
        `[${def.label}] ${report.checked} records, ${report.issues} issues, ` +
        `${report.repaired} repaired, ${report.orphans.length} orphans (${report.durationMs}ms)`);
    }
  }

  return report;
}

/**
 * Start the periodic integrity job. Default: once per day.
 * Configurable via placeCheckInterval (ms).
 */
export function startPlaceCheckJob() {
  const interval = parseInt(getPlaceConfigValue("placeCheckInterval") || "86400000", 10);
  const timer = setInterval(() => {
    checkPlace({ repair: true, silent: false }).catch((err) => {
      log.error("Integrity", `Periodic check failed: ${err.message}`);
    });
  }, interval);
  if (timer.unref) timer.unref();
  return timer;
}
