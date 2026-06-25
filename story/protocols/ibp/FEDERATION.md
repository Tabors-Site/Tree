# IBP Federation: current state

> Canonical doctrine: [seed/CROSS-WORLD.md](../../seed/CROSS-WORLD.md). Auth: [seed/AblesAreAuth.md](../../seed/AblesAreAuth.md). This doc is the protocol-layer current state, what's built, what's not, where the wire boundary sits.

## What federation is

IBP is the inter-being protocol. The "inter" crosses realities. A being on `tabors.site` can SEE / DO / SUMMON / BE against a being or space on `bing.com` directly via the same four verbs, with the same envelope shape. The dispatcher routes; canopy authenticates and transports.

There is no separate "federation protocol", federation IS IBP, with one extra hop. The local verb path and the cross-reality verb path go through the same `dispatchIbp` function in [protocol.js](protocol.js). When the dispatcher sees a foreign target reality on the envelope's address, it forwards via canopy; when it sees a verified inbound from canopy, it runs the verb locally as a foreign actor. No verb-specific federation code in `verbs/`; no `/canopy/*` HTTP endpoints; no parallel envelope shape.

The canopy is the wire+auth layer between realities. Pure auth + transport. No routing logic, no protocol semantics, those live in IBP proper.

## Architecture at a glance

```
┌─────────────────────────────────┐         ┌─────────────────────────────────┐
│  tabors.site                    │         │  bing.com                       │
│                                 │         │                                 │
│  ┌───────────────────────────┐  │         │  ┌───────────────────────────┐  │
│  │  dispatchIbp              │  │         │  │  dispatchIbp              │  │
│  │   ├ detects foreign       │  │         │  │   ├ verified inbound      │  │
│  │   ├ crossRealityDispatch  │──┼─canopy──┼─▶│   ├ runVerbAsForeignActor │  │
│  │   ├ opens local Act       │  │         │  │   ├ synthetic summonCtx   │  │
│  │   ├ forwardToPeer         │  │         │  │   ├ run verb              │  │
│  │   │                       │  │         │  │   ├ emitFact attaches     │  │
│  │   ├ peerAck arrives       │◀─┼─canopy──┼──│   │   crossOrigin         │  │
│  │   └ handleCrossWorld      │  │         │  │   └ return descriptor     │  │
│  │       Response            │  │         │  │       as inner face       │  │
│  │     (status + innerFace)  │  │         │  │                           │  │
│  └───────────────────────────┘  │         │  └───────────────────────────┘  │
└─────────────────────────────────┘         └─────────────────────────────────┘
```

Same dispatcher, two branches (outbound to peer / inbound from peer), both running through the same machinery a local call uses.

## What's built

### Transport + auth (canopy)

[canopy.js](canopy.js):

- **`forwardToPeer(envelope)`**, outbound. Signs the raw body bytes with this reality's private key, sets `X-Canopy-Sender` + `X-Canopy-Signature` headers, POSTs to `https://<peer>/ibp/<verb>/<address>`. Same URL shape any local HTTP IBP call uses.
- **`verifyIncoming(req, res, next)`**, Express middleware. Reads the canopy headers, verifies against the sender's published public key (cached as a RealityPeer), stamps `req.canopySender = "<domain>"` on success. 401 on missing or invalid signature.
- **`actorTupleFromRequest(req)`**, builds the validated foreign actor identity tuple `{ reality, branch, beingId, actId }` from the canopy sender (trusted, cryptographically vouched) + envelope-claimed fields (beingId, actorBranch, actorActId).

**Identity-forgery defense:** the actor's `reality` is always derived from `req.canopySender`, never trusted from the envelope. If an envelope claims an explicit `actorReality` that doesn't match canopySender, the request is refused. bing.com cannot sign for tabors.site because it doesn't hold tabors.site's private key.

**Replay protection:** today relies on canopy signature freshness; explicit timestamp-window enforcement is not yet implemented (see "remaining work" below).

### Envelope shape

The IBP envelope on the wire, same shape local + cross-reality, with cross-world fields populated only when they apply:

```js
{
  id,                          // correlation id
  verb,                        // "see" | "do" | "summon" | "be"
  address,                     // IBP address string (target reality + branch + position + being)
  payload,                     // verb-specific payload
  identity?: { beingId, name },
  actorBranch?:  "<branchPath>",  // home branch of the actor (cross-world only)
  actorActId?:   "<uuid>",        // home-side Act id (cross-world only)
}
```

`actorReality` is NOT carried in the body, it's derived from `X-Canopy-Sender` on the receiving side. Less data on the wire, no forgery surface.

### Dispatcher integration

[protocol.js](protocol.js)'s `dispatchIbp`:

1. **Outbound cross-reality**, when `getForeignTargetDomain(env.address)` returns a peer domain AND the call didn't already arrive verified from canopy: route to `crossRealityDispatch` (in [seed/ibp/crossWorld.js](../../seed/ibp/crossWorld.js)). This opens a local Act for the actor's attempt, calls `forwardToPeer` with the actor's identity tuple, and applies the peer's response back to the Act via `handleCrossWorldResponse`.

2. **Inbound cross-reality**, when `carrier.crossWorldActor` is set (the HTTP adapter populates it via `actorTupleFromRequest` after `verifyIncoming`): route to `runVerbAsForeignActor`. Builds a synthetic `summonCtx` whose `actorAct` IS the foreign tuple (no local Act row on this side), runs the seed verb, commits any Facts via `sealFacts`. emitFact's `deriveCrossOrigin` automatically attaches `crossOrigin` to those Facts because the actor's world differs from the target's world.

3. **Local**, same path as today. No change.

The dispatch fork is six lines of structural code, plus the two helpers.

### Cross-world doctrine in the seed

The seed already carries everything federation needs. Per [seed/CROSS-WORLD.md](../../seed/CROSS-WORLD.md):

- **Act schema** carries `{ reality, branch, beingIn, _id, status }`, the actor's identity tuple plus a lifecycle status (`attempted` → `landed` / `denied` / `timeout` / `unreachable` / `malformed`).
- **`summonCtx.actorAct`** seats the identity tuple at moment-open; downstream consumers (emitFact, foldEngine, the Stamper, verb handlers) read identity from it.
- **`emitFact` auto-attaches `crossOrigin`** when target world ≠ actor world. The block carries `{ reality, branch, beingId, actId }` of the foreign actor.
- **Stamper foreign-origin idempotency**, duplicate cross-world deliveries (canopy retries, replays) dedup by `crossOrigin.actId` + `crossOrigin.beingId` + target. Receiving reel never grows duplicates.
- **`updateActStatus(actId, status, meta)`**, the single sanctioned post-seal write to an Act. Atomic monotonic transition. Called by the canopy-response handler.
- **`attachInnerFace(actId, descriptor)`**, captures the foreign world's descriptor as a hashed observation at `Act.innerFace`. Same unified canonical field both the local fold and the cross-world override write through; the foreign descriptor is normalized into the inner face shape with `origin: "foreign"` and a sibling `hash` for tamper-detection. The hash is canonical (sorted-key serialization, sha256) for tamper-detection and future content-addressed storage.
- **`handleCrossWorldResponse(actId, response)`**, composite: status transition + inner face attach. The single point the canopy receive path calls when the foreign reality replies.
- **`pullBackForeignPositions()`**, boot-time scan that resets any locally-positioned being whose `position` names a foreign world. A being's identity is never hostage to a foreign reality being available.
- **Position address parse/format**, `Being.position` accepts `<reality>#<branch>/<spaceId>` for cross-world positions. Bare spaceId is same-world (the default).
- **Pointers vs actual branches**, every persisted record (Act, Fact, crossOrigin) stores the ACTUAL branch path, never a pointer name. Pointers are top-level convenience labels resolved at the perimeter; records stay canonical.

### Auth under federation: ables ARE auth

Per [seed/AblesAreAuth.md](../../seed/AblesAreAuth.md), authorization is unified: ables ARE the gate. The able's `canSee / canDo / canSummon / canBe` IS the permission check; the able registry is authoritative. There is no parallel "permissions" namespace, no stance-property gating.

This unification (the seed gaining coherence, not shedding capability) covers federation cleanly with no special-case rules.

#### The three able layers

Three distinct concepts in AblesAreAuth share or border on the word "global"; keeping them precise matters for federation:

|                    | **The `global` able**                                        | **`globalAbles`**                                                                    | **Normal ables**                                         |
| ------------------ | ------------------------------------------------------------ | ------------------------------------------------------------------------------------ | -------------------------------------------------------- |
| What               | A specific able NAME                                         | Ables in the heaven registry marked as universally usable                            | All other ables                                          |
| Who holds it       | Granted to every being on this reality at birth              | Any being can adopt them without a grant, pick-up-and-use                            | Held only by beings with explicit grants                 |
| Purpose            | Customizable per-reality baseline ("everyone here can do X") | Public toolkits, ables anyone can pick up to build with; no permission gate to adopt | Per-node anchored ables; explicit grant required         |
| For foreign actors | Not granted (foreign actors aren't birthed here)             | Available, foreign actors can adopt globalAbles same as locals                       | Need explicit `grant-able` to a specific foreign beingId |

The orthogonal `scope` field on a able spec (`"anchored"` vs `"global"`) is a SEPARATE axis, it controls how a able's REACH works once held (per-anchor descendants vs reality-wide). A able can be a globalAble (anyone can adopt) AND `scope: "anchored"` (its reach is anchor-bound); the two dimensions don't conflict.

#### Federation auth in practice

- Foreign actor's reality is cryptographically vouched via canopy (`req.canopySender`). Their beingId is what their home reality told us.
- The foreign actor carries ZERO grants on this reality. Cross-world able propagation is out of scope, home-side ables don't transfer.
- The receiving reality's `authorize` evaluates the foreign actor against THIS reality's registry. The foreign actor doesn't get the local `global` able (only beings birthed here get that).
- BUT: the foreign actor CAN adopt any **globalAble** registered on this reality, same as a local being could. If the reality publishes open ables in its heaven registry, a "republic" of openly-usable ables, foreign actors can act under them directly. No grant, no mate, no being needed.
- For ables that aren't globalAbles (the per-node anchored ones), the foreign actor needs explicit `grant-able` from someone on this reality holding `grant-able:<ablename>`, same gate as for a local being acquiring a non-global able.

**The receiving reality's federation posture is expressed entirely through what it publishes as globalAbles.** A reality that wants to be open registers permissive globalAbles; a reality that wants tight federation publishes a minimal set or none. Operators don't author a special federation-policy sublanguage, they curate their globalAbles registry, and that IS their federation policy. Foreign actors arrive, see what's openly available, and either find a fit or don't.

## Cross-world citizenship: mate + being (an option for native local presence)

The previous section covered direct cross-world participation, a foreign actor adopting a globalAble on the receiving reality and acting there as themselves, via the canopy round-trip. That works, and for many cases it's all you need.

But it has a structural property worth naming: **the foreign actor's acts stay on their HOME reality's chain**, with consequence Facts landing on the receiving reality's reels carrying `crossOrigin` provenance. Each act is split across two chains. The receiving reality's record of what the foreign actor did is fragmentary, just the consequences, with provenance pointing back.

When a being wants their acts and facts to **live wholly on the foreign reality**, a clean, native biographical presence there, they can mate-birth a being. The being IS a local being; the being's acts are local acts; the being's biography is wholly contained in the foreign reality's chain. The father (the foreign being who commissioned the being) keeps their sovereignty at home, but their actions THROUGH the being are recorded as the being's actions, in the foreign reality's chain.

This is a **distinct architectural option**, not a replacement for direct cross-world action. Two paths:

|                       | Direct cross-world action                                                           | Mate-being pattern                                                                |
| --------------------- | ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| When to use           | Quick interactions; the receiving reality has open globalAbles that admit your case | You want sustained, native presence; clean local biography on the foreign reality |
| Act-chain locality    | Actor's Act on home; foreign Facts on theirs (crossOrigin)                          | All acts + facts on the foreign reality (being is local)                          |
| Required mechanism    | None beyond canopy + adoptable globalAble                                           | summon:mate, being, BE:connect                                                    |
| Sovereignty preserved | Yes (acts are yours, on your chain)                                                 | Yes (your home identity untouched; being acts as itself)                          |
| Cost / setup          | Per-call canopy round-trip                                                          | One-time birth; subsequent connects are cheap                                     |

Both honor "GRASP without SOVEREIGNTY loss", they're two different shapes of grasp.

### `be:birth` is the only birth verb. `summon:mate` is just the ask.

There's exactly ONE verb that produces a child: `be:birth`. Solo or dual, every birth is `be:birth` stamped on the mother's chain. The verb accepts an optional `father` parameter, null for solo, populated when the mother is birthing on behalf of a mate request.

`summon:mate` is the consent intermediary, nothing more. It carries no birth machinery. Like any summon, it lands on the recipient's inbox; cognition decides accept or refuse; on accept, the recipient calls `be:birth(father=summoner)` on their own chain. On refuse, the summon closes normally with no birth.

The two flows in detail:

- **Solo (self-birth)**, actor calls `be:birth()` directly. They become the mother; `father` is null. Surfaced from the portal place-menu's "create a being" affordance. The actor's own chain stamps the birth.

- **Dual (mate-requested)**, actor (would-be father) calls `summon:mate(target=potentialMother)`. Mother's cognition decides. On accept, mother calls `be:birth(father=actor)` on her own chain; she becomes the mother, the original summoner is recorded as father. On refuse, the summon ends; no birth happens.

The summon is the asking. The birth is the doing. Two separable verbs; two separable concerns.

**Hard invariant for both flows:** the mother is whoever called be:birth, and the chain stamping that be:birth IS the mother's own chain. Always. Cross-world births don't bypass this: the foreign summoner asks, but the receiving being still does the actual be:birth on their own chain.

### The birther able: the consent-shortcut

A reality that wants to admit foreign cross-world citizenship publishes a `birther` able whose cognition auto-accepts incoming `summon:mate` requests (subject to whatever filters the operator configures, rate-limits, allow/blocklists, etc.). Whoever the operator anoints as the reality's birther becomes the "make me a child here" service.

A foreign actor wanting native presence on bing.com summons:mate against bing.com's birther. Auto-accept fires. Birther stamps be:birth on bing.com's chain. Child has birther as mother (full structural parent in bing.com) and the foreign actor as father (BE:connect eligibility). being ready.

Operators who don't want to admit foreign citizenship simply don't anoint a birther able on their reality, or restrict who can summons:mate against it. Same registry, same able mechanism, same operator surface. No federation-specific config.

Peer-to-peer mating between non-birther beings works through the same mechanism: any being can summons:mate any other being, and the recipient's cognition decides. Two consenting beings can jointly produce a child without involving a birther able at all.

### The two parental rights

|                          | Mother (right stance)               | Father (left stance, dual-parent only)                  |
| ------------------------ | ----------------------------------- | ------------------------------------------------------- |
| Identity chain           | In the chain (structural parent)    | NOT in the chain                                        |
| Governance authority     | Full                                | None, cannot grant ables, set qualities, govern         |
| `BE:connect` eligibility | Yes (her usual parental connection) | Yes (being right)                                       |
| Removability             | Permanent (recorded at birth)       | Permanent (recorded at birth); see policy on revocation |

Father carries exactly ONE structural right: BE:connect eligibility. That's it. Father is a tightly-bounded structural right, connection eligibility plus the metadata link recording parentage.

### The cross-world citizenship pattern

```
Reality A                         Reality B
─────────                         ─────────
being-A    summon:mate            ─canopy─▶  inbox on birther-B
           (target=birther-B)                cognition: auto-accept
                                             calls be:birth(
                                               father={reality=A, beingId=being-A}
                                             ) on B's own chain
                                               → mother = birther-B (the caller)
                                               → father = being-A (the param)
                                  ◀─canopy──  summon reply: child-C exists

being-A    BE:connect             ─canopy─▶  authorize: father match? yes
           (target=child-C)                  child-C inhabited by being-A
                                             acts in B's chain attribute to C

(being-A still in A; act-chain in A
 records connect/disconnect lifecycle)

being-A     BE:disconnect ──────────────▶    child-C released, returns dormant
                                              being-A back in A unchanged
```

1. Being A issues `summon:mate` against birther-B. Canopy-routed; A's verified identity tuple rides the envelope.
2. The summon lands on birther-B's inbox. Birther's cognition auto-accepts.
3. Birther-B calls `be:birth(father={reality:"A", beingId:"<being-A>"})` on B's own chain. Birther is the actor (= mother); the param carries the father. The Stamper records:
   - **Mother:** birther-B (full structural parent in B).
   - **Father:** the foreign A-being (the verified canopy tuple, stored at `child.qualities.father`).
4. The summon reply carries C's identifier back to A so A knows what being exists for them.
5. C is a fully native B-being. Identity in B. Ables granted by B-mechanisms (whatever the birther's policy admits at birth). Subject to B's authorize like any local being.
6. A can `BE:connect` into C as a being, inhabit it, act through it. While connected, A acts AS C; acts attribute to C in B's chain. A's home identity in A is untouched.
7. A disconnects to return home. The being C either persists (dormant, ready for next connect) or releases per policy.

### Why no foreign-arrival able is needed

A previous draft of this doc flagged "foreign-actor default access" as an open architectural piece, should a `foreign-arrival` able exist? The answer is no, because the receiving reality's existing able registry already covers it.

- **For direct cross-world action**, the foreign actor can adopt any `globalAble` the receiving reality publishes (no grant needed; that's what makes a able global in the registry sense). A reality wanting open federation publishes permissive globalAbles; a closed reality publishes none. The registry IS the federation policy.
- **For sustained native presence**, the mate-being pattern gives a clean local biography on the foreign reality.

Cross-reality actors are not anonymous (they have a canopy-verified beingId), but they have no grants on this reality until they adopt a globalAble or birth a being. Anonymous arrival floor stays for genuinely-unauthenticated visitors browsing the discovery surface.

Each reality's `authorize` stays purely local. No federation-permissions sublanguage; the able registry IS the federation surface. **GRASP gained without SOVEREIGNTY lost, two routes, same outcome.**

### BE:connect remains local

The actual `BE:connect` act is stamped in the being's own chain. The father's connect REQUEST crosses worlds (canopy-routed, summon-shaped), but the act-of-connecting is performed by reality B when the foreign request is authorized. The "BE doesn't cross worlds" doctrine stays intact: what crosses is the request to connect; the connection itself is local to the being.

### Implementation surface

Not yet built; pending implementation:

- **`be:birth` extended**, gains an optional `father` parameter of shape `{ reality, beingId } | null`. Solo birth passes null; mate-accepted birth passes the summoner's verified identity tuple. The actor is always the mother. The actor's own chain stamps the birth. No new verb; just one param added.
- **`summon:mate` op**, a SUMMON op (not DO) whose entire job is asking. Left stance is the would-be father (the summoner); right stance is the would-be mother (the target). Lands on the target's inbox like any other summon; cognition decides. Carries no birth machinery, accept handlers call `be:birth(father=summoner)` themselves; refuse handlers just close the summon.
- **`Being.qualities.father = { reality, beingId } | null`**, recorded on the child as a side effect of `be:birth`'s father param. Immutable thereafter. The Being model's qualities Map already accepts this with no schema change.
- **Birther able**, a able whose cognition auto-accepts `summon:mate` (and dispatches `be:birth(father=summoner)`). Operators anoint a being with this able to make it the reality's "make me a child here" service. Realities that don't publish a birther don't admit foreign citizenship via this path.
- **`BE:connect` authorization**, learns to admit father-eligibility: the requester matches `child.mother` OR `child.father`. Father-eligibility check: match the canopy-verified `{reality, beingId}` against the child's stored father tuple.
- **Cross-world `BE:connect` request routing.** Father's connect-request crosses worlds as a SUMMON-shaped envelope. The receiving reality validates father-match, performs the local `BE:connect` act, returns the connection context. Father's home reality records connect-lifecycle facts on their own chain.
- **Single-connector invariant.** When a being is already inhabited, new connect requests refuse or queue per policy. The being's home reality enforces.

### Cross-reality branch semantics

Resolved: option (c) from the old plan, each reality owns its branch namespace; the caller addresses a specific branch on the foreign reality. The branch qualifier in cross-reality addresses is independent of the caller's current branch. Default if branch omitted in a foreign address: main (`#0`).

This drops out for free because the cross-world envelope carries the target address verbatim (including its `#branch`), and `actorBranch` is sent as a separate field, they're independent fields on the wire, independently routed.

## Federation exchange: two cargoes, one transport

Federation moves two cargoes between peer realities over one push/pull transport. The verb is offer / request / accept / reject / deliver (plus fulfill / refuse on the pull side); the object is **template** or **being**.

- **Template** = the SHAPE of a region. Planting it mints fresh ids; the receiver gets a structural copy, not the originals.
- **Being** = the entity itself, a being delivered verbatim (same id, same chain). The being-graft is an identity-preserving transfer; imported facts keep their foreign hashes by construction.

The content (template) path uses these data primitives:

- `captureTemplate(spaceId, opts)` → bundle (chain + extensionData + manifest)
- `plantTemplate(bundle, targetParentSpaceId, opts)` (in `seedPlant.js`) → plants the bundle, with manifest gate (refuse on missing extensions, warn on missing ables)

The identity (being) path uses the graft primitives:

- `captureGraft({beingId, ...})` → bundle (the being's signed graftRoot + verbatim chain)
- `applyGraft(bundle, opts)` (in `graft.js`) → inserts the being verbatim, verifying the source reality's signed graftRoot

Push and pull are the **social verbs** layered on top. They are negotiations between sovereign realities about who initiated a transfer and whether the receiver consented. The actual content movement is capture template → transport → plant; push and pull only frame the conversation around that movement. (The identity path skips the conversation, see "The identity path" below.)

The whole protocol rides on SUMMON. There is no new envelope shape, no new transport, no new auth concept. A push is `summon(<peer>/@federation-manager, {intent:"offer-template", ...})`; a pull is `summon(<peer>/@federation-manager, {intent:"request-template", ...})`. The seed's existing cross-world dispatch (canopy + `runVerbAsForeignActor`) carries them like any other SUMMON.

### One token, two sides

An operator DO op name and the wire intent it emits now COINCIDE. When the operator runs the op `offer-template`, the able sends the wire intent `offer-template` to the peer. Same concept seen from two realities; a log line tells you which side you're on by its direction (sender vs peer), not by a different name. This holds for `offer-template`, `accept-template`, `reject-template`, and `request-template`. The two pull-review ops are the exception, because they emit a DIFFERENT intent than their own name: `fulfill-request` emits `offer-template` (it pushes back), and `refuse-request` emits `reject-template`.

### The able

`@federation-manager` is a scripted-cognition seed delegate at the reality root. Five facts about it:

- **Operator-facing DO ops** (registered via `registerOperation` in `ops.js`): `offer-template`, `offer-being`, `request-template`, `accept-template`, `reject-template`, `fulfill-request`, `refuse-request`. The operator drives all outbound negotiation by addressing `@federation-manager` with one of these.
- **Peer-facing summon classifier**: incoming SUMMONs from peer federation-managers carry a `message.intent` field; `able.summon()` routes by intent name (the switch in `handlers.js`) to the matching handler.
- **Negotiation state in qualities**: `qualities.federation.{pendingIncomingOffers, pendingIncomingRequests, pendingOutbound, completed}` records every step. Each negotiation has a UUID; reviewing pending negotiations is just a SEE on the able's own qualities.
- **Cached bundles**: outbound pushes cache the captured template bundle in `qualities.federation.bundleCache[id]` until the peer's `accept-template` arrives. v1 inlines bundles in qualities; large bundles will move to matter-keyed cache as a follow-up.
- **Operator policy via flow**: auto-accept particular peers, throttle pulls, route incoming offers to specific positions. The able's flow on the federation-manager being is the policy surface, the same authoring shape as every other being's behavior. No federation-specific policy DSL.

### The seven intents

The first six carry the template (content) cargo through the offer/accept review handshake. The seventh, `deliver-being`, carries the being (identity) cargo one-shot; see "The identity path" below.

| Intent             | Direction        | Payload                                                             | Response                                                      |
| ------------------ | ---------------- | ------------------------------------------------------------------- | ------------------------------------------------------------- |
| `offer-template`   | sender → peer    | `{negotiationId, manifest, bundleHash, label?, sourceSubtreePath?}` | `{kind:"pending-review", negotiationId}` (operator decides)   |
| `accept-template`  | peer → sender    | `{negotiationId}`                                                   | `{kind:"acknowledged"}`; sender then sends `deliver-template` |
| `reject-template`  | peer → sender    | `{negotiationId, reason?}`                                          | `{kind:"acknowledged"}` (sender seals negotiation)            |
| `deliver-template` | sender → peer    | `{negotiationId, bundle}`                                           | `{kind:"template-result", success, summary, error?}`          |
| `request-template` | puller → offerer | `{negotiationId, subtreePath, label?}`                              | `{kind:"pending-review", negotiationId}` (operator decides)   |
| `template-result`  | peer → sender    | `{negotiationId, success, summary?, error?}`                        | `{kind:"acknowledged"}` (terminal)                            |
| `deliver-being`    | sender → peer    | `{negotiationId, bundle}`                                           | `{kind:"act", grafted verbatim}` (auto-accepted, no review)   |

### Push flow (worked example)

Operator on `tabors.site` wants to offer `/lab` to `bing.com`:

```
1. Operator: SUMMON localhost/@federation-manager
            { do: offer-template, args: { peer: "bing.com", subtreePath: "/lab" } }

2. offer-template op (the op name and the wire intent it emits coincide):
   a. captureTemplate("/lab", { branch: "0" }) → bundle (with manifest)
   b. uuidv4() → negotiationId
   c. cache bundle in qualities.federation.bundleCache[id]
   d. crossRealityDispatch({ verb:"summon",
                              address:"bing.com/@federation-manager",
                              payload: { message: { intent:"offer-template",
                                                    negotiationId,
                                                    manifest,
                                                    bundleHash,
                                                    label, ... } } })
   e. write qualities.federation.pendingOutbound[id] = { ..., lastStep:"offer-sent" }

3. (canopy forwards to bing.com)

4. bing.com's @federation-manager.summon() reads intent="offer-template":
   a. writes qualities.federation.pendingIncomingOffers[id] = { sender, manifest, ... }
   b. returns { kind:"pending-review", negotiationId }

5. (response flows back; tabors.site logs it on the actor's Act inner face)

6. bing.com's operator reviews + decides. Say accept:
   SUMMON localhost/@federation-manager
          { do: accept-template, args: { negotiationId } }

7. accept-template op (emits the accept-template intent):
   a. read qualities.federation.pendingIncomingOffers[id] (manifest, sender)
   b. crossRealityDispatch({ verb:"summon",
                              address:"tabors.site/@federation-manager",
                              payload: { message: { intent:"accept-template",
                                                    negotiationId } } })

8. tabors.site's @federation-manager.summon() reads intent="accept-template":
   a. reads bundleCache[id] + pendingOutbound[id]
   b. crossRealityDispatch intent="deliver-template", payload={ negotiationId, bundle }
      to bing.com/@federation-manager (one-way; the SUMMON return path
      only carries the receiver's descriptor as inner face, not the
      result value, so the plant outcome flows back via a separate SUMMON)
   c. writes pendingOutbound[id].lastStep = "delivered"
   d. clears bundleCache[id]
   e. returns { kind:"acknowledged" }

9. bing.com's @federation-manager.summon() reads intent="deliver-template":
   a. plantTemplate(bundle, placeRoot), the manifest gate handles missing
      extensions
   b. seals pendingIncomingOffers[id] into completed[id]
   c. crossRealityDispatch intent="template-result", payload={ success,
      summary, error } back at tabors.site
   d. returns { kind:"acknowledged" }

10. tabors.site's @federation-manager.summon() reads intent="template-result":
    a. seals pendingOutbound[id] into completed[id] with the outcome
    b. returns { kind:"acknowledged" } (terminal)
```

The two cross-reality stages (accept-template to deliver-template to template-result) are independent one-way SUMMONs correlated by negotiationId. No sender awaits a value the wire can't carry; no handler holds its incoming SUMMON open across a foreign round trip.

### Pull flow (mirror)

A pull is a request that, if fulfilled, triggers a push back at the requester:

```
1. tabors.site operator: SUMMON @federation-manager
   { do: request-template, args: { peer: "bing.com", subtreePath: "/library" } }

2. tabors.site sends intent="request-template" to bing.com.

3. bing.com's @federation-manager records pendingIncomingRequests[id].

4. bing.com operator reviews + fulfills:
   SUMMON @federation-manager { do: fulfill-request, args: { negotiationId } }

5. fulfill-request op:
   a. captureTemplate(request.subtreePath) → bundle
   b. crossRealityDispatch intent="offer-template" to tabors.site
   c. (tabors.site is now on the offer-template path of step 4 onward in the push flow)
```

Pull collapses into push at step 5. The fulfill-request op is one of the two cases where the op name and the emitted intent differ: it emits the `offer-template` intent (pushing back at the requester). The same code on the receiving side runs whether the push was operator-initiated on the sender or pull-driven by the requester. One protocol, two operator-experience surfaces.

### The identity path: offer-being to deliver-being (one-shot)

The same push/pull transport carries the OTHER cargo. The template path above moves a SHAPE (fresh ids on planting). The identity path moves the ENTITY ITSELF: a being delivered verbatim, same id, same chain. It is the IDENTITY counterpart to `offer-template`, and it runs the same canopy + `runVerbAsForeignActor` machinery.

Where the template path has a review handshake (offer, accept/reject, deliver, result), the identity path is **one-shot, auto-accepted**. There is no `accept-being` and no `being-result` pair. The reason is that a being-graft is **self-certifying**: the receiver verifies the source reality's signed `graftRoot` with no callback, and the canopy signature proves the sender. The receiver does not need to phone home, so there is nothing to negotiate. It is strictly peer-to-peer, a being crosses between exactly the two realities concerned, never via a catalog or Roots node.

```
1. Operator on tabors.site: SUMMON localhost/@federation-manager
   { do: offer-being, args: { peer: "bing.com", beingId: "<pubkey>" } }

2. offer-being op (in ops.js):
   a. captureGraft({ beingId, ... }) → bundle (signed graftRoot + verbatim chain)
   b. uuidv4() → negotiationId   (no bundle cache; nothing to negotiate)
   c. crossRealityDispatch intent="deliver-being",
      payload={ negotiationId, bundle } to bing.com/@federation-manager

3. bing.com's @federation-manager.summon() reads intent="deliver-being":
   a. handleDeliverBeing verifies the bundle is a being-graft
      (kind:"graft" with meta.beingId)
   b. applyGraft(bundle) inserts the being VERBATIM (foreign by construction,
      imported facts keep their foreign hashes), verifying the source
      reality's signed graftRoot
   c. returns { kind:"act", grafted verbatim }
```

The GRAFT scope is not limited to a single being. A graft can carry a being, a branch's worth, or the whole reality (the genome). Being-graft is what `offer-being` / `deliver-being` wires today; the broader scopes ride the same `captureGraft` / `applyGraft` primitives.

|                       | Template path (content)                                  | Identity path (being)                           |
| --------------------- | -------------------------------------------------------- | ----------------------------------------------- |
| Cargo                 | The SHAPE of a region (template, fresh ids on planting)  | The ENTITY itself (verbatim id + chain)         |
| Push op → wire intent | `offer-template` → `offer-template`                      | `offer-being` → `deliver-being`                 |
| Pull op               | `request-template` (peer fulfills via `fulfill-request`) | none (peer-to-peer only, no pull)               |
| Review handshake      | offer → accept/reject → deliver → result                 | none, one-shot auto-accept                      |
| Why                   | receiver inspects the manifest before committing         | self-certifying (signed graftRoot, no callback) |
| Primitives            | `captureTemplate` / `plantTemplate` (`seedPlant.js`)     | `captureGraft` / `applyGraft` (`graft.js`)      |
| Handler               | `handleOfferTemplate` / `handleDeliverTemplate`          | `handleDeliverBeing`                            |

### Authority asymmetry

Push and pull have different security shapes:

- **Push**: receiver is in control. They see the manifest before committing (they choose whether to send `accept-template`). Safest direction.
- **Pull**: offerer is being asked to leak subtree state. Needs harder receiver-side auth, only specific ables should be able to fulfill pulls. Default policy: no pulls without explicit operator approval (v1 default routes every incoming `request-template` to `pendingIncomingRequests` for operator review; no auto-fulfillment).

The able-walk on the federation-manager handles both directions uniformly: the operator's `canDo` on the federation-manager able licenses `offer-template`, `request-template`, `accept-template`, `fulfill-request`, etc.; an operator who shouldn't be able to push or pull just doesn't get those canDo entries. The operator-policy surface is the able's flow.

The identity path (`offer-being`) has its own posture: there is no receiver review at all, so admitting being-grafts is an all-or-nothing federation policy. In v1, registering the peer IS the opt-in; the bundle's self-certification plus the canopy signature are the trust. An accept-list or operator-review policy for incoming `deliver-being` is a follow-on (flow on the federation-manager, mirroring the template path's offer/accept step).

### What you get for free because it's all SUMMONs

- **Audit trail**. Every push/pull negotiation step is a Fact on each side's reel (the outbound SUMMON's actor Act lives on the sender's reality; the receiving handler's qualities write lives on the receiver's). "I asked bing.com for /library on T; they declined" is forensically permanent on both sides, viewable via the normal reel / acts surfaces.
- **Cross-world identity verification**. A federation-manager doing a cross-reality SUMMON identifies itself with its home-reality tuple, vouched by canopy. No new identity story.
- **Replay determinism**. Federation history reconstructs from the fact chain alone. Replay the chain → you see every negotiation in order, with the same outcomes (assuming external state like peer availability is the same).
- **Mediation by named ables**. An operator can author a federation-policy able and grant it to specific beings, giving fine-grained control over who can push/pull what. Expressed in normal flow, no special vocabulary.

### What this layer is NOT

- **NOT a sync protocol**. Push and pull are one-shot. "Mirror my /lab subtree continuously" is a different shape, ongoing fact-stream replication. The negotiation primitive for it (`request-subscription`, `accept-subscription`, `cancel-subscription`) would map to SUMMON the same way, but the implementation is the next layer up.
- **NOT a discovery protocol**. The operator knows what peer they want to push to or pull from. Discovery of "what templates does this peer offer?" is, again, the next layer (a SEE op or a manifest-listing SUMMON intent on @federation-manager).
- **NOT inventing new primitives**. Every piece (capture template, plant, capture graft, apply graft, SUMMON, able, canopy) already exists. Federation is a deliberate composition of the seed primitives, expressed entirely in seed code (one able + handlers + ops + delegate row). The spaces, matter, and beings don't grow to support it; the able registry does.

### Files

- `seed/store/words/federation-manager/able.js`, able spec (scripted cognition, summon classifier)
- `seed/store/words/federation-manager/handlers.js`, seven intent handlers (six template + deliver-being)
- `seed/store/words/federation-manager/ops.js`, seven operator-facing DO ops
- `seed/materials/being/seedDelegates.js`, @federation-manager delegate row
- `seed/materials/being/identity/lookups.js`, federation-manager listed as a seed delegate name
- `genesis.js`, registerAble + registerFederationManagerOps wiring

## What's NOT built / remaining work

### 1. The mate / being implementation

The cross-world citizenship pattern (see above) is the seed's settled answer to federation auth. It needs concrete machinery:

See the [Implementation surface](#implementation-surface) section above for the concrete piece list. Highlights:

- `be:birth` op (left stance is mother; self-birth surface from place menu)
- `summon:mate` op (cross-being mate request with built-in consent semantics)
- Birther able with auto-accept cognition (the operator's federation switch)
- `Being.qualities.father` recorded at birth
- `BE:connect`'s father-admit + cross-world connect request routing
- Single-connector invariant enforcement

**Parked (orthogonal future work):**

- **cosign-birth**, multiple beings each contributing some of their granted ables to a new child's initial state. Deliberately-composed beings.
- **`be:close`**, beings have arcs; closure is one-way completion. Closed beings persist in the chain but no longer act. Distinct from release.

### 2. Public id-to-name directory

For foreign beings appearing in local faces (descriptor renderings, act-chain inspectors), names need to be resolvable. Two SEE-callable endpoints on every reality:

- `<reality>/.beings/<beingId>`, `{ id, name, able?, public-safe qualities }`
- `<reality>/.spaces/<spaceId>`, `{ id, name, path, public-safe qualities }`

Must be callable WITHOUT local auth (unauth foreign callers should be able to resolve display info for ids appearing in their inner-face descriptors). Privacy controls: realities choose what to expose; defaults expose just `id` + `name`. A being can be marked private, endpoint returns 404 even if the id exists.

Local cache: when receiving a SEE descriptor that contains foreign ids, the local wire kicks off a background fetch against the foreign reality's directory and caches the (id → name) mapping. TTL ~5 minutes.

Not yet built. Add as a SEE op (`see-foreign-name`) on the unauth surface plus a small cache module on the receive side.

### 3. Replay-protection window on canopy signature

Canopy verifies signatures but doesn't enforce a freshness window on `signedAt`. A captured envelope could in theory be replayed indefinitely. Suggest 60s acceptable skew; reject anything older. Small addition in `verifyIncoming` plus a `signedAt` field added to the signed body.

### 4. Real cross-reality round-trip validation

Structurally complete, never exercised end-to-end against a real peered reality. Pieces to validate when a second reality is brought up:

- `crossRealityDispatch` → `forwardToPeer` → foreign reality's `verifyIncoming` → `actorTupleFromRequest` → `runVerbAsForeignActor` → response → `handleCrossWorldResponse`
- Status transition fires correctly (`attempted` → `landed`)
- Inner face attaches to the actor's local Act with a valid hash
- Foreign Fact carries `crossOrigin` pointing back at the source Act
- Receiving Stamper dedups on retry (idempotency check)

A new verifier `verify-federation.js` should be authored that stands up two in-process realities (different `REALITY_DOMAIN`) and runs the loop. The pieces are there; this is wiring + assertions.

### 5. Cross-world walking-through (`do:set-being:position`)

A being walks through a portal by emitting `do:set-being:position` with value = foreign IBPA. The seed primitive (`Being.position` as String + `parsePositionAddress`) is in place. What's not yet validated:

- The `do:set-being:position` op accepts the cross-world value shape and runs through canopy to the foreign reality (which stamps the arrival fact on its reels with `crossOrigin`).
- The 3D portal extension's "walk through" UX dispatches this op when the player crosses the portal mesh.
- The bidirectional back-portal, when an actor's position becomes foreign, the foreign side renders a back-portal at the actor's spot. Mechanism: the foreign reality's descriptor of the space the actor arrives at includes the actor's `crossOrigin` info, and the portal extension renders a portal Matter for any occupant whose position references a foreign reality. Auto-cleanup on departure (position changes back) just means the descriptor no longer reflects the foreign occupant.

Substrate has what it needs; the UX layer needs the wiring.

### 6. Foreign-position default-target routing

When a being acts (SEE/DO/SUMMON) without an explicit target, the seed uses their current position as default. Today most verb handlers route through the address-parser which uses `socket.currentPath`. The portal-walking case wants `socket.currentPosition` to come from the being's `position` quality, when that quality names a foreign world, the actor's defaults route there.

Small audit at the wire layer (`protocols/ibp/verbs/*.js`) to confirm foreign positions route correctly when a being acts from a foreign world.

### 7. Real camera-through portal rendering

The 3D portal renderer ([portal/3d-app/src/scene.js](../../portal/3d-app/src/scene.js) `_makePortalMesh`) paints a canvas summary of the foreign descriptor onto the portal opening today. The doctrinal endgame is render-to-texture: the foreign world's 3D scene rendered live as a texture on the portal plane, so the viewer literally looks through into a parallel world.

Would need the foreign reality to expose a render-target stream (a SEE op returning rasterized frames? a WebRTC video channel from a headless render?). Big lift, deferred. The canvas-summary version gets the loop visible end-to-end today.

## Summary

| Layer                                                      | Status                                                                   |
| ---------------------------------------------------------- | ------------------------------------------------------------------------ |
| Canopy outbound (`forwardToPeer`)                          | ✓ Built, carries cross-world envelope                                    |
| Canopy inbound (`verifyIncoming`, `actorTupleFromRequest`) | ✓ Built, forgery defense holds                                           |
| Dispatcher integration (`dispatchIbp` fork)                | ✓ Built                                                                  |
| `crossRealityDispatch` (outbound helper)                   | ✓ Built                                                                  |
| `runVerbAsForeignActor` (inbound helper)                   | ✓ Built                                                                  |
| Act lifecycle (status, inner face, idempotency)            | ✓ Built                                                                  |
| Pull-back safety                                           | ✓ Built, wired into boot                                                 |
| Auth via ables (AblesAreAuth)                              | ✓ Built                                                                  |
| Cross-reality branch semantics                             | ✓ Resolved: caller addresses foreign reality's branch explicitly         |
| Cross-world citizenship doctrine                           | ✓ Resolved: mate produces being-child; father has BE:connect eligibility |
| `do:form-portal` op                                        | ✓ Built                                                                  |
| 3D portal renderer (canvas summary)                        | ✓ Built                                                                  |
| `summon:mate` op + father field + BE:connect father-admit  | Not built, primary remaining federation work                             |
| Cross-world BE:connect request routing                     | Not built, companion to summon:mate                                      |
| Public id-to-name directory                                | Not built, small addition                                                |
| Replay-window enforcement                                  | Not built, small addition                                                |
| End-to-end live round-trip test                            | Not built, needs `verify-federation.js`                                  |
| Cross-world walking-through UX                             | Substrate ready; UX wiring pending                                       |
| Foreign-position default-target audit                      | Pending                                                                  |
| Real camera-through render-to-texture                      | Deferred (big lift)                                                      |

**Where this leaves federation:** the transport, auth (cryptographic), envelope, dispatch, seed doctrine, AND the cross-world citizenship model are settled. Two routes for foreign-actor presence:

- **Direct**, foreign actor adopts a globalAble the receiving reality publishes. Acts go through canopy each time; actor's Act stays on their home; consequence Facts land on the receiving reality with crossOrigin. Already works end-to-end on the seed side (modulo live testing).
- **Native**, foreign actor mates with a receiving-reality being, births a being-child there, and BE:connects into the being. being acts and facts live wholly on the receiving reality. Needs `summon:mate` + father field + BE:connect father-admit + cross-world connect routing, the primary remaining federation work.

A reality's federation posture is expressed entirely through its able registry, which ables it publishes as globalAbles. No federation-permissions sublanguage; no `foreign-arrival` config decision; the registry IS the policy.

Everything beyond the mate primitive is polish (replay window, directory), live validation (verify-federation.js), and the UX layer for walk-through portals.
