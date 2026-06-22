# Able Tree — Who Holds What, Where, How

Snapshot of the seed-shipped able landscape after the single-gate refactor
(2026-06-10). This is the base everyone builds on; spot problems here.

## Reading guide

- **Able spec lives at** `seed/present/ables/<name>/able.js` — registered into the in-memory `REGISTRY` at boot.
- **Able spec installs at** `Space.qualities.ables[<name>]` — read by the able-walk authorize via `getAbleSpecForGrant` walking the grant's anchor up the ancestor chain.
- **Grants live at** `Being.qualities.ablesGranted` — `{able, anchorSpaceId, grantedBy, grantedAt}`. The able-walk admits when the grant's anchor + able spec reaches the target and the canX matches.

## The 16 seed ables

| Able | Hosted at (qualities.ables install) | Reach | canX summary | acquisition |
|---|---|---|---|---|
| `angel` | **heaven** (`<story>/.`) | `["/**"]` (story-wide via reach) | `canSee:["*"]`, `canDo:["grant-able:*", "revoke-able:*", "*"]`, full super-sudo | (default = queue) |
| `global` | **story root** (`<story>/`) | host + descendants (whole story) | `canSee:["place"]`, `canDo:[move, set-being:coord, set-being:position, ask-able, take-able]`, `canSummon:[@cherub]`, `canBe:[release]` | (default) |
| `arrival` | **story root** | `["/**"]` | `canSee:["arrival-view"]`, `canSummon:[@cherub:mate]`, `canBe:[birth, connect, release]`, no `canDo` | (default) |
| `human` | (registry only — not installed at boot) | default | `canSee:["*"]`, `canDo:[{action:"*"}]`, `canSummon:[{pattern:"@*"}]`, `canBe:[{operation:"*"}]` — root founder | (default) |
| `cherub` | (registry only) | default | gate able: `canDo:[grant-able:global, grant-able:human]`, `canSummon:[receiver:mate]`, `canBe:[birth, connect, release]` | (default) |
| `birther` | (registry only) | default | `canBe:["birth"]` + birth-related calls | (default) |
| `public` | (registry only) | default | empty canX — placeholder; @public never acts | (default) |
| `public-commons` | NOT registered as seed (template only) | default | `canSee:["*"]`, `canDo:[move, set-being:coord, set-being:position, create-space, create-matter]`, `canSummon:[@cherub]`, `canBe:[release]` | **`asked:"auto"`, `autoOnEntry:true`** |
| `able-manager` | (registry only) | default | `canDo:[set-able, delete-able, set-world-signal]` | (default) |
| `able-finder` | (registry only) | default | `canSee:[able-list, able-detail, ...]`, `canDo:[]` — read-only able registry inspector | (default) |
| `flow-composer` | (registry only) | default | `canSee:[flow-detail], canDo:[set-flow]` | (default) |
| `llm-assigner` | (registry only) | default | LLM connection management ops | (default) |
| `story-manager` | (registry only) | default | `canDo:[set-config, delete-config, close-story]` | (default) |
| `history-manager` | (registry only) | default | history ops (create-branch, merge-histories, delete-history) | (default) |
| `merge-mediator` | (registry only) | default | merge-conflict resolution canSee + canDo | (default) |

Default acquisition = `{asked:"queue", grabbed:false, autoOnEntry:false}` — requires explicit owner approval via the queued call flow.

## The 11 seed beings (delegates) — what they hold at birth

Every seed delegate is birthed by genesis at the story root. `grantAngelToSeedDelegates()` then grants each one **two** things at heaven: `angel` (the identity-as-descendant-of-I-Am badge, gives heaven access) and their matching delegate able at the story root (cherub→cherub, birther→birther, etc.). `@public` skipped from both (never acts). `@arrival` skipped from angel (anon visitors would inherit canSee:["*"]) but gets `arrival` able. **Every birthed being also gets `global` @ story root via `_anointGlobal` (universal baseline).**

**Why angel for delegates**: angel is about IDENTITY, not just canDo. Seed delegates ARE angels by birth — descendants of I-Am, with heaven-access by structural right. Their matching able carries the specific canX for day-to-day work; angel codifies their place in the heavenly hierarchy and the access path to heaven space when they later need to operate there. The chain back to I-Am IS their authority.

| Being | Cognition | Default able | Grants at birth |
|---|---|---|---|
| **I-Am** | (bootstrap — bypasses able-walk via `identity.beingId === I_AM`) | — | **No grants needed.** The I-Am bypass is the bootstrap axiom. |
| `@arrival` | scripted | `arrival` | `global` @ root, `arrival` @ root |
| `@public` | scripted | `public` | `global` @ root (anoint runs for every birth, even this one) |
| `@cherub` | scripted | `cherub` | `global` @ root, `angel` @ heaven |
| `@birther` | scripted | `birther` | `global` @ root, `angel` @ heaven |
| `@able-manager` | scripted | `able-manager` | `global` @ root, `angel` @ heaven |
| `@able-finder` | scripted | `able-finder` | `global` @ root, `angel` @ heaven |
| `@flow-composer` | scripted | `flow-composer` | `global` @ root, `angel` @ heaven |
| `@llm-assigner` | scripted | `llm-assigner` | `global` @ root, `angel` @ heaven |
| `@story-manager` | scripted | `story-manager` | `global` @ root, `angel` @ heaven |
| `@history-manager` | scripted | `history-manager` | `global` @ root, `angel` @ heaven |

Cognition note: every seed delegate is `scripted` — they have code handlers and don't go through LLM cognition. They speak in their delegate voice via the registry-fallback path in `flow.js` (`origin === "seed"` lookup) without needing an explicit grant of their own delegate-able.

## Newly-registered human (via `call @cherub:mate`)

When an anonymous visitor registers, cherub's handler emits:

```
be:birth                       → mints the being
do:grant-able global @ root    → (already done by _anointGlobal; this is redundant-but-idempotent)
do:grant-able human @ root     → adds human (root-founder canX)
[if first user]
do:grant-able angel @ heaven   → first-user anointing
```

Plus: `qualities.lineage = { mother: <cherub>, father: <arrival or requester> }`.

The new human's `qualities.ablesGranted` after registration:
- 2 grants for ordinary registrations: `[global, human]`
- 3 grants for the first user: `[global, human, angel]`

## The auth flow for a typical action

For any verb call by an authenticated being:

```
1. I-Am bypass — if identity.beingId === I_AM, allow (no able-walk).
2. Anonymous arrival floor — if !identity.beingId, run under implicit arrival able.
3. Ownership step — walk target's ancestors for the nearest non-empty
   members.owner. If actor is in it, allow (able: "owner").
4. Able-walk — for each grant in identity.ablesGranted:
   a. getAbleSpecForGrant: walk anchor up Qualities chain looking for
      qualities.ables[name]. Fallback to REGISTRY for seed ables.
   b. reachCovers: check able's natural coverage (host + descendants) +
      reach[] filter against the target.
   c. permits: check the able's canX (canSee/canDo/canSummon/canBe)
      against the verb + action/intent/operation.
   d. First match wins → allow.
5. Default deny → able label "anonymous" in the FORBIDDEN message.
```

There is no other gate. No `qualities.permissions`, no `skipAuthorize`, no
hardcoded special branches. Single-gate doctrine pinned in
[seed/AblesAreAuth.md](AblesAreAuth.md).

## Acquisition flow (the new mechanism)

A being gets a new able by one of three paths:

```
ASK              do(<host-space>, "ask-able", { able: "X" })
                 → permitted by global.canDo:[ask-able] on the asker
                 → able's acquisition.asked:
                     "auto"  → grant-able emitted internally, asker self-grants
                     "queue" → call to host owner with intent "able-request"
                     false   → FORBIDDEN

TAKE             do(<host-space>, "take-able", { able: "X" })
                 → permitted by global.canDo:[take-able] on the asker
                 → able's acquisition.grabbed:
                     true  → grant-able emitted internally
                     false → FORBIDDEN

AUTO-ON-ENTRY    SEE on <host-space>
                 → after authorize passes, scan space.qualities.ables
                 → for any able with acquisition.autoOnEntry:true,
                   silently emit grant-able for the actor
                 → idempotent (alreadyHoldsAble check)
```

In all three paths, the grant fact lands in the asker's `qualities.ablesGranted` and the able-walk admits via the normal path on the next call.

## Things to spot

Looking at this overview, here's what jumps out as worth deciding:

### 1. **Cherub's grant of `global` is redundant after `_anointGlobal`**
Birth itself now grants `global` to every being. Cherub also grants `global` after the birth (line 601 of [cherub/able.js](seed/present/ables/cherub/able.js#L601)). The reducer may dedupe (same able + same anchor + same grantor=cherub vs I_AM = different grantors so probably NOT deduped). **Action: drop cherub's `global` grant and let `_anointGlobal` be authoritative.**

### 2. **Most ables are registry-only, not installed on any space**
Only `angel` (on heaven), `global` (on story root), and `arrival` (on story root) actually live in `qualities.ables` after boot. All other seed ables (cherub, birther, llm-assigner, etc.) live only in the in-memory registry. The able-walk falls back to registry for seed ables (`origin: "seed"` check in `flow.js`), but operators can't customize them via `set-able` because they're not space-hosted. **Action item: decide if seed delegate ables (cherub, birther, etc.) should also install onto story root so operators can customize their canX without editing seed files.**

### 3. **`@public` has no purpose-of-action**
Public has `global` granted at birth (via `_anointGlobal`) and `defaultAble: "public"`. But the doctrine says "@public never acts." If it never acts, granting `global` is benign noise. **Action: either skip `_anointGlobal` for @public, OR document that the grant is harmless and present for uniformity.**

### 4. **`acquisition` field defaults to `queue` but the queue path returns a placeholder message**
Today `ask-able` with policy `"queue"` returns `{granted:false, path:"queue", message:"..."}` without actually calling the host owner. The call-to-owner flow needs wiring (or the queue path should be documented as "not yet implemented" until the UI lands). **Action: either wire the actual owner call, or change the default for unset acquisition to `"closed"` (no ask) so we don't have a stub returning silent messages.**

### 5. **`human` has full wildcards (`canDo:[{action:"*"}]`)**
Every registered human has `canDo:["*"]` via the `human` able. That's the "root founder" doctrine — first user can do anything. After multi-user systems land, the `human` able probably needs to narrow OR be granted only to the first user (not every registrant). **Action: confirm if every registrant should hold `human` or only the first. If only the first, cherub's registration flow should differentiate.**

### 6. ~~merge-mediator~~ **REGISTERED.** It IS imported at genesis.js:487 — my earlier survey missed it. No action needed.

### 7. **`able-finder` and `flow-composer` are inspection-only ables**
They have canSee for the registry/flow surfaces but no canDo (or minimal canDo). They make sense as "operator panels" but aren't granted to any being at boot. **Action: clarify who's supposed to hold these. Operators? First user? Document.**

### 8. **`acquisition` only on `public-commons`**
Of the 16 seed ables, only `public-commons` declares an acquisition block. Every other able uses the default (`queue`). Most aren't intended for ask-acquisition anyway (angel, able-manager — these are granted by authority, not asked for). But arrival's canBe ["birth", "connect", "release"] is acquisition-shaped — is `arrival` itself acquirable? **Action: audit which seed ables should be openly askable vs closed.**
