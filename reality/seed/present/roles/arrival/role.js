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
// register/claim exception inside the cherub being). The default
// permissions still require `arrival: false` for DO/SUMMON/BE, and
// arrival's stance carries the arrival flag (per
// stanceProperties.js ARRIVAL_PROPS).
//
// Cognition: scripted, no-op. Arrival doesn't receive SUMMONs (no
// triggerOn entry for "message"). The role exists as the receptive
// label for the @arrival stance, not as a being that processes
// inbox traffic.

export const arrivalRole = Object.freeze({
  name: "arrival",
  description:
    "The shared stance every unauthenticated visitor carries. SEE-only; one being row, many concurrent users.",
  // The implicit floor for stateless callers. Reality-wide reach by
  // definition — arrival is what every visitor carries before
  // authenticating, regardless of position.
  scope: "global",
  requiredCognition: "scripted",
  permissions: ["see"],
  respondMode: "async",
  triggerOn: [], // never auto-processes anything
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