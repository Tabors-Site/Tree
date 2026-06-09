# Permissions — TreeOS's membership-class access model

> _One gate. One rule format. One derivation. One storage primitive (membership classes). Hierarchical by ancestor-walk. Customizable by writing rules to qualities.permissions. Invariants live in handlers, distinct from permission checks._

## What this is

The canonical doctrine for how access decisions get made in TreeOS. Every verb call (SEE / DO / SUMMON / BE) routes through one function, evaluates against rules attached to positions, and decides allow or deny by matching the actor's derived properties.

This file is the single home for that doctrine. If you're authoring a rule, deriving a new property, or wondering why an op was allowed or refused, the answer lives here.

## The mental model

Permissions are **rules attached to positions, gated by properties of the actor**. Everything reduces to that.

- A **space** has rules (in `qualities.permissions`) and a **members map** (`members.<className>: [beingId, ...]`) of named authority classes.
- An **actor** has properties (computed by `deriveStanceProperties`) including the set of classes they belong to across the walked ancestor chain (`memberClasses: [...]`).
- A **rule** says "to do this verb here, you need these properties."
- The substrate **walks up the tree** to find the closest rule for the verb, evaluates the actor's properties against it, allows or denies.

That's it. One storage primitive, one decision mechanism, one mental model.

## The four invariants

These hold across every permission decision in the substrate. If a piece of code violates one, it's wrong:

1. **One gate.** `authorize()` in `seed/ibp/authorize.js` is the only function that says yes or no to a verb call. No exceptions.
2. **One rule format.** `requires: { propertyName: expectedValue, ... }` — every rule is a property-bag match. No special-case predicates, no embedded scripts, no per-rule logic.
3. **One derivation.** `deriveStanceProperties()` in `seed/ibp/stanceProperties.js` is the single place "what about the actor matters for permissions" gets answered. If a new property needs to be gateable, add it to the bag.
4. **Hierarchical by ancestor-walk.** Rules attach at positions; the substrate walks the parent chain from the target space to the reality root, picking the closest matching rule. The space the actor is acting at gets first say; ancestors fill in defaults.

## The one storage primitive

Every space carries a `members` Map of `className → [beingId, ...]`. That's the entire customization surface for who's trusted where:

```
space.members = {
  owner:       ["<beingId>"],         // singleton invariant (class size 1)
  contributor: ["<beingId>", ...],    // default trust class
  angel:       ["<beingId>", ...],    // heaven authority class
  auditor:     ["<beingId>", ...],    // operator-authored
  editor:      ["<beingId>", ...],    // operator-authored
  ...
}
```

Canonical classes the seed ships with:

| Class | Semantics | Invariants |
|---|---|---|
| `owner` | Singleton structural owner of this subtree. Closest-set wins via ancestor walk. | At most one entry; transferring uses `set-owner` (a single replacing write), not append. |
| `contributor` | Default trust class — peers of the owner. Grows up to `maxContributorsPerSpace` (default 500). | Owner cannot also be a contributor (no double-membership). |
| `angel` | Heaven-specific authority class. Reality operators are anointed here. | Heaven only. Cherub anoints new humans into this class on registration. |

Operators authoring custom classes (`auditor`, `editor`, `moderator`, etc.) just write `do:set-space` with `field: "members.<className>"`. Rules then gate on the new class via `requires: { memberClasses: { includes: "<className>" } }`. No substrate change required; the system is uniform across canonical and operator-authored classes.

Membership is **position-scoped**: a being's classes are determined per-space, not per-being. A "team" at one project space doesn't bleed into another. The ancestor walker unions classes from the target up to the ownership boundary.

## The decision flow

```
verb call → authorize({ identity, verb, target, action, ... })
              │
              ├─ Layer 0: I_AM short-circuit
              │            identity?.name === I_AM
              │            OR identity?.beingId === I_AM → allow universally
              │
              ├─ Layer 1: deriveStanceProperties(beingId, targetSpace)
              │            Reads being row + members chain + lineage.
              │            Returns a property bag:
              │              { beingId, name, role,
              │                arrival,
              │                owner, contributor, hasAccess,
              │                memberClasses: [...],
              │                homeAtPosition, homeInDomain,
              │                positionInHomeDomain, homeAncestors,
              │                homeOnThisReality, federatedFrom }
              │
              ├─ Bootstrap exceptions
              │            BE arrival can call birth/connect/release;
              │            SEE on .discovery is always open.
              │
              ├─ Layer 2 (extension-scope gate)
              │            If the DO action is "<ext>:<op>" and the
              │            extension is blocked at this space (via
              │            qualities.extensions.blocked on an ancestor),
              │            deny before rule-matching.
              │
              ├─ Layer 3: findMatchingRule(spaceId, verb, keyParts)
              │            Walks the ancestor chain. Looks for a rule
              │            at `space.qualities.permissions.<verb>.<keyParts>`.
              │            Closest space wins; within a space, more
              │            specific keyParts beat wildcards.
              │
              ├─ Layer 4: lookupDefault(key)
              │            Falls through to the extension-default
              │            registry (registered via manifest's
              │            provides.defaultPermissions).
              │
              └─ Layer 5: default deny.

Returns: { ok, stance, reason?, matched? }
```

## Authoring rules: the only customization surface

To customize permissions, operators write rules to `qualities.permissions.<verb>.<keyParts>` on whichever space the rule should apply at:

```js
// Let anyone in the "auditor" class at this position call read-only ops:
qualities.permissions.do["fetch-report"] = {
  requires: { memberClasses: { includes: "auditor" } }
};

// Let contributors call set-matter:content here (owner inherited from
// ancestor; the convenience flag `hasAccess` matches both classes):
qualities.permissions.do["set-matter:content"] = {
  requires: { hasAccess: true }
};

// Only the resolved owner can call this destructive op:
qualities.permissions.do["end-space"] = { requires: { owner: true } };

// Open to anyone present on this reality:
qualities.permissions.see["*"] = { requires: { homeOnThisReality: true } };

// Composed: must be an editor AND positioned in their home subtree:
qualities.permissions.do["publish"] = {
  requires: {
    memberClasses: { includes: "editor" },
    positionInHomeDomain: true,
  }
};
```

That's the entire interface. Rules are just data; mutating them is just a `do:set-space` (which itself goes through authorize, gated by whatever rule covers `set-space:qualities.permissions` at that position).

### Specificity

Inside a single space's `qualities.permissions.<verb>` bucket, the rule lookup picks the most specific match for the call's `keyParts`. Examples:

- `do:set-being:position` is matched first by the exact key `set-being:position`, then by the prefix `set-being:*`, then by the wildcard `*`.
- Per-namespace gates: `set-qualities:my-extension` matches before `set-qualities:*` matches before `*`.

Position precedence is **closest wins**: a rule at the target space beats one at any ancestor. The closest matching rule (any specificity) at any walked space wins.

### Per-verb key shapes

| Verb | keyParts |
|---|---|
| `see` | `"*"` (universal — verb-level gates apply at the entire-space level today) |
| `do` | `<action>` or `<action>:<namespace>` (e.g. `set-being:position`, `set-qualities:my-ext`) |
| `summon` | `@<qualifier>` or `@<qualifier>:<intent>` (e.g. `@cherub`, `@librarian:checkout`) |
| `be` | `<operation>` (`birth` / `connect` / `release`) |

## The "OR" lives in derived properties, NOT in rules

**This is the load-bearing pattern. Read it twice.**

The rule comparator is trivially simple: `props[propName] === expected`, with one set-membership shape: `actual.includes(expected.includes)`. There's no `$or`, no expression sublanguage, no per-rule logic. If you want "owner OR contributor," you don't write `requires: { $or: [{ owner: true }, { contributor: true }] }`. You write `requires: { hasAccess: true }` — and `hasAccess` is a **derived property** on the stance bag that's true when the being is owner OR in any non-system class.

This is doctrine, not laziness. Reasons:

1. **Rules stay readable.** Operators looking at `qualities.permissions` see "this rule requires hasAccess" — a single name, a single concept. No mental parsing of nested predicates.

2. **Complexity lives in the derivation, where it can be reasoned about once.** `deriveStanceProperties` is the single place a property's truth condition is defined. Everyone consuming the bag sees the same answer.

3. **New rule shapes mean new derived properties.** When you want to gate on "owner OR has-role-judge," you add a property like `ownerOrJudge` to the bag. The rule says `requires: { ownerOrJudge: true }`. The property's truth condition lives in `deriveStanceProperties`, alongside every other gateable concept.

4. **The comparator never grows.** Adding an `$or` operator would tempt every subsequent rule to embed logic. The simple comparator forces complexity into the right place.

If you're tempted to add OR-logic to the comparator: stop. Add a derived property to the bag instead.

### The one compound comparator shape: `{ includes: value }`

To gate on class membership (custom classes the substrate doesn't have a convenience flag for), use:

```js
requires: { memberClasses: { includes: "auditor" } }
```

The comparator interprets `{ includes: X }` as "the property's array value contains X." This is the ONE non-equality shape. It exists because membership-class lookups are the canonical operator-extensible gate; without it, every operator-authored class would need a hand-written convenience flag added to `deriveStanceProperties`.

For the canonical classes (`owner`, `contributor`), convenience flags exist (`owner`, `contributor`, `hasAccess`) so common-case rules read naturally. Custom classes use `memberClasses` includes.

## The property bag: what gates on what

`deriveStanceProperties` returns the bag every rule matches against. Every property here is gateable via `requires:`. To add a new property, add it to this function.

| Property | Type | Meaning |
|---|---|---|
| `beingId` | string \| null | The acting being's id. Null for arrival. |
| `name` | string \| null | The being's name (for stance labels). |
| `role` | string \| null | Default role on the being's row (`defaultRole`). The verb may pass a more specific `activeRole` separately. |
| `arrival` | boolean | True when no beingId resolves (unauthenticated visitor). |
| `owner` | boolean | True when this being is in the `owner` class on the ownership-boundary ancestor. |
| `contributor` | boolean | True when this being is in the `contributor` class anywhere on the chain (and NOT the owner). |
| `hasAccess` | boolean | `owner OR any non-system class membership` — the doctrinal OR for "in any trust class here." |
| `memberClasses` | string[] | Every class name this being belongs to across the walked ancestor chain. The rule comparator's `{ includes: X }` shape reads this. |
| `homeAtPosition` | boolean | True when the being's `homeSpace === target`. |
| `homeInDomain` | boolean \| string | True when the target is an ancestor of the being's home (home lives in target's subtree). Accepts a spaceId for scoped checks. |
| `positionInHomeDomain` | boolean \| string | True when the being's home is an ancestor of the target (target lives in home's subtree). |
| `homeAncestors` | string[] | The home's ancestor chain (for spaceId-scoped requirements). |
| `homeOnThisReality` | boolean | `!isRemote` — the being is local, not federated. ARRIVAL_PROPS sets this true so "open to anyone present" works without a separate arrival flag. |
| `federatedFrom` | string \| null | The being's home reality if remote, else null. |

The substrate also supports **string-valued requirements** for `homeInDomain` / `positionInHomeDomain`: a rule can say `requires: { homeInDomain: "<some-spaceId>" }` meaning "this specific spaceId must be in the home's ancestry."

## Permissions vs invariants — read this before touching members.js

Two concepts that look alike but aren't:

| | Permission | Invariant |
|---|---|---|
| What it gates | "Is this caller allowed to attempt this op?" | "Is the resulting state coherent?" |
| Where it lives | `authorize()` — the single gate | Inside the op's handler |
| Runs | Before the handler | Inside / after the handler |
| Customizable | Yes — operators write rules to `qualities.permissions` | No — invariants are structural |
| Example | "Heaven angels can call add-member" (heaven's `do:*` rule) | "Owner class is singleton — can't add a second owner with add-member" |

Inside `materials/space/members.js`, the singleton-owner check, the no-owner-as-contributor check, and the resolved-owner assertion on `add-member` / `remove-member` are **not duplicate permission checks**. They're invariants. The call has already been authorized by the substrate's single gate; the handler refuses to mutate when the resulting state would be incoherent.

Reframing this distinction makes the system honest:

- The `authorize()` gate decides who can *attempt* an op.
- The handler's invariant check decides whether the op *makes sense* given the current state.

Both run. Neither is redundant.

## The class-specific invariants

The membership-class primitive enforces a few class-specific invariants in handlers (`materials/space/members.js`). These are state-consistency rules, not permission checks:

| Op | Invariant | Why |
|---|---|---|
| `addSpaceMember` (any class) | The target being must exist on this branch | A class membership for a phantom being would dangle |
| `addSpaceMember(..., "owner", ...)` | The owner class is singleton — refuses when already occupied; transfers go through `setSpaceOwner` | One owner per position; the underlying replacing write keeps the invariant atomic |
| `addSpaceMember(..., "contributor", ...)` | Cannot add the resolved owner as contributor | Double-membership is incoherent |
| `addSpaceMember(..., "contributor", ...)` | Class size capped at `maxContributorsPerSpace` (default 500) | Prevents runaway growth |
| `removeSpaceMember(..., "owner", ...)` | Refused — use `setSpaceOwner` / `removeSpaceOwner` | Owner removal must atomically deal with the replacement |
| `removeSpaceMember(..., <other>, ...)` | Caller must be the resolved owner, OR removing themselves | Self-removal is the structural exception |
| `setSpaceOwner` | The previous owner is demoted to contributor (no orphaned authority) | Preserves prior owner's write access to their former subtree |
| `removeSpaceOwner` | Caller must be the resolved owner of the parent (not the target) | Delegations are revoked from above, not from within |

## Examples: end-to-end traces

### "@some-human calls do:set-matter:content at /my-tree/notes"

1. Wire receives the IBP envelope.
2. `do.js` calls `authorize({ identity: {beingId, name}, verb: "do", target: { kind: "position", spaceId: "<notes-id>" }, action: "set-matter", namespace: "content" })`.
3. I_AM short-circuit: no, the caller isn't I_AM.
4. `deriveStanceProperties` walks the members chain from `notes`. `some-human` is in `members.owner` at `/my-tree`. Bag: `{ owner: true, hasAccess: true, memberClasses: ["owner"], ... }`.
5. `findMatchingRule(notes, "do", ["set-matter", "content"])` walks ancestors. No rule at `notes` or `/my-tree`; the reality root has `do: { "*": { requires: { arrival: false } } }`.
6. Comparator: `arrival: false` matches `false`. Allow.
7. The handler runs, emits the fact, the moment seals.

### "@arrival tries to call do:create-space at /"

1. `authorize({ identity: null, verb: "do", action: "create-space", target: {...} })`.
2. No I_AM.
3. `deriveStanceProperties` returns ARRIVAL_PROPS (everything false except `homeOnThisReality: true`).
4. `findMatchingRule` finds the reality root's `do: { "*": { requires: { arrival: false } } }`.
5. Comparator: `arrival === false`? No, the bag says `arrival: true`. Deny with `reason: "stance does not satisfy requires.arrival (have true, need false)"`.

### "Tabor (a heaven angel) calls do:capture-seed at heaven"

1. `authorize({ identity: { beingId: "<tabor-id>" }, verb: "do", target: { spaceId: "<heaven-id>" }, action: "capture-seed" })`.
2. No I_AM short-circuit (Tabor isn't I_AM).
3. `deriveStanceProperties` walks heaven's members. Tabor is in `members.angel`. Bag: `{ memberClasses: ["angel"], hasAccess: true, ... }`.
4. `findMatchingRule(heaven, "do", ["capture-seed"])`. No specific rule; falls to heaven's `do: { "*": { requires: { memberClasses: { includes: "angel" } } } }`.
5. Comparator: `memberClasses` has `"angel"` in it. Allow.
6. Handler runs; the capture-seed flow proceeds.

### "The I-Am calls do:create-branch at heaven (internal flow)"

1. `authorize({ identity: { beingId: "i-am" }, verb: "do", target: { spaceId: "<heaven-id>" }, action: "create-branch" })`.
2. I_AM short-circuit: `identity.beingId === I_AM` → return `{ ok: true, stance: "i-am" }`. Done. The membership-class rule walk is skipped.

## The seed-shipped defaults

Two default sets seed at boot:

### Reality-root defaults

Attached to the reality root by `seedDefaultStancePermissions()`. These are the global fallbacks for any position that doesn't have a closer rule:

```js
see:    { "*": { requires: { homeOnThisReality: true } } }      // any local being or arrival
do:     { "*": { requires: { arrival: false } } }                // any authenticated being
summon: { "*": { requires: { arrival: false } } }                // any authenticated being
be: {
  birth:           { requires: { homeOnThisReality: true } },    // arrival can register
  connect:         { requires: { homeOnThisReality: true } },    // arrival can authenticate
  release:         { requires: { homeOnThisReality: true } },    // any session can release
  "create-being":  { requires: { arrival: false } },              // any authenticated being can mint
  "add-llm":       { requires: { arrival: false } },
  "assign-slot":   { requires: { arrival: false } },
  "list-llms":     { requires: { arrival: false } },
  "delete-llm":    { requires: { arrival: false } },
  "set-reality-llm": { requires: { arrival: false } },
  "set-space-llm":   { requires: { arrival: false } },
}
```

### Heaven defaults

Attached to the `.` space (heaven):

```js
see:    { "*": { requires: { homeOnThisReality: true } } }                     // anyone present can read catalogs
do:     { "*": { requires: { memberClasses: { includes: "angel" } } } }       // angels can mutate
summon: { "*": { requires: { memberClasses: { includes: "angel" } } } }       // angels can summon
```

The `do:*` and `summon:*` rules on heaven gate on the named `angel` class. The I-Am (heaven's owner) does NOT need angel-class membership — the I_AM Layer 0 short-circuit admits internal flows unconditionally. Every other being needs to be in `members.angel` at heaven to act inside the dot-namespace, and the only path to angel-class membership is through cherub's anoint (on first registration) or another angel calling `do(<reality>/., "add-member", { className: "angel", beingId: "<id>" })`.

### Extension defaults

Extensions can register their own defaults via `provides.defaultPermissions` in their manifest. These fall through after the per-space rule walk fails to find a match. Operators override extension defaults the same way they'd override any other rule: by writing a closer one.

## Adding a new gateable concept

When you want a rule to gate on something the current property bag can't express:

1. **Add the property to `deriveStanceProperties`**. Compute it from Layer 1 substrate state (Being row + Space members + qualities, the lineage walk, etc.). Make it boolean if possible; the comparator's most useful match is equality.
2. **Document its meaning** in this file's property bag table.
3. **Author rules** that gate on it: `requires: { yourNewProp: true }`.

DO NOT:
- Add OR-logic to the comparator.
- Add a parallel gate that runs alongside `authorize()`.
- Add a fast path that bypasses `authorize()` for "performance reasons."

If any of these tempt you, the architecture is telling you the property bag needs a new entry. Add it.

## Adding a new membership class

To introduce a new authority class (e.g. `moderator`, `editor`, `auditor`):

1. **No substrate change needed.** The members map accepts arbitrary class names; the reducer writes any `members.<className>` path; the walker surfaces all classes in `memberClasses[]`.
2. **Add operators to the class** by calling `do(<spaceId>, "add-member", { className: "<name>", beingId: "<id>" })`. Generic ops handle any class.
3. **Author rules** that gate on the class: `requires: { memberClasses: { includes: "<name>" } }`.
4. **Optional**: if the class becomes a load-bearing concept (used in many rules), add a convenience flag to `deriveStanceProperties` (e.g. `isModerator`). The convenience flag lets common rules say `requires: { isModerator: true }` without the includes-comparator. For one-off custom classes, includes is fine.

## What's NOT in the permission system

Some access concepts live elsewhere by design:

- **Branch isolation** (`CROSS_BRANCH_FORBIDDEN`). The wire-layer cross-branch gate refuses calls where the socket's branch differs from the target's branch. This is a wire-layer concern (the address space is per-branch), not a permission concern.
- **Pause/delete state** (`REALITY_PAUSED`). Branch lifecycle gates refuse writes against paused/deleted branches. This is branch state, not permissions.
- **Credential authority** (`hasCredentialAuthority` in lineage.js). Reading/resetting another being's password runs through a separate fold-derived check (the chain of be:birth + be:credential-detach + be:credential-attach facts). Adjacent but distinct from the verb gate. I_AM short-circuits both.

If you're trying to gate on one of these via `qualities.permissions`, you're at the wrong layer.

## Cleanup history

For forensic traceability:

- **2026-06-04**: "reigning" stance retired. Heaven owner + contributors replaced a parallel roster with its own cache, matter, and DO ops. One ownership model, no separate state.
- **2026-06-07** (morning): `canWrite` renamed to `hasAccess` on the stance bag and in heaven's default rules. Behavior unchanged.
- **2026-06-07** (afternoon): **The membership-class refactor.** The `rootOwner` and `contributors[]` schema fields on Space retired in favor of a single `members` Map field. Two unnamed special-case classes became instances of one general primitive (named membership classes). Heaven's authority class explicitly named `angel`. Custom operator-authored classes (`auditor`, `editor`, etc.) became first-class. The single gate (`authorize`) gained the `{ includes: value }` comparator shape so `memberClasses` gates work cleanly. The I_AM Layer 0 short-circuit extended to match on `identity.beingId === I_AM` in addition to `identity.name === I_AM` (internal flows that thread only beingId still short-circuit).
- **2026-06-07** (afternoon): HTTP middleware's `attachSpaceAccess` retired. It was a legacy bypass-of-authorize that pre-filtered requests on `hasAccess` and attached `req.spaceAccess` / `req.rootId` that nothing downstream read. The single gate (`authorize()`) handles all access decisions now; HTTP middleware just identifies the caller.

## See also

- `seed/ibp/authorize.js` — the single gate, the rule walk, the comparator, the seed-shipped defaults
- `seed/ibp/stanceProperties.js` — the property derivation
- `seed/materials/space/members.js` — the membership-class storage primitive (helpers + write ops + invariants)
- `seed/materials/space/spaces.js:resolveSpaceAccess` — the ancestor-chain walker (purely a derivation helper consumed by stanceProperties)
- `seed/materials/space/ownership.js` — thin shims (`addContributor`, `setOwner`, etc.) over the members primitives, kept for caller compatibility
- `seed/materials/space/heavenLineage.js` — heaven-specific membership helpers (`isHeavenContributor`, `isHeavenSpace`) for reality-wide authority checks
