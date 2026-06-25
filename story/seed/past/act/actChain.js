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
//   patchActStatus(actId, partial)        -> bool    (status/innerFace/severedAt)
//   actCount(filter)                      -> number
//
// plus the explorer descriptor (describeActChain) + the act-fact attachment
// (attachActFacts), now file-backed.
//
// A being's act-chain (MODEL.md: A_b) is the sequence of moments that being
// authored: the acts on the being's per-(story,history) act-log. Acts have no
// per-being monotonic seq; the explorer orders newest-first by stampedAt.
//
// Used by SEE on <story>/.acts/<beingId> + the curated act sweep callers.

import { getStoryDomain } from "../../ibp/address.js";
import { getFactsByActId } from "../fact/facts.js";
import * as fileStore from "../fileStore.js";
import { redactSecrets } from "../../materials/redact.js";
import {
  resolveHistoryLineage,
  loadHistory,
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
 * Get one act by id (patch-merged: status/innerFace/severedAt overlay the
 * sealed line). Returns the plain act doc (the .lean() shape) or null.
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

// The post-seal-mutable fields (the doctrine's lone exception to act-row
// immutability): status (attempted → terminal), innerFace (foreign descriptor
// observation), severedAt (a cut from outside), and qualities.statusMeta.
const PATCHABLE_FIELDS = new Set([
  "status",
  "innerFace",
  "severedAt",
  "qualities.statusMeta",
  "qualities",
]);

/**
 * Patch an act's mutable closure fields (status/innerFace/severedAt). The act's
 * content hash is over its OPENING, so these never change its identity. Writes
 * a patch overlay merged on every read. Only PATCHABLE_FIELDS are accepted; any
 * other key is rejected (the act row is otherwise immutable).
 *
 * @param {string} actId
 * @param {object} partial   the fields to set (e.g. { status: "landed" })
 * @param {string} [story]
 * @returns {boolean}        true if the act exists and the patch landed
 */
export function patchActStatus(actId, partial, story) {
  if (actId == null || !partial || typeof partial !== "object") return false;
  const s = storyOf(story);
  const id = String(actId);
  // The act must exist to patch it (a patch on a phantom id is a no-op signal).
  if (!fileStore.readActById(s, id)) return false;
  const clean = {};
  for (const [k, v] of Object.entries(partial)) {
    if (PATCHABLE_FIELDS.has(k)) clean[k] = v;
  }
  if (Object.keys(clean).length === 0) return false;
  return fileStore.patchAct(s, id, clean) != null;
}

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

/**
 * The distinct rootCorrelations of every severed act in the story — the
 * cross-aggregate severed-roots roll-up (no per-act-equality facet answers it,
 * since severedAt is a post-seal patch field, not an index facet). Used at boot
 * to prime the severed-roots cache (materials/space/threads.js). The curated
 * peer of the old Act.aggregate([$match severedAt, $group rootCorrelation]).
 *
 * @param {string} [story]
 * @returns {string[]}
 */
export function getSeveredRootCorrelations(story) {
  return fileStore.severedRootCorrelations(storyOf(story));
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
 * @param {string} [opts.before]      ISO timestamp — when set, only
 *                                    return acts strictly older than
 *                                    this (progressive loading cursor).
 * @returns {Promise<{ being: {id, name}, acts: object[], count: number }>}
 */
export async function describeActChain(beingId, opts = {}) {
  if (!beingId) throw new Error("describeActChain: beingId required");
  const history = typeof opts.history === "string" && opts.history.length
    ? opts.history
    : MAIN;
  const limit = Math.min(Math.max(Number(opts.limit) || 100, 1), MAX_LIMIT);
  const before = typeof opts.before === "string" && opts.before.length
    ? opts.before
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
 * history-lineage walk in foldEngine, but bounded by timestamp (acts have no
 * per-aggregate seq) — each ancestor owns acts stamped before the next-down
 * history was created; the leaf owns everything after its own creation.
 *
 * Returns newest-first, capped at limit. Acts with no history field (legacy)
 * are treated as main acts. File-backed: reads each history's own act-chain via
 * fileStore.readActChain, then unions + time-gates + sorts in JS.
 */
async function readActChainLineage({ beingId, history, limit, before }) {
  const beforeDate = before ? new Date(before) : null;
  const beforeOK = beforeDate && !Number.isNaN(beforeDate.getTime());
  const beforeMs = beforeOK ? beforeDate.getTime() : null;
  const story = getStoryDomain();

  const stamp = (a) => {
    const t = a?.stampedAt ?? a?.receivedAt ?? null;
    const ms = t != null ? new Date(t).getTime() : NaN;
    return Number.isNaN(ms) ? null : ms;
  };

  if (isMain(history)) {
    // Own-history (main) chain. Legacy acts with no history field landed on
    // main's log too (the write keyed history "0"), so the own-log read is
    // complete.
    const all = fileStore.readActChain(story, MAIN, beingId).filter((a) => {
      if (a.through != null && String(a.through) !== String(beingId)) return false;
      if (beforeMs != null) {
        const ms = stamp(a);
        if (ms == null || !(ms < beforeMs)) return false;
      }
      return true;
    });
    return sortNewestFirst(all, stamp).slice(0, limit);
  }

  const lineage = await resolveHistoryLineage(history);
  const out = [];
  for (let i = 0; i < lineage.length; i++) {
    const here = lineage[i];
    const next = lineage[i + 1] || null;
    const hereDoc = isMain(here) ? null : await loadHistory(here);
    const lowerMs = hereDoc?.createdAt ? new Date(hereDoc.createdAt).getTime() : null;
    let upperMs = next ? (await loadHistory(next))?.createdAt : null;
    upperMs = upperMs ? new Date(upperMs).getTime() : null;
    if (upperMs != null && lowerMs != null && upperMs <= lowerMs) continue;
    // The progressive-loading `before` cursor shrinks the upper bound further.
    let effUpper = upperMs;
    if (beforeMs != null && (effUpper == null || beforeMs < effUpper)) effUpper = beforeMs;

    for (const a of fileStore.readActChain(story, String(here), beingId)) {
      if (a.through != null && String(a.through) !== String(beingId)) continue;
      const ms = stamp(a);
      if (lowerMs != null && (ms == null || !(ms >= lowerMs))) continue;
      if (effUpper != null && (ms == null || !(ms < effUpper))) continue;
      out.push(a);
    }
  }
  return sortNewestFirst(out, stamp).slice(0, limit);
}

// Sort acts newest-first by stamp; id as a deterministic tiebreak (mirrors the
// Mongo sort { stampedAt: -1, _id: -1 }). Acts with no stamp sort last.
function sortNewestFirst(acts, stamp) {
  return acts.slice().sort((a, b) => {
    const ta = stamp(a);
    const tb = stamp(b);
    if (ta == null && tb == null) return String(b._id).localeCompare(String(a._id));
    if (ta == null) return 1;
    if (tb == null) return -1;
    if (ta !== tb) return tb - ta;
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
    receivedAt:      a.receivedAt || null,
    stampedAt:       a.stampedAt || null,
    severedAt:       a.severedAt || null,
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
