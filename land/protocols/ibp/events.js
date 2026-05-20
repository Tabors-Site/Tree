// TreeOS IBP . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// IBP wire events.
//
// The wire principle (see [[project_ibp_wire_shape]],
// [[project_seed_four_verbs_only]], [[project_ibp_summon_unified_event]]):
//
//   one event name, both directions, envelope-discriminated.
//
// Every IBP message — client → server, server → client — rides the
// single socket event `IBP_EVENT`. Direction is implicit (who emitted).
// What the envelope carries is implicit in `verb` + payload shape:
//
//   Client → server (request):
//     { id, verb: "see"|"do"|"summon"|"be", address, payload }
//
//   Server → client push (async reply or live update):
//     { verb: "see"|"summon", address?, payload }
//
// No `*:reply`, no `*:update`, no per-shape event names. The client
// listens once on IBP_EVENT and routes by envelope.verb +
// payload.kind. Same on the server side, dispatchIbp routes by verb.
//
// Push payload kinds for the two server-push verbs:
//
//   verb: "summon"  → payload is a SUMMON inbox entry (the reply or
//                     out-of-band SUMMON delivered to the being's room):
//                     { from, to, content, intent, correlation,
//                       inReplyTo?, sentAt, ... }
//
//   verb: "see"     → payload is a live-update envelope keyed by `kind`:
//                     { kind: "patch"|"replace"|"invalidate",
//                       spaceId, data }
//                     `data` carries the descriptor delta (patch) or the
//                     full descriptor (replace) or just the reason
//                     (invalidate).

// The wire event name lives in seed/ibp/pushChannel.js (the seed-side
// wire boundary). Re-exported here so protocol-side adapters that own
// the receive end can speak of `IBP_EVENT` symmetrically with seed-side
// pushers, without seed having to import from protocols.
export { IBP_EVENT } from "../../seed/ibp/pushChannel.js";

/**
 * SEE push payload kinds. Used inside the `ibp` envelope when verb=see
 * and the server is pushing a live-subscription update.
 */
export const SEE_PUSH = Object.freeze({
  PATCH:      "patch",
  REPLACE:    "replace",
  INVALIDATE: "invalidate",
});
