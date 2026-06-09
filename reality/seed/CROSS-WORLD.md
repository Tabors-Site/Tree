# Cross-World Action — TreeOS's location-portable being model

> _A being has one position at any moment. Position is an address that can include any reality and any branch. Cross-world is detected from the address, not declared. One actor, one Act, facts where they land._

## What this is

The doctrine for how a being acts at a position whose reality or branch differs from the being's home substrate. Cross-world cases are detected from the address and routed automatically; the verb mechanism is uniform across same-world and cross-world calls.

If you're implementing federation, building a portal extension, or wondering how cross-branch acting should behave, the answer lives here.

## The mental model

Each being carries three independent facts:

- **Identity** — who they are. Lives on the home reality's being-reel. Never travels.
- **Position** — where they currently are. Stored as a quality on the Being row. Can be any address, foreign or local.
- **Memory** — what they did, their act-chain. Every moment the being initiated is a Stamp on their home reality's act-chain, regardless of where the being was when acting.

A cross-world act is just an act whose target address differs in reality or branch from the actor's home. The address resolver detects this; the dispatcher routes the verb call accordingly. No new verb is needed.

## The four invariants

1. **One actor, one Act.** Only the actor on the left stance opens a Stamp. The receiving substrate does not open its own moment in response — it stamps facts on its reels (consequences) but it is not the originator of the act.
2. **Each Stamper writes only to its own reels.** No foreign substrate ever reaches into another reality's reels. Cross-world facts are written by the receiving Stamper on its own chain.
3. **One position at a time.** A being is never in two places. Cross-world position moves leave their home and arrive at the foreign side as one transition, recorded with provenance on both reels. No ghost beings.
4. **Identity is sovereign.** A foreign reality cannot rewrite the actor's identity, history, or memory. If the foreign reality disappears, the actor's Act on home survives intact.

## The position quality

A being's position is stored as an address:

```
being.qualities.position = "<reality>#<branch>/<space-id-or-path>"
```

For a being at home, `<reality>` is the home domain and `<branch>` is the active branch. For a foreign-position being, both can differ. The substrate uses the position to determine where verbs default to: SEE / DO / SUMMON / BE against the being's stance routes to whatever reality+branch their position currently names.

## Cross-world detection

The address resolver compares the resolved left and right stance:

- `left.reality !== right.reality` → cross-reality
- `left.branch !== right.branch` → cross-branch
- Either or both → cross-world

The dispatcher routes accordingly. Cross-branch stays in-process (the same substrate, different branches). Cross-reality crosses the federation boundary via canopy.

## One actor, one Act

Every verb call opens a Stamp on the actor's home act-chain. The Stamp records:

- The acting being (`beingIn`)
- The cross-world ibpAddress (left and right stance)
- The verb and params (`startMessage`, `activeRole`)
- The deltaF of facts the Act produced on the actor's home reels (empty for pure cross-world acts)
- The inner face attachment (descriptor returned by the receiving substrate)
- Outcome status (`sealed` / `denied` / `timeout` / `error`)

The receiving substrate's Stamper writes the cross-world facts on its own reels. No second Stamp is opened on the receiver — the receiver is not the originator.

## The `crossOrigin` provenance block

Every fact stamped on a reality whose origin was a cross-world act carries:

```js
crossOrigin: {
  reality: <home-domain-or-null>,
  branch:  <home-branch>,
  beingId: <actor-being-id>,
  actId:   <home-act-id>,
}
```

- `reality` is null when the act is cross-branch within the same reality.
- The receiving Stamper enforces presence: a foreign-origin fact arriving without complete crossOrigin is refused at the boundary.
- Stamps are immutable, so provenance cannot be edited later.

The block lives in the fact's `params`. The Fact schema doesn't change — provenance grows inside the open Map shape.

## Local-seal with status

The actor's Act seals on its home chain regardless of the foreign side's outcome. The Act carries a `status` field naming what happened:

| status | meaning |
|---|---|
| `sealed` | Foreign side accepted; facts stamped on foreign reels |
| `denied` | Foreign side authorized away; nothing stamped on foreign reels |
| `timeout` | Foreign side unreachable within the deadline |
| `error` | Foreign side returned an error |

The actor's biographical record always survives. "I attempted X at <foreign-address> and got <outcome>" is part of the actor's memory whether the act succeeded or not. This honors the CROSS-WORLD doctrinal commitment that no being's continuity depends on a foreign reality remaining available.

The Act's `deltaF` contains only facts that landed on the actor's HOME reels. For pure cross-world acts (SEE, foreign DO), `deltaF` is empty. For hybrid acts (cross-world BE position-move records both a depart-fact at home and an arrive-fact at foreign), `deltaF` contains only the home-side fact; the foreign-side fact lives on the foreign reel referenced by `crossOrigin.actId`.

## Per-verb behavior

| Verb | Home reels | Foreign reels | Inner face |
|---|---|---|---|
| **SEE** | none | none | descriptor returned from foreign side, attached to Act |
| **DO** | none | the consequence (set-matter, set-space, etc.) with crossOrigin | descriptor at the act point, attached to Act |
| **SUMMON** | none | summon record on the foreign being's inbox-reel with crossOrigin | foreign being's reply or status, attached to Act |
| **BE** (position move) | `set-being:position` fact on actor's being-reel (they left) | arrival fact on foreign reel with crossOrigin (they appeared) | foreign descriptor at arrival, attached to Act |

The Act on the actor's home chain always records what was attempted. Facts move to wherever they target.

## Portal and window

Portal and window are not separate primitives. They are stance-access perspectives on the same cross-world mechanism:

- **Portal** — the actor's stance is admitted for DO / BE / SUMMON at the foreign address. They can walk through (position change), act, summon. State changes; facts land on foreign reels.
- **Window** — the actor's stance is admitted only for SEE. They can observe but not act. Nothing changes state; only the inner face returns.

The portal extension renders the foreign side as a doorway you can step through. The window extension renders it as a frame you can look through. Both consume the same substrate machinery; the difference is what the foreign side's `qualities.permissions` admit for this actor's stance.

## The Inner Face

The descriptor returned from the receiving substrate (the cansee / cando / cansummon / canbe shape at that position in that moment) is captured by the receiving substrate's normal descriptor pipeline — the same code that builds descriptors for ordinary local SEEs. The cross-world transport ships it back to the actor over the wire. The actor attaches it to their Act:

```js
Act.qualities.innerFace = {
  hash: <sha256-of-descriptor-json>,
  descriptor: <the-descriptor-json>,
}
```

Hashable for tamper-detection: if the foreign reality later returns a different descriptor for the same position at the same time, the hash proves the change. Useful for scam detection, drift detection, and historical comparison ("I remember this looked different last week").

For descriptors that grow past an inline-storage threshold, swap to content-addressed blob with the hash referenced from the Act. Start inline; scale when needed.

## Pull-back safety

A being whose position is foreign must not be stuck there if the home substrate restarts, the session times out, or the foreign substrate becomes unreachable.

The pull-back mechanism:

1. On home substrate startup, scan beings whose `position` names a foreign reality or branch.
2. For each, check whether the foreign substrate has confirmed liveness (heartbeat or recent ping) within a configured window.
3. If not (timeout or substrate restart crossed the heartbeat threshold), stamp a `set-being:position` fact on the home reel that resets the being's position to their home space.
4. If the foreign reality is reachable, also stamp a corresponding departure fact on the foreign reel. Best-effort — if unreachable, home unilaterally pulls back; the foreign reconciles at its next sync cycle.

The guarantee: a being's identity is never hostage to a foreign reality being available. Worst case they come back home; they don't get locked at foreign.

## Cross-branch is the local test case

When the cross-world boundary is just a branch divergence within the same reality, the mechanism is identical but the transport is in-process:

- The address triggers cross-world detection (branches differ).
- The actor's Act opens on the actor's home branch.
- Facts land on the foreign branch's reels via the same Stamper (no federation hop) with `crossOrigin.reality = null`.
- The inner face flows back via the same descriptor pipeline.

Build and verify the cross-branch case first. Cross-reality adds only the federation transport. Same shape, same doctrine, same enforcement.

## End-to-end traces

### Cross-branch SEE: tabor on #0 looks at branch #4

1. Address: `tabors.site#0/home@tabor :: tabors.site#4/factory`
2. Cross-world detected (branches differ).
3. Tabor's Act opens on #0's act-chain.
4. SEE handler dispatches against #4's substrate.
5. #4's descriptor pipeline builds the cansee/cando/cansummon snapshot.
6. Snapshot returns to the actor; hash + descriptor attach to Act as `qualities.innerFace`.
7. Act seals on #0's act-chain with `status: "sealed"`.
8. Tabor has a hashable record of "what #4 looked like at T."

### Cross-branch BE: tabor walks from #0 into #4

1. Address: `tabors.site#0/home@tabor :: tabors.site#4/factory` (verb=be, position-changing op).
2. Cross-world detected.
3. Tabor's Act opens on #0's act-chain.
4. Authorize against #4's substrate with crossOrigin in the stance bag.
5. If admitted:
   - Fact `set-being:position` on tabor's being-reel under #0 with new value `tabors.site#4/factory`. Records the departure.
   - Fact on #4's being-reel for tabor (arrival) with `crossOrigin: { branch: "0", beingId: "tabor", actId }`.
6. Tabor's position quality now reads `tabors.site#4/factory`. Subsequent verbs from tabor default to #4.
7. Act seals on #0 with `status: "sealed"`.

### Cross-branch BE denied

1. Address as above.
2. Authorize against #4 returns deny.
3. No facts stamped anywhere.
4. Act seals on #0 with `status: "denied"`, reason carried in `qualities.outcome`.
5. Tabor's act-chain records the attempt; his position quality is unchanged.

### Cross-reality DO: tabor on tabors.site#0 writes matter on bing.com#main

1. Address: `tabors.site#0/home@tabor :: bing.com#main/some-page`
2. Cross-world detected (realities differ).
3. Tabor's Act opens on tabors.site#0.
4. DO handler hands the act envelope to the canopy gateway.
5. bing.com receives, authorizes the foreign-actor stance (with crossOrigin in the bag).
6. If admitted: bing.com's Stamper writes the fact on bing.com#main with `crossOrigin: { reality: "tabors.site", branch: "0", beingId: "tabor", actId }`.
7. bing.com returns the new descriptor as inner face.
8. Hash + descriptor attach to tabor's Act. Act seals on tabors.site#0 with `status: "sealed"`.
9. tabors.site's reels stay clean; the state change is purely on bing.com.

## Build prerequisites

1. **Act-chain branch lineage.** A being's act-chain must respect branch lineage like fact reels do. Otherwise a cross-world Act stamped on the actor's branch won't surface correctly when the branch is read later. This is the foundational fix; everything else depends on it.
2. **`crossOrigin` in the stance bag.** `deriveStanceProperties` must produce `crossOrigin.reality`, `crossOrigin.branch`, `crossOrigin.beingId` when evaluating foreign-actor calls so rules can gate ("don't let foreign actors set-config here," etc.).
3. **Position quality accepts foreign address.** Generalize position from bare spaceId to a full address shape, or add a `position.foreign` quality alongside the local position.
4. **Address resolver surfaces cross-world flag.** The resolver already parses reality+branch; needs to expose a clean `isCrossWorld` flag and the resolved foreign target shape so the dispatcher can branch on it.
5. **Stamper boundary enforces crossOrigin.** Foreign-origin facts arriving at the Stamper without complete crossOrigin are refused. Local facts are written as today.
6. **Canopy gateway carries the Act envelope.** For cross-reality. Cross-branch is same-process — handed directly to the foreign-branch's dispatcher.

## Build order

1. Act-chain branch lineage (the hole; foundation).
2. Address-resolver cross-world flag and detection surface.
3. `crossOrigin` block on the Fact schema's params; Stamper enforcement.
4. `crossOrigin` in the stance bag; authorize evaluates foreign-actor properties.
5. Cross-branch dispatch in the DO/SEE/SUMMON/BE verb handlers.
6. Inner-face attachment on the Act.
7. Pull-back safety (heartbeat + scan + reset).
8. Cross-reality transport via canopy.

Each step is independently verifiable. Same-reality cross-branch lights up the whole architecture without federation; once it works, cross-reality is just the transport hop.

## What's NOT in this doctrine

- **Federation authentication.** Cross-reality federation needs cryptographic identity verification ("is this actually tabor from tabors.site?"). Lives in the canopy protocol, not here.
- **Conflict resolution at the foreign side.** Two cross-world actors writing the same foreign target at the same time. The foreign substrate handles concurrency the same way it handles local writes (locks). Cross-world adds no new conflict semantics.
- **Visual portals and windows.** The 3D portal showing a doorway, the perspective shift on walking through, the window-frame UX — all extension layers. The substrate just stores positions and runs verbs.
- **Cross-world stigmergy.** Scheduled wakes, DO-trigger fan-out firing across realities. Out of scope for the first cut; cross-reality stamps are explicit actor calls.

## See also

- `seed/PERMISSIONS.md` — how the foreign-actor stance is gated at the receiving side
- `seed/FACTORY.md` — Stamper / Act doctrine and per-aggregate reels
- `philosophy/CROSS-WORLD/` — source material for this doctrine
