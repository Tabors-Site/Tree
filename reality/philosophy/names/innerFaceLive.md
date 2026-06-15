# innerFaceLive: humans see the world change

Sibling to [innerFace.md](innerFace.md) (which defines the canonical
face all souls share) and [stamperUpgrade.md](stamperUpgrade.md)
(which named role-scoped fold as the mechanism).

This doc covers the reactive per-stance inner-face subscription
system: how humans get live updates through the portal, why LLMs and
scripted souls explicitly DON'T subscribe, and how the weave drives
which subscriptions wake on which facts.

## The split

The three souls have different cadence needs:

- **LLM.** Starts a moment with a frozen inner face, thinks (seconds
  to minutes), submits an act. If we forced live updates the LLM
  would never finish a call; every fact arrival would invalidate its
  context mid-inference.
- **Scripted.** Same as LLM. Reads `ctx.innerFace.blocks` once,
  computes, returns an act. Static snapshot is the right model for
  deterministic code.
- **Human.** Connected through the portal, sees the world continuously.
  If another being moves into the space the human is in, the human
  expects to see them appear in real time. The portal is the live
  surface; the human's act is what they click after watching.

So the subscription system serves HUMANS ONLY. LLMs and scripted
work on the moment's frozen inner face. Seal-time conflicts
(another act landed on a reel they read) get handled by the chain's
existing CAS + reel-head locks: if the seal fails, the cognition
refolds and retries through the existing path. No new conflict
machinery, no inner face used as an OC token; the chain's own
integrity is the gate.

## The mechanism

The portal sends `client.see("my-inner-face", {live: true})` on each
navigate. Server-side this is handled by
[reality/protocols/ibp/verbs/see.js](../../protocols/ibp/verbs/see.js):
when the live flag is set and the resolved face carries a weave,
the server registers a subscription via
[innerFaceLive.js](../../protocols/ibp/innerFaceLive.js).

A subscription is keyed by `subId` and holds:

```
{
  socket,    // the portal's WS socket
  beingId,   // which stance is being watched
  branch,    // which branch the face was folded on
  weave,    // the reels this face depends on
  faceSeq,   // monotonic per-sub for ordering (today: diagnostic)
}
```

The registry maintains a reverse index: `reelKey -> Set<subId>`. For
each reel in the weave, the subId is added to the bucket for
that reel's reelKey.

## How updates fire

When a fact seals, the seal path
([past/fact/facts.js](../../seed/past/fact/facts.js)) calls
`foldAfterCommit` which advances projections for the reels the act
touched. After that, a single hook fires:

```
hooks.run("afterReelArrival", { reels: [{reelKind, reelId, branch, foldedSeq}] })
```

One fan-out call per act batch, not one per reel. Registered downstream
by [reality/protocols/ibp/index.js](../../protocols/ibp/index.js),
the listener:

1. Collects the unique set of subIds across the batch's reels via
   the reelKey reverse index.
2. For each subId, runs the human-side refold path
   (re-invokes the my-inner-face SEE op handler logic), producing a
   fresh face with a fresh weave.
3. Atomically rotates the subscription's weave (removes the old
   entries from the reverse index, adds the new ones).
4. Pushes the new face down the socket via `emitInnerFace`.

The push uses the existing IBP envelope with a new kind constant:

```
SEE_PUSH.INNER_FACE = "inner-face"
```

declared at
[reality/protocols/ibp/events.js](../../protocols/ibp/events.js).
The portal client routes the push through its existing `handleSeeEvent`
path; the new kind is just a routing key.

## Stance switching

A name has many beings. The portal switches between them in left
stance constantly. The protocol:

1. Portal: `client.see("my-inner-face", {live: true})` for the new
   stance. Server registers a fresh subscription, folds the face
   from current state, returns it.
2. Portal (concurrent or just after): drops the prior subscription
   for the old stance via socket-side cleanup, OR the server replaces
   per-socket (the registry can scope subscriptions to (socket,
   beingId) so a new subscribe supersedes a prior one for the same
   socket).

No history replay. Just drop, register, server folds from current.
Cheap.

## Coalescing

A single act can land facts on multiple reels. If a subscription's
weave includes 3 of those reels, naively we'd refold + push 3 times
for one act. The dispatcher coalesces by subId so a single act
touching N of a sub's reels triggers ONE refold, ONE push.

For burst load across multiple acts in quick succession, microtask
batching in the hook listener keeps the fan-out tight. A real ordering
gate using `faceSeq` (so a slow refold can't push a stale face after
a faster newer refold) is recorded but not enforced today. Under
typical load the act-batch coalescing is enough; under burst the
gate becomes load-bearing. Deferred.

## What's NOT subscribed

**LLM and scripted moments.** They read `ctx.innerFace` once at moment
start and never re-read. No subscription, no push. Conflicts at seal
go through the chain's existing CAS + reel-head locks (refold and
retry via the existing path on conflict).

**Foreign / cross-world faces.** A face with `origin: "foreign"`
carries an empty weave locally (the foreign reality's reels live on
the other side; this reality has nothing to subscribe to). Reactive
updates for foreign content would require a federation push channel
that doesn't exist yet. The current behavior: the human sees the
foreign content on first navigate, doesn't see live updates from
that reality, has to re-navigate to refresh.

**Non-descriptor named-see ops.** Handlers like `my-inbox`,
`connections`, `federation-status`, `llm-connections`, `http-stats`,
`mongo-stats` return non-descriptor payloads. Their reads don't show
up in the weave through the descriptor auto-detection, so
subscriptions to faces that include those blocks don't wake on their
underlying changes. The human polls (re-navigates) or those blocks
go stale until the next moment. Migrating these handlers to declare
`{payload, reels}` would close the gap; whether it's worth it
depends on whether anyone wants live push for those views.

## When the DB is offline

The afterReelArrival hook fires only when `foldAfterCommit` succeeded.
On DB disconnect the fold defers and the hook doesn't fire. That's
correct: pushing a face we couldn't fold against current state would
push a stale face. The portal's next read after reconnection
cold-folds and the subscription resumes.

## Files

- [reality/protocols/ibp/innerFaceLive.js](../../protocols/ibp/innerFaceLive.js)
  is the subscription registry. Exports `subscribeInnerFace`,
  `unsubscribeInnerFace`, `getSubscribersForReel`, `applyRefold`,
  `emitInnerFace`, `cleanupSocketInnerFace`, `getInnerFaceStats`.
- [reality/protocols/ibp/index.js](../../protocols/ibp/index.js)
  registers the `afterReelArrival` listener that coalesces by subId,
  refolds, rotates weave, and pushes.
- [reality/protocols/ibp/events.js](../../protocols/ibp/events.js)
  declares `SEE_PUSH.INNER_FACE` alongside the other SEE push kinds.
- [reality/protocols/ibp/verbs/see.js](../../protocols/ibp/verbs/see.js)
  threads `live: true` into the seed SEE handler and registers the
  subscription when the resolved face carries a weave.
- [reality/seed/past/fact/facts.js](../../seed/past/fact/facts.js)
  fires the `afterReelArrival` hook after `foldAfterCommit`.
- [reality/seed/hooks.js](../../seed/hooks.js) registers
  `afterReelArrival` in CORE_HOOKS.
- [reality/portal/core/navigation.js](../../portal/core/navigation.js)
  is the portal's caller: requests live faces on navigate, routes
  `kind: "inner-face"` pushes into `state.innerFace`.
- [reality/seed/present/cognition/human/myInnerFace.js](../../seed/present/cognition/human/myInnerFace.js)
  is the SEE op the portal calls.

## Open

**Portal ordering gate via faceSeq.** The `faceSeq` field exists on
each subscription and increments per refold. Today it's diagnostic
only; the portal doesn't compare it on receive. Burst load could in
principle deliver a stale face after a fresh one. Microtask batching
in the listener makes this rare; under sustained burst it'd be
load-bearing. Not a current bug, a known deferred sharpening.

**Foreign push channel.** Above. Federation push channel for
foreign-origin faces remains future work.

**Migrating non-descriptor see-op handlers.** Above. Whether to leave
them as polled or migrate to `{payload, reels}` is a per-handler
call, parked until anyone needs live push for a specific view.

## See also

- [innerFace.md](innerFace.md) for the face shape itself and the
  weave that lives on it.
- [stamperUpgrade.md](stamperUpgrade.md) for the role-scoped fold
  doctrine that this rests on.
- [names.md](names.md) for the Name/Soul/Being separation that
  explains why humans (a soul type) get live updates while LLMs
  (another soul type) don't.
