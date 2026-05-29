// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// lineage.js — fold answers about who created whom.
//
// "Creator" here is the specific role of HAVING PERFORMED THE BIRTH
// ACT for a being. It is NOT the generic SUMMON sense (anyone calling
// anyone). It is NOT parentBeingId (the being-tree parent, which can
// drift later through reparenting). The creator is whoever stamped
// the be:summon-create Fact that minted this being.
//
// The substrate's claim: "who created me" is not a stored field on the
// being. It is the answer to a fold question against the fact chain.
// Every birth leaves two facts: be:register on the new being's reel,
// be:summon-create on the creator's reel naming the createdBeingId.
// The creator is whoever stamped the be:summon-create.
//
// Credential authority (read, reset, detach) is derived here. Self
// always has authority. Creator has authority until the target stamps
// a be:credential-detach on its own reel, at which point the fold
// answers "detached" and creator reads stop. The detach is
// asymmetric: only the creator can re-attach (a later be:credential-
// attach Fact on the creator's reel naming the target). See
// [[project-credential-model]].

import Fact from "../../../past/fact/fact.js";

/**
 * Return the beingId of whoever summoned `targetBeingId`, or null if
 * no be:summon-create Fact names them. The I-Am has no creator (root
 * of the being-tree); callers should special-case that with isIAm()
 * rather than treat null as "orphan".
 *
 * Genesis-time seed delegates are summoned by the I-Am via the scaffold
 * path in seedDelegates.js, which DOES emit a be:summon-create Fact
 * on the I-Am's reel. So arrival/cherub/llm-assigner/reality-manager
 * resolve to the I-Am here, not null.
 */
export async function findCreatorOf(targetBeingId) {
  if (!targetBeingId) return null;
  const fact = await Fact.findOne({
    verb: "be",
    action: "summon-create",
    "params.createdBeingId": String(targetBeingId),
  })
    .sort({ seq: 1, date: 1 })
    .select("beingId")
    .lean();
  return fact?.beingId || null;
}

/**
 * Has `beingId` detached from its creator? Reads two reels because
 * SINGLE-WRITER places each fact on its actor's reel:
 *
 *   - credential-detach   self-stamped on the CHILD's reel
 *                         (target.kind=being, target.id=child)
 *   - credential-attach   self-stamped on the CREATOR's reel
 *                         (target.kind=being, target.id=creator),
 *                         with `result.targetBeingId === child`
 *
 * The latest of the two (by Fact.date — wall-clock at seal) decides
 * current state. There is no global per-reel seq, so cross-reel
 * ordering uses the seal wall-clock; the two acts are not racing
 * (attach is creator-only and gated on a prior detach), so the
 * dates totally order in practice.
 *
 * When the child has no creator (the I-Am) we short-circuit false —
 * the I-Am cannot detach from anyone.
 */
export async function isDetachedFromCreator(beingId) {
  if (!beingId) return false;
  const childId = String(beingId);
  const creatorId = await findCreatorOf(childId);

  const detachQuery = Fact.findOne({
    "target.kind": "being",
    "target.id": childId,
    verb: "do",
    action: "credential-detach",
  })
    .sort({ seq: -1, date: -1 })
    .select("date")
    .lean();

  const attachQuery = creatorId
    ? Fact.findOne({
        "target.kind": "being",
        "target.id": String(creatorId),
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
 *   self        → yes, always
 *   creator    → yes, unless target has detached and not re-attached
 *   anyone else → no
 *
 * Authority is direct-lineage only, not transitive. The I-Am has no
 * special override; cherub's children answer to cherub, not the I-Am.
 * "Becoming independent" must mean something, and that only works if
 * there is exactly one authority above me, not a chain of them.
 */
export async function hasCredentialAuthority(askerBeingId, targetBeingId) {
  if (!askerBeingId || !targetBeingId) return false;
  if (String(askerBeingId) === String(targetBeingId)) return true;
  const creatorId = await findCreatorOf(targetBeingId);
  if (!creatorId || String(creatorId) !== String(askerBeingId)) return false;
  const detached = await isDetachedFromCreator(targetBeingId);
  return !detached;
}

// Back-compat aliases. materials/being/credentialOps.js (written by a
// parallel rename pass) still imports the older names; keep them
// resolving until the rename consolidates. Remove on next sweep.
export const findSummonerOf = findCreatorOf;
export const isDetachedFromSummoner = isDetachedFromCreator;
