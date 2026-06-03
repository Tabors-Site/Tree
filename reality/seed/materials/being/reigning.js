// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// Reigning beings. The set of beings admitted into heaven and its
// Tier-3 seed spaces (identity, config, tools, roles, operations,
// extensions, source, peers, threads).
//
// Storage shape. One matter at heaven, kind "reign", carrying the
// roster on its qualities:
//
//   <reality>/./             heaven space
//     ↳ one matter (kind: "reign")
//       qualities.reign.beings: [<beingId>, ...]
//
// The seed plants this matter at boot if it doesn't exist; runtime
// add/remove writes the updated list through standard set-matter
// facts. isReigning(beingId) is an O(1) cache lookup; the cache
// loads from the matter at boot.
//
// Why a single matter and not a per-being child space? The roster is
// a small flat list, not a queryable registry of items each with their
// own surface. A list value on one row is the substrate-native shape
// for that. Same pattern as how config keys live in qualities on the
// config space rather than one child space per key.
//
// Membership rules.
//   I-Am is always reigning (hard-coded in the cache; never removable).
//   Seed delegates auto-add during boot (after their Being rows are
//     planted) via ensureSeedDelegatesReign().
//   The rootOperator (first human) auto-adds in cherub.register's
//     first-being branch.
//   Subsequent additions go through the `add-reigning` DO op (only
//     callable from an already-reigning stance).

import Space from "../space/space.js";
import Matter from "../matter/matter.js";
import { SEED_SPACE } from "../space/seedSpaces.js";
import { MATTER_ORIGIN } from "../matter/origins.js";
import { I_AM } from "./seedBeings.js";
import log from "../../seedReality/log.js";
import { registerOperation } from "../../ibp/operations.js";

const REIGN_MATTER_KIND = "reign";

// In-memory cache. I-Am is the doctrinal floor; she is always reigning
// and can never be removed. The cache is the in-process source of
// truth for "what the next list looks like": addReigningBeing updates
// the cache, then writes `[...cache]` to the matter. This is what
// keeps multiple add/remove calls inside ONE moment from clobbering
// each other . each set-matter Fact replaces the whole list, so if
// each Fact computed its own "next" from the unsealed disk state,
// the last Fact would win and earlier additions in the same moment
// would be lost.
const _reigningBeings = new Set([I_AM]);

// Module-level remembering of the reign matter's id. Populated by
// ensureReignMatter at boot (or lazily on first find). Lets runtime
// add/remove skip the Matter.findOne round-trip and also lets us
// stamp set-matter Facts within the boot moment even though the
// create-matter Fact for the matter hasn't sealed yet on disk.
let _reignMatterId = null;

/**
 * Membership check. Constant-time; called once per stance derivation.
 */
export function isReigning(beingId) {
  if (!beingId) return false;
  return _reigningBeings.has(String(beingId));
}

/**
 * Snapshot the current set as an array (for diagnostics + wire surfaces).
 */
export function listReigningBeings() {
  return [..._reigningBeings];
}

/**
 * Plant the reign matter at heaven if it doesn't exist yet. Called
 * once during boot, BEFORE ensureSeedDelegatesReign so the in-moment
 * write path has a stable matter id to target. Idempotent across
 * boots (Matter.findOne short-circuits on awakening).
 *
 * Also caches the matter id in `_reignMatterId` for runtime callers.
 */
export async function ensureReignMatter(summonCtx) {
  if (!summonCtx) {
    throw new Error(
      "ensureReignMatter requires summonCtx (the boot moment's ctx).",
    );
  }
  const { findBySeedSpace } = await import("../projections.js");
  const heaven = await findBySeedSpace(SEED_SPACE.HEAVEN, "0");
  if (!heaven) {
    log.warn(
      "Reigning",
      "ensureReignMatter: heaven not materialized; skipping",
    );
    return null;
  }
  // Find existing reign matter by direct projection query.
  const { default: Projection } = await import("../branch/projection.js");
  const existing = await Projection.findOne({
    branch: "0", type: "matter",
    "state.spaceId": heaven.id,
    "state.kind": REIGN_MATTER_KIND,
    tombstoned: { $ne: true },
  }).select("id").lean();
  if (existing) {
    _reignMatterId = String(existing.id);
    return _reignMatterId;
  }
  const { doVerb } = await import("../../ibp/verbs/do.js");
  const result = await doVerb(
    { kind: "space", id: String(heaven.id) },
    "create-matter",
    {
      kind: REIGN_MATTER_KIND,
      origin: MATTER_ORIGIN.IBP,
      qualities: { reign: { beings: [I_AM] } },
    },
    { scaffold: true, summonCtx },
  );
  const matterId = result?.matterId || result?.id || null;
  if (matterId) {
    _reignMatterId = String(matterId);
  }
  return _reignMatterId;
}

/**
 * Look up the reign matter id. Uses the cached id when set; otherwise
 * queries Mongo once and caches. Returns null if the matter doesn't
 * exist yet (caller decides whether that's fatal or graceful).
 */
async function getReignMatterId() {
  if (_reignMatterId) return _reignMatterId;
  const { findBySeedSpace } = await import("../projections.js");
  const heaven = await findBySeedSpace(SEED_SPACE.HEAVEN, "0");
  if (!heaven) return null;
  const { default: Projection } = await import("../branch/projection.js");
  const existing = await Projection.findOne({
    branch: "0", type: "matter",
    "state.spaceId": heaven.id,
    "state.kind": REIGN_MATTER_KIND,
    tombstoned: { $ne: true },
  }).select("id").lean();
  if (existing) {
    _reignMatterId = String(existing.id);
    return _reignMatterId;
  }
  return null;
}

/**
 * Read the reign matter into the in-memory cache. Idempotent. Called
 * once during boot AFTER ensureReignMatter (which may have stamped a
 * create-matter Fact this boot moment) seals, OR on plain awakening
 * (the matter already exists on disk).
 */
export async function loadReigningBeings() {
  try {
    const matterId = await getReignMatterId();
    if (!matterId) return;
    const { loadProjection } = await import("../projections.js");
    const matterSlot = await loadProjection("matter", matterId, "0");
    if (!matterSlot) return;
    const quals = matterSlot.state?.qualities;
    const reign = quals instanceof Map ? quals.get("reign") : quals?.reign;
    const beings = reign?.beings;
    if (Array.isArray(beings)) {
      for (const id of beings) {
        if (typeof id === "string" && id.length > 0) {
          _reigningBeings.add(id);
        }
      }
    }
    _reigningBeings.add(I_AM);
  } catch (err) {
    log.error(
      "Reigning",
      `loadReigningBeings failed: ${err.message}. I-Am remains alone until repair.`,
    );
  }
}

/**
 * Add a being to the reigning roster. Updates the in-memory cache
 * (the in-process source of truth) and stamps a set-matter Fact
 * whose value is the full cache contents. The cache-as-source pattern
 * keeps multiple add/remove calls in the same moment from clobbering
 * each other . each Fact carries the accumulated list, last-Fact-wins
 * picks the most-complete state.
 *
 * @param {string} beingId
 * @param {object} ctx . { summonCtx, identity?, addedBy? }
 */
export async function addReigningBeing(beingId, ctx = {}) {
  const id = String(beingId || "").trim();
  if (!id) throw new Error("addReigningBeing requires a non-empty beingId");
  if (_reigningBeings.has(id)) return;
  const matterId = await getReignMatterId();
  if (!matterId) {
    throw new Error(
      "addReigningBeing: heaven's reign matter not planted yet (call ensureReignMatter at boot)",
    );
  }

  _reigningBeings.add(id);
  const next = [..._reigningBeings];

  const { doVerb } = await import("../../ibp/verbs/do.js");
  // Identity-driven writes thread the caller through; seed-attributed
  // writes (boot delegate anointing, cherub's anoint of the
  // rootOperator) flow through the scaffold path. Same pattern as
  // realityConfig.js's set-config wrapper.
  const opts = ctx.identity
    ? { identity: ctx.identity, summonCtx: ctx.summonCtx || null }
    : { scaffold: true, summonCtx: ctx.summonCtx || null };
  await doVerb(
    { kind: "matter", id: matterId },
    "set-matter",
    { field: "qualities.reign.beings", value: next, merge: false },
    opts,
  );
  log.info("Reigning", `Added reigning being: ${id}`);
}

/**
 * Remove a being from the reigning roster. Refuses to remove I-Am.
 * Same cache-as-source pattern as addReigningBeing.
 */
export async function removeReigningBeing(beingId, ctx = {}) {
  const id = String(beingId || "").trim();
  if (!id) throw new Error("removeReigningBeing requires a non-empty beingId");
  if (id === I_AM) {
    throw new Error("Cannot remove I-Am from the reigning set");
  }
  if (!_reigningBeings.has(id)) return;
  const matterId = await getReignMatterId();
  if (!matterId) {
    throw new Error(
      "removeReigningBeing: heaven's reign matter not planted yet (call ensureReignMatter at boot)",
    );
  }

  _reigningBeings.delete(id);
  const next = [..._reigningBeings];

  const { doVerb } = await import("../../ibp/verbs/do.js");
  const opts = ctx.identity
    ? { identity: ctx.identity, summonCtx: ctx.summonCtx || null }
    : { scaffold: true, summonCtx: ctx.summonCtx || null };
  await doVerb(
    { kind: "matter", id: matterId },
    "set-matter",
    { field: "qualities.reign.beings", value: next, merge: false },
    opts,
  );
  log.info("Reigning", `Removed reigning being: ${id}`);
}

// ─────────────────────────────────────────────────────────────────────
// DO ops. Reigning beings promote / demote others through these.
// authorize.js gates them via the heaven defaults (require reigning:
// true), so the only callers that pass are already inside the set.
// ─────────────────────────────────────────────────────────────────────

registerOperation("add-reigning", {
  targets: ["space", "matter", "being"],
  ownerExtension: "seed",
  handler: async ({ params, identity, summonCtx }) => {
    const beingId = String(params?.beingId || "").trim();
    if (!beingId) {
      throw new Error("add-reigning: `beingId` is required");
    }
    await addReigningBeing(beingId, {
      summonCtx,
      addedBy: identity?.beingId || identity?.name || null,
    });
    return { beingId, reigning: true };
  },
});

registerOperation("remove-reigning", {
  targets: ["space", "matter", "being"],
  ownerExtension: "seed",
  handler: async ({ params, summonCtx }) => {
    const beingId = String(params?.beingId || "").trim();
    if (!beingId) {
      throw new Error("remove-reigning: `beingId` is required");
    }
    await removeReigningBeing(beingId, { summonCtx });
    return { beingId, reigning: false };
  },
});

/**
 * Ensure every seed delegate is in the roster. Called from the boot
 * scaffold after ensureSeedDelegates plants the delegate Being rows.
 * Idempotent.
 */
export async function ensureSeedDelegatesReign(summonCtx) {
  if (!summonCtx) {
    throw new Error(
      "ensureSeedDelegatesReign requires summonCtx (the boot moment's ctx).",
    );
  }
  const { SEED_DELEGATES } = await import("./seedDelegates.js");
  const { findByName } = await import("../projections.js");
  const names = SEED_DELEGATES.map((d) => d.name);
  const slots = (await Promise.all(names.map((n) => findByName("being", n, "0"))))
    .filter(Boolean);
  for (const slot of slots) {
    try {
      await addReigningBeing(String(slot.id), {
        summonCtx,
        addedBy: I_AM,
      });
    } catch (err) {
      log.error(
        "Reigning",
        `failed to add seed delegate ${slot.state?.name} to reign: ${err.message}`,
      );
    }
  }
}

/**
 * Boot-time repair: anyone whose being-tree parent is the I-Am is by
 * definition reigning (the rootOperator on first-register and any
 * later operator-promoted being join the roster the same way). If the
 * cache is missing a being that already satisfies that structural
 * test, add them. Idempotent. Runs at boot AFTER seed delegates so
 * the only beings this catches are operator-side ones the cherub
 * minted but whose original anoint never sealed (legacy DBs, or a
 * cherub-anoint that failed before the structural rule was enforced).
 */
export async function ensureIAmChildrenReign(summonCtx) {
  if (!summonCtx) {
    throw new Error(
      "ensureIAmChildrenReign requires summonCtx (the boot moment's ctx).",
    );
  }
  const { findByParent, loadProjection } = await import("../projections.js");
  const children = await findByParent(I_AM, "0");
  for (const child of children) {
    const id = String(child.id);
    if (_reigningBeings.has(id)) continue;
    try {
      await addReigningBeing(id, { summonCtx, addedBy: I_AM });
      const slot = await loadProjection("being", id, "0");
      log.info(
        "Reigning",
        `boot repair: anointed I-Am child @${slot?.state?.name || id.slice(0, 8)} (was missing from roster)`,
      );
    } catch (err) {
      log.error(
        "Reigning",
        `failed to anoint I-Am child @${row.name} at boot: ${err.message}`,
      );
    }
  }
}
