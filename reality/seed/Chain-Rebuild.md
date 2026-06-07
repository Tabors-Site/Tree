# Chain-Rebuild — fact chains as the universal build recipe

> _The chain is the truth. Every aggregate is a fold over facts. Therefore: any "build recipe" — any way to construct a piece of the world — is, at its most honest expression, the ordered sequence of facts that would build it. Seeds, replicates, grafts, and federated content are different **authoring patterns** for the same underlying artifact: a chain of facts the substrate can replay at a destination. The primitive is the chain. Everything else is which author wrote it, how atomic the seal is, and how the receiver discovered it._

## Vocabulary (pinned up front)

These three concepts stay distinct. The document uses them precisely throughout. The cleanest-primitive directive depends on these scopes not collapsing into each other.

| Term | What it names | Scope |
|---|---|---|
| **Reality** | A TreeOS deployment — the whole tree. The substrate, the genesis content, every aggregate, every branch ever spawned. | The container. |
| **Branch** | One timeline within a reality. A specific reel of moments. Beings within a branch experience their reel as the texture of time. At genesis, the canopy (`#0`) is structurally all the reality is, because no other branch has been spawned yet — but reality stays the container; branches multiply within it. | A timeline within the container. |
| **Chain-rebuild** | The substrate primitive for capturing the facts that built (a piece of) a branch and replaying them at a destination. Operates on branches and subtrees within them. Does **not** dissolve the reality-vs-branch distinction. | The move-content-between-branches primitive. |

**Why this distinction matters.** A being lives within a branch and perceives its reel as time. Cross-branch movement (within one reality) and cross-reality movement (across deployments) are different operations on the same chain-rebuild primitive. If reality and branch were the same thing, the distinction would blur and the substrate would have to invent it back. Keeping them distinct is cleaner.

## What this document is

A working sketch of an architectural direction. Not committed doctrine. The thesis: today's three "build something on the substrate" mechanisms — **seeds**, **replicates**, **federation** — are convergent. Each one's job reduces to "produce a sequence of facts at a destination." If that observation holds, they collapse into one primitive (**chain-rebuild**) with three authoring patterns sitting above it.

This document names the primitive, pins the vocabulary, lays out the three mechanisms it would subsume, distinguishes where it works cleanly from where it has open design questions, and sketches what migration would look like.

**Discipline:** one primitive. No same-thing-twice. If the chain-rebuild move lands, the substrate stops having "seeds" and "replicates" and "federation" as distinct primitives — they become **authoring patterns** for chain-rebuild artifacts. Whatever's left as a distinct mechanism is whatever genuinely can't be expressed as a fact sequence (the escape hatch).

## The starting observation

Look at what `harmony/seeds/danceFloor.js` actually does inside its `scaffold(ctx)` callback after the recent substrate-clean cleanups:

```js
await ctx.do(rootSpaceId, "create-space", { name: "dance-floor", type: "domain", size: { x: 30, y: 30 } });
await ctx.do({ kind: "space", id: gridSpaceId }, "create-matter", { name: "drum", content: null, origin: "ibp" });
await ctx.do({ kind: "matter", id: drumMatterId }, "set-matter", { field: "coord", value: { x: 15, y: 15 } });
await ctx.be("birth", { name: `drummer-${id}`, cognition: "scripted", defaultRole: "harmony:drummer", homeId: gridSpaceId });
// ... etc
```

Strip the variable bindings and the loop structure, and what's left is **an ordered list of verb calls**. Each call shapes one fact. The scaffold's *purpose* is to produce that sequence at the operator's chosen location on the destination branch. The JS is incidental machinery — the fact sequence is the actual artifact.

This means the seed's recipe **already is** a fact chain. We just write it in JavaScript today.

The recent `spec:` wrapper flatten removed the last asymmetry: every action's `args` shape on the caller side now maps 1:1 to that fact's `params` shape on the chain. `ctx.do("create-space", { name, type, size })` produces a fact whose params are exactly `{ name, type, size }`. There's no translation step between "what the seed author writes" and "what the substrate stamps."

## The three mechanisms today

### Seeds — code-authored chain construction

A seed today is JS code (a `scaffold` callback) that runs at plant-time and emits facts. The plant moment captures all emitted facts into one ΔF; sealAct commits them atomically to the planter's branch.

- **Strengths:** Turing-complete. Conditional logic, loops, parameterization, dynamic ID generation — all expressible in the host language.
- **Costs:** Authors write JS. Every seed lives in extension code. To share a seed, you ship the extension. Operators can't "save my hand-built setup as a seed." Compatibility is brittle (a seed file from extension v1 may not load against v2).

### Replicates — operator-authored snapshot capture

A replicate today is a JSON bundle capturing the **current projected state** of a subtree on some branch — spaces, beings, matter with their qualities — under a fresh ID namespace. Graft replays the bundle as fresh creation facts at the destination branch.

- **Strengths:** Operator-driven. Anyone can replicate any subtree they have access to. No code required. Shareable as data.
- **Costs:** History does not transfer — only current shape. Post-creation wiring (subscriptions, schedules) is captured *only insofar as those mechanisms are already fact-shaped* (see "Audit" below). Parameters don't exist; you graft the snapshot as-is.

### Federation — wire-streamed fact propagation

Federation today (`protocols/ibp/FEDERATION.md`) propagates **individual facts** across realities at write-time. Foreign IDs get remapped at the boundary; the receiving reality stamps fresh local facts that echo the remote one's intent.

- **Strengths:** Continuous. Live-updating shared content across realities.
- **Costs:** Each fact is its own act. No batching, no recipe-level identity. The receiving reality doesn't know "this fact is part of a logical group" without inferring it from correlations.

## The convergence

Stop and look at the three:

| Mechanism | What it produces at the destination | Atomicity | Author |
|---|---|---|---|
| Seed plant | An ordered sequence of facts | Atomic (one moment) | Extension code |
| Replicate graft | An ordered sequence of facts | Atomic (one moment) | Operator artifact |
| Federation propagation | A sequence of facts | Streamed (per-fact) | Wire event |

The output is identical: **facts on the destination branch's reels**. Differences:

- **Author:** code, operator, wire.
- **Atomicity:** atomic seal vs. streaming protocol.
- **Discovery:** extension manifest, operator-held artifact, network peer.
- **Trust context:** extension trust, operator trust, cross-reality trust.

Three mechanisms, one underlying artifact. **Chain-rebuild** names the underlying artifact. The three mechanisms become three **authoring patterns** producing chain-rebuild artifacts. The substrate gains one primitive (replay a chain at a destination) and the existing complexity is sorted into the four dimensions above (author / atomicity / discovery / trust) where it actually lives.

## What chain-rebuild would be

A chain-rebuild artifact is:

- An ordered list of fact specs (verb, action, target, params)
- Plus parameter-hole declarations (named slots the destination operator fills at replay)
- Plus an ID-mapping policy at the seams (placeholders like `$rootSpace`, `$drum`, `$drummer` that bind to local IDs as the chain replays)

The substrate's job at replay:

1. Walk the bundle in order.
2. Substitute parameter holes with operator-supplied values.
3. Resolve `$placeholder` references against the substitution table (where prior steps have stamped their IDs).
4. Dispatch each fact spec through the verb dispatcher with the planter's identity + the plant moment's summonCtx.
5. Seal atomically (or per-fact, depending on the authoring pattern).

The format (illustrative; not committed spec):

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
    }
    // ... etc
  ]
}
```

Every entry maps 1:1 to a substrate verb call. Every reference between entries is a placeholder. The destination branch's local IDs land in the placeholder table as the chain replays. **Because of the recent fact-format flatten, the `args` shape in each entry is literally identical to the action's params shape on the wire and in the stamped fact.** No translation layer.

## How each authoring pattern fits

The doctrine: chain-rebuild is the artifact; seeds, replicates, federation become authoring patterns producing it.

### Seeds — code that emits a chain-rebuild

The 80% case (scaffolds that are "build this starting shape with a few knobs") become chain-rebuild bundles authored statically. No JS. Just data shipped in the extension manifest.

The 20% case (real Turing-complete logic — orchestrators with conditional wirings, schedule curves derived from runtime measurements, side effects on external systems) stays as code. The code produces the chain-rebuild artifact at plant-time rather than emitting facts directly. The substrate's primitive is unchanged; the producer is still Turing-complete.

### Replicates — branch-walking that emits a chain-rebuild

Today's replicate captures **state**. The chain-rebuild reformulation captures **the chain that produced the state**. To replicate a subtree on a branch, walk the constituent reels, collect every fact that targets the subtree's aggregates, and emit them as a chain-rebuild artifact.

The destination doesn't reconstruct state from a frozen snapshot. The destination **replays the chain** as fresh local facts on its own branch. Same end state, but the destination branch's history is honest: "I rebuilt this from a recipe" not "I imported state from elsewhere."

This captures the post-creation wiring **insofar as the wiring is fact-shaped** (see "Audit" below).

### Federation — chain-rebuild plus a streaming protocol

Federation isn't "chain-rebuild with N=1." It's "chain-rebuild plus a streaming protocol on top." The streaming protocol is real architectural surface — continuous propagation, per-fact authorization, eventual consistency, peer health, retry semantics.

The honest framing: federation propagates chain-rebuild artifacts of varying length (often 1, sometimes more for batched updates) over a continuous wire. The artifact format unifies; the transport remains a distinct concern.

## Where it works cleanly

- **Deterministic single-shot construction:** every seed and graft case today.
- **Capture from existing state:** walking a subtree's reels to extract its building chain is mechanical.
- **Sharing recipes:** the bundle is data. Send it over any channel.
- **Audit:** the destination branch's chain IS the bundle, with local-ID substitution applied. Replay = re-audit.
- **Versioning:** bundles carry their format version. Migration is shape-rewriting; substrate doctrine stays stable.

## Where it has open questions

These are real and need design before chain-rebuild can subsume seeds entirely.

### Conditional logic and loops — pre-resolve at bundle-author time, no DSL

A seed today branches and loops in JS:

```js
const cognition = isLlmDancer ? "llm" : "scripted";
for (const spec of DANCER_ROSTER) { ... }
```

A chain-rebuild bundle is a flat list. The temptation is to add an expression sublanguage — `{ $if: ..., then: [...], else: [...] }`, `{ $for: { each: "$dancers", do: [...] } }`. **Resist this.** A DSL compounds:

- `$if` makes you want `$and`, `$or`, `$not`.
- Comparison operators want type coercion rules.
- `$for` wants iterators, index variables, accumulators.
- Once any of this lands, you've reinvented a programming language inside JSON, and badly.

**The discipline:** keep bundles strictly declarative. Push logic into the **producer**. Two cases:

1. **Static parameterization** (build N dancers based on a parameter): pre-expand the loop into N explicit chain entries at bundle-author time. The bundle gets longer; it stays simple. The producer is allowed to be Turing-complete because the producer is one of the authoring patterns above.
2. **Truly dynamic conditions** (cognition depends on receiver-side runtime state): can't capture in a static bundle. Falls into the 20% escape hatch where code is still needed.

The bundle is the artifact, not the program. If you want a program, write a producer.

### Forward references — bounded engineering, needs explicit spec

In the dance floor, the drummer's wake schedule references the drummer's just-minted beingId. The chain-rebuild equivalent uses `$drummer` as a placeholder.

Spec needed:

- Each chain entry that mints an aggregate declares its placeholder name (`"id": "$drummer"` in the entry).
- Subsequent entries reference by placeholder, not by stale ID.
- The replay engine maintains the substitution table and substitutes at dispatch time, in chain order.

This is bounded engineering. The verb dispatcher already returns the new ID for create-X and be:birth. The replay engine threads it into the table. Mechanical, but worth writing down explicitly to nail error cases (unknown placeholder, cycle, double-binding).

### What's actually fact-shaped vs. runtime registration

The claim "chain-rebuild captures every wiring" is **aspirational, not actual**. An audit is needed before committing to it.

Already fact-shaped (chain-rebuild captures cleanly):

- **Spaces, beings, matter, qualities writes** — every CRUD action stamps a fact.
- **Wakes / schedules** — `wake-scheduled` and `wake-cancelled` facts on the being's reel (the recent wakes-as-facts work). Recipe IS the truth of liveness.
- **Branch operations** (create-branch, pause-branch, etc.) — fact-shaped.

Currently runtime registration (NOT yet fact-shaped — gaps to scope before chain-rebuild can claim full coverage):

- **Hook listeners.** Extensions register hook handlers in their init() callbacks. The registration lives in an in-process map. A replicate cannot capture it because there's no fact for it.
- **DO-trigger subscriptions.** Same shape — registered at extension load time into an in-memory registry.
- **Service bundles, SEE-resolvers, descriptor derivers.** Extension-load-time registrations.
- **Tool / role registrations.** Module-load-time; not facts.

The pattern: anything an extension registers in `reality.declare.X` or `init()` lives in runtime memory, not the chain. The wakes-as-facts work is the template for migrating each of these to fact-shaped — `subscription-registered` facts, `hook-listener-registered` facts, etc. — but those arcs are independent of chain-rebuild and worth scoping separately.

**The honest claim chain-rebuild can make today:** it captures everything the substrate has already made fact-shaped. The rest is a separate migration arc (runtime-registration → fact-stamped) that complements chain-rebuild rather than blocking it.

### Dynamic content from runtime measurement

A few existing seeds compute values from the runtime — "set this LLM connection to the operator's current default," "size the grid to fit the current screen." The split:

- **Author-time capture:** the producer reads the value at bundle-author time and bakes it into the chain entry. Works for most cases.
- **Receiver-time evaluation:** the chain needs an expression layer that reads from the receiving substrate at replay. This is the "escape hatch heavy" case. Stays as code in the 20%.

### Side effects on external systems

Some seeds call out — npm install, fetch a remote asset, register with an external service. Pure facts can't express these. They stay as code. The JS escape hatch never fully retires.

## Three trust contexts, one primitive

The three authoring patterns run under different trust contexts. The unified chain-rebuild primitive has to handle all three, but each is enforced at a different layer:

| Authoring pattern | Who's trusted | Where the check lives |
|---|---|---|
| **Seed plant** | Extension ships the bundle as part of its manifest; the operator is implicitly trusting the extension when they installed it. | Extension trust at install time + the planter's stance at plant time (every fact in the chain is authorized against the planter, not the bundle author). |
| **Replicate graft** | Operator-held artifact, applied by an operator with grafter privileges. | The grafter's stance at graft time — every fact replays under their identity. |
| **Federation propagation** | Cross-reality trust (federated peer relationship + per-fact remapping). | The federated peer policy at the wire boundary + per-fact authorization on the local reality. |

The replay engine doesn't make trust decisions — it just dispatches the chain. Each fact in the chain goes through the substrate's normal authorize() path with the **destination's identity context** (planter, grafter, federation-receiver). Trust differentiation lives at the **discovery and admission** boundaries, not in the chain-rebuild primitive itself.

This is the right shape. The primitive stays simple; the policy lives at the edges.

## Time, branches, and what time means for beings

Worth pinning because it informs why "chain-rebuild operates on branches" is the right scope:

**A being lives within a branch and perceives its reel as time.** A being's experience of "things happening, time passing, history accumulating" is the structure of the branch they live in. Their reel of moments IS the texture of their time.

Same being, different branches → different temporal experiences. The being's biography on `#0` differs from its biography on `#1` from the moment of divergence forward. Same identity, different times.

This is why **replicate-without-history** produces a being with the right shape but no biography — the receiving branch is fresh, the being hasn't lived through any of the source's time. Their temporal experience is empty in the new branch. Time has to accumulate.

**Chain-rebuild changes this in a subtle but important way.** When you replay a chain that built a being, the destination branch's reel for that being is populated with the facts the chain encoded. Their temporal experience isn't empty — it's the encoded chain. Whether that experience is "the same biography" or "a coherent re-enactment" is doctrinal. The honest claim: the destination's chain matches the source's chain (modulo local IDs). The being's experience of time is replayed.

This is why chain-rebuild belongs on branches, not on aggregates in isolation. A branch is the time-giving structure. Moving content between branches means moving time-encoding. Chain-rebuild names the primitive that does that move correctly.

## The migration sketch

If this direction is taken, the path is roughly:

1. **Stage 0 (now):** Document chain-rebuild as a thinking-document. Ship no code. Use it to discipline current design choices (every new substrate-public API should be "expressible as a fact spec" when possible).

2. **Stage A:** Implement the bundle format and the replay engine. Add `reality.replayChain(bundle, params)` as a substrate primitive (or `ctx.replayChain(...)` inside a moment for atomicity). Convert one trivial seed (an empty space with a name and an owner) to a bundle. Verify the round-trip.

3. **Stage B:** Add the parameter-hole substitution + `$placeholder` resolution. Convert a small parameterized seed. Specify forward-reference resolution + error cases explicitly. **No DSL** — the producer pre-resolves all conditionals/loops at bundle-author time.

4. **Stage C:** Capture-from-existing — implement "replicate a subtree on a branch as a chain-rebuild bundle" by walking the subtree's reels. Verify graft-via-replay produces a destination-branch chain functionally identical to the source's chain (modulo local IDs).

5. **Stage C.5 (parallel):** Run the wakes-as-facts pattern for hook listeners, DO-trigger subscriptions, SEE-resolvers. Whatever wiring needs to ride in a replicate must become fact-shaped. This arc is independent of chain-rebuild and unlocks "captures every wiring" honestly.

6. **Stage D:** Federation rewrite to emit chain-rebuild bundles over the wire. The streaming protocol stays as its own concern; the artifact format unifies.

7. **Stage E:** Migrate existing seeds. The 80% case (declarative scaffolds) becomes static bundles in the manifest. The 20% case (real logic, runtime measurement, external side effects) stays as code, possibly with a `provides.seeds.code` shape vs. `provides.seeds.bundle` to make the distinction explicit at the manifest level. Most extensions stop shipping seed JS.

8. **Stage F:** Replicate / graft / federation retire as separate primitives. The vocabulary collapses: there's just "rebuild this chain at my branch." The substrate has one primitive (replay), three authoring patterns (code, operator, wire), and four orthogonal dimensions (author / atomicity / discovery / trust).

Each stage is independently validable. Stage F is the asymptote, not the next step. The substrate could sit at Stage C indefinitely if that's good enough.

## Why this matches TreeOS doctrine

TreeOS already commits to:

- **The chain is the truth.** Every aggregate is a fold over facts.
- **Place is folded from facts**, never stored authoritatively.
- **Facts as projection (CQRS doctrine):** fields on disk are cached projections of the chain.

Chain-rebuild extends that commitment one level up: **any build recipe is also a chain.** A seed is a chain. A replicate is a chain. A federated update is a (short) chain. The substrate's primitive remains the fact; everything that produces facts converges to the same artifact shape.

The framing question that decides whether to commit: *do we believe the chain is the most honest expression of "what this thing IS"?* TreeOS already answered yes for state. Chain-rebuild answers yes for builds. Two doctrinal commitments compounding. Substrate vocabulary shrinks; substrate primitives become cleaner.

## What this document is NOT (yet)

- **A spec.** The format above is illustrative. Real spec needs to handle target normalization, error modes, partial-replay-on-failure, atomicity guarantees, and bundle signing for federation.
- **A commitment to ship.** Stages A through F are the path **if** we commit. We haven't.
- **A retirement notice for seeds.** Imperative seed code stays as the 20% escape hatch indefinitely.
- **A replacement for replicate / publishing.** Those docs describe what's built today. This doc describes a direction those mechanisms could converge toward.
- **A claim that realities collapse into branches.** They don't. Reality is the tree; branch is a timeline within. Chain-rebuild operates on branches and subtrees; the reality stays as the container.

When a decision is made on whether to commit, this document either gets promoted to spec (replacing parts of `publishing.md`) or filed in `seed/done/` as an explored-and-passed-on direction.

## Why now is the right moment to write this down

The recent substrate cleanups already point this direction:

- **`ctx.do / ctx.see / ctx.be / ctx.summon / ctx.read`** make handlers and scaffolds use the substrate-public surface uniformly.
- **Auto-namespacing at `reality.declare.*` registration** means bundle entries don't need to think about extension prefixes.
- **The planter ctx + flat birth payload** mean a seed is already "a sequence of substrate verb calls with flat args."
- **The recent `spec:` wrapper flatten** lets each call shape match the most honest 1:1 mapping to a fact. There's no translation step between caller args and stamped fact params anywhere in the substrate now.

A chain-rebuild bundle entry can be written as `{ verb: "do", action: "create-space", args: { name: "..." } }` — exactly mirroring `ctx.do(rootSpaceId, "create-space", { name: "..." })`, and exactly mirroring the stamped fact's `params`. The gap between "a seed's code" and "a chain-rebuild bundle's data" has been closing the whole time. This doc is an observation more than a proposal: the direction was already there. We just hadn't named it.

## Decision points before Stage A

Three commitments worth being explicit about before any code lands:

1. **One primitive, no same-thing-twice.** If chain-rebuild lands, seeds / replicates / federation become authoring patterns producing chain-rebuild artifacts. They don't continue to exist as independent primitives. Worth deciding now: are we okay collapsing that surface?
2. **No DSL inside bundles.** Producers can be Turing-complete; bundles stay declarative. Conditionals and loops pre-resolve at author time. Worth deciding now: are we okay with bundles getting longer (pre-expanded loops, all branches enumerated) in exchange for keeping the format simple?
3. **Runtime-registration → fact-stamped is a separate arc.** Hooks, subscriptions, SEE-resolvers, services need to become fact-shaped for chain-rebuild to honestly capture "every wiring." That arc complements chain-rebuild but isn't blocked by it. Worth deciding now: do we want to commit to that arc in parallel, or accept that early chain-rebuild captures only what's already fact-shaped?

Each of these is a real doctrinal choice. The document is shaped so they can be deliberated independently before any code commits. Stage A doesn't start until at least #1 is settled.
