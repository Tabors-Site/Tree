// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// actChain.js — THE curated act-query module.
//
// Architecture (Tabor: "many can be centralized"): the storage seam is ONE
// place (for the future Rust swap). FileStore (past/fileStore.js) is the
// storage primitive; this module WRAPS its act-log primitives and is the ONLY
// act-query surface every non-chokepoint file calls — no other file reads the
// act-log directly. The curated act-query API:
//
//   getActById(actId)                     -> act|null
//   getActsByCorrelation(rootCorrelation) -> act[]
//   getActsByField(field, value)          -> act[]   (through/by/to/inReplyTo/
//                                                      ibpAddress/activeAble/
//                                                      rootCorrelation/answers)
//   getActChain(story, history, being)    -> act[]   (own-(story,history) chain)
//   actCount(filter)                      -> number
//
// plus the explorer descriptor (describeActChain) + the act-fact attachment
// (attachActFacts), now file-backed.
//
// A being's act-chain (MODEL.md: A_b) is the sequence of moments that being
// authored: the acts on the being's per-(story,history) act-log. Acts have no
// per-being monotonic seq; the explorer orders newest-first by act.ord (the
// clock-free append ordinal), never a wall-clock.
//
// Used by SEE on <story>/.acts/<beingId> + the curated act sweep callers.

import { getStoryDomain } from "../../ibp/address.js";
import { getFactsByActId } from "../fact/facts.js";
import * as fileStore from "../fileStore.js";
import { redactSecrets } from "../../materials/redact.js";
import {
  resolveHistoryLineage,
  MAIN,
  isMain,
} from "../../materials/history/histories.js";

// Cap is high so per-being scrubbable history reaches back to the
// being's first act even after long sessions of fine-grained
// movement (every coord tick is one Act). Timeline UIs request the
// max explicitly.
const MAX_LIMIT = 10000;
const MAX_FACT_PARAM_BYTES = 512;

// The story the act-log is keyed under. The write path (4-stamped.appendActLine)
// passes actDoc.story = getStoryDomain(); the curated reads must use the SAME
// story so the index/log paths line up. A caller may override (cross-story
// tooling), but the default is the local story.
function storyOf(story) {
  return typeof story === "string" && story.length ? story : getStoryDomain();
}

// ─────────────────────────────────────────────────────────────────────
// THE CURATED ACT-QUERY API (the ONE seam sweepers call)
// ─────────────────────────────────────────────────────────────────────

/**
 * Get one act by id. Returns the plain act doc (the .lean() shape) or null.
 * A sealed act is immutable (an act is present, a fact is past) — there are
 * no post-seal mutable fields to overlay.
 *
 * @param {string} actId
 * @param {string} [story]  the act's story (defaults to the local story)
 * @returns {object|null}
 */
export function getActById(actId, story) {
  if (actId == null) return null;
  return fileStore.readActById(storyOf(story), String(actId));
}

/**
 * Every act sharing one rootCorrelation — the whole chain that descends from
 * one originating SUMMON (I's cancellation walk + conversation grouping).
 *
 * @param {string} rootCorrelation
 * @param {string} [story]
 * @returns {object[]}
 */
export function getActsByCorrelation(rootCorrelation, story) {
  if (rootCorrelation == null) return [];
  return fileStore.actsByCorrelation(storyOf(story), String(rootCorrelation));
}

// The act facets the index can answer by equality. `by` and `story`/`history`
// are NOT indexed facets (by-walks go through the chain; story/history are the
// log partition); the supported equality facets are these.
const QUERY_FIELDS = new Set([
  "rootCorrelation",
  "inReplyTo",
  "through",
  "to",
  "activeAble",
  "ibpAddress",
  "answers",
]);

/**
 * Every act carrying (field === value), in index order. field ∈ {through, to,
 * inReplyTo, rootCorrelation, ibpAddress, activeAble, answers}. An unsupported
 * field returns [] (the caller wanted a facet the index doesn't maintain).
 *
 * @param {string} field
 * @param {string} value
 * @param {string} [story]
 * @returns {object[]}
 */
export function getActsByField(field, value, story) {
  if (!QUERY_FIELDS.has(field) || value == null) return [];
  return fileStore.actsByField(storyOf(story), field, String(value));
}

/**
 * One being's authored acts on a (story, history) — the own-(story,history)
 * chain, append-order (oldest-first), patch-merged. The lineage union across
 * parent histories is describeActChain's job (like readReel vs readReelLineage).
 *
 * @param {string} story
 * @param {string} history
 * @param {string} being
 * @returns {object[]}
 */
export function getActChain(story, history, being) {
  if (being == null) return [];
  return fileStore.readActChain(storyOf(story), String(history), String(being));
}

// A sealed act has NO editable fields (an act is present, a fact is past). The
// former post-seal patch primitive and its last user, the thread-cut field,
// were removed: there is no severing, and nothing patches a sealed act
// anywhere. The status and inner-face writers had already been retired (done =
// a fact stamped for the act; the inner face is rasterized before the act
// through its opening). Acts are immutable.

/**
 * Count acts matching a single-facet equality filter (or ALL acts in the story
 * when filter is empty). filter ∈ { <facet>: value } | { _id: actId } | {}.
 *
 * @param {object} [filter]
 * @param {string} [story]
 * @returns {number}
 */
export function actCount(filter = {}, story) {
  return fileStore.actCount(storyOf(story), filter || {});
}

// ─────────────────────────────────────────────────────────────────────
// EXPLORER DESCRIPTOR (SEE on <story>/.acts/<beingId>)
// ─────────────────────────────────────────────────────────────────────

/**
 * Build the act-chain descriptor for one being on a given history.
 * Newest-first. Walks history lineage: a being's acts on history #4
 * include the acts they stamped on every ancestor history BEFORE the
 * fork point, plus their own divergent acts on #4 afterward.
 *
 * @param {string} beingId
 * @param {object} [opts]
 * @param {string} [opts.history="0"]  history path to read on
 * @param {number} [opts.limit=100]
 * @param {number|string} [opts.before]  an ORDINAL cursor (act.ord) — when set,
 *                                    return only acts strictly older than this
 *                                    ord (progressive loading, ordered by
 *                                    sequence, never a Date).
 * @returns {Promise<{ being: {id, name}, acts: object[], count: number }>}
 */
export async function describeActChain(beingId, opts = {}) {
  if (!beingId) throw new Error("describeActChain: beingId required");
  const history = typeof opts.history === "string" && opts.history.length
    ? opts.history
    : MAIN;
  const limit = Math.min(Math.max(Number(opts.limit) || 100, 1), MAX_LIMIT);
  // Ordinal cursor: accept a number or numeric string; anything else is "no
  // cursor" (read from the head).
  const beforeNum = Number(opts.before);
  const before =
    opts.before != null && opts.before !== "" && Number.isFinite(beforeNum)
      ? beforeNum
      : null;

  const acts = await readActChainLineage({
    beingId: String(beingId),
    history,
    limit,
    before,
  });

  let beingName = null;
  try {
    const { loadProjection } = await import("../../materials/projections.js");
    const slot = await loadProjection("being", beingId, history);
    beingName = slot?.state?.name || null;
  } catch { /* best-effort */ }

  const serialized = acts.map(serializeAct);
  // Pass the being's own id so attachActFacts can compute each act's
  // `lastFactSeq` per the BEING'S OWN reel (seqs are per-reel; the
  // cross-reel max would be meaningless for foldAt("being", id, seq)).
  await attachActFacts(serialized, {
    reelKind: "being",
    reelId: String(beingId),
    history,
  });

  return {
    being: { id: String(beingId), name: beingName },
    // Redact secrets before the chain leaves over the wire — attached
    // fact params (set-being credential / llm-connection writes) and any
    // message payload pass through the redactor; the file act-chain is
    // untouched.
    acts: serialized.map((a) => redactSecrets(a)),
    count: acts.length,
  };
}

/**
 * Attach a compact Fact summary to each serialized Act. An Act row deliberately
 * does not store its Facts (act.js: "what happened inside this moment" is
 * Fact.find({ actId })), but a client rendering the chain needs to show what a
 * moment DID when it produced no prose. This surfaces those Facts via the
 * curated getFactsByActId (the actor's facts ride the actor's own being reel),
 * so the UI can render the action instead of treating the moment as empty.
 *
 * Each fact is reduced to { verb, act, of:{kind,id}, params }, params capped so
 * a large write can't bloat the descriptor. Facts ride oldest-first per Act.
 *
 * Optional `reel` selector computes `a.lastFactSeq` per the named reel rather
 * than per-act-globally — the per-reel "fold THIS being to this seq" anchor the
 * timeline-rewind UI wants. When the act sealed no facts on the named reel,
 * `lastFactSeq` is null (the row renders inert).
 *
 * Mutates and returns the passed array.
 *
 * @param {Array<{_id:string, through?:string}>} serializedActs
 * @param {object} [opts]
 * @param {string} [opts.reelKind]  of.kind to filter the seq computation by.
 * @param {string} [opts.reelId]    of.id to filter the seq computation by.
 * @param {string} [opts.history]   the reel history the facts ride (defaults
 *                                  to MAIN, where most acts land).
 * @returns {Promise<Array>}
 */
export async function attachActFacts(serializedActs, opts = {}) {
  if (!Array.isArray(serializedActs) || serializedActs.length === 0) {
    return serializedActs;
  }
  const history = typeof opts.history === "string" && opts.history.length
    ? opts.history
    : MAIN;
  const reelKind = typeof opts.reelKind === "string" ? opts.reelKind : null;
  const reelId   = opts.reelId != null ? String(opts.reelId) : null;

  for (const a of serializedActs) {
    const actId = String(a._id);
    // The actor's facts ride the actor's own being reel (one-word doctrine).
    // `through` is the being the act ran through; absent (a 5D name-act) → no
    // being reel to read, so no facts to attach.
    const actorReel = a.through != null ? String(a.through) : null;
    let facts = [];
    if (actorReel) {
      try {
        facts = getFactsByActId(history, actorReel, actId);
      } catch {
        facts = [];
      }
    }
    // Oldest-first within the act (the reel read is already seq-ascending).
    a.facts = facts.map(compactFact);
    // The "as-of" seq for the act's POST-SEAL state on the requested reel —
    // the highest seq of this act's facts on that reel. Null when the act
    // sealed no facts on the requested reel (a SEE-only moment, or an act
    // whose facts targeted other reels).
    let lastSeq = null;
    for (const f of facts) {
      if (typeof f.seq !== "number") continue;
      if (reelKind && reelId) {
        const t = f.of;
        if (!t || t.kind !== reelKind || String(t.id) !== reelId) continue;
      }
      if (lastSeq == null || f.seq > lastSeq) lastSeq = f.seq;
    }
    a.lastFactSeq = lastSeq;
  }
  return serializedActs;
}

/**
 * Read a being's act-chain across a history lineage. Mirrors the fact reel's
 * history-lineage walk in foldEngine. ORDER and the fork window are the CHAIN,
 * never a wall-clock: an act's `ord` (the clock-free append ordinal) is its
 * position, and a child branch's fork point is the ordinal of its earliest act.
 *
 * Each lineage history's own act-log already partitions acts by where they
 * sealed (the seal keys the log by act.history), so the lower bound is implicit
 * (an act on `here`'s log cannot predate `here`). The only gate that matters is
 * the UPPER bound: an ancestor keeps receiving acts after a child forks off it,
 * and those post-fork acts belong to the ancestor's own divergence, NOT the
 * child's lineage. So `here`'s acts are included only when their ord is below
 * the child's fork ordinal (the being's earliest act ord on the child's log).
 *
 * Returns newest-first, capped at limit. Acts with no history field (legacy)
 * are treated as main acts. File-backed via fileStore.readActChain.
 */
async function readActChainLineage({ beingId, history, limit, before }) {
  // `before` is an ORDINAL cursor (page acts strictly older than this ord),
  // never a Date. Numeric or null.
  const beforeOrd = before != null && before !== "" ? Number(before) : null;
  const beforeOrdOK = beforeOrd != null && Number.isFinite(beforeOrd);
  const story = getStoryDomain();

  if (isMain(history)) {
    // Own-history (main) chain. Legacy acts with no history field landed on
    // main's log too (the write keyed history "0"), so the own-log read is
    // complete.
    const all = fileStore.readActChain(story, MAIN, beingId).filter((a) => {
      if (a.through != null && String(a.through) !== String(beingId)) return false;
      if (beforeOrdOK) {
        const o = ordOf(a);
        if (o == null || !(o < beforeOrd)) return false;
      }
      return true;
    });
    return sortNewestFirst(all).slice(0, limit);
  }

  const lineage = await resolveHistoryLineage(history);

  // Per-lineage-history fork ordinal: the being's earliest act ord on that
  // history's own log. A child's fork ord upper-bounds the parent's contribution
  // (clock-free peer of the old next.createdAt cutoff). Computed once per
  // history from the same own-log reads used below.
  const ownActs = new Map(); // history -> acts on its own log (this being)
  const forkOrd = new Map(); // history -> earliest own-act ord (number|null)
  for (const h of lineage) {
    const acts = fileStore
      .readActChain(story, String(h), beingId)
      .filter((a) => a.through == null || String(a.through) === String(beingId));
    ownActs.set(h, acts);
    let min = null;
    for (const a of acts) {
      const o = ordOf(a);
      if (o != null && (min == null || o < min)) min = o;
    }
    forkOrd.set(h, min);
  }

  const out = [];
  for (let i = 0; i < lineage.length; i++) {
    const here = lineage[i];
    const next = lineage[i + 1] || null;
    // Upper bound: the child's fork ordinal (exclude `here`'s post-fork
    // divergence). The progressive-loading `before` cursor shrinks it further.
    let effUpper = next ? forkOrd.get(next) : null;
    if (beforeOrdOK && (effUpper == null || beforeOrd < effUpper)) effUpper = beforeOrd;

    for (const a of ownActs.get(here) || []) {
      const o = ordOf(a);
      if (effUpper != null && (o == null || !(o < effUpper))) continue;
      out.push(a);
    }
  }
  return sortNewestFirst(out).slice(0, limit);
}

// The act's append ordinal (act.ord, the clock-free total order) as a number,
// or null. The sort/window key for the act-chain — never a wall-clock.
function ordOf(a) {
  const o = Number(a?.ord);
  return Number.isFinite(o) ? o : null;
}

// Sort acts newest-first by the append ordinal (act.ord, the chain order); id
// as a deterministic tiebreak. Acts with no ord sort last (pre-ordinal /
// cross-story grafted acts ordered by id alone).
function sortNewestFirst(acts) {
  return acts.slice().sort((a, b) => {
    const oa = ordOf(a);
    const ob = ordOf(b);
    if (oa == null && ob == null) return String(b._id).localeCompare(String(a._id));
    if (oa == null) return 1;
    if (ob == null) return -1;
    if (oa !== ob) return ob - oa;
    return String(b._id).localeCompare(String(a._id));
  });
}

function compactFact(f) {
  let params = f.params ?? null;
  try {
    const s = params == null ? "" : JSON.stringify(params);
    if (s && Buffer.byteLength(s, "utf8") > MAX_FACT_PARAM_BYTES) {
      params = { _truncated: true, preview: s.slice(0, MAX_FACT_PARAM_BYTES) + "…" };
    }
  } catch {
    params = null;
  }
  return {
    verb:   f.verb || null,
    act:    f.act || null,
    of:     f.of
      ? { kind: f.of.kind || null, id: f.of.id ? String(f.of.id) : null }
      : null,
    params,
  };
}

function serializeAct(a) {
  return {
    _id:             String(a._id),
    ibpAddress:      a.ibpAddress || null,
    activeAble:      a.activeAble || null,
    through:         a.through ? String(a.through) : null,
    to:              a.to ? String(a.to) : null,
    rootCorrelation: a.rootCorrelation || null,
    inReplyTo:       a.inReplyTo || null,
    parentThread:    a.parentThread || null,
    priority:        a.priority || null,
    startMessage:    a.startMessage || null,
    endMessage:      a.endMessage || null,
    // The act's append ordinal (the order; the progressive-loading cursor pages
    // by this) and its lone inert seal-time witness (display only). The act
    // keeps exactly one wall-clock field, `at`.
    ord:             Number.isFinite(Number(a.ord)) ? Number(a.ord) : null,
    at:              a.at || null,
    answers:         a.answers || null,
    // History this Act was stamped on. Null on legacy acts predating
    // the field; clients should treat that as main.
    history:          a.history || null,
    // The canonical inner face this act ran under . orientation + able
    // + position + capabilities + able.canSee-resolved blocks, stamped
    // on every act regardless of the being's cognition. Null on legacy
    // acts predating the field.
    innerFace:  a.innerFace || null,
    // Seal-signature presence. The full sig (incl. value) stays on the
    // line; the wire carries who signed and the scheme so clients can
    // badge signed acts. by is a key id (self-certifying) or "i-am".
    sig: a.sig?.value ? { alg: a.sig.alg || null, by: a.sig.by || null } : null,
  };
}
