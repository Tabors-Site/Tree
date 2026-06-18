// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// The factory, watched. nodeServerTest Phase 2.
//
// ./factory is the stamping machinery made visible: read-side
// projections over Act + Fact rows, computed on demand, NOTHING new
// stored (the ./threads pattern — facts ARE the trail; duplicating
// them as rows would double the chain forever and beings never
// interact with facts/acts directly anyway; they are what beings are
// made of). Two children:
//
//   ./factory/present — the stampers. One synthetic child per being
//     with sealed acts; inside, one lane per (being, branch): the
//     stamped papers laid along the chain at {x: index, y: lane*2},
//     the stamper figure standing at the head, a fork starting a new
//     lane where the branch was born. The stamper steps one forward
//     after each act comes through — literally, x = chain position.
//
//   ./factory/past — the reels. A thin recent-first listing whose
//     children route into the EXISTING reel explorer (/.reel/...).
//
// For beings examining how the machinery works: why a packet stuck
// at the stamper, where a trail broke. The host (./host) is the
// computer; the factory is the mechanism.
//
// Everything here is a read. No facts, no acts, no rows.

import log from "../../seedReality/log.js";
import { HEAVEN_SPACE } from "./heavenSpaces.js";
import Act from "../../past/act/act.js";
import ActHead from "../../past/act/actHead.js";
import Fact from "../../past/fact/fact.js";
import ReelHead from "../../past/reel/reelHead.js";
import { attachActFacts } from "../../past/act/actChain.js";
import { MAIN, isMain, loadBranch } from "../branch/branches.js";

const HEAVEN_SEGMENT = ".";
const FACTORY_SEGMENT = "factory";
const PRESENT_SEGMENT = "present";

// ── addressing ──────────────────────────────────────────────────────

/**
 * Does a path name a single stamper space?
 *
 *   "/./factory/present/<seg>" → ref     "/factory/present/<seg>" → ref
 *   "/./factory/present"       → null    (the listing, not a child)
 *
 * <seg> is either "stamper:<beingId>" (unambiguous) or a being name.
 * Stampers are flat — no children under a stamper.
 *
 * @returns {{beingId?:string, name?:string}|null}
 */
export function stamperRefFromPath(path) {
  if (typeof path !== "string" || !path) return null;
  let trimmed = path.replace(/^\/+/, "");
  if (trimmed.startsWith(HEAVEN_SEGMENT + "/")) {
    trimmed = trimmed.slice(HEAVEN_SEGMENT.length + 1);
  }
  const prefix = `${FACTORY_SEGMENT}/${PRESENT_SEGMENT}/`;
  if (!trimmed.startsWith(prefix)) return null;
  const tail = trimmed.slice(prefix.length);
  if (!tail || tail.includes("/")) return null;
  const seg = decodeURIComponent(tail);
  if (seg.startsWith("stamper:")) {
    const beingId = seg.slice("stamper:".length);
    return beingId ? { beingId } : null;
  }
  return { name: seg };
}

export function isFactoryPresentChildPath(path) {
  return stamperRefFromPath(path) !== null;
}

let _presentSpaceIdCache = null;
export async function getFactoryPresentSpaceId() {
  if (_presentSpaceIdCache) return _presentSpaceIdCache;
  const { findByHeavenSpace } = await import("../projections.js");
  const space = await findByHeavenSpace(HEAVEN_SPACE.FACTORY_PRESENT, "0");
  if (!space) return null;
  _presentSpaceIdCache = String(space.id);
  return _presentSpaceIdCache;
}

let _pastSpaceIdCache = null;
export async function getFactoryPastSpaceId() {
  if (_pastSpaceIdCache) return _pastSpaceIdCache;
  const { findByHeavenSpace } = await import("../projections.js");
  const space = await findByHeavenSpace(HEAVEN_SPACE.FACTORY_PAST, "0");
  if (!space) return null;
  _pastSpaceIdCache = String(space.id);
  return _pastSpaceIdCache;
}

/** Resolve a stamper ref to {beingId, name} (null when no such being). */
export async function resolveStamperBeing(ref) {
  const { loadProjection, findByName } = await import("../projections.js");
  if (ref?.beingId) {
    const slot = await loadProjection("being", String(ref.beingId), "0");
    if (!slot) return null;
    return { beingId: String(slot.id), name: slot.state?.name || String(slot.id).slice(0, 8) };
  }
  if (ref?.name) {
    // Names can theoretically collide across kinds of lookup;
    // "stamper:<beingId>" is the unambiguous form.
    const slot = await findByName("being", ref.name, "0");
    if (!slot) return null;
    return { beingId: String(slot.id), name: slot.state?.name || ref.name };
  }
  return null;
}

// ── the present listing (no Act scan) ───────────────────────────────

/**
 * One entry per being with sealed acts, recent actors first. Cheap:
 * ActHead is one small row per (being, branch); the head act lookup
 * is an indexed _id batch; actCount runs only for the returned page.
 */
export async function listStamperChildren({ limit = 100 } = {}) {
  const cap = Math.min(Math.max(1, Number(limit) || 100), 500);
  const heads = await ActHead.find({ headHash: { $ne: null } })
    .select("branch beingId headHash").lean();
  if (heads.length === 0) return [];

  const headActs = await Act.find({ _id: { $in: heads.map((h) => h.headHash) } })
    .select("stampedAt through").lean();
  const lastByAct = new Map(headActs.map((a) => [String(a._id), a.stampedAt || null]));

  const byBeing = new Map(); // beingId -> { branches, lastAct }
  for (const h of heads) {
    const cur = byBeing.get(h.beingId) || { branches: [], lastAct: null };
    cur.branches.push(h.branch);
    const t = lastByAct.get(String(h.headHash));
    if (t && (!cur.lastAct || t > cur.lastAct)) cur.lastAct = t;
    byBeing.set(h.beingId, cur);
  }

  const page = [...byBeing.entries()]
    .sort((a, b) => (b[1].lastAct?.getTime?.() || 0) - (a[1].lastAct?.getTime?.() || 0))
    .slice(0, cap);

  const { loadProjection } = await import("../projections.js");
  const out = [];
  for (const [beingId, info] of page) {
    let name = beingId.slice(0, 8);
    try {
      const slot = await loadProjection("being", beingId, "0");
      if (slot?.state?.name) name = slot.state.name;
    } catch { /* keep the id stub */ }
    let actCount = 0;
    try { actCount = await Act.countDocuments({ through: beingId }); } catch { /* best effort */ }
    out.push({
      beingId, name, actCount,
      lastAct: info.lastAct ? new Date(info.lastAct).toISOString() : null,
      branches: info.branches.sort(),
    });
  }
  return out;
}

// ── the stamper space ───────────────────────────────────────────────

// Acts with no branch field (legacy, pre-Act-branching) count as
// main, mirroring readActChainLineage's compatibility handling.
function branchClauseFor(branch) {
  return isMain(branch)
    ? { $or: [{ branch: MAIN }, { branch: { $exists: false } }] }
    : { branch };
}

function shortLabel(act) {
  const msg = act.startMessage?.content;
  const text = typeof msg === "string" ? msg : (msg ? JSON.stringify(msg) : "");
  const label = text || "(act)";
  return label.length > 24 ? label.slice(0, 23) + "…" : label;
}

function previewOf(act) {
  const msg = act.startMessage?.content;
  const text = typeof msg === "string" ? msg : (msg ? JSON.stringify(msg) : "");
  return text.slice(0, 400);
}

/**
 * The stamper space: a space-shaped descriptor both portals render
 * with no special view code. One lane per (being, branch); papers at
 * {x: forkX + countOlder + i, y: lane*2}; the stamper figure at the
 * head. Windowed (limit/before) so heavy stampers (the http-server's
 * request stream) stay cheap; countOlder keeps x stable while paging.
 *
 * @param {{beingId:string, name:string}} being
 * @param {{limit?:number, before?:string}} opts
 */
export async function describeStamperSpace(being, { limit = 100, before = null } = {}) {
  const beingId = String(being.beingId);
  const name = being.name;
  const cap = Math.min(Math.max(1, Number(limit) || 100), 500);
  const beforeDate = before ? new Date(before) : null;

  // Lanes: every branch this being has sealed acts on. Lane 0 is
  // main; the rest order by branch creation time.
  const heads = await ActHead.find({ beingId, headHash: { $ne: null } })
    .select("branch headHash").lean();
  const branchSet = new Set(heads.map((h) => h.branch || MAIN));
  if (branchSet.size === 0) branchSet.add(MAIN);
  const branchMeta = new Map(); // branch -> {createdAt: Date|null}
  for (const b of branchSet) {
    if (isMain(b)) { branchMeta.set(b, { createdAt: null }); continue; }
    try {
      const row = await loadBranch(b);
      branchMeta.set(b, { createdAt: row?.createdAt ? new Date(row.createdAt) : null });
    } catch { branchMeta.set(b, { createdAt: null }); }
  }
  const branches = [...branchSet].sort((a, b) => {
    if (isMain(a)) return -1;
    if (isMain(b)) return 1;
    const ta = branchMeta.get(a)?.createdAt?.getTime() || 0;
    const tb = branchMeta.get(b)?.createdAt?.getTime() || 0;
    return ta - tb;
  });

  // Fork anchor: where along the PARENT lane this branch was born.
  // Wall-clock anchor (acts have no seq; stampedAt is a display
  // helper, never truth) — honest for a view whose whole job is
  // display. forkX(main) = 0.
  async function forkXFor(branch) {
    if (isMain(branch)) return 0;
    const meta = branchMeta.get(branch);
    if (!meta?.createdAt) return 0;
    let parent = MAIN;
    try { parent = (await loadBranch(branch))?.parent || MAIN; } catch { /* main */ }
    const parentClause = branchClauseFor(parent);
    let x = 0;
    try {
      x = await Act.countDocuments({
        through: beingId, ...parentClause,
        stampedAt: { $lte: meta.createdAt },
      });
    } catch { x = 0; }
    // Recurse one level when the parent is itself a branch so deep
    // forks anchor against the whole ancestry.
    if (!isMain(parent)) x += await forkXFor(parent);
    return x;
  }

  const lanes = [];
  const allSerialized = [];
  let maxHeadX = 0;

  for (let lane = 0; lane < branches.length; lane++) {
    const branch = branches[lane];
    const clause = branchClauseFor(branch);
    const forkX = await forkXFor(branch);

    let total = 0;
    try { total = await Act.countDocuments({ through: beingId, ...clause }); } catch { /* 0 */ }

    const windowDesc = await Act.find({
      through: beingId, ...clause,
      ...(beforeDate ? { stampedAt: { $lt: beforeDate } } : {}),
    }).sort({ stampedAt: -1, _id: -1 }).limit(cap).lean();
    const window = windowDesc.reverse();

    let countOlder = 0;
    if (window.length > 0) {
      try {
        countOlder = await Act.countDocuments({
          through: beingId, ...clause,
          stampedAt: { $lt: window[0].stampedAt },
        });
      } catch { countOlder = 0; }
    }

    const serialized = window.map((a) => ({
      _id: String(a._id),
      branch, lane, forkX, countOlder,
      startMessage: a.startMessage || null,
      stampedAt: a.stampedAt || null,
    }));
    allSerialized.push(...serialized);

    const headX = forkX + total;
    if (headX > maxHeadX) maxHeadX = headX;
    lanes.push({ branch, lane, forkX, headX, count: total, returned: window.length });
  }

  // ONE batched fact enrichment across every lane.
  await attachActFacts(allSerialized);

  const laneCursor = new Map(); // lane -> next index within the window
  const matters = allSerialized.map((a) => {
    const idx = laneCursor.get(a.lane) || 0;
    laneCursor.set(a.lane, idx + 1);
    return {
      matterId: `stamp:${a._id}`,
      name: shortLabel(a),
      type: "stamp",
      coord: { x: a.forkX + a.countOlder + idx, y: a.lane * 2 },
      preview: previewOf(a),
      previewBytes: 0, totalBytes: 0, mimeType: null, contentUrl: null,
      external: null, purged: false, render: null, model: null, actions: [],
      byBeingId: beingId, synthetic: true,
      qualities: {
        stamper: {
          actId: a._id,
          branch: a.branch,
          factCount: (a.facts || []).length,
          facts: (a.facts || []).slice(0, 8).map((f) => ({
            verb: f.verb, action: f.act, targetKind: f.of?.kind ?? null,
          })),
          stampedAt: a.stampedAt ? new Date(a.stampedAt).toISOString() : null,
        },
      },
    };
  });

  const figures = lanes.map((l) => ({
    being: `${name}#${l.branch}`,
    name: `${name}#${l.branch}`,
    beingId: null,
    synthetic: true,
    role: "stamper",
    available: true,
    coord: { x: l.headX, y: l.lane * 2 },
    actions: [],
    qualities: {},
  }));

  const { getRealityDomain } = await import("../../ibp/address.js");
  const path = `/./factory/present/${encodeURIComponent(name)}`;
  return {
    address: {
      place: getRealityDomain(),
      path,
      being: null,
      spaceId: `stamper:${beingId}`, // the live-subscription key
      pathByNames: path,
      // Heaven pin, not a default: factory spaces live in heaven,
      // which stays on branch 0 by doctrine.
      branch: "0",
    },
    isSpaceRoot: false,
    isHomeRoot: false,
    isStamper: true,
    heavenSpace: HEAVEN_SPACE.FACTORY_PRESENT,
    size: {
      x: Math.max(8, maxHeadX + 4),
      y: Math.max(8, lanes.length * 2 + 3),
    },
    beings: figures,
    matters,
    children: [],
    residents: [],
    lineage: [],
    beingLineage: null,
    qualities: {},
    stamper: {
      beingId, name, lanes,
      window: { limit: cap, before: before || null },
    },
    identity: null,
  };
}

// ── the past listing (thin) ─────────────────────────────────────────

/**
 * Recent reels. Children route into the EXISTING reel explorer via
 * path /.reel/<kind>/<id>; nothing new is rendered. ReelHead carries
 * no timestamps (and we add none); recency comes from the head
 * fact's date. Capped scan, documented.
 */
export async function listReelChildren({ limit = 100 } = {}) {
  const cap = Math.min(Math.max(1, Number(limit) || 100), 500);
  const heads = await ReelHead.find({ branch: "0" })
    .select("type id head headHash").limit(2000).lean();
  if (heads.length === 0) return [];

  const hashList = heads.map((h) => h.headHash).filter(Boolean);
  const headFacts = hashList.length
    ? await Fact.find({ _id: { $in: hashList } }).select("date").lean()
    : [];
  const dateByHash = new Map(headFacts.map((f) => [String(f._id), f.date || null]));

  return heads
    .map((h) => ({
      kind: h.type,
      id: String(h.id),
      branch: "0",
      headSeq: h.head ?? 0,
      headHash8: h.headHash ? String(h.headHash).slice(0, 8) : null,
      lastFactAt: h.headHash ? (dateByHash.get(String(h.headHash)) || null) : null,
    }))
    .sort((a, b) => {
      const ta = a.lastFactAt ? new Date(a.lastFactAt).getTime() : 0;
      const tb = b.lastFactAt ? new Date(b.lastFactAt).getTime() : 0;
      return tb - ta || b.headSeq - a.headSeq;
    })
    .slice(0, cap);
}
