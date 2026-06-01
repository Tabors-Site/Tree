// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// human. The role a human being carries to be SUMMONable.
//
// A human is a being. Beings receive SUMMONs through a role; without
// a role the SUMMON verb rejects with `ROLE_UNAVAILABLE`. The human
// role is the addressable contract every human carries so other
// beings can reach them.
//
// "Carried but not shaped by." The role doesn't define how a human
// thinks or acts — their cognition happens in their own realm
// (portal, browser, CLI, etc) and arrives as fresh incoming verb calls from
// their transport. The role is purely receptive: a SUMMON to a human
// lands in their inbox as a notification ONLY. It is not enqueued on
// the intake feed; the scheduler does not auto-process it. The human
// answers when they choose, by emitting their own verb call from
// their transport — which arrives as a "transport-act" intake entry
// through a separate path.
//
// inbox vs intake. Today (2026-05) the kernel splits these explicitly:
//
//   inbox  = messages received (mailbox; UI surfaces it)
//   intake = scheduler run-feed (moments to dispatch)
//
// LLM/scripted beings declare `triggerOn: ["message"]` so an incoming
// SUMMON populates BOTH (mailbox record + scheduler run trigger). The
// human role omits "message" — SUMMONs to humans hit inbox only. The
// human's own transport-acts populate intake only, via a wire-layer
// path that bypasses inbox entirely.
//
// No voice apparatus. Unlike the LLM role surface (which wires
// through defaultSummon → runTurn) and unlike scripted roles (whose
// summon code IS their behavior), the human role's summon is an
// explicit no-op for the SUMMON case. Their transport-acts dispatch
// the wrapped verb at momentum directly. There is no voices/human/
// folder because there is no shared cognition machinery to share —
// humans cognize on their own.
//
// Cherub assigns this role to every human at register-time
// ([cherub.js](cherub.js)).

export const humanRole = Object.freeze({
  name: "human",
  description:
    "The receptive role every human being carries. Lets a human be SUMMONed; the SUMMON sits in their inbox as a notification until they respond from their own transport.",
  permissions: ["see", "do", "summon", "be"],
  respondMode: "async",
  // No "message" trigger: humans don't auto-process incoming SUMMONs.
  // The SUMMON sits in the inbox until the human surfaces it through
  // their transport. Cognition lives on the being (qualities.cognition),
  // not the role — the same role on the same being still works whether
  // a human is driving or (when inhabit-released) something else is.
  triggerOn: [],

  // No-op summon: humans don't auto-dispatch. Present so any path that
  // does role.summon(...) doesn't crash.
  async summon(_message, _ctx) {
    return null;
  },
});