# IBP Federation — current state

> Canonical doctrine: [seed/CROSS-WORLD.md](../../seed/CROSS-WORLD.md). Auth: [seed/RolesAreAuth.md](../../seed/RolesAreAuth.md). This doc is the protocol-layer current state — what's built, what's not, where the wire boundary sits.

## What federation is

IBP is the inter-being protocol. The "inter" crosses realities. A being on `tabors.site` can SEE / DO / SUMMON / BE against a being or space on `bing.com` directly via the same four verbs, with the same envelope shape. The dispatcher routes; canopy authenticates and transports.

There is no separate "federation protocol" — federation IS IBP, with one extra hop. The local verb path and the cross-reality verb path go through the same `dispatchIbp` function in [protocol.js](protocol.js). When the dispatcher sees a foreign target reality on the envelope's address, it forwards via canopy; when it sees a verified inbound from canopy, it runs the verb locally as a foreign actor. No verb-specific federation code in `verbs/`; no `/canopy/*` HTTP endpoints; no parallel envelope shape.

The canopy is the wire+auth layer between realities. Pure auth + transport. No routing logic, no protocol semantics — those live in IBP proper.

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

- **`forwardToPeer(envelope)`** — outbound. Signs the raw body bytes with this reality's private key, sets `X-Canopy-Sender` + `X-Canopy-Signature` headers, POSTs to `https://<peer>/ibp/<verb>/<address>`. Same URL shape any local HTTP IBP call uses.
- **`verifyIncoming(req, res, next)`** — Express middleware. Reads the canopy headers, verifies against the sender's published public key (cached as a RealityPeer), stamps `req.canopySender = "<domain>"` on success. 401 on missing or invalid signature.
- **`actorTupleFromRequest(req)`** — builds the validated foreign actor identity tuple `{ reality, branch, beingId, actId }` from the canopy sender (trusted, cryptographically vouched) + envelope-claimed fields (beingId, actorBranch, actorActId).

**Identity-forgery defense:** the actor's `reality` is always derived from `req.canopySender`, never trusted from the envelope. If an envelope claims an explicit `actorReality` that doesn't match canopySender, the request is refused. bing.com cannot sign for tabors.site because it doesn't hold tabors.site's private key.

**Replay protection:** today relies on canopy signature freshness; explicit timestamp-window enforcement is not yet implemented (see "remaining work" below).

### Envelope shape

The IBP envelope on the wire — same shape local + cross-reality, with cross-world fields populated only when they apply:

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

`actorReality` is NOT carried in the body — it's derived from `X-Canopy-Sender` on the receiving side. Less data on the wire, no forgery surface.

### Dispatcher integration

[protocol.js](protocol.js)'s `dispatchIbp`:

1. **Outbound cross-reality** — when `getForeignTargetDomain(env.address)` returns a peer domain AND the call didn't already arrive verified from canopy: route to `crossRealityDispatch` (in [seed/ibp/crossWorld.js](../../seed/ibp/crossWorld.js)). This opens a local Act for the actor's attempt, calls `forwardToPeer` with the actor's identity tuple, and applies the peer's response back to the Act via `handleCrossWorldResponse`.

2. **Inbound cross-reality** — when `carrier.crossWorldActor` is set (the HTTP adapter populates it via `actorTupleFromRequest` after `verifyIncoming`): route to `runVerbAsForeignActor`. Builds a synthetic `summonCtx` whose `actorAct` IS the foreign tuple (no local Act row on this side), runs the substrate verb, commits any Facts via `sealFacts`. emitFact's `deriveCrossOrigin` automatically attaches `crossOrigin` to those Facts because the actor's world differs from the target's world.

3. **Local** — same path as today. No change.

The dispatch fork is six lines of structural code, plus the two helpers.

### Cross-world doctrine in the substrate

The seed already carries everything federation needs. Per [seed/CROSS-WORLD.md](../../seed/CROSS-WORLD.md):

- **Act schema** carries `{ reality, branch, beingIn, _id, status }` — the actor's identity tuple plus a lifecycle status (`attempted` → `landed` / `denied` / `timeout` / `unreachable` / `malformed`).
- **`summonCtx.actorAct`** seats the identity tuple at moment-open; downstream consumers (emitFact, foldEngine, the Stamper, verb handlers) read identity from it.
- **`emitFact` auto-attaches `crossOrigin`** when target world ≠ actor world. The block carries `{ reality, branch, beingId, actId }` of the foreign actor.
- **Stamper foreign-origin idempotency** — duplicate cross-world deliveries (canopy retries, replays) dedup by `crossOrigin.actId` + `crossOrigin.beingId` + target. Receiving reel never grows duplicates.
- **`updateActStatus(actId, status, meta)`** — the single sanctioned post-seal write to an Act. Atomic monotonic transition. Called by the canopy-response handler.
- **`attachInnerFace(actId, descriptor)`** — captures the foreign world's descriptor as a hashed observation at `Act.qualities.innerFace`. The hash is canonical (sorted-key serialization, sha256) for tamper-detection and future content-addressed storage.
- **`handleCrossWorldResponse(actId, response)`** — composite: status transition + inner face attach. The single point the canopy receive path calls when the foreign substrate replies.
- **`pullBackForeignPositions()`** — boot-time scan that resets any locally-positioned being whose `position` names a foreign world. A being's identity is never hostage to a foreign reality being available.
- **Position address parse/format** — `Being.position` accepts `<reality>#<branch>/<spaceId>` for cross-world positions. Bare spaceId is same-world (the default).
- **Pointers vs actual branches** — every persisted record (Act, Fact, crossOrigin) stores the ACTUAL branch path, never a pointer name. Pointers are top-level convenience labels resolved at the perimeter; records stay canonical.

### Auth under federation: roles ARE auth

Per [seed/RolesAreAuth.md](../../seed/RolesAreAuth.md), authorization is unified: a being's `rolesGranted[]` is the single source of truth for what they can do. The role's `canSee / canDo / canSummon / canBe` IS the gate; the role registry is authoritative. There is no parallel "permissions" namespace, no stance-property gating.

This unification — substrate gaining coherence, not shedding capability — covers federation cleanly with no special-case rules.

**Federation auth under this model:**

- A foreign actor's reality is cryptographically vouched via canopy (`req.canopySender`). Their beingId is what their home reality told us.
- The foreign actor carries ZERO grants on this reality. Cross-world role propagation is out of scope per RolesAreAuth — a being's home-side roles don't transfer.
- The receiving substrate's `authorize` evaluates the foreign actor against THIS reality's role registry. The foreign actor doesn't get the local **`global` role** (the role name; granted to every being THIS reality births at birth). They aren't a fresh local being.
- The foreign actor doesn't get the implicit `arrival` floor either — that floor is for callers with no `beingId` at all (true anonymous), not for identified-but-not-locally-granted actors.

Two concepts in RolesAreAuth share the word "global"; they're distinct:

| | The `global` role (a role NAME) | `scope: "global"` (a SCOPE on roles) |
|---|---|---|
| What | The role granted to every being birthed on this reality | A scope value on the role spec |
| Scope value | `"anchored"` (anchored at place root, reaches via descendants) | `"global"` (intrinsic reality-wide reach via the role's `reach` field) |
| Granted automatically | At birth, to local beings | Never automatic — every grant is explicit, including for scope:"global" roles |
| Purpose | Customizable per-reality baseline for local beings | Reality-wide roles like `angel`; the `reach` field controls WHERE the role can act, not WHO can hold it |

Roles are auth — and grants are explicit. `scope: "global"` doesn't auto-grant to anyone; it just means once granted, the role reaches everywhere (or wherever `reach` allows). For a foreign actor to have ANY access beyond pure refusal, the receiving reality must `grant-role` explicitly to that foreign beingId. The grant chain back to I-Am still applies — whoever grants the foreign-being role must hold `grant-role:<rolename>` themselves.

What this means in practice: federation works on the same role machinery, but **a "default surface for arriving foreign actors" is an operator-decided convention, not a substrate-built feature.** Today there's no `arrival-foreign` role auto-granted to every foreign beingId on first contact. See the "remaining work" section for the open architectural piece this leaves.

### Cross-reality branch semantics

Resolved: option (c) from the old plan — each reality owns its branch namespace; the caller addresses a specific branch on the foreign reality. The branch qualifier in cross-reality addresses is independent of the caller's current branch. Default if branch omitted in a foreign address: main (`#0`).

This drops out for free because the cross-world envelope carries the target address verbatim (including its `#branch`), and `actorBranch` is sent as a separate field — they're independent fields on the wire, independently routed.

## What's NOT built / remaining work

### 1. Public id-to-name directory

For foreign beings appearing in local faces (descriptor renderings, act-chain inspectors), names need to be resolvable. Two SEE-callable endpoints on every reality:

- `<reality>/.beings/<beingId>` — `{ id, name, role?, public-safe qualities }`
- `<reality>/.spaces/<spaceId>` — `{ id, name, path, public-safe qualities }`

Must be callable WITHOUT local auth (unauth foreign callers should be able to resolve display info for ids appearing in their inner-face descriptors). Privacy controls: realities choose what to expose; defaults expose just `id` + `name`. A being can be marked private — endpoint returns 404 even if the id exists.

Local cache: when receiving a SEE descriptor that contains foreign ids, the local wire kicks off a background fetch against the foreign reality's directory and caches the (id → name) mapping. TTL ~5 minutes.

Not yet built. Add as a SEE op (`see-foreign-name`) on the unauth surface plus a small cache module on the receive side.

### 2. Replay-protection window on canopy signature

Canopy verifies signatures but doesn't enforce a freshness window on `signedAt`. A captured envelope could in theory be replayed indefinitely. Suggest 60s acceptable skew; reject anything older. Small addition in `verifyIncoming` plus a `signedAt` field added to the signed body.

### 3. Real cross-reality round-trip validation

Structurally complete, never exercised end-to-end against a real peered reality. Pieces to validate when a second reality is brought up:

- `crossRealityDispatch` → `forwardToPeer` → foreign substrate's `verifyIncoming` → `actorTupleFromRequest` → `runVerbAsForeignActor` → response → `handleCrossWorldResponse`
- Status transition fires correctly (`attempted` → `landed`)
- Inner face attaches to the actor's local Act with a valid hash
- Foreign Fact carries `crossOrigin` pointing back at the source Act
- Receiving Stamper dedups on retry (idempotency check)

A new verifier `verify-federation.js` should be authored that stands up two in-process realities (different `REALITY_DOMAIN`) and runs the loop. The pieces are there; this is wiring + assertions.

### 4. Cross-world walking-through (`do:set-being:position`)

A being walks through a portal by emitting `do:set-being:position` with value = foreign IBPA. The substrate primitive (`Being.position` as String + `parsePositionAddress`) is in place. What's not yet validated:

- The `do:set-being:position` op accepts the cross-world value shape and runs through canopy to the foreign reality (which stamps the arrival fact on its reels with `crossOrigin`).
- The 3D portal extension's "walk through" UX dispatches this op when the player crosses the portal mesh.
- The bidirectional back-portal — when an actor's position becomes foreign, the foreign side renders a back-portal at the actor's spot. Mechanism: the foreign reality's descriptor of the space the actor arrives at includes the actor's `crossOrigin` info, and the portal extension renders a portal Matter for any occupant whose position references a foreign reality. Auto-cleanup on departure (position changes back) just means the descriptor no longer reflects the foreign occupant.

Substrate has what it needs; the UX layer needs the wiring.

### 5. Foreign-position default-target routing

When a being acts (SEE/DO/SUMMON) without an explicit target, the substrate uses their current position as default. Today most verb handlers route through the address-parser which uses `socket.currentPath`. The portal-walking case wants `socket.currentPosition` to come from the being's `position` quality — when that quality names a foreign world, the actor's defaults route there.

Small audit at the wire layer (`protocols/ibp/verbs/*.js`) to confirm foreign positions route correctly when a being acts from a foreign world.

### 6. Real camera-through portal rendering

The 3D portal renderer ([portal/3d-app/src/scene.js](../../portal/3d-app/src/scene.js) `_makePortalMesh`) paints a canvas summary of the foreign descriptor onto the portal opening today. The doctrinal endgame is render-to-texture: the foreign world's 3D scene rendered live as a texture on the portal plane, so the viewer literally looks through into a parallel world.

Would need the foreign substrate to expose a render-target stream (a SEE op returning rasterized frames? a WebRTC video channel from a headless render?). Big lift, deferred. The canvas-summary version gets the loop visible end-to-end today.

## Summary

| Layer | Status |
|---|---|
| Canopy outbound (`forwardToPeer`) | ✓ Built, carries cross-world envelope |
| Canopy inbound (`verifyIncoming`, `actorTupleFromRequest`) | ✓ Built, forgery defense holds |
| Dispatcher integration (`dispatchIbp` fork) | ✓ Built |
| `crossRealityDispatch` (outbound helper) | ✓ Built |
| `runVerbAsForeignActor` (inbound helper) | ✓ Built |
| Act lifecycle (status, inner face, idempotency) | ✓ Built |
| Pull-back safety | ✓ Built, wired into boot |
| Auth via roles (RolesAreAuth) | ✓ Built; federation auth uses `scope: "global"` roles |
| Cross-reality branch semantics | ✓ Resolved: caller addresses foreign reality's branch explicitly |
| `do:form-portal` op | ✓ Built |
| 3D portal renderer (canvas summary) | ✓ Built |
| Replay-window enforcement | Not built — small addition |
| Public id-to-name directory | Not built — small addition |
| End-to-end live round-trip test | Not built — needs `verify-federation.js` |
| Cross-world walking-through UX | Substrate ready; UX wiring pending |
| Foreign-position default-target audit | Pending |
| Real camera-through render-to-texture | Deferred (big lift) |

**Where this leaves federation:** the protocol is structurally complete. Two realities with peer keys can theoretically run the four verbs across each other today, with the actor's local Act recording the attempt + receiving the inner face + the foreign Stamper landing the consequence with provenance. What's left is polish (replay window, directory), validation (live test), and the UX layer for walk-through portals.
