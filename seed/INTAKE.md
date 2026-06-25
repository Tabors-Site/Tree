# INTAKE — The Inbox Model

> *"The inbox IS the call queue. Every wake starts here. Nothing else writes."*

This file pins the intake model. It sits beside SUMMON.md, FACTORY.md, and AblesAreAuth.md. Read SUMMON.md first; intake is what happens to a CALL between landing and the receiver's able running.

## One sentence

**Every pending call to a being is one InboxProjection row, keyed by the call's correlation, materialized from the caller's `call` fact by a cross cutting fold, picked by the scheduler, closed when the receiver's answering Act seals.**

## What the inbox is NOT

The inbox is a derived row. It is not durable storage; it is not the source of truth. The fact chain is. The InboxProjection is the cache of "what wakes are still open" derived from the chain.

- **Not stored on `qualities.inbox`.** The old `qualities.inbox = {...}` map is retired (2026-05-23, Bucket 3 Option D). All inbox state lives in the `InboxProjection` collection.
- **Not a queue with workers.** It's a record of open wakes. The being's able handler is what processes the entry, not a generic worker pool.
- **Not a message bus.** Each call names ONE recipient. There is no broadcast.
- **Not transactional outside the chain.** Materialization is a fold side effect. The audit truth is the `call` fact; the row is convenience.

## Where each row comes from

Every row is the output of one cross cutting fold handler running on one fact.

```
CALL verb (seed/ibp/verbs/call.js)
  ├─ authorize() — actor's able permits sending
  ├─ permitsReceiverSummon() — receiver's able accepts intent
  └─ emitFact({verb: "call", target: <recipient>, params: {correlation, content, intent, ...}})
       └─ cross cutting fold (seed/past/projections/inbox/inboxProjectionFold.js)
            └─ InboxProjection.updateOne({_id: correlation}, ...)  ← the row appears
```

The fact is the truth. The row is the cache. Replaying the chain rebuilds the row. Dropping the projection collection and re folding rebuilds every row exactly. No row ever exists without a corresponding `call` fact behind it.

## Row shape

Stored in `seed/past/projections/inbox/inboxProjection.js`. Authoritative schema; this doc tracks intent.

| Field | Source | Notes |
|---|---|---|
| `_id` | `params.correlation` | One row per call; correlation IS the key |
| `recipient` | `fact.target.id` | Who the call is for |
| `summoner` | `fact.beingId` | Who sent it (I-Am for seed internal flows) |
| `sender` | `params.sender` | Envelope `from` stance |
| `content` | `params.content` | Opaque payload |
| `intent` | `params.intent` | Envelope intent; the receiver's able handler reads this |
| `priority` | `params.priority` | Enum label; pick order comes from `priorityRank`, not this string |
| `priorityRank` | fold (`priorityRankOf`) | Numeric pick order: 1 `HUMAN`, 2 `GATEWAY`, 3 `INTERACTIVE`, 4 `BACKGROUND` |
| `orientation` | `params.orientation` | `forward` (default), `half`, `inward` (self calls only) |
| `rootCorrelation` | `params.rootCorrelation` | Conversation root; sever sweep target |
| `inReplyTo` | `params.inReplyTo` | Which earlier call this replies to |
| `inboxSpaceId` | `params.inboxSpaceId` | Where the call was addressed |
| `sentAt` | `params.sentAt` | FIFO tiebreaker within a priority class |
| `activeAble` | `params.activeAble` | Which able the moment runs under |
| `history` | `fact.history` | The history the row's moment runs on; sever sweep deletes per history |
| `attachments` | `params.attachments` | Caller side metadata, opaque to seed |

## The scheduler picks rows

```
scheduler tick / wake event
  └─ pickNextIntake(spaceId, beingId, {excludeCorrelations})
       └─ InboxProjection.findOne({recipient, inboxSpaceId, _id ∉ excluded})
            .sort({priorityRank: 1, sentAt: 1})
                 ← row picked (runs on the row's own history;
                   paused/deleted history rows are excluded per pass)
       └─ scheduler in-memory: claim correlation for this being
       └─ assign + run moment with the picked row as the call
```

Priority order: `HUMAN`, `GATEWAY`, `INTERACTIVE`, `BACKGROUND`. The pick sorts on the numeric `priorityRank` (1..4) the fold writes from the enum, because the strings sort lexically to the wrong order (`BACKGROUND` would pick before `HUMAN`). Ties go to oldest `sentAt` (FIFO within class).

**Claim is in memory only.** The scheduler holds a `Map<beingId, currentCorrelation>` to prevent a second pick before the first moment seals. A crashed moment leaves the row in place and the next tick re picks it. Self healing.

## Rows close on answer, not on processing

A row stays open until the receiver's able produces an answering Act. The closing happens via `closeInboxOnAnswer` (`seed/past/projections/inbox/inboxProjectionFold.js`), called from `stamped.js` after the Act commits with `answers: <correlation>`.

```
receiver's able.call() runs
  └─ stamps facts in the moment's ΔF
       └─ sealAct commits the Act with answers: <correlation>
            └─ closeInboxOnAnswer(correlation) → InboxProjection.deleteOne({_id})
```

A moment that fails (cognition error, exception inside the handler) produces no Act. No Act → no `answers:` → row stays open. Next tick re picks it. **Failed moments leave zero trace including no inbox close** — the model is self healing by structure, not by retry logic.

## Severance evicts rows

When a thread is cut (`do(.threads/<id>, cancel)` or `seed/materials/space/threads.js#cutThread`), a `be:sever` fact is stamped with the `rootCorrelation`. The same cross cutting fold runs `InboxProjection.deleteMany({rootCorrelation})` — every open row under that conversation root is dropped at once. Severance is a chain event with a fold side effect, same shape as materialization.

## Transport acts ride the same shape

A human's transport act (WS / HTTP / CLI keystroke) is modeled as a SELF call: the being is both caller and recipient. The fact is `verb: "call"`, `beingId: <self>`, `target.id: <self>`, `params.transportAct: true`. The same fold materializes the row; the scheduler picks it; the same moment runner runs the human's cognition. There is no second intake path.

`enqueueIntake(spaceId, beingId, entry)` in `seed/present/intake/intake.js` is the seam for transport acts. `kind: "call"` no longer accepts — the CALL verb stamps directly. Only `kind: "transport-act"` flows through `enqueueIntake`.

## Reading the inbox from outside

The `my-inbox` SEE op (`seed/present/intake/inboxOps.js`) returns every open row addressed to the caller, sorted newest first. Used by the 2D portal's inbox panel; usable by any client that wants to see what's pending.

Each entry on the SEE response carries:

- The row fields above (correlation, intent, content, sender, etc.)
- `summonerName` — resolved from the caller's `Being.name` so the panel can print `@from` without a second round trip
- `render` — a JSON serializable spec built by the inbox renderer registry (see below)

## The renderer registry

For human inhabited receivers, the inbox panel is the cognition surface. Per SUMMON.md, the panel is a **dumb renderer**: it does not switch on intent. The receiver's able decides what UI to show; the panel renders whatever spec comes back.

The mechanism: an inbox renderer registry keyed by envelope intent. Server side. For each pending entry, `my-inbox` calls `buildInboxRenderSpec(entry, ctx)` and attaches the spec to the entry. The panel reads `entry.render?.shape` and dispatches.

```
seed/present/intake/inboxRenderers.js     ← registry
seed/present/intake/renderers/index.js    ← seed registrations (side effect)
seed/present/intake/renderers/<intent>.js ← one file per seed shipped renderer
```

Extensions register their own renderers through `story.declare.registerInboxRenderer(intent, fn)`.

### Spec shape

```js
{
  shape: "action-buttons" | "free-text",

  // Optional body override (panel renders raw entry.content when absent).
  body: { html?: string, text?: string },

  // For shape="action-buttons":
  buttons: [
    {
      label:    string,                                  // visible label
      kind:     "ok" | "warn" | "neutral",               // styling
      ops?:     [{ target, action, args }],              // dispatched in order on click
      reply?:   { content },                             // reply call's content
      disabled?: string,                                 // reason; panel disables + tooltips
    },
  ],

  // For shape="free-text" (or default fallback):
  placeholder?: string,
  allowDismiss?: boolean,                                // dismiss button on/off
}
```

The spec is JSON. No functions on the wire. The able decides server side what the spec contains; the panel runs the actions client side. Sovereignty: the able chose every button and every action; the user picks which one to click.

### Action execution

For each button click (action-buttons shape):

1. Panel calls `flat.doOp(target, action, args)` for each entry in `ops` in order.
2. If any op fails: button shows the error, no reply sent, row stays open.
3. If all ops succeed: panel calls the original caller with `content: btnSpec.reply.content, inReplyTo: entry.correlation`.
4. The receiver's Act seals → `closeInboxOnAnswer` evicts the row → panel refreshes.

For free-text shape: the panel renders an input + reply button + optional dismiss. Reply sends `{ message: <input> }`; dismiss sends `{ result: "dismissed" }`. Same close flow.

### Seed shipped renderers

| Intent | Renderer | What it does |
|---|---|---|
| `able-request` | `ableRequest.js` | Approve/deny buttons. Approve dispatches `grant-able` on the asker's stance with the requested able + anchor, then replies `{result: "approved"}`. Deny just replies `{result: "denied"}`. Approve disables with reason when the asker stance can't be resolved. |

Extensions add entries here through their own registration calls.

## Replies close loops; there is no "respond" verb

Responding to a call is a normal CALL back at the caller with `inReplyTo: <correlation>`. The `closeInboxOnAnswer` hook closes the row when the reply's Act seals. No separate verb; no separate op. The call machinery is the close machinery.

When the response also needs a side effect (approve a able request → grant-able on the asker), the caller dispatches the side effect AND the reply. The inbox renderer registry expresses this declaratively (`ops: [...]` followed by `reply: {...}`); for cognition that issues acts directly (LLM driven ables, scripted handlers), the able's own handler issues each act in order.

## Inbox is NOT the same as threads

Threads are conversation roots. Inbox rows are open invitations to wake. A thread can have many open invitations (one per unanswered call in the conversation); severing the thread removes them all at once. Threads live in their own projection (`ThreadsProjection`, `seed/past/projections/threads/`). Don't conflate.

## Pinned slogans

- **Every row is a fold of a fact. Drop the projection and re fold; nothing is lost.**
- **A row closes only when the answer is sealed.**
- **No envelope field, no panel switch, no convention compels the receiver. The able decides.**
- **The inbox is the wake queue. The chain is the record.**
