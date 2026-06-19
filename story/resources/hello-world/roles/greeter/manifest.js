// hello-world/roles/greeter — the greeter role piece.
//
// Scripted cognition. role.js carries the inline summon function
// that reads the position via ctx.read + the children projection,
// then composes the greeting.

export default {
  kind:    "role",
  name:    "greeter",
  version: "1.0.0",
  description:
    "Greets the asker and the world it sees around itself. Scripted cognition; reads the position + its children, composes the greeting.",
  requires: [],
};
