# innerFace: the one face all souls see

Sibling doctrine to [stamperUpgrade.md](stamperUpgrade.md) (which named
the orientation: roles do the architectural work, soul is just the
cognition label) and [innerFaceLive.md](innerFaceLive.md) (which covers
the reactive per-stance subscription system the human portal uses).

This doc pins the concrete invariant: one inner face per moment, shared
across all souls, and that shared face is what makes `role.canSee`
actually mean something.

## The concept

Every moment computes ONE inner face. The three souls (human, llm,
scripted) all consume the same inner face. The cognition type
determines how the face is PRESENTED to the soul (LLM formats it into
prompt context, human renders it through the portal, scripted reads it
as a data object) and how the decision flows back into an act. The
face itself is identical for all three.

`role.canSee` is the load-bearing filter. The role declares what gets
into the inner face. Whichever soul is animating the Name, they see
what the role permits, and nothing else.

## The canonical shape

The inner face that landed:

```
innerFace = {
  orientation,            // "forward" | "half" | "inward"
  role,                   // the active role name at this moment
  position: { id, name }, // where the being stands
  capabilities,           // { canDo, canSummon, canBe } from the role
  blocks,                 // canSee-resolved face blocks, see below
  origin,                 // "local" (fold-built) | "foreign" (cross-world)
  weave,                 // the reels this face actually read, see below
}
```

Built once per moment by `buildInnerFace(role, ctx)` at
[reality/seed/present/beats/2-fold/innerFace.js](../../seed/present/beats/2-fold/innerFace.js).
Lives on `summonCtx.innerFace` during the moment, sealed onto
`Act.innerFace` at moment seal.

### blocks

`role.canSee` is a list of entries. Each entry is either an IBP address
(`"./inbox"`, `"/foo/bar"`, `"<other-reality>/..."`) or a registered
named-see name (`"my-inbox"`, `"federation-status"`, etc.). The 2-fold
beat's resolver
([canSeeResolver.js](../../seed/present/beats/2-fold/canSeeResolver.js))
runs each entry, producing a structured block:

```
block = {
  key,      // the canSee entry that produced it
  source,   // "address" | "see"
  label,    // human-readable label
  payload,  // descriptor object, structured data, or string
}
```

`blocks` is the ordered list of these. Empty canSee yields `blocks: []`;
the face is still substantive (orientation + role + position +
capabilities), just with no perception payload.

### weave

The set of reels the fold actually read while building this face:

```
weave = [
  { reelKind: "being"|"space"|"matter", reelId, branch },
  ...
]
```

Ordered, deduplicated by `reelKey({reelKind, reelId, branch})`. Built at
fold time by two paths that get merged:

1. `foldPlace` records the position space's reel as it folds the
   forward face.
2. The canSee resolver records every reel each block actually read:
   address-shape entries call `seeVerb` which returns a descriptor,
   and `recordDescriptorReels` walks that descriptor's
   `address.spaceId`, `address.being`, `beings[]`, and `matters[]`
   adding each reel; named-see handlers whose payload is descriptor
   shaped get the same auto-detection.

The weave is the RESIDUE of what the face actually uses, not the
upper bound of what canSee could theoretically admit. A face with
`canSee: ["place"]` at a 5-occupant position has 7 entries (self +
space + 5 occupants). A face with `canSee: []` has 2 entries
(self being + position space).

This residue is the spine of three things:

- **Audit.** `Act.innerFace.weave` records exactly what reels the
  cognition perceived through when deciding the act. Replay knows the
  reel snapshot the face was bound to.
- **Subscription dispatch.** [innerFaceLive.md](innerFaceLive.md)
  covers the reactive per-stance subscription. The weave is the
  trigger key set: a fact landing on any reel in the weave wakes the
  subscription.
- **Conflict (handled by chain, not here).** The existing chain CAS +
  reel-head locks handle seal-time conflicts. The weave isn't a
  conflict token; the chain's own integrity is. LLMs and scripted that
  hold a static snapshot retry through the existing refold-and-retry
  path when seal fails.

A note on what's NOT in the weave today: roles are not reel-backed
(the role registry is an in-memory Map populated by `registerRole`).
Role flips manifest as facts on the being's reel (via
`qualities.roleFlow`), so the being-reel entry already covers role
change wakeups. If a Role primitive ever becomes reel-backed, the
weave shape accepts it without change.

### origin

`"local"` for normal forward / half / inward folds. `"foreign"` for
faces produced by `normalizeForeignDescriptor` when a cross-world
responder writes the foreign reality's descriptor onto the actor's
Act. Foreign faces carry an empty weave locally (the foreign
reality's reels live over there; no local reel-arrival to trigger on).
Foreign reactive push is a separate channel that doesn't exist yet.

## How souls consume the same face

**LLM.** The system prompt builder
([assemble.js](../../seed/present/cognition/llm/assemble.js)) calls
the formatter at
[innerFaceFormat.js](../../seed/present/cognition/llm/innerFaceFormat.js)
on `ctx.innerFace.blocks` to produce prompt prose. The LLM's
reformatting for its consumer is correct and expected; only the
resolution itself (per-block) is single-pass.

**Scripted.** `role.summon(message, ctx)` receives `ctx.innerFace` as
a data object. The role's logic can dispatch on
`ctx.innerFace.blocks` for perception-aware decisions. Mechanism is
wired (the face lands on ctx the same as for LLM); no scripted role in
the repo today demonstrates the consumer, though. When a scripted
role wants perception-aware behavior, it reads `ctx.innerFace.blocks`
the same way the LLM's formatter does.

**Human.** The portal calls `client.see("my-inner-face", {live: true})`
on each navigate. The seed-side SEE op
([myInnerFace.js](../../seed/present/cognition/human/myInnerFace.js))
folds + builds the inner face + returns it (and registers the
subscription per innerFaceLive.md). The portal renders the face
through its existing flat/3D renderers. The renderer's job is to
take this canonical shape and present it as panels (flat) or scene
elements (3D). No separate compute, no separate canSee resolution.

**Cross-world.** The cross-world responder
([past/act/innerFace.js](../../seed/past/act/innerFace.js)) takes
the foreign reality's descriptor, runs `normalizeForeignDescriptor` to
shape it as a canonical face with `origin: "foreign"`, and writes to
the same `Act.innerFace` field. Overrides the local face post-seal.
The receiver renders the foreign blocks the same way they render
local ones; the only thing missing locally is reactive push for
foreign-side changes.

## What this gets us

**canSee actually means something for every soul.** The same role used
by an LLM, a script, and a human produces the same perception for all
three. Switching a role's canSee changes every cognition's view. No
soul gets a different view because of a code-path that didn't consult
canSee.

**Code-cognition beings are honest auditees.**
[project_code_cognition_beings](../../seed/done/) says scripted beings
are first-class citizens. The unified inner face means scripted
decisions carry the same audit trail as LLM and human decisions; the
`Act.innerFace` records what the script perceived before acting.

**Cross-world doctrine collapses into local doctrine.** The cross-world
inner face is the same field with `origin: "foreign"`. Renderers
treat foreign blocks the same as local blocks (with a small badge in
the flat portal so the operator sees the source). The doctrine shrinks
to: every act has an inner face.

**Reactive perception** falls out from the weave. The subscription
system in [innerFaceLive.md](innerFaceLive.md) uses the weave as the
trigger key; when any reel in the weave gains a fact, the
subscription refolds and pushes a fresh face. Humans see live updates;
LLMs and scripts work on their moment-start snapshot.

## Open

**Scripted demonstrator.** The mechanism is wired but no scripted role
in the repo reads `ctx.innerFace.blocks` for perception-aware
decisions yet. When the first scripted consumer lands, the doctrine
gets a concrete example to point at. Until then, the "all three souls
see the same canSee" doctrine is structurally true but only
demonstrably exercised by LLM + human.

**Non-descriptor named-see ops and the weave.** Handlers like
`my-inbox`, `connections`, `federation-status`, `llm-connections`,
`http-stats`, `mongo-stats` return non-descriptor payloads. Their
reel reads aren't structurally visible to the resolver's
descriptor-shape auto-detection, so they don't contribute to the weave.
Reactive subscriptions don't wake on changes in those views. Two
paths: accept this as a permanent upper bound (the inbox view is
polled, not pushed), or migrate handler-by-handler to return the
`{payload, reels}` envelope. The choice depends on whether anyone
actually wants reactive push for those views.

**Foreign reactive push.** Cross-world faces carry empty weave
locally. To get reactive updates when the foreign reality changes, a
federation push channel would have to exist on the foreign side
relaying its weave-keyed events. Real but explicit deferred work.

## Files

- [reality/seed/present/beats/2-fold/innerFace.js](../../seed/present/beats/2-fold/innerFace.js)
  builds the canonical face (`buildInnerFace`, `clampForRender`,
  `normalizeForeignDescriptor`).
- [reality/seed/present/beats/2-fold/canSeeResolver.js](../../seed/present/beats/2-fold/canSeeResolver.js)
  resolves canSee entries into blocks and records the weave.
- [reality/seed/present/beats/2-fold/weave.js](../../seed/present/beats/2-fold/weave.js)
  defines the weave shape and helpers (`addReel`, `mergeWeaves`,
  `reelKey`).
- [reality/seed/present/beats/2-fold/foldPlace.js](../../seed/present/beats/2-fold/foldPlace.js)
  folds the forward face and contributes the space reel to the weave.
- [reality/seed/present/beats/2-fold/foldBeat.js](../../seed/present/beats/2-fold/foldBeat.js)
  is the conductor that threads role into the fold.
- [reality/seed/past/act/act.js](../../seed/past/act/act.js) carries
  `Act.innerFace` as the storage field.
- [reality/seed/past/act/innerFace.js](../../seed/past/act/innerFace.js)
  is the cross-world responder that writes the foreign-origin face.
- [reality/seed/present/cognition/human/myInnerFace.js](../../seed/present/cognition/human/myInnerFace.js)
  is the SEE op the portal calls.
- [reality/seed/present/cognition/llm/innerFaceFormat.js](../../seed/present/cognition/llm/innerFaceFormat.js)
  formats blocks into LLM prompt prose.

## See also

- [stamperUpgrade.md](stamperUpgrade.md) on roles as the architectural
  work, soul as the cognition routing label.
- [innerFaceLive.md](innerFaceLive.md) on the reactive per-stance
  subscription system that uses the weave to drive humans live.
- [names.md](names.md) on the Name/Soul/Being separation.
- [plan.md](plan.md) on the Name primitive refactor in flight.
