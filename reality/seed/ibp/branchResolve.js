// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// The ONE shared target-branch precedence. PORT-NOTES #10: authorize()
// (which branch's grants gate the act) and the verb layer's
// resolveBranchForFact (which branch a fact stamps on) each had their
// own precedence chain. They agreed in practice, but nothing forced
// them to — a divergence would gate an act by branch A's roles while
// stamping its facts into branch B. This is the single primitive both
// call, so the two questions can never resolve to different worlds.
//
// The precedence, highest first:
//   1. target.branch          — the parsed target already carries a world
//   2. summonCtx.targetBranch  — the moment resolved the addressee's branch
//   3. summonCtx.actorAct.branch — the acting moment's own world
//   4. currentBranch           — the caller's seated branch (socket stance)
//
// Returns the first non-empty string, or null when none is present.
// Each caller owns the NULL case: the verb layer throws MISSING_BRANCH
// (a perimeter threading bug for authenticated callers), authorize
// falls anonymous callers to the operator's default branch. Keeping
// the null-tails at the call sites is deliberate — the precedence is
// shared; the policy for "branch truly absent" is caller-specific.

function nonEmpty(s) {
  return typeof s === "string" && s.length > 0 ? s : null;
}

/**
 * @param {object} args
 * @param {{branch?: string}|null} [args.target]   parsed target (may carry a branch)
 * @param {{targetBranch?: string, actorAct?: {branch?: string}}|null} [args.summonCtx]
 * @param {string|null} [args.currentBranch]       caller's seated branch
 * @returns {string|null}  the resolved target branch, or null if none present
 */
export function resolveTargetBranch({ target, summonCtx, currentBranch } = {}) {
  return (
    nonEmpty(target?.branch) ||
    nonEmpty(summonCtx?.targetBranch) ||
    nonEmpty(summonCtx?.actorAct?.branch) ||
    nonEmpty(currentBranch) ||
    null
  );
}
