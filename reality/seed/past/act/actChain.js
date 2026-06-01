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

const MAX_LIMIT = 500;
const MAX_FACT_PARAM_BYTES = 512;

/**
 * Build the act-chain descriptor for one being. Newest-first.
 *
 * @param {string} beingId
 * @param {object} [opts]
 * @param {number} [opts.limit=100]
 * @returns {Promise<{ being: {id, name}, acts: object[], count: number }>}
 */
export async function describeActChain(beingId, opts = {}) {
  if (!beingId) throw new Error("describeActChain: beingId required");
  const limit = Math.min(Math.max(Number(opts.limit) || 100, 1), MAX_LIMIT);

  const acts = await Act.find({ beingIn: String(beingId) })
    .sort({ stampedAt: -1, _id: -1 })
    .limit(limit)
    .lean();

  let beingName = null;
  try {
    const Being = (await import("../../materials/being/being.js")).default;
    const row = await Being.findById(beingId).select("name").lean();
    beingName = row?.name || null;
  } catch { /* best-effort */ }

  const serialized = acts.map(serializeAct);
  await attachActFacts(serialized);

  return {
    being: { id: String(beingId), name: beingName },
    acts: serialized,
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
 * Mutates and returns the passed array.
 *
 * @param {Array<{_id:string}>} serializedActs
 * @returns {Promise<Array>}
 */
export async function attachActFacts(serializedActs) {
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
  const byAct = new Map();
  for (const f of facts) {
    const key = String(f.actId);
    if (!byAct.has(key)) byAct.set(key, []);
    byAct.get(key).push(compactFact(f));
  }
  for (const a of serializedActs) {
    a.facts = byAct.get(String(a._id)) || [];
  }
  return serializedActs;
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
  };
}
