# beFix.md

Corrections to my model of the BE verb after a session walking through
PORT-NOTES.md asymmetry #9 (BE is cherub-shaped and asymmetric) with
Tabor. This is a fix-up to my own framing; PORT-NOTES.md's claims are
correct, but my elaboration of WHY had two errors that this file
records so the port doesn't inherit the wrong mental model.

## The correction: BE acts on the LEFT stance

Every verb except BE operates on the right stance (the target). SEE
reads what's at the right. DO mutates what's at the right. SUMMON
calls a being at the right. BE is the one verb where the actor IS the
target. The mutation lands on the left stance, on the caller
themselves.

| Verb   | Operates on | Direction          |
| ------ | ----------- | ------------------ |
| SEE    | right       | left reads right   |
| DO     | right       | left mutates right |
| SUMMON | right       | left calls right   |
| BE     | left        | left mutates self  |

This is what distinguishes BE structurally. Birth, connect, release,
switch, death are all transformations applied to the left being. The
caller doesn't reach across to do something to someone else; the
caller acts on their own identity slot.

My earlier framing ("BE has no actor sometimes, so it rides cherub")
was wrong. BE always has an actor (the left stance), and the actor is
exactly what BE acts on.

## Arrival is a real left stance, not a no-actor case

When a fresh socket arrives unauthenticated, the substrate's model
isn't "there's no actor here." It's "the actor is arrival." Arrival
is a real being row: one shared singleton, scripted cognition, used
as the default left being for every unauthenticated visitor. The
role-walk evaluates arrival's grants like any other being's grants;
the SEE/DO/SUMMON/BE machinery doesn't branch on "is the caller
identified" because the answer is always yes.

This shows up structurally in the address grammar.

## Single-stance addresses are sugar for `pos@arrival :: pos`

The parser fills a missing left stance by duplicating the right
position and inserting arrival as the left being:

```
bing.com/library
   resolves to
bing.com/library@arrival  ::  bing.com/library
       left actor               right target
```

There is no stanceless call in the substrate. Authorize always has
SOMEONE to evaluate, BE always has a left being to mutate, and
single-stance addresses are syntactic sugar for "I am acting from
here as arrival."

For an authenticated caller the same shape applies; the parser fills
the left being from the session's bound identity instead of arrival.
Either way the dispatch sees a fully formed pair.

## Birth is emitted by summon:mate, not invoked directly

The fifth BE op (be:birth) has no direct user-facing wire surface.
The user-facing path to mint a new being is `summon:mate` against a
delegate (cherub for arrival, birther for authenticated callers).
That delegate's summon handler runs, and inside it the delegate
emits BE:birth via `birthBeing`, which stamps its own fact.

The flow for arrival:

```
visitor (left stance: position@arrival)
   ↓
SUMMON cherub, intent = "mate"
   ↓
cherub's summon:mate handler runs
   ↓
cherub calls birthBeing internally
   ↓
birthBeing emits be:birth, arrival recorded as father
   ↓
the visitor's left being slot now holds the newly minted being
```

The visitor doesn't get an identity grafted on out of nowhere. The
substrate transforms the contents of the already existing left
stance slot from arrival to the new being.

The flow for an authenticated caller minting a child:

```
caller (left stance: position@<callerName>)
   ↓
SUMMON birther, intent = "mate"
   ↓
birther's summon:mate handler runs
   ↓
birther calls birthBeing with caller as father
   ↓
new being-being lands on the local reality
```

The caller's own left stance does not change in this case; the
being-being is a separate identity admitted to the reality. The
substrate flow is the same primitive (summon:mate to a delegate
that emits BE:birth); only the parent recorded on the new being
differs.

## What this does to the PORT-NOTES asymmetries

The two asymmetries PORT-NOTES.md flags (BE rides cherub's intake,
be:birth skips the verb-level fact stamp) are real. Reframed
correctly:

### Asymmetry 1, reframed

BE is the verb whose target is the left stance. The substrate
chose to centralize all identity-binding handling in one being
(cherub), so the four wire-driven BE ops (connect, release, switch,
death) enqueue on cherub's intake regardless of who the actor is.
The asymmetry is not "BE has no actor sometimes." It is "the
substrate routes BE through a central identity-gate being even
when the actor could process it themselves." Uniformity of
identity-gate location, at the cost of "actor rides their own
intake" uniformity.

### Asymmetry 2, reframed

be:birth has no direct wire path. It is emitted from inside
cherub's or birther's summon:mate handler, via `birthBeing`, which
stamps its own fact. The other four BE ops ride the BE wire path
and pick up the verb-level fact stamp. So "be:birth skips the
verb-level fact" is not really a skip; be:birth never enters the
BE wire path's fact-stamping seam in the first place. Its surface
is summon:mate, not direct BE.

### Unification, if the port wants it

If the port wants to remove the asymmetries: pick one
fact-stamping seam for all five BE ops (either lift birthBeing's
internal stamp out to the verb level, or push the verb-level stamp
down into each handler so all five stamp the same way), and decide
whether be:birth deserves a direct wire surface peer to the other
four (or commits to "birth is always via summon:mate, the wire
path never sees it"). Both unification moves cost something; the
port should make the choice consciously rather than copy the
existing shape blindly.

## What I had wrong, in one line

I treated arrival as the absence of a caller; it is a caller.
I treated BE as a target-acting verb that special-cases the actor;
it is an actor-acting verb in a wire that special-cases nothing.
The asymmetries PORT-NOTES.md flags exist for the second reason
(centralized identity-gate handling, summon:mate as the
identity-creation surface), not the first.

## SUMMON wire state (2026-06-11)

The flows above ("SUMMON cherub/birther, intent = 'mate'") are the
doctrinal target. The substrate piece that makes those flows possible
landed in the SUMMON cleanup of 2026-06-11; what's still pending is
authoring the receiver-side handlers that consume the envelope. The
port should treat the wire as ready and decide whether to land the
summon:mate handler now or keep the legacy BE:birth registration path
until the call site flips.

What's wired (substrate side):

- Envelope `intent` is a first-class SUMMON field (per seed/SUMMON.md).
  `validateSummonMessage` accepts it, the role-walk gates on it
  (`roleAuth.permitsSummon`), the receiver-side gate enforces it
  (`roleAuth.permitsReceiverSummon`), the summon Fact records it, and
  the InboxProjection persists it. The wire shape `SUMMON @cherub,
intent: "mate"` cleanly carries through to cherub's `summon` handler.
- `canSummon` receiver entries are enforced. cherub and birther both
  declare `{intent: "mate", as: "receiver"}`; summons with any other
  intent (or with no intent at all) refuse at the receiver gate before
  the handler runs.
- The 2D portal's inbox panel reads `entry.render` (built server-side
  by the inbox renderer registry, keyed by envelope intent) and is
  intent-blind. The role's handler decides what UI the human inhabitant
  sees; the panel renders it. Same sovereignty principle that governs
  the rest of SUMMON.

What's still pending (handler side):

- `cherub.summon` for `intent: "mate"` is currently `return null;`.
  Today's registration goes through BE:birth via cherub's BE handlers
  (the wire surface arrival/role.js notes as "Legacy direct-BE
  registration. Retires when cherub's summon:mate handler is wired").
  Authoring the handler means: read `message.content` for the visitor's
  chosen credentials, call `birthBeing` with arrival recorded as
  father, bind the session, return the new being's stance as the reply.
- The portal's call site (arrival flow) still emits BE:birth-on-cherub
  rather than `SUMMON @cherub, intent: "mate"`. Flipping the call site
  is the second half; once the handler is authored, the call site
  switch is a few lines in the arrival-side registration flow.

Birther's `summon:mate` handler IS authored. Same-reality `SUMMON
@birther, intent: "mate"` works end-to-end today; the cross-reality
flow is exercised by verify-federation. Cherub remains on BE for now
because arrival's registration UI predates the SUMMON wire and hasn't
been refactored.

For the port: this means the BE:birth special case (no verb-level fact
stamp; runs inside cherub's intake) doesn't need to be inherited just
to handle registration. The seed already supports the symmetric SUMMON
path; the port can choose to bring up registration on the SUMMON wire
and skip the BE special case entirely. PORT-NOTES asymmetry #2
("be:birth skips the verb-level fact stamp") is correctly described
as "be:birth is on a different surface, not skipping anything"; the
port can flatten that asymmetry by making summon:mate the sole
identity-creation wire.
