# Cross-World Action — TreeOS's location-portable being model

> _A being has one position at any moment. Position is an address that can include any reality and any branch. Cross-world is detected from the address, not declared. One actor, one Act, facts where they land._

## What this is

The doctrine for how a being acts at a position whose reality or branch differs from the being's home. Cross-world cases are detected from the address and routed automatically; the verb mechanism is uniform across same-world and cross-world calls.

If you're implementing federation, building a portal extension, or wondering how cross-branch acting should behave, the answer lives here.

**Related doctrine:**
- [RolesAreAuth.md](RolesAreAuth.md) — roles ARE auth. Cross-world citizenship and federation policy are expressed entirely through the role registry. The `canSummon` field is one field with two surfaces (`as: "actor"` for caller-side, `as: "receiver"` for receive-side accept); receive-side entries are what UI discovery reads to render per-being summon options (e.g. birther's "mate" button).
- [protocols/ibp/FEDERATION.md](../protocols/ibp/FEDERATION.md) — federation protocol layer. The mate + vessel pattern for cross-world citizenship; canopy envelope contract; receive-side dispatch.

## Terminology

Three nested concepts:

- **Reality** — the substrate domain. A running TreeOS process. Example: `tabors.site`.
- **World** — a reality + a branch. The fact-chain timeline at one branch of one reality. Example: `tabors.site#0` (main world of tabors.site) or `tabors.site#4a` (a branched world of tabors.site).
- **Place** — a world + a position. A specific space (or being's position) inside a world. Example: `tabors.site#0/home`.

Cross-world means "the actor's world and the target's world differ." That's the only check the detection rule runs.

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

For a being at home, `<reality>` is the home domain and `<branch>` is the active branch. For a foreign-position being, both can differ. Position is the **default** target context for verbs that don't name an explicit foreign address — when the actor calls SEE without a target, they SEE at their current position. But every verb can carry an explicit target address that overrides this default. **Only BE changes position.** SEE / DO / SUMMON can target any foreign address with the being's position unchanged.

This is the bridge pattern: a being stays at home, opens a portal to a foreign world, and acts there without leaving. The being keeps its current position; the verb call carries the foreign target; the cross-world routing fires. Useful for collaboration, oversight, remote control — anything where the actor wants to reach into another world without physically anchoring there.

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
  branch:  <home-actual-branch-path>,
  beingId: <actor-being-id>,
  actId:   <home-act-id>,
}
```

- `reality` is null when the act is cross-branch within the same reality.
- The receiving Stamper enforces presence: a foreign-origin fact arriving without complete crossOrigin is refused at the boundary.
- Stamps are immutable, so provenance cannot be edited later.

The block lives in the fact's `params`. The Fact schema doesn't change — provenance grows inside the open Map shape.

## Pointers vs actual branches

**Every persisted record stores the ACTUAL branch path, never a pointer name.** This is a hard rule across Acts, Facts, and crossOrigin blocks.

- **Actual branch paths** (`"0"`, `"1"`, `"1a"`, `"4b"`) are the canonical identifiers. They never move. A branch's path is stable for the substrate's lifetime.
- **Pointer names** (`"main"`, `"feature-x"`, `"library"`) are top-level convenience labels operators apply to a branch. Pointers CAN be retargeted; today's `"main"` could point at `"0"` and tomorrow's `"main"` could point at `"4b"`.

Storing a pointer in a record would make the record's meaning depend on present pointer state — exactly the kind of mutable-past trap the fact-chain doctrine forbids. The pointer-actual translation happens at the perimeter (the address parser, the wire layer); by the time anything reaches the Stamper, the branch field is the resolved actual path.

Cross-reality consequence: when reality A sends a foreign-actor act to reality B, the request carries the actual branch path A is acting from (`"0"` or `"1a"`). Reality B's Stamper writes `crossOrigin.branch` as the received actual path. A's pointer label for that branch (`"main"` today, maybe `"archive"` next year) does not enter B's chain. When B looks up A later, it queries by actual path; A's pointer state is irrelevant to B's record.

Realities are responsible for translating their own pointers to actual branches when packaging requests to send out (the resolver does this) and when interpreting received crossOrigin blocks (a foreign actual-path is what got recorded; the receiver may render it through their OWN pointers if they have any for that path, but the record itself stays bare).

## Act lifecycle and status

The actor's Act seals on its home chain regardless of the foreign side's outcome. The Act carries a `status` field that starts at `attempted` when the Act seals locally and transitions exactly once to a terminal state as feedback arrives from the foreign side:

| status        | meaning                                                         |
| ------------- | --------------------------------------------------------------- |
| `attempted`   | Act sealed locally; awaiting response from foreign side         |
| `landed`      | foreign side confirmed the fact stamped (success)               |
| `denied`      | foreign side refused (auth, permissions, policy)                |
| `timeout`     | no response within configured window                            |
| `unreachable` | canopy could not deliver (DNS, network, foreign substrate down) |
| `malformed`   | foreign side received but couldn't parse (protocol mismatch)    |

These are distinct outcomes with distinct implications. `denied` means the foreign side made a decision; `timeout` means we don't know what happened; `unreachable` means we couldn't even ask. The being's biography distinguishes these.

### Status is the one exception to fact immutability

Acts are immutable, but the `status` field on an Act can transition. The transition is one-way: `attempted` → exactly one of the five terminal states. Once terminal, the status never changes.

This is deliberate, not a leak in the immutability discipline:

- The Act itself is sealed and immutable. What happened (the actor's attempt) is fixed.
- The status field is a **derived correlation** between the Act and what the foreign side later reported.
- The substrate is not falsifying the past; it's noting how the past resolved.

No other field on an Act ever mutates after seal. New contributors should not try to "update other fields by analogy" — status is the singular exception, with reasoning.

### The status update path

When the foreign side responds (with success, denial, etc.), the canopy delivers the response back. The substrate matches it against the originating Act by `actId` and updates the status field. This match-and-update is its own small protocol, separate from the Act-sealing path. It is the only place the substrate writes to an Act after seal.

### Idempotency on the foreign side

The foreign side deduplicates incoming acts by `{originReality, originBranch, originBeingId, originActId}`. Replays are idempotent — a retried Act produces the same outcome as the first delivery; no double-stamping. The receiving Stamper checks for an existing fact carrying the same `crossOrigin.actId` before writing.

### What deltaF carries

The Act's `deltaF` contains only facts that landed on the actor's HOME reels. For pure cross-world acts (SEE, foreign DO), `deltaF` is empty. For hybrid acts (cross-world BE position-move records both a depart-fact at home and an arrive-fact at foreign), `deltaF` contains only the home-side fact; the foreign-side fact lives on the foreign reel referenced by `crossOrigin.actId`.

The actor's biographical record always survives. "I attempted X at <foreign-address> and got <outcome>" is part of the actor's memory whether the act succeeded or not. This honors the CROSS-WORLD doctrinal commitment that no being's continuity depends on a foreign reality remaining available.

## Per-verb behavior

Each verb honors the three facts of being:

- **Identity stays home** — every verb routes through the actor's identity on the home substrate; the foreign side receives a stance with `crossOrigin` provenance, never a foreign-owned identity record.
- **Position determines target** — every verb defaults to acting at the being's current position; cross-world is just the position's reality+branch differing from home.
- **Memory rides the Act** — every verb records its moment as a Stamp on the home act-chain; the inner face attaches there.

Per verb:

| Verb       | Position effect                          | Home reels                                                  | Foreign reels                                                    | Inner face on Act                     |
| ---------- | ---------------------------------------- | ----------------------------------------------------------- | ---------------------------------------------------------------- | ------------------------------------- |
| **SEE**    | none — observation only                  | none                                                        | none                                                             | descriptor returned from foreign side |
| **DO**     | none — acting from current position      | none                                                        | the consequence (set-matter, set-space, etc.) with crossOrigin   | descriptor at the act point           |
| **SUMMON** | none — calling from current position     | none                                                        | summon record on the foreign being's inbox-reel with crossOrigin | foreign being's reply or status       |
| **BE**     | position moves (the only verb that does) | `set-being:position` fact on actor's being-reel (they left) | arrival fact on foreign reel with crossOrigin (they appeared)    | foreign descriptor at arrival         |

The Act on the actor's home chain always records what was attempted. Facts move to wherever they target.

### Portal-walking is `do:move`, not a new BE op

BE is the closed four-op set: `birth` / `connect` / `release` / `death`. None of those is "walk through a portal." Position moves use the existing `do:set-being:position` (and, when the move includes container-change, `do:move`). Cross-world positioning is just a `do:set-being:position` whose value is a `<reality>#<branch>/<spaceId>` address instead of a bare spaceId.

The "BE position moves" line in the table above describes the SUBSTRATE effect of a position write (the being's row changes; arrival fact lands on the new world). The OP that produces that effect is a DO. No new BE verb is needed.

### SUMMON reply correlation

When a foreign being replies to a cross-world summon, the reply is its own cross-world act in the reverse direction — its own Stamp on its act-chain, with its own status field for its own attempt. The reply Act may optionally carry a `replyTo: <original-act-id>` field referencing the originating Act. This is metadata, not a constraint: responders act independently; reply-correlation just lets the conversational connection be visible when it exists. Forensics and UX consume it; the substrate doesn't enforce reply order or require replies at all.

## Portal and window

Portal and window are not separate primitives. They are stance-access perspectives on the same cross-world mechanism — what role(s) the foreign-actor stance holds at the receiving side under RolesAreAuth (see `seed/RolesAreAuth.md`):

- **Window** — the role grant admits only SEE (`canSee` includes the position; `canDo` / `canSummon` / `canBe` don't). The actor observes; nothing changes state; only the inner face returns.
- **Portal** — the role grant admits the verbs the foreign operator chose to open: typically SEE + DO + SUMMON, optionally BE. Authored via the role's canX lists.
- **Full access** — every verb admitted, including BE for walking through.

**Acting through a portal does not require walking through it.** Only BE moves the being's position. SEE / DO / SUMMON across a portal happen with the being's current position unchanged — they reach into the foreign world from wherever the actor is standing. The bridge pattern (stay home, manipulate matter or summon beings in another world) is exactly this case: portal access without BE.

The portal extension renders the foreign side as a doorway. Whether you step through (BE) or reach through (SEE / DO / SUMMON) is the actor's choice on each verb call. Both consume the same substrate machinery.

## The Inner Face

The descriptor returned from the receiving substrate (the cansee / cando / cansummon / canbe shape at that position in that moment) is captured by the receiving substrate's normal descriptor pipeline — the same code that builds descriptors for ordinary local SEEs. The cross-world transport ships it back to the actor over the wire. The actor attaches it to their Act:

```js
Act.qualities.innerFace = {
  hash: <sha256-of-descriptor-json>,
  descriptor: <the-descriptor-json>,
}
```

Hashable for tamper-detection: if the foreign reality later returns a different descriptor for the same position at the same time, the hash proves the change. Useful for scam detection, drift detection, and historical comparison ("I remember this looked different last week").

The `hash` field is the canonical identifier from day one, even when storage is inline. Future migration to content-addressed blob storage references the same hash, so consumers don't break. Start inline; scale when needed.

## Pull-back safety

A being whose position is foreign must not be stuck there if the home substrate restarts, the session times out, or the foreign substrate becomes unreachable.

The pull-back mechanism:

1. On home substrate startup, scan beings whose `position` names a foreign reality or branch.
2. For each, check whether the foreign substrate has confirmed liveness (heartbeat or recent ping) within a configured window.
3. If not (timeout or substrate restart crossed the heartbeat threshold), stamp a `set-being:position` fact on the home reel that resets the being's position to their home space.
4. If the foreign reality is reachable, also stamp a corresponding departure fact on the foreign reel. Best-effort — if unreachable, home unilaterally pulls back; the foreign reconciles at its next sync cycle.

The guarantee: a being's identity is never hostage to a foreign reality being available. Worst case they come back home; they don't get locked at foreign.

## Cross-branch is the canonical first implementation

When the cross-world boundary is just a branch divergence within the same reality, the mechanism is identical but the transport is in-process:

- The address triggers cross-world detection (branches differ).
- The actor's Act opens on the actor's home branch.
- Facts land on the foreign branch's reels via the same Stamper (no federation hop) with `crossOrigin.reality = null`.
- The inner face flows back via the same descriptor pipeline.
- Status transitions work the same way — `attempted` on seal, then `landed` / `denied` / etc. as the foreign branch's dispatcher responds (synchronously, since it's in-process).

This is the build target. The full three-way separation — identity local, position portable, memory sovereign — surfaces entirely within a single substrate. Once cross-branch verifies, cross-reality is just the canopy gateway path added on top. Same shape, same doctrine, same enforcement, longer round trip.

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
4. Authorize against #4's substrate via the role-walk (`authorizeViaRoles`), with the canopy-verified actor identity tuple riding through.
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

## Build status — LANDED

All eight prereq + build-order items below shipped. The doctrine is now structural in the substrate; this section stays as a forensic record of the build path.

| # | Item | Status | Lives at |
|---|------|--------|----------|
| 1 | Act-chain branch lineage | LANDED | `seed/past/act/actChain.js`; verify-act-chain-lineage 12/12 |
| 2 | crossOrigin block + Stamper enforcement | LANDED | `seed/past/act/crossOrigin.js` (`deriveCrossOrigin`), `seed/past/fact/facts.js` (lands the block at emit; dedup by `crossOrigin.actId`) |
| 3 | Position accepts foreign address | LANDED | `seed/materials/being/positionAddress.js` (`parsePositionAddress`, `formatPositionAddress`, `isPositionCrossWorld`) |
| 4 | Address-resolver cross-world flag | LANDED | `seed/ibp/address.js` + `seed/ibp/resolver.js`; cross-branch + cross-reality detection in parseBoth |
| 5 | Cross-branch + cross-reality dispatch in DO/SEE/SUMMON/BE | LANDED | `seed/past/act/crossWorldResponse.js` + `runVerbAsForeignActor` |
| 6 | Inner-face attachment on the Act | LANDED | `seed/past/act/innerFace.js` — `qualities.innerFace = { hash, descriptor }` |
| 7 | Pull-back safety (boot scan) | LANDED | `seed/materials/being/pullBack.js` + wired into `genesis.js` startup |
| 8 | Canopy transport (cross-reality) | LANDED | `protocols/ibp/canopy.js` (verifyIncoming + forwardToPeer + signedAt freshness window) |

Two prereq items from the original draft were subsumed by later doctrine:

- **`crossOrigin` in the stance bag via `deriveStanceProperties`** — RETIRED. The stance-bag derivation retired with PERMISSIONS.md (replaced by RolesAreAuth.md). The role-walk's `authorizeViaRoles` reads identity tuples from the moment's `actorAct` and the canopy's verified sender, not from a derived property bag. Same information, surfaced through the role-walk instead of the bag.
- **"qualities.permissions admit what verbs" for portal vs window** — RETIRED. The same per-position permission is now expressed as the role's `canSee` / `canDo` / `canSummon` / `canBe` lists with optional `reach` filters. The portal-vs-window distinction is what role grants the foreign visitor holds, not a `qualities.permissions` rule. See RolesAreAuth.md.

Test coverage: `verify-federation.js` exercises 18 properties of the mate-vessel + canopy + father-admit flow.

## What's NOT in this doctrine

- **Federation authentication.** Cross-reality federation needs cryptographic identity verification ("is this actually tabor from tabors.site?"). Lives in the canopy protocol, not here.
- **Conflict resolution at the foreign side.** Two cross-world actors writing the same foreign target at the same time. The foreign substrate handles concurrency the same way it handles local writes (locks). Cross-world adds no new conflict semantics.
- **Visual portals and windows.** The 3D portal showing a doorway, the perspective shift on walking through, the window-frame UX — all extension layers. The substrate just stores positions and runs verbs.
- **Cross-world stigmergy.** Scheduled wakes, DO-trigger fan-out firing across realities. Out of scope for the first cut; cross-reality stamps are explicit actor calls.

## See also

- `seed/RolesAreAuth.md` — how the foreign-actor stance is gated at the receiving side (canSee / canDo / canSummon / canBe + reach)
- `protocols/ibp/FEDERATION.md` — canopy verifyIncoming, signedAt freshness, mate-vessel pattern
- `seed/done/DualBeingParents.md` — father-as-vessel doctrine; BE:connect father-admit
- `seed/FACTORY.md` — Stamper / Act doctrine and per-aggregate reels
- `philosophy/CROSS-WORLD/` — source material for this doctrine

