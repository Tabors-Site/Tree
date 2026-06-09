# Roles Are Auth — Unifying Stance Auth + Role Registry

> *Source notes: `philosophy/CROSS-WORLD/auth3.jpg` + `auth4.jpg` — "All beings who are owner/contributor in heaven have angel role. I-AM is first, and from him all permissions strangle as needed down the Being Tree. Each parent assigns and delegates the permissions they have to their child."*

## Context

Today the substrate has **two systems that look related but aren't actually wired together**:

1. **Stance auth** — `seed/ibp/authorize.js` walks `qualities.permissions.<verb>.<keyParts>` on the target's ancestor chain. The `requires:` block matches against stance properties (`arrival`, `owner`, `contributor`, `memberClasses`, etc.) derived from the caller's relationship to the position. The keyParts INCLUDE role-name strings (e.g. `summon:@cherub:birth`) but those strings are just names — authorize never looks them up in the role registry.

2. **The role registry** — `seed/present/roles/registry.js`. Each role declares `canSee` / `canDo` / `canSummon` / `canBe`. These are used at moment-time to build the LLM frame (the prompt's capability list) and to dispatch the summon handler. They are NOT consulted by authorize.

This is the load-bearing smell. A role's `canDo: ["set-config"]` is documentation for the LLM — it tells the model "you have this affordance" — but it doesn't actually grant the underlying permission. Authorization gates on whether the caller is a `contributor` of the target space, not on whether their role has `set-config` in its canDo list. Add a new role with canDo containing "set-config" and nothing changes downstream.

The doctrine you sketched in auth3 + auth4 fuses these. Per the notes:

- *"All permissions apply to beings/roles only, and what they can SEE / DO / SUMMON. Never controlling space/matter access. Those are through Acts."*
- *"I-AM is first, and from him all permissions strangle as needed down the Being Tree. Each parent assigns and delegates the permissions they have to their child."*
- *"Should Roles be local down the ancestry they came from? Meaning the spaces they were created at and down."*
- *"This would be rolesGranted[], roleFlow. There would still be a global Role registry."*
- *"When a new RoleDO happens, the Actor decides if its global / whole reality, or privatized (only inherited or given away)."*

The endgame: **roles ARE the access control.** A being's `rolesGranted[]` is the list of roles they hold; each entry is anchored at a space. When the being acts, authorize walks their granted roles, finds the ones whose anchor is an ancestor of the target, and checks if any of those roles' `canX` lists permits the action. Stance properties (`arrival`/`owner`/`contributor`) survive but they become INPUTS into role grants (the cherub anoints new humans into the `angel` role *because* they registered, not because they're a member class).

## The unified model

### One source of authority

```
I-Am  →  Angel role (cansee:*, cando:*, cansummon:*, canbe:*)
  │
  │  grants angel role to:
  ↓
[cherub, birther, llm-assigner, role-manager, ...]  (seed delegates at heaven)
  │
  │  cherub anoints new humans into angel role at heaven (their parents in being-tree)
  ↓
[human operators]
  │
  │  humans author roles, grant them to children they birth, or to peers who travel
  ↓
[domain-specific roles: coder, factory-worker, dancer-llm, ...]
```

The I-Am's authority is bootstrap-axiomatic: it carries the implicit "I am that I am" angel role over the place root + everything below. Every other being's authority derives from a recorded grant chain rooted at the I-Am.

### Roles ARE permissions

A role's `canSee / canDo / canSummon / canBe` is no longer "documentation for the LLM frame" — it is the actual gate. The role registry becomes the single source of truth for what a being can do. Authorize replaces the layered stance-properties check with a single role-walk check.

A role like `coder`:

```js
{
  name: "coder",
  scope: "anchored",            // "anchored" | "global" — anchor scope determines reach
  description: "A being that writes and reviews code",
  canDo: [
    { action: "set-matter", description: "edit code files" },
    { action: "create-matter", description: "create new files" },
    { action: "branch:create-branch", description: "fork work" },
  ],
  canSee: ["place", "library"],
  canSummon: [
    { rel: "peer", pattern: "@coder*", description: "call another coder" },
    { rel: "delegate", pattern: "@code-reviewer", description: "ask for review" },
  ],
  canBe: ["release"],
  prompt: (ctx) => "...",
  origin: "live",
  ownerExtension: "treeos-base",
}
```

When a being summons `@coder:set-matter`, authorize runs:

1. **Find the actor's granted roles whose anchor is an ancestor of the target space** (or the actor's role is global-scope).
2. **For each candidate role, check if any `canDo` entry matches `set-matter`.**
3. **If at least one role grants the action, allow.** Otherwise deny.

No more `requires: { contributor: true }` rules in `qualities.permissions`. The role's `canDo: ["set-matter"]` IS the rule.

### rolesGranted on Being

```js
Being.qualities.rolesGranted = [
  {
    role:          "coder",
    anchorSpaceId: "<spaceId>",   // where this grant takes effect (and below)
    grantedBy:     "<grantorBeingId>",
    grantedAt:     "<iso timestamp>",
    expiresAt:     null,           // future: time-bound grants
  },
  { role: "human", anchorSpaceId: "<placeRootId>", grantedBy: "i-am", grantedAt: "..." },
  ...
]
```

Three traits:

- **Anchored.** Each grant is bound to a space. The role only takes effect at that space and below — auth walks the target's ancestor chain and checks if the role's anchor appears.
- **From-someone.** Every grant records who granted it. Replay can verify the grant chain back to I-Am.
- **Append-only.** Grants are facts. Revocation is a *revoke-role* fact, not an in-place deletion (mirrors how subscriptions work — register and cancel facts compose at fold time).

#### Duplicate grants from different grantors

Entries are unique by `(role, anchorSpaceId, grantedBy)`. If Alice and Bob both grant you `coder` at `/coders/`, you get TWO entries — each separately revocable. The being holds the role as long as at least one grant survives.

- `revoke-role({role, anchorSpaceId, grantedBy})` removes the matching tuple. Caller must be that `grantedBy` OR hold a strictly-broader role at the same anchor.
- After Alice revokes, Bob's grant stands; you still have coder.
- After both revoke, you lose coder.
- Re-grant after full revoke = a new fact, new entry, fresh `grantedAt`.

This preserves the proof-of-authority chain back to each individual grantor. Collapsing duplicates would lose the information that Bob's grant survived Alice's revoke.

#### Active-role resolution at moment-time

Today's `resolveActiveStack()` walks `qualities.roleFlow` and picks any role from the registry. After this change:

- Each clause's `when` is evaluated as today.
- If the `when` passes, the resolver checks: **does the being hold `clause.role` granted at the current position (or globally)?** Look up `rolesGranted` and walk the position's ancestors against each grant's `anchorSpaceId`.
- If granted: the clause wins.
- If not granted: SKIP — same as if the `when` failed. The next clause is tried.
- If the terminal fallback clause (the one with no `when`) also references an ungranted role: the resolver returns `null` and the moment fails loudly with `no granted role applies at this position`. No silent fallback.

The `defaultRole` field stays for now (drives the terminal clause for legacy realities) but no longer auto-grants anything. In the migration step, every being's `defaultRole` becomes an explicit grant at `homeSpace` so the existing flows continue working.

**Two code-level shortcuts stay** at the top of `authorize` — they are NOT grants:

- **I-Am bypass** — `identity?.beingId === I_AM` always succeeds. The bootstrap axiom.
- **Implicit arrival** — anonymous callers (no `beingId`) run under an implicit `arrival` role at the place root: `canSee` for the public surface, `canBe: ["birth", "connect"]` for registration. Stateless callers don't carry grants.

Every other being's authority flows through `rolesGranted`.

### Scope: global vs anchored

Per auth4 — *"When a new RoleDO happens, the Actor decides if its global / whole reality, or privatized (only inherited or given away)."*

- **`scope: "global"`** — The role is available reality-wide. A grant of a global role takes effect everywhere; `anchorSpaceId` is the place root. Used for system roles (angel, human) and for explicitly public roles.
- **`scope: "anchored"`** (default for new roles) — The role only takes effect at and below the anchor space. A coder granted at `<reality>/coders/` can act within that subtree but not outside it.

The scope is set when the role is authored (the `set-role` DO op gains a `scope` arg). Existing roles default to "anchored" with the place root as anchor — same as today's stance auth where heaven gates on `memberClasses: angel`.

### Anchor kind: space OR being

A grant anchors to one of two things — a **space** or a **being**. Roles can scope to positions (you're a coder at the coders space) OR to relationships (you're friends-with @alice). The auth walker checks both.

```js
Being.qualities.rolesGranted = [
  { role: "coder",  anchorSpaceId: "<spaceId>",  anchorBeingId: null, grantedBy: ..., grantedAt: ... },
  { role: "friend", anchorSpaceId: null,         anchorBeingId: "alice", grantedBy: "alice", grantedAt: ... },
]
```

Match rules:
- **Space anchor matches** when the target's spaceId equals `anchorSpaceId` OR is a descendant of it.
- **Being anchor matches** when the target's being equals `anchorBeingId` (right-stance `@being` for SUMMON / DO-against-being / BE).
- A grant entry has at most one anchor type populated (the other is null); both null is invalid (the role has nothing to anchor on).

Use cases:
- **Position roles**: coder at /coders/, factory-worker at /factories/widget-co/. Space-anchored.
- **Relationship roles**: friend-of-alice, customer-of-vendor, family-with-bob. Being-anchored.
- **Hybrid roles**: today space-anchored, tomorrow being-anchored — same role mechanism, different anchor.

### The `global` role — baseline for every being

A foundational role granted to **every authenticated being at birth** by their parent (cherub for new humans; the operator-being for sub-children). Carries the actions every being in this reality should have by default. Arrival is excluded — anonymous callers stay on their implicit read-only floor.

```js
{
  name: "global",
  scope: "anchored",
  description: "Baseline role every authenticated being carries. Customize per reality.",
  canDo: [
    { action: "move", description: "move yourself in space" },
    { action: "set-being:coord", description: "update your own coord" },
    { action: "set-being:position", description: "walk to another space" },
    // ... whatever the operator decides every being should be able to do
  ],
  canSee: ["place"],
  canSummon: [
    { rel: "self", pattern: "@cherub", description: "address the gate" },
  ],
  canBe: ["release"],
}
```

Anchored at the place root with reality-wide reach via descendants. **Customizable per reality** — operators edit the global role's canDo to define their baseline. Default seed-shipped global is conservative (move + see-self + release); operators expand it as they decide what "everyone here can do."

Term-collision note: the role NAME is `global` (carries the "every being gets this" meaning) but its SCOPE field is `"anchored"` (the grant goes at place root). The `scope: "global"` distinction is about how a grant reaches (no anchor required, reality-wide intrinsic); the `global` role uses normal anchored grants.

#### "Public" / "private" are implicit in the role's reach

Per auth3 — *"All permissions apply to beings/roles only, and what they can SEE/DO/SUMMON. Never controlling space/matter access. Those are through Acts."*

There is **no public/private property on a space**. A space is "public" if any granted role reaches it; "private" if no role does. The descriptor pipeline filters beings/matter/children at SEE-time — anything outside the actor's granted-role reach is simply not surfaced. The being literally doesn't load the SEE info for it. No flag, no gate-at-the-space; the role's reach IS the access surface.

The reach of a role comes from ONE of two mechanisms, depending on scope:

- **Anchored role** — the grant's `anchorSpaceId` (or `anchorBeingId`) IS the reach. A `coder` role granted at `/coders/` reaches `/coders/` and its descendants. The canX entries don't carry patterns — the anchor is the single source of truth for "where this role works." Asking each canX entry to also declare a pattern would create the "what if canDo's pattern disagrees with canSee's pattern" problem.

- **Global role** — by default reaches everywhere (no anchor). Optionally constrained by a top-level `reach` field on the role spec that lists where the role can act. Absent → true-global (e.g. the `angel` role). Present → reach restricted to those paths/IDs.

The canX entries stay simple: action names, op names, being-name patterns, operation names. They describe WHAT the role permits; the anchor or `reach` describes WHERE.

#### Role spec — final shape

```js
{
  name: "public-bot",
  scope: "global",                                          // "anchored" | "global"
  reach: ["/", "/public/**", "<spaceId-1>"],                // OPTIONAL, scope=global only
  description: "...",
  canSee:    ["place", "library"],                          // SEE op names (or "*")
  canDo:     [{ action: "set-matter" }, { action: "create-matter" }],
  canSummon: [{ pattern: "@coder*", description: "..." }],  // @being-name patterns
  canBe:     [{ operation: "release" }],
  prompt:    (ctx) => "...",
  origin:    "live",
  ownerExtension: "treeos-base",
}
```

Per field:
- **canSee** — list of SEE-op names (e.g. `"place"`, `"llm-chain"`, `"<ext>:<name>"`) or `"*"`. No patterns.
- **canDo** — list of `{action, description?}`. Action is the DO op name. No patterns.
- **canSummon** — list of `{pattern, intent?, description?}`. `pattern` is the BEING-name pattern (`@coder*`), NOT a space path.
- **canBe** — operation-only (`{operation, description?}` or bare string). BE acts on self; no positional gating inside canBe.
- **reach** — new optional field. Only meaningful when `scope: "global"`. Empty/absent → applies everywhere. Present → constrained to those paths/IDs.

#### Reach pattern vocabulary (the `reach` field only)

Small. Just enough for "this global role works at these specific places":

- `<exact-path>` — exact path match (e.g. `"/town/bench"`).
- `<spaceId>` — exact space-id match.
- `prefix/**` — subtree inclusion (e.g. `"/public/**"`).
- `/` — root.

No regex. No wildcards in names. No per-canX patterns. First match in the `reach` list means the role can act at the target.

#### The auth walk

```js
authorize({verb, target, action, intent, operation, identity}):
  if identity?.beingId === I_AM: return ok      // bootstrap axiom
  if no identity: apply implicit arrival floor   // anonymous read surface

  for each grant in identity.rolesGranted:
    role = getRole(grant.role)
    if not role: skip

    // Reach check — does this role reach the target?
    if role.scope === "anchored":
      // The grant's anchor is the reach
      if not targetReachableFromAnchor(target, grant): continue
    else if role.scope === "global":
      if Array.isArray(role.reach) && role.reach.length > 0:
        if not matchesAny(role.reach, target): continue
      // else: true-global, applies anywhere

    // canX check (action-only; no patterns inside canX)
    if verb === "see"    && permitsSee(role, target):                  return ok
    if verb === "do"     && permitsDo(role, action):                   return ok
    if verb === "summon" && permitsSummon(role, target.being, intent): return ok
    if verb === "be"     && permitsBe(role, operation):                return ok

  return deny
```

#### What a grant's anchor still means

For anchored roles, the grant's `anchorSpaceId` (or `anchorBeingId`) IS the reach. For global roles, the role's optional `reach` field is the constraint and the grant's anchor (typically the place root) is auxiliary.

In both cases the anchor also serves:

- **Identity for revoke** — `revoke-role` targets a specific `(role, anchor, grantor)` tuple. The anchor distinguishes one grant from another when the same role is granted to the same being from multiple grantors at different places.
- **Inheritance scope** — when the grantee births children, the child inherits the grant only up to the anchor's reach (a child of a coder granted at `/coders/` doesn't inherit coder into a sibling subtree if they later move there).
- **Provenance** — the anchor records WHERE the grant was made; combined with `grantedBy` it's a forensic trail.

### Who can grant a role: encoded as canDo

Per the user — *"even roles can only be given out by certain roles, completing the hierarchy."*

Each role declares its grantors through the **canDo entries on grantor roles**. For role X to be grantable by role Y, Y's canDo must include `grant-role:X` (or a wildcard prefix). No special "grantableBy" field on the role being granted — the gate lives on the grantor side.

Examples:

```js
// Cherub can grant human + arrival (registration flows).
cherub.canDo = [
  { action: "grant-role:human",   description: "register a new human at the place root" },
  { action: "grant-role:arrival", description: "..." },
  ...
]

// Angel (I-Am's role) can grant any role.
angel.canDo = [
  { action: "grant-role:*", description: "I-Am grants anything" },
  ...
]

// Coder can peer-grant coder.
coder.canDo = [
  { action: "grant-role:coder", description: "promote a peer to coder" },
]
```

Authorize check on `grant-role`:
1. Build the action key: `grant-role:<roleName>` from the grant's params.
2. Walk the caller's granted roles reachable at the grant's anchor.
3. Find any role whose canDo permits that action key (exact or wildcard).
4. If found, allow; otherwise deny with `FORBIDDEN`.

This closes the hierarchy: the I-Am can grant anything (angel canDo: `grant-role:*`); seed delegates can grant within their domain; humans can grant the roles they authored or that some other role permits them to hand out. The chain back to I-Am is structural.

The same pattern applies to `revoke-role:<roleName>` — revocation is governed by the symmetric canDo entry. Cherub can revoke human (canDo: `revoke-role:human`); angels can revoke anything (canDo: `revoke-role:*`).

### The travel rule (acquiring a role)

Auth3 — *"A factory worker can't just have a coder role. It would need to either: (a) travel to the coder space, and ask if it could join / be a part of its space, thus gaining the permission. (b) travel their, and ask coders if factory workers could have role at their space. (c) study on own, and make own 'Coder' role and matter, etc."*

This shape falls out for free:

- **(a) travel + join** — the being moves to the coder space; an existing coder runs `grant-role(target=<this being>, role="coder", at=<here>)`. Now the being has `coder` granted at that space.
- **(b) travel + ask** — same shape; the request goes through a SUMMON to a coder; the coder decides whether to grant.
- **(c) author own** — the being runs `set-role(name="my-coder", canDo=[...], scope="anchored")` at a space they own; they're automatically granted that role at that space.

No special machinery needed beyond grant-role + the existing set-role op.

### Authorize collapses to a role-walk

```js
async function authorize({ identity, verb, target, action, intent, operation }) {
  if (identity?.beingId === I_AM) return { ok: true, role: "i-am" };

  // 1. Load actor's granted roles + the actor's roleflow active role.
  const acted = await listGrantedRoles(identity.beingId);

  // 2. Filter to roles whose anchor reaches the target.
  const ancestors = await getAncestorChain(target.spaceId, branch);
  const ancestorIds = new Set(ancestors.map(a => String(a._id)));
  const reachable = acted.filter(g =>
    g.scope === "global" || ancestorIds.has(g.anchorSpaceId)
  );

  // 3. For each role, check if its canX permits this verb+action.
  for (const grant of reachable) {
    const role = getRole(grant.role);
    if (!role) continue;
    if (permits(role, verb, action, intent, operation)) {
      return { ok: true, role: grant.role, anchor: grant.anchorSpaceId };
    }
  }
  return { ok: false, reason: "no granted role permits this action at this position" };
}

function permits(role, verb, action, intent, operation) {
  if (verb === "see")    return matchAny(role.canSee, "*");
  if (verb === "do")     return matchAny(role.canDo, action);
  if (verb === "summon") return matchAny(role.canSummon, `@${target.being}`, intent);
  if (verb === "be")     return matchAny(role.canBe, operation);
  return false;
}
```

The `matchAny` helper does the wildcard + prefix matching from today's `scoreKey`. The four-layer authorize collapses to one walk over the actor's granted roles.

## Schema changes

### Being

- **Add:** `qualities.rolesGranted: Array<{role, anchorSpaceId, grantedBy, grantedAt, expiresAt?}>`
- **Retire:** `defaultRole` field stays for now (still drives roleFlow's fallback clause) but doesn't gate auth. Future cleanup: replace with first granted role.
- **Retire:** `qualities.roleFlow` keeps its current shape; the active-role pick at moment-time still walks the flow. The flow's chosen role must appear in `rolesGranted` or it falls back.

### Role spec (registry)

- **Add:** `scope: "global" | "anchored"` (required on registration; defaults to `"anchored"`)
- **Add:** `ownerExtension: string` (already implicit via origin; promoting to first-class)
- **Existing:** `canSee` / `canDo` / `canSummon` / `canBe` keep their shape. Their semantics shift from "documentation for the LLM frame" to "the authorization gate." Frame builder still reads them for the prompt.

### Stance properties

`deriveStanceProperties` retains its surface — `arrival` / `owner` / `contributor` / `memberClasses` still get derived. But authorize stops consulting them as gates. They become INPUTS for role grants (e.g. cherub anoints new humans into the `angel` role *because* their stance properties show they registered).

### Heaven / angels

The `angel` memberClass retires. Replaced by `angel` ROLE granted at heaven. Seed delegates and human operators register the angel role at heaven via `grant-role`. Same result, one mechanism.

### qualities.permissions retires

The `qualities.permissions.<verb>.<keyParts> = { requires: ... }` namespace retires. Existing rules get translated to role definitions during the migration. After the migration, this namespace is empty and the read path is removed from authorize.

## New DO ops

### `grant-role`

```js
do(targetBeing, "grant-role", { role: "coder", anchorSpaceId: "<id>", expiresAt? })
```

- Caller must hold a role at `anchorSpaceId` (or above) that includes `canDo: [{action: "grant-role", description: "..."}]`.
- Target being's `qualities.rolesGranted` gains the entry (via `set-being` fact under the hood — the audit fact is the grant record).
- If the grantor doesn't hold the role they're granting, the op refuses. (Exception: if the role's `canBe: ["grant"]` permits this grantor to lend it out — but that's a finer point; default refuses.)

### `revoke-role`

```js
do(targetBeing, "revoke-role", { role: "coder", anchorSpaceId: "<id>" })
```

- Caller must be the original grantor OR hold a strictly-broader role at the same anchor.
- Appends a `revoke-role` fact; the fold drops the matching grant from `rolesGranted`.

### `set-role` (existing — gains `scope`)

```js
do(target, "set-role", { name, canSee, canDo, canSummon, canBe, prompt, scope: "anchored" })
```

The op runs an **explicit canDo check** before authoring — no back door:

1. Resolve the target space (where the role is being authored).
2. Walk the caller's `rolesGranted` to find roles reachable at that target.
3. **Required:** at least one of those roles must have `canDo: [{action: "set-role", ...}]`.
4. If not, refuse with `FORBIDDEN`. The travel rule from auth3 — "can't just have a coder role" — generalizes: can't just author one out of thin air either.

If permitted, the op emits TWO facts atomically:
- `do:set-role` — the role definition lands as a Fact (creates the role in the registry + the `./roles/<name>` mirror).
- `do:grant-role(role=<newRole>, anchorSpaceId=<targetSpace>, grantedBy=<author>)` — the author is auto-granted the role at the target space.

Scope-specific gates on the canDo check:
- `scope: "global"` requires the author to hold a role with `canDo: ["set-role"]` reachable from the place root (so authoring a global role needs reality-wide permission — typically the angel role).
- `scope: "anchored"` requires the same canDo at the target space (or above).

Without this gate a coder could author `super-admin` with canDo: `["*"]` and self-grant; the gate enforces that role authorship needs an existing role to back it.

### `move-role` (future, deferred)

Per auth3 — *"Then roles would be relocated or copied to other spaces upon a receiving Being's permission... and, thus, the Beings permissions."* — A future op to relocate a role's anchor (re-anchor at a different space, transferring its reach). Deferred for now.

## Migration

Existing realities have:

- `Being.defaultRole = "<name>"` + `qualities.roleFlow = [...]`
- `Space.qualities.permissions = {...}` rules (stance-based)
- `Space.members.angel = [<beingIds>]` (heaven angel class)

The migration pass:

1. **Seed-being grants.** Genesis already births I-Am + seed delegates. Append a grant moment: I-Am grants the `angel` role at heaven to every seed delegate (cherub, birther, llm-assigner, etc.) at the moment of birth. Same chain shape, slightly different facts.

2. **Heaven angel class → angel role grants.** A one-shot script reads `Space.members.angel` on heaven, emits a `grant-role(angel, anchor=heaven)` per member, then unsets the angel class. After this lands, the `memberClasses` derivation path can stop reading the angel class.

3. **defaultRole → rolesGranted seed.** For each being with `defaultRole`, emit a `grant-role(<defaultRole>, anchor=<homeSpace>, grantedBy=I-Am)` so their existing default role appears in their granted list. Without this they wake up with zero granted roles.

4. **qualities.permissions translation.** For each `qualities.permissions.<verb>.<keyParts> = { requires: { memberClasses: { includes: "X" } } }` rule, ensure a corresponding role exists with `canX: [<keyParts>]` and that members of class X are granted that role at the space. Most existing rules are seed defaults; a handful per reality. The migration script enumerates and converts.

5. **Cleanup.** After conversion, `qualities.permissions` namespace is empty. Authorize stops reading it. Stance-property derivation simplifies (no more memberClasses gating).

The whole migration is fact-shaped. Replay re-applies it; on a fresh boot the genesis sequence is unchanged but emits the grants as part of the I-Am's autobiography.

## Frontend

### Being inspector

The role section (above the existing DO actions form) gains:

- **Granted roles list** — render `rolesGranted[]` with anchor space + grantor + when. Self-only edit affordances appear when `session.beingId === b.beingId`.
- **Grant a role** — when the session being holds `canDo: ["grant-role"]` reachable from the current position, show a form to grant one of their roles to this being at this position.
- **Revoke** — for grants the session being made, a revoke button.

### Role manager panel

- **Existing roles list** gets a `scope` column (global / anchored) + the anchor space for anchored roles.
- **Create new role** form gains a `scope` selector.
- **Granted-to view** — show, for a selected role, the list of beings currently holding it (read from being projections with anchor-filter).

### Chat panel

Already shows the LLM that'll respond. After this lands, it can also show:

- **The role under which the receiver will run** (derived from their roleFlow + grants intersection at the asker's stance).
- **Whether the asker's stance permits the call** — a live authorize preview.

## Implementation arc

### Pass 1 — schema + I-Am bootstrap

- Add `Being.qualities.rolesGranted` shape (no schema change; Mixed accepts it).
- Add `scope` to role registry. Default to `"anchored"`. Heaven-bound roles (angel) default to `"global"`.
- Add `grant-role` + `revoke-role` DO ops. The grantor's own grant chain is the auth gate.
- Genesis: after birthing seed delegates, emit `grant-role(angel, anchor=heaven)` per delegate. The I-Am is the grantor on every one of these.

### Pass 2 — authorize swap

- Add a feature flag: `useRoleAuth: bool` on `internalConfig`. When false, current authorize stands; when true, the new role-walk runs.
- Implement the role-walk authorize alongside the existing one. Both produce `{ok, reason, role?}`.
- A parallel verifier walks both paths on every call and logs mismatches. Run boot + regression; surface every case where they disagree.

### Pass 3 — flip + migrate

- Convert existing realities (seed migration step): translate `qualities.permissions` rules + `members.angel` into `rolesGranted` entries.
- Flip `useRoleAuth: true`.
- Run boot + regression. Address mismatches.

### Pass 4 — retire the old surface

- Delete the qualities.permissions read path from authorize.
- Delete `members.angel` / memberClass derivation. Stance properties keep `arrival` / `owner` / `contributor` for use as INPUTS into role-grant decisions (cherub still reads "did this human just register" to anoint them angel).
- Update FACTORY.md / PERMISSIONS.md / CLAUDE.md.

### Pass 5 — frontend

- Update role-manager-panel: scope picker, grants list, revoke affordance.
- Update being inspector: granted-roles section.
- Update chat panel: receiver-role indicator.

### Pass 6 — verifier + final regression

- New verifier `verify-roles-are-auth.js`: bootstrap an I-Am → cherub → human → coder grant chain; verify each step's authorize result; verify revoke removes the grant; verify scope (anchored vs global) reaches the right spaces.
- Run full regression: 283-ish suites should pass.

## Out of scope

- **Cross-world role propagation** — a granted role doesn't automatically transfer when the being walks into a foreign reality. Deferred to the cross-world doctrine.
- **Time-bound grants** — `expiresAt` is on the schema but not enforced yet; a future pass adds the expiry check.
- **Composite roles via stacking** — `roleComposer.composeStack` keeps working for cognition-frame composition. The authorize walk treats stacked roles as a union (any role in the stack permits → allow). No new primitive.
- **Role versioning** — when a role's canDo changes after being granted, the granted role uses the LATEST definition. Future versioned grants would freeze the canDo at grant-time. Out of scope.
- **Permissions on Space/Matter directly** — auth3 is explicit: *"Never controlling space/matter access. Those are through Acts."* — so this stays. The space/matter doesn't have its own permission gate; the only gate is "did the actor's role permit this action."

## Pinned doctrine (for FACTORY.md / PERMISSIONS.md after Pass 4)

> **Roles are auth.** A being acts under a role; the role's canSee / canDo / canSummon / canBe IS the permission gate. There is no parallel "permissions" namespace. The role registry is authoritative.
>
> **Grants flow down the being-tree, rooted at I-Am.** Every granted role carries `{role, anchorSpaceId, grantedBy, grantedAt}`. The grant chain back to I-Am is the proof of authority.
>
> **Roles are spatial.** Each grant is anchored at a space. The role's reach is that space and its descendants (or reality-wide if the role's scope is `"global"`).
>
> **Acquiring a role is an act, not a status check.** A being holds a role because someone granted it OR because they authored it themselves at a space they owned. Authorization never derives roles from stance properties.

## Verification criteria

- ✓ I-Am can do anything anywhere (bootstrap angel role at the place root, scope:global).
- ✓ Cherub can do BE birth/connect/release because the I-Am granted it the angel role at heaven.
- ✓ A new human registers via cherub; cherub grants them the `human` role at the place root.
- ✓ Human authors `coder` role at `<reality>/coders/`; they get auto-granted coder at that space.
- ✓ Human births a child being; the child has zero granted roles by default. They can SEE the place root (default human role's canSee includes "place") but cannot DO anything until granted a role.
- ✓ Parent grants child the human role at place root; child can now do everything a human can.
- ✓ Coder grants a child being the coder role at the coders space; the child can do coder things in coders/ but not outside.
- ✓ A being not granted angel role cannot grant angel role to anyone else (the grant op's own canDo check refuses).
- ✓ Revoke removes the grant; subsequent calls under that role refuse.
- ✓ Replay: drop the DB, replay the chain, every authorize result is identical.
