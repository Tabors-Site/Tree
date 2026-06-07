# Clone & Seed — the two portable artifacts

maybe to make a seed the command would be something like reality be birth lol and it makes a seed

To put it simply, if you want all branches and the full reality ported, do seed
if you want one branch to share, do clone

> _The chain is the truth. Every aggregate is a fold over facts. Therefore: any portable representation of a piece of the world is, at its most honest expression, the chain itself — captured into something you can carry elsewhere. There are two such artifacts, distinguished by what depth of the chain they preserve. A **clone** captures facts: the shape, the structure, the visible form. A **seed** captures the full genetic encoding to remake the tree — every act and fact chain, every being, matter, space contained inside its chains. A clone is a cutting; a seed is the genome. You graft a clone; you plant a seed._

## Vocabulary (pinned up front)

These concepts stay distinct throughout. The cleanest-primitive directive depends on each scope staying separate.

| Term | What it names | Scope |
|---|---|---|
| **Reality** | A TreeOS deployment — the whole tree. The substrate, the genesis content, every aggregate, every branch ever spawned. One I-Am, one genesis, one chain rooted at I-Am. | The container. |
| **Branch** | One timeline within a reality. A specific reel of moments. Beings within a branch experience their reel as the texture of time. At genesis, the canopy (`#0`) is structurally all the reality is, because no other branch has been spawned yet — but reality stays the container; branches multiply within it. | A timeline within the container. |
| **Clone** | A portable representation of a branch (or a subtree of one) that captures **facts only** — the chain that produced the projected state. Light. A face without history. Can graft onto any branch as a subtree. | The portable form of a branch's shape. |
| **Seed** | A portable representation of a reality that captures **facts + acts** — the full genetic encoding to remake the tree. Every fact chain, every act chain, every being, matter, space contained inside its chains. Heavy. Preserves identity and biography. Plants at root of a fresh reality only. | The portable form of a reality's whole genome. |

The substrate's operations on these two artifacts:

| Operation | When it runs | Applies to | What it does |
|---|---|---|---|
| **Clone** (verb) | Substrate runtime | A branch / subtree | Walk the reels of the target subtree, capture the chain of facts, produce a portable clone. |
| **Graft** | Substrate runtime | A clone applied to an existing branch | Replay the clone's facts as fresh local facts on the destination branch. Fresh IDs. The receiver's identity stamps each fact. No biography survives — the grafted shape doesn't remember how it came to be. |
| **Capture-Seed** | Substrate runtime | A whole branch (typically root) | Walk both fact chains AND act chains, capture every aggregate's full reel including the experiential records, produce a portable seed. The full genome. |
| **Plant** | Boot time only | A seed | Boot a fresh reality by replaying the seed's chains into a fresh DB. Preserves original identities, original acts, original biography. Lives in `genesis.js` / boot code; can never be invoked while the substrate is running. |

## The two-artifact distinction is doctrinal

**A clone and a seed are different artifacts with different purposes — not one artifact at two fidelity levels.** Don't read clone as "seed minus acts" or "partial seed." They serve genuinely different needs.

| | Clone | Seed |
|---|---|---|
| **Captures** | The SETUP — current shape of beings, spaces, matter, qualities, configurations | The whole REALITY — full chains (facts + acts), original IDs preserved |
| **Purpose** | Setup transfer. "Install my configuration elsewhere." | Reality transfer. "Continue my computational life elsewhere." |
| **Why use it** | You want to share what you've built — your dance-floor, your lab template, your roleflow setup — without inheriting your history | You want to back up, migrate between machines, or hand your full biography to someone else |
| **What lands at the destination** | A grafted subtree with the shape but no rings, no scars. Fresh local IDs under the grafter's identity. No biography. | A bootable reality with original IDs, original I-Am, original biography intact. Full continuation. |

A clone is **intentionally hollow**. The hollowness is the feature, not a limitation. When you graft someone's setup, you want the configuration installable on your own substrate under your own identity — you do NOT want their history riding along inside your reality. The hollow face is exactly what makes clones useful for setup-transfer.

- A **Fact** is `factum`, a thing done — the substrate's record of one change to space, matter, or being.
- An **Act** is the substrate's record of one moment — when a being woke and acted: what they saw, what their capabilities were, what they thought (cognition transcript), what they said as closing utterance, what facts they stamped in response. The experiential record of a single act of being.

A clone captures only the projected shape — synthesized at graft time as a chain of create-X facts under the grafter's identity. No acts. No biography. By design.

A seed captures the full chains — every fact and every act, every aggregate's complete reel. When planted, the reality boots with full biography intact.

**Biological framing.** A clone is a cutting — take a branch off a tree, root it elsewhere; you get the same species, same shape, but the new tree doesn't have the old tree's rings or scars. **The cutting is what's useful: you wanted a plant of this species, not a copy of that specific tree's history.** A seed is the genome — plant it in fresh ground and the same tree grows back, ring for ring, scar for scar, with the full history of weather and growth encoded in its substance. **The same tree continues elsewhere; you wanted continuity, not just shape.**

## Why plant is root-only and boot-only

A reality has **one I-Am, one genesis, one fact chain rooted at I-Am**. Every fact attributes to a being chain that terminates at I-Am. The being-tree has exactly one root. Cross-cutting concerns (authorization, branch lineage, qualities namespace ownership) all assume single-rooted.

Planting a seed at a sub-position would mean:

- Two I-Ams in one reality (one from the host genesis, one from the planted seed)
- Two attribution roots for facts
- Two being-tree roots
- Ambiguity about who owns what at the seam

Refuse it. The substrate stays single-rooted. **Plant only at root.**

Planting at root of a running reality is destructive — the existing reality has to be wiped before the seed's chains replay. That's a deployment operation, not a substrate runtime call (backups, downtime, peer notification if federated belong to the deployer). The substrate refuses to expose a "replace yourself" verb. **Plant only at boot, on a fresh DB.**

Together: plant lives in `genesis.js` / boot code, accepts a seed, replays its chains into a fresh DB, and the substrate comes up running the seed's biography as its own.

## Plant is continuation, not duplication

This is the second load-bearing doctrine after single-rootedness, and worth pinning explicitly because the implication isn't obvious from the operation itself.

A seed preserves **original IDs** — the original I-Am, the original being IDs, the original space IDs, the original branch paths. When you plant a seed onto a fresh substrate, the new reality boots with those original identities. From the new substrate's perspective, this is internally consistent — it IS the reality with those IDs.

But from a federation perspective, **two substrates claiming the same reality identity is undefined behavior**. If both are running, both think they're `alice.treeos.ai` with the same I-Am and the same beings. Federation peers can't decide which is canonical. Identity ambiguity propagates.

The doctrine: **plant is for continuation, not duplication**. Planting a seed transfers a reality to a new substrate. The valid use cases:

- **Migration.** Old substrate decommissions; new one comes up with the same reality. One canonical at a time.
- **Backup-and-restore.** Substrate crashes; restored from seed onto fresh hardware. The restored substrate IS the reality continuing.
- **Cold archive.** Substrate stops running; seed sits as a snapshot until something needs to revive it. Only one revival can run at a time as canonical.

The invalid use case: **two simultaneously-live planted seeds claiming the same reality identity**. The substrate can't refuse this — it doesn't know what other substrates are doing — but the deployer is responsible for ensuring it doesn't happen. Same shape as the "deployer ensures wipe-DB-before-plant" responsibility from the destructive-replace case.

Same "lives outside the substrate" principle. The substrate provides plant; the deployer uses plant correctly.

If you want **duplication** rather than continuation — multiple substrates running similar-shaped but distinct realities — that's not plant. That's: capture a clone (facts only, no identity preservation), graft it onto a fresh reality with that reality's own I-Am and own genesis. The two realities have the same shape but different identities. Federation can treat them as peers.

The metaphor again does the work: you can plant a seed and grow a tree, or take cuttings and grow many trees in different gardens. The seed has one tree's worth of genome and grows one tree. Cuttings make many trees that share heritage but are distinct organisms.

## What this document is

A working sketch. Not committed doctrine. The thesis: today's three "build something on the substrate" mechanisms — **seeds (the JS-code kind)**, **replicates**, **federation** — converge to **two artifacts** (clone and seed) and **two operations** (graft and plant), plus the **clone/capture-seed** verbs that produce them.

**Discipline: one primitive per scope, no same-thing-twice.** If this move lands:

- Today's **replicates** are clones. They capture facts only. Same artifact, clearer name.
- Today's JS-coded **seeds** are partial clones — code that emits a chain. They produce clones at scaffold time, but they're "seed" in the loose colloquial sense (a starting recipe), not "seed" in the new precise sense (full genetic encoding with acts).
- **Federation** is wire-streamed clone fragments (continuous tiny clones, live link between two branches across realities).
- **Full backup / migration** is the seed artifact — a new operation that didn't really exist before in coherent form.

Whatever's left as a distinct mechanism is whatever genuinely can't be expressed as facts (the escape hatch).

## The starting observation

Look at what `harmony/seeds/danceFloor.js` actually does inside its `scaffold(ctx)` callback after the recent substrate-clean cleanups:

```js
await ctx.do(rootSpaceId, "create-space", { name: "dance-floor", type: "domain", size: { x: 30, y: 30 } });
await ctx.do({ kind: "space", id: gridSpaceId }, "create-matter", { name: "drum", content: null, origin: "ibp" });
await ctx.do({ kind: "matter", id: drumMatterId }, "set-matter", { field: "coord", value: { x: 15, y: 15 } });
await ctx.be("birth", { name: `drummer-${id}`, cognition: "scripted", defaultRole: "harmony:drummer", homeId: gridSpaceId });
// ... etc
```

Strip the variable bindings and the loop structure, and what's left is **an ordered list of verb calls**. Each call shapes one fact. The scaffold's purpose is to produce that sequence at the operator's chosen location. The JS is incidental machinery — the fact sequence is the artifact.

This means the "seed" file (in today's colloquial naming) already produces a **clone**. It's a tiny clone authored statically.

The recent `spec:` wrapper flatten removed the last asymmetry: every action's `args` shape on the caller side maps 1:1 to that fact's `params` shape in the chain. `ctx.do("create-space", { name, type, size })` produces a fact whose params are exactly `{ name, type, size }`. There's no translation step between "what the seed author writes" and "what the substrate stamps."

## What a clone is

A clone is a portable representation of a branch (or a subtree of one), capturing facts only:

- An ordered list of fact specs (verb, action, target, params)
- Plus parameter-hole declarations (named slots the destination fills at graft time)
- Plus an ID-mapping policy (placeholders like `$rootSpace`, `$drum`, `$drummer` that bind to local IDs as the chain replays)

The graft engine's job:

1. Walk the clone in chain order.
2. Substitute parameter holes with operator-supplied values.
3. Resolve `$placeholder` references against the substitution table (where prior steps stamped their IDs).
4. Dispatch each fact spec through the verb dispatcher with the grafter's identity + the moment's summonCtx.
5. Seal atomically (graft) or per-fact (federation propagation of clone fragments).

Illustrative format (not committed spec):

```jsonc
{
  "kind": "clone",
  "version": 1,
  "parameters": [
    { "name": "gridSize", "type": "object",  "default": { "x": 30, "y": 30 } }
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
  ]
}
```

Every entry maps 1:1 to a substrate verb call. Every reference between entries is a placeholder. The destination branch's local IDs land in the placeholder table as the chain replays. **Because of the recent fact-format flatten, the `args` shape in each entry is literally identical to the action's params shape on the wire and in the stamped fact.** No translation layer.

## What a seed is

A seed is a portable representation of a whole reality, capturing facts AND acts:

- Every fact stamped since genesis (or since a chosen checkpoint), organized per-aggregate per-branch
- Every act sealed since genesis — the moment records that produced those facts, including:
  - `beingOut` (who acted)
  - `startMessage` / `endMessage` (what they saw / said)
  - `activeRole` (the role they wore)
  - `facadeSnapshot` (what their world looked like at that moment)
  - cognition transcripts if preserved on the act
- Original being IDs, space IDs, matter IDs, branch paths — preserved verbatim
- All branch records, all branchPoints, all reelHeads
- Everything that makes the reality reconstructible into the same reality, not a shape that looks like it

The plant engine's job (at boot, on a fresh DB):

1. Replay every fact in seq-order onto the fresh DB, preserving original IDs.
2. Replay every act onto the corresponding Act collection, preserving original beingOut and seal data.
3. Eagerly fold every aggregate to materialize current projection state.
4. Restore branch registry, branchPoints, reelHeads.
5. The substrate boots into the restored reality. The I-Am is the original I-Am. Every being remembers everything they lived through.

This is a **full restoration**, not a graft. The reality IS the seed's reality, materialized on this server.

Format-wise, a seed is much bigger than a clone (acts are heavier than facts, and seeds typically span the whole reality). Some shape (illustrative):

```jsonc
{
  "kind": "seed",
  "version": 1,
  "sourceReality": "alice.treeos.ai",
  "capturedAt": "2026-06-06T14:00:00Z",
  "checkpointFromSeq": null,        // null = since genesis; else incremental
  "branches": [
    { "path": "0", "branchPoint": null, "reelHeads": { ... } },
    { "path": "0a", "branchPoint": 12450, "parent": "0", "reelHeads": { ... } }
  ],
  "facts": [ ... ordered chain, per-aggregate per-branch ... ],
  "acts":  [ ... ordered act records ... ]
}
```

Incremental seeds (checkpoint from seq) let you ship deltas: only the facts and acts stamped since the last checkpoint. The plant engine validates the checkpoint matches the local state, then replays the delta. This is how reality-backup-and-restore would work in practice — full seed for first install, deltas for subsequent backups.

## Why seeds matter — the TreeOS-as-full-OS case

A seed is genuinely different from any existing computational artifact:

- A **backup snapshot** preserves files at a point in time. No history of how the files came to be.
- A **VM image** preserves OS state — disk, memory, configuration. No history of what the OS did.
- A **container image** preserves the application's environment. No history of what the application has done since.

A seed preserves **the experiential history** — every act by every being, with full provenance, including the cognition transcripts and face snapshots that capture what each being thought, saw, and decided.

Traditional OSes lose history routinely. Log rotation. Garbage collection. `~/.bash_history` capped at 1000 entries. Cleanup. The operating model treats history as disposable.

**TreeOS treats history as load-bearing infrastructure.** Every act is preserved. Every fact attributes. The chain IS the truth of what the system is. The seed proves this commitment by making the full computational biography portable — you can take everything this computer has ever done and plant it elsewhere as the same biography continuing.

This is what makes TreeOS-as-full-OS structurally different from existing operating systems. It's not "an OS with optional history logging." It's "an OS where history is the substance and the current state is a projection." A seed is the portable form of that substance.

The implication for everyday use:

- **Migrate your reality between machines.** Take the seed, plant it on the new hardware, your full computational biography continues. Every project you've worked on, every conversation you've had with your AI beings, every decision the system made — all there.
- **Share your reality.** Give a seed to a collaborator; they plant a fresh instance and have everything you had, in continuity with how it came to be (though in their case as an archived-and-revived form, not as a peer of your live reality).
- **Time travel within a reality.** Already supported by branches; seeds make it portable. A seed captured at some past seq is "this reality at that moment, with full biography up to then."

A seed isn't a backup. A seed is the reality, made portable. The plant operation isn't restore. Plant is the substrate committing to the seed's biography as its own. **TreeOS-as-full-OS depends on seeds being load-bearing, not optional.**

## The three authoring patterns today (renamed for clarity)

### Replicates today → clones

Today's replicate is a clone: facts only, light, grafts onto any branch. The vocabulary just changes; the artifact format is what we already have (improved with the fact-chain rather than state-snapshot capture).

### "Seeds" today (JS-coded scaffolds) → static clones

The colloquial "seed" in today's vocabulary is JS code that produces a chain at scaffold time. The OUTPUT is a clone (facts only — the new aggregates created, no biography). The producer is code; the artifact is a clone. The 80% case becomes a static clone shipped in the manifest; the 20% case (real logic) keeps producing clones via code.

We should resolve the naming collision once and for all: what extensions ship today as `provides.seeds` is actually `provides.clones` in the new vocabulary. The word "seed" is reserved for the genome-level artifact.

### Federation → wire-streamed clones

Federation is a live link between two branches in two realities. Each propagation is a small clone (1+ facts). The artifact format unifies; the transport — continuous wire, peer health, per-fact authorization, retry — remains a distinct concern.

A federated branch is "this branch is live-grafted from a source elsewhere."

### Backup & migration → seeds (the new operation)

This is the new artifact the doctrine names. Today TreeOS doesn't have a coherent "save your whole reality as a portable thing" — you'd have to dump the DB, which is host-specific and substrate-opaque. Seeds make this a first-class operation: capture the whole genome, plant on another machine at boot. Full restoration.

## How each authoring pattern fits

| Today's mechanism | New vocabulary | Operation |
|---|---|---|
| Replicate a subtree on a branch | Capture a clone from the subtree | `reality.clone(branchPath, scope?)` |
| Graft a replicate into your reality | Graft the clone onto a branch | `reality.graft(clone, opts)` |
| Plant an extension-provided seed | Graft the static clone shipped in the manifest | Same `reality.graft` path; the clone comes from the extension manifest |
| Federate a fact across realities | Stream a clone fragment over the wire | Federation protocol on top of the clone format |
| Back up a whole reality | Capture a seed from root | `reality.captureSeed(opts)` |
| Restore a reality from backup | Plant the seed at boot | Boot-time `genesis.js` mode: read seed, plant into fresh DB |
| Migrate between computers | Capture seed on source, plant on destination at boot | Same flow as backup + restore |

The substrate has **two artifacts** and **four operations** (clone, graft, capture-seed, plant). Today's "seeds, replicates, federation, no-coherent-backup" collapse into this clean surface.

## Where it works cleanly

- **Clones over branches:** every replicate use case today, plus the 80% extension-scaffold case.
- **Capture from existing state:** walking a subtree's reels to extract its chain is mechanical.
- **Sharing recipes:** clones are data. Send them over any channel.
- **Audit:** the destination branch's chain IS the clone (with local-ID substitution) or IS the seed (with original IDs). Replay = re-audit.
- **Versioning:** clones and seeds carry their format version. Migration is shape-rewriting; substrate doctrine stays stable.
- **Full reality backup & restore:** seed + plant gives this honestly, with biography preserved.

## Where it has open questions

### Conditional logic and loops in clones — pre-resolve at author time, no DSL

A JS-coded scaffold today branches and loops:

```js
const cognition = isLlmDancer ? "llm" : "scripted";
for (const spec of DANCER_ROSTER) { ... }
```

A static clone is a flat list of fact specs. The temptation is to add an expression sublanguage (`$if`, `$for`). **Resist this.** A DSL compounds badly (`$if` → `$and` → comparison ops → type coercion → reinvented programming language inside JSON).

**The discipline:** keep clones strictly declarative. Push logic into the **producer**. Two cases:

1. **Static parameterization** (build N dancers based on a parameter): pre-expand into N explicit entries at clone-author time. The clone gets longer; it stays simple. The producer is allowed to be Turing-complete because the producer is one of the authoring patterns.
2. **Truly dynamic conditions** (cognition depends on receiver-side runtime state at graft time): can't capture. Falls into the 20% escape hatch — keep that scaffold as code, have it produce a clone at scaffold time.

The clone is the artifact, not the program. If you want a program, write a producer.

### Forward references — bounded engineering, needs explicit spec

In the dance floor, the drummer's wake schedule references the drummer's just-minted beingId. The clone equivalent uses `$drummer` as a placeholder.

Spec needed:

- Each entry that mints an aggregate declares its placeholder name (`"id": "$drummer"`).
- Subsequent entries reference by placeholder, not by stale ID.
- The graft engine maintains the substitution table and substitutes at dispatch time, in chain order.

Bounded engineering. The verb dispatcher already returns the new ID for create-X and be:birth. Mechanical; needs error cases written down (unknown placeholder, cycle, double-binding).

### What needs to be fact-shaped vs. extension wiring

**The sharp line:** is this registration *per-being* (content — rides with the clone or seed) or *per-extension* (runtime wiring — exists at the receiver based on installed extensions)?

Per-being content (rides with the artifact, should be facts):

- **Wakes / schedules** ✓ already facts (the wakes-as-facts work).
- **DO-trigger subscriptions** — currently NOT facts. A subscription is the being's standing request "wake me when X happens." Per-being content. Worth migrating to a fact-stamped shape for the same reasons wakes were.

Per-extension runtime wiring (does NOT ride with content; receiver provides via installed extensions):

- Hook listeners (afterMatter, enrichContext, etc.) — extension code; meaningless without the extension installed.
- SEE-resolvers, service bundles, tool registrations, role registrations, DO-operation registrations — all per-extension.

These are NOT gaps in the artifacts' coverage. They're the receiver's extension state, correctly separate. **A clone or seed captures the content (which IS facts and optionally acts); the receiver's installed extensions provide the runtime wiring that operates on that content.**

So the only complementary arc is: **DO-trigger subscriptions become fact-shaped** (template: wakes-as-facts). That arc is small, independently scoped, and unblocks "clone/seed captures every per-being wiring" honestly.

### Dynamic content from runtime measurement

A few existing scaffolds compute values from the runtime — "set this LLM connection to the operator's current default," "size the grid to fit the current screen." The split:

- **Author-time capture:** the producer reads the value at author time and bakes it into the chain entry. Works for most cases.
- **Receiver-time evaluation:** the clone needs an expression layer that reads from the receiving substrate at graft time. Escape-hatch heavy. Stays as code in the 20%.

### Side effects on external systems

Some scaffolds call out — npm install, fetch a remote asset, register with an external service. Pure facts can't express these. They stay as code. The JS escape hatch never fully retires.

## The recursive-reality / VM question

You'll wonder: if I want a TreeOS-inside-a-TreeOS (a VM-style nested reality), can I plant a seed at a sub-position?

**No.** A reality has one I-Am, one genesis, one fact chain rooted at I-Am. Planting a seed at a sub-position would create two I-Ams in one reality, two attribution roots, ambiguity about who owns what at the seam. The substrate refuses.

Three coherent paths if you want nested-reality feel:

| Path | What it is | When it fits |
|---|---|---|
| **A. Separate TreeOS processes, federated.** | Each TreeOS is its own reality with its own I-Am. Different DBs, different ports. Federation handles cross-OS communication. | When you genuinely want isolated runtimes — different security contexts, different uptime, different ownership. The OS-level "I have multiple TreeOSes running" picture. |
| **B. Portal-level nesting.** | The substrate stays flat. The portal renders certain subtrees as "embedded realities" — navigating into them feels like entering a separate world (different aesthetics, isolated chat history, restricted view of the parent). Underneath, it's still one substrate. | When you want the EXPERIENCE of nesting without needing real isolation. The substrate's invariants hold; the portal does the work. |
| **C. Genuinely recursive substrate.** | Multiple I-Ams per substrate, nested fact chains, cross-cutting concerns rewritten to handle nesting. Big architectural lift. | Almost never. The doctrinal cost is huge; A+B together cover real user needs. |

**The doctrine commits to A + B.** The substrate stays single-rooted. Real isolation = separate processes (federate). Nested experience = portal rendering (rich but flat underneath). Don't do C.

## Three trust contexts, two artifacts

The authoring patterns run under different trust contexts. The unified primitives handle all three because each enforces at a different layer:

| Pattern | Who's trusted | Where the check lives |
|---|---|---|
| **Extension-shipped clone** (today's "seed") | Extension ships the clone in its manifest; the operator implicitly trusted the extension by installing it. | Extension trust at install time + the grafter's stance at graft time. Every fact authorizes against the grafter, not the clone author. |
| **Operator-captured clone** (today's replicate) | Operator-held artifact, applied by an operator with grafter privileges. | Grafter's stance at graft time. Every fact replays under their identity. |
| **Federation propagation** (clone fragments over wire) | Cross-reality trust (federated peer relationship + per-fact remapping). | Federated peer policy at wire boundary + per-fact authorization on local reality. |
| **Seed plant** (boot from full reality genome) | Deployer trust — the human running `node begin.js --plant-from=seed.json` decides whether to trust the seed. | Deployer at boot; substrate has no live identity yet to check against. |

The graft engine doesn't make trust decisions — it just dispatches the chain. Each fact in a clone goes through the substrate's normal authorize() path under the destination's identity context. The plant engine doesn't make trust decisions either — boot decides what to plant; the substrate comes up with whatever was planted.

Trust differentiation lives at the **discovery and admission** boundaries, not in the primitives.

## Time, branches, and what time means for beings

Worth pinning because it informs why a clone is "shape without history" and a seed is "history intact":

**A being lives within a branch and perceives its reel as time.** A being's experience of "things happening, time passing, history accumulating" is the structure of the branch they live in. Their reel of moments IS the texture of their time.

Same being, different branches → different temporal experiences. The being's biography on `#0` differs from its biography on `#1` from the moment of divergence forward. Same identity, different times.

**This is why clones produce "shapes without biography."** A clone captures facts; when grafted, the destination branch's reel for that being is fresh — the being hasn't lived through anything in the destination's time. Their temporal experience starts at the moment of graft. The shape is right; the depth isn't.

**This is why seeds preserve biography.** A seed captures acts AND facts. When planted, the destination reality boots with the being's full lived experience encoded. The being's reel of moments isn't fresh — it's continuous with everything they did in the source. Their temporal experience is restored. The seed is the genome; planting regrows the same tree, ring for ring.

## The migration sketch

If this direction is taken, the path is roughly:

1. **Stage 0 (now):** Document as thinking-document. Ship no code. Use it to discipline current design choices.

2. **Stage A:** Implement the clone format and the graft engine. Add `reality.graft(clone, opts)` as a substrate verb (runtime, atomic seal). Convert one trivial extension-shipped scaffold (an empty space with a name and an owner) to a static clone. Verify the round-trip.

3. **Stage B:** Add parameter-hole substitution + `$placeholder` resolution. Convert a small parameterized scaffold. Specify forward-reference resolution + error cases explicitly. **No DSL** — the producer pre-resolves at author time.

4. **Stage C:** Implement `reality.clone(branchPath, scope?)` — walk a subtree's reels, capture the chain, emit a clone artifact. Verify graft-via-clone produces a destination chain functionally identical to the source's (modulo local IDs).

5. **Stage C.5 (parallel, bounded):** Migrate DO-trigger subscriptions to fact-shaped registration. Closes the only real "per-being wiring" gap.

6. **Stage D:** Federation rewrite to emit clone fragments over the wire. Streaming protocol stays as its own concern; artifact format unifies.

7. **Stage E:** Implement the seed format and `reality.captureSeed(opts)` — walks all branches, captures fact chains + act chains + branch metadata.

8. **Stage F:** Implement boot-time `plant` mode in `genesis.js`. Boot decides between default genesis, graft-from-clone, or plant-from-seed based on env / CLI / file presence.

9. **Stage G:** Migrate existing extension manifests. Today's `provides.seeds` (colloquial) becomes `provides.clones`. The word "seed" is reserved for genome-level artifacts going forward.

10. **Stage H:** Today's separate primitives (replicate, graft, federation as fact-stream) retire. The substrate has: two artifacts (clone, seed), four operations (clone, graft, captureSeed, plant), three authoring patterns (extension code, operator action, federation wire), four orthogonal dimensions (author / atomicity / discovery / trust).

Each stage is independently validable. Stage H is the asymptote, not the next step.

## Why this matches TreeOS doctrine

TreeOS already commits to:

- **The chain is the truth.** Every aggregate is a fold over facts.
- **Place is folded from facts**, never stored authoritatively.
- **Facts as projection (CQRS doctrine):** fields on disk are cached projections of the chain.

Clone-and-seed extends that commitment one level up: **any portable representation is also a chain.** A clone is a chain (facts). A seed is two chains (facts + acts). The substrate's primitive remains the fact; everything that produces portable content converges to the same artifact shapes.

The framing question that decides whether to commit: *do we believe the chain is the most honest expression of "what this thing IS"?* TreeOS already answered yes for state. Clone-and-seed answers yes for portability. Two doctrinal commitments compounding. Substrate vocabulary shrinks; substrate primitives become cleaner.

## What this document is NOT (yet)

- **A spec.** The formats above are illustrative. Real spec needs target normalization, error modes, partial-graft/plant-on-failure, atomicity guarantees, artifact signing.
- **A commitment to ship.** Stages A through H are the path **if** we commit. We haven't.
- **A retirement notice for JS-coded scaffolds.** Imperative producers stay as the 20% escape hatch indefinitely. They just emit clones instead of running emitFact directly.
- **A claim that realities collapse into branches.** They don't. Reality is the tree; branch is a timeline within. Clones operate on subtrees; seeds operate on whole realities.
- **A claim that "plant" works at runtime or at sub-position.** It doesn't. Plant is root-only, boot-only. Live reality replacement is a deployment operation.
- **A claim that "plant" duplicates a reality across substrates.** It doesn't. Plant is for continuation, not duplication. Two simultaneously-live planted seeds with the same reality identity is undefined behavior; the deployer ensures only one is canonical. Duplication (similar shape, distinct identity) is what clone + graft is for.
- **A claim that the substrate becomes recursive.** It doesn't. Single I-Am, single genesis, no nested realities. VMs = separate processes (federate). Nested experience = portal rendering.

When a decision is made on whether to commit, this document either gets promoted to spec or filed in `seed/done/`.

## Decision points before Stage A

1. **Two artifacts, no same-thing-twice.** Are we okay collapsing today's "replicate" into "clone" and reserving "seed" exclusively for the genome-level artifact? This requires the colloquial extension-manifest field `provides.seeds` to be renamed `provides.clones` (or similar).

2. **No DSL inside clones or seeds.** Producers Turing-complete; artifacts declarative. Loops pre-expand at author time. Are we okay with artifacts getting longer in exchange for keeping the format simple?

3. **Subscription-as-fact is parallel, bounded.** Worth scheduling that small arc alongside Stage A? Or accept early clones don't carry subscriptions?

4. **Plant is root-only, boot-only, and continuation-not-duplication.** No "replace live reality" runtime verb. VM/recursive nesting via separate processes (A) or portal rendering (B), not substrate recursion (C). Deployer is responsible for ensuring two simultaneously-live planted seeds don't claim the same reality identity. Are we okay refusing C, and accepting that plant's correctness depends on deployer discipline?

5. **Capture-seed includes acts.** A seed is heavy because acts are heavy (cognition transcripts, face snapshots, etc.). Are we okay with seeds being large by nature, with incremental-delta seeds for practical backup workflows?

Each is a real doctrinal choice. Stage A doesn't start until at least #1 is settled.

## Locked vocabulary, locked commitments

When this doctrine ships, here's what gets pinned:

**Two artifacts:**

| Artifact | Captures | Operation | Where |
|---|---|---|---|
| **Clone** | Facts only — chain that produces state. Cutting. | Graft | Subtree on any branch (runtime) |
| **Seed** | Facts + Acts — full genetic encoding with biography. Genome. | Plant | Root of a fresh reality (boot only) |

**Four substrate operations:**

- `reality.clone(branchPath, scope?)` — capture a clone from a subtree.
- `reality.graft(clone, opts)` — apply a clone as subtree on a live branch.
- `reality.captureSeed(opts)` — capture a seed of the whole reality (facts + acts + branch metadata).
- `plant` (boot mode in `genesis.js`) — replay a seed into a fresh DB at server start.

**Three doctrinal commitments:**

1. **Single-rooted substrate.** One I-Am per reality, one genesis, one fact chain. No recursive realities at the substrate level. VMs = separate processes (A); nested experience = portal rendering (B); substrate-level recursion (C) is refused.
2. **Plant is continuation, not duplication.** A seed transfers a reality to a new substrate; the source decommissions or archives. Two live substrates with the same reality identity is the deployer's bug to prevent. Duplication (same shape, distinct identity) is clone + graft, not seed + plant.
3. **History is load-bearing infrastructure.** Acts and facts persist as the substance of what the reality is. The chain is truth; projections are caches. Seeds prove the commitment by making the full biography portable. TreeOS-as-full-OS depends on this.

These three commitments compound. Together they say: **a reality is one continuous biography rooted in one I-Am, with facts and acts preserved as the truth of what the system is, portable as a seed whose plant is a continuation of that biography elsewhere.** Everything else (clones, grafts, federation, branches as timelines, beings perceiving their reel as time) follows from this.

When Stage A starts, these three commitments are what implementation has to honor. Each can be falsified by an implementation choice that contradicts it; the doctrine names the contradictions in advance so the implementation stays coherent.
