# Chain-Rebuild — fact chains as the universal build recipe

> _The chain is the truth. Every aggregate is a fold over facts. Therefore: any "build recipe" — any way to construct a piece of the world — is, at its most honest expression, the ordered sequence of facts that would build it. Seeds, replicates, grafts, and federated content are all the same primitive viewed from different angles. The primitive is the chain._

Note: WE SHOULD CONSIDER IF ALL REALITY CHAINS, IN SYSTEM, ARE JUST CALLED BRANCHES, AND ARE BASICALLY BRANCHES OF THE TREEOS. EACH BRANCH IS A 'REALITY' TIMELINE.

SO ALL OPERATIONS, LIKE CREATING A (TIMELINE) CHAIN, OR COPYING A CHAIN, OR GRAFTING A CHAIN, ETC. BECAUSE BRANCH. A BRANCH (on the TreeOS) is an embodied fact chain from various past moments.

you still would have a full branch (acts and facts which is the  full thing, all rings inside and full history), or in most downloading/grafting it would be more the outside shape only and middle would be partially reformed on graft

## What this document is

A working sketch of an architectural direction. Not committed doctrine. The thesis: today's three "build something on the substrate" mechanisms — **seeds**, **replicates**, **federation** — are convergent. Each one's job reduces to "produce a sequence of facts at a new location." If that observation holds, they collapse into one primitive: a portable fact-chain bundle that the substrate replays.

This document names that primitive **chain-rebuild**, lays out the three mechanisms it could subsume, distinguishes where it works cleanly from where it has open design questions, and sketches what migration to it would look like.

## The starting observation

Look at what `harmony/seeds/danceFloor.js` actually does inside its `scaffold(ctx)` callback after the recent substrate-clean cleanups:

```js
await ctx.do(rootSpaceId, "create-space", { name: "dance-floor", type: "domain", size: { x: 30, y: 30 } });
await ctx.do({ kind: "space", id: gridSpaceId }, "create-matter", { name: "drum", content: null, origin: "ibp" });
await ctx.do({ kind: "matter", id: drumMatterId }, "set-matter", { field: "coord", value: { x: 15, y: 15 } });
await ctx.be("birth", { name: `drummer-${id}`, cognition: "scripted", defaultRole: "harmony:drummer", homeId: gridSpaceId });
// ... etc
```

Strip the variable bindings and the loop structure, and what's left is **an ordered list of verb calls**. Each call shapes one fact. The scaffold's *purpose* is to produce that sequence at the operator's chosen location. The JS is incidental — the fact sequence is the actual artifact.

This means the seed's recipe **already is** a fact chain. We just write it in JavaScript.

## The three mechanisms today

### Seeds (imperative chain construction)

A seed today is JS code (a `scaffold` callback) that runs at plant-time and emits facts. The plant moment captures all emitted facts into one ΔF; sealAct commits them atomically.

- **Strengths:** Turing-complete. Conditional logic, loops, parameterization, dynamic ID generation, post-plant wiring (subscriptions, schedules) — all expressible.
- **Costs:** Authors write JS. Every seed lives in extension code. To share a seed, you ship the extension. Operators can't "save my hand-built setup as a seed." Compatibility is brittle (a seed file from extension v1 may not load against v2).

### Replicates (current-state snapshot)

A replicate today is a JSON bundle capturing the **current projected state** of a subtree — spaces, beings, matter with their qualities — under a fresh ID namespace. Graft replays the bundle as fresh creation facts at the receiver.

- **Strengths:** Operator-driven. Anyone can replicate any subtree they have access to. No code required. Shareable as data.
- **Costs:** History does not transfer. Post-creation wiring (subscriptions, schedules) is **not captured** — the operator manually re-wires after graft. Parameters don't exist; you graft the snapshot as-is.

### Federation (incremental fact streaming)

Federation today (`protocols/ibp/FEDERATION.md`) propagates **individual facts** across realities at write-time. Foreign IDs get remapped at the boundary; the receiving reality stamps fresh local facts that echo the remote one's intent.

- **Strengths:** Continuous. Live-updating shared content across realities.
- **Costs:** Each fact is its own act. No batching, no recipe-level identity. The receiving reality doesn't know "this fact is part of a logical group" without inferring it from correlations.

## The convergence

Stop and look at the three:

| Mechanism | What it produces at the destination |
|---|---|
| Seed plant | An ordered sequence of facts, atomically sealed |
| Replicate graft | An ordered sequence of facts, atomically sealed |
| Federation propagation | A sequence of facts, sealed one at a time |

The output is identical: **facts on the receiver's reels**. Differences:

- **Author:** seed = code, replicate = operator action, federation = wire event
- **Bundle integrity:** seed + replicate seal atomically; federation streams
- **Parameterization:** seed = full code, replicate = none, federation = wire-shaped

Three substrates, one primitive answer. **Chain-rebuild** names that primitive.

## What chain-rebuild would be

A chain-rebuild artifact is:

- An ordered list of fact specs (verb, action, target, params)
- Plus parameter-hole declarations (named slots the operator fills at replant)
- Plus an ID-mapping policy at the seams (target placeholders like `$rootSpace`, `$drum`, `$drummer` that bind to local IDs at replay)

The substrate's job at replay:

1. Walk the bundle in order.
2. Substitute parameter holes with operator-supplied values.
3. Resolve `$placeholder` references against the substitution table (where prior steps have stamped their IDs).
4. Dispatch each fact spec through the verb dispatcher with the planter's identity + the plant moment's summonCtx.
5. Seal atomically when the chain completes.

The format:

```jsonc
{
  "kind": "chain-rebuild",
  "version": 1,
  "parameters": [
    { "name": "gridSize", "type": "object",  "default": { "x": 30, "y": 30 } },
    { "name": "dancers",  "type": "integer", "default": 5 }
  ],
  "chain": [
    {
      "id": "$gridSpace",
      "verb": "do", "target": "$rootSpace", "action": "create-space",
      "args": { "name": "dance-floor", "type": "domain", "size": "$gridSize" }
    },
    {
      "id": "$drum",
      "verb": "do", "target": { "kind": "space", "id": "$gridSpace" }, "action": "create-matter",
      "args": { "name": "drum", "content": null, "origin": "ibp" }
    },
    {
      "id": "$drummer",
      "verb": "be", "operation": "birth",
      "payload": { "name": "drummer", "cognition": "scripted", "defaultRole": "harmony:drummer", "homeId": "$gridSpace" }
    },
    // ... etc
  ]
}
```

Every entry maps 1:1 to a substrate verb call. Every reference between entries is a placeholder. The receiver's local IDs land in the placeholder table as the chain replays.

## How it replaces each mechanism

### Replaces seeds (the imperative case)

**The 80% case:** seeds that are "build this starting shape with a few knobs" — dance floor, garden, lab template, blog skeleton — become chain-rebuild bundles. No JS. Just data.

**The 20% case:** seeds that need real Turing-complete logic (orchestrators with conditional wirings, schedule curves derived from runtime measurements) stay as code. But they become the documented exception, not the default. Most extensions ship zero seed JS.

### Replaces grafting (the snapshot case)

A replicate today captures **state**. A chain-rebuild bundle captures **the build that produced the state**. The substrate already has the build — every aggregate's reel IS the chain that built it. To replicate a subtree, you walk its constituent reels, collect every fact that targets the subtree's aggregates, and emit them as a chain-rebuild bundle.

The receiver doesn't reconstruct state from a frozen snapshot. The receiver **replays the build** as fresh local facts. Same end state, but the receiving substrate's chain is honest: "I rebuilt this from a recipe" not "I imported state from elsewhere."

This also captures the post-creation wiring that today's replicates lose — every subscription, every scheduled wake, every qualities write is just another fact in the chain.

### Possibly replaces federation (the stream case)

Federation today is "one fact at a time across the wire." A chain-rebuild bundle is "many facts in one bundle." These are points on the same spectrum:

- Federate one fact = chain-rebuild bundle of length 1
- Federate a coherent build = chain-rebuild bundle of length N, batched at the source
- Operator-driven graft = chain-rebuild bundle authored by the source operator

The shape unifies. Federation becomes "stream of small chain-rebuild bundles." Replicate becomes "operator-authored chain-rebuild bundle." Seed becomes "extension-shipped chain-rebuild bundle." Three names, one format.

## Where it works cleanly

- **Deterministic single-shot construction:** every seed and graft case today.
- **Capture from existing state:** replicating an aggregate's reel by reading the actual stamped facts is mechanical.
- **Sharing recipes:** the bundle is data. Send it over any channel.
- **Audit:** the receiver's chain IS the bundle, with local-ID substitution applied. Replay = re-audit.
- **Versioning:** bundles carry their format version. Migration is shape-rewriting; substrate doctrine stays stable.

## Where it has open questions

These are real and need design before chain-rebuild can subsume seeds entirely:

### Conditional logic

A seed today can branch:

```js
const cognition = isLlmDancer ? "llm" : "scripted";
```

A chain-rebuild bundle is a flat list. It needs **either** a small expression sublanguage (`{ $if: ..., then: [...], else: [...] }`) **or** the bundle author pre-resolves all branches before replay. First option is cleaner doctrinally but introduces a DSL. Second is simpler but moves logic into a build step.

### Loops

```js
for (const spec of DANCER_ROSTER) { ... }
```

Same question. `{ $for: { each: "$dancers", do: [...] } }` is one answer. Or pre-expand the loop into N explicit chain entries at bundle-author time.

### Forward references

In the dance floor, the drummer's wake schedule references the drummer's just-minted beingId:

```js
const drummerResult = await ctx.be("birth", { ... });
await reality.declare.schedule(drummerResult.beingId, { ... });
```

The chain-rebuild equivalent uses `$drummer` as a placeholder that resolves to whatever beingId the birth verb returned at replay. This works IF the substrate's verb dispatcher reliably returns the new ID and the replay engine threads it into the substitution table. Mechanical, but needs to be specified.

### Dynamic content from runtime measurement

A few existing seeds compute values from the runtime — "set this LLM connection to the operator's current default," "size the grid to fit the current screen." A chain-rebuild bundle either captures the **value at bundle-author time** (fine for most cases) or needs an expression layer that reads from the receiving substrate at replay (an escape hatch, doctrinally heavy).

### Side effects on external systems

Some seeds call out (npm install, fetch a remote asset, register with an external service). Pure facts can't express that. These stay as code; the JS escape hatch never fully retires.

## The migration sketch

If this direction is taken, the path is roughly:

1. **Stage 0 (now):** Document chain-rebuild as a thinking-document. Ship no code. Use it to discipline current design choices (every new substrate-public API should be "expressible as a fact spec" when possible).

2. **Stage A:** Implement the bundle format and the replay engine. Add `reality.do.replayChain(bundle, params)` as a substrate primitive. Convert one trivial seed (an empty space with a name and an owner) to a bundle. Verify the round-trip.

3. **Stage B:** Add the parameter-hole substitution + `$placeholder` resolution. Convert a small parameterized seed (one of the simpler ones in the seed roster). Establish the expression-layer rules (if any) for `$if` / `$for`.

4. **Stage C:** Capture-from-existing — implement "replicate a subtree as a chain-rebuild bundle" by walking the subtree's reels. Verify graft-via-replay produces a tree functionally identical to the source.

5. **Stage D:** Federation rewrite to emit chain-rebuild bundles (length 1 for individual facts, longer for batched updates).

6. **Stage E:** Migrate existing seeds. The 80% case (declarative scaffolds) becomes bundles. The 20% case (real logic) stays code, possibly with a `provides.seeds.code` shape for clarity. Most extensions stop shipping seed JS.

7. **Stage F:** Replicate / graft retire as separate primitives. The vocabulary collapses: there's just "rebuild this chain at my place."

Each stage is independently validable. Stage F is the asymptote, not the next step. The substrate could sit at Stage C indefinitely if it's good enough.

## Why this matches TreeOS doctrine

TreeOS already commits to:

- **The chain is the truth.** Every aggregate is a fold over facts.
- **Place is folded from facts**, never stored authoritatively.
- **Facts as projection (CQRS doctrine):** fields on disk are cached projections of the chain.

Chain-rebuild extends that commitment one level up: **any build recipe is also a chain.** A seed is a chain. A replicate is a chain. A federated update is a (short) chain. The substrate's primitive remains the fact; everything that produces facts converges to the same shape.

The framing question that decides whether to commit: *do we believe the chain is the most honest expression of "what this thing IS"?* TreeOS already answered yes for state. Chain-rebuild answers yes for builds.

## What this document is NOT (yet)

- A spec. The format above is illustrative. Real spec needs to handle target normalization, error modes, partial-replay-on-failure, atomicity guarantees, and bundle signing for federation.
- A commitment to ship. Stages A through F are the path **if** we commit. We haven't.
- A retirement notice for seeds. Imperative seed code stays as the 20% escape hatch indefinitely.
- A replacement for replicate / publishing. Those docs describe what's built today. This doc describes a direction those mechanisms could converge toward.

When a decision is made on whether to commit, this document either gets promoted to spec (replacing parts of `publishing.md`) or filed in `seed/done/` as an explored-and-passed-on direction.

## Why now is the right moment to write this down

The recent substrate cleanups already point this direction:

- `ctx.do / ctx.see / ctx.be / ctx.summon / ctx.read` make handlers and scaffolds use the substrate-public surface uniformly.
- Auto-namespacing at `reality.declare.*` registration means bundle entries don't need to think about prefixes.
- The planter ctx + flat birth payload mean a seed is already "a sequence of substrate verb calls with flat args."
- The recent `spec:` wrapper flatten lets each call shape match the most honest 1:1 mapping to a fact.

If a chain-rebuild bundle entry can be written as `{ verb: "do", action: "create-space", args: { name: "..." } }` — exactly mirroring `ctx.do(rootSpaceId, "create-space", { name: "..." })` — then the gap between "a seed's code" and "a chain-rebuild bundle's data" has been closing the whole time. This doc is an observation more than a proposal: the direction was already there. We just hadn't named it.
