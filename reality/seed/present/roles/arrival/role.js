// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// arrival. The role every unauthenticated visitor carries.
//
// A place's arrival being is the shared stance for callers who have
// not yet authenticated. Multiple visitors use it concurrently —
// SEE bypasses the scheduler (synchronous fold, no Act, no per-being
// serial gate), so there is no contention. The being is one real
// row at `<reality>/@arrival`; the address grammar resolves it like
// any other delegate.
//
// What arrival CAN do: SEE on whatever's marked public at the place
// root (the default SEE permission admits arrival). Per-position
// rules at private trees can restrict the SEE walk; the same
// stance-authorization layer that gates every other being applies.
//
// What arrival CANNOT do: DO, SUMMON, BE (except the bootstrap
// register/claim exception). Under roles-are-auth (seed/RolesAreAuth.md)
// the arrival role's canX list IS the gate; canBe: ["birth", "connect",
// "release"] is the only BE surface anonymous callers reach.
//
// Cognition: scripted, no-op. Arrival doesn't receive SUMMONs (no
// triggerOn entry for "message"). The role exists as the receptive
// label for the @arrival stance, not as a being that processes
// inbox traffic.

export const arrivalRole = Object.freeze({
  name: "arrival",
  description:
    "The shared stance every unauthenticated visitor carries. SEE-only; one being row, many concurrent users.",
  // The implicit floor for stateless callers. Hosted on the reality
  // root; reach extended reality-wide so anonymous visitors can SEE
  // public spaces and BE birth/connect anywhere registration's
  // exposed.
  reach: ["/**"],
  requiredCognition: "scripted",
  respondMode: "async",
  triggerOn: [], // never auto-processes anything

  // Anonymous visitors see ONLY the arrival-view SEE op — a filtered
  // landing face that exposes the reality root's layout + cherub.
  // Raw position SEE refuses (permitsSee requires "*" for bare
  // addresses, which only the human/angel roles carry).
  canSee: ["arrival-view"],

  // The doctrinal path for an anonymous visitor: summon @cherub:mate.
  // Cherub mints the new being (with the human role + the visitor's
  // chosen password) and binds the session. The visitor RECEIVES the
  // new being as their own.
  //
  // The summon → mate path replaces the legacy be:birth-on-cherub
  // flow. canBe stays for now because the existing cherub handlers
  // still drive registration through BE ops; that handler work
  // migrates to the summon:mate path (see birther's canSummon
  // receiver entry for the symmetric shape).
  canSummon: [
    {
      pattern: "@cherub",
      intent: "mate",
      as: "actor",
      description: "Request cherub to mint a new being and bind it to the session",
    },
  ],

  // Legacy direct-BE registration. Retires when cherub's summon:mate
  // handler is wired and the portal calls summon @cherub:mate instead
  // of be:birth.
  canBe: ["birth", "connect", "release"],
  /**
   * No-op. Arrival doesn't receive SUMMONs (no "message" in triggerOn);
   * this handler exists only so the role has a callable summon when
   * effective cognition resolves to "scripted". If something ever does
   * SUMMON @arrival, the moment releases with no Act per the Round 5
   * seal-gate (no cognition → no act → no seal).
   */
  async summon(_message, _ctx) {
    return null;
  },
});