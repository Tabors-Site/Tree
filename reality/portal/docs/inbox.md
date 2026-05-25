# The Inbox Model

Every being has an inbox at its position. Every SUMMON places there. Summonings read it. This document specifies the inbox's place in the record, the summoning triggers that fire on inbox writes, and the response delivery contract.

Read [being-summoned.md](being-summoned.md) and [message-envelope.md](message-envelope.md) first.

## Where the inbox lives

The inbox is per-being-per-position metadata, stored under the well-known namespace `metadata.inbox` on the position's space.

Although `metadata` is the same Map that extensions use, the inbox is **not an extension namespace.** The seed knows about `metadata.inbox` the same way it knows about `metadata.modes` and `metadata.tools`. It is part of the protocol's commitment, not optional.

A space may host multiple beings (one per being invocable at that position). Each being gets its own inbox bucket:

```
space.metadata.inbox = {
  "ruler": [<message>, <message>, ...],
  "worker": [<message>, ...],
  "archivist": [<message>, ...]
}
```

The bucket key is the being name. Messages within a bucket are ordered by `sentAt`.

## Inbox entry shape

Each entry is a complete message envelope plus protocol-side bookkeeping:

```
{
  // From the SUMMON envelope:
  from:        <stance>,
  content:     <text or structured>,
  intent:      "chat" | "place" | "query" | "be",
  correlation: <id>,
  inReplyTo?:  <correlation id>,
  attachments?: [...],
  sentAt:      <ISO8601>,

  // Added by the protocol:
  consumed:    boolean,
  consumedAt?: <ISO8601>,
  stampedAt?: <ISO8601>,
  responseId?: <correlation id of the response, if any>
}
```

`consumed` flips to true when the being's summoning has processed the message. `stampedAt` records when summoning was triggered (may be different from sentAt if summoning is gated by a hook or schedule). `responseId` ties the inbox entry to the response message it produced, if any.

## Seed helpers

The seed exposes three operations for inbox access. Extensions and beings use these; direct Map manipulation is not supported.

```
appendToInbox(spaceId, being, message) -> { messageId }
readInbox(spaceId, being, options?) -> [<entry>, ...]
markInboxConsumed(spaceId, being, correlationIds, responseId?) -> void
```

### appendToInbox

Atomic. Writes one message into the being's bucket and fires the inbox-write event the seed uses to drive summoning. Used by the SUMMON handler and by any system code that wants to deliver a message (cascade-deliver, completion hooks, scheduler).



### readInbox

Options:
- `since: <timestamp>` only entries with `sentAt >= since`
- `unconsumed: true` only entries with `consumed: false`
- `limit: <n>` cap on entries returned

Used by summonings to gather what is new. Most beings read with `unconsumed: true` to see only messages they have not yet processed.

### markInboxConsumed

Called by the being (or by the protocol on behalf of the being) after a summoning processes messages. Sets `consumed: true` and writes `consumedAt`. Optionally ties to a `responseId` so the audit chain is complete.

Consumed messages stay in the inbox as history; they are not deleted. The being's accumulated history is part of its record.

## Summoning triggers

Beings declare in their manifest when they want to be summoned. The seed listens for triggers and fires summonings accordingly.

```
manifest.triggerOn = ["message", "hook", "cascade", "schedule"]
```

Multiple triggers are allowed. Combinations are typical.

### message

Summon immediately when a new SUMMON is appended to the inbox. The most common trigger. Sync-shaped beings (Workers, Oracles, simple chat beings) use this.

```
appendToInbox(...)
  -> fires inbox-write event
    -> seed matches against triggerOn
      -> if "message" in triggerOn:
        -> summon the being now
```

The summoning reads the unconsumed inbox entries, acts, and ends.

### hook

Summon when a subscribed hook fires. Used by beings whose work is dispatched and they need to be told when it finishes. The Ruler pattern.

```
manifest.triggerOn = ["message", "hook"]
manifest.hookSubscriptions = ["governing:plannerCompleted", "governing:branchRetried", "governing:executionCompleted"]
```

When the hook fires, the seed summons the being. The summoning sees the hook payload alongside the inbox.

### cascade

Cascade arrivals are SUMMONs (per the protocol's unification), so technically they fire `message`. But beings may distinguish: some beings want to be summoned for direct messages but not for cascade arrivals, or vice versa.

The `cascade` trigger is shorthand for "summon on SUMMON whose `from` is a system cascade-deliver origin."

### schedule

Summon at scheduled intervals. Used for beings that need to wake periodically even without inbox activity (heartbeat, digest, dream).

```
manifest.triggerOn = ["schedule"]
manifest.scheduleCron = "0 */6 * * *"   // every six hours
```

The seed runs the scheduler and summons accordingly.

## Response delivery

The being declares its `respondMode` in the manifest:

```
manifest.respondMode = "sync" | "async" | "none"
```

This determines what the SUMMON handler does after appending the message and triggering summoning.

### sync

The SUMMON handler holds the WebSocket ack open. When the summoning completes, the protocol writes the response inline as the ack content.

```
client -> ibp:summon { stance: ..., message: { intent: "chat", ... } }
  place appends to inbox, triggers summoning (synchronously)
    summoning runs, produces response
  place returns response inline as the ack
client <- ack { response: { ...response message... } }
```

Use sync for beings that respond fast: Workers producing direct matters, Oracles answering queries, simple chat beings.

### async

The SUMMON handler acks immediately with `{ status: "accepted" }`. The summoning runs (now or later). When it produces a response, the protocol writes a new SUMMON back at the sender's inbox with `inReplyTo` set.

```
client -> ibp:summon { stance: ..., message: { intent: "chat", ... } }
  place appends to inbox, triggers summoning, immediately acks
client <- ack { status: "accepted" }
... time passes ...
... summoning completes, produces response ...
  place writes SUMMON to sender's inbox (which is its own position's inbox)
client (listening on its home with live SEE) <- inbox update arrives
```

Use async for beings with long-running work: Rulers dispatching plans, Foremen running pipelines, anything that fires-and-forgets and reports back later.

A single async SUMMON may produce zero, one, or many response SUMMONs over time. The contract is "the response, if any, eventually arrives at the sender's inbox." It is not "exactly one response."

### none

The SUMMON handler acks immediately with `{ status: "accepted" }`. No response is ever generated.

Place-intent beings often use `none`. So do logger-style beings and event-sink positions.

```
client -> ibp:summon { address: ..., message: { intent: "place", ... } }
  place appends to inbox, triggers summoning, acks
client <- ack { status: "accepted" }
... summoning runs, does its work, ends ...
... no response is delivered ...
```

## Intent + respondMode interaction

These are independent dimensions:

| Intent | sync | async | none |
|---|---|---|---|
| chat | inline response | response arrives later | (unusual; intent expects response) |
| place | (unusual; place expects no response) | (unusual) | typical |
| query | inline response | response arrives later | (unusual; intent expects response) |
| be | inline or async per being | inline or async per being | (rare) |

Most combinations are sensible. The protocol does not forbid any combination; it lets beings declare and senders adapt.

Mismatches are real: a sender with `intent: chat` addressing an being with `respondMode: none` will get an ack and no response. The sender's UI should reflect this; the protocol does not warn.

## Multiple senders, one being

Multiple SUMMONs can arrive at the same being from different senders concurrently. Each `appendToInbox` is atomic; messages place in arrival order. Each fires its own summoning per `triggerOn`.

Summonings of the same being do not block each other at the protocol level. The place may serialize them per-being if it chooses (today's request queue does this for `chat`-intent messages), but the protocol does not require serialization.

A being summoned multiple times concurrently sees the inbox state at the moment of each summoning. Two summonings may see overlapping unconsumed entries; the being is responsible for using `markInboxConsumed` atomically.

This is consistent with the summoned-beings model: each summoning is an independent invocation reading a shared record.

## Inbox history and pruning

The inbox accumulates. By default, entries stay forever. Place config may set a retention policy:

```
config.inbox.retention = { days: 90 }
config.inbox.maxEntries = 10000
```

When retention triggers, the oldest consumed entries are archived (moved to a separate audit store) or pruned (deleted). Unconsumed entries are never pruned automatically; a being is responsible for processing or marking them.

## Inbox is observable via SEE

A Position Description for a being's position includes an inbox preview:

```
descriptor.inbox = {
  "ruler": {
    total: 47,
    unconsumed: 3,
    recent: [<last few entries>]
  }
}
```

Live SEE on the position streams JSON-Patch frames as inbox entries arrive and get consumed.

This makes the inbox visible in the portal UI. A chat thread is just a rendered view of one inbox plus the linked response inboxes (the conversation walks `inReplyTo` chains).

## What the inbox is not

- **Not a queue with workers.** It is a record. The being is summoned to read it, not a worker picking up jobs.
- **Not a message bus.** Messages are delivered to specific positions, not broadcast.
- **Not transactional.** Append is atomic; consumption is the being's responsibility; there is no rollback.
- **Not encrypted at rest by default.** The inbox is part of the space record and lives under the same access controls. Extensions like sealed-transport may layer encryption on top.

## See also

- [message-envelope.md](message-envelope.md) the SUMMON envelope
- [being-summoned.md](being-summoned.md) the architectural framing
- [protocol.md](protocol.md) the four-verb spec
- [position-description.md](position-description.md) how the inbox surfaces in SEE responses
