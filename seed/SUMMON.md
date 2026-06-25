# SUMMON — Sovereignty, Address, Intent, Content

> *"The able IS how the call is handled. The being receives; the able decides."*

This file pins the doctrine the CALL verb implements. It sits beside AblesAreAuth.md, FACTORY.md, INTAKE.md, and CROSS-WORLD.md as a primary reference. Read this before changing call.js, the able registry, the intake path, the inbox panel, or any code that emits or routes calls. See [INTAKE.md](INTAKE.md) for how a CALL becomes a pending row and how it closes.

## One sentence

**A CALL carries three things — address (who receives), intent (the caller's stated purpose), and content (the payload) — and the receiving able decides what to do; nothing on the wire compels behavior.**

## The sovereignty principle (pinned)

**Callers express. Receivers decide.**

A CALL is a request, not a directive. No envelope field, no canSummon declaration, no convention can force a being to stamp a particular fact, return a particular shape, or run a particular tool. The receiver's able handler reads address, intent, and content, then chooses.

This is the same principle that lets federation work without granting trust: a cross story call cannot compel the foreign story either. Designing same story and cross story calls the same way is what lets the model compose across stories.

| Layer | What it does | What it does NOT do |
|---|---|---|
| Address | Picks the receiver and the active able within the being | Compel the able |
| Intent | States the caller's purpose; gates auth; routes inside multi able beings | Compel a response shape |
| Content | Carries the payload | Compel a side effect |

The receiver's able handler is the single place where action originates. Everything else is request.

## Three envelope parts

### Address — the stance with @qualifier

Format: `<story>/<path>@<qualifier>`. The qualifier picks a being by name (`@cherub`, `@food-log`) or by able shorthand (`@human` matches the first being at the position whose able is human). The resolver in `seed/ibp/resolver.js` walks the path and returns `{spaceId, being, ...}`; the call dispatcher then loads the being row.

A being can carry multiple ables. The active able for THIS moment is picked from envelope `activeAble` if present, then the being's `defaultAble`, then the qualifier. The being's flow gates which ables are allowed to wake at all; the envelope's pick is one input to that flow, not a bypass.

### Intent — the caller's stated purpose

A short kebab case label declared on the envelope. Examples seed uses today: `mate`, `able-request`, `offer-template`, `request-template`, `accept-template`, `deliver-template`, `template-result`.

Intent does three jobs:

1. **Stated purpose.** What the caller says they are reaching out about. Same shape as an email subject line: a short header the receiver reads before opening the body.
2. **Auth predicate.** Ables declare in `canSummon` which intents they may send (as actor) and which they accept (as receiver). The able walk in `seed/ibp/ableAuth.js#permitsSummon` reads the envelope intent and gates accordingly.
3. **Routing hint.** When a receiving being carries multiple ables, intent is one of the dispatch keys. A federation manager receiving a CALL with intent `offer-template` routes into a different handler arm than intent `accept-template`.

Intent is **not**:

- A contract the receiver must honor (it is a hint to the handler)
- A declaration of response shape (the handler chooses)
- A binding to a side effect (the handler chooses)
- A UI specification (the handler chooses)

Intent lives at envelope level, not inside content. That lets the auth walk check intent before content is deserialized, and lets multi able beings route before payload parsing. Putting intent inside content was the pre cleanup convention; envelope intent is the canonical shape.

### Content — the payload

Whatever the able handler needs. The substrate stores it Mixed. The able handler reads it. Content is opaque to auth and to routing.

## canSummon — the declaration surface

A able's `canSummon` entries declare call participation. Each entry is `{pattern?, intent?, as, description?}`.

- `as: "actor"` (default if absent) — caller side. This able may SEND calls matching the entry.
- `as: "receiver"` — receiver side. This able accepts calls matching the entry.

Pattern is the being name pattern (`"@cherub"`, `"@food-*"`, `"@*"` for any). Intent restricts the entry to calls whose envelope intent matches.

The able walk in `permitsSummon` consumes actor entries to gate outgoing calls. The receiver side of the post office check is `permitsReceiverSummon` in the same file — it runs against the receiver's able at dispatch time and is the gate that turns receiver entries from declaration into enforcement.

**Receiver gate, progressive enhancement.** A able with NO `as: receiver` entries is unrestricted (accepts any incoming call). A able with at least one `as: receiver` entry has DECLARED its accepted intents; the gate then strict-matches the envelope intent against those entries. A call without intent to a able with declared receiver entries refuses; you cannot bypass the receiver gate by omitting intent. Ables that haven't yet authored their receiver list keep current behavior; ables that have (cherub, birther for `intent: "mate"`) are now actually enforced.

**No behavior config on canSummon.** Entries declare WHAT is allowed, not WHAT HAPPENS when the call arrives. Response shape, side effect bindings, UI render hints all belong in the able's handler, not the declaration. Adding fields like `responseShape`, `onApprove`, or `responseExpected` to canSummon entries is drift; see the "Anti drift" section below.

## The receiving handler — where behavior lives

Cognition is what a being IS (LLM driven, human inhabited, scripted). The able's handler runs under whichever cognition is effective for the current moment.

| Cognition | Handler | What it produces |
|---|---|---|
| LLM | `runLlmMoment` reads the able's prompt, calls the model with the able's tools, the LLM decides | Stamped facts via tool calls; optional reply via the moment's tail |
| Scripted | `able.call(message, ctx)` runs synchronously inside the moment | Return value shapes into a reply envelope (or null for no reply) |
| Human | The inbox surfaces the pending call; the human's transport acts on it | A transport act stamps facts in the human's own moment |

All three are surfaces for the able's behavior. The call envelope is the same in all three cases. The able decides what to do with it.

For human inhabited beings, the inbox panel is the cognition surface. The panel should ASK the able what to render for a pending call, not switch on intent itself. That keeps the able sovereign over UI as well as facts. The seed ships the standard render shapes (approve/deny, yes/no, free text) as panel primitives the able can opt into. Ables that need novel UI provide a custom render. This work is upcoming; the current inbox panel switch on intent is acknowledged drift to be cleaned up.

## Anti drift — what NOT to add

Several reachable proposals have been considered and rejected. The reasons are doctrinal, not stylistic.

### Do not add `responseShape` to canSummon entries

Coupling caller side declaration with receiver side UI behavior puts behavior on a declaration meant for auth. The able's handler decides the response shape; it is not declared on the entry.

### Do not add `onApprove` / `onAccept` side effect bindings to canSummon entries

Same reason. Side effects are able handler choices. A declarative side effect binding turns canSummon into a mini DSL for behavior.

### Do not add a global `intent` registry parallel to canSummon

Intent already lives on able specs (canSummon entries). A separate global registry would have to be kept in sync with the able specs and would not earn its keep. Discovery, validation, and the auth gate all read canSummon directly.

### Do not let envelope intent dictate the receiver's response

The receiver's able handler may return a reply, return nothing, or return something completely unrelated in shape. Callers depending on a specific response shape are violating the sovereignty principle — including the seed's own callers. Cross checking what a particular able returns is part of writing a caller, not part of writing a wire contract.

### Do not move intent into content

Intent is auth and routing first, hint second. Auth must run before content is opened; routing benefits from envelope visibility. Content stays free for the able handler's payload.

### Do not introduce a "respond to call" DO op

Responding to a call is itself a CALL, with `inReplyTo: <correlation>` set. The fold handler that builds the InboxProjection closes the matching row on the answering call. The verb is uniform; reply is not a separate verb.

## The wire path

```
caller's act
  └─ callVerb (parse address, resolve receiver, derive activeAble)
       └─ authorize (actor's able walk reads envelope intent)
            └─ permitsReceiverSummon (receiver's able accepts this intent)
                 └─ emitFact (verb=call, target=recipient, params include intent)
                      └─ cross cutting fold materializes InboxProjection row
                           └─ scheduler picks row, runs able handler under effective cognition
                                └─ able decides; stamps facts; optionally replies
```

Both gates are mandatory. Removing either erodes the sovereignty principle: skipping the actor gate lets unauthorized callers call; skipping the receiver gate lets callers bypass declared acceptance.

Or for sync respondMode: `runCalling` runs the able's call handler in process and the dispatcher returns the reply envelope.

Or for `callByResolved`: callers with the receiver already resolved (DO trigger fan out, scheduled wakes) skip the parse and resolve; everything from authorize onward is the same.

## Audit shape

Every call stamps a `call` fact with:

- `verb: "call"`
- `beingId: <caller>`
- `target: {kind: "being", id: <recipient>}`
- `params.correlation`, `params.rootCorrelation`, `params.inReplyTo`
- `params.sender` (envelope from)
- `params.content` (envelope content)
- `params.intent` (envelope intent)
- `params.priority`, `params.orientation`, `params.activeAble`, `params.attachments`
- `params.inboxSpaceId`
- `params.sentAt`

The chain records what the caller stated, what they sent, and where. Audit reads the stated purpose (intent) and the payload (content) as separate fields. A caller cannot rewrite the chain after the fact.

## Cross story calls

For cross story calls (CROSS-WORLD.md owns the full picture; this is the CALL specific shape):

- The address has a foreign story on its left or right.
- The actor's local ables are looked up on the actor's home branch.
- The receiver's ables are looked up on their home branch.
- Both gates (actor authorize + receiver permitsReceiverSummon) run locally on the receiving story — neither side can be forced to honor a request from the other.
- Sovereignty is the only thing that scales: the foreign story runs its own ables, its own policies, its own handlers. Nothing the caller puts on the wire compels.

The wire shape is identical to same story calls. The canopy serializer in `seed/ibp/crossWorld.js` passes `payload.message` straight through to the local `callVerb`, so envelope intent on the wire IS the envelope intent the local verb stamps onto the call Fact and gates against. The federation manager's `sendIntent` / `dispatchToPeer` put the federation intent at envelope level and the remaining federation fields (negotiationId, manifest, bundle, etc.) in `content`; the peer's `federation-manager.call` reads `message.intent` first.

Address routes; intent states purpose; content carries payload; receiver decides. The fact that the receiver is in another story changes nothing about the verb.

## Pinned slogans

- **Callers express; receivers decide.**
- **Address routes. Intent states. Content carries.**
- **The able IS how the call is handled.**
- **No envelope field can make a being do something its able did not choose to do.**

When in doubt, check that the proposed change does not let the caller compel the receiver. If it does, it is drift.

## Decided, not yet built: ref-boxed call content (no semantic truncation)

Pinned 2026-06-11 (Tabor). The call's delivery IS a fact — the inbox
is a projection of recipient-targeted call facts — so message content
lands inline in the fact's params, and the payload cap (capPayload)
can today truncate oversized content with only a `truncated` flag.
That is the wrong shape: **nothing should be truncated semantically.**

The decided shape, to build later:

- Content over a threshold ref-boxes into the content store: the
  call fact carries `content: { kind: "cas", hash, size, preview }`
  — the chain holds facts ABOUT big content, uniformly with matter
  bytes. Small content stays inline (chat ergonomics).
- Resolution happens at the CONSUMPTION boundary (assign's
  startMessage build), so the scheduler, prompt assembly, inbox
  panels, and federation handlers all see resolved content and never
  learn about refs individually.
- capPayload remains only as an absolute backstop, never the
  mechanism.
- Cross-story calls keep content inline until federation
  fetch-by-hash lands — a foreign story cannot resolve a ref
  against a store it does not have (PORT-NOTES #12 owns that arc).

Sovereignty unchanged: the ref is still just content; the receiver
still decides. See philosophy/OS/PORT-NOTES.md #3 for the full
build notes.
