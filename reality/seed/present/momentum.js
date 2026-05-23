// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// momentum.js — beat three. The being's act.
//
// moment.js orchestrates the four beats; momentum is just beat 3.
// assign opens and fold mounts the face; momentum applies the
// being's motion; stamped seals. Same shape for every moment, four
// files at this folder's root.
//
// momentum dispatches by `summonCtx.kind` — the trigger-kind the
// intake entry carried in. Every other beat (assign, fold, stamped)
// is identical regardless of kind; momentum is the one beat that
// differs because the act itself differs.
//
// Two kinds today:
//
//   kind: "summon"
//     The intake entry was a SUMMON received by the being. The role's
//     summon() runs, dispatching the being's inference (LLM voice),
//     scripted code (scripted voice), or returning null (human role
//     for the receptive path — but humans don't enqueue intake on
//     incoming SUMMONs, so this path rarely fires for kind="summon"
//     on a human).
//
//   kind: "transport-act"
//     The being acted from their own transport (portal, browser, CLI,
//     IDE). The intake entry carries a verb payload — verb + target
//     + action + args. Momentum dispatches that verb directly through
//     doVerb / beVerb, threading summonCtx so the auto-Fact picks up
//     the ambient actId opened by assign. The role isn't involved
//     at this beat — the act was already decided externally; momentum
//     just applies it inside the moment's frame.
//
// Everything past momentum speaks raw IBP verbs. SEE / DO / SUMMON /
// BE is the universal currency. momentum doesn't invent a new
// abstraction above the verbs — it dispatches and returns.

/**
 * Beat 3: run the act. Dispatch by summonCtx.kind and return what came back.
 *
 * @param {object} prepared          — the result of assign(...)
 * @param {object} prepared.role     — the active role spec
 * @param {object} prepared.summonCtx — the summon context the role expects
 *
 * @returns {Promise<{ result, role }>}
 */
export async function momentum({ role, summonCtx } = {}) {
  const kind = summonCtx?.kind || "summon";

  if (kind === "transport-act") {
    const result = await runTransportAct(summonCtx);
    return { result, role };
  }

  // Default: summon-kind. Role's summon handler dispatches.
  const result = await role.summon(summonCtx.message, summonCtx);
  return { result, role };
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
 *     action  = DO op name ("birth", "set", ...)
 *     args    = op-specific params
 *
 *   verb: "be"  → beVerb(operation, opPayload, ctx)
 *     target  = BE op name ("register", "claim", "release", "switch")
 *     args    = { opPayload, address, addressKind, callerIdentity }
 *     action  = ignored
 *
 * SEE never reaches here — reads are synchronous folds that bypass
 * intake entirely.
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

  // Lazy-import the verbs to avoid a circular import at module load
  // (verbs.js → factory/intake/scheduler.js → factory/stamper/moment.js).
  const { doVerb, beVerb } = await import("../ibp/verbs.js");

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
