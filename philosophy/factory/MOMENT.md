# THE MOMENT

Builder doctrine. Read this before FOLD.md, STAMPER.md, or MATERIALS.md.
Those are mechanism; this is why.

## The inversion

TreeOS is built on one inversion, and everything else is consequence. In an
ordinary system, state persists and sessions pass through it — the database
is the noun, the users are transient. TreeOS is exactly backwards. The being
persists; the place does not. A being is a durable identity with a history.
The world it stands in is re-derived, fresh, every time it is needed, and is
gone again the moment it isn't. Hold this the whole way down: nothing about
the world is stored as a world. What is stored is facts — deeds, done — and
from facts a place is folded on demand.

## The moment is the atom

The unit of everything that happens is the moment. A moment is small and
exact: one being is summoned, one face is folded for it, the being is present
in that face, it may take at most one act, and the moment closes. One fold,
one face, one being, at most one act. That is the whole of it. A moment is
not a session, not a turn, not a stretch of activity — it is a single fold
and what follows from it. When you find yourself wanting a moment to contain
"several things," you have stretched the word, and what you actually have is
several moments.

## The place lives only inside the stamper

This is the edge to hold most carefully. The place — the world as it stands
for a being — is never a stored object. It exists only inside the machine,
only inside a moment, only in the window between the fold that mounts it and
the seal or release that ends it. Outside that window there is no place
anywhere — only waiting beings and the facts on their reels.

The fold is the operation that mounts it: it takes a being and projects the
relevant facts into a face — that being's view of the place for that moment.
The face is the place, framed for one being. The fold works from two
sources: the materials, which are the kinds of thing that can be — the
possible — and the facts, which are what has been done — the actual. A face
is those two married, for one being, for the length of one moment. Then it
is handed over and discarded.

A builder consequence falls straight out of this: there is no place storage,
no place table, no place cache that outlives a moment. If you are reaching
for one, you have misunderstood the system.

## A moment ends two ways: SEE, or DO

Every moment opens the same way — assign a being, fold a face. What differs
is how it closes.

A **SEE** is a moment that folds a face, lets the being perceive it, and
releases it — unpressed. No act, no seal, no fact. A SEE leaves no trace at
all. It is a look, and a look is not a deed. Most moments are SEEs: a being
navigating, re-orienting, loading one place after another is doing a stream
of SEEs. They cost real compute — for an LLM, real tokens — and deposit
nothing. That cost-with-no-deposit is the honest price of perception; call
it token burn and accept it.

A **DO** (and its sibling **BE**) is a moment that folds, then the being
acts, then the moment is sealed. Only a DO/BE moment produces an act, and
only an act produces facts. "Everything is a stamp" was always shorthand for
the precise thing: every act is sealed. A SEE is not an act.

## Moment, act, batch

Three distinct concepts. Keep them distinct.

A **moment** is the substrate's atomic unit of intent. One being is summoned,
one face is folded, the being may take at most one act. The discipline is
unconditional — there is no "multi-op moment" mode. `opCount > 1` within a
moment is a bug, not an allowed pattern. The moment seals or it doesn't;
that is the moment's own atomicity.

An **act** is the seal of one moment's intent. Acts are 1:1 with moments.
The verb-handler completes, the fact lands, the act records what happened.
One act per moment, always.

A **batch** is a grouping of related moments, optionally sharing a Mongo
transaction for cross-moment atomicity. Each moment in a batch remains
atomically one act; the batch's atomicity is at the **group boundary**
(all moments commit, or all roll back), while the moment's atomicity is
per-act (the act seals, or it doesn't). These are different scopes. A
batch never expands a single moment to hold many acts — it groups many
moments that each hold one.

Genuine cross-moment atomicity is rarer than it looks. Federation pull
("commit the remote's batch as-received or skip"), cross-reel transfer
("debit and credit must both land"), and similar operations need a batch.
**Genesis does not.** Genesis is a sequence of moments, not a transaction:
each step is idempotent or detectable on next boot, so partial-boot
completion is a recoverable state rather than a corruption. Sequence beats
transaction wherever the steps can be resumed individually.

## Act and fact

These are the two real nouns of the record, and they must never be merged.

An **act** belongs to the being doing it — one act per DO/BE/SUMMON moment,
the being's single committed deed for that moment. It is the unit of the
being's own history.

A **fact** belongs to the thing the act changed. It is "a thing done," and
it lands on the reel of its target — a space, a matter, a being. One act
can deposit several facts on several different reels: move a lamp between
two rooms, and that one act drops a fact on each room's reel and on the
lamp's. The act is single and belongs to the doer; the facts are plural and
belong to the things done-to. Act leads to fact, one to many.

The machine that turns the one into the other is the stamper, and "stamp"
lives only as that machine and as the verb for sealing — to stamp an act.
There is no stored thing called a stamp; the sealed act is the act. The
being brings the intent; the act is intent committed; the facts are what the
press deposits. And a fact is not a truth — it is only the deed. Truth is
the plural fold of facts, and it is many; the fact is one, and shared.

## The stream, the run, the two chains

A being does not live a moment. It lives a stream of them. Between moments
it is not running — it is a waiting being, no place around it. It is
summoned, it lives a moment, it waits again.

When the moments come in a driven loop, that loop is the **run**. An LLM
being's run is internal: one summon unrolls into many moments inside the
stamper, fold after fold, SEE and SEE and DO. A human's run is external:
the human, outside the system, sends one wire-call per moment, and the loop
is their own life. Same atom either way — only the location of the loop
differs. Never speak of a "multi-turn moment." The moment is single; the
run is the many.

A being carries two chains, and they face opposite directions. Its **reel**
is the facts that target it — what was done to it, much of it by other
beings. Its **act-chain** is the acts it took — what it did. The reel is
the being as object; the act-chain is the being as subject. Spaces and
matter have only a reel; they are only ever done-to. A being has both.

## Genesis

The chain has a root. The first being is the I-Am, and its **first moment**
is one act: "I am that I am" — the be:birth fact that issues its own actor.
Every other moment folds a face from prior facts; the I-Am's first moment
folds an empty place, because there are no prior facts to fold. That is the
single, narrow exception to the fold rule.

After that first moment, the rules close. Genesis continues as a **sequence
of moments**, not as one big transaction:

> "I am born." → "I create the place root." → "I create heaven." →
> "I take heaven as my home." → "I create the eight tier-3 heaven spaces." →
> "I birth my nine seed delegates." → "I register them on the place root." →
> "I seed the default permissions."

Each step is its own moment with its own act. The I-Am's reel reads as a
chronological story of self-creation. Each step is idempotent or detectable
on the next boot, so a crash mid-genesis is a recoverable state — the next
boot picks up where the prior one stopped. No transaction holds all of
genesis together; the **sequence** does, and the sequence is more robust than
a transaction would be.

The chicken-and-egg cases the earlier transactional shape worked around are
handled by ordering and partial-state fields: the I-Am is born with
`homeSpace: null`, then takes heaven as home in a later moment once heaven
exists. The substrate accepts beings with unset homes; the home arrives in
a subsequent act.

After genesis, the rules close and never open again: every fact is the
deposit of an act, every act is a being in a moment, and every moment is
exactly one act.

## In code

- The place is never persisted — no place table, no place folder, no place
  cache that outlives a moment.
- The fold is the only thing that produces a face. Nothing else may hand a
  being a view of the world.
- A SEE writes nothing — no act, no fact, no reel touch, no seal. A SEE
  that produces a fact is a DO wearing the wrong name.
- Every act goes through the stamper. A fact not deposited by a sealed act
  is a bug — the sole exception is genesis.
- A fact's only commit is its append to its target's reel. Everything else
  — the face, the projection, the cached place — is derived and may be
  rebuilt.
- One being's moment writes only its own act and the facts that act
  targets. Beings affect each other only by SUMMON, never by writing each
  other's reels.
