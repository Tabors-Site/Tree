# Extensions, a developer guide

This is the guide for building TreeOS extensions against the seed as it
stands today. Start at the top if you have never written one before,
skim the lower sections once you know your way around. The companion
spec for manifest fields is [EXTENSION_FORMAT.md](./EXTENSION_FORMAT.md);
the seed's own internals are in [`../seed/FACTORY.md`](../seed/FACTORY.md).

If anything here disagrees with the seed source, **the source is
right**. The seed evolves; this guide aims to track it. If you find
drift, fix it.

---

## 1. What an extension is

The seed (`reality/seed/`) is a closed kernel. It defines six primitives
(Being, Space, Matter, Fact, Act, LlmConnection), four verbs (SEE, DO,
SUMMON, BE), and the machinery that runs one moment at a time. It does
not know what food is, what governance is, what a Discord channel is,
or what your domain looks like. It provides structure.

An **extension** lives in `reality/extensions/<name>/` and teaches the
seed new vocabulary inside that structure. It can:

- Register **DO operations**, new actions on the DO verb (extensions of
  the write vocabulary).
- Register **roles**, templates a Being can wear when summoned.
- Provide **tools**, LLM-callable functions tagged with a verb.
- Subscribe to **hooks**, lifecycle events the seed fires.
- Subscribe to **DO triggers**, so a write at some position wakes a
  Being you choose.
- Register **scheduled wakes**, cadence-driven SUMMONs.
- Register **seeds**, plantable scaffolds the operator can run.
- Provide HTTP **routes** (thin shims into IBP), **jobs**
  (start/stop background workers), and Mongoose **models**.
- Push **WebSocket events** to a Being.

The seed loads extensions at boot, calls each one's `init(place)` once
with a scoped services bundle, and wires whatever the init returns.

---

## 2. The smallest possible extension

Two files, total. Copy [`_template/`](./_template/) and edit.

```
extensions/hello/
├── manifest.js
└── index.js
```

**manifest.js**

```js
export default {
  name: "hello",
  version: "1.0.0",
  description: "Says hi.",
  needs:    { services: [], extensions: [] },
  provides: { tools: true },
};
```

**index.js**

```js
export async function init(place) {
  return {
    tools: [{
      name: "hello:greet",
      verb: "do",
      description: "Greet the asker.",
      schema: {},
      handler: async ({ beingId }) => ({
        content: [{ type: "text", text: `Hi, being ${beingId}.` }],
      }),
    }],
  };
}
```

Drop the folder in `reality/extensions/`, restart the server, and the
tool is callable from any role that lists `"hello:greet"` in its
`canDo`. That is the whole contract.

---

## 3. The four verbs

Every operation on the world goes through one of four verbs. These are
the only public surface; everything else is a syntactic helper on top
of them. Signatures are in [`../seed/ibp/verbs.js`](../seed/ibp/verbs.js).

| Verb | Targets | What it does | Stamps a Fact? |
|---|---|---|---|
| **SEE** | space, matter, being, position | Read state, return a descriptor. | No |
| **DO** | space, matter, being, place, stance, position | Run a registered operation. Writes. | Yes (unless `skipAudit`) |
| **SUMMON** | being (stance) | Wake a being with a message. | Yes (`be:summon` on the summoner's reel) |
| **BE** | being (self) | Identity: register, claim, release, switch, create-being. | Yes (`be:<op>` on the being's reel) |

The verb you call decides the gate (`authorize`), the side effects
(Fact stamp), and which registry resolves the name (operations for DO,
role/being for SUMMON).

### Calling them

The scoped bundle hands you each one as a callable:

```js
const desc = await place.see(target, opts);
const ret  = await place.do(target, "ext:operation-name", params, opts);
const sum  = await place.summon(stance, message, opts);
const bee  = await place.be("register" | "claim" | ..., payload, opts);
```

**Threading identity and audit.** Most DO/BE/SUMMON calls from inside
an extension happen while a Being is acting through your code. Pass
that being through:

```js
await place.do(target, "ext:set-status", { status: "ok" }, {
  identity:  { beingId },         // who's doing it (drives stance auth)
  summonCtx,                       // the open Act's correlation, threaded from the caller
});
```

The seed throws if `summonCtx.actId` is missing on a DO call from
non-scaffold code. Every act lives in a moment; the Fact has to ride
the Act that opened that moment.

If you genuinely are doing boot-time scaffolding (you should not be,
in an extension), pass `{ scaffold: true }` and no identity. This is
reserved for the seed itself.

---

## 4. The `place` bundle

The loader (`reality/extensions/loader.js`) calls your `init(place)`
with a scoped view of the seed's service bundle, assembled in
[`../seed/services.js`](../seed/services.js). What you get:

### Always available (no `needs` declaration required)

- `place.see`, `place.do`, `place.summon`, `place.be`, the four verbs.
- `place.do.registerOperation(name, spec)`, register a DO action.
  Auto-namespaced (your `name` becomes `"<your-ext>:<name>"`).
- `place.hooks`, `{ register, unregister, run, fire }` lifecycle bus.
- `place.qualities.{being,space,matter}`, read API (`getQuality`,
  `readQualityNamespace`). Writes have been retired here; use DO.

### Declared via `needs.services` in manifest

| Service | What you get |
|---|---|
| `models` | Mongoose models: `Being`, `Space`, `Matter`, `Fact`, etc. |
| `auth` | `createBeing`, `verifyPassword`, `generateToken`, `findBeingByName`, `registerStrategy`, ... |
| `session` | `createSession`, `endSession`, `getSession`, `SESSION_TYPES`, `registerSessionType`, ... |
| `llm` | `runTurn`, `stepTurn`, `getClientForBeing`, `switchRole`, `registerBeingLlmSlot`, ... |
| `websocket` | `emitToBeing`, `emitNavigate`, `registerSocketHandler`, `getIO`. Event names auto-namespaced. |
| `facts` | `logFact` (rarely called directly; DO stamps for you) |
| `seeds` | `register`, `plant`, `unplant`, `list`, `listPlantedAt` |
| `space` | `createSpace`, `deleteSpaceBranch`, `editSpaceName`, `editSpaceType`, `getAncestorChain`, `snapshotAncestors`, ... |
| `matters` | `createMatter`, `editMatter`, `deleteMatterAndFile`, `transferMatter`, `getMatters` |
| `spaceLocks` | `acquireSpaceLock`, `releaseSpaceLock`, `acquireMultiple`, ... |
| `scope` | `isExtensionBlockedAtSpace`, `getBlockedExtensionsAtSpace`, `getToolOwner` |
| `declare` | `registerRole`, `unregisterRole`, `subscribe`, `schedule`, `aggregate`, ... |
| `protocol` | `ok`, `error`, `sendOk`, `sendError`, `IBP_ERR` (for routes) |

A declared but missing service comes through as an inert stub
(optional ones) or causes init to fail (required ones). The minimum
list for a tool-only extension is empty; you only declare what you
actually reach for.

### Auto-namespacing

The loader scopes your view so you can never accidentally write into
another extension's territory:

- `place.do.registerOperation("foo", ...)` becomes
  `"<your-ext>:foo"` on the registry.
- `place.websocket.emitToBeing(bId, "tick", payload)` becomes
  `"<your-ext>:tick"` on the wire.
- Passing a fully-qualified name with a prefix that is not yours
  **throws**.

---

## 5. Manifest in detail

```js
export default {
  name:        "my-extension",     // kebab-case; this is your namespace
  version:     "1.0.0",            // semver
  description: "One line.",

  needs: {
    services:   ["llm", "session"],        // required; init fails if missing
    extensions: ["other-ext"],             // required peers
    models:     ["Space", "Being"],        // optional, mostly informational
  },

  optional: {
    services:   ["energy"],                // gets stub if missing
    extensions: ["billing"],               // wired if present, skipped if not
  },

  provides: {
    models: { MyModel: "./model.js" },     // registered into place.models
    routes: "./routes.js",                  // mounted at /api/v1
    tools:  true,                           // init() returns tools: [...]
    jobs:   "./jobs.js",                    // { start, stop }
    seeds:  { "my-seed": "./seeds/my.js" }, // plantable scaffolds
    hooks: {
      fires:   [{ name: "my-ext:ready", data: "{}", description: "..." }],
      listens: ["afterMatter", "enrichContext"],
    },
    defaultPermissions: {
      "do:my-ext:run": { requires: { owner: true } },
    },
  },
};
```

Full reference: [EXTENSION_FORMAT.md](./EXTENSION_FORMAT.md).

### `init(place)` return shape

Anything not declared in the manifest can also be returned at runtime
from `init`. The loader wires whatever it sees:

```js
export async function init(place) {
  // do things during init...
  return {
    tools:   [/* tool objects */],
    router:  expressRouter,
    jobs:    { start() {}, stop() {} },
    exports: { helperFn },   // cross-extension API
  };
}
```

---

## 6. DO operations

An **operation** is a named, gated, audited write. Tools call
operations; operations are what extensions actually contribute to the
verb. The seed defines a small bare-name set
(`create`, `set`, `end`, `plant`, etc., in
[`../seed/ibp/seedOperations.js`](../seed/ibp/seedOperations.js)); your
extension's operations live under `"<your-ext>:<action>"`.

### Registering

```js
place.do.registerOperation("log-meal", {
  targets: ["space"],                       // valid: space|being|matter|place|stance|position
  schema:  zodOrJsonSchema,                 // currently stored only; enforcement on roadmap
  factAction: "log-meal",                   // name written into the Fact (defaults to op name)
  skipAudit: false,                         // true means no Fact stamped (use sparingly)
  async handler({ target, params, identity, summonCtx, scaffold }) {
    // do the write
    return { logged: true };
  },
});
```

The loader rewrites `"log-meal"` to `"my-ext:log-meal"` and tags it
with `ownerExtension: "my-ext"`. From then on:

```js
await place.do(spaceId, "my-ext:log-meal", { text: "eggs" }, { identity, summonCtx });
```

### What the dispatcher does

For each `place.do(...)` call, the verb in
[`../seed/ibp/verbs.js:85`](../seed/ibp/verbs.js#L85) runs:

1. Look up `"my-ext:log-meal"` in the registry.
2. Read-only-origin gate (filesystem-origin matter rejects writes
   unless an extension opted out).
3. Stance authorization (`authorize`), namespace-aware: a write to
   `qualities.<ns>` only passes if the actor owns that namespace at
   that position.
4. Call your `handler({ target, params, identity, summonCtx, scaffold })`.
5. Stamp a Fact on the target's reel with `actId` from `summonCtx`
   (unless `skipAudit`).

If your op writes qualities, use the collapsed `do.set` form rather
than calling Mongoose directly:

```js
// Set the whole namespace
await place.do(spaceId, "set", {
  field: "qualities.my-ext",
  value: { lastMeal: "eggs", at: new Date().toISOString() },
}, { identity, summonCtx });

// Set one inner key (atomic; other namespaces and other inner keys untouched)
await place.do(spaceId, "set", {
  field: "qualities.my-ext.lastMeal",
  value: "eggs",
}, { identity, summonCtx });
```

`set` is a seed op; the reducer's `applySetQualities` derives the new
state on the next fold. Per-reel append lock ensures concurrent writes
to different namespaces on the same primitive never clobber each
other.

### What target shapes are allowed

The `targets: [...]` field lists the kinds your op can be invoked
against. The dispatcher does **not** validate that the runtime
`target` matches; your handler does. Validate early:

```js
async handler({ target, params }) {
  if (!target?._id || target.constructor.modelName !== "Space") {
    throw new Error("my-ext:log-meal expects a Space target");
  }
  // ...
}
```

---

## 7. Roles

A **role** is a template a Being wears for a moment. When a SUMMON
arrives at a being-stance, the seed looks up the activeRole, builds
the frame from the role spec, and runs the moment.

Registered at
[`../seed/present/roles/registry.js`](../seed/present/roles/registry.js).

### Minimal role

```js
place.declare.registerRole("meal-logger", {
  name:        "meal-logger",
  see:         ["this-space"],              // preloaded prompt blocks
  canSee:      ["my-ext:read-status"],      // tool names by verb
  canDo:       ["my-ext:log-meal"],
  canSummon:   [],
  canBe:       [],
  prompt:      (ctx) => `You are the Meal Logger at ${ctx.currentSpaceName}.
Log the user's meal. Call my-ext:log-meal exactly once and exit.`,
  respondMode: "async",                     // "async" | "sync" | "none"
  triggerOn:   ["message"],                 // ["message"] | ["schedule"] | hooks
  replyTo:     "asker",                     // "asker" | "chain-initial" | omit
}, "my-ext");
```

### What the registry derives so you don't write it

| Field | How it's derived |
|---|---|
| `permissions` | Union of verbs implied by `canSee`/`canDo`/`canSummon`/`canBe` plus `see`. |
| `respondMode` | Defaults to `"async"`. |
| `triggerOn` | Defaults to `["message"]`. |
| `summon(message, ctx)` | Auto-wrapped with [defaultSummon.js](../seed/present/voices/llm/defaultSummon.js) unless you supply one. |
| System prompt | Auto-assembled: identity + preloaded `see` blocks + capability list + your `prompt(ctx)` body + a time stamp. |

### What `defaultSummon` does for you

For every SUMMON to a being in your role, it:

1. Resolves the LLM client for this being at this position (the
   four-layer space/being lockout walk in
   [`../seed/present/voices/llm/connect.js`](../seed/present/voices/llm/connect.js)).
2. Builds the system prompt: identity line, preloaded `see` blocks,
   capability list, your `prompt(ctx)` body, time.
3. Pushes the SUMMON envelope content as the first user message.
4. Loops: assistant turn, tool calls, tool results, repeat until the
   LLM emits text with no tool call (or `exit.requires` is unmet).
5. Returns `{ text, actId }`.
6. If `replyTo` is set, emits a reply SUMMON to the right stance
   (asker for `"asker"`, chain-initial for `"chain-initial"`).

You only write a custom `summon` when the dispatch shape is unusual
(structural routing, multi-step composition, etc.).

### Exit gate

If the role MUST produce a specific deliverable, declare:

```js
exit: { requires: "my-ext:log-meal" },
```

The loop refuses to terminate until the named tool fires. If the LLM
tries to end early, the loop pushes a corrective system message and
re-enters, capped at `maxToolIterations` (default 15, in
internalConfig).

### Preloaded `see` blocks

The `see` array names resolvers registered through
[`registerSeeResolver`](../seed/present/voices/llm/seeResolvers.js).
Seed ships `this-space`; your extension can add its own:

```js
import { registerSeeResolver } from "../../seed/present/voices/llm/seeResolvers.js";

registerSeeResolver("my-ext-status", async (ctx) => {
  const spaceId = ctx.currentSpaceId || ctx.rootId;
  if (!spaceId) return null;     // null opts this block out for this context
  return await renderStatus(spaceId);
}, "my-ext");
```

Resolvers run in parallel. The assembler joins non-empty results in
declaration order between the identity line and the capability list.

---

## 8. Tools

A **tool** is an LLM-callable function. Every tool tags its verb so
authorization runs the right gate and the prompt assembler groups it
correctly.

### Shape

```js
{
  name:        "my-ext:log-meal",           // matches a registered tool
  verb:        "do",                        // "see" | "do" | "summon" | "be" (required)
  description: "Record one meal at the current position.",
  schema: {                                 // zod or json-schema
    text: z.string().describe("What the user ate."),
  },
  async handler({ text, beingId, spaceId, userId, role, signal }) {
    await place.do(spaceId, "my-ext:log-meal", { text }, {
      identity:  { beingId },
      summonCtx: { actId: ctx.actId },       // threaded by the loop
    });
    return { content: [{ type: "text", text: "Logged." }] };
  },
}
```

Tools are returned from `init()` in the `tools: [...]` array. The
loader registers them through `registerToolBundle`. Tool names are
**not** auto-namespaced (because they must match the strings used in
role `canDo`/`canSee` lists); convention is to prefix with your
extension name yourself.

### How tools find their schema args

The schema fields you declare are merged with seed-injected context
keys (`beingId`, `spaceId`, `userId`, `role`, `signal`) before the
handler runs. The LLM only sees and fills the fields you declare; the
context keys arrive automatically.

### Choosing the verb tag

- **see** for read tools that return data. No state change. Examples:
  `my-ext:read-status`, `my-ext:get-history`.
- **do** for state writes. Examples: `my-ext:log-meal`,
  `my-ext:archive-plan`.
- **summon** for tools that wake another being. The handler may
  internally do `place.be("create-being", ...)` first if needed,
  then `place.summon(stance, message, ...)`. The tool is summon-tagged
  because waking is the point.
- **be** for tools that mutate identity (register, claim, release,
  switch). Most extensions never write these; the seed auth role
  handles them.

---

## 9. Creating beings, use BE

Identity belongs on BE. To spawn a sub-being from inside a SUMMON
handler:

```js
const helper = await place.be("create-being", {
  name:          `helper-${shortId()}`,
  password:      null,                  // auto-generated for AI beings
  operatingMode: "llm",                  // "human" | "llm" | "scripted" | "mixed"
  roles:         ["my-ext:helper"],      // registered role name(s)
  defaultRole:   "my-ext:helper",
  homeSpace:     spaceId,                 // existing space
  parentBeingId: beingId,                 // lineage; defaults to caller
  llmDefault:    null,                    // optional LlmConnection id
}, { identity: { beingId }, summonCtx });
```

Then wake it:

```js
await place.summon(`${realityRoot}/${spaceId}@${helper.name}`, {
  from:    { beingId },
  content: "Please do X.",
  correlation: shortId(),
}, { identity: { beingId }, summonCtx });
```

For a clean LLM-side surface, wrap the BE + SUMMON sequence inside a
single SUMMON-tagged tool so the model sees one call.

---

## 10. Hooks

Hooks are lifecycle pub/sub. Before-hooks run sequentially and can
cancel by returning `false` or throwing. After-hooks run in parallel
and are fire-and-forget.

```js
place.hooks.register("enrichContext", async ({ context, space, meta }) => {
  const ours = meta["my-ext"] || {};
  if (Object.keys(ours).length === 0) return;     // guard: only inject when relevant
  context.myExt = ours;
}, "my-ext");
```

### Hook reference

The full list lives in [`../seed/hooks.js`](../seed/hooks.js) and in
[FACTORY.md](../seed/FACTORY.md) under "Hooks." Common ones:

- `beforeMatter` / `afterMatter`, matter create/edit/delete.
- `beforeSpaceCreate` / `afterSpaceCreate` / `beforeSpaceDelete` /
  `afterSpaceMove`.
- `beforeFact`, enrich a Fact before stamping.
- `beforeLLMCall` / `afterLLMCall`.
- `beforeToolCall` / `afterToolCall`.
- `beforeResponse`, modify the AI response before the client sees it.
- `enrichContext`, **sequential override**; cumulative AI context
  building. Always guard.
- `afterQualityWrite`, `afterScopeChange`, `afterOwnershipChange`,
  `afterBoot`.
- `onDocumentPressure`, `onTreeTripped` / `onTreeRevived`.

Per-handler timeout is 5 seconds, chain timeout 15. Five consecutive
failures from one extension's handler trip a circuit breaker for 5
minutes with a half-open recovery test.

Extensions can also fire their own hooks; namespace them as
`my-ext:eventName`.

---

## 11. DO-trigger subscriptions

Wake a being when a write of a particular shape happens somewhere on
the tree:

```js
place.declare.subscribe(beingId, {
  event:      "afterMatter",
  scope:      { ancestor: someSpaceId },     // | { everywhere: true } | { spaceId }
  filter:     { origin: "web" },              // payload equality / any-of
  priority:   4,                              // BACKGROUND
  coalesceMs: 0,                              // batch matching events in N ms
});
```

The seed fans matching events out as `intent: "do-trigger"` SUMMONs
to the subscribing being's inbox; the role's `summon` interprets
them. Use this for reactive workflows that should fire without
polling.

---

## 12. Scheduled wakes

Fire a SUMMON on a being's inbox at a cadence:

```js
place.declare.schedule(beingId, {
  intervalMs: 60_000 * 30,             // every 30 minutes
  content:    { event: "tick" },
  priority:   4,
});
```

The default emitter sends from `@I-am`. Install a scheduler-being
extension to swap in an embodied emitter.

---

## 13. Seeds (plantable scaffolds)

A **seed** is a recipe that fans out a domain shape when planted.
Operators plant them via `plant`:

```js
// During init
place.seeds.register("food-tracker", {
  description: "Plants a food tracking position with the meal-logger role.",
  plant: async ({ target, identity }) => {
    await place.do(target, "create", {
      kind: "space",
      spec: { name: "food", type: "domain" },
    }, { identity });
    // ... more setup
  },
}, "my-ext");
```

Later, anyone with permission can:

```js
await place.do(parentSpaceId, "plant", {
  seed: "my-ext:food-tracker",
}, { identity, summonCtx });
```

---

## 14. Reading and writing qualities

`qualities.<extension-namespace>` is where extensions store data on a
Being, Space, or Matter. Three peer buckets:

- **`Being.qualities.<ns>`**, per-being data. Persists across role
  changes. Energy balance, auth keys, preferences.
- **`Space.qualities.<ns>`**, per-position data. Goals, governance
  shape, lifecycle state for this space.
- **`Matter.qualities.<ns>`**, per-piece-of-matter data. Tags,
  review status, sync state.

### Read

```js
const data = place.qualities.space.getQuality(space, "my-ext");
// returns the namespace object, or {} when unset

const ns = place.qualities.space.readQualityNamespace(space, "my-ext");
// returns the namespace object, or null when unset
```

### Write

Writes go through the DO verb's `set` operation. The legacy
`setQuality` / `mergeQuality` / `incQuality` / `pushQuality` /
`unsetQuality` methods were retired 2026-05-23; calling them now
throws a migration error. Reason: every write must be a Fact on the
aggregate's reel so the fold has one source of truth. See
[`../philosophy/STAMPER.md`](../philosophy/STAMPER.md).

```js
// Set the whole namespace
await place.do(spaceId, "set", {
  field: "qualities.my-ext",
  value: { goals: [{ id: 1, text: "ship it" }] },
}, { identity, summonCtx });

// Set one inner key (atomic at that key path)
await place.do(spaceId, "set", {
  field: "qualities.my-ext.lastSeen",
  value: new Date().toISOString(),
}, { identity, summonCtx });
```

The seed's stance authorizer enforces namespace ownership: a write
under `qualities.my-ext` requires the actor to own that namespace at
that position. The loader records ownership when you register an op.

### What if you need merge / inc / push semantics?

For now, read the namespace, compute the new value in your handler,
and `do.set` the result. This loses cross-namespace atomicity, but
within-namespace atomicity is preserved by the per-reel append lock.
Richer write operations may return as named ops if a real need
emerges; the principle (every write is a Fact) does not change.

---

## 15. A complete worked example

A `feedback` extension that collects short notes at any space and
exposes a tool the operator can call from any meeting role.

**`extensions/feedback/manifest.js`**

```js
export default {
  name:        "feedback",
  version:     "1.0.0",
  description: "Collect short feedback notes at any position.",
  needs:    { services: [] },
  provides: { tools: true, hooks: { listens: ["enrichContext"] } },
};
```

**`extensions/feedback/index.js`**

```js
import log from "../../seed/seedReality/log.js";

export async function init(place) {
  // 1. DO operation: append-only push to the namespace.
  place.do.registerOperation("append", {
    targets: ["space"],
    async handler({ target, params, identity, summonCtx }) {
      const existing = place.qualities.space.readQualityNamespace(target, "feedback") || {};
      const notes = Array.isArray(existing.notes) ? existing.notes : [];
      const next = [...notes, { text: params.text, at: new Date().toISOString() }].slice(-50);
      await place.do(target._id, "set", {
        field: "qualities.feedback.notes",
        value: next,
      }, { identity, summonCtx });
      return { appended: true };
    },
  });

  // 2. Role: a small assistant that collects one note and exits.
  place.declare.registerRole("feedback-collector", {
    name:        "feedback-collector",
    see:         ["this-space"],
    canDo:       ["feedback:add-note"],
    prompt: (ctx) => `You are the Feedback Collector at ${ctx.currentSpaceName}.
The user just told you something they observed. Call feedback:add-note exactly
once with their text, then exit.`,
    replyTo:     "asker",
    exit:        { requires: "feedback:add-note" },
  }, "feedback");

  // 3. enrichContext: surface the latest note to any LLM at this space.
  place.hooks.register("enrichContext", async ({ context, space }) => {
    const data = place.qualities.space.readQualityNamespace(space, "feedback");
    if (!data?.notes?.length) return;
    const latest = data.notes[data.notes.length - 1];
    context.feedbackLatest = `Most recent feedback at this space: "${latest.text}"`;
  }, "feedback");

  // 4. The tool. The role's canDo points at this name.
  return {
    tools: [{
      name:        "feedback:add-note",
      verb:        "do",
      description: "Append one feedback note to this position's queue.",
      schema: {
        text: { type: "string", description: "What the user said." },
      },
      async handler({ text, beingId, spaceId }) {
        await place.do(spaceId, "feedback:append", { text }, {
          identity:  { beingId },
          summonCtx: this?.summonCtx,
        });
        return { content: [{ type: "text", text: "Noted." }] };
      },
    }],
  };
}
```

That's the whole extension: one operation, one role, one hook, one
tool. The seed handles dispatch, stance auth, Fact stamping, the
fold-on-write that updates the projection, prompt assembly, and reply
emission. Your code is the domain shape.

---

## 16. HTTP routes

If you need an HTTP endpoint (legacy clients, webhooks, file uploads),
return an Express router from `init`:

```js
import express from "express";

export async function init(place) {
  const router = express.Router();
  router.get("/status", async (req, res) => {
    const data = await someQuery();
    place.protocol.sendOk(res, data);
  });
  router.post("/log", async (req, res) => {
    try {
      await place.do(req.body.spaceId, "my-ext:log-meal", { text: req.body.text }, {
        identity: { beingId: req.beingId },
        summonCtx: req.summonCtx,
      });
      place.protocol.sendOk(res, { logged: true });
    } catch (e) {
      place.protocol.sendError(res, 500, place.protocol.IBP_ERR.INTERNAL, e.message);
    }
  });
  return { router };
}
```

The loader mounts it at `/api/v1/<your-ext>/`. Keep routes thin; they
should be shims that dispatch into IBP verbs.

---

## 17. Background jobs

For workers that start at boot and run until shutdown:

```js
export async function init(place) {
  let timer = null;
  return {
    jobs: {
      start() {
        timer = setInterval(async () => {
          await sweepStaleRecords();
        }, 60_000);
        timer.unref();
      },
      stop() {
        if (timer) clearInterval(timer);
      },
    },
  };
}
```

The loader calls `start()` after all extensions initialize and `stop()`
on SIGTERM.

---

## 18. Cross-extension API

If you want other extensions to call into yours, expose helpers via
`exports`:

```js
export async function init(place) {
  return {
    exports: {
      getLatestNote(spaceId) {
        // ...
      },
    },
  };
}
```

A consumer reaches you through `place.scope.getExtensionAtScope`:

```js
const ext = place.scope.getExtensionAtScope("my-ext", spaceId);
const note = ext?.exports?.getLatestNote?.(spaceId);
```

Optional chaining is load-bearing: extensions are optional in the
field. If yours is not installed, the caller silently no-ops.

---

## 19. Stance authorization

Every verb call passes through `authorize` in
[`../seed/ibp/authorize.js`](../seed/ibp/authorize.js). For DO:

1. **Layer 1, facts.** Owner / contributor / role / home / operating
   mode / federation status of the being at this position.
2. **Layer 2, per-position rules.** Walks the ancestor chain looking
   for `qualities.permissions.<verb>.<keyParts>` rules.
3. **Layer 3, extension defaults.** Default rules contributed by
   installed extensions through `provides.defaultPermissions` in
   their manifest.
4. **Layer 4, default deny.** No match means reject (`FORBIDDEN` with
   identity, `UNAUTHORIZED` without).

For a write under `qualities.<ns>`, namespace ownership is enforced
on top: the actor must own that namespace at the target position.
The loader records ownership when you register operations or tools.

If your op needs special permissions, declare them in
`provides.defaultPermissions`:

```js
provides: {
  defaultPermissions: {
    "do:my-ext:admin-purge": { requires: { owner: true } },
    "do:my-ext:read-only":   { requires: {} },          // anyone
    "summon:@my-coach":      { requires: { homeInDomain: true } },
  },
}
```

---

## 20. WebSocket pushes

To push live updates to a being, use `place.websocket.emitToBeing`.
Event names are auto-namespaced.

```js
place.websocket.emitToBeing(beingId, "status-changed", {
  status: "ok",
  at: new Date().toISOString(),
});
// On the wire: event name is "my-ext:status-changed"
```

The client listens on that namespaced name. The seed reserves the
`"ibp"`, `"registered"`, and `"navigate"` event names; emitting any
of those throws.

---

## 21. Anti-patterns

Mistakes that look reasonable but fight the seed.

**Calling Mongoose directly to write a Space/Being/Matter row.** The
fold is the only legitimate projection writer. Direct writes bypass
Fact stamping; the projection diverges from the reel; the next fold
pass either overwrites your write or, if nothing fires, leaves an
audit-invisible difference. Always go through DO.

**Using the retired `qualities.X.setQuality` family.** They throw. Use
`place.do(target, "set", { field: "qualities.<ns>" })`.

**Skipping the `verb` tag on a tool.** Registration rejects. The verb
gate is part of authorization; tools need it.

**Declaring `permissions` on a role.** Derived from your `canX`
arrays. If you set it, you're shadowing the registry's computation.

**Embedding the SUMMON message in your role's `prompt` body.** The
seed pushes the message as the first user-role message in the chat.
Duplicating it in the system prompt makes the LLM react twice and get
confused.

**Putting `create-being` on the DO verb.** Identity is BE's territory.
Use `place.be("create-being", ...)`. The auth-being honors this.

**Forgetting to thread `summonCtx`.** A DO call from inside a SUMMON
handler with no `summonCtx.actId` throws. Every act lives in a moment;
its Fact has to ride the Act that opened that moment. Forward the
`summonCtx` your handler receives down into every DO you call.

**Writing into another extension's `qualities` namespace.** Stance auth
rejects. Each namespace is owned. Even if you have the data, you can't
write it under another extension's name.

**Custom `summon` when the default works.** The default handles 90%
of cases. Write a custom one only when the role needs structural
routing (the only canonical example is a role that picks among
sub-behaviors based on content shape).

---

## 22. Where to read next

- **Manifest contract:** [EXTENSION_FORMAT.md](./EXTENSION_FORMAT.md)
  (note: parts of the qualities section still describe the retired
  write API; trust this README and the seed source over it until it
  catches up).
- **Template extension to copy:** [`_template/`](./_template/).
- **The seed's own contract:** [`../seed/FACTORY.md`](../seed/FACTORY.md).
- **The four verbs in code:** [`../seed/ibp/verbs.js`](../seed/ibp/verbs.js).
- **DO operation registry:** [`../seed/ibp/operations.js`](../seed/ibp/operations.js).
- **Role registry:** [`../seed/present/roles/registry.js`](../seed/present/roles/registry.js).
- **Default summon dispatcher:** [`../seed/present/voices/llm/defaultSummon.js`](../seed/present/voices/llm/defaultSummon.js).
- **Reply emission helpers:** [`../seed/present/intake/replies.js`](../seed/present/intake/replies.js).
- **Stance authorization:** [`../seed/ibp/authorize.js`](../seed/ibp/authorize.js).
- **Hooks list:** [`../seed/hooks.js`](../seed/hooks.js).
- **Loader scoping:** [`./loader.js`](./loader.js).
- **Doctrine (read in order):**
  [`../philosophy/MOMENT.md`](../philosophy/MOMENT.md),
  [`../philosophy/FOLD.md`](../philosophy/FOLD.md),
  [`../philosophy/STAMPER.md`](../philosophy/STAMPER.md),
  [`../philosophy/MATERIALS.md`](../philosophy/MATERIALS.md).
