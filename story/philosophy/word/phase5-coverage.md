# Word coverage map (Phase 3/5 backlog)

A representative spread of in-world slices, drafted as `.word` prose, with every surface form classified as `have` (the current parser plus evaluator already run it), `parser-gap` (a new surface template the parser must learn), or `engine-gap` (an evaluator capability the slice needs that does not yet exist). Eight slices were drafted across the heaviest cases in the canon: cherub birth, BE connect, the governance commons, grant-role, inheritation, the subscription and schedule wake flows, the matter-type and space-template registry, and NAME declare. The point is leverage: count how many slices each missing form or capability blocks, so parser growth is queued by how much corpus it unlocks and the evaluator handoff is queued by which capabilities the most slices wait on. This map changes no code; it is the shared backlog for the two lanes.

## Parser grammar backlog (MY lane — forms to add, by leverage)

The new SURFACE templates the parser must learn, sorted by how many slices need them. (A "form" is grouped by its grammatical shape; the same shape recurs across slices under different wordings.)

| Form                                                                                                                                                        | #slices | note                                                                                                                                             | example slices                                                                                         |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| `When X: <multi-line indented body of effects>`                                                                                                             | 7       | Multi-effect flow body: a `When` trigger followed by an indented sequence of acts that fire together. The parser handles single-line flows only. | cherub-birth, cherub-connect, governance-commons, grant-role, inheritation, matter-types, NAME-declare |
| `the X Vs the Y a Z of the W` / `the X sets the Y as Z of the W` (DO act with complex relation/property assignment)                                         | 5       | Imperative DO acts setting parent/owner/relation structure; complex object or multi-target, beyond simple `V the O`.                             | cherub-birth, governance-commons, grant-role, inheritation, matter-types                               |
| `A X can V a Y` (capability grant: can/cannot)                                                                                                              | 3       | Capability declarations as structures (raise, back, admit, close, coalesce, skip). Parser does not yet parse `can` declarations.                 | governance-commons, subscription-schedule, grant-role                                                  |
| `X carries a Y` / `A X has a Y` (property/attribute declaration on a kind)                                                                                  | 3       | Attach a property (filter, priority, interval, size, owner, content shape) to a kind, distinct from containment or ownership.                    | subscription-schedule, matter-types, (grant-role record fields)                                        |
| `make a new X, Y as bind` (imperative DO with a binding clause)                                                                                             | 2       | Capture an id for later reference within the flow (`homeId as bind`). No binding syntax yet.                                                     | cherub-birth, cherub-connect (loop bindings)                                                           |
| `becomes a fact: X:Y` (derivation form)                                                                                                                     | 2       | Rule-8 derivation: an act `becomes a fact` of type `verb:op`. Not in the current forms.                                                          | cherub-birth, (inheritation fact-landing)                                                              |
| `When a X Vs to Z` / `When I V a role to another being` (event-flow with receiver / indirect object)                                                        | 2       | Rule-17 receiver on the trigger and on DO acts (`to another being`).                                                                             | grant-role, governance-commons                                                                         |
| `A X extends Y` (role inheritance)                                                                                                                          | 1       | Child role inherits parent capabilities and scope.                                                                                               | governance-commons                                                                                     |
| `A X contains Y and Z` (containment with conjunction)                                                                                                       | 1       | `contains` is not yet a parser verb; conjoined contained items.                                                                                  | governance-commons                                                                                     |
| `A X can V every/most/no Y` (capability/condition with quantifier)                                                                                          | 1       | Quantifiers `every`, `most`, `no` over a collection; counting predicate.                                                                         | governance-commons                                                                                     |
| `notify the Y` (broadcast act, recipients by role)                                                                                                          | 1       | Reach all beings in a collection without explicit object enumeration.                                                                            | governance-commons                                                                                     |
| `the X Vs` (reflexive/passive act, no explicit object)                                                                                                      | 1       | Self-directed state transition (`the proposal passes`, `the being wakes`).                                                                       | governance-commons, (subscription-schedule has-form)                                                   |
| `When a X Vs a Y` (event-flow without `happens`)                                                                                                            | 1       | Naked act-as-event watch; current parser requires `When a E happens`.                                                                            | governance-commons                                                                                     |
| `host: <builtin> does X` (host escape hatch inline in prose surface)                                                                                        | 1       | A prose grammar for host calls; today they live only in `act.host` IR.                                                                           | NAME-declare (also strained in cherub-connect, matter-types)                                           |
| `X is a Y` (bare `is`, no article — a being's intrinsic property)                                                                                           | 1       | `I_AM is the root`; immutable property without article (strains rule 10).                                                                        | NAME-declare                                                                                           |
| `X is a Y (opt1 \| opt2, null if unspecified)` (enumerated kind with null fallback)                                                                         | 1       | Disjunctive option set with explicit null fallback (`soulType`).                                                                                 | NAME-declare                                                                                           |
| `A X can V a Y to a Z` / `... with a Z` / `... to V to Z` (capability with two objects, parameter clause, or nested infinitive intent)                      | 1       | Multi-object and nested-intent capability grants (admit-to-roster, summon-with-concern, summon-to-ask-to-join).                                  | governance-commons                                                                                     |
| `A X can V the Y [adjective]` (capability over an adjective-filtered plural)                                                                                | 1       | Filter a plural by state (`the open proposals`).                                                                                                 | governance-commons                                                                                     |
| `X runs Y (with purpose Z)` (act with a purpose/reason clause)                                                                                              | 1       | Accept a `with` clause describing intent (constant-time dummy hash).                                                                             | cherub-connect                                                                                         |
| `X unlocks the Y keyed by Z` (act with a keyed/parametric resource)                                                                                         | 1       | Prepositional/parametric object qualifier (`keyed by` the trueName).                                                                             | cherub-connect                                                                                         |
| `When the being holds the role at an anchor` (state condition on a collection's membership)                                                                 | 1       | Express "being holds a role [at anchor]" as a standing condition over `rolesGranted`.                                                            | grant-role                                                                                             |
| `A grant lasts until revoked` / `No wall-clock expiry` / `time comes with moments, not ISO` (durational + temporal-exclusion + relational-time constraints) | 1       | Lifecycle statements and prohibitions on time-based expiry (law-layer).                                                                          | grant-role                                                                                             |
| `X is stored / X is not stored / no X is stored for Y` (storage and negative/absence facts)                                                                 | 1       | Express "no inheritation point stored," distinguish stored from computed facts.                                                                  | inheritation                                                                                           |
| `X accepts content-kind` / `X carries operation` / `X claims a mime or extension or scheme` (matter-type declarations)                                      | 1       | Type registry surface: what a type accepts, the ops it carries, its classification claims.                                                       | matter-types                                                                                           |
| `An extension can bring a typed X by registering "ext:type"` (extensibility via summon + host)                                                              | 1       | Extension summons `registerMatterType` to birth a type into the registry.                                                                        | matter-types                                                                                           |
| `When a being Vs X without naming its Y, I ...` (absence-conditional flow)                                                                                  | 1       | A flow that fires on an omission, not on presence; auto-classification.                                                                          | matter-types                                                                                           |
| `When X is in Y, Y contains X` (symmetric/relational derivation)                                                                                            | 1       | Rule-8 closure inferring the inverse relation (containment).                                                                                     | matter-types                                                                                           |
| `A X is a space.` / `A X is a Y.` / `A X is a role for a Y.` (declaration of kind)                                                                          | (have)  | Already in the parser; listed for completeness.                                                                                                  | cherub-birth, governance-commons, inheritation, NAME-declare, subscription-schedule, matter-types      |

## Engine-capability queue (the other agent's lane)

The evaluator capabilities the slices need that do not exist. This is the handoff to the engine builder, sorted by how many slices wait on each.

| Capability                                                                                                                            | #slices | slices                                                                                                 |
| ------------------------------------------------------------------------------------------------------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------ |
| multi-effect flow bodies (sequence of acts, possibly nested, under one `When` trigger)                                                | 7       | cherub-birth, cherub-connect, governance-commons, grant-role, inheritation, matter-types, NAME-declare |
| branching / if-then-else conditional within a flow (not just standing watches)                                                        | 4       | cherub-connect, governance-commons, inheritation, matter-types                                         |
| role / capability model: track who can do what, prohibition precedence (rule 14), `extends` resolution, per-role visibility           | 4       | governance-commons, grant-role, inheritation, subscription-schedule                                    |
| negation / NOT in conditions (equality negation, existence/absence checks)                                                            | 4       | cherub-connect, governance-commons, grant-role, inheritation                                           |
| collection resolution and operations: resolve plural references to dynamic sets; append-to-collection (`rolesGranted` gains a record) | 3       | governance-commons, grant-role, subscription-schedule                                                  |
| in-moment / relational query bound mid-flow (isAncestorOf graph walk; tree traversal with a predicate yielding anchors)               | 3       | cherub-connect, inheritation, (matter-types classification scoring)                                    |
| state-read of a being's nested field used in a condition (`qualities.father`, foreign vs local)                                       | 3       | cherub-connect, inheritation, matter-types                                                             |
| role inheritance (auto-inherit roles from parents on birth; `extends` merges parent capability and scope)                             | 3       | cherub-birth, governance-commons, subscription-schedule                                                |
| history-lineage inheritance and per-history cancel (subscriptions/schedules inherit then cancel on the child)                           | 2       | subscription-schedule, (cherub-connect seatBranch)                                                     |
| collection-iteration: loop over a set, bind each element, break on a condition                                                        | 2       | cherub-connect, governance-commons                                                                     |
| failure / refusal flow: emit a refusal or exception fact, halt the effect chain                                                       | 2       | cherub-connect, governance-commons                                                                     |
| quantifier evaluation: `every`, `most`, `all`, `no` as counting predicates over collections                                           | 1       | governance-commons                                                                                     |
| broadcast notification: `notify the X` reaching all beings of a role/collection                                                       | 1       | governance-commons                                                                                     |
| reflexive acts and self-wake marks: act with no explicit object (`the proposal passes`); asker and receiver the same being            | 2       | governance-commons, subscription-schedule                                                              |
| acts-as-events: an act triggers a flow without an explicit `happens` wrapper                                                          | 1       | governance-commons                                                                                     |
| disjunctive condition (OR) binding a flag (`asFather` true if any path succeeds)                                                      | 1       | cherub-connect                                                                                         |
| conditional binding: set an output variable to one of multiple values based on branching (`driver trueName`)                          | 1       | cherub-connect                                                                                         |
| type-based branching: test properties of an identity object (foreign vs local) and branch                                             | 1       | cherub-connect                                                                                         |
| parameterized-event-flow: accept BE operations with payloads as flow triggers                                                         | 1       | cherub-connect                                                                                         |
| host-to-transport bridging: deliver return values (seatBranch, owned, asFather) from evaluator to wire layer, or model them as facts  | 1       | cherub-connect                                                                                         |
| fact attribution: who signed a fact and which reel it lands on                                                                        | 1       | inheritation                                                                                           |
| negative / absence facts: express "no point stored," distinguish stored from derived facts                                            | 1       | inheritation                                                                                           |
| query dispatch to host bound into a flow (`be:see` calling `hasAuthorityOver`, binding the result)                                    | 1       | inheritation                                                                                           |
| multiple anchor types folded into one decision (ownership trueName OR live inheritation point)                                        | 1       | inheritation                                                                                           |
| object assembly: build a complex record (role record) from multiple fields with disjunctive fields (anchor space OR anchor being)     | 1       | grant-role                                                                                             |
| validation gate: pre-seal check that fails the act if a predicate is false (role exists in registry)                                  | 1       | grant-role                                                                                             |
| relational-time assertion: grants use moments, not wall-clock timestamps                                                              | 1       | grant-role                                                                                             |
| coalesce batching: collect events into a window, fire one summon with the batch                                                       | 1       | subscription-schedule                                                                                  |
| skipIfBacklog logic: skip waking if the being already has an unconsumed summon                                                        | 1       | subscription-schedule                                                                                  |
| cleanup cascades: on release, drop every subscription and schedule for the being                                                      | 1       | subscription-schedule                                                                                  |
| external / timer event watches: fire on the tick loop, coalesce-window close, or hook payloads                                        | 1       | subscription-schedule                                                                                  |
| multi-effect / multi-fact primitive act: `be:form-being` emits birth + inherited grants + global grant atomically                     | 1       | cherub-birth                                                                                           |
| symmetric-relation inference: auto-fire the inverse fact (`when X is in Y`, infer `Y contains X`)                                     | 1       | matter-types                                                                                           |
| property declarations on kinds: optional structural properties (`space.size`, `matter.content` shape) distinct from full capabilities | 1       | matter-types                                                                                           |
| extensibility-hook declaration: mark `qualities` as extension-writable, outside the core model                                        | 1       | matter-types                                                                                           |
| classification as a primitive: eager inline auto-classify when matter is brought without a type (eager rule, not a standing watch)    | 1       | matter-types                                                                                           |
| relational being binding / facet creation: a new being wired as a facet/child of a parent (state-fold or inheritance)                 | 1       | NAME-declare                                                                                           |
| enumerated role options with null fallback (`soulType: human \| llm \| scripted, null`)                                               | 1       | NAME-declare                                                                                           |
| conditional guard with host call: `When X, the registry is queried (host: Y) and <guard>`                                             | 1       | NAME-declare                                                                                           |

## Runnable now

None of the eight slices is runnable on the current parser-plus-evaluator. Honestly: zero. Every slice carries at least one `parser-gap` or `engine-gap` form, and most carry both. The closest are the slices that lean hardest on the existing `have` forms (`A X is a space.`, `A X is a role for a Y.`, the `When a E happens` event-flow, and the `host:` escape hatch) — `governance-commons` and `subscription-schedule` open with several `have` lines, and the matter-type registry's `A X is a matter type.` declarations parse today — but each still trips on its first real act (capability grants, `contains`, multi-effect bodies, history-lineage inheritance). The four `have`-only forms are real and reused (six slices use the kind-declaration forms; two use the unparameterized event-flow), but no whole slice clears the bar. The single most universal blocker is the multi-effect flow body: seven of eight slices need it before any of their interesting behavior can run.

## Draft .word corpus

### cherub-birth

```
A home is a space.
A home is 100 by 100 in size.
I_AM births through Cherub.

When Arrival summons Cherub to birth a being:
  make a new home, homeId as bind.
  the Cherub makes the home a territory of the place root.
  form a being named the being, with the being's name and password, with homeId as the being's home, with I_AM as the being's parent, and with the being's owner Name.
  the Cherub sets the being as owner of homeId.
  the Cherub grants the being the human role at the place root.
  the Cherub grants the being the global role at the place root.
  record the being's lineage: mother is Cherub, father is Arrival.

The being's form-being act:
  host: birthBeing(spec, identity, summonCtx)
  sets the being's id, name, cognition, defaultRole, trueName, homeId, parentBeingId, homeBranch, position.
  auto-inherits roles from mother and father.
  becomes a fact: be:birth.

That birth invokes the being's arrival into the world.
```

- parser-gaps: `A X is Y in size`, `X births through Y`, multi-effect `When ... summons ... to ...` body, `make a new X, Y as bind`, `the X makes the Y a Z of the W`, `form a being named X, with <params>`, `the X sets the Y as Z of the W`, `the X grants the Y the Z role at the W`, `record the X's lineage: ...`, `becomes a fact: X:Y`. engine-gaps: multi-effect summon flows, `be:form-being` multi-fact atomic act, multi-property state fold (`sets the X's Y, Z, W`), role inheritance from parents, fact derivation, the `That X invokes Y into Z` consequence form.

### cherub-connect (BE connect)

```
When Cherub connects with a name and a password:

  Cherub searches across all histories for a being with that name (up to 5 candidates, capped).
  For each candidate in order:
    If the candidate is local (not remote):
      Cherub verifies the password against the candidate's hash.
      If verification succeeds, the being is found, and Cherub stops the search.
  If no being was found:
    Cherub runs a constant-time dummy hash (to hide timing of existence).
    Cherub refuses the connection with "Invalid credentials."
  If a being was found:
    Cherub generates an identity token for the being.
    Cherub unlocks the signing session keyed by the being's trueName.
    The transport seats the session on the being's home history.
    Return the being's address, beingId, name, and seatBranch.

When a signed-in Name (the caller) connects to a being it owns:

  The caller has ctx.nameId set from the server-verified socket.
  The target is a being's name (not @cherub, extracted from the address).
  Cherub searches for candidates with that being name (up to 5, across all histories).
  For each candidate in order:
    If the candidate is local:
      Cherub loads the candidate's fresh projection at its home history.
      Cherub reads the candidate's current trueName from the projection's state.
      If the current trueName equals the caller's nameId (verified match):
        The being is owned by the caller.
  If the being is owned:
    Cherub generates an identity token for the being with its trueName.
    The transport seats the session on the being's home history.
    Return the being's address, beingId, name, seatBranch, and owned: true.

When an authenticated being (the caller) connects to inherit a descendant being:

  The caller is already bound to a session bearing identity (beingId, name).
  The target is a different being (its name extracted from the address).
  Cherub searches for target candidates with that name (up to 5).
  If no candidates exist:
    Cherub refuses with "No such being on this reality."
  For each target candidate in order:
    Cherub checks if the caller's beingId is an ancestor of the candidate (via being-tree).
    Cherub checks if the candidate was born with a father tuple (qualities.father):
      For local fathers:
        The father.beingId equals the caller's beingId, and the reality matches (local domain).
      For cross-reality fathers:
        The father.nameId equals the caller's nameId (cryptographic identity, not beingId).
        The caller arrived with a verified envelope signature (beingSigVerified is true).
        The father.reality matches the caller's reality.
      If either father path succeeds, asFather is true.
    If the caller is an ancestor OR asFather:
      The target being can be inhabited.
  If no target could be inhabited:
    Cherub refuses with "@<caller> can only inhabit beings they birthed (or descendants)."
  If asFather and a current inhabitant exists (qualities.connection.inhabitedBy is set):
    If the current inhabitant is not the father:
      Cherub emits a be:release fact for the current inhabitant with reason "father-priority".
  If inhabited as father (asFather is true):
    Cherub loads the father's fresh projection at the target's home history.
    Cherub reads the father's trueName from the projection's state.
    If the father is foreign (no local Name key exists):
      The driver trueName is the father's beingId (unsigned on this reality).
    Otherwise:
      The driver trueName is the father's local trueName.
  Otherwise (inherited, not as father):
    The driver trueName is the target being's trueName (the being keeps its own signer).
  Cherub generates an identity token for the target being with the driver trueName.
  The transport seats the session on the target being's home history.
  Return the being's address, beingId, name, seatBranch, inherited: true, and asFather: (true/false).
```

- parser-gaps: parameterized BE-op flow header (`When Cherub connects with X and Y`), act with reason clause (`X runs Y with purpose Z`), keyed-resource act (`X unlocks the Y keyed by Z`). engine-gaps: collection-iteration with break, branching if-then-else with negation, in-moment relational query (isAncestorOf), nested-state read (`qualities.father`), disjunctive flag binding (asFather), conditional binding (driver trueName), type-based branching (foreign vs local), failure/refusal flow, host-to-transport bridging of return values, parameterized-event-flow.

### governance-commons

```
A commons is a space.
A commons contains proposals and a roster of members.

A member is a role for a commons.
A member can see every proposal and the roster.
A member can raise a proposal.
A member can back a proposal.
A member can summon a steward with a concern.

A steward is a role for a commons.
A steward extends member.
A steward can admit a being to the roster.
A steward can close a proposal.

A visitor is a role for a commons.
A visitor can see the open proposals.
A visitor can summon a steward to ask to join.

When a visitor asks to join:
  notify the stewards.
  when a steward admits the visitor, the visitor becomes a member.

When most members back a proposal:
  the proposal passes.
  notify the roster.

When a steward closes a proposal:
  no member can back it.
```

- parser-gaps: `A X contains Y and Z`, `A X can V every Y and Z`, `A X can V a Y`, `A X can summon a Y with a Z`, `A X extends Y`, `A X can V a Y to a Z`, `A X can V the Y [adjective]`, `A X can summon a Y to V to Z`, multi-line `When a X Vs to Z` body, `notify the Y`, nested `when a X Vs the Y, the Y Vs a Z`, quantifier `When most X Vs Y`, reflexive `the X Vs`, event-flow without `happens` (`When a steward closes a proposal`). engine-gaps: capability model, quantifier evaluation, prohibition precedence (rule 14, `no member can back it`), role inheritance (`extends`), collection resolution, multi-effect flow bodies, broadcast notification, reflexive acts, acts-as-events.

### grant-role (DO op + auth)

```
A being can be granted a role.

When I grant a role to another being:
  the being accepts a role record.
  the role record holds the role name, the anchor space or anchor being, I as the grantor, and the grant time.
  the being's rolesGranted gains the role record.

When the being holds the role at an anchor:
  the role is live for that being at that anchor place.

I can grant role X only when my own role has canDo entry for grant-role:X.
A role with canDo for grant-role:* can grant any role.
A role with bare canDo for grant-role matches grant-role:* (the super-grantor shape).

The role exists in the registry before the grant seals.
host: role validation (getRole from the registry).

A grant lasts until revoked.
No wall-clock expiry.
Time-bound grants come with reality-time (moments), not ISO timestamps.
```

- parser-gaps: passive capability (`A being can be granted a role`), event-flow with indirect object (`When I grant a role to another being`), compound-object DO (`the being accepts a role record`), state condition on a collection (`When the being holds the role at an anchor`), durational/temporal-exclusion constraints (`A grant lasts until revoked`, `No wall-clock expiry`, reality-time vs ISO). engine-gaps: role-capability check with namespace/wildcard matching, collection append, object assembly with disjunctive fields, state-condition-on-collection, validation gate, receiver-in-act (rule 17), prohibition statement with precedence, relational-time assertion.

### inheritation (DO ops: grant-inheritation, revoke-inheritation)

```
A being-tree position is a being.
Authority is a quality.

I own a being, and I have authority over it and over every being below it in the tree.
A being does not own itself; its owner is the Name that brought it to birth.

When I grant-inheritation to a Name at a position:
  the Name gains authority over that position and its whole subtree below.
  the grant lands as a fact on the position being's reel, attributed to I.
  the granted Name is recorded as having an inheritation point there.

When I revoke-inheritation from a Name at a position:
  the revoke lands as a fact on the position being's reel, attributed to I.
  the Name's inheritation point is removed, if it was live.
  the latest of a grant and a revoke by date decides whether the point is live.

When I ask whether a Name has authority over a being:
  host: hasAuthorityOver.
  walk the being-tree up from the being to the reality root.
  at each node on the walk, check for an ownership anchor (the node's trueName) or a live inheritation point at that node for the Name.
  if any anchor matches the Name, the Name has authority over the being.
  if no anchor is found, the Name does not have authority over the being.
  I_AM always has authority over every being on its own reality.

New beings inherit coverage automatically:
  when a being is born under a covered position, the child walks up and passes through the ancestor's anchor, so the child is covered.
  no inheritation point is stored for the child; the walk itself grants the coverage.

Inheritation is delegation, not ownership:
  the granted Name gains authority without owning any being.
  the granted Name cannot undo its own point; only a Name with authority over the position can grant or revoke.
```

- parser-gaps: coordinated multi-effect act (`I do X, and I do Y`), multi-effect body under a summon (`When I do X at a Y`), query-as-when with host dispatch (`When I ask whether X: host: builtin`), storage/negative facts (`no X is stored for Y`). engine-gaps: fact attribution (signer + reel), tree traversal with a predicate, multiple anchor types in one check, if-then-else branching, query dispatch to host bound into a flow, negative/absence facts. (`A X is a Y` and `X cannot Y` are `have`.)

### subscription/schedule flow (wakes)

```
A subscription is a standing request for attention.
A subscription watches an event in a scope.
The subscription carries a filter and a priority.

A subscription can coalesce events into a batch.
When the coalesce window closes, the subscriber receives one summon carrying the batch.

A being declares a subscription to wake when an event happens.
When the event arrives in the watched scope matching the filter, the being's subscription fires.
The being receives a summon carrying what changed, and the being wakes.
The subscription is the being's own request: the asker and receiver are the same being.

A subscription lands a fact on the being's reel: subscription-registered marks the watch.
When the being cancels a subscription, subscription-cancelled marks the reel.

A schedule is a standing request to wake on a cadence.
A schedule carries an interval, a priority, and content.

A being declares a schedule to wake every N milliseconds.
A schedule carries a history so different histories wake on their own ticks.
When the tick comes due, the being's schedule fires.
The being receives a summon carrying the scheduled content, and the being wakes.
The schedule is the being's own request: the asker and receiver are the same being.

A schedule lands a fact on the being's reel: wake-scheduled marks the watch.
When the being unschedules it, wake-cancelled marks the reel.

The tick loop runs as a standing rhythm, host: tickLoop.
On each tick, every schedule whose next fire time has passed fires its summon.

A subscription can also skip if the being already has an unconsumed summon, host: skipIfBacklog.
A schedule can skip if the being's inbox backs up, when skipIfBacklog is true.

A being's subscriptions inherit through history lineage: a subscription on the parent history reaches the child until the child cancels it on itself.
A being's schedules inherit through history lineage: a schedule on the parent history ticks on the child until the child unschedules it on itself.

When a being is released, every subscription for the being is dropped.
When a being is released, every schedule for the being is dropped.
```

- parser-gaps: `X carries a Y` (property declaration), `When the X happens, Y` (external/timer watch), `The X is the Y's own Z` (reflexive ownership), `When a X is Y, every Z for the X is dropped` (cleanup cascade). engine-gaps: capability grants (rule 14), history-lineage inheritance, external/timer event watches, reflexive relationship marks (self-wake), cleanup cascades, coalesce batching, skipIfBacklog logic. (`A X is a space`, `A X is a role for a Y`, the two `When a E happens` event-flow forms, the event-derivation form, and `host: X` are `have`.)

### matter/types and space templates — type registry declarations

```
A generic is a matter type. Generic accepts text or no content. The only operation generic carries is set-matter and end-matter.

A file is a matter type. File accepts binary or text content. File carries set-matter, end-matter, and purge-content.

An http is a matter type. Http accepts no content. Http carries set-matter and end-matter. Http claims an https or http scheme.

A model is a matter type. Model accepts binary content only. Model carries set-matter, end-matter, and purge-content. Model claims a glb or gltf extension, or a model/gltf-binary or model/gltf+json mime.

A source is a matter type. Source accepts text, binary, or no content. Source carries create-matter, set-matter, end-matter, and rename-matter.

An ibpa is a matter type. Ibpa accepts no content. Ibpa carries set-matter and end-matter.

A connection is a matter type. Connection accepts no content. Connection carries set-matter and end-matter.

An extension can bring a typed matter by registering "ext:type" in the seed's matter registry, host: registerMatterType("ext:type", {...}).

When a being brings matter into the world without naming its type, I classify the input: I scan mime and extension and url scheme against every registered type's claims, score each claim, and the highest-scoring type becomes the matter.

A space has an owner, a being. A space may have a size, a coordinate bounding box. A space may have children, the spaces nested inside it. A space has qualities, a map of properties an extension may set. A space is its position in its parent space, a coordinate clamped at write time.

A matter has an owner, the being that created it. A matter sits in one space, or is soft-deleted. A matter may have a parent matter, a tree root. A matter has a type, a registered name (generic or file or ext:type). A matter has content, a shape matching its type: text matter carries text or a CAS reference, an http carries a url, an ibpa carries an IBP address, a model carries model bytes, a source carries a file path. A matter has qualities, a map of properties an extension may set. A matter is its position in its space, a coordinate clamped at write time.

When a being is in a space, the space contains the being. When matter is in a space, the space contains the matter. When a space is in another space, the parent space contains the child space.

When I bring matter into the world, I classify it: host: classifyMatter(input) returns a ranked list of type candidates. The being takes the highest-scoring type the classifications propose.
```

- parser-gaps: `X accepts content-kind`, `X carries operation`, `X claims a mime or extension or scheme`, `An extension can bring a typed X by registering ...`, absence-conditional (`When a being brings matter ... without naming its type`), `A X has a Y` / `A X may have a Y` (property + optionality + appositive gloss), `A X has qualities, a map ...` (extensibility hook with nested capability), `When X is in Y, Y contains X` (symmetric derivation), `When I bring matter, I classify it` (multi-clause flow with inline host call). engine-gaps: property declarations on kinds, absence-conditionals, multi-clause flow body, symmetric-relation inference, extensibility-hook declaration, classification as an eager inline primitive. (`A X is a matter type` is `have`.)

### NAME declare

```
A Name is a space.
I_AM is the root.

When a Name is declared:
  host: generateNameKeypair builds a new keypair, or importKey rebuilds one from seed.
  the new Name is a facet of I_AM.
  the declaration mints the public key as the Name's id.
  the private key is encrypted (either with password via KDF, or system-encrypted), and the spec records it.
  the spec names the soulType (human | llm | scripted, null if unspecified).
  the spec names the real-name (optional handle for sign-in; null if unspecified).
  if importKey was given, no reveal is returned (the caller already holds the key).
  if a fresh keypair was minted, the reveal hands out the nameId, publicKeyPem, privateKeyPem, and 24-word mnemonic (one-time backup).
  the fact records only the encrypted spec, never the reveal.

When a real-name is given, the registry is queried (host: findByName) and the real-name must not already exist on this reality.
When a keypair is imported, the registry is queried (host: loadProjection) and the imported nameId must not already exist on this reality.
```

- parser-gaps: bare `is` (`I_AM is the root`), multi-effect `When a E happens` body, host escape hatch inline in prose (`host: generateNameKeypair builds ...`), enumerated kind with null fallback (`soulType: human | llm | scripted, null`). engine-gaps: relational being binding / facet creation, multi-effect flow bodies, conditional host guard with side-effect-and-assert (`When X, the registry is queried (host: Y) and X must not exist`), enumerated role options with null fallback. (`A X is a space` is `have`.)

---

_Lane split: parser + .word slices = Claude; engine + the live-diff gate = the other agent. This map is the shared backlog._
