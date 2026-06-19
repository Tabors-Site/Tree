// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// momentum.js — beat three. The being's act.
//
// moment.js orchestrates the four beats; momentum is just beat 3.
// assign minted actId and planned the Act (no Mongo write); fold
// mounts the face; momentum applies the being's motion; stamped
// seals — ONLY when momentum returned ok:true.
//
// momentum dispatches by `moment.kind` — TWO SEMANTIC MODES, same
// machinery. Both kinds opened the same way (a wake-call landed in
// the being's inbox; the scheduler picked it; assign opened the
// moment). The difference is what the wake-call's payload means:
//
//   kind: "call"  — DELIBERATION mode.
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
 * Beat 3: run the act. Dispatch by moment.kind. Returns a
 * CognitionResult ({ ok:true, content, verbResult? } | { ok:false,
 * shape, reason }).
 *
 * Never throws — every exception path is captured and returned as
 * ok:false. moment.js's seal-gate can therefore safely branch on
 * result.ok without a try/catch wrapper at the conductor level.
 *
 * @param {object} setup       — the result of assign(...)
 * @param {object} setup.role  — the active role spec
 * @param {object} setup.moment — the summon context the role expects
 * @returns {Promise<CognitionResult>}
 */
export async function momentum(setup = {}) {
  const { role, moment } = setup;
  const kind = moment?.kind || "call";

  if (kind === "transport-act") {
    try {
      const verbResult = await runTransportAct(moment);
      // If the transport-act's verb is a pure-read op (skipAudit on the
      // registration + no facts pushed into deltaF), the moment closes
      // as a SEE — there's nothing to seal. verbResult still rides
      // through to the handoff so the wire-caller gets its answer.
      // Without this, sealAct refuses no-fact moments and the broken
      // act-shape moment leaves the inbox row open.
      const facts = moment?.deltaF;
      if (Array.isArray(facts) && facts.length === 0) {
        return { kind: "see", ok: true, content: "", verbResult };
      }
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
  //
  // Snapshot doctrine: the scripted role reads moment.innerFace
  // (built at beat 2) ONCE and never re-reads. No reactive
  // subscription. Reels referenced by the face's weave may change
  // mid-moment; the seal path trusts the existing chain CAS + reel-
  // head locks to surface any real conflict at sealAct time. On
  // conflict the moment fails, its inbox row stays open, the
  // scheduler re-picks it up, the next pass rebuilds innerFace fresh
  // (with a fresh weave) and retries. No new conflict-check
  // machinery here . the doctrine is snapshot at fold, retry via
  // existing refold path if seal fails. Reactive subscriptions live
  // on the human portal only (see protocols/ibp/innerFaceLive).
  let raw;
  try {
    raw = await role.call(moment.message, moment);
  } catch (err) {
    // Cognition threw. Per MODEL.md, this is a SEE — no act
    // produced. moment.js will not seal.
    if (moment?.signal?.aborted) {
      return cognitionFailure("aborted", err.message);
    }
    log.warn("Momentum", `role.call threw: ${err.message}`);
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
 * The wrapped verb runs through doVerb / beVerb with moment
 * threaded so the auto-Fact rides the ambient actId.
 *
 * Transport-act payloads carry { verb, act, target, args }. `act` is
 * the operation in flight (the seal records it as fact.act); the
 * rest's meaning differs by verb because doVerb and beVerb have
 * different signatures:
 *
 *   verb: "do"  → doVerb(target, act, args, opts)
 *     act     = DO op name ("create-space", "set-being", ...)
 *     target  = resolved position/stance object
 *     args    = op-specific params
 *
 *   verb: "be"  → beVerb(act, opPayload, ctx)
 *     act     = BE op name ("birth", "connect", "release")
 *     args    = { opPayload, address, addressKind, callerIdentity }
 *
 * SEE never reaches here — reads are synchronous folds that bypass
 * intake entirely.
 *
 * Throws on verb failure; momentum() catches and converts to
 * cognitionFailure.
 */
async function runTransportAct(moment) {
  const transportAct = moment?.act;
  if (!transportAct || typeof transportAct !== "object") {
    throw new Error("moment: transport-act missing `act` payload");
  }
  const { verb, act, target, args } = transportAct;
  if (verb !== "do" && verb !== "be" && verb !== "name") {
    throw new Error(`moment: transport-act verb must be "do", "be", or "name" (got "${verb}")`);
  }

  // Lazy-import the verbs to avoid a circular import at module load.
  const { doVerb } = await import("../../ibp/verbs/do.js");
  const { beVerb } = await import("../../ibp/verbs/be.js");

  // Thread the FULL parent moment into the inner verb. The verb's
  // emitFact reads ctx.deltaF to push its Fact onto the moment's ΔF;
  // a truncated `{ actId }` would silently make emitFact fall back to
  // a sealFacts singleton, the inner Fact would self-seal, and the
  // outer Act's deltaF would stay empty — sealAct's invariant gate
  // would then refuse the Act (content:null + deltaF:[] = orphan).
  if (verb === "do") {
    return doVerb(target, act, args || {}, {
      identity:  moment.identity || null,
      moment,
    });
  }

  if (verb === "be") {
    // verb === "be" — cherub-as-actor path
    const { opPayload = {}, address, addressKind, callerIdentity = null, callerNameId = null } = args || {};
    return beVerb(act, opPayload, {
      address,
      addressKind,
      identity:  callerIdentity,
      nameId:    callerNameId,
      moment,
    });
  }

  // verb === "name" — the identity layer (declare / banish a name). `act`
  // is the op name (declare | banish); the address is reality-only
  // (<realityDomain>) or <nameId>@<realityDomain>.
  const { nameVerb } = await import("../../ibp/verbs/name.js");
  const { opPayload = {}, address, callerIdentity = null } = args || {};
  return nameVerb(act, opPayload, {
    address,
    identity: callerIdentity || moment.identity || null,
    moment,
  });
}
