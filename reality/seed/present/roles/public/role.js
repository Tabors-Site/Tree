// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// public/role.js — the "commons" delegate.
//
// Per seed/RolesAreAuth.md "Public being": every reality ships a
// being called `public`. It's a seed delegate like cherub/birther/
// arrival, but it exists ONLY as a recipient of ownership transfers.
// You grant a space's `members.owner` slot to public, and from that
// moment the space becomes a free commons — authorize's owner-check
// sees public on the chain and admits any caller for any action.
//
// Public never acts. `can` is empty; triggerOn is empty; the summon
// handler is a permanent no-op. Public
// can't grant, can't revoke, can't author roles. That silence IS the
// permanence: there's no actor who could ever transfer a Public-owned
// space's ownership back.
//
// The single safety hatch is I-Am. I-Am holds public's own
// members.owner slot, so an angel-class operator could (in extremis)
// remove-owner on a Public-owned space. The realistic recovery for
// "we made a mistake" is to branch the timeline from before the
// public transfer happened — same shape as recovering any other
// substrate mistake.

export const publicRole = Object.freeze({
  name: "public",
  description:
    "The commons delegate. Hold a space's owner slot to make it a forever-public commons. " +
    "public never acts; the silence is the lock. Recovery is via timeline branch or, " +
    "in extremis, via I-Am as public's own owner.",
  requiredCognition: "scripted",
  respondMode: "async",
  triggerOn: [], // never auto-processes anything

  // Empty can. public CANNOT see/do/summon/be anything. The role's
  // job isn't to act — it's to be a name-shaped placeholder in
  // members.owner that authorize.owner-check recognizes.
  can: [],

  /**
   * No-op summon. Anything addressed to @public is silently dropped —
   * no Act, no Fact, no response. By design.
   */
  async summon(_message, _ctx) {
    return null;
  },
});
