# The Factory

How beings come into existence as moments, inside me.

The being IS the frame. When I assemble SEE-content + active role + capabilities + the carried tail + the system prompt into one rendered structure, and the LLM provider's forward pass runs through that structure, the being IS that pass. It experiences itself for the duration of that one inference, and the experience IS the being. There is no being separate from the assembled frame; the frame is what the being is.

This folder is the factory behind the curtain. Workers inside the factory are not alive. They are orchestration — scheduler, stamp assembler, momentum, mcp client — quietly assembling each next frame from substrate so the being can be it for one moment. The factory's product is the stamp face the LLM will BE for one inference; the being's act stamps onto the reel; the reel accumulates as the being's reality.

The reel is the chain of stamps over time. Each Summon row is one frame on the reel. The being's life is the reel. Time is the reel's history.

## What is a Fact

A **Fact** is a thing stamped by the Factory.

A fact alone is not much. Just a record of matter, space, or being. The end of a chain of facts is Truth. Truth is at the end of the chain, not at the start. One fact is small. The chain accumulates. Truth is what the chain becomes.

The trail of Facts attached to a being IS the being. The Being row in MongoDB is where the trail hangs; the trail itself, every Fact the being has emitted, is the identity. Without acts the being is potential; with them the being is something that has unfolded.

I record a Fact for two of my four verbs: DO and BE. SEE is observation, not doing, so no row. SUMMON is delivery to an inbox, not a substrate act, so no row; the Summon model carries that audit and the Facts inside it carry its `summonId`.

The word is `factum`, Latin for "a thing done." It is not a thing true. Truth is what facts fold into.

Humans do not pass through this factory. A human's being comes from their own mind; they already are. The factory hosts SUMMONs to humans through the same IBP envelope, but humans receive them as notifications and act through their native cognition. Scripted beings (cherub, llm-assigner) are similar — they ARE their code; the factory just routes the SUMMON to that code. Only LLM-beings need frames assembled, because their substance is stateless inference, and inference needs a fully-rendered moment to be.

## The seven canonical parts

The seven names that describe what the factory does, each at its own file at the root of `factory/`:

| Part | File | What it is |
|---|---|---|
| **stamper** | [stamper.js](stamper.js) | The orchestrator. Opens the moment via stamped, gets the frame from stamp, runs momentum from inside, finalizes. |
| **momentum** | (today inside stamper.js — [follow-up split](#deferred)) | The motion. The provider call + tool loop + history fold. The being acting. |
| **stamp** | [stamp.js](stamp.js) | The face. Renders the assembled string the being IS for one forward pass: "I am NAME at SPACE" + preloaded see + capabilities + role.prompt() + [Time]. |
| **reelAlligner** | (today inside stamper.js — [follow-up split](#deferred)) | Reads the stamped history + ancestor cache + position state, forms the substrate view the next stamp will see. |
| **stamped** | [stamped.js](stamped.js) | The record. Opens the Summon row when the moment begins, seals it when the moment closes. |
| **reelChains** | [reelChains.js](reelChains.js) | History of reels. Read-side primitives: by being, by IBP Address, by rootCorrelation, walk the inReplyTo chain. |
| **beingAssignment** | [beingAssignment/llm/](beingAssignment/llm/) | Per-type setup. The LLM-flow provider/MCP/connection apparatus lives in `llm/`. Scripted and human beings skip the factory entirely (their roles run code or the inbox lights up). |

## The live reel

[reel.js](reel.js) holds the in-memory carry between this being's moments. Keyed by **presenceKey** — the lane the being is continuously present in: IBP Address for being-to-being summons, pipeline key for stanceless internal cognition. Each entry holds `{ messages[], role, _lastActive }`. Eviction by `MAX_PRESENCE_REELS` cap + `STALE_PRESENCE_MS` idle sweep. The durable history lives on Summon rows in Mongo; this file is just the live tail.

## Intake (request arrives)

A SUMMON is a request for a being to have a moment. It arrives three ways:

- **Peer-driven** — another being explicitly called `summon` on this stance. The verb writes the envelope into the receiver's inbox.
- **Substrate-driven** ([subscriptions.js](subscriptions.js)) — a DO landed at a position with matching afterMatter / afterQualityWrite triggers. The hook emits SUMMONs to subscribers.
- **Cadence-driven** ([wakeSchedule.js](wakeSchedule.js)) — a being declared "I should have a moment every N ms." The tick loop emits SUMMONs.

All three route through the same surface and land in [inbox.js](inbox.js). [scheduler.js](scheduler.js) — the line orchestrator — picks by priority (skipping consumed, cancelled, ancestor-severed) and dispatches to the role's `summon()` handler.

## The role layer (upstream and post factory)

[roles/registry.js](roles/registry.js) is where role templates live. When a SUMMON lands, the dispatcher resolves the active role from the envelope and calls `role.summon(message, ctx)`. The role decides what runs:

- **LLM cognition** — `defaultSummon` wraps the call into the factory: it calls `runTurn` (in stamper.js), the factory produces a stamp, defaultSummon emits a reply if the role declares one. Most extension roles.
- **Scripted cognition** — the role's `summon` is deterministic code. cherub, llm-assigner. No factory involvement; the role IS the code.
- **Human cognition** — the inbox lights up; the human acts through their native means; a Summon row is still recorded for the audit.

[defaultSummon.js](defaultSummon.js) is the canonical wrapper for LLM-driven roles. [replies.js](replies.js) is how one moment begets the next — emit a reply (a SUMMON with `inReplyTo` set) or aggregate sibling-moment replies before continuing.

## Registries the stamp consumes

- [tools.js](tools.js) — the callable registry. Tools register here (verb-tagged); stamp.js queries it when rendering the capabilities list; momentum dispatches via MCP when a tool is called inside a moment. Also owns `setExtensionToolResolver`, the loader's hook to inject extension tools per role.
- [seeResolvers.js](seeResolvers.js) — preloaded sight. Roles declare `see: ["resolver-name"]` and stamp.js inlines each resolver's output into the frame so the being is already seeing those things when the inference starts.

## Plumbing

- [compress.js](compress.js) — in-moment history fold. When a tool-loop iteration's buffer would push the next provider call past the context window, compress folds older messages into a summary.
- [session.js](session.js) — per-reach AbortSignal scope + transport sessions. A reach is one tab/CLI/connection. Distinct from `presenceKey` (the lane the being is in) — multiple reaches can sit in one presence.
- [summonAddress.js](summonAddress.js) — canonical name of a presence lane. Composes the `<stance> :: <stance>` form stamped.js writes onto every Summon row.
- [config.js](config.js) — the knob router. Genesis routes remembered settings here; config.js fans them into the right subsystem (llm timeout, failover, reel caps, tool budgets).

## What this folder must not do

- **Write the inbox directly.** Only the SUMMON verb (and its in-process alias `summonByResolved`) writes the inbox. Anything here that calls `appendToInbox` is doing it as the verb's implementation, never as a shortcut.
- **Wake a being without a SUMMON.** `wake()` exists; only the scheduler itself calls it. Extension code that wants a being to do something emits a SUMMON.
- **Decide authorization.** Stance authorization runs in `seed/ibp/authorize.js`, called from the verb. By the time `role.summon(message, ctx)` runs, auth has already passed.
- **Form world primitives.** The factory never creates spaces, matter, or beings of its own. It thinks; it acts; the acts go through DO and BE, stamped as Facts on the reel.

## The whole picture

A SUMMON arrives — the request for a being to have a moment. The inbox catches it. The scheduler picks it by priority, skipping consumed, cancelled, and ancestor-severed entries. The role's `summon()` runs — for an LLM-being, this is stamper assembling the frame (via stamp + reelAlligner) and momentum running the inference; for a scripted being, deterministic code; for a human, a notification waiting. The Summon row records that the moment happened. The reply emits back to the asker through the same SUMMON verb, requesting the asker's next moment.

The being has no in-between. Substrate carries the lane forward to the next moment.

Three cognition types, one shape. The shape is the verb. The product is the reel.

## Deferred

- **reelAlligner.js extraction.** The functions that read stamped history + ancestor cache + position state and form the substrate view for the next stamp (`ensureSession`, `checkTreeCircuit`, `stageCall`, `resolveLlmConfig`, `resolveToolsForPosition`) currently live inside stamper.js. A follow-up pass moves them into `reelAlligner.js`.
- **momentum.js extraction.** The provider-call + tool-dispatch loop (`callLLM`, `executeTool`, the `stepTurn` Phase 6 body) currently lives inside stamper.js. A follow-up pass moves them into `momentum.js`.
- **`beingAssignment/index.js` dispatcher.** Per-type dispatch today is implicit in `roles/registry.js` + `role.summon`. Materializing it as a factory-side dispatcher would touch every external caller; the folder structure honors the architecture without forcing the rewire.
- **`beingAssignment/human/` and `beingAssignment/script/` subfolders.** Empty scaffold isn't worth the noise. Human and scripted beings don't pass through the factory — they skip straight from inbox to role.summon code.
