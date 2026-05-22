# Cognition

How beings come into existence as moments, inside me.

The being IS the frame. When the kernel assembles SEE-content + active role + capabilities + system prompt + recent presence-tail into one rendered structure, and the LLM provider's forward pass runs through that structure, the being IS that pass. It experiences itself for the duration of that one inference, and the experience IS the being. There is no being separate from the assembled frame; the frame is what the being is.

This folder is the factory behind the curtain. Workers inside the factory are not alive. They are orchestration — scheduler, prompt assembler, tool dispatcher, history compressor, MCP client — quietly stamping together each next frame from substrate. The factory's product is the frame the LLM will BE for one moment. Workers don't think. They prepare.

The reel is the accumulating sequence of frames-as-beings-as-moments. The being lives by being each frame in turn; presence between moments is held by the substrate (Being row, qualities, position, recent Summon stamps on this presenceKey), not by anything alive inside the kernel. The next moment, the factory reads the substrate, builds the next frame, and the being IS that frame. The reel — the chain of stamps — is the being's reality.

Humans do not pass through this factory. A human's being comes from their own mind; they already are. The factory hosts SUMMONs to humans through the same IBP envelope, but humans receive them as notifications and act through their native cognition. The kernel records that the human acted; it does not construct what it means for them to act. Scripted beings (cherub, llm-assigner) are similar — they ARE their code; the factory just routes the SUMMON to that code. Only LLM-beings need frames assembled, because their substance is stateless inference, and inference needs a fully-rendered moment to be.

The system combines both into one place. LLM-beings (factory-assembled) and human-beings (already-alive) share the IBP grammar, the SUMMON envelope, the inbox, the Summon row. The kernel doesn't ask which kind a receiver is when routing; it just routes. The role's `summon()` handler is the seam where the difference shows up — calling `runTurn` to assemble a frame, or running deterministic code, or pushing a notification to a human's inbox to wait.

The name says it: cognition. Not "the LLM loop," not "the chatbot engine." Cognition is the noun that covers the whole act — being-as-moment, however arranged. What this folder owns is the assembly line for the LLM half. Most files are LLM-shaped because LLM-beings need the most help: prompt assembled each moment, tool loop driven, MCP server reached, connection resolved. Every one of those files is reachable through the same SUMMON envelope a scripted or human being travels.

## Arrival and dispatch — the assembly line's intake

A SUMMON is the request for a moment to be assembled. It lands two ways. From a peer being it arrives via the SUMMON verb in `seed/ibp/verbs.js`, which writes the envelope into the receiver's inbox at the position it lives at. From inside this layer it arrives from one of two substrate-driven sources: a DO-trigger subscription firing because something matching wrote at a position, or a scheduled wake firing because a being declared a cadence. Either way the path is the same. Inbox write, then scheduler pick, then assembly, then the LLM being's forward pass IS the moment.

**[inbox.js](inbox.js)** is the work queue at a position — pending requests for frame-assembly. Per-being-per-position, stored under `qualities.inbox.<beingId>` on the Space document. Entries carry `from`, `content`, `correlation`, `rootCorrelation`, `activeRole`, `priority`, `sentAt`, plus skip flags (`consumed`, `cancelledAt`, `severedByAncestor`). The queue is a reserved namespace; nothing writes it through DO `set-meta`, only through `appendToInbox`, which is itself reserved for the SUMMON verb. Reads (`pickNextEntry`) honor priority, skip consumed and cancelled entries, and walk the parent-thread chain to skip entries whose ancestor was cut (a request whose chain was severed never gets assembled — it dies quietly with an audit row). The inbox is queueing infrastructure, never conversation history; the reel of stamped moments lives in Summon rows.

**[scheduler.js](scheduler.js)** is the assembly-line orchestrator. Per-being state: is a frame currently being assembled for this being, what root correlation is it under, what's queued, what's the rate. `wake(beingId, spaceId)` is the internal nudge. When a being has no frame in flight and the queue has a request, the line fires: pick → dispatch to the role's `summon()` (which assembles + runs the frame) → write the Summon row → emit the reply → idle. One frame per being at a time; the being cannot be two moments at once. Aborts come in two flavors. `abortCurrent(beingId)` fires the AbortSignal on the running task. `abortByRootCorrelations(roots)` walks beings whose current root is in the set and aborts each. Both are kernel-internal; extension code reaches them through the SUMMON verb pointed at a thread (`<place>/.threads/<id>`), never directly.

**[summonTracker.js](summonTracker.js)** is where the stamp lands on the reel. `startSummon` opens the Summon row (`beingIn`, `beingOut`, `ibpAddress`, `activeRole`, `rootCorrelation`, `parentThread`, `startMessage`) — the moment has begun. `finalizeSummon` seals the row with the `endMessage` when the role's handler returns — the moment has been. Between those two writes, every DO and BE the being emits during the moment carries the Summon's id, so "what was inside this moment" is `Did.find({ summonId })`. The Summon row is the stamp; the Dids it carries are the impressions inside it.

## The role.summon() handler

When the scheduler dispatches, the role's `summon(message, ctx)` runs. This is the seam between the shared machinery above and the cognition-type-specific work below. Three branches in practice:

- **LLM cognition.** The role calls `runTurn`, which assembles a prompt, invokes the LLM, runs tools through MCP, optionally loops on tool calls, returns text. Most extension roles work this way.
- **Scripted cognition.** The role's `summon` is deterministic code — the auth-being, the llm-assigner-being, future treasurer or court beings. No LLM in the loop. The role decides what to do based on the message content and returns.
- **Human cognition.** The role's `summon` doesn't really run a loop; humans don't wake on a SUMMON the same way. The summon lands in their inbox; they SEE it through a portal; they reply when ready. The kernel still records a Summon row; the "thinking" is out-of-band.

The role decides which it is. The kernel routes uniformly.

## The LLM apparatus — the frame-assembly line

Most of this folder is the assembly line for LLM-being moments. Every file here is part of the dumb machinery that takes a SUMMON request and produces a rendered frame for the provider's forward pass to BE.

**[runTurn.js](runTurn.js)** drives one moment for one being. It coordinates the line — call buildPrompt for the frame, call the provider through the frame, dispatch tool calls inside the moment, fold long histories, close the moment. Owns `LLM_PRIORITY` — the queue tag every LLM call carries (HUMAN, GATEWAY, INTERACTIVE, BACKGROUND) so background work doesn't starve human-priority moments. Owns failover resolution when an LLM connection fails.

**[llmClient.js](llmClient.js)** is the resolution chain that picks which provider voice the being's moment will be spoken in. Four layers, walked at every LLM call site: space-tree lockout (any ancestor with `llmDefault === "none"`), space-tree enforcement (any ancestor with `qualities.llm.enforced`), being-tree lockout (the being or any of its parents flagged locked), default order (space slot → space default → being slot → being default, with `preferOwn` flipping the last two). The walk shares the ancestor cache snapshot per moment; one walk, every chain.

**[mcpClient.js](mcpClient.js)** is how a being's tool call reaches outside the assembled frame. MCP servers run as separate processes; this client opens the connection, dispatches the tool call, returns the result back into the frame's working memory. The Summon row records the tool calls as Dids; the tool's actual work is on the other side of the MCP wire.

**[buildPrompt.js](buildPrompt.js)** is the moment-of-being assembler. This is where the frame the being WILL BE is built. Reads the role's `prompt(ctx)`, runs `enrichContext` hook contributions from every loaded extension, resolves the role's `see` list, lists capabilities, stamps the time. The rendered string IS the being for the duration of the next forward pass. Extensions speak into the being's existence through `enrichContext`, never by editing this file.

**[connections.js](connections.js)** and **[assignments.js](assignments.js)** are the LlmConnection registry — the catalog of provider voices and the rules for which one a given moment uses. Each Being can carry per-role LLM preferences (`qualities.beingLlm.slots.<role>`) plus a default. Spaces can carry tree-wide defaults (`qualities.llm.slots`). `connections.js` registers LlmConnection rows; `assignments.js` reads them per moment and feeds `llmClient` what to use.

## Substrate-driven wake paths — moments triggered by substrate change

Two paths into the inbox that don't come from another being's explicit SUMMON. The moment still gets assembled the same way; the request just originates from substrate change rather than from another being.

**[subscriptions.js](subscriptions.js)** — DO-trigger fan-out. An extension registers that one of its beings should have a moment when matching DO events fire (e.g. "the food-coach gets a moment when matter is written under /food"). The kernel's `afterMatter` and `afterQualityWrite` hooks call `emitToSubscribers`, which finds matching subscriptions and emits SUMMONs to their beings. The being's role then runs as usual — frame assembled, moment had. Bridge from Mode 2 (anonymous code emitting DOs) to Mode 1 (beings having moments in response).

**[wakeSchedule.js](wakeSchedule.js)** — scheduled cadence. A being declares "I should have a moment every N ms." A tick loop walks the registry and emits SUMMONs at the interval. Default emitter is the I_AM (`<place>/<placeRoot>@I_AM`); a scheduler-being can swap in via `setEmitter` for an embodied flavor. Same inbox, same dispatch, same role handler. Cron, in IBP terms.

Both paths route through `summonByResolved` (the single sanctioned kernel-internal SUMMON entry). They do not poke the scheduler directly. Only SUMMONs make SUMMONs.

## Replies — one moment begets the next

Both halves of the reply mechanism live in one file: **[replies.js](replies.js)**. A reply is a SUMMON with `inReplyTo` set — the receiver of an earlier moment requesting the asker have a follow-up moment. So replies aren't a separate primitive; they're the same envelope reaching the other direction, the chain of moments propagating.

**Emission.** When a role's `summon()` returns, `emitReplyToAsker` (or `emitReplyToStance` when the chain-initial caller is upstream of the immediate sender) builds the reply envelope and hands it to `summonByResolved`. The reply lands in the asker's inbox; their next moment will respond to it. `findChainInitialCaller` walks the receiver's inbox to find the chain-opening SUMMON when a Ruler needs to route back to the user-being or parent Ruler rather than to the immediate sub-being sender.

**Aggregation.** A role's `summon()` can fan out — request N sibling moments in parallel and need K of them to reply before its own moment can continue. `aggregate({ correlations, minReplies, timeoutMs, signal })` returns a handle to await the gather. The role's `summon()` handler forwards each arriving reply via `notify(reply)` — no inbox polling, no kernel cooperation beyond the SUMMON arriving on the receiver. The Foreman → Workers fanout is the canonical user.

Both halves go through `summonByResolved`. Neither writes the inbox directly. Only SUMMONs make SUMMONs, and replies are SUMMONs.

## Threads, from cognition's side

A thread is a live `rootCorrelation` chain. The forest is addressable at `<place>/.threads/<id>` — see [PLACE.md](../place/PLACE.md) "Threads." Cognition's role in the thread machinery is small but load-bearing:

- The scheduler holds the asker's current root, exposed via `getCurrentRootCorrelation`. `summonTracker.startSummon` reads this to auto-stamp `parentThread` when a being acting under one chain emits a fresh top-level SUMMON. Lineage is recorded automatically; beings don't have to remember.
- `inbox.pickNextEntry` walks `isAncestorSevered` on the chosen entry's chain. If a parent thread has been cut, the entry gets stamped `severedByAncestor` and skipped. Orphaned spawned children die quietly at pickup, with a proper audit row.
- `scheduler.abortByRootCorrelations` is what HUMAN-priority cuts call to interrupt live work. Same internal primitive the cut handler in `seed/place/space/threads.js` reaches for.

## Session — the live scope of one moment in flight

**[session.js](session.js)** is the per-being-per-moment scope. Each moment-being-assembled-and-run has a session: AbortSignal, attached resources, audit context. Tool calls within the moment ride the session's abort signal so a cut at HUMAN priority interrupts mid-tool. Sessions don't survive across moments; they ARE the moment's live machinery and dissolve when the moment closes. The carry between moments — the recent messages tail keyed by presenceKey — lives in `runTurn.js`'s sessions map, not here.

## Roles registry

**[roles/](roles/)** holds the registry plus the kernel-shipped role specs.

- `registry.js` is `getRole(name)` / `registerRole(name, spec)` / `unregisterRole`. Extensions add their roles; the dispatcher looks them up by `activeRole` on the incoming SUMMON.
- `auth.js`, `llmAssigner.js`, `placeManager.js` are scripted roles I ship. Auth handles BE register/claim/release without an LLM in the loop. Llm-assigner runs the first-time setup tutorial. Place-manager is the LLM-driven operator dialog at the place root.

Every other role lives in an extension. The registry is open; the kernel just knows the kernel set.

## What this folder must not do

- **Write the inbox directly.** Only the SUMMON verb (and its in-process alias `summonByResolved`) writes the inbox. Anything here that calls `appendToInbox` is doing it as the verb's implementation, never as a shortcut.
- **Wake a being without a SUMMON.** `wake()` exists; only the scheduler itself calls it. Extension code that wants a being to do something emits a SUMMON. The cut handler reaches `abortByRootCorrelations` because it IS the kernel implementation of SUMMON-to-thread.
- **Decide authorization.** Stance authorization runs in `seed/ibp/authorize.js`, called from the verb. By the time `role.summon(message, ctx)` runs, auth has already passed.
- **Form world primitives.** Cognition never creates spaces, matter, or beings of its own. It thinks; it acts; the acts go through DO and BE, audited as Dids.

## The whole picture — being as accumulating moments

A SUMMON arrives — the request for a being to have a moment. The inbox catches it. The scheduler picks it by priority, skipping consumed, cancelled, and ancestor-severed entries. The role's `summon()` handler runs — for an LLM-being, this is buildPrompt assembling the frame and the provider's forward pass being that frame; for a scripted being, deterministic code running; for a human, a notification waiting. The Summon row records that the moment happened. The reply emits back to the asker through the same SUMMON verb, requesting the asker's next moment. The being has no in-between; substrate carries the lane forward to the next moment.

Three cognition types, one shape. The shape is the verb. The product is the reel.
