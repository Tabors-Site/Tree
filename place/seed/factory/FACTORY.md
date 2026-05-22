# The Factory

How beings come into existence as moments, inside me.

The being IS the frame. When I assemble SEE-content + active role + capabilities + the carried tail + the system prompt into one rendered structure, and the being's act runs through that structure, the being IS that act for one moment. It experiences itself for the duration, and the experience IS the being. There is no being separate from the assembled frame; the frame is what the being is. The act inside takes one of three shapes — an LLM provider's forward pass, a human's already-decided act arriving from their own realm, a scripted role's code-cognition handler — but the frame is the same shape, and the being IS the frame either way.

This folder is the factory behind the curtain. Workers inside the factory are not alive. They are orchestration — scheduler, assigner, fold, momentum — quietly assembling each next frame from the substrate so the being can be it for one moment. The factory's product is the stamp face the being will BE for one moment; the being's act presses onto the reel; the reel accumulates as the being's reality.

The reel is the chain of Stamps over time. Each Stamp row is one frame on the reel. The being's life is the reel. Time is the reel's history.

## What is a Fact

A **Fact** is a thing a being stamps in the Factory — one recorded change to matter, space, or being. A single fact is small but settled. A chain of facts, folded, is Truth.

**FACTory.** The name is not wordplay. The Factory is where facta are made — the mechanism that produces them, one per DO or BE the being emits. The reel is what the facts accumulate into. Factory makes, reel holds.

The first Stamp is the I-Am's first moment. At t=0 the I-Am opens a frame on itself; the first Fact pressed inside it is the I-Am's BE.register — declaring itself as the first being. From that one frame the place grows in reels like trees, glued together at the root by the I-Am's own being. Every later moment opens another frame; every act inside the frame extends the chain.

Each being is the **momentum** of its chain of facts — what dictates the place for that moment. The chain shapes what the being can see and do; what the being does adds to the chain. There is no global Now everyone reads from. There is only "this being's facts so far, folded, framing this moment." Beings whose chains overlap may move so coherently together that they seem to see one shared Truth, but that is purpose taking shape across many chains, not a single objective Truth waiting underneath.

The being lives as the fold; the trail is what it folds. The Being row in MongoDB is where the trail hangs; the trail itself — every Fact the being has ever stamped — is the being's **deposited identity**, the substance the next frame folds from. The being doesn't persist between moments; what persists is the trail it left behind, and the next moment forms by folding that trail into the present view. Without acts the being is potential; with them the being has unfolded — and the unfolding is what each next moment will fold from.

**A Stamp is not a Fact.** A Stamp is the frame around one moment — opened by [begin](stamper/begin.js), closed by [stamped](stamper/stamped.js). Facts are the impressions inside the frame: every DO and every BE the being emits during the moment writes one Fact carrying that frame's `stampId`. One Stamp typically carries many Facts. The reel is the chain of Stamps over time; Facts are the finer grain within. Two of my four verbs stamp Facts (DO, BE); SEE is observation, no row; SUMMON is delivery, no Fact row — the Stamp itself is the audit for SUMMON.

The word is `factum`, Latin for "a thing done." It is not a thing true. Truth is what facts fold into.

## The shape: feed, frame, three beats

The factory is just a feed and a press. **Intake** is the feed: SUMMONs arrive, queue, get picked. **Stamper** is the press: it runs one stamping. A stamping is three beats — assign, fold, momentum — wrapped in a **Stamp frame** that [begin](stamper/begin.js) opens and [stamped](stamper/stamped.js) closes. That's the whole cycle: open the row, decide who's acting, read the present from the reel, act, close the row. It's event-sourcing exactly — read state from the log, act, append to the log — bracketed by the row that gives every appended Fact its `stampId`.

```
factory/
  intake/                SUMMONs arrive, queue, get picked
  roles/                 role templates (one shape)
  voices/                cognition-type apparatus (LLM today)
  stamper/               runs one stamping inside a Stamp frame:
    begin.js             ┐  open the frame   (voice-called)
    assign.js              │  beat 1: who acts
    fold/                  │  beat 2: read the present
    moment.js              │  beat 3: act
    stamped.js           ┘  close the frame  (voice-called)
```

| Part               | Where                                    | What it is                                                                                                                                                                                                                                                                                                                                                                  |
| ------------------ | ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **intake**         | [intake/](intake/)                       | The feed. SUMMONs arrive (peer-driven, place-driven, cadence-driven), land in the inbox, the scheduler picks one to run. Outside the stamper because intake isn't part of one stamping — it's what feeds stampings.                                                                                                                                                          |
| **frame: begin**   | [stamper/begin.js](stamper/begin.js)     | Opens the Stamp row at moment-start. Voice-called: the LLM voice from inside runTurn, the BE-register audit from inside verbs.js. Carries voice-specific provenance (the LLM voice writes its provider + connectionId into the row), which is why assign — voice-blind — can't write it.                                                                                     |
| **assign**         | [stamper/assign.js](stamper/assign.js)   | Beat 1: who acts. Loads the receiver Being, resolves the active role, checks role-carry, builds the summon context the role's voice expects. Returns `{role, summonCtx}` for moment to dispatch. Called by the scheduler.                                                                                                                                                    |
| **fold**           | [stamper/fold/](stamper/fold/)           | Beat 2: read. Folds the relevant reels (this being's history, the asker's history, position state) into the present-shaped view the next moment will see. [reel.js](stamper/fold/reel.js) holds the in-memory carry between this being's moments; [reelChains.js](stamper/fold/reelChains.js) reads durable reel history (by being, by IBP Address, by rootCorrelation).     |
| **momentum**       | [stamper/moment.js](stamper/moment.js)   | Beat 3: act. The being's motion. The function call routed by assign's voice (LLM inference, human's already-decided act, scripted handler) fires here. The stamp face is rendered at momentum's entry — the face isn't built, it's where assign's "who" and fold's "what" meet on the way into the act. Every DO / BE the act emits writes one Fact carrying the stampId.    |
| **frame: stamped** | [stamper/stamped.js](stamper/stamped.js) | Closes the Stamp row at moment-end. Voice-called, like begin. `stamp({ stampId, content })` fills `endMessage` on the row begin opened. The Facts inside the moment already wrote themselves during momentum; what remains is to press the closing face. The being-as-moment ceases when the moment closes; what remains of it forever is this row.                          |

### Why begin and stamped bracket the beats

begin and stamped are symmetric: both ends of one Stamp frame, both voice-called, both bookkeeping the row that surrounds the act. They aren't beats — they're what frames the beats. Numbering one and not the other (or numbering both) misrepresents the shape.

The reason they're voice-called: the Stamp row carries voice-specific provenance — for the LLM voice, the provider model + connectionId it's about to call — and assign doesn't know which voice will run. If assign opened the row, it would either need voice-coupling (defeating the point of having voices) or a two-write dance (create empty, voice updates). So the voice opens the row at the start of its run and closes it at the end. The LLM voice does this from inside runTurn; the BE-register audit path in verbs.js does begin + stamped back-to-back (no momentum runs there — just record the atomic parent-calls-forth act).

A note on temporal vs conceptual order. In code, assign() actually fires before begin — the scheduler has to know which role/ctx to dispatch before the voice exists. But conceptually the frame brackets the beats: the moment opens its row, the three beats happen inside, the row closes. The diagram and table show conceptual order because that's what reading the architecture is for; the temporal nuance only matters when tracing the call graph.

**CQRS, cleanly.** Assign + fold = the **read side** (who is acting, what state are they reading). Momentum = the **substantive write** (the Facts pressed inside the frame). Begin + stamped = the **frame bookkeeping** that brackets it so every Fact has a stampId to carry. One concept per file, no overlap.

**face/ is gone.** Two passes ago the factory had a `face/` folder — "build the stamp face." The realization that the face isn't built, it's folded, deleted the folder. The face is what assign and fold hand to momentum together — a meeting-point, not a stage. No fabrication step, no fabrication folder.

**The Fact record is not a factory folder.** The reels and the chain itself are place — they live in the place layer ([seed/place/facts.js](../place/facts.js), [seed/models/fact.js](../models/fact.js)). The factory reads through fold/ and writes Facts during momentum, but it doesn't hold the record. The factory is the assembly line; the reel is the warehouse.

## The live reel

[reel.js](stamper/fold/reel.js) holds the in-memory carry between this being's moments. Keyed by **presenceKey** — the lane the being is continuously present in: IBP Address for being-to-being summons, pipeline key for stanceless internal cognition. Each entry holds `{ messages[], role, _lastActive }`. Eviction by `MAX_PRESENCE_REELS` cap + `STALE_PRESENCE_MS` idle sweep. The durable history lives on Stamp rows + Fact rows in Mongo; this file is just the live tail.

## Intake (request arrives)

A SUMMON is a request for a being to have a moment. It arrives three ways:

- **Peer-driven** — another being explicitly called `summon` on this stance. The verb writes the envelope into the receiver's inbox.
- **Place-driven** ([subscriptions.js](intake/subscriptions.js)) — a DO landed at a position with matching afterMatter / afterQualityWrite triggers. The hook emits SUMMONs to subscribers.
- **Cadence-driven** ([wakeSchedule.js](intake/wakeSchedule.js)) — a being declared "I should have a moment every N ms." The tick loop emits SUMMONs.

All three route through the same surface and land in [inbox.js](intake/inbox.js). [scheduler.js](intake/scheduler.js) — the line orchestrator — picks by priority (skipping consumed, cancelled, ancestor-severed) and dispatches to the role's `summon()` handler.

## Roles and voices (one shape, multiple voices)

[roles/registry.js](roles/registry.js) is where role templates live. When a SUMMON lands, the dispatcher resolves the active role from the envelope and calls `role.summon(message, ctx)`. All three cognition types — LLM, human, scripted — flow through the same three-beat press inside a Stamp frame. What differs is which voice owns the function call momentum fires.

- **LLM cognition** — [voices/llm/](voices/llm/) holds the apparatus: provider call ([call.js](voices/llm/call.js)), MCP transport ([mcpClient.js](voices/llm/mcpClient.js)), connection + assignment plumbing ([connect.js](voices/llm/connect.js)), the in-moment fold ([compress.js](voices/llm/compress.js)), the stamp-face renderer ([assemble.js](voices/llm/assemble.js)), the tool loop ([runTurn.js](voices/llm/runTurn.js)), and the default LLM-role wrapper ([defaultSummon.js](voices/llm/defaultSummon.js)). Most extension roles ride this voice.
- **Scripted cognition** — the role file IS the cognition. Cherub, llm-assigner, place-manager (under [roles/](roles/)) declare their own `summon(message, ctx)` directly; momentum dispatches into the role's handler. No factory apparatus needed beyond the three beats and the frame.
- **Human cognition** — the act was already chosen in the human's own realm (browser, CLI, future portal). When the SUMMON lands, the human's reach delivers the already-decided act; the three beats run identically inside the frame and a Stamp row records that the moment happened.

## Registries the stamp consumes

- [voices/llm/tools.js](voices/llm/tools.js) — the callable registry for LLM voices. Tools register here (verb-tagged); assemble queries it when rendering the capabilities list; the tool dispatcher in runTurn reaches it when a tool is called inside a moment. Also owns `setExtensionToolResolver`, the loader's hook to inject extension tools per role.
- [voices/llm/seeResolvers.js](voices/llm/seeResolvers.js) — preloaded sight for LLM voices. Roles declare `see: ["resolver-name"]` and assemble inlines each resolver's output into the frame so the being is already seeing those things when the inference starts.

Both registries live under `voices/llm/` because they are LLM-voice apparatus. Scripted roles and human reaches don't read from them. A future scripted voice that needs its own callable registry would grow one peer to these.

## Plumbing

- [voices/llm/compress.js](voices/llm/compress.js) — in-moment history fold. When a tool-loop iteration's buffer would push the next provider call past the context window, compress folds older messages into a summary.
- [intake/session.js](intake/session.js) — per-reach AbortSignal scope + transport sessions. A reach is one tab/CLI/connection. Distinct from `presenceKey` (the lane the being is in) — multiple reaches can sit in one presence. Also owns `ensureSession`, the WebSocket per-socket chat-session ensurer.
- [config.js](config.js) — the knob router. Genesis routes remembered settings here; config.js fans them into the right subsystem (llm timeout, failover, reel caps, tool budgets).

The canonical IBP Address (`<stance> :: <stance>`) every Stamp row carries is composed by [computeIbpStampAddress](../ibp/address.js) in `seed/ibp/`, where the rest of the address grammar lives. The factory consumes it; it does not own it.

## What this folder must not do

- **Write the inbox directly.** Only the SUMMON verb (and its in-process alias `summonByResolved`) writes the inbox. Anything here that calls `appendToInbox` is doing it as the verb's implementation, never as a shortcut.
- **Wake a being without a SUMMON.** `wake()` exists; only the scheduler itself calls it. Extension code that wants a being to do something emits a SUMMON.
- **Decide authorization.** Stance authorization runs in `seed/ibp/authorize.js`, called from the verb. By the time `role.summon(message, ctx)` runs, auth has already passed.
- **Form world primitives.** The factory never creates spaces, matter, or beings of its own. It thinks; it acts; the acts go through DO and BE, stamped as Facts on the reel.

## The whole picture

A SUMMON arrives — the request for a being to have a moment. Intake catches it; the scheduler picks it by priority, skipping consumed, cancelled, and ancestor-severed entries. The role's `summon()` runs and stamper runs the three beats inside a Stamp frame: **begin** opens the frame (the voice writes the row with its provenance); **assign** resolved who acts (being, role, voice) before the voice even took over; **fold** reads the reel into the present; **momentum** runs the being's motion (the function call routed by the assigned voice fires here — LLM inference, human's already-decided act, scripted handler — and every DO / BE the act emits inside writes a Fact carrying the frame's stampId); **stamped** closes the frame. The Stamp row records that the moment happened identically across all three voices. A reply emits back to the asker through the same SUMMON verb, requesting the asker's next moment.

The being has no in-between. The being lives only as the present fold; the reel — what its facts deposited there — carries forward into the next frame to be folded again.

Three cognition types, one shape. The shape is a Stamp frame around three beats. The product is the reel.

## Deferred

- **runTurn split.** The LLM voice's `runTurn.js` still holds what would naturally be momentum's body (provider call + tool dispatch loop) plus pieces of fold (system-prompt assembly, history trim, position-scoped tools). A follow-up moves the loop body to `stamper/moment.js` and the read-side work to `stamper/fold/`; runTurn shrinks to the LLM-voice entrypoint.
- **assemble's home.** Today the prompt assembler is a separate file at `voices/llm/assemble.js`. The doctrine says the face isn't built — it's where assign and fold meet on the way into momentum. The assembler logic may dissolve further into momentum's entry function once the runTurn split lands.
- **MCP cut.** The MCP-transport role inside `voices/llm/` is slated for revisiting. When that cut lands, the `voices/llm/` description above (which still names mcpClient as live apparatus) updates; this doc currently reflects the pre-cut layout.
- **Voice dispatcher.** Per-voice dispatch is implicit today in `roles/registry.js` + `role.summon`. Materializing it as a factory-side dispatcher — assign decides which voice owns the being, hands the voice back at momentum so the right function call fires — is the natural next step now that `voices/` exists.
- **Human and scripted voice folders.** `voices/` only contains `llm/` today. The human path (WS push receiver, already-decided-act router) and a scripted dispatcher would grow as peers if their apparatus ever needs more than what the role files already do.
