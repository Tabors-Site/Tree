// _template/ables/example-able/able.js — the able spec.
//
// Exports the spec as either the default export OR a named export
// whose value has a `name` field. The able-kind handler finds either.
//
// The spec is what the able registry stores. Bare words in `can`
// entries with verb do/call/be get auto-prefixed by the loader with
// the pack's namespace; verb see uses its own bare-word suffix-match
// at resolve time and is not rewritten.

export const exampleAble = Object.freeze({
  // The name field is overwritten by the loader to <pack>:<piece-name>.
  // It's here for clarity when reading the file standalone.
  name: "example-able",

  description: "What this able does.",

  // Verb permissions (derived from canX automatically when omitted).
  // Explicit override only when you ship a able with NO canX entries
  // but still need a verb permission (rare).
  // permissions: ["see", "do", "call", "be"],

  respondMode: "async",            // "async" | "sync" | "none"
  triggerOn:   ["message"],        // ["schedule"] for cadence-driven ables

  // Cognition guard. Omit (or null) for "any cognition". Set when this
  // able only makes sense under one cognition kind, e.g. "human" for
  // a able only humans should take.
  requiredCognition: null,         // null | "llm" | "human" | "scripted"

  // Reach list. Each entry is { verb, word, ... } where verb is
  // "see" | "do" | "summon" | "be" and word names the address / op /
  // stance / op. The able can SEE the named addresses, DOs the named
  // ops, SUMMONS the named stances, BEs the named ops. Bare words get
  // auto-prefixed to <pack>:<word> by the loader.
  can: [
    // { verb: "see", word: "place" },                 // foundational seed see
    // { verb: "see", word: "example-see" },           // <pack>:<word> resolved at frame-build
    // { verb: "do", word: "example-op" },             // <pack>:<word>
    // { verb: "do", word: "step", target: "being" },
    // { verb: "call", word: "(asker)", description: "Reply to whoever woke me." },
    // { verb: "call", word: "@other-being", description: "Reach a specific being." },
    // { verb: "be", word: "release" },
    // { verb: "be", word: "switch" },
  ],

  // Default orientation the moment opens at. forward | inward | half.
  // Most ables want forward (the default). "inward" folds the being's
  // own act-chain (reflection); "half" adds the recall braid.
  defaultOrientation: "forward",

  // Authoring guidance — non-enforced. The able-manager UI groups by
  // intent (modifier, primary, helper, etc.).
  // intent: "primary",

  // The prompt body. Always a function so the body can interpolate
  // moment context (currentSpaceName, currentBeingName, ...). Receive
  // ctx and return a string.
  prompt: (ctx) =>
    `You are an example able. The current position is ${ctx?.currentSpaceName || "(unknown)"}.`,

  // Scripted cognition path (OPTIONAL). When present, the substrate
  // runs this instead of LLM cognition. For published pure-data able
  // resources, OMIT this — let a code resource register a
  // registerAbleHandler instead so the able can travel independently
  // of any specific code piece.
  //
  // async call(message, ctx) {
  //   const me = ctx.toBeing;
  //   // ... read state, decide, act ...
  //   return ctx.act("response content");
  // },
});

// If your able needs a helper exported for the code piece to use
// (e.g., a SEE op handler the dancer-llm preloads), export it here.
//
// export function exampleSeeResolver(ctx) { ... }
