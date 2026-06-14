// _template/roles/example-role/role.js — the role spec.
//
// Exports the spec as either the default export OR a named export
// whose value has a `name` field. The role-kind handler finds either.
//
// The spec is what the role registry stores. Bare action names in
// canDo/canSummon/canBe get auto-prefixed by the loader with the
// pack's namespace; canSee uses its own bare-name suffix-match at
// resolve time and is not rewritten.

export const exampleRole = Object.freeze({
  // The name field is overwritten by the loader to <pack>:<piece-name>.
  // It's here for clarity when reading the file standalone.
  name: "example-role",

  description: "What this role does.",

  // Verb permissions (derived from canX automatically when omitted).
  // Explicit override only when you ship a role with NO canX entries
  // but still need a verb permission (rare).
  // permissions: ["see", "do", "summon", "be"],

  respondMode: "async",            // "async" | "sync" | "none"
  triggerOn:   ["message"],        // ["schedule"] for cadence-driven roles

  // Cognition guard. Omit (or null) for "any cognition". Set when this
  // role only makes sense under one cognition kind, e.g. "human" for
  // a role only humans should take.
  requiredCognition: null,         // null | "llm" | "human" | "scripted"

  // Reach lists. The role can SEE the named addresses / DOs the named
  // ops / SUMMONS the named stances / BEs the named ops. Bare names
  // get auto-prefixed to <pack>:<name> by the loader.
  canSee:    [
    // "place",                        // foundational seed see
    // "example-see",                  // <pack>:<name> resolved at frame-build
  ],
  canDo:     [
    // "example-op",                   // <pack>:<name>
    // { action: "step", target: "being" },
  ],
  canSummon: [
    // { stance: "(asker)", description: "Reply to whoever woke me." },
    // { pattern: "@other-being", description: "Reach a specific being." },
  ],
  canBe:     [
    // "release", "switch",
  ],

  // Default orientation the moment opens at. forward | inward | half.
  // Most roles want forward (the default). "inward" folds the being's
  // own act-chain (reflection); "half" adds the recall braid.
  defaultOrientation: "forward",

  // Authoring guidance — non-enforced. The role-manager UI groups by
  // intent (modifier, primary, helper, etc.).
  // intent: "primary",

  // The prompt body. Always a function so the body can interpolate
  // moment context (currentSpaceName, currentBeingName, ...). Receive
  // ctx and return a string.
  prompt: (ctx) =>
    `You are an example role. The current position is ${ctx?.currentSpaceName || "(unknown)"}.`,

  // Scripted cognition path (OPTIONAL). When present, the substrate
  // runs this instead of LLM cognition. For published pure-data role
  // resources, OMIT this — let a code resource register a
  // registerRoleHandler instead so the role can travel independently
  // of any specific code piece.
  //
  // async summon(message, ctx) {
  //   const me = ctx.toBeing;
  //   // ... read state, decide, act ...
  //   return ctx.act("response content");
  // },
});

// If your role needs a helper exported for the code piece to use
// (e.g., a SEE op handler the dancer-llm preloads), export it here.
//
// export function exampleSeeResolver(ctx) { ... }
