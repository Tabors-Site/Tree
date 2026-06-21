# Roles Are Auth — Unifying Stance Auth + Role Registry

> *Source notes: `philosophy/CROSS-WORLD/auth3.jpg` + `auth4.jpg` — "All beings who are owner/contributor in heaven have angel role. I-AM is first, and from him all permissions strangle as needed down the Being Tree. Each parent assigns and delegates the permissions they have to their child."*

> **The sections below this header trace the design's evolution. The doctrine the substrate actually implements is summarized in the "Final doctrine" section right after this. Read that section first — earlier sections preserve the thinking for context.**

---

## Final doctrine (the shape we build)

### One sentence

**Roles are auth. Every role-in-effect lives on a space's `qualities.roles[<name>]`; grants on beings reference the role by name + the space it's anchored at; authorize walks the grant's anchor up the qualities ancestor chain to find the spec, then applies the role's canX after a reach check.**

### Single-gate doctrine (pinned)

**The role-walk is THE gate. Every action is gated by the caller's granted roles. There is no bypass mechanism.**

When an action needs to be universally available — like "every being can request acquisition" — the substrate expresses that as a `canDo` entry on an open role that every being holds (today: `global`, granted to every being at birth). The substrate's gating IS the role system; they are not separate.

Any field or flag that bypasses the role-walk introduces parallel gating and erodes the single-gate property. Past examples we explicitly retired:

| Bypass | Why we retired it | What replaced it |
|---|---|---|
| `qualities.permissions` namespace | Parallel gate growing alongside roles | Roles host on `qualities.roles`; canX is the contract |
| `claimedByPublic` branch in `roleAuth.js` | Hardcoded special-case for one being | `acquisition.autoOnEntry` on roles; visitors get a grant via the regular path |
| `op.skipAuthorize` field (briefly added 2026-06-10, retired same-day) | Generic bypass for "ops that don't fit the gate" | Universal capabilities live on `global.canDo`; every being holds `global` |

**Recognition criterion**: if an op's authorization story reads "the verb gate is skipped because…" — that's parallel gating. The right answer is always "what role expresses this capability, and which beings hold it." If everyone needs the capability, it goes on `global`. If a specific class needs it, it goes on a role granted to that class.

### Four orthogonal pieces

| Lives on | Field | What it carries |
|---|---|---|
| **Space** | `qualities.roles[name] = {canSee, canDo, canSummon, canBe, reach?, ...}` | The role's spec. Hosted at the space where it was authored. |
| **Being** | `qualities.rolesGranted = [{role, anchorSpaceId, grantedBy, grantedAt}]` | The grants the being holds. Travel with the being. |
| **Being** | `qualities.roleFlow = [{when, role}, ...]` | Which held role to PLAY at moment-time. |
| **Role spec** | `role.reach: [path-pattern, ...]` | Optional. Path filter that adjusts the default "host + descendants" coverage. |

Each piece does one job. Beings carry their grants everywhere; the grants become active only when their role's reach covers the current target. Movement never strips a grant — just makes it contextually applicable or not.

### Hosting (where roles live)

A role lives on the `qualities.roles` of the space where it was authored. That's the **host**. The role naturally reaches the host + all descendants via the qualities ancestor inheritance — no extra storage needed.

Foundational seed roles:

| Role | Hosted on | Implicit reach |
|---|---|---|
| `angel` | heaven (`<story>/.`) | heaven + descendants (system spaces) |
| `global` | story root (`<story>/`) | the whole story |
| `human` | story root | the whole story |
| `arrival` | story root (implicit floor) | the whole story |
| `cherub` | story root | the whole story |
| `birther` / `llm-assigner` / `role-manager` / ... | story root | the whole story |
| `coder` (operator-authored) | wherever they author it (e.g. `/coders/`) | host + descendants |

There is **no `scope: "global" | "anchored"` distinction**. There's just "where it lives." A role hosted at the story root reaches everywhere because the story root is everyone's ancestor.

### Reach — the add/remove knob

By default a role reaches its host + all descendants. The optional `reach` field on the role spec adjusts this. Single ordered list, bash-style `!` prefix for exclusions:

```js
reach: [
  "/docs/coding/**",      // ADD this subtree (lateral extension outside host's descendants)
  "!/coders/legacy/**",   // REMOVE this subtree from default coverage
  "!/coders/sandbox",     // REMOVE this specific space
]
```

**Default base**: implicit `host/**` (host + all descendants). The reach list **adjusts** the base — additions extend, `!` entries carve out. Patterns are evaluated in order; later entries win on conflict.

To strictly limit coverage to specific spaces (ignore default descent):

```js
reach: [
  "!**",                       // strip the default base (no descent)
  "/coders/widget-team",       // only this one space
  "/coders/docs/**",           // and this subtree
]
```

Pattern vocabulary (small):
- `<exact-path>` — exact match (`"/town/bench"`)
- `<spaceId>` — exact space-id match
- `prefix/**` — subtree (any depth below)
- `prefix/*` — direct children only
- `**` — wildcard (everything; useful with `!` to strip default)
- `!<pattern>` — exclude

### Ownership is foundational; roles are delegated

Two parallel authority mechanisms work together:

- **`members.owner` of space S → implicit authority over S + descendants.** No role grant needed. You own the space, you can do anything in it: author roles, install/grant/revoke, edit qualities, manage members, etc.
- **Granted roles → delegated authority.** Owners grant slices of their authority to others via `grant-role`; grantees can only do what the role's canX permits within the role's reach.

The auth walk has an owner-check step BEFORE the role-walk:

```
authorize:
  1. I-Am bypass                                (bootstrap axiom)
  2. SEE on .discovery                          (pre-identity surface)
  3. Anonymous → arrival floor                  (implicit arrival role)
  4. Owner-check: actor in members.owner of      ← step 4
     target's space or any ancestor → ALLOW
  5. Role-walk (qualities.rolesGranted)         (delegated authority)
  6. Deny
```

When a human is birthed, cherub sets `members.owner = [<newBeingId>]` on their home space — they own their home and everything under it. Outside their home they need granted roles (the `human` role gives broad access by default; operators narrow it as the story matures).

### The `@public` being — implicit commons-role for visitors

Every story ships a seed delegate named `public`. Public is structurally a being but never acts: empty `canSee`/`canDo`/`canSummon`/`canBe`, empty `triggerOn`, no-op call handler. It exists for ONE purpose — to be the recipient of ownership transfers.

When a space owner transfers `members.owner` to public:

```js
do(<spaceAddress>, "set-owner", { beingId: "<publicBeingId>" })
```

The space becomes a forever-public commons. **Every visitor walking into that subtree is treated as if they hold an implicit `public-commons` role.** Authorize's role-walk has a Public-commons step AFTER explicit grants:

```
authorize:
  1. I-Am bypass
  2. SEE on .discovery
  3. Anonymous → arrival floor
  4. Owner-check: actor ∈ members.owner of any ancestor → ALLOW (private)
  5. Explicit role-walk over qualities.rolesGranted
  6. Public-commons: target sits in a public-owned subtree → APPLY
     the seed-shipped commons role's canX (see + move + create-space +
     create-matter + call @cherub + release). MATCH → ALLOW.
  7. Deny
```

The commons role is **not granted as a fact** — it's a derived, implicit grant for every visitor at every public-owned space. Visible in the authorize decision (returned `role: "public-commons"`); not stored on the being.

Seed-shipped `public-commons` canX (the "basic things" floor):

```js
{
  canSee:    ["*"],
  canDo: [
    "move", "set-being:coord", "set-being:position",
    "create-space", "create-matter",
  ],
  canSummon: [{ pattern: "@cherub" }],
  canBe:     [{ operation: "release" }],
}
```

Operators wanting a richer commons surface author a real role on the public-owned space's `qualities.roles` (those flow through the role-walk above; the public-commons step is the floor).

**The permanence is structural, not policed**: public has no cognition, no canDo, no handler. There's no actor that could ever sign a `set-owner` removing itself. The silence IS the lock.

**Recovery paths**:
- **Branch the timeline** from before the transfer happened. Same shape as any substrate mistake recovery. The realistic path.
- **I-Am owns public.** As an extremis safety hatch, I-Am holds public's own `members.owner` slot — so an I-Am-class operator could `remove-owner` on a public-owned space. Doctrinally available, but a high bar.

Edge cases:
- **Hybrid ownership** (Public + a real owner): the real owner's authority still works — they can revoke things, install roles, etc. Public's seat just adds the commons-role floor for visitors.
- **Public-only ownership**: nobody can ever wrest it back without timeline branching or I-Am intervention.
- **Custom commons surface**: an operator authors `qualities.roles.commons-visitor` on the public-owned space with their own canX. Granted visitors get its full reach; non-granted visitors fall back to the seed-shipped public-commons.
- **Descendants inherit** the Public-commons rule via the owner-check ancestor walk — anything below a public-owned space is also commons.

### Contributors retire as a gate

Under roles-are-auth the `members.contributor` class (and any custom member class) is bookkeeping only — it does NOT gate authorize. Owners model "secondary owners" as roles with the appropriate canDo (set-role, grant-role:*, create-space, etc.). One mechanism — roles + ownership — covers everything the old member-class system did, and operators can author whatever shape they want without the substrate baking in second-class authorities.

### be:birth doctrine — two paths to mint a being

Per the seed/RolesAreAuth.md flow + the be:birth refactor: there are TWO ways a new being comes into existence.

**Path A — Delegated mint via call:mate (the registration flow).**

```
arrival → call @cherub:mate → cherub mints the new being
       (the caller RECEIVES the new being as their own)
```

The arrival role's only outward capability is `call @cherub:mate`. Cherub's `canSummon` declares `as: "receiver"` for `intent: "mate"` — that's the contract that says "this role accepts call:mate from anonymous arrivals." Cherub's handler mints the new being with the human role + the visitor's chosen credentials, grants `global` + `human` at the place root, and binds the session.

Mirror on `@birther`: any authenticated being can call `@birther:mate` to commission a child being. Same shape, just from an authenticated caller instead of anonymous.

**Path B — Direct be:birth (the operator flow).**

```
human or angel → be:birth (self) → child being is parented to them
```

A being with `canBe: ["*"]` or `canBe: ["birth"]` calls `be:birth` directly on their own identity. The target IS the actor — "I birth a being." Available only to humans and angels by default; other roles use Path A.

The two paths produce the same outcome (a new being parented to the requester); they differ in WHO drives the mint. Delegated mint is the only path for anonymous visitors (they have no `canBe`); direct birth is available to humans/angels who don't need a delegate.

### `canSee` semantics — `*` permits raw position SEE; everything else is op-only

Per the doctrine, the role's canX is the gate. `canSee` is a list of SEE op names with an explicit "all-access" wildcard:

| `canSee` | What it permits |
|---|---|
| `["*"]` | Can call any registered SEE op AND see raw position descriptors (`client.see(address)`) |
| `["place"]` | Can call `see("place")` only. Raw position SEE REFUSES. |
| `["arrival-view"]` | Can call `see("arrival-view")` only. |
| `["place", "library"]` | Can call those two ops; raw position SEE refuses. |
| `[]` | Cannot SEE anything |

The seed-shipped `arrival` role hosts `canSee: ["arrival-view"]` — anonymous visitors get one filtered window into the story (root layout + cherub only, via the `arrival-view` SEE op). They cannot enumerate beings, see matter, or descend into child spaces.

`human` (the root-founder temporary role) and `angel` (super-sudo) carry `["*"]`. Other roles use named ops (the canonical `place` op covers most navigation needs).

### Authorize lookup — walk the grant's anchor for the spec

```js
async function authorize({identity, verb, target, action, intent, operation, branch}):
  if identity?.beingId === I_AM: return ok           // bootstrap axiom
  if !identity?.beingId: apply implicit arrival floor // anonymous read

  for each grant in identity.rolesGranted:
    // Look up the role spec by walking the grant's anchor up the qualities chain.
    spec = await getRoleSpec(grant.role, grant.anchorSpaceId, branch)
    if !spec: continue                               // role doesn't exist where anchored

    // Did the host find an ancestor that reaches target?
    if !roleReachesTarget(spec, host, target, branch): continue

    // canX gate (action-only; no patterns inside canX)
    if matches(spec, verb, action, intent, operation): return ok

  return deny

async function getRoleSpec(name, anchorSpaceId, branch):
  // Walk anchorSpaceId up; first ancestor with qualities.roles[name] is the host.
  for ancestor in walkAncestors(anchorSpaceId, branch):
    if ancestor.qualities.roles?.[name]:
      return { spec: ancestor.qualities.roles[name], host: ancestor._id }
  return null

function roleReachesTarget(spec, host, target):
  // Default coverage: host + descendants
  let covered = isAtOrBelow(target, host)
  if !spec.reach: return covered
  // Apply patterns; later wins
  for pat in spec.reach:
    if pat.startsWith("!"):
      if matchPattern(target, pat.slice(1)): covered = false
    else:
      if matchPattern(target, pat): covered = true
  return covered
```

### Grants travel with the being

A grant is a fact on the being's reel: `do:grant-role` with `{role, anchorSpaceId, grantedBy, grantedAt}`. The being's reducer folds these into `qualities.rolesGranted`. The grant persists across movement; it just becomes inert at positions outside its role's reach.

Visit `/coders/`, get granted coder anchored there → walk away to `/marketing/` → coder grant is still on you but inert (no coverage) → walk back → active again.

`revoke-role` emits `do:revoke-role`; the reducer drops the matching `(role, anchor, grantor)` tuple.

### roleFlow integrates cleanly

A `roleFlow` clause picks a held role given moment context. Each clause is now filtered by three checks:

1. `when` condition matches (today's behavior)
2. The being has a grant of that role (in `qualities.rolesGranted`)
3. The grant's role spec reaches the being's current position

Failing any of the three → skip the clause. Position changes naturally rotate the active role. No re-authoring needed.

If no clause produces a held + reaching role, the moment fails loud (`no granted role applies at this position`). No silent fallback.

### Authoring a role — `set-role` writes to a space

`set-role(targetSpace, name, {canSee, canDo, canSummon, canBe, reach?, description?})` writes the spec into `targetSpace.qualities.roles[name]`. The targetSpace IS the host.

Gate: caller must hold a role at targetSpace (or above) whose canDo includes `set-role` (or `*`). The "travel rule" of auth3 — can't author a role at a space you have no authority over.

Effect:
- The fact is `do:set-role` with target being the space (kind: "space", id: targetSpace) and params carrying the spec.
- The space reducer folds this into `qualities.roles[name]`.
- The author is auto-granted the new role at that space (separate `grant-role` fact emitted in the same moment).

### The registry retires as an auth source

Today's `REGISTRY` map in `seed/present/roles/registry.js` retires from the authorize path. It becomes a **template shelf** — a library of role specs operators or extensions can install onto spaces. Nothing about this registry gates anything by itself; it's just curated content.

`getRole(name)` from the registry stays for cognition-frame use (the LLM prompt builder reads role specs by name). The authorize path uses `getRoleSpec(name, anchorSpaceId, branch)` which walks space qualities.

For extension-shipped role TEMPLATES, the extension manifest declares `provides.roles[]` as today; the loader registers them as templates. Operators decide which spaces to install them at via `set-role` (or a new `install-role`) ops.

### Foundational seed roles — genesis installs them onto spaces

Genesis sequence change:

```js
// Today: roles live in REGISTRY only
registerRole("angel", angelRole, "seed");
registerRole("global", globalRole, "seed");
// ...

// Tomorrow: roles are templates + installed-on-spaces
saveTemplate("angel", angelRole, "seed");        // template shelf
saveTemplate("global", globalRole, "seed");
// ...

await installRoleOnSpace(heaven,        "angel",  angelRole, I_AM);
await installRoleOnSpace(storyRoot,   "global", globalRole, I_AM);
await installRoleOnSpace(storyRoot,   "human",  humanRole,  I_AM);
await installRoleOnSpace(storyRoot,   "cherub", cherubRole, I_AM);
// ... all the seed delegates' roles installed on story root
// (cherub & friends operate story-wide)
```

`installRoleOnSpace(space, name, spec, identity)` emits `do:set-role` on the target space.

The bootstrap grants (I-Am grants angel to seed delegates) stay the same — the grant references the role by name + anchorSpaceId (now heaven for angel-anchored grants).

### Frontend — three panels fall out

| Panel | What it shows |
|---|---|
| **Place panel** (current position) | Walks ancestors collecting all `qualities.roles[*]` → renders "roles in effect here" labeled by host space. Below: viewer's `qualities.rolesGranted` filtered to grants whose role reaches here, with canX they unlock. Below that (for space owners): "Author role here" — opens set-role form anchored at this space. |
| **Story tab** | SEE story-root's `qualities.roles` — the foundational roles for this whole world. For angels: forms to author new global-reach roles, edit canX, etc. |
| **Heaven tab** (or sub-section) | SEE heaven's `qualities.roles` (`angel` + any heaven-only system roles). |
| **Template library** | SEE the registry — the shelf of available role specs to install on spaces. "Install at <space>" buttons. |

### What retires

- `scope: "global" | "anchored"` field on role spec → goes away. Every role just has a host.
- Top-level `reach` validation in registry that demands scope=global → goes away. Any role can declare reach.
- `qualities.permissions.<verb>.<keyParts>` namespace → already gone (Pass 2).
- `Space.members.angel` derivation as an authorize gate → already gone (Pass 2).
- `registerDefaultPermissions` / `seedDefaultStancePermissions` → already throw (Pass 2).

### What stays

- I-Am bypass (code-level bootstrap axiom).
- Implicit arrival floor (anonymous callers run under arrival role's canX).
- Extension scope gate (orthogonal: refuses ext:op at blocked positions).
- `qualities.rolesGranted` on Being (the grant list, fact-folded).
- `qualities.roleFlow` on Being (active-role pick at moment-time, now filtered by grants + reach).
- The role registry/template shelf for cognition-frame use and operator-discovery of installable roles.

### Pinned principles (for FACTORY.md / PERMISSIONS.md)

> **Roles are auth.** A being acts under a role; the role's canX IS the permission gate. There is no parallel `qualities.permissions` namespace.
>
> **Roles live where they're authored.** Every role-in-effect is hosted on a space's `qualities.roles`. Inheritance flows down via the normal qualities ancestor walk.
>
> **Reach adjusts default coverage.** Default = host + descendants. The optional `reach` field on the role can ADD lateral extensions or EXCLUDE specific subtrees. One field, two directions.
>
> **Grants travel with the being.** A grant fact lives on the being's reel. Movement never strips a grant — just makes it contextually inert when the role's reach doesn't cover the current position.
>
> **The space tree IS the authority tree.** Author a role at the space whose subtree you want it to govern. Higher hosts override lower (a parent's role reaches all children); children can stack additions or local-shadow the same name, but can't erase ancestor authority.
>
> **The grant chain back to I-Am is the proof of authority.** Every grant records `grantedBy`. Replay can verify any being's authority by walking grant facts back to a chain rooted at the I-Am.

---

## Context

Today the substrate has **two systems that look related but aren't actually wired together**:

1. **Stance auth** — `seed/ibp/authorize.js` walks `qualities.permissions.<verb>.<keyParts>` on the target's ancestor chain. The `requires:` block matches against stance properties (`arrival`, `owner`, `contributor`, `memberClasses`, etc.) derived from the caller's relationship to the position. The keyParts INCLUDE role-name strings (e.g. `call:@cherub:birth`) but those strings are just names — authorize never looks them up in the role registry.

2. **The role registry** — `seed/present/roles/registry.js`. Each role declares `canSee` / `canDo` / `canSummon` / `canBe`. These are used at moment-time to build the LLM frame (the prompt's capability list) and to dispatch the call handler. They are NOT consulted by authorize.

This is the load-bearing smell. A role's `canDo: ["set-config"]` is documentation for the LLM — it tells the model "you have this affordance" — but it doesn't actually grant the underlying permission. Authorization gates on whether the caller is a `contributor` of the target space, not on whether their role has `set-config` in its canDo list. Add a new role with canDo containing "set-config" and nothing changes downstream.

The doctrine you sketched in auth3 + auth4 fuses these. Per the notes:

- *"All permissions apply to beings/roles only, and what they can SEE / DO / CALL. Never controlling space/matter access. Those are through Acts."*
- *"I-AM is first, and from him all permissions strangle as needed down the Being Tree. Each parent assigns and delegates the permissions they have to their child."*
- *"Should Roles be local down the ancestry they came from? Meaning the spaces they were created at and down."*
- *"This would be rolesGranted[], roleFlow. There would still be a global Role registry."*
- *"When a new RoleDO happens, the Actor decides if its global / whole story, or privatized (only inherited or given away)."*

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

When a being calls `@coder:set-matter`, authorize runs:

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
    // No expiry field. Wall-clock expiry is a human-time concept the
    // story has no clock for; a grant lasts until revoked. Time-bound
    // grants arrive with STORY-time (a being's moments / reel seq /
    // harmony beats), enforced at the role-walk like everything else.
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

Per auth4 — *"When a new RoleDO happens, the Actor decides if its global / whole story, or privatized (only inherited or given away)."*

- **`scope: "global"`** — The role is available story-wide. A grant of a global role takes effect everywhere; `anchorSpaceId` is the place root. Used for system roles (angel, human) and for explicitly public roles.
- **`scope: "anchored"`** (default for new roles) — The role only takes effect at and below the anchor space. A coder granted at `<story>/coders/` can act within that subtree but not outside it.

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
- **Being anchor matches** when the target's being equals `anchorBeingId` (right-stance `@being` for CALL / DO-against-being / BE).
- A grant entry has at most one anchor type populated (the other is null); both null is invalid (the role has nothing to anchor on).

Use cases:
- **Position roles**: coder at /coders/, factory-worker at /factories/widget-co/. Space-anchored.
- **Relationship roles**: friend-of-alice, customer-of-vendor, family-with-bob. Being-anchored.
- **Hybrid roles**: today space-anchored, tomorrow being-anchored — same role mechanism, different anchor.

### The `global` role — baseline for every being

A foundational role granted to **every authenticated being at birth** by their parent (cherub for new humans; the operator-being for sub-children). Carries the actions every being in this story should have by default. Arrival is excluded — anonymous callers stay on their implicit read-only floor.

```js
{
  name: "global",
  scope: "anchored",
  description: "Baseline role every authenticated being carries. Customize per story.",
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

Anchored at the place root with story-wide reach via descendants. **Customizable per story** — operators edit the global role's canDo to define their baseline. Default seed-shipped global is conservative (move + see-self + release); operators expand it as they decide what "everyone here can do."

Term-collision note: the role NAME is `global` (carries the "every being gets this" meaning) but its SCOPE field is `"anchored"` (the grant goes at place root). The `scope: "global"` distinction is about how a grant reaches (no anchor required, story-wide intrinsic); the `global` role uses normal anchored grants.

#### "Public" / "private" are implicit in the role's reach

Per auth3 — *"All permissions apply to beings/roles only, and what they can SEE/DO/CALL. Never controlling space/matter access. Those are through Acts."*

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
- **canSummon** — list of `{pattern?, intent?, as?, description?}`. Each entry declares a call edge this role participates in. The `as` field discriminates which side:
  - `as: "actor"` (default if absent) — caller-side: this role can SEND a call matching the entry's `pattern` + `intent`. Authorize consults these on the CALLER'S role at dispatch.
  - `as: "receiver"` — receiver-side: this role ACCEPTS the call when targeted. UI discovery + symmetric checks consult these on the TARGET'S role. `pattern` is irrelevant for receiver entries (the role IS the receiver); `intent` names what's accepted. The runtime gate is still the role's `call(message, ctx)` function — `as: "receiver"` is a declaration, not a guard.
  
  `pattern` is the BEING-name pattern (`@coder*`), NOT a space path. One field, two surfaces — same shape as left-stance/right-stance everywhere else in the substrate. Example:
  
  ```js
  // coder role
  canSummon: [
    { intent: "review", pattern: "@coder*", as: "actor" },   // I can ask peer coders for review
    { intent: "review", as: "receiver" },                    // I accept review requests
  ]
  
  // birther role
  canSummon: [
    { intent: "mate", as: "receiver" },                      // I accept mate requests
  ]
  ```
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
    if verb === "call"   && permitsSummon(role, target.being, intent): return ok
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
- **(b) travel + ask** — same shape; the request goes through a CALL to a coder; the coder decides whether to grant.
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
  if (verb === "call")   return matchAny(role.canSummon, `@${target.being}`, intent);
  if (verb === "be")     return matchAny(role.canBe, operation);
  return false;
}
```

The `matchAny` helper does the wildcard + prefix matching from today's `scoreKey`. The four-layer authorize collapses to one walk over the actor's granted roles.

## Schema changes

### Being

- **Add:** `qualities.rolesGranted: Array<{role, anchorSpaceId, grantedBy, grantedAt}>`
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
do(targetBeing, "grant-role", { role: "coder", anchorSpaceId: "<id>" })
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
- `scope: "global"` requires the author to hold a role with `canDo: ["set-role"]` reachable from the place root (so authoring a global role needs story-wide permission — typically the angel role).
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

4. **qualities.permissions translation.** For each `qualities.permissions.<verb>.<keyParts> = { requires: { memberClasses: { includes: "X" } } }` rule, ensure a corresponding role exists with `canX: [<keyParts>]` and that members of class X are granted that role at the space. Most existing rules are seed defaults; a handful per story. The migration script enumerates and converts.

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

- **Cross-world role propagation** — a granted role doesn't automatically transfer when the being walks into a foreign story. Deferred to the cross-world doctrine.
- **Time-bound grants** — no wall-clock expiry; the story has no clock. When a story-time unit exists (moments / reel seq / harmony beats), grants can carry a bound in that unit, enforced at the role-walk.
- **Composite roles via stacking** — `roleComposer.composeStack` keeps working for cognition-frame composition. The authorize walk treats stacked roles as a union (any role in the stack permits → allow). No new primitive.
- **Role versioning** — when a role's canDo changes after being granted, the granted role uses the LATEST definition. Future versioned grants would freeze the canDo at grant-time. Out of scope.
- **Permissions on Space/Matter directly** — auth3 is explicit: *"Never controlling space/matter access. Those are through Acts."* — so this stays. The space/matter doesn't have its own permission gate; the only gate is "did the actor's role permit this action."

## Pinned doctrine (for FACTORY.md / PERMISSIONS.md after Pass 4)

> **Roles are auth.** A being acts under a role; the role's canSee / canDo / canSummon / canBe IS the permission gate. There is no parallel "permissions" namespace. The role registry is authoritative.
>
> **Grants flow down the being-tree, rooted at I-Am.** Every granted role carries `{role, anchorSpaceId, grantedBy, grantedAt}`. The grant chain back to I-Am is the proof of authority.
>
> **Roles are spatial.** Each grant is anchored at a space. The role's reach is that space and its descendants (or story-wide if the role's scope is `"global"`).
>
> **Acquiring a role is an act, not a status check.** A being holds a role because someone granted it OR because they authored it themselves at a space they owned. Authorization never derives roles from stance properties.

## Verification criteria

- ✓ I-Am can do anything anywhere (bootstrap angel role at the place root, scope:global).
- ✓ Cherub can do BE birth/connect/release because the I-Am granted it the angel role at heaven.
- ✓ A new human registers via cherub; cherub grants them the `human` role at the place root.
- ✓ Human authors `coder` role at `<story>/coders/`; they get auto-granted coder at that space.
- ✓ Human births a child being; the child has zero granted roles by default. They can SEE the place root (default human role's canSee includes "place") but cannot DO anything until granted a role.
- ✓ Parent grants child the human role at place root; child can now do everything a human can.
- ✓ Coder grants a child being the coder role at the coders space; the child can do coder things in coders/ but not outside.
- ✓ A being not granted angel role cannot grant angel role to anyone else (the grant op's own canDo check refuses).
- ✓ Revoke removes the grant; subsequent calls under that role refuse.
- ✓ Replay: drop the DB, replay the chain, every authorize result is identical.
