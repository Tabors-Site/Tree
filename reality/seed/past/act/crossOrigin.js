// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// crossOrigin and the actor-act helpers — the single points where
// the actor's identity tuple is read off a moment context.
//
// Terminology (see CROSS-WORLD.md):
//   reality  — the substrate domain (e.g. tabors.site)
//   world    — a reality + branch (e.g. tabors.site#0)
//   place    — a world + position (e.g. tabors.site#0/home)
//
// An Act records the actor's identity tuple { reality, branch,
// through, _id }. moment.actorAct points to it. Every downstream
// consumer reads identity through these helpers — no direct legacy
// `moment.branch` reads (the retired path; throw hard).
//
// A Fact targets a reel that lives in some world (reality+branch).
// The Fact carries a `crossOrigin` block in its params iff the
// Fact's target world differs from the Act's actor world. The block
// carries the Act's full identity tuple so the receiving substrate
// can audit and gate the foreign-origin fact.
//
// Same-world Acts produce Facts without crossOrigin — that's the
// local case, which today covers every Fact (cross-world dispatch is
// being built). The helper handles both uniformly.

/**
 * Read the actor's branch off a moment. Throws hard if actorAct
 * is missing — no silent main-bias, no fallback. Use at every site
 * that needs the moment's branch.
 */
export function actorBranchFrom(moment, hint) {
  const branch = moment?.actorAct?.branch;
  if (typeof branch !== "string" || !branch.length) {
    throw new Error(
      `actorBranchFrom: moment.actorAct.branch missing${hint ? ` (${hint})` : ""}. ` +
      `Every moment opener (planActRow, withIAmAct, withBeingAct) must seat the Act on the ctx.`
    );
  }
  return branch;
}

/**
 * Read the actor's reality off a moment. Same contract as
 * actorBranchFrom.
 */
export function actorRealityFrom(moment, hint) {
  const reality = moment?.actorAct?.reality;
  if (typeof reality !== "string" || !reality.length) {
    throw new Error(
      `actorRealityFrom: moment.actorAct.reality missing${hint ? ` (${hint})` : ""}.`
    );
  }
  return reality;
}

/**
 * Compute the crossOrigin block for a Fact given the Act that
 * produced it and the target the Fact lands on. Returns null when the
 * Fact stays in the actor's home world (no provenance block needed).
 *
 * @param {object} actorAct  the Act row (must carry reality + branch
 *                           + through + _id).
 * @param {object} target    { world: { reality, branch } } the
 *                           resolved world of the Fact's target reel.
 * @returns {object|null}    { reality, branch, beingId, actId, ... }
 *                           when cross-world; null otherwise.
 */
export function deriveCrossOrigin(actorAct, target) {
  if (!actorAct || !target) return null;
  const actorReality = actorAct.reality;
  const actorBranch  = actorAct.branch;
  const targetReality = target?.world?.reality;
  const targetBranch  = target?.world?.branch;
  if (!actorReality || !actorBranch || !targetReality || !targetBranch) {
    return null;
  }
  if (actorReality === targetReality && actorBranch === targetBranch) {
    return null;  // same world; no foreign provenance
  }
  return {
    // null when cross-branch within the same reality; the foreign
    // domain when cross-reality. Receiving substrate consumes both
    // shapes uniformly.
    reality: actorReality === targetReality ? null : actorReality,
    branch:  actorBranch,
    // beingId = the POSITION the act came through (stays the dedupe key with
    // actId). nameId = the SIGNER-of-record (the foreign actor's name), so a
    // foreign father's facts attribute to HIS name, not the vessel's owner.
    beingId: actorAct.through,
    nameId:  actorAct.by ?? null,
    actId:   actorAct._id,
  };
}
