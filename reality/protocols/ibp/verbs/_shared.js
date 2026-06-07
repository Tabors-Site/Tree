// TreeOS IBP wire helpers shared across DO / BE / SUMMON verb adapters.
//
// The wire adapters do parsing + perimeter gates (impersonation,
// cross-branch) before forwarding to the seed-side dispatcher. Each
// gate had three identical copies in be.js / do.js / summon.js; that
// fan-out is consolidated here. See `seed/ibp/authorize.js` for the
// substrate-side gate; this file owns the pre-authorize wire checks.

import { IbpError, IBP_ERR } from "../../../seed/ibp/protocol.js";

/**
 * Impersonation refusal at the wire boundary.
 *
 * The address IS the identity (Diff A doctrine). When the caller
 * types an explicit left stance with an @being qualifier, the
 * resolved beingId must match the authenticated socket. No current
 * caller types left stances, so this gate is a no-op today . it's
 * the wire-side enforcement that becomes load-bearing when cross-
 * reality addressing lands (see FEDERATION.md, Diff B).
 *
 * BE arrival flows (birth / connect from no identity) legitimately
 * have socket.beingId === null. The check only fires when BOTH sides
 * carry a beingId, so arrival-cherub flows pass through unaffected.
 *
 * @param {object} expanded   expand() output with .left.beingId / .being
 * @param {object} socket     socket.io socket carrying .beingId
 * @throws {IbpError} FORBIDDEN when left.beingId mismatches socket.beingId
 */
export function assertNoImpersonation(expanded, socket) {
  if (
    expanded?.left?.beingId &&
    socket?.beingId &&
    expanded.left.beingId !== socket.beingId
  ) {
    throw new IbpError(
      IBP_ERR.FORBIDDEN,
      `Address actor (@${expanded.left.being}) does not match ` +
      `authenticated being. Caller cannot impersonate.`,
      {
        addressBeingId: expanded.left.beingId,
        socketBeingId:  socket.beingId,
      },
    );
  }
}
