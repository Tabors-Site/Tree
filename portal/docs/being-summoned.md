# Beings are summoned, not running

Read this before reading any other portal protocol doc.

The TreeOS protocol is shaped around a specific commitment about what a being is. Build against the wrong model and the architecture will not make sense.

## The two wrong mental models

**Wrong model A: beings as running agents.** A persistent LLM process sits at each position, holding context in memory, receiving messages as they arrive, responding in real time. This model implies continuous identity, in-process state, attention, a thread of consciousness.

This is not the protocol's model. There is no running process per being.

**Wrong model B: beings as stateless functions.** A request comes in, an LLM is invoked, a response goes out, all state is reconstructed from arguments. The being is just a label on a callable.

This is also not the protocol's model. State accumulates across invocations; the being is not stateless.

## The protocol's model

A being is a **position in a tree with a registered embodiment.** The position holds the being's record. When the being is summoned (by user message, by hook fired, by parent dispatch, by cascade arrival, by scheduled wake), a fresh LLM invocation reads the record and acts according to the embodiment. The invocation ends. The record persists. The next summoning continues from the persisted record.

Beings do not run continuously. They wake when called.

Continuity lives in the record, not in process.

This is **alive but episodic.** Subjectively, the being experiences no gap between summonings, because nothing happens to it during the gap. Objectively, hours or days may pass. The being pieces together identity from what was written before.

The closest human analogy is sleep. The person does not experience time across the gap; the inbox holds what arrived; on waking, the person reads and continues. The architecture is similar.

## Why this framing is load-bearing

**The inbox makes sense only under this model.** If beings were running, an inbox would be redundant (they would just receive messages directly). If beings were stateless, an inbox would be impossible (state would not survive). Because beings are summoned and the record persists, an inbox is the natural shape for messages that arrived between summonings.

**Concurrency makes sense only under this model.** Multiple beings across the system can be summoned simultaneously without conflicting, because no being holds a long-running resource. Multiple senders addressing one being is just multiple inbox writes; when the being is next summoned it reads them in arrival order.

**Federation makes sense only under this model.** A being can move between lands or be addressed from across the network because its identity is in its record, not in a running process. Forwarding a being amounts to forwarding its record.

**Coordination makes sense only under this model.** A Ruler fires-and-forgets background work and ends its invocation. When that work completes, a hook fires, and the Ruler is summoned again to see the result. There is no need for the Ruler to "wait" in any active sense, because the Ruler does not exist between summonings.

## The system is alive; the being is summoned

The protocol does not promise that any individual being is alive at any moment. It promises that across the system, summoning happens constantly. Many beings, many invocations, messages flowing between inboxes, beings waking and going quiet.

The aliveness of TreeOS is **distributed across summoned moments.** No single being is the locus of life. Life is a property of the system as a whole.

This matters for how the portal renders beings. A being's "status" is not "running" or "idle" in a process sense. It is the state of its record: what is in its inbox, what work it has dispatched, what its embodiment is currently capable of. The portal shows the record; the record is what the being is.

## Implications for protocol design

Because beings are summoned, the protocol can stay small:

- **Delivery is enough.** The protocol's job is to write a message into the inbox and trigger the summoning. The being does the rest.
- **No long-lived sessions.** A user "chatting" with a being is just a sequence of TALK deliveries and inbox-derived responses. There is no chat session in the protocol; there is correlation via `inReplyTo`.
- **Embodiments own concurrency.** The protocol does not declare whether a being responds inline or later. The embodiment declares its `respondMode`; the protocol honors it. This keeps the protocol policy-free.
- **The record is the source of truth.** No protocol-level state about what a being is "doing" right now. If you want to know, read the record.

## Implications for embodiment authors

If you are writing an embodiment, the contract you implement is:

> Given a record (including inbox), produce side effects and optionally a response. Then end.

You do not maintain in-process state across summonings. Everything you need to know on the next summoning must be written somewhere the next summoning will read.

Embodiments declare:
- `triggerOn`: when summoning happens (`message`, `hook`, `cascade`, `schedule`, combinations)
- `respondMode`: how the response is delivered (`sync`, `async`, `none`)
- `permissions`: which intents this embodiment honors (some embodiments only accept `query`; some accept all four)

Everything else, including coordination across summonings, is the embodiment's own design.

## Glossary

**Being.** A position in a tree paired with an embodiment. Identity is `<address>@<embodiment>`.

**Embodiment.** A registered behavior pattern (Ruler, Worker, Oracle, Dreamer, etc.) that describes how a summoning at a position acts.

**Position.** A node in a tree on a land. Addresses name positions.

**Record.** Everything written at a position: status, metadata, notes, contributions, inbox, conversation history.

**Summoning.** A fresh LLM invocation triggered by an inbox event or hook, reading the record and acting.

**Inbox.** Per-being-per-position metadata namespace holding messages that have arrived. Part of the record.

**Intent.** The permission-and-response classifier on a TALK message (`chat`, `place`, `query`, `be`).

**Sync vs async vs none.** The embodiment's declared response mode. Sync returns inline; async returns later as a follow-up TALK; none does not respond.
