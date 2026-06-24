// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// _shared.js — caller-shape gates the four verb files share.
//
// Every public verb runs through assertVerbCaller as its first line:
// it refuses calls that have no identity, pointing the caller back at
// how to call the verb properly. The stack-walk picks the actual
// offending site, not assertVerbCaller or the verb itself, so log
// lines tell the truth.
//
// Doctrine: everything acts through a being. There is no "scaffold"
// path that acts without one. Seed-internal calls that used to pass
// `scaffold: true` now pass `identity: I` (the I-Am acting as
// itself); authorize() short-circuits on I without a DB read, so
// genesis and runtime use the same one-path entry.
//
// Kept private to verbs/. External callers don't reach in here.

import log from "../../seedStory/log.js";
import { IbpError, IBP_ERR } from "../protocol.js";
import { resolveTargetHistory } from "../historyResolve.js";

/**
 * Normalize an identity input. Callers may pass a bare string (a
 * beingId — typically `I` for seed-internal calls) OR a full
 * `{ beingId, name }` object. This returns the object form so
 * downstream code can read `identity.beingId` / `identity.name`
 * uniformly without branching on input shape.
 *
 * Idempotent: passing an object back through returns the same object.
 * Null / undefined / empty string returns null.
 *
 * Public so internal entry points beyond the four verbs
 * (callByResolved, birthBeing, etc.) can call it too.
 */
export function normalizeIdentity(identity) {
  if (typeof identity === "string") {
    return identity.length > 0 ? { beingId: identity, name: identity } : null;
  }
  return identity || null;
}

/**
 * Caller-shape gate. Throws if the call has no identity.
 *
 * Every verb call rides a being. Seed-internal flows that used to
 * pass `scaffold: true` now thread `identity: I`; the
 * unauthenticated SEE path does not call this function. So a missing
 * identity here is always a perimeter threading bug.
 *
 * Normalizes the bare-string identity shorthand in story on `opts`.
 */
export function assertVerbCaller(verb, opts) {
  if (typeof opts.identity === "string") {
    opts.identity = normalizeIdentity(opts.identity);
  }
  if (opts.identity) return;

  const frame = captureCallerFrame();
  log.warn(
    "Verbs",
    `story.${verb}: not a being verb (left stance requires identity) (caller: ${frame})`,
  );
  throw new IbpError(
    IBP_ERR.NOT_A_BEING,
    `story.${verb}: not a being verb (left stance requires identity)`,
  );
}

/**
 * Historical-read doctrine gate. SEE accepts an `at: { atSeq?,
 * atTimestamp? }` qualifier that returns the substrate's state as
 * of a past point. The verbs of CHANGE — DO, SUMMON, BE — are not
 * compatible with a frozen view; acting in the past is structurally
 * impossible.
 *
 * Each write verb calls this with its `target` and `opts` at the top
 * of its entry function. If `at` is present anywhere it could ride
 * the wire (opts.at, or `target.at` when target is an object), this
 * throws HISTORICAL_READ_ONLY with the specific actionable message
 * the doctrine line names.
 */
export function refuseHistoricalWrite(verb, target, opts) {
  const fromOpts = opts && typeof opts === "object" ? opts.at : null;
  const fromTarget = target && typeof target === "object" ? target.at : null;
  if (fromOpts == null && fromTarget == null) return;
  throw new IbpError(
    IBP_ERR.HISTORICAL_READ_ONLY,
    `story.${verb}: Historical reads cannot include write verbs. ` +
      `SEE with at: is allowed; DO/SUMMON/BE are not. ` +
      `To act, omit at: and operate on current state.`,
  );
}

/**
 * Resolve which history a write-verb's Fact lands on. The Fact lives
 * at the TARGET's world; the actor's world is on moment.actorAct.
 * When they differ, the call is cross-world and emitFact attaches a
 * crossOrigin block automatically. See CROSS-WORLD.md.
 *
 * Precedence — the moment is ground truth:
 *
 *   1. moment.targetHistory — the moment-wide target history
 *      seated by assign.js from the inbox entry's targetHistory.
 *      For same-world moments this equals actorAct.history.
 *   2. moment.actorAct.history — the actor's history. The
 *      same-world fallback for in-moment continuations without an
 *      explicit target attachment (scaffolds, manifest sync, etc.,
 *      which operate on the actor's own world by construction).
 *   3. opts.currentHistory — explicit per-call attachment for
 *      PRE-MOMENT callers (the wire layer before a moment opens,
 *      schedulers, bootstraps). Inside a moment the seated histories
 *      above win; an opts side-channel must not re-point a moment
 *      that was opened against a specific world.
 *
 * None present is a perimeter bug — throws so the missing-attachment
 * surfaces immediately at the offending call site. No silent "0".
 */
export function resolveHistoryForFact(moment, currentHistory, verb) {
  // Shared precedence (PORT-NOTES #10). Fact emission carries no parsed
  // `target` here, so the chain reduces to moment.targetHistory →
  // actorAct.history → currentHistory — identical to before.
  const resolved = resolveTargetHistory({ moment, currentHistory });
  if (resolved) return resolved;
  // Caller-specific null tail: a missing history at the verb perimeter
  // is a threading bug — fail loud.
  const frame = captureCallerFrame();
  throw new IbpError(
    IBP_ERR.MISSING_BRANCH || "MISSING_BRANCH",
    `story.${verb}: history missing at the perimeter (none of ` +
      `opts.currentHistory, moment.targetHistory, or moment.actorAct.history ` +
      `was attached). The wire layer must thread the target's history into the ` +
      `verb opts. (caller: ${frame})`,
  );
}

/**
 * Walk past frames inside verbs/ so the reported caller is the actual
 * offending site, not assertVerbCaller or the verb function itself.
 */
function captureCallerFrame() {
  const stack = new Error().stack;
  if (!stack) return "<unknown>";
  const lines = stack.split("\n");
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (line && !line.includes("/seed/ibp/verbs/")) {
      return line.trim();
    }
  }
  return "<unknown>";
}
