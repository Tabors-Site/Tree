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
// `scaffold: true` now pass `identity: I_AM` (the I-Am acting as
// itself); authorize() short-circuits on I_AM without a DB read, so
// genesis and runtime use the same one-path entry.
//
// Kept private to verbs/. External callers don't reach in here.

import log from "../../seedReality/log.js";
import { IbpError, IBP_ERR } from "../protocol.js";

/**
 * Normalize an identity input. Callers may pass a bare string (a
 * beingId — typically `I_AM` for seed-internal calls) OR a full
 * `{ beingId, name }` object. This returns the object form so
 * downstream code can read `identity.beingId` / `identity.name`
 * uniformly without branching on input shape.
 *
 * Idempotent: passing an object back through returns the same object.
 * Null / undefined / empty string returns null.
 *
 * Public so internal entry points beyond the four verbs
 * (summonByResolved, birthBeing, etc.) can call it too.
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
 * pass `scaffold: true` now thread `identity: I_AM`; the
 * unauthenticated SEE path does not call this function. So a missing
 * identity here is always a perimeter threading bug.
 *
 * Normalizes the bare-string identity shorthand in place on `opts`.
 */
export function assertVerbCaller(verb, opts) {
  if (typeof opts.identity === "string") {
    opts.identity = normalizeIdentity(opts.identity);
  }
  if (opts.identity) return;

  const frame = captureCallerFrame();
  log.warn("Verbs",
    `place.${verb}: not a being verb (left stance requires identity) (caller: ${frame})`);
  throw new IbpError(
    IBP_ERR.NOT_A_BEING,
    `place.${verb}: not a being verb (left stance requires identity)`,
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
  const fromTarget = (target && typeof target === "object") ? target.at : null;
  if (fromOpts == null && fromTarget == null) return;
  throw new IbpError(
    IBP_ERR.HISTORICAL_READ_ONLY,
    `place.${verb}: Historical reads cannot include write verbs. ` +
    `SEE with at: is allowed; DO/SUMMON/BE are not. ` +
    `To act, omit at: and operate on current state.`,
  );
}

/**
 * Resolve which branch a write-verb's Fact lands on. Precedence:
 *
 *   1. summonCtx.branch — an enclosing moment is already on its branch;
 *      every Fact emitted from inside the moment inherits that branch.
 *      This is the continuation case (the moment-runner threaded it).
 *   2. currentBranch — the wire layer's explicit branch attachment for
 *      wire-originated verbs. See the protocol verb handlers
 *      (protocols/ibp/verbs/{summon,be,do}.js) — they pull branch from
 *      the parsed address (or socket.currentBranch for relative addrs)
 *      and pass it as opts.currentBranch.
 *
 * Neither present is a perimeter bug. The seed used to default to "0"
 * silently in this case, which masked "we forgot to thread branch
 * through" gaps for months. Now it throws so the missing-attachment
 * surfaces immediately at the offending call site. Branch is verified
 * at the perimeter and trusted everywhere inside.
 */
export function resolveBranchForFact(summonCtx, currentBranch, verb) {
  if (summonCtx?.branch && typeof summonCtx.branch === "string" && summonCtx.branch.length > 0) {
    return summonCtx.branch;
  }
  if (typeof currentBranch === "string" && currentBranch.length > 0) {
    return currentBranch;
  }
  const frame = captureCallerFrame();
  throw new IbpError(
    IBP_ERR.MISSING_BRANCH || "MISSING_BRANCH",
    `place.${verb}: branch missing at the perimeter (neither summonCtx.branch ` +
      `nor opts.currentBranch was attached). The wire layer must thread the ` +
      `caller's branch into the verb opts. (caller: ${frame})`,
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
