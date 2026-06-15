// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// orientation.js — the fold's orientation parameter.
//
// MODEL.md / INNER-FOLD.md: every moment carries an orientation. The
// fold signature is Φ = Fold(b, R_scope, ω). Orientation determines
// what R_scope reaches; it does not change the fold operation itself.
//
//   forward — the default. Folds the world: b's own reel (as world-
//             history) + space + matter reels in scope. The act-chain
//             A_b is NOT in scope.
//
//   inward  — full reflection. Folds only A_b, in act-order. The
//             world drops out. The face is the being's own line of
//             deeds.
//
//   half    — associative reflection. Folds the forward world PLUS
//             a selected slice of A_b — past acts of this being that
//             stitched a reel of an entity currently changing in
//             the forward face. Recall by causal adjacency.
//
// A being shifts orientation by SELF-SUMMONing with a new orientation.
// The shift seals one fact (be:summon on the being's own reel) and
// touches no other reel — an inner act. The next moment loads with
// the new orientation carried on the summon's params.
//
// External summons (from another being, transport-act, scheduled
// wakes, intake) always carry FORWARD. Only self-summons may carry
// half or inward.

export const ORIENTATION = Object.freeze({
  FORWARD: "forward",
  HALF:    "half",
  INWARD:  "inward",
});

export const ORIENTATIONS = Object.freeze([
  ORIENTATION.FORWARD,
  ORIENTATION.HALF,
  ORIENTATION.INWARD,
]);

/**
 * Validate an orientation string. Returns the normalized value, or
 * throws if the input is anything other than one of the three.
 *
 * Use this at every plumbing point — the SUMMON validator, the
 * be:summon Fact handler, the InboxProjection writer — so an
 * unknown value can never reach the fold.
 */
export function validateOrientation(value, fallback = ORIENTATION.FORWARD) {
  if (value == null) return fallback;
  if (typeof value !== "string") {
    throw new Error(
      `orientation must be a string (got ${typeof value})`,
    );
  }
  if (!ORIENTATIONS.includes(value)) {
    throw new Error(
      `orientation must be one of ${ORIENTATIONS.join("|")} (got "${value}")`,
    );
  }
  return value;
}

/**
 * The default orientation every external summon carries. Forward.
 * Only self-summons may set this otherwise.
 */
export const DEFAULT_ORIENTATION = ORIENTATION.FORWARD;

// ─────────────────────────────────────────────────────────────────────
// INNER vs OUTER act classifier (INNER-FOLD §5).
// ─────────────────────────────────────────────────────────────────────
//
// An act is **inner** when its ΔF lands only on the doer's own reel.
// An act is **outer** when its ΔF touches any other reel (space,
// matter, another being). This is just single-writer read as a
// classifier — no new primitive, no new category. Every act is
// inner or outer by where its facts land.
//
//   Inner:  ∀ f ∈ ΔF : target(f).kind = "being" ∧ target(f).id = doer
//   Outer:  ∃ f ∈ ΔF : target(f).kind ≠ "being" ∨ target(f).id ≠ doer
//
// Examples:
//   - self-summon (turn): one summon fact, target=self/being.
//     INNER — the canonical inner act (target.id === actor).
//   - DO create matter: do:create fact, target=matter/<newId>.
//     OUTER — touched another reel.
//   - SUMMON another being: verb=summon, target=recipient/being.
//     OUTER — target.id !== actor; the right-stance target IS the
//     recipient, so the general target check catches it. SUMMON
//     joined DO in stamping its target with the right stance on
//     2026-06-03; before then it stamped target=doer and the
//     classifier had to read params.recipient as a special case.

export const ACT_KIND = Object.freeze({
  INNER: "inner",
  OUTER: "outer",
});

/**
 * Classify an in-memory ΔF as inner or outer for a given doer.
 *
 * Returns "inner" only when every fact's target is the doer being.
 * The general target check covers all three stamping verbs uniformly
 * now that SUMMON stamps target=recipient (right stance) like DO
 * stamps target=thing-acted-upon. A self-summon has target.id===doer
 * and is INNER; a cross-being summon has target.id!==doer and is
 * OUTER. No verb-specific special case needed.
 *
 * @param {Array<object>} deltaF  fact specs (logFact shape)
 * @param {string}        doerId  the acting being's id
 * @returns {"inner" | "outer"}
 */
export function classifyDeltaF(deltaF, doerId) {
  if (!Array.isArray(deltaF) || deltaF.length === 0) return ACT_KIND.INNER;
  const doer = String(doerId);
  for (const f of deltaF) {
    const target = f?.target;
    // Any non-being target is outer (space, matter, place, stance).
    if (target?.kind && target.kind !== "being") return ACT_KIND.OUTER;
    // Any being target other than the doer is outer.
    if (target?.id && String(target.id) !== doer) return ACT_KIND.OUTER;
  }
  return ACT_KIND.INNER;
}

/**
 * Classify a committed Act row by reading its facts from Mongo.
 *
 * @param {string} actId
 * @param {string} doerId  the being who acted (Act.beingOut typically)
 * @param {object} [opts]
 * @param {object} [opts.FactModel]  inject for tests
 * @returns {Promise<"inner" | "outer">}
 */
export async function classifyActById(actId, doerId, opts = {}) {
  const FactModel = opts.FactModel
    || (await import("../../../past/fact/fact.js")).default;
  const facts = await FactModel.find({ actId: String(actId) })
    .select("verb action target params")
    .lean();
  return classifyDeltaF(facts, doerId);
}
