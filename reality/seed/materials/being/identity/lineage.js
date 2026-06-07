// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// lineage.js — fold answers about who birthed whom.
//
// "Being parent" here is the specific role of HAVING PERFORMED THE
// BIRTH ACT for a being. It is NOT the generic SUMMON sense (anyone
// calling anyone). It is NOT the live parentBeingId on the being row
// (which can drift later through reparenting). The being parent is
// the `parentBeingId` recorded inside the new being's `be:birth`
// Fact at the moment of birth — that pointer is permanent and lives
// on the fact chain.
//
// The substrate's claim: "who birthed me" is not a stored field on
// the being. It is the answer to a fold question against the fact
// chain. Birth leaves one fact: `be:birth` on the new being's reel,
// carrying `params.parentBeingId`. findBeingParent reads that.
// The earlier shape stamped a separate `be:summon-create` Fact on
// the being parent's reel to record lineage, but it was a redundant
// audit (the same parent pointer lives on the birth fact) AND it
// mixed summon semantics into the BE namespace. Collapsed into
// `be:birth` on 2026-06-03.
//
// Credential authority (read, reset, detach) is derived here. Self
// always has authority. The being parent has authority until the
// target stamps a be:credential-detach on its own reel, at which
// point the fold answers "detached" and being-parent reads stop. The
// detach is asymmetric: only the being parent can re-attach (a later
// be:credential-attach Fact on the being parent's reel naming the
// target). See [[project-credential-model]].

import Fact from "../../../past/fact/fact.js";

/**
 * Return the beingId of whoever birthed `targetBeingId`, or null if
 * no be:birth Fact names them. The I-Am has no being parent (root of
 * the being-tree); its birth fact carries no parentBeingId, so
 * callers should special-case that with isIAm() rather than treat
 * null as "orphan".
 *
 * Genesis-time seed delegates are birthed by the I-Am via the
 * scaffold path in seedDelegates.js; their `be:birth` Fact's
 * `params.parentBeingId` points at the I-Am, so arrival /
 * cherub / llm-assigner / reality-manager resolve to the I-Am here.
 */
export async function findBeingParent(targetBeingId) {
  if (!targetBeingId) return null;
  const fact = await Fact.findOne({
    verb: "be",
    action: "birth",
    "target.kind": "being",
    "target.id": String(targetBeingId),
  })
    .sort({ seq: 1, date: 1 })
    .select("params")
    .lean();
  return fact?.params?.parentBeingId || null;
}

/**
 * Has `beingId` detached from its being parent? Reads two reels
 * because SINGLE-WRITER places each fact on its actor's reel:
 *
 *   - credential-detach   self-stamped on the CHILD's reel
 *                         (target.kind=being, target.id=child)
 *   - credential-attach   self-stamped on the BEING PARENT's reel
 *                         (target.kind=being, target.id=parentBeing),
 *                         with `result.targetBeingId === child`
 *
 * The latest of the two (by Fact.date — wall-clock at seal) decides
 * current state. There is no global per-reel seq, so cross-reel
 * ordering uses the seal wall-clock; the two acts are not racing
 * (attach is being-parent-only and gated on a prior detach), so the
 * dates totally order in practice.
 *
 * When the child has no being parent (the I-Am) we short-circuit
 * false — the I-Am cannot detach from anyone.
 */
export async function isDetachedFromBeingParent(beingId) {
  if (!beingId) return false;
  const childId = String(beingId);
  const parentBeingId = await findBeingParent(childId);

  const detachQuery = Fact.findOne({
    "target.kind": "being",
    "target.id": childId,
    verb: "do",
    action: "credential-detach",
  })
    .sort({ seq: -1, date: -1 })
    .select("date")
    .lean();

  const attachQuery = parentBeingId
    ? Fact.findOne({
        "target.kind": "being",
        "target.id": String(parentBeingId),
        verb: "do",
        action: "credential-attach",
        "result.targetBeingId": childId,
      })
        .sort({ seq: -1, date: -1 })
        .select("date")
        .lean()
    : Promise.resolve(null);

  const [latestDetach, latestAttach] = await Promise.all([
    detachQuery,
    attachQuery,
  ]);

  if (!latestDetach) return false;
  if (!latestAttach) return true;
  return latestDetach.date > latestAttach.date;
}

/**
 * Does `askerBeingId` have credential authority over `targetBeingId`?
 *
 *   self          → yes, always
 *   I_AM          → yes, always (universal authority on its own reality)
 *   being parent  → yes, unless target has detached and not re-attached
 *   anyone else   → no
 *
 * Authority is direct-lineage only between regular beings — not
 * transitive. Cherub's children answer to cherub, not their
 * grandparent. The I-Am has a separate universal override because
 * it's the source of all authority on its own reality (parallel to
 * authorize.js's I_AM short-circuit); seed-internal credential ops
 * that act through `identity: I_AM` go through this path.
 */
export async function hasCredentialAuthority(askerBeingId, targetBeingId) {
  if (!askerBeingId || !targetBeingId) return false;
  if (String(askerBeingId) === String(targetBeingId)) return true;
  const { I_AM } = await import("../seedBeings.js");
  if (String(askerBeingId) === String(I_AM)) return true;
  const parentBeingId = await findBeingParent(targetBeingId);
  if (!parentBeingId || String(parentBeingId) !== String(askerBeingId)) return false;
  const detached = await isDetachedFromBeingParent(targetBeingId);
  return !detached;
}

