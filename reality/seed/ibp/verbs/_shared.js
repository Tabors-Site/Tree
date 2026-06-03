// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// _shared.js — caller-shape gates the four verb files share.
//
// Every public verb runs through assertVerbCaller as its first line:
// it refuses calls that have no identity and no scaffold flag,
// pointing the caller back at how to call the verb properly. The
// stack-walk picks the actual offending site, not assertVerbCaller
// or the verb itself, so log lines tell the truth.
//
// Kept private to verbs/. External callers don't reach in here.

import log from "../../seedReality/log.js";
import { IbpError, IBP_ERR } from "../protocol.js";

/**
 * Caller-shape gate. Throws if the call shape isn't one of:
 *   - an identified being (opts.identity present), OR
 *   - a seed-scaffold call (opts.scaffold === true), OR
 *   - the unauthenticated SEE path (assertVerbCaller is not called there).
 *
 * The two refusal cases get distinct error codes so the caller knows
 * whether the right-stance plant path or the left-stance identity
 * gate fired.
 */
export function assertVerbCaller(verb, opts) {
  if (opts.identity) return;
  if (opts.scaffold === true) return;

  const frame = captureCallerFrame();

  // Caller claimed the right-stance plant path but `scaffold` is not true.
  if ("scaffold" in opts) {
    log.warn("Verbs",
      `place.${verb}: not a seed verb (right stance requires scaffold: true) (caller: ${frame})`);
    throw new IbpError(
      IBP_ERR.NOT_A_SEED,
      `place.${verb}: not a seed verb (right stance requires scaffold: true for seed planting / first-boot bootstrap)`,
    );
  }

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
