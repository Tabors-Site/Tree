// TreeOS IBP . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// IBP wire events.
//
// One event name, both directions, envelope-discriminated.
//
//   Client → server (request):
//     { id, verb: "see"|"do"|"summon"|"be", address, payload }
//
//   Server → client push:
//     { verb: "see"|"summon", address?, payload }
//
// Four request verbs. Two push verbs (the seed-side directions
// for which the server reaches out unprompted). No fifth surface.
//
// Push payload shapes:
//
//   verb: "see"     → { kind: "patch"|"replace"|"invalidate",
//                       spaceId, data }
//
//   verb: "call"  → an inbox-shaped entry. Unsolicited SUMMONs
//                     and SUMMON-replies share this shape:
//                       { from, content, correlation, inReplyTo?,
//                         actId?, sentAt, ... }
//                     Transport-act results (DO/BE moments triggered
//                     by the receiving being's own transport) also
//                     push through this envelope. The payload adds:
//                       { result, actId, correlation, inReplyTo:
//                         <originating correlation> }
//                     The client matches on `correlation` to resolve
//                     its awaiter; unmatched summons fall through to
//                     the inbox handler.

export { IBP_EVENT } from "../../seed/ibp/pushChannel.js";

/**
 * SEE push payload kinds. Used inside the `ibp` envelope when verb=see
 * and the server is pushing a live-subscription update.
 */
export const SEE_PUSH = Object.freeze({
  PATCH:      "patch",
  REPLACE:    "replace",
  INVALIDATE: "invalidate",
  // Skinny per-being position delta. Payload shape:
  //   { spaceId, beingId, x, y, z?, lastMoveSeq }
  // Fired by the PositionProjection fold after the row commits, so
  // the value is the projection's truth (post-bump if reducers
  // ever apply one), not the fact's raw params. Clients order by
  // lastMoveSeq and discard stale deliveries.
  POSITION:   "position",
  // Rung-3 fact-arrival push. Payload shape:
  //   { spaceId, data: { targetKind, targetId, action } }
  // Fired by the cross-cutting fold handler when any do:* fact lands
  // on a being or matter, so portals can drive their per-character
  // THREE.AnimationMixer + Web Audio renderers off the fact stream.
  // Body is minimal . the portal looks the action up against the
  // target entity's cached qualities.render block.
  FACT:       "fact",
  // Per-stance inner-face refold push. Payload shape:
  //   { kind: "inner-face", face }
  // Fired by the innerFaceLive registry after a reel that the
  // subscription's weave indexes received a fact. The face is the
  // freshly-folded canonical inner face (orientation, able, position,
  // capabilities, blocks, weave, origin). Reuses the existing SEE
  // envelope so the portal client routes through its standard
  // SEE-event path. See protocols/ibp/innerFaceLive.js.
  INNER_FACE: "inner-face",
});

/**
 * Build a server→client SUMMON push envelope for a transport-act
 * moment-result. The result and actId land alongside the standard
 * SUMMON entry shape so the client can route by correlation.
 *
 * @param {object} opts
 * @param {string} opts.correlation   — the moment's correlation; matches what the wire acked
 * @param {string} [opts.inReplyTo]   — defaults to correlation (self-reply)
 * @param {string|null} [opts.actId]
 * @param {any}    opts.result        — the verb's raw return (or { error } shape on failure)
 * @param {string} [opts.from]        — sender stance; defaults to "system"
 */
export function buildTransportActReply({ correlation, inReplyTo, actId = null, result, from = "system" }) {
  return {
    verb: "call",
    payload: {
      from,
      correlation,
      inReplyTo:   inReplyTo || correlation,
      actId,
      sentAt:      new Date().toISOString(),
      result,
    },
  };
}
