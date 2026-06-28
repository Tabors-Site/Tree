// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// actHash — content-addressed Act identity.
//
// Acts are chains too (math.md: every being has an act-chain A_b).
// An act's `_id` IS the hash of its OPENING, linked to the being's
// previous act:
//
//   _id = SHA-256(p | canonical(opening))
//
// The identity is the MOMENT'S OPENING, not its outcome — facts
// stamped during the moment carry actId, so the identity must exist
// at assign time, before anything sealed. The closure (status,
// endMessage, innerFace, answers) is row bookkeeping OUTSIDE the
// digest: it mutates by design (attempted → answered, the seal's
// closing utterance) and the chain's truth about what HAPPENED lives
// in the facts the act produced, which are themselves hash-chained.
//
// The opening excludes:
//   at — the act's lone wall-clock witness (the seal time). Human time is a
//     display helper for beings filtering timelines, never truth
//     (Tabor doctrine 2026-06-11); the OS shows it off the kernel
//     clock and the chain doesn't commit to it. Order is act.ord (the
//     clock-free append ordinal) + the chain `p`, never this.
//   startMessage — the moment's prose LABEL (a human annotation) and
//     its source. A label is DRIFT in the identity (Tabor doctrine
//     2026-06-23: "moment labels are drift"): the act's truth is the
//     FACTS it seals (the Word, themselves hash-chained), and the
//     human-readable line renders from those, never from an authored
//     string. Distinct inbound moments are already separated by their
//     routing (ibpAddress / inboxMessageId / inReplyTo) and chain
//     position (p); the source is redundant with `through`. The label
//     stays on the Act row for display, OUT of the digest.
//   rootCorrelation — derived threading (a parentless act is its OWN
//     root, which would be circular in the digest; recoverable as
//     parent's root else self).
//   priority / answers / status / end fields — scheduling and closure
//     bookkeeping.
//
// Chain shape: per (story, history, being). p = the being's previous
// SEALED act's identity on that (story, history). The story scopes the
// chain to the reality the acts happened in — a Name acts across
// stories, so without it a foreign act would interleave a local
// (history, being) chain. ActHead advances only at seal — a crashed
// moment leaves zero trace, including here. First act on any chain
// chains from GENESIS_PREV; cross-history biography continuity is the
// be:switch fact on the REEL, not the act-chain.

import { GENESIS_PREV } from "../fact/hash.js";
import { native } from "../fact/native.js";
import {
  readActHeadFile,
  advanceActHeadFile,
} from "../fileStore.js";

// The hashable opening of an act + its identity — PURE RUST bindings to rust/treehash (content_of_act
// excludes `startMessage`/`at`/closure bookkeeping; act_id = compute_hash(p, content_of_act)). The JS
// implementations were deleted; rust/treehash is the single source of truth (proven by the act vectors).

/** The hashable opening of an act (plain object). */
export function contentOfAct(act) {
  return JSON.parse(native.contentOfAct(JSON.stringify(act)));
}

export function computeActId(p, act) {
  return native.actId(p, JSON.stringify(act));
}

export function actHeadKey(story, history, beingId) {
  return `${story}:${history}:${String(beingId)}`;
}

/** The being's act-chain head on a (story, history) (GENESIS_PREV when none). */
export async function readActHead(story, history, beingId) {
  // File-backed (fileStore): the .acthead beside the being's act-log holds
  // the chain head as a derived pointer (rebuildable from the act-log).
  return readActHeadFile(story, history, beingId);
}

/**
 * Advance the act-chain head — called ONLY where the Act row actually
 * lands (sealAct, crossWorld's direct open). Crashed moments never
 * reach here, so the chain only ever points at acts that exist.
 *
 * With `expectPrev` (the `p` the sealing act chained off) the advance
 * is a COMPARE-AND-SET: it only lands if the head still equals
 * expectPrev. A mismatch means another act sealed on this chain
 * between this act's open and its seal — last-writer-wins here would
 * silently FORK the chain (two acts sharing one parent, one of them
 * unreachable from the head). Instead we throw ACT_CHAIN_MOVED;
 * inside sealAct's transaction that aborts the whole seal (facts,
 * act row, head — nothing lands), the moment fails loudly, the inbox
 * row stays open, and the retry re-opens from the new head.
 */
export async function advanceActHead(story, history, beingId, actId, { session = null, expectPrev } = {}) {
  // File-backed CAS (fileStore.advanceActHeadFile): the .acthead beside the
  // being's act-log advances under a compare-and-set on the prior head. A
  // stale author is refused with ACT_CHAIN_MOVED — the chain can't fork. The
  // single global commit mutex serializes writes, so the `session` arg (a
  // transactional ownership token) is no longer load-bearing; accepted for
  // signature parity, ignored.
  void session;
  if (expectPrev === undefined) {
    // Legacy unconditional advance (callers that own their serialization):
    // read the current head and advance off it so the CAS always lands.
    expectPrev = readActHeadFile(story, history, beingId);
  }
  // GENESIS_PREV is the empty-chain prev; readActHeadFile returns it when no
  // .acthead exists, so a null/GENESIS expectPrev maps onto the genesis case
  // without a special branch.
  const prev = expectPrev == null ? GENESIS_PREV : expectPrev;
  advanceActHeadFile(story, history, beingId, actId, prev);
}

/**
 * Walk a being's act-chain backward from its head, verifying every
 * act's identity recomputes from (p, opening) and every p resolves
 * to a real act, down to GENESIS_PREV. The act-chain sibling of
 * verifyReel — detection only, no repair.
 *
 * I/O in JS, REHASH in Rust: the backward head-walk (readActHeadFile +
 * getActById, the store concern) MATERIALIZES the chain oldest-first and
 * catches the I/O-only break shapes — `missing-act` (a `p` resolving to no
 * stored row) and `unaddressed` (an act whose `p` isn't a string). The
 * recompute-from-(p, opening) + p-link verdict is then the Tier-3
 * `treeverify` crate, reached through the addon as native.verifyActChain.
 * There is NO JS rehash here anymore — the per-act re-hash + p-link walk
 * was deleted; Rust is the single source of truth (proven byte-identical
 * by the chain golden vectors + the live-chain parity harness). The clean
 * verdict { ok, count, headHash } is byte-identical to the retired walk.
 *
 * @returns {{ok:true, count:number, headHash:string|null} |
 *           {ok:false, count:number, brokenAt:string, reason:string}}
 */
export async function verifyActChain(story, history, beingId) {
  const headHashFile = readActHeadFile(story, history, beingId);
  const head = headHashFile || GENESIS_PREV;
  const collected = await collectActChain(story, head, GENESIS_PREV);
  if (!collected.ok) return collected; // missing-act / unaddressed (I/O shapes, head-relative count)
  // The recompute + p-link verdict IS Rust now, on the oldest-first materialization.
  return JSON.parse(native.verifyActChain(JSON.stringify(collected.acts)));
}

/**
 * verifyActChain's anchored sibling: walk a being's act-chain backward
 * from its head but STOP at a declared anchor (`stopAtP`) instead of only
 * GENESIS_PREV. A partial graft carries a CONTIGUOUS act-chain segment
 * (head .. the act after stopAtP); the act before the segment, stopAtP,
 * is legitimately absent, so the walk halts there rather than reporting a
 * missing-act. Degenerate at stopAtP = GENESIS_PREV this IS verifyActChain.
 *
 * Same split as verifyActChain: the backward walk (I/O) materializes the
 * segment and catches missing-act / unaddressed; native.verifyActChain
 * (Rust) renders the recompute + p-link verdict. Because the segment is
 * anchored (its oldest act's `p` = stopAtP, legitimately absent), the
 * Rust kernel verifies the segment's INTERNAL chain — each act's identity
 * recomputes from its own (p, opening) — which is the integrity the anchor
 * delegates upward; the cross-anchor link is the caller's graft proof.
 *
 * @param {string} story
 * @param {string} history
 * @param {string} beingId
 * @param {object} [opts]
 * @param {string} [opts.stopAtP=GENESIS_PREV] identity of the act BEFORE the segment
 * @param {string} [opts.fromHead] head to walk from (default: the live ActHead)
 * @returns {{ok:true,count,headHash}|{ok:false,count,brokenAt,reason}}
 */
export async function verifyActChainFrom(story, history, beingId, { stopAtP = GENESIS_PREV, fromHead } = {}) {
  let head = fromHead;
  if (head === undefined) {
    head = readActHeadFile(story, history, beingId) || GENESIS_PREV;
  }
  const headHash = (head && head !== GENESIS_PREV) ? head : null;
  const collected = await collectActChain(story, head, stopAtP);
  if (!collected.ok) return collected; // missing-act / unaddressed (I/O shapes)
  // The seeded recompute IS Rust now: the segment's oldest act carries p = stopAtP (the backward walk
  // stopped there), so the verdict seeds at stopAtP, not genesis. Degenerate at GENESIS this == verifyActChain.
  const verdict = JSON.parse(native.verifyActChainFrom(JSON.stringify(collected.acts), stopAtP));
  // The anchored segment's headHash is the live head we walked from, not the
  // walked-forward tail (an empty segment still reports its declared head).
  if (verdict.ok) verdict.headHash = headHash;
  return verdict;
}

/**
 * The act-chain I/O: walk backward from `head` until `stop`, resolving each
 * `p` through the store (getActById), and return the acts OLDEST-FIRST for
 * the Rust rehash. Catches the store-coupled break shapes inline (head-
 * relative count, byte-identical to the retired walk):
 *   - missing-act  — a `p` (or the head) resolves to no stored row.
 *   - unaddressed  — an act whose `p` field isn't a string.
 * A clean walk returns { ok:true, acts:[oldest..head] }.
 */
async function collectActChain(story, head, stop) {
  const { getActById } = await import("./actChain.js");
  const newestFirst = [];
  let h = head;
  let count = 0;
  while (h !== GENESIS_PREV && h !== stop) {
    const act = await getActById(h, story);
    if (!act) return { ok: false, count, brokenAt: h, reason: "missing-act" };
    if (typeof act.p !== "string") return { ok: false, count, brokenAt: h, reason: "unaddressed" };
    newestFirst.push(act);
    count++;
    h = act.p;
  }
  return { ok: true, acts: newestFirst.reverse() };
}
