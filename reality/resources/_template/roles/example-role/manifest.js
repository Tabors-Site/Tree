// _template/roles/example-role — role piece manifest template.
//
// A role piece ships ONE role spec in role.js. The loader's role-kind
// handler reads role.js, applies the pack's namespace prefix
// (<pack>:<name>), and registers the spec into the role registry
// before any code piece's init() runs.
//
// LLM vs scripted cognition:
//   - Default (no inline summon in role.js) → LLM cognition.
//   - Inline `async call(message, ctx) { ... }` on the spec →
//     scripted cognition. The substrate uses the inline function.
//   - Pure-data role + code resource calls reality.declare.
//     registerRoleHandler("<role>", handlerFn) → code cognition via
//     the registered handler (cleanest for pieces that travel
//     independently).

export default {
  kind:    "role",
  name:    "example-role",         // bare; loader prefixes to <pack>:<name>
  version: "1.0.0",
  description: "One sentence describing what this role does.",

  // Other resources this role needs at install time. Typically: the
  // pack's code piece (for ops the role's canDo references), other
  // role pieces it summons, asset pieces it requires.
  requires: [
    // { type: "code", ref: "my-pack" },
  ],
};
