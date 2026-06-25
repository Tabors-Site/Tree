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
//     with sealed acts; inside, one lane per (being, history): the
//     stamped papers laid along the chain at {x: index, y: lane*2},
//     the stamper figure standing at the head, a fork starting a new
//     lane where the history was born. The stamper steps one forward
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

import log from "../../seedStory/log.js";
import { HEAVEN_SPACE } from "./heavenSpaces.js";
// The cross-aggregate head enumerations (every being with sealed acts; every
// reel head on a history) route through FileStore's list* peers — the file-
// native enumerators that replaced the raw ActHead / ReelHead model scans
// (listActHeads / listReelHeads carry the ReelHead/ActHead head rows).
// Per-being act reads and per-reel fact reads route through the curated act /
// fact layers below.
import * as fileStore from "../../past/fileStore.js";
import {
  attachActFacts,
  getActsByField,
  getActById,
  actCount,
} from "../../past/act/actChain.js";
import { getFactsOnReelWhere } from "../../past/fact/facts.js";
import { getStoryDomain } from "../../ibp/address.js";
import { MAIN, isMain, loadHistory } from "../history/histories.js";

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
    return {
      beingId: String(slot.id),
      name: slot.state?.name || String(slot.id).slice(0, 8),
    };
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
 * one act-head pointer per (being, history); the head act lookup is an
 * O(1) curated getActById; actCount runs only for the returned page.
 */
export async function listStamperChildren({ limit = 100 } = {}) {
  const cap = Math.min(Math.max(1, Number(limit) || 100), 500);
  // CROSS-BEING head enumeration ("every being that has sealed acts") through
  // FileStore.listActHeads — the file-native peer of the old
  // ActHead.find({ headHash: { $ne: null } }). It returns one row per
  // (history, being) carrying { history, beingId, headHash } (headHash null on
  // an empty chain), so the $ne-null filter becomes a plain truthy filter. The
  // PER-HEAD act lookup and per-being count below route through the curated
  // getActById / actCount.
  const heads = fileStore
    .listActHeads(getStoryDomain())
    .filter((h) => h.headHash);
  if (heads.length === 0) return [];

  // Per-head act lookup → curated getActById (the head act carries stampedAt).
  const lastByAct = new Map();
  for (const h of heads) {
    if (!h.headHash) continue;
    const a = getActById(String(h.headHash));
    if (a) lastByAct.set(String(h.headHash), a.stampedAt || null);
  }

  const byBeing = new Map(); // beingId -> { histories, lastAct }
  for (const h of heads) {
    const cur = byBeing.get(h.beingId) || { histories: [], lastAct: null };
    cur.histories.push(h.history);
    const t = lastByAct.get(String(h.headHash));
    if (t && (!cur.lastAct || t > cur.lastAct)) cur.lastAct = t;
    byBeing.set(h.beingId, cur);
  }

  const page = [...byBeing.entries()]
    .sort(
      (a, b) =>
        (b[1].lastAct?.getTime?.() || 0) - (a[1].lastAct?.getTime?.() || 0),
    )
    .slice(0, cap);

  const { loadProjection } = await import("../projections.js");
  const out = [];
  for (const [beingId, info] of page) {
    let name = beingId.slice(0, 8);
    try {
      const slot = await loadProjection("being", beingId, "0");
      if (slot?.state?.name) name = slot.state.name;
    } catch {
      /* keep the id stub */
    }
    let actTotal = 0;
    try {
      // Curated count of this being's authored acts (through facet).
      actTotal = actCount({ through: beingId });
    } catch {
      /* best effort */
    }
    out.push({
      beingId,
      name,
      actCount: actTotal,
      lastAct: info.lastAct ? new Date(info.lastAct).toISOString() : null,
      histories: info.histories.sort(),
    });
  }
  return out;
}

// ── the stamper space ───────────────────────────────────────────────

// Acts with no history field (legacy, pre-Act-branching) count as
// main, mirroring readActChainLineage's compatibility handling. JS
// predicate peer of the old historyClause (curated act reads return
// full act docs; we filter in memory).
function actInHistory(act, history) {
  const h = act.history || MAIN;
  return isMain(history) ? isMain(h) : h === history;
}

// stampedAt as ms (or null) for the windowing/forkX comparisons.
function stampMs(act) {
  const t = act?.stampedAt ?? null;
  const ms = t != null ? new Date(t).getTime() : NaN;
  return Number.isNaN(ms) ? null : ms;
}

function shortLabel(act) {
  const msg = act.startMessage?.content;
  const text = typeof msg === "string" ? msg : msg ? JSON.stringify(msg) : "";
  const label = text || "(act)";
  return label.length > 24 ? label.slice(0, 23) + "…" : label;
}

function previewOf(act) {
  const msg = act.startMessage?.content;
  const text = typeof msg === "string" ? msg : msg ? JSON.stringify(msg) : "";
  return text.slice(0, 400);
}

/**
 * The stamper space: a space-shaped descriptor both portals render
 * with no special view code. One lane per (being, history); papers at
 * {x: forkX + countOlder + i, y: lane*2}; the stamper figure at the
 * head. Windowed (limit/before) so heavy stampers (the http-server's
 * request stream) stay cheap; countOlder keeps x stable while paging.
 *
 * @param {{beingId:string, name:string}} being
 * @param {{limit?:number, before?:string}} opts
 */
export async function describeStamperSpace(
  being,
  { limit = 100, before = null } = {},
) {
  const beingId = String(being.beingId);
  const name = being.name;
  const cap = Math.min(Math.max(1, Number(limit) || 100), 500);
  const beforeMs = before ? new Date(before).getTime() : null;

  // Curated read: every act this being authored (the `through` facet), once.
  // The whole stamper view (history lanes, fork anchors, windows, counts) is a
  // projection of this one list — replacing the per-lane Act.find /
  // Act.countDocuments round-trips with in-memory filters. Acts with `through`
  // !== beingId can't appear (the facet is exact), but we keep the same
  // through-guard the old query implied.
  const beingActs = getActsByField("through", beingId).filter(
    (a) => a.through == null || String(a.through) === beingId,
  );

  // Lanes: every history this being has sealed acts on. Lane 0 is main; the
  // rest order by history creation time. Derived from the acts themselves
  // (each carries its history) — the old ActHead enumeration is unnecessary
  // now that we hold the full act list.
  const historySet = new Set(beingActs.map((a) => a.history || MAIN));
  if (historySet.size === 0) historySet.add(MAIN);
  const historyMeta = new Map(); // history -> {createdAt: Date|null}
  for (const b of historySet) {
    if (isMain(b)) {
      historyMeta.set(b, { createdAt: null });
      continue;
    }
    try {
      const row = await loadHistory(b);
      historyMeta.set(b, {
        createdAt: row?.createdAt ? new Date(row.createdAt) : null,
      });
    } catch {
      historyMeta.set(b, { createdAt: null });
    }
  }
  const histories = [...historySet].sort((a, b) => {
    if (isMain(a)) return -1;
    if (isMain(b)) return 1;
    const ta = historyMeta.get(a)?.createdAt?.getTime() || 0;
    const tb = historyMeta.get(b)?.createdAt?.getTime() || 0;
    return ta - tb;
  });

  // Fork anchor: where along the PARENT lane this history was born.
  // Wall-clock anchor (acts have no seq; stampedAt is a display
  // helper, never truth) — honest for a view whose whole job is
  // display. forkX(main) = 0.
  async function forkXFor(history) {
    if (isMain(history)) return 0;
    const meta = historyMeta.get(history);
    if (!meta?.createdAt) return 0;
    let parent = MAIN;
    try {
      parent = (await loadHistory(history))?.parent || MAIN;
    } catch {
      /* main */
    }
    // Acts on the PARENT lane stamped at-or-before this history's birth — the
    // in-memory peer of the old Act.countDocuments({through, parentClause,
    // stampedAt:{$lte}}).
    const cutMs = meta.createdAt.getTime();
    let x = beingActs.filter((a) => {
      if (!actInHistory(a, parent)) return false;
      const ms = stampMs(a);
      return ms != null && ms <= cutMs;
    }).length;
    // Recurse one level when the parent is itself a history so deep
    // forks anchor against the whole ancestry.
    if (!isMain(parent)) x += await forkXFor(parent);
    return x;
  }

  const lanes = [];
  const allSerialized = [];
  let maxHeadX = 0;

  // Sort newest-first by stampedAt, _id as the deterministic tiebreak —
  // mirrors the old sort { stampedAt: -1, _id: -1 }.
  const newestFirst = (a, b) => {
    const ta = stampMs(a);
    const tb = stampMs(b);
    if (ta == null && tb == null) return String(b._id).localeCompare(String(a._id));
    if (ta == null) return 1;
    if (tb == null) return -1;
    if (ta !== tb) return tb - ta;
    return String(b._id).localeCompare(String(a._id));
  };

  for (let lane = 0; lane < histories.length; lane++) {
    const history = histories[lane];
    const laneActs = beingActs.filter((a) => actInHistory(a, history));
    const forkX = await forkXFor(history);

    const total = laneActs.length;

    // Window: newest cap acts strictly older than the `before` cursor, then
    // reversed to ascending (the in-memory peer of the old find/sort/limit).
    const windowDesc = laneActs
      .filter((a) => {
        if (beforeMs == null) return true;
        const ms = stampMs(a);
        return ms != null && ms < beforeMs;
      })
      .sort(newestFirst)
      .slice(0, cap);
    const window = windowDesc.slice().reverse();

    let countOlder = 0;
    if (window.length > 0) {
      const headMs = stampMs(window[0]);
      countOlder = laneActs.filter((a) => {
        const ms = stampMs(a);
        return headMs != null && ms != null && ms < headMs;
      }).length;
    }

    const serialized = window.map((a) => ({
      _id: String(a._id),
      history: history,
      lane,
      forkX,
      countOlder,
      startMessage: a.startMessage || null,
      stampedAt: a.stampedAt || null,
    }));
    allSerialized.push(...serialized);

    const headX = forkX + total;
    if (headX > maxHeadX) maxHeadX = headX;
    lanes.push({
      history: history,
      lane,
      forkX,
      headX,
      count: total,
      returned: window.length,
    });
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
      previewBytes: 0,
      totalBytes: 0,
      mimeType: null,
      contentUrl: null,
      external: null,
      purged: false,
      render: null,
      model: null,
      actions: [],
      byBeingId: beingId,
      synthetic: true,
      qualities: {
        stamper: {
          actId: a._id,
          history: a.history,
          factCount: (a.facts || []).length,
          facts: (a.facts || []).slice(0, 8).map((f) => ({
            verb: f.verb,
            action: f.act,
            targetKind: f.of?.kind ?? null,
          })),
          stampedAt: a.stampedAt ? new Date(a.stampedAt).toISOString() : null,
        },
      },
    };
  });

  const figures = lanes.map((l) => ({
    being: `${name}#${l.history}`,
    name: `${name}#${l.history}`,
    beingId: null,
    synthetic: true,
    able: "stamper",
    available: true,
    coord: { x: l.headX, y: l.lane * 2 },
    actions: [],
    qualities: {},
  }));

  const { getStoryDomain } = await import("../../ibp/address.js");
  const path = `/./factory/present/${encodeURIComponent(name)}`;
  return {
    address: {
      place: getStoryDomain(),
      path,
      being: null,
      spaceId: `stamper:${beingId}`, // the live-subscription key
      pathByNames: path,
      // Heaven pin, not a default: factory spaces live in heaven,
      // which stays on history 0 by doctrine.
      history: "0",
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
      beingId,
      name,
      lanes,
      window: { limit: cap, before: before || null },
    },
    identity: null,
  };
}

// ── the past listing (thin) ─────────────────────────────────────────

/**
 * Recent reels. Children route into the EXISTING reel explorer via
 * path /.reel/<kind>/<id>; nothing new is rendered. A reel head carries
 * no timestamp (and we add none); recency comes from the head fact's
 * date (read off the reel). Capped scan, documented.
 */
export async function listReelChildren({ limit = 100 } = {}) {
  const cap = Math.min(Math.max(1, Number(limit) || 100), 500);
  // CROSS-REEL head enumeration ("every reel on main") through
  // FileStore.listReelHeads("0") — the file-native peer of the old
  // ReelHead.find({ history: "0" }). Each row carries { type, id, head,
  // headHash } (the .head pointer beside the reel). Capped to the same 2000-row
  // ceiling the old .limit(2000) imposed.
  const heads = fileStore.listReelHeads("0").slice(0, 2000);
  if (heads.length === 0) return [];

  // The head fact's date — the old code did a by-_id Fact batch over the head
  // hashes; the file-native head fact IS the reel's fact at seq === head, read
  // through the curated getFactsOnReelWhere (history-aware, per-reel). One
  // small read per reel; nothing new stored.
  const dateByHash = new Map();
  for (const h of heads) {
    if (!h.headHash || !(h.head > 0)) continue;
    try {
      const at = getFactsOnReelWhere(
        "0",
        h.type,
        String(h.id),
        (f) => f.seq === h.head,
      );
      const headFact = at.length ? at[at.length - 1] : null;
      if (headFact) dateByHash.set(String(h.headHash), headFact.date || null);
    } catch {
      /* best-effort recency; a missing reel just yields no date */
    }
  }

  return heads
    .map((h) => ({
      kind: h.type,
      id: String(h.id),
      history: "0",
      headSeq: h.head ?? 0,
      headHash8: h.headHash ? String(h.headHash).slice(0, 8) : null,
      lastFactAt: h.headHash
        ? dateByHash.get(String(h.headHash)) || null
        : null,
    }))
    .sort((a, b) => {
      const ta = a.lastFactAt ? new Date(a.lastFactAt).getTime() : 0;
      const tb = b.lastFactAt ? new Date(b.lastFactAt).getTime() : 0;
      return tb - ta || b.headSeq - a.headSeq;
    })
    .slice(0, cap);
}
