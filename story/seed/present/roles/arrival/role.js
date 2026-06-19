// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// arrival. The role every unauthenticated visitor carries.
//
// A place's arrival being is the shared stance for callers who have
// not yet authenticated. Multiple visitors use it concurrently —
// SEE bypasses the scheduler (synchronous fold, no Act, no per-being
// serial gate), so there is no contention. The being is one real
// row at `<story>/@arrival`; the address grammar resolves it like
// any other delegate.
//
// What arrival CAN do: SEE on whatever's marked public at the place
// root (the default SEE permission admits arrival). Per-position
// rules at private trees can restrict the SEE walk; the same
// stance-authorization layer that gates every other being applies.
//
// What arrival CANNOT do: DO, SUMMON, BE (except the bootstrap
// register/claim exception). Under roles-are-auth (seed/RolesAreAuth.md)
// the arrival role's `can` list IS the gate; the be:birth/connect/release
// entries are the only BE surface anonymous callers reach.
//
// Cognition: scripted, no-op. Arrival doesn't receive SUMMONs (no
// triggerOn entry for "message"). The role exists as the receptive
// label for the @arrival stance, not as a being that processes
// inbox traffic.

export const arrivalRole = Object.freeze({
  name: "arrival",
  description:
    "The shared stance every unauthenticated visitor carries. SEE-only; one being row, many concurrent users.",
  // The implicit floor for stateless callers. Hosted on the story
  // root; reach extended story-wide so anonymous visitors can SEE
  // public spaces and BE birth/connect anywhere registration's
  // exposed.
  reach: ["/**"],
  requiredCognition: "scripted",
  respondMode: "async",
  triggerOn: [], // never auto-processes anything

  // The unified capability gate. Order: see, then do, then summon,
  // then be.
  //
  // see: Anonymous visitors see ONLY the arrival-view SEE op — a
  // filtered landing face that exposes the story root's layout +
  // cherub. Raw position SEE refuses (permitsSee requires "*" for bare
  // addresses, which only the human/angel roles carry).
  //
  // summon: The doctrinal path for an anonymous visitor is summon
  // @cherub:mate. Cherub mints the new being (with the human role and
  // the visitor's chosen password) and binds the session. The visitor
  // RECEIVES the new being as their own. The summon → mate path
  // replaces the legacy be:birth-on-cherub flow. The be entries stay
  // for now because the existing cherub handlers still drive
  // registration through BE ops; that handler work migrates to the
  // summon:mate path (see birther's summon receiver entry for the
  // symmetric shape).
  //
  // be: Legacy direct-BE registration. Retires when cherub's
  // summon:mate handler is wired and the portal calls summon
  // @cherub:mate instead of be:birth.
  can: [
    { verb: "see", word: "arrival-view" },
    {
      verb: "call",
      word: "@cherub",
      intent: "mate",
      as: "actor",
      description: "Request cherub to mint a new being and bind it to the session",
    },
    {
      verb: "call",
      word: "@federation-manager",
      description: "Initiate or respond to a federation negotiation. Open to all callers, including canopy verified foreign federation managers from peer realities, so push and pull negotiations can start without prior grant. The federation manager's own handler decides what to do with the offer.",
    },
    { verb: "be", word: "birth" },
    { verb: "be", word: "connect" },
    { verb: "be", word: "release" },
  ],
  /**
   * No-op. Arrival doesn't receive SUMMONs (no "message" in triggerOn);
   * this handler exists only so the role has a callable summon when
   * effective cognition resolves to "scripted". If something ever does
   * SUMMON @arrival, the moment releases with no Act per the Round 5
   * seal-gate (no cognition → no act → no seal).
   */
  async call(_message, _ctx) {
    return null;
  },
});