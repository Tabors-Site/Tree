// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// actChain.js — read-side over the Act collection for a single being.
//
// A being's act-chain (MODEL.md: A_b) is the sequence of moments that
// being authored: every Act row where beingIn = <beingId>. Returns
// newest-first for explorer views; the seq-style chain walk lives on
// the Fact side (per-reel seq + hash linkage). Acts have no per-being
// monotonic seq today; we order by stampedAt.
//
// Used by SEE on <reality>/.acts/<beingId> to power the act-chain
// explorer in client surfaces (flat-app, future tooling).

import Act from "./act.js";
import Fact from "../fact/fact.js";
import { redactSecrets } from "../../materials/redact.js";
import {
  resolveBranchLineage,
  loadBranch,
  MAIN,
  isMain,
} from "../../materials/branch/branches.js";

// Cap is high so per-being scrubbable history reaches back to the
// being's first act even after long sessions of fine-grained
// movement (every coord tick is one Act). Timeline UIs request the
// max explicitly.
const MAX_LIMIT = 10000;
const MAX_FACT_PARAM_BYTES = 512;

/**
 * Build the act-chain descriptor for one being on a given branch.
 * Newest-first. Walks branch lineage: a being's acts on branch #4
 * include the acts they stamped on every ancestor branch BEFORE the
 * fork point, plus their own divergent acts on #4 afterward.
 *
 * @param {string} beingId
 * @param {object} [opts]
 * @param {string} [opts.branch="0"]  branch path to read on
 * @param {number} [opts.limit=100]
 * @returns {Promise<{ being: {id, name}, acts: object[], count: number }>}
 */
export async function describeActChain(beingId, opts = {}) {
  if (!beingId) throw new Error("describeActChain: beingId required");
  const branch = typeof opts.branch === "string" && opts.branch.length
    ? opts.branch
    : MAIN;
  const limit = Math.min(Math.max(Number(opts.limit) || 100, 1), MAX_LIMIT);

  const acts = await readActChainLineage({
    beingId: String(beingId),
    branch,
    limit,
  });

  let beingName = null;
  try {
    const { loadProjection } = await import("../../materials/projections.js");
    const slot = await loadProjection("being", beingId, branch);
    beingName = slot?.state?.name || null;
  } catch { /* best-effort */ }

  const serialized = acts.map(serializeAct);
  // Pass the being's own id so attachActFacts can compute each act's
  // `lastFactSeq` per the BEING'S OWN reel (seqs are per-reel; the
  // cross-reel max would be meaningless for foldAt("being", id, seq)).
  await attachActFacts(serialized, { reelKind: "being", reelId: String(beingId) });

  return {
    being: { id: String(beingId), name: beingName },
    // Redact secrets before the chain leaves over the wire — attached
    // fact params (set-being credential / llm-connection writes) and any
    // message payload pass through the redactor; the DB act-chain is
    // untouched.
    acts: serialized.map((a) => redactSecrets(a)),
    count: acts.length,
  };
}

/**
 * Attach a compact Fact summary to each serialized Act, in one batched
 * query (no N+1). An Act row deliberately does not store its Facts
 * (act.js: "what happened inside this moment" is Fact.find({ actId })),
 * but a client rendering the chain needs to show what a moment DID when
 * it produced no prose: a structured act (a dancer's step, any tool
 * call) has an empty endMessage because its content IS the Facts it
 * stamped. This surfaces those Facts so the UI can render the action
 * instead of treating the moment as empty.
 *
 * Each fact is reduced to { verb, action, target:{kind,id}, params },
 * params capped so a large write (set-render, matter content) can't
 * bloat the descriptor. Facts ride oldest-first within each Act.
 *
 * Optional `reel` selector computes `a.lastFactSeq` per the named
 * reel rather than per-act-globally. Per-reel is what the timeline-
 * rewind UI wants: clicking a row means "fold THIS being to this
 * seq," and seqs are per-reel — the cross-reel max would be
 * meaningless. When the act sealed no facts on the named reel,
 * `lastFactSeq` is null (the row renders inert).
 *
 * Mutates and returns the passed array.
 *
 * @param {Array<{_id:string}>} serializedActs
 * @param {object} [opts]
 * @param {string} [opts.reelKind] target.kind to filter the seq
 *   computation by ("being" | "space" | "matter").
 * @param {string} [opts.reelId]   target.id to filter the seq
 *   computation by.
 * @returns {Promise<Array>}
 */
export async function attachActFacts(serializedActs, opts = {}) {
  if (!Array.isArray(serializedActs) || serializedActs.length === 0) {
    return serializedActs;
  }
  const ids = serializedActs.map((a) => String(a._id));
  let facts = [];
  try {
    facts = await Fact.find({ actId: { $in: ids } })
      .select("actId verb action target params seq")
      .sort({ seq: 1, _id: 1 })
      .lean();
  } catch {
    // Best-effort enrichment; the act chain still renders without it.
    facts = [];
  }
  const byAct       = new Map();
  const lastSeqByAct = new Map();
  const reelKind = typeof opts.reelKind === "string" ? opts.reelKind : null;
  const reelId   = opts.reelId != null ? String(opts.reelId) : null;
  for (const f of facts) {
    const key = String(f.actId);
    if (!byAct.has(key)) byAct.set(key, []);
    byAct.get(key).push(compactFact(f));
    // Track the highest seq per act, optionally filtered to facts on
    // ONE specific reel. Per-reel filtering is what callers
    // computing a "fold this aggregate to seq N" anchor need, since
    // seqs are local to each reel.
    if (typeof f.seq === "number") {
      if (reelKind && reelId) {
        const t = f.target;
        if (!t || t.kind !== reelKind || String(t.id) !== reelId) continue;
      }
      const prev = lastSeqByAct.get(key);
      if (prev == null || f.seq > prev) lastSeqByAct.set(key, f.seq);
    }
  }
  for (const a of serializedActs) {
    a.facts = byAct.get(String(a._id)) || [];
    // The "as-of" seq for the act's POST-SEAL state on the requested
    // reel. Timeline rows render at this point so clicking shows
    // the state AFTER the act's facts applied, not mid-moment. Null
    // when the act sealed no facts on the requested reel (a SEE-only
    // moment, or an act whose facts targeted other reels).
    a.lastFactSeq = lastSeqByAct.get(String(a._id)) ?? null;
  }
  return serializedActs;
}

/**
 * Read a being's act-chain across a branch lineage. Mirrors the fact
 * reel's branch-lineage walk in foldEngine, but bounded by timestamp
 * (acts have no per-aggregate seq) — each ancestor owns acts stamped
 * before the next-down branch was created; the leaf owns everything
 * after its own creation.
 *
 * Returns newest-first, capped at limit. Acts with no branch field
 * (legacy, pre-Act-branching) are treated as main acts to stay
 * compatible with old data.
 */
async function readActChainLineage({ beingId, branch, limit }) {
  if (isMain(branch)) {
    return Act.find({
      beingIn: beingId,
      $or: [{ branch: MAIN }, { branch: { $exists: false } }],
    })
      .sort({ stampedAt: -1, _id: -1 })
      .limit(limit)
      .lean();
  }

  const lineage = await resolveBranchLineage(branch);
  // For each ancestor, compute its owned [from, before) time range.
  // Main owns everything before #firstChild.createdAt.
  // Each intermediate X owns acts from X.createdAt to nextChild.createdAt.
  // The leaf owns acts from its own createdAt onward (no upper bound).
  const ranges = [];
  for (let i = 0; i < lineage.length; i++) {
    const here = lineage[i];
    const next = lineage[i + 1] || null;
    const hereDoc = isMain(here) ? null : await loadBranch(here);
    const lower = hereDoc?.createdAt ?? null;
    const upper = next ? (await loadBranch(next))?.createdAt ?? null : null;
    if (upper && lower && upper <= lower) continue;
    ranges.push({ branch: here, lower, upper });
  }
  if (ranges.length === 0) return [];

  const orClauses = ranges.map(({ branch: b, lower, upper }) => {
    const branchClause = isMain(b)
      ? { $or: [{ branch: MAIN }, { branch: { $exists: false } }] }
      : { branch: b };
    const timeFilter = {};
    if (lower) timeFilter.$gte = lower;
    if (upper) timeFilter.$lt  = upper;
    return {
      beingIn: beingId,
      ...branchClause,
      ...(Object.keys(timeFilter).length > 0 ? { stampedAt: timeFilter } : {}),
    };
  });

  return Act.find({ $or: orClauses })
    .sort({ stampedAt: -1, _id: -1 })
    .limit(limit)
    .lean();
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
    action: f.action || null,
    target: f.target
      ? { kind: f.target.kind || null, id: f.target.id ? String(f.target.id) : null }
      : null,
    params,
  };
}

function serializeAct(a) {
  return {
    _id:             String(a._id),
    ibpAddress:      a.ibpAddress || null,
    activeRole:      a.activeRole || null,
    beingIn:         a.beingIn ? String(a.beingIn) : null,
    beingOut:        a.beingOut ? String(a.beingOut) : null,
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
    // Branch this Act was stamped on. Null on legacy acts predating
    // the field; clients should treat that as main.
    branch:          a.branch || null,
    // The bounded face this act ran under — orientation + role + space +
    // occupants + capabilities, stamped on every act regardless of the
    // being's cognition. Null on legacy acts predating the field. Clients
    // render it as the act's "what I saw and could do" record.
    facadeSnapshot:  a.facadeSnapshot || null,
  };
}
