// _template/ables/example-able — able piece manifest template.
//
// A able piece ships ONE able spec in able.js. The loader's able-kind
// handler reads able.js, applies the pack's namespace prefix
// (<pack>:<name>), and registers the spec into the able registry
// before any code piece's init() runs.
//
// LLM vs scripted cognition:
//   - Default (no inline summon in able.js) → LLM cognition.
//   - Inline `async call(message, ctx) { ... }` on the spec →
//     scripted cognition. The substrate uses the inline function.
//   - Pure-data able + code resource calls story.declare.
//     registerAbleHandler("<able>", handlerFn) → code cognition via
//     the registered handler (cleanest for pieces that travel
//     independently).

export default {
  kind:    "able",
  name:    "example-able",         // bare; loader prefixes to <pack>:<name>
  version: "1.0.0",
  description: "One sentence describing what this able does.",

  // Other resources this able needs at install time. Typically: the
  // pack's code piece (for ops the able's canDo references), other
  // able pieces it summons, asset pieces it requires.
  requires: [
    // { type: "code", ref: "my-pack" },
  ],
};
