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
// target)..

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
 * cherub / llm-assigner / story-manager resolve to the I-Am here.
 */
export async function findBeingParent(targetBeingId) {
  if (!targetBeingId) return null;
  const fact = await Fact.findOne({
    verb: "be",
    act: "birth",
    "of.kind": "being",
    "of.id": String(targetBeingId),
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
 *                         (of.kind=being, of.id=child)
 *   - credential-attach   self-stamped on the BEING PARENT's reel
 *                         (of.kind=being, of.id=parentBeing),
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
    "of.kind": "being",
    "of.id": childId,
    verb: "do",
    act: "credential-detach",
  })
    .sort({ seq: -1, date: -1 })
    .select("date")
    .lean();

  const attachQuery = parentBeingId
    ? Fact.findOne({
        "of.kind": "being",
        "of.id": String(parentBeingId),
        verb: "do",
        act: "credential-attach",
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
 * THIN SHIM over the being-tree authority axis (inheritation.js). The
 * asker is a BEING; the authority that matters is its NAME's authority
 * over the target's tree position:
 *
 *   self   → yes, always (a being may touch its own credential)
 *   I_AM   → yes, always (the story is the source of all authority)
 *   else   → the asker's NAME (its trueName) has authority over the
 *            target — it owns the target or an ancestor, or holds an
 *            inheritation point covering it (hasAuthorityOver).
 *
 * This SUPERSEDES the pre-inheritation direct-being-parent rule (and
 * its credential-detach escape hatch): owning an ancestor is exactly
 * the parent case, generalized up the tree and opened to delegation.
 * `credential-detach`/`credential-attach` no longer change the
 * authority answer — the being-tree (ownership + points) is the one
 * authority model now; `isDetachedFromBeingParent` remains for any
 * direct reader but is authority-inert here.
 */
export async function hasCredentialAuthority(askerBeingId, targetBeingId, history) {
  if (!askerBeingId || !targetBeingId) return false;
  if (String(askerBeingId) === String(targetBeingId)) return true;
  const { I_AM } = await import("../seedBeings.js");
  if (String(askerBeingId) === String(I_AM)) return true;

  // Resolve a history to read the tree on (never literal "0").
  let b = history;
  if (!b) {
    const { getDefaultHistory } = await import("../../history/historyRegistry.js");
    b = await getDefaultHistory();
  }

  // The asker's NAME (the being's trueName) is what actually holds
  // authority. Resolve it, then ask the being-tree.
  const { loadProjection } = await import("../../projections.js");
  const askerSlot = await loadProjection("being", String(askerBeingId), b);
  const askerName = askerSlot?.state?.trueName;
  if (!askerName) return false;

  const { hasAuthorityOver } = await import("./inheritation.js");
  return await hasAuthorityOver(String(askerName), String(targetBeingId), b);
}

