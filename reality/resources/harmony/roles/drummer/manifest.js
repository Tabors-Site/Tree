// harmony/roles/drummer — the drummer role piece (RESOURCES.md).
//
// The role spec lives in role.js. The loader's role-kind handler
// reads it, applies the pack's namespace prefix (harmony:), and
// registers it before the code piece's init() runs.
//
// Scripted cognition: the spec carries an inline `summon` function.
// The substrate's default LLM cognition does not apply.

export default {
  kind:    "role",
  name:    "drummer",
  version: "0.1.0",
  description:
    "The beat-keeper. Walks to the drum, strikes it when adjacent. Dancers react via subscription, not fan-out.",
  requires: [
    { type: "code", ref: "harmony" },  // canDo: ["tick"] resolves to harmony:tick
  ],
};
