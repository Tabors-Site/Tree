// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// birther. The being that mints children from authenticated callers.
//
// Cherub serves the unauthenticated arrival: someone with no identity
// yet calls BE:birth on @cherub to register a fresh being on this
// reality. The new being's being-tree parent is cherub (or I-Am for
// the first registrant). That flow is about *bringing identity into
// existence on the reality*.
//
// Birther serves the authenticated caller: someone who already IS a
// being on this reality calls BE:birth on @birther to mint a CHILD.
// The new being's being-tree parent is the CALLER, not birther. That
// flow is about *making children of yourself*. Births this way show
// up in the caller's beingLineage and are inhabit-able through
// cherub's Mode-3 connect.
//
// Two beings, two roles, two entry points — one BE op shared. The
// closed three-op BE set (birth / connect / release) stays intact;
// each delegate's role declares which canBe entries it handles and
// the BE verb dispatches by target stance.
//
// Both birther and cherub are scripted-cognition delegates. Their
// "summon" is a no-op; their real work runs through registered BE
// handlers in seed/ibp/beOps.js and seed/ibp/verbs/be.js.

export const birtherRole = Object.freeze({
  name: "birther",
  description:
    "Mints children from authenticated callers. Click @birther at the reality root to give birth to a child being — the new being's parent is you.",
  requiredCognition: "scripted",
  permissions: ["be"],
  respondMode: "async",
  triggerOn: [],
  canBe: ["birth"],

  async summon(_message, _ctx) {
    return null;
  },
});
