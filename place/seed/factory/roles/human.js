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
// (browser, CLI, IDE) and arrives as fresh incoming verb calls from
// their transport. The role is purely receptive: the SUMMON lands in
// the inbox, the role's summon() handler returns null (no synchronous
// act), and the entry waits there until the human chooses to respond
// by emitting their own SUMMON back.
//
// No voice apparatus. Unlike the LLM role surface (which wires
// through defaultSummon → runTurn) and unlike scripted roles (whose
// summon code IS their behavior), the human role's summon is an
// explicit no-op. There is no voices/human/ folder because there is
// no shared cognition machinery to share — humans cognize on their
// own.
//
// Cherub assigns this role to every human at register-time
// ([cherub.js](cherub.js)).

export const humanRole = Object.freeze({
  name: "human",
  description:
    "The receptive role every human being carries. Lets a human be SUMMONed; the entry sits in their inbox until they respond from their own transport.",
  permissions: ["see", "do", "summon", "be"],
  respondMode: "async",
  triggerOn: ["message"],

  /**
   * No synchronous act. A SUMMON to a human is a request; the human
   * answers in their own time by emitting a fresh verb call from their
   * transport (browser click, CLI command, IDE event). The factory has
   * nothing to dispatch on their behalf here.
   */
  async summon(_message, _ctx) {
    return null;
  },
});
