// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// momentum.js — beat three. The being's act.
//
// moment.js orchestrates the four beats; momentum is just beat 3.
// assign minted actId and planned the Act (no Mongo write); fold
// mounts the face; momentum applies the being's motion; stamped
// seals — ONLY when momentum returned ok:true.
//
// momentum dispatches by `summonCtx.kind` — TWO SEMANTIC MODES, same
// machinery. Both kinds opened the same way (a wake-call landed in
// the being's inbox; the scheduler picked it; assign opened the
// moment). The difference is what the wake-call's payload means:
//
//   kind: "summon"  — DELIBERATION mode.
//     The wake-call carries a message; the role's summon() handler
//     reads it, thinks, decides what (if anything) to do. Most
//     summons. Return value is normalized into CognitionResult:
//     legacy `{ content: string }` → `{ ok: true, content }`; null/
//     undefined/throw → `{ ok: false, shape, reason }`. New
//     cognition paths return the discriminated form directly.
//
//   kind: "transport-act"  — EXECUTION mode.
//     The wake-call's payload is a pre-decided act, not a message
//     to deliberate on. The being already chose (the transport
//     delivered the keystroke; the being's decision was the
//     keystroke). momentum just runs the wrapped verb through
//     doVerb/beVerb from inside the being's moment so the act's
//     auto-Fact rides the moment's actId. Success → { ok: true,
//     content: "", verbResult: <verb return> }. Failure → { ok:
//     false, shape: "internal", reason }.
//
// Same primitive, two modes. The being on the inside of either
// moment can't tell, and shouldn't tell, the difference between
// "another being summoned me to think about something" and "the
// world summoned me to execute the act I already chose." Both are
// the same thing from the moment's perspective: a wake-call opened
// my moment; here I am, acting.
//
// Per Round 5: failure is structural, not disciplined. A bad
// cognition cannot reach the seal because the seal's input type
// cannot represent a failure.

import log from "../../seedReality/log.js";
import { normalizeCognitionResult, cognitionFailure } from "../cognition/cognitionResult.js";

/**
 * Beat 3: run the act. Dispatch by summonCtx.kind. Returns a
 * CognitionResult ({ ok:true, content, verbResult? } | { ok:false,
 * shape, reason }).
 *
 * Never throws — every exception path is captured and returned as
 * ok:false. moment.js's seal-gate can therefore safely branch on
 * result.ok without a try/catch wrapper at the conductor level.
 *
 * @param {object} setup       — the result of assign(...)
 * @param {object} setup.role  — the active role spec
 * @param {object} setup.summonCtx — the summon context the role expects
 * @returns {Promise<CognitionResult>}
 */
export async function momentum(setup = {}) {
  const { role, summonCtx } = setup;
  const kind = summonCtx?.kind || "summon";

  if (kind === "transport-act") {
    try {
      const verbResult = await runTransportAct(summonCtx);
      // Transport-act success: the verb ran. content is "" because
      // the act was a substrate write, not a closing utterance.
      // verbResult rides through for the handoff.
      return { kind: "act", ok: true, content: "", verbResult };
    } catch (err) {
      log.warn("Momentum", `transport-act failed: ${err.message}`);
      return cognitionFailure("internal", err.message);
    }
  }

  // Default: summon-kind. Role's summon handler dispatches.
  let raw;
  try {
    raw = await role.summon(summonCtx.message, summonCtx);
  } catch (err) {
    // Cognition threw. Per MODEL.md, this is a SEE — no act
    // produced. moment.js will not seal.
    if (summonCtx?.signal?.aborted) {
      return cognitionFailure("aborted", err.message);
    }
    log.warn("Momentum", `role.summon threw: ${err.message}`);
    return cognitionFailure("internal", err.message);
  }

  // Normalize legacy + new return shapes into CognitionResult.
  // null / undefined / non-object → { ok:false, shape:"garbage" }.
  // { content: string } → { ok:true, content }.
  // { ok: true|false, ... } → pass-through after shape validation.
  return normalizeCognitionResult(raw);
}

/**
 * Apply a transport-act payload as the being's act inside the moment.
 * The wrapped verb runs through doVerb / beVerb with summonCtx
 * threaded so the auto-Fact rides the ambient actId.
 *
 * Transport-act payloads carry { verb, target, action, args }. The
 * shape's meaning differs by verb because doVerb and beVerb have
 * different signatures:
 *
 *   verb: "do"  → doVerb(target, action, args, opts)
 *     target  = resolved position/stance object
 *     action  = DO op name ("create-space", "set-being", ...)
 *     args    = op-specific params
 *
 *   verb: "be"  → beVerb(operation, opPayload, ctx)
 *     target  = BE op name ("birth", "connect", "release")
 *     args    = { opPayload, address, addressKind, callerIdentity }
 *     action  = ignored
 *
 * SEE never reaches here — reads are synchronous folds that bypass
 * intake entirely.
 *
 * Throws on verb failure; momentum() catches and converts to
 * cognitionFailure.
 */
async function runTransportAct(summonCtx) {
  const act = summonCtx?.act;
  if (!act || typeof act !== "object") {
    throw new Error("moment: transport-act missing `act` payload");
  }
  const { verb, target, action, args } = act;
  if (verb !== "do" && verb !== "be") {
    throw new Error(`moment: transport-act verb must be "do" or "be" (got "${verb}")`);
  }

  // Lazy-import the verbs to avoid a circular import at module load.
  const { doVerb } = await import("../../ibp/verbs/do.js");
  const { beVerb } = await import("../../ibp/verbs/be.js");

  if (verb === "do") {
    return doVerb(target, action, args || {}, {
      identity:  summonCtx.identity || null,
      summonCtx: { actId: summonCtx.actId || null },
    });
  }

  // verb === "be" — cherub-as-actor path
  const { opPayload = {}, address, addressKind, callerIdentity = null } = args || {};
  return beVerb(target, opPayload, {
    address,
    addressKind,
    identity:  callerIdentity,
    summonCtx: { actId: summonCtx.actId || null },
  });
}
