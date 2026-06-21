// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// The ONE shared target-history precedence. PORT-NOTES #10: authorize()
// (which history's grants gate the act) and the verb layer's
// resolveHistoryForFact (which history a fact stamps on) each had their
// own precedence chain. They agreed in practice, but nothing forced
// them to — a divergence would gate an act by history A's roles while
// stamping its facts into history B. This is the single primitive both
// call, so the two questions can never resolve to different worlds.
//
// The precedence, highest first:
//   1. target.history         — the parsed target already carries a world
//   2. moment.targetHistory  — the moment resolved the addressee's history
//   3. moment.actorAct.history — the acting moment's own world
//   4. currentHistory           — the caller's seated history (socket stance)
//
// Returns the first non-empty string, or null when none is present.
// Each caller owns the NULL case: the verb layer throws MISSING_BRANCH
// (a perimeter threading bug for authenticated callers), authorize
// falls anonymous callers to the operator's default history. Keeping
// the null-tails at the call sites is deliberate — the precedence is
// shared; the policy for "history truly absent" is caller-specific.

function nonEmpty(s) {
  return typeof s === "string" && s.length > 0 ? s : null;
}

/**
 * @param {object} args
 * @param {{history?: string}|null} [args.target]   parsed target (may carry a history)
 * @param {{targetHistory?: string, actorAct?: {history?: string}}|null} [args.moment]
 * @param {string|null} [args.currentHistory]       caller's seated history
 * @returns {string|null}  the resolved target history, or null if none present
 */
export function resolveTargetHistory({ target, moment, currentHistory } = {}) {
  return (
    nonEmpty(target?.history) ||
    nonEmpty(moment?.targetHistory) ||
    nonEmpty(moment?.actorAct?.history) ||
    nonEmpty(currentHistory) ||
    null
  );
}
