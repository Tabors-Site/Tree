// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// crossOrigin and the actor-act helpers — the single points where
// the actor's identity tuple is read off a moment context.
//
// Terminology (see CROSS-WORLD.md):
//   story  — the substrate domain (e.g. tabors.site)
//   world    — a story + history (e.g. tabors.site#0)
//   place    — a world + position (e.g. tabors.site#0/home)
//
// An Act records the actor's identity tuple { story, history,
// through, _id }. moment.actorAct points to it. Every downstream
// consumer reads identity through these helpers — no direct legacy
// `moment.history` reads (the retired path; throw hard).
//
// A Fact targets a reel that lives in some world (story+history).
// The Fact carries a `crossOrigin` block in its params iff the
// Fact's target world differs from the Act's actor world. The block
// carries the Act's full identity tuple so the receiving substrate
// can audit and gate the foreign-origin fact.
//
// Same-world Acts produce Facts without crossOrigin — that's the
// local case, which today covers every Fact (cross-world dispatch is
// being built). The helper handles both uniformly.

/**
 * Read the actor's history off a moment. Throws hard if actorAct
 * is missing — no silent main-bias, no fallback. Use at every site
 * that needs the moment's history.
 */
export function actorHistoryFrom(moment, hint) {
  const history = moment?.actorAct?.history;
  if (typeof history !== "string" || !history.length) {
    throw new Error(
      `actorHistoryFrom: moment.actorAct.history missing${hint ? ` (${hint})` : ""}. ` +
        `Every moment opener (planActRow, withIAmAct, withBeingFact) must seat the Act on the ctx.`,
    );
  }
  return history;
}

/**
 * Read the actor's story off a moment. Same contract as
 * actorHistoryFrom.
 */
export function actorStoryFrom(moment, hint) {
  const story = moment?.actorAct?.story;
  if (typeof story !== "string" || !story.length) {
    throw new Error(
      `actorStoryFrom: moment.actorAct.story missing${hint ? ` (${hint})` : ""}.`,
    );
  }
  return story;
}

/**
 * Compute the crossOrigin block for a Fact given the Act that
 * produced it and the target the Fact lands on. Returns null when the
 * Fact stays in the actor's home world (no provenance block needed).
 *
 * @param {object} actorAct  the Act row (must carry story + history
 *                           + through + _id).
 * @param {object} target    { world: { story, history } } the
 *                           resolved world of the Fact's target reel.
 * @returns {object|null}    { story, history, beingId, actId, ... }
 *                           when cross-world; null otherwise.
 */
export function deriveCrossOrigin(actorAct, target) {
  if (!actorAct || !target) return null;
  const actorStory = actorAct.story;
  const actorHistory = actorAct.history;
  const targetStory = target?.world?.story;
  const targetHistory = target?.world?.history;
  if (!actorStory || !actorHistory || !targetStory || !targetHistory) {
    return null;
  }
  if (actorStory === targetStory && actorHistory === targetHistory) {
    return null; // same world; no foreign provenance
  }
  return {
    // null when cross-history within the same story; the foreign
    // domain when cross-story. Receiving substrate consumes both
    // shapes uniformly.
    story: actorStory === targetStory ? null : actorStory,
    history: actorHistory,
    // beingId = the POSITION the act came through (stays the dedupe key with
    // actId). nameId = the SIGNER-of-record (the foreign actor's name), so a
    // foreign father's facts attribute to HIS name, not the being's owner.
    beingId: actorAct.through,
    nameId: actorAct.by ?? null,
    actId: actorAct._id,
  };
}
