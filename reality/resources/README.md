# Extensions, a developer guide

The guide for building TreeOS extensions against the seed as it stands.
Start at the top if you have not written one. The manifest spec is in
[EXTENSION_FORMAT.md](./EXTENSION_FORMAT.md); the seed's own internals
are in [`../seed/FACTORY.md`](../seed/FACTORY.md).

If anything here disagrees with the seed source, **the source is right**.

---

## 1. What an extension actually adds

The seed is a closed kernel. It defines six primitives (Being, Space,
Matter, Fact, Act, LlmConnection), four verbs (SEE, DO, SUMMON, BE), and
the machinery that runs one moment at a time. It does not know what
food, governance, or a dance floor is. It provides structure.

An **extension** lives in `reality/extensions/<name>/` and teaches the
seed new vocabulary. It can contribute exactly five things:

- **DO operations** — new actions on the DO verb. The only LLM-callable
  surface your extension adds.
- **Roles** — templates a Being wears when summoned.
- **See-resolvers** — structured per-role views the prompt assembler
  pre-renders into the system prompt.
- **Seeds** — plantable scaffolds an operator can run.
- **Hooks / subscriptions / scheduled wakes** — lifecycle reactivity.

Plus the usual plumbing if you need it: HTTP routes, background jobs,
cross-extension API, WebSocket pushes.

### What extensions DO NOT add

Read this before you start. The cleanup that landed in 2026-05 deleted
several patterns; not knowing they are gone is the #1 way to overbuild.

- **LLM tools.** The seed ships ONE generic tool per verb (`see`, `do`,
  `summon`, `be`). That is the entire LLM tool surface for every being
  on every reality. Extensions do not register LLM tools. Add a DO
  operation; the LLM calls `do({action: "your-ext:your-op", args})`.
- **Per-action ergonomic wrappers.** No `step({direction})` tool that
  translates into `do({action: "harmony:step"})`. Domain-tuned schemas
  belong at the op-handler level, not as a separate LLM tool.
- **Position folds, grid reducers, projection writers.** The factory
  has `PositionProjection` (cross-cutting fold of beings' coords per
  space). Read it via `readPositionsInSpace(spaceId)`. Bounds are
  enforced by `set-being:coord` at write time.
- **Direct `mongoose.model("X")` calls.** Import the model from its
  seed path:
  `import Being from "../../seed/materials/being/being.js"`.
  Same for Space, Matter, Fact. Direct registry lookups bypass the
  seed's typing.
- **A `toolNames` field on roles.** It does not exist. The role spec
  IS its four `can*` lists; tool exposure follows from which lists are
  populated.
- **Tool-syntax instructions in `prompt(ctx)`.** The system prompt
  already renders the four verbs and the role's licensed targets. Do
  not restate `do({action, args})` syntax in the role body; that is
  role-intent space, not assembler space.

---

## 2. The smallest possible extension

Two files. Copy [`_template/`](./_template/) and edit.

```
resources/extensions/hello/
├── manifest.js
└── index.js
```

**manifest.js**

```js
export default {
  name: "hello",
  version: "1.0.0",
  description: "Says hi.",
  needs:    { services: [] },
  provides: { hooks: { fires: [], listens: [] } },
};
```

**index.js**

```js
export async function init(reality) {
  reality.do.registerOperation("greet", {
    targets: ["being"],
    async handler({ target, params }) {
      return { greeting: `Hi, being ${target.id}.` };
    },
  });
}
```

That is the whole contract. Any LLM role with
`canDo: [{action: "hello:greet", description: "..."}]` can invoke it
via `do({action: "hello:greet"})`.

---

## 3. The four verbs

Every operation on the world goes through one of four verbs. Verb
files are in [`../seed/ibp/verbs/`](../seed/ibp/verbs/).

| Verb | What it does | Stamps a Fact? |
|---|---|---|
| **SEE** | Read state, return a Position Descriptor. | No |
| **DO** | Run a registered operation. Writes. | Yes (unless `skipAudit`) |
| **SUMMON** | Wake a being with a message. | Yes (`be:summon` on the summoner's reel) |
| **BE** | Identity: register, claim, release, switch, create-being. | Yes (`be:<op>` on the being's reel) |

### Calling them

```js
const desc = await reality.see(target, opts);
const ret  = await reality.do(target, "ext:op-name", params, opts);
const sum  = await reality.summon(stance, message, opts);
const bee  = await reality.be("register" | "claim" | ..., payload, opts);
```

**Threading identity + summonCtx.** Every DO/SUMMON/BE inside a being's
moment must thread the moment context so the resulting Fact rides this
moment's Act:

```js
await reality.do(target, "ext:set-status", { status: "ok" }, {
  identity:  { beingId },     // who is doing it (drives stance auth)
  summonCtx,                  // forwards the open Act's actId
});
```

The seed throws on a DO call with no `summonCtx.actId` from non-scaffold
code. Forward `summonCtx` from your handler down into every sub-call.

---

## 4. The `reality` bundle

The loader calls your `init(reality)` with a scoped view of the seed's
service bundle (assembled in
[`../seed/services.js`](../seed/services.js)).

### Always available

- `reality.see`, `reality.do`, `reality.summon`, `reality.be` — the four verbs.
- `reality.do.registerOperation(name, spec)` — register a DO action.
  Auto-namespaced (your `name` becomes `"<your-ext>:<name>"`).
- `reality.hooks` — `{ register, unregister, run, fire }` lifecycle bus.
- `reality.qualities.{being,space,matter}` — read API (`getQuality`,
  `readQualityNamespace`). Writes go through DO.
- `reality.declare` — `{ registerRole, subscribe, schedule, aggregate }`.

### Declared via `needs.services`

| Service | What you get |
|---|---|
| `models` | `Being`, `Space`, `Matter`, `Fact`, `Act`, `LlmConnection`. |
| `auth` | `createBeing`, `verifyPassword`, `generateToken`, ... |
| `session` | `createSession`, `endSession`, `SESSION_TYPES`, ... |
| `llm` | `runLlmMoment`, `getClientForBeing`, `resolveRootLlmForRole`, `registerBeingLlmSlot`, `registerRootSpaceLlmSlot`, `registerFailoverResolver`. |
| `websocket` | `emitToBeing`, `emitNavigate`, `registerSocketHandler`, `getIO`. Event names auto-namespaced. |
| `space` | `createSpace`, `getAncestorChain`, `snapshotAncestors`, ... |
| `matters` | `createMatter`, `editMatter`, `deleteMatterAndFile`, ... |
| `scope` | `isExtensionBlockedAtSpace`, `getToolOwner`. |
| `protocol` | `ok`, `error`, `sendOk`, `sendError`, `IBP_ERR`. |

### Auto-namespacing

- `reality.do.registerOperation("foo", ...)` becomes `"<your-ext>:foo"`.
- `reality.websocket.emitToBeing(bId, "tick", ...)` becomes
  `"<your-ext>:tick"` on the wire.
- Passing a fully-qualified name with a prefix that is not yours
  **throws**.

---

## 5. Manifest

```js
export default {
  name:        "my-extension",     // kebab-case; this is your namespace
  version:     "1.0.0",
  description: "One line.",

  needs: {
    services:   ["llm", "session"],
    extensions: ["other-ext"],
  },

  optional: {
    services:   ["energy"],
    extensions: ["billing"],
  },

  provides: {
    models: { MyModel: "./model.js" },
    routes: "./routes.js",
    jobs:   "./jobs.js",
    seeds:  { "my-seed": "./seeds/my.js" },
    hooks: {
      fires:   [{ name: "my-ext:ready", description: "..." }],
      listens: ["afterMatter", "enrichContext"],
    },
    defaultPermissions: {
      "do:my-ext:run": { requires: { owner: true } },
    },
  },
};
```

There is no `provides.tools` — extensions don't register LLM tools.

Full reference: [EXTENSION_FORMAT.md](./EXTENSION_FORMAT.md).

### `init(reality)` return

```js
export async function init(reality) {
  // register ops, roles, subscriptions, hooks here...
  return {
    router:  expressRouter,         // mounted at /api/v1/<ext>/
    jobs:    { start() {}, stop() {} },
    seeds:   [{ name: "my-seed", ...mySeed }],
    exports: { helperFn },          // cross-extension API
  };
}
```

---

## 6. DO operations

A **DO operation** is a named, gated, audited write. It is the only
LLM-callable surface your extension adds.

### Register

```js
reality.do.registerOperation("log-meal", {
  targets:    ["space"],                       // valid: space|being|matter|stance|position
  factAction: "log-meal",                      // defaults to op name
  skipAudit:  false,                           // true = no Fact stamped (rare)
  async handler({ target, params, identity, summonCtx, scaffold }) {
    // do the write through seed verbs or seed-model imports
    return { logged: true };
  },
});
```

The loader rewrites `"log-meal"` to `"my-ext:log-meal"`. From then on:

```js
await reality.do(spaceId, "my-ext:log-meal", { text: "eggs" }, { identity, summonCtx });
```

And the LLM dispatches the same op as:

```
do({ action: "my-ext:log-meal", target: "<address>", args: { text: "eggs" } })
```

### Dispatcher flow

For each `reality.do(...)`:

1. Look up `"my-ext:log-meal"` in the registry.
2. Read-only-origin gate (filesystem-origin matter rejects writes).
3. Stance authorization (`authorize`), namespace-aware.
4. Call your `handler({ target, params, identity, summonCtx, scaffold })`.
5. Stamp a Fact on the target's reel with `actId` from `summonCtx`
   (unless `skipAudit`).

### Writing qualities

Use the seed's material-scoped `set-<kind>` ops. Per-namespace atomic:

```js
// Whole namespace on a space
await reality.do(spaceId, "set-space", {
  field: "qualities.my-ext",
  value: { goals: [{ id: 1, text: "ship it" }] },
}, { identity, summonCtx });

// One inner key (atomic at that key path)
await reality.do(spaceId, "set-space", {
  field: "qualities.my-ext.lastSeen",
  value: new Date().toISOString(),
}, { identity, summonCtx });

// Same shape for beings and matter
await reality.do(beingId,  "set-being",  { field: "qualities.my-ext.streak", value: 7 }, opts);
await reality.do(matterId, "set-matter", { field: "qualities.my-ext.tag",    value: "x" }, opts);
```

The legacy `qualities.X.setQuality()` family was retired 2026-05-23 and
now throws. Every write must be a Fact on the aggregate's reel.

---

## 7. Roles

A **role** is a template a Being wears for a moment. The role spec is
PURE DATA — name, description, the four `can*` lists, and the
`prompt(ctx)` body. The seed registry runs the role; you do not
write engine glue.

Specifically: do not write a `summon` function in your role for LLM
cognition. The registry auto-wraps `defaultSummon`, which calls
`runLlmMoment` with the right envelope and routes the discriminated
result (act / see / failure). Defining your own `summon` is the
retired pattern; it duplicates the dispatcher.

Define a custom `summon` ONLY for scripted cognition (the function
reads the fold and acts in code, no LLM call). The harmony drummer
and dancer-toward are scripted; the dancer-llm and reality-manager
are pure data.

### The complete role spec (LLM cognition)

```js
reality.declare.registerRole("meal-logger", {
  name: "meal-logger",
  description: "Records what the user just ate at this position.",
  permissions: ["see", "do"],
  respondMode: "async",
  triggerOn:   ["message"],

  // The body: four can* lists. THIS IS THE ROLE.
  // canSee is the preloaded face. Entries are EITHER IBP addresses
  // (preloaded via seeVerb; the position descriptor becomes a JSON
  // block) OR registered see names (preloaded via the seeResolver
  // registry; the structured return becomes a JSON block). Both
  // render under a [<label>] header. NOT a tool; the being does not
  // pick from a menu — the face IS the perception.
  canSee: [
    "place",                       // seed-shipped see: current position descriptor
    "my-ext:meal-history",         // extension-registered see
    "./identity",                  // IBP address: heaven child, preloaded via seeVerb
  ],
  canDo: [
    {
      action: "my-ext:log-meal",
      description: "Record one meal. args: { text: string }",
    },
  ],
  canSummon: [
    { stance: "(asker)", description: "reply to whoever woke you" },
  ],
  // canBe absent: not in the tool surface.

  // Multi-moment work is explicit: from inside an act, emit
  // summon(target=self) to wake yourself again for the next step.
  // The role's act IS the loop signal; the seed never synthesizes
  // continuations on its own.

  // Role-intent body. NO verb syntax explanation; the assembler handles
  // that. This is the role's character, persona, and goal.
  prompt: (ctx) =>
    `You log what the user ate. Be brief. Confirm and move on.`,

  // Optional: how to send the answer back.
  replyTo: "asker",

  // No `summon` field. The registry auto-wraps defaultSummon, which
  // calls runLlmMoment with the right envelope. Pure data.
}, "my-ext");
```

### The four `can*` lists ARE the role

| List | Entries | What the assembler does |
|---|---|---|
| `canSee`    | IBP addresses OR registered see names | Preloads each into the moment's face as a `[<label>]\n<JSON>` block. NO tool. |
| `canDo`     | action names the role may invoke      | Renders as menu under `do:`; LLM picks via the `do` tool. |
| `canSummon` | stance targets the role may address   | Renders as menu under `summon:`; LLM picks via the `summon` tool. |
| `canBe`     | BE operations the role may perform    | Renders as menu under `be:`; LLM picks via the `be` tool. |

canSee is different from the other three. It declares perception
(what the being already sees this moment) rather than capability
(what tool calls the being may make). The do / summon / be lists
populate menus the LLM picks from; canSee populates the face the
LLM reads. To see more, the being moves (DO), changes role (BE /
roleFlow), or the role spec is edited.

There is no `toolNames` field. The role spec is described once; the
tool surface follows.

### Entry shapes

Each `can*` entry is either a plain string or a self-describing object:

```js
canDo: [
  "my-ext:simple-action",                                // bare descriptor
  { action: "set-config", description: "args: { key, value }" },
  { rel: "any-child" },                                  // relationship token (future)
]
```

Relationship tokens (`{rel: "..."}`, `{pattern: "..."}`) expand at
prompt-build time via registered resolvers; today none ship, so they
pass through as literals (drop silently). Reserved for lineage-aware
licenses.

### The `prompt(ctx)` body

Role-intent only. Persona, goal, constraints. The assembler renders
in this order:

- `I am <name>, <role> at <space>.`
- `and can:` followed by the do / summon / be capability menus.
- Your `prompt(ctx)` body.
- Preloaded canSee face blocks (each entry resolved into a `[<label>]\n<JSON>` block).
- `[Time] <ISO>`.

Order is question-first, data-last: the identity, capabilities, and
role-intent state who the being is and what it can do; the canSee
blocks dump the fresh perception just before the time stamp so the
LLM attends most strongly to that data when forming its act. This
mirrors how operators get the best results pasting code at the end
of a prompt: instruction first, context at the tail.
- `[Time] <ISO>`.

Do NOT restate `do({action, args})` syntax. Do NOT restate "call see to
read state" or similar. The assembler instructs the LLM on the verbs.

### Multi-moment loops

Multi-moment work is **explicit**. A role that wants to keep stepping
emits `summon(target=<own stance>)` as part of its act — same SUMMON
tool any other being uses, just pointed at itself. The seed never
synthesizes continuations on its own; every wake-call traces to a
SUMMON emission by a being. (Doctrine: only SUMMONs make SUMMONs.)

The self-summon can carry `orientation: "inward"` to fold the act-
chain alone next moment, `"half"` to fold world plus surfaced past
acts, or `"forward"` (default) to fold the world. Only self-summons
may carry `half` or `inward`; cross-being summons must stay `forward`.

The no-act release (the explicit `end-turn` tool, or simply no tool
call at all) ends the loop. Roles with one-shot work declare nothing
extra — they act once and the moment closes naturally.

Harmony dancers are externally ticked: each wake comes from outside
(a tick summon, a peer summon), not from a self-emitted continuation.

---

## 8. Sees (registerSeeResolver: extension-authored perceptions)

A **see** is a perception in a moment's face. Roles declare them in
`canSee`; the assembler resolves each entry into the system prompt
as `[<name>]\n<JSON>` at moment-open. canSee accepts BOTH IBP
addresses (preloaded via `seeVerb`) AND registered see names
(preloaded via the seeResolver registry). The named form is how
extensions ship custom perceptions.

### Register

```js
core.declare.registerSeeResolver("meal-history", async (ctx) => {
  const beingId = String(ctx.being?._id);
  const recent = await readRecentMeals(beingId);
  return {
    today: recent.today,                  // array of meal records
    weekCount: recent.weekCount,           // number
    streakDays: recent.streakDays,         // number
  };
});
```

Bare names are auto-namespaced `<ext>:<name>`. A role inside the
same extension can reference the bare suffix in canSee (`canSee:
["meal-history"]` resolves to `my-ext:meal-history` if no seed see
collides); cross-extension references use the qualified form
(`canSee: ["my-ext:meal-history"]`).

### Reference from a role

```js
core.declare.registerRole("meal-logger", {
  // ...
  canSee: [
    "place",                  // seed see: current position descriptor
    "meal-history",           // this extension's see, auto-qualified
  ],
  // ...
});
```

### Return structured data

Resolvers MUST return objects, not prose. The LLM hallucinates when
the input is English; structured input keeps the model honest. The
classic prose-input failure: a resolver returns
`"You are at (3,4) on a 10x10 grid"` and the LLM free-associates "wall
cluster ahead" — features that don't exist in the data.

Object output renders as:

```
[meal-history]
{
  "today": [{ "text": "eggs", "at": "..." }],
  "weekCount": 14,
  "streakDays": 5
}
```

Strings are accepted (legacy) and pass through verbatim, but new
resolvers should return objects.

### Foundational seed sees

The seed registers a small set so every reality starts with bare
names for the common heaven children:

| Bare name    | Returns                                            |
| ------------ | -------------------------------------------------- |
| `place`      | Position descriptor for the being's current space. |
| `roles`      | The role registry mirror at `<reality>/./roles`.   |
| `tools`      | The tool registry mirror at `<reality>/./tools`.   |
| `operations` | The DO operation registry mirror.                  |
| `identity`   | The I-Am identity bundle.                          |
| `config`     | The reality config.                                |
| `peers`      | The peer list.                                     |
| `extensions` | The extension catalog.                             |

### When to write a custom see

Write one when the role needs a focused, role-specific projection
(a dancer's neighbor view, a worker's plan slice, an admin's audit
summary). Use the foundational sees plus IBP-address entries in
canSee for general-purpose reads. A see SHOULD be a pure function
of (chain, branch, ctx) so replay reproduces the same face.

---

## 9. Creating beings: use BE

Identity belongs on BE.

```js
const helper = await reality.be("create-being", {
  name:          `helper-${shortId()}`,
  password:      null,                   // auto-generated for AI beings
  operatingMode: "llm",                   // "llm" | "scripted" | "human" | "composite"
  roles:         ["my-ext:helper"],       // registered role name(s)
  defaultRole:   "my-ext:helper",
  homeSpace:     spaceId,
  parentBeingId: beingId,                 // lineage
  llmDefault:    null,                    // optional LlmConnection id
}, { identity: { beingId }, summonCtx });
```

For seed-internal flows where you already know the inbox space and
don't need to go through stance resolution, the seed exports
`summonCreateBeing` directly from
[`../seed/ibp/verbs/summon.js`](../seed/ibp/verbs/summon.js).

Then wake it:

```js
await reality.summon(`${realityDomain}/${spaceId}@${helper.name}`, {
  from:        `${realityDomain}/${spaceId}@${myName}`,
  content:     "Please do X.",
  correlation: shortId(),
}, { identity: { beingId }, summonCtx });
```

For LLM beings, the cognition is one call to the model per moment via
[`../seed/present/cognition/llm/llmMoment.js`](../seed/present/cognition/llm/llmMoment.js).
One call, one decision, one act. Multi-step work uses many moments;
the role keeps stepping by emitting `summon(target=self)` as part of
its act (any orientation). The detailed shape is at
[`/factory/being-types`](../../site/src/components/Welcome/FactoryBeingTypes.jsx)
on the site.

---

## 10. Hooks

Before-hooks run sequentially and can cancel by returning `false` or
throwing. After-hooks run in parallel.

```js
reality.hooks.register("enrichContext", async ({ context, space, meta }) => {
  const ours = meta["my-ext"] || {};
  if (Object.keys(ours).length === 0) return;     // always guard
  context.myExt = ours;
}, "my-ext");
```

### Common hooks

Full list in [`../seed/hooks.js`](../seed/hooks.js):

- `beforeMatter` / `afterMatter`
- `beforeSpaceCreate` / `afterSpaceCreate` / `afterSpaceMove`
- `beforeFact`
- `beforeLLMCall` / `afterLLMCall`
- `beforeToolCall` / `afterToolCall`
- `beforeResponse`, `enrichContext` (sequential override)
- `afterQualityWrite`, `afterFieldWrite`, `afterScopeChange`, `afterBoot`
- `onTreeTripped` / `onTreeRevived`

Per-handler timeout 5s; chain timeout 15s. Five consecutive failures
trip a 5-minute circuit breaker on the extension's handler.

Extensions may fire their own hooks; namespace as `my-ext:eventName`.

---

## 11. DO-trigger subscriptions

Wake a being when a write of a particular shape happens on the tree:

```js
reality.declare.subscribe(beingId, {
  event:      "afterQualityWrite",
  scope:      { spaceId: someSpaceId },           // | { ancestor: id } | { everywhere: true }
  filter:     { field: "qualities.harmony.tick" }, // payload equality
  priority:   4,                                   // 1=HUMAN..4=BACKGROUND
  coalesceMs: 100,                                 // batch N ms; one SUMMON per batch
});
```

The seed fans matching events as SUMMONs to the subscribing being's
inbox. The role's `summon` interprets the wake content.

### Wake payload

For `afterQualityWrite` and `afterFieldWrite`, the wake content
carries the WRITTEN VALUE alongside the routing metadata:

```js
{
  event:        "afterQualityWrite",
  spaceId:      "...",
  actorBeingId: "...",                    // who wrote it
  action:       "set-matter",
  field:        "qualities.harmony.tick",  // the field path
  value:        { n: 7, at: "..." },       // the value written
  target:       { kind: "matter", id: "..." },
  timestamp:    "..."
}
```

So a subscriber can read the value off the wake without folding the
target. Coalesced wakes carry the batch as `{coalesced: true, events: [...]}`.

---

## 12. Scheduled wakes

```js
reality.declare.schedule(beingId, {
  intervalMs: 60_000 * 30,
  content:    { event: "tick" },
  priority:   4,
});
```

Default emitter sends as `@I-AM`. The receiving being's role.summon
reads `message.content`.

---

## 13. Seeds (plantable scaffolds)

A seed is a recipe that fans out a domain shape when planted.
Operators plant from the seed hotbar in the portal.

```js
// Returned from init():
return {
  seeds: [{
    name: "food-tracker",
    description: "Food tracking position with a meal-logger role.",
    async scaffold({ rootSpaceId, identity, reality, plantedSeedId, summonCtx }) {
      const opOpts = { identity, summonCtx };
      const space = await reality.do(rootSpaceId, "create-space", {
        spec: { name: "food", type: "domain" },
      }, opOpts);
      // ... more setup, threading summonCtx through every reality.do
      return { spaceId: space.spaceId };
    },
  }],
};
```

`summonCtx` threads through so every Fact emitted during the plant
joins the same Act. Failure unwinds the whole plant atomically.

---

## 14. Reading and writing qualities

`qualities.<your-ext>` is your namespace on Being, Space, or Matter.

### Read

```js
const data = reality.qualities.space.getQuality(space, "my-ext");
// returns the namespace object, or {} when unset

const ns = reality.qualities.space.readQualityNamespace(space, "my-ext");
// returns the namespace object, or null when unset
```

### Write — through DO

```js
// Whole namespace
await reality.do(spaceId, "set-space", {
  field: "qualities.my-ext",
  value: { goals: [{ id: 1, text: "ship it" }] },
}, { identity, summonCtx });

// One inner key (atomic, other namespaces and other inner keys untouched)
await reality.do(spaceId, "set-space", {
  field: "qualities.my-ext.lastSeen",
  value: new Date().toISOString(),
}, { identity, summonCtx });
```

Stance auth enforces namespace ownership: a write under
`qualities.my-ext` requires the actor to own that namespace at the
position. The loader records ownership at op registration.

---

## 15. A worked example: feedback

Collects short notes at any space. One op, one role, one hook, one
see. Two files.

**`resources/extensions/feedback/manifest.js`**

```js
export default {
  name:        "feedback",
  version:     "1.0.0",
  description: "Collect short feedback notes at any position.",
  needs:    { services: [] },
  provides: { hooks: { listens: ["enrichContext"] } },
};
```

**`resources/extensions/feedback/index.js`**

```js
export async function init(reality) {
  // 1. DO operation. Append a note to this space's namespace.
  reality.do.registerOperation("add-note", {
    targets: ["space"],
    async handler({ target, params, identity, summonCtx }) {
      const existing = reality.qualities.space.readQualityNamespace(target, "feedback") || {};
      const notes = Array.isArray(existing.notes) ? existing.notes : [];
      const next = [...notes, { text: params.text, at: new Date().toISOString() }].slice(-50);
      await reality.do(target._id, "set-space", {
        field: "qualities.feedback.notes",
        value: next,
      }, { identity, summonCtx });
      return { appended: true };
    },
  });

  // 2. See. Pre-renders the latest note as structured data. Roles
  //    reference this by name in their canSee list.
  reality.declare.registerSeeResolver("recent", async (ctx) => {
    const spaceId = ctx.currentSpace || ctx.rootId;
    if (!spaceId) return null;
    const space = await ctx.models?.Space?.findById(spaceId).lean();
    const data = space?.qualities?.feedback || {};
    const notes = Array.isArray(data.notes) ? data.notes : [];
    if (notes.length === 0) return null;
    return { latest: notes[notes.length - 1], total: notes.length };
  });

  // 3. Role. canDo lists the action; canSee preloads the recent-note
  //    view into the moment's face. The seed `do` tool dispatches.
  reality.declare.registerRole("feedback-collector", {
    name: "feedback-collector",
    description: "Collects one feedback note and exits.",
    permissions: ["do"],
    respondMode: "async",
    triggerOn:   ["message"],

    canSee: ["recent"],            // bare name, auto-qualified to feedback:recent
    canDo: [
      { action: "feedback:add-note", description: "args: { text: string }" },
    ],
    canSummon: [
      { stance: "(asker)", description: "reply to whoever woke you" },
    ],

    prompt: (_ctx) =>
      `Collect one short feedback note from the user, then reply with a brief confirmation.`,

    replyTo: "asker",
  }, "feedback");

  // 4. Hook. Surface a one-liner to any LLM at this space (legacy
  //    enrichContext path; new code prefers sees via canSee).
  reality.hooks.register("enrichContext", async ({ context, space }) => {
    const data = reality.qualities.space.readQualityNamespace(space, "feedback");
    if (!data?.notes?.length) return;
    const latest = data.notes[data.notes.length - 1];
    context.feedbackLatest = `Most recent feedback: "${latest.text}"`;
  }, "feedback");
}
```

That is the whole extension. No tool registrations. No mongoose calls.
No factory duplication. One op, one role, one resolver, one hook.

---

## 16. HTTP routes

If you need an HTTP endpoint (legacy clients, webhooks, uploads),
return an Express router from `init`:

```js
import express from "express";

export async function init(reality) {
  const router = express.Router();
  router.post("/log", async (req, res) => {
    try {
      await reality.do(req.body.spaceId, "my-ext:log-meal", { text: req.body.text }, {
        identity:  { beingId: req.beingId },
        summonCtx: req.summonCtx,
      });
      reality.protocol.sendOk(res, { logged: true });
    } catch (e) {
      reality.protocol.sendError(res, 500, reality.protocol.IBP_ERR.INTERNAL, e.message);
    }
  });
  return { router };
}
```

The loader mounts it at `/api/v1/<your-ext>/`. Keep routes thin shims
into IBP verbs.

---

## 17. Background jobs

```js
export async function init(reality) {
  let timer = null;
  return {
    jobs: {
      start() {
        timer = setInterval(async () => { await sweepStaleRecords(); }, 60_000);
        timer.unref();
      },
      stop() { if (timer) clearInterval(timer); },
    },
  };
}
```

`start()` runs after all extensions initialize; `stop()` runs on SIGTERM.

---

## 18. Cross-extension API

```js
export async function init(reality) {
  return {
    exports: {
      getLatestNote(spaceId) { /* ... */ },
    },
  };
}
```

Consumers reach you through `reality.scope.getExtensionAtScope`:

```js
const ext = reality.scope.getExtensionAtScope("my-ext", spaceId);
const note = ext?.exports?.getLatestNote?.(spaceId);
```

Optional chaining is load-bearing — extensions are optional in the
field.

---

## 19. Stance authorization

Every verb call passes through `authorize` in
[`../seed/ibp/authorize.js`](../seed/ibp/authorize.js). Four layers:

1. **Facts.** Owner / contributor / role / home / operating mode of
   the being at this position.
2. **Per-position rules.** Walk the ancestor chain for
   `qualities.permissions.<verb>.<keyParts>`.
3. **Extension defaults.** From manifest `provides.defaultPermissions`.
4. **Default deny.** No match → reject.

For writes under `qualities.<ns>`, namespace ownership is enforced on
top. The actor must own that namespace at the target position.

```js
provides: {
  defaultPermissions: {
    "do:my-ext:admin-purge": { requires: { owner: true } },
    "do:my-ext:read-only":   { requires: {} },           // anyone
    "summon:@my-coach":      { requires: { homeInDomain: true } },
  },
}
```

---

## 20. WebSocket pushes

```js
reality.websocket.emitToBeing(beingId, "status-changed", { status: "ok" });
// On the wire: event name is "my-ext:status-changed"
```

The seed reserves `"ibp"`, `"registered"`, and `"navigate"`; emitting
any of those throws.

---

## 21. Anti-patterns

The things that look reasonable and are actually fighting the seed.

**Registering an LLM tool.** Don't. Extensions add DO operations; the
LLM dispatches them through the seed's generic `do` tool. There is no
extension tool registry to consume.

**Per-action ergonomic wrappers.** A `step({direction})` tool that
translates into `do({action: "harmony:step"})` is the retired pattern.
Domain-tuned argument shapes belong in the op handler, which can
derive `gridSpaceId` from the actor's position or whatever else.

**Adding `toolNames` to a role.** The field doesn't exist. The role's
body is its four `can*` lists; tool exposure follows from which lists
are populated.

**Restating verb syntax in `prompt(ctx)`.** The assembler renders the
four verbs and the role's licensed targets. The role body is
role-intent only.

**Prose-returning sees.** Return structured objects. Prose input
invites prose hallucination — the LLM free-associates features that
aren't in the data.

**Asking the LLM to call a `see` tool.** There is no see tool.
canSee is preloaded into the face; the being already sees what the
role declared. To see more, the being moves (DO), changes role (BE
/ roleFlow), or the role spec is edited.

**Calling `mongoose.model("X")`.** Import from the seed:
`import Being from "../../seed/materials/being/being.js"`.

**Re-implementing position folds.** The factory's `PositionProjection`
holds beings' coords per space; `readPositionsInSpace(spaceId)` returns
them. Bounds enforcement is at the seed's `set-being:coord` (throws on
OOB). Extensions add the wake shape, not the projection.

**Direct writes to a Space/Being/Matter row.** Bypasses Fact stamping;
the projection diverges from the reel. Always go through DO.

**Using `qualities.X.setQuality()`.** Retired 2026-05-23, throws. Use
`reality.do(target, "set-<kind>", { field: "qualities.<ns>" })`.

**Writing into another extension's qualities namespace.** Stance auth
rejects. Each namespace is owned at registration.

**`create-being` on DO.** Identity is BE's territory.
`reality.be("create-being", ...)`.

**Forgetting to thread `summonCtx`.** A DO call from inside a SUMMON
handler with no `summonCtx.actId` throws. Forward `summonCtx` down
into every sub-call.

**Defining `summon` on an LLM role.** Don't. The registry auto-wraps
`defaultSummon`, which calls `runLlmMoment` and routes the
discriminated result. Writing your own `summon` is duplicating the
dispatcher. The role spec is pure data; the substrate runs it.
Custom `summon` is only for scripted cognition (the function reads
the fold and acts in code, no LLM call).

---

## 22. Where to read next

- **Manifest contract:** [EXTENSION_FORMAT.md](./EXTENSION_FORMAT.md).
- **Template to copy:** [`_template/`](./_template/).
- **The seed's own contract:** [`../seed/FACTORY.md`](../seed/FACTORY.md).
- **The four verbs in code:** [`../seed/ibp/verbs/`](../seed/ibp/verbs/).
- **DO operation registry:** [`../seed/ibp/operations.js`](../seed/ibp/operations.js).
- **Role registry:** [`../seed/present/roles/registry.js`](../seed/present/roles/registry.js).
- **One LLM moment:** [`../seed/present/cognition/llm/llmMoment.js`](../seed/present/cognition/llm/llmMoment.js).
- **Default summon dispatcher:** [`../seed/present/cognition/defaultSummon.js`](../seed/present/cognition/defaultSummon.js).
- **The four seed verb-tools:** [`../seed/present/cognition/llm/seedSeeTool.js`](../seed/present/cognition/llm/seedSeeTool.js), `seedDoTool.js`, `seedSummonTool.js`, `seedBeTool.js`.
- **Sees registry:** [`../seed/present/cognition/llm/seeResolvers.js`](../seed/present/cognition/llm/seeResolvers.js). Foundational seed sees live in [`../seed/present/cognition/llm/seedSeeResolvers.js`](../seed/present/cognition/llm/seedSeeResolvers.js); canSee resolution is in [`../seed/present/cognition/llm/canSeeResolver.js`](../seed/present/cognition/llm/canSeeResolver.js).
- **Position projection (factory-owned position fold):** [`../seed/past/projections/position/`](../seed/past/projections/position/).
- **Reply emission helpers:** [`../seed/present/replies.js`](../seed/present/replies.js).
- **Stance authorization:** [`../seed/ibp/authorize.js`](../seed/ibp/authorize.js).
- **Hooks list:** [`../seed/hooks.js`](../seed/hooks.js).
- **Loader scoping:** [`./loader.js`](./loader.js).
