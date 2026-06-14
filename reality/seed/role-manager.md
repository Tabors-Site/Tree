# RoleFlow — Comprehensive Build Plan

## What This Document Is

This is the complete plan for making TreeOS's behavioral system declarative and world-reactive. It consolidates the doctrinal landings from the last three conversation turns: cognition-on-being (not on role), role-stacking with conditional composition, world-reading condition vocabulary, and the emergent patterns that fall out of those primitives.

The goal is to land a substrate where **a being's behavior at every moment is a pure function of (world state, lineage, role definitions)**. Beings are programmed not by writing per-moment logic but by composing roles and authoring conditions that govern when those roles apply. The world's chain is the source code; the role registry is the standard library; the substrate is the runtime; replay is the debugger.

This plan is structured to be built in order. Each section names what the substrate needs, what it removes, and what falls out for free. The order is critical — landing pieces out of order creates messes that you'll have to undo.

---

## Section 1 — The Core Definition

**RoleFlow** is a declarative, world-reactive system for composing a being's behavioral context at every moment.

**A being's effective role stack at any moment is the result of evaluating its RoleFlow against the current fold of Reality.**

Three layered concepts make this work:

- **Being** — what something IS. Identity. Persists across moments. Carries `qualities.cognition.defaultKind`, `qualities.roleFlow`, and other persistent qualities.
- **Role** — what a being WEARS. Permissions (canSee/canDo/canSummon/canBe) plus a system prompt plus optional `requiredCognition`. Roles are world data, stored at reality root, authored at runtime, composable.
- **Cognition** — how acts are PRODUCED. Three closed values: `"llm"`, `"human"`, `"scripted"`. Lives on the being, not the role. Computed at moment-assign as `qualities.inhabit ? "human" : qualities.cognition.defaultKind`.

The doctrinal sentence to commit to FACTORY.md:

> _A Being IS (identity). A Being WEARS (role stack, evaluated per moment via RoleFlow). A Being IS-DRIVEN-BY (cognition, computed from defaultKind and inhabit state). The substrate is the runtime; the world is the source of truth._

---

## Section 2 — What Gets Removed

Before adding the new architecture, name what dissolves. These are conceptual primitives that the new model makes unnecessary.

### Removed: `operatingMode` on Being

The being-type distinction (`llm` / `human` / `scripted` as a being attribute) goes away. Beings are beings; cognition is computed from inhabit state and defaultKind. The schema field is deleted. Every reader of `operatingMode` migrates to `beingCognition(being)`.

### Removed: `cognition` field on Role

Roles are job descriptions. They don't carry cognition. A factory_worker is a factory_worker whether a human or an LLM is doing it. Only special-case roles that semantically require a specific cognition (human_conversationalist, deterministic_drummer) carry `requiredCognition`.

### Removed: One-role-per-being assumption

A being doesn't wear one role at a time. It wears a stack. The stack is evaluated per moment from RoleFlow. The primary role is the first; modifiers (emotions, conditions, situational adjustments) stack onto it.

### Removed: Static role assignment at birth

Beings don't have a fixed role. They have a RoleFlow. The role is computed at moment-assign by reading the world.

### Removed: Hard-coded behavior in extensions

Extensions that hard-code "this being type does this thing" lose that coupling. Behavior is composed from roles, which are world data. Extensions ship role definitions; the RoleFlow decides when they apply.

### Removed: Bespoke conditional logic in cognition paths

Instead of `if (being.isHuman) ... else ...` scattered through the codebase, the moment runner reads one thing: the composed role stack. The dispatch is uniform; conditional logic is in the data (RoleFlow conditions) not the code.

---

## Section 3 — The Architecture

### Schema additions

**On every being:**

```js
qualities.cognition = {
  defaultKind: "llm" | "human" | "scripted", // what this being is, normally
  config: {
    // For "llm": connector, systemPromptOverride, temperature, etc.
    // For "human": fallback role name when not inhabited
    // For "scripted": handler reference
  },
};

qualities.inhabit =
  null |
  {
    inhabitedBy: "<operator-being-id>",
    since: "<iso-timestamp>",
  };

qualities.roleFlow = [
  // Primary clauses — first match wins
  { when: { ...condition }, role: "<role-name>" },
  { role: "<default-role-name>" }, // unconditional fallback

  // Stacked clauses — all matching append
  { stack: true, when: { ...condition }, role: "<modifier-role-name>" },
];
```

`qualities.inhabit` is **not directly written**. It's a projection — the connection-tracking reducer maintains it from BE:connect/release facts.

### Computed properties at moment-assign

**Effective cognition:**

```js
beingCognition(being) = being.qualities.inhabit ? "human" : being.qualities.cognition.defaultKind
```

**Effective role stack:**

```js
resolveRoleStack(being, summonCtx) = {
  const primary = firstMatchingNonStackedClause(being.qualities.roleFlow, summonCtx);
  const modifiers = allMatchingStackedClauses(being.qualities.roleFlow, summonCtx);
  return [primary, ...modifiers].filter(role =>
    !role.requiredCognition || role.requiredCognition === beingCognition(being)
  );
}
```

Roles whose `requiredCognition` doesn't match the being's effective cognition drop from the stack. The remaining stack is what the moment uses.

**Composed prompt and permissions:**

```js
composeRoles(stack) = {
  canSee: union(stack.map(r => r.canSee)),
  canDo: union(stack.map(r => r.canDo)),
  canSummon: union(stack.map(r => r.canSummon)),
  canBe: union(stack.map(r => r.canBe)),
  systemPrompt: stack.map(r => r.systemPrompt).join("\n\n---\n\n"),
}
```

Permissions union. System prompts concatenate in stack order, separated by a divider that signals to the LLM that distinct frames are being layered.

### Where roleFlow evaluates

In the moment lifecycle, at moment-assign time, before fold:

1. Read the being's `qualities.roleFlow`.
2. Read the wake envelope (who summoned, why, what carrying).
3. Read the world state via SEE (the being's current space, position, neighbors, time of day, etc. — anything in the condition vocabulary).
4. Evaluate roleFlow → composed role stack.
5. Pass composed stack to fold (the fold respects the stack's canSee).
6. Pass composed stack to cognition (the prompt is the composed prompt; tools are the unioned canDo/canSummon/canBe).
7. Moment proceeds; act produced; seal.

The stack is **fixed for the moment**. It doesn't change mid-moment. If the world changes during the moment such that the roleFlow would resolve differently, that affects the _next_ moment, not this one. This preserves the four-beat coherence.

---

## Section 4 — The Condition Vocabulary

The expressive surface of the RoleFlow is determined by what conditions can be expressed. The condition vocabulary is the language. Define it precisely.

### Top-level operators

- `eq`, `ne`, `gte`, `lte`, `gt`, `lt`, `in`, `notIn` — value comparison
- `and: [...]`, `or: [...]`, `not: {...}` — composition
- `present: true | false` — field existence check

### Subject namespaces

**Who:**

- `connectedFrom` — caller's being ID
- `caller.role` — caller's effective primary role
- `caller.isAncestor`, `caller.isDescendant`, `caller.isSelf` — lineage relation
- `caller.cognition` — caller's effective cognition

**What:**

- `verb` — "see" | "do" | "summon" | "be"
- `action` — DO action name
- `operation` — BE op name
- `intent` — classified message intent (if available)

**Where:**

- `space.name`, `space.id`, `space.type`, `space.heavenSpace` — space identity
- `coords.x`, `coords.y` — current position
- `inHomeSpace` — am I at my homeSpace
- `inTreeOf(beingId)` — am I in another being's tree
- `spaceQuality(namespace, key)` — read a quality on current space

**Me:**

- `me.inhabitedBy` — null or operator-id
- `me.quality(namespace, key)` — read my own quality
- `me.role.previous` — primary role from previous moment (for inertia)
- `me.cognition` — my effective cognition

**Time:**

- `time.dayOfWeek` — 0-6
- `time.hour` — 0-23
- `time.iso` — full ISO timestamp
- `time.sinceLastMoment` — seconds since previous moment for this being

**World signals (extension-extensible):**

- `world.<namespace>.<key>` — read a published world signal
- Examples: `world.harmony.tick.alive`, `world.court.inSession`, `world.weather.condition`

### Authoring example

The court-judge example from the original sketch:

```js
qualities.roleFlow = [
  // Primary role selection
  { when: { connectedFrom: { eq: "$me.parent.beingId" } }, role: "human" },
  {
    when: { and: [{ verb: "summon" }, { "caller.role": "human" }] },
    role: "human_conversationalist",
  },
  {
    when: {
      and: [
        { "space.name": "court" },
        { coords: { x: 12, y: 12 } },
        { "world.court.inSession": true },
      ],
    },
    role: "judge",
  },
  { role: "court_watcher" }, // default

  // Stacked modifiers
  {
    stack: true,
    when: { "world.harmony.tick.sinceMs": { gte: 30000 } },
    role: "bored",
  },
  {
    stack: true,
    when: { "world.court.recentDisturbance": true },
    role: "alert",
  },
];
```

Read top-to-bottom: first match for primary, all matches for stacked. The being's behavior in a court session at the correct seat is "judge" with possibly "bored" or "alert" stacked depending on context.

### Determinism requirement

The condition vocabulary is a pure function. Same inputs always produce the same role stack. No randomness, no out-of-band data, no fetching beyond what SEE can resolve at moment-assign. This is what makes replay-from-zero produce identical behavior.

---

## Section 5 — The Role Registry

### Storage

Roles are stored at reality root in a canonical registry. One definition per role name. Edit once, propagate everywhere a being's roleFlow references that role name.

Role spec:

```js
{
  name: "factory_worker",
  description: "Assembles skateboards on the line.",

  // Permissions (any may be empty)
  canSee: ["station", "conveyor", "qa_dashboard"],
  canDo: ["operate_lathe", "attach_trucks", "log_defect", "request_break"],
  canSummon: ["supervisor"],
  canBe: [],  // most roles don't restrict BE ops

  systemPrompt: "You're a worker at SkateCo's main factory. The line moves at...",

  // Optional — role requires specific cognition
  requiredCognition: undefined,  // any cognition works

  // Optional — documentation hint
  intent: "primary",  // or "modifier" — non-enforced authoring guidance

  // Origin tracking
  origin: "extension" | "seed" | "live",  // where this role came from
  authoredBy: "<being-id>",  // who authored, for live roles
  authoredAt: "<iso-timestamp>",
}
```

### Origin tracking

Roles can come from three places:

- **`origin: "extension"`** — registered by an extension's manifest. Standard library.
- **`origin: "seed"`** — registered by reality root at boot. Built into the substrate.
- **`origin: "live"`** — authored at runtime by a being with `canDo: ["create-role"]`. Stored on the chain as a fact; the registry rehydrates from facts.

Live roles are first-class. The registry treats them identically to extension/seed roles. The role-manager being can author them via its UI.

### Modifier vs primary

The `intent` field is documentation — it tells authors "this role is meant to be stacked" or "this role is meant to be primary." The substrate doesn't enforce; roles are roles. But authoring tools (the role-manager UI) can use the hint to organize.

### Conventional emotion-roles

Recommended common modifier roles, available in a base "emotions" extension:

- `bored` — attention drifts, seek novelty
- `tired` — actions slower, prefer rest
- `focused` — block distractions, prioritize current goal
- `curious` — explore, ask questions
- `cautious` — verify before acting
- `urgent` — speed matters, accept lower quality
- `playful` — willing to do unexpected things
- `formal` — measured language, observe protocols

Each is a small role with a short system prompt. Beings stack them via RoleFlow conditions. Extensions can add more.

---

## Section 6 — The Move from RoleFlow to World Programming

Here's where the substrate becomes a programming language. These are emergent patterns that fall out of RoleFlow + stacking + the condition vocabulary. None require additional substrate work — they're authoring patterns.

### Pattern 1 — Environmental programming via space qualities

A space's qualities are world state. A being's roleFlow can read them. So a space can program every being inside it.

```js
// In the library space's qualities:
qualities.ambient.tone = "quiet"

// In every being's roleFlow:
{ stack: true, when: { "space.quality.ambient.tone": "quiet" }, role: "library_voice" }
```

Walk into the library → `library_voice` modifier stacks → being behaves quietly. Walk out → modifier unstacks. The library configures the behavior of beings in it without those beings knowing about libraries specifically.

This pattern enables ambient game-state: a "battle" space stacks `combat_ready`, an "office" space stacks `professional`, a "home" space stacks `relaxed`.

### Pattern 2 — World signals as coordination

Beings whose roleFlows read the same world signal coordinate without communicating.

```js
// Drummer publishes:
do(self, "set-world-signal", {
  namespace: "harmony",
  key: "tick.alive",
  value: true
})

// Every dancer's roleFlow:
{ when: { "world.harmony.tick.alive": true }, role: "dance" },
{ role: "idle" }  // default when no tick alive
```

All dancers dance together; all stop together. The world signal is the synchronization primitive. No message-passing required.

This enables flocking, mob behavior, scheduled events, weather-affected behavior — anything that depends on a shared world state.

### Pattern 3 — Goal-roles for emergent behavior

Roles can encode goals, not just behaviors. A being can stack multiple goal-roles; the LLM weighs them naturally.

```js
{ stack: true, when: { "me.quality.hunger": { gte: 0.7 } }, role: "seeking_food" },
{ stack: true, when: { "world.predator.nearby": true }, role: "avoiding_predator" },
{ stack: true, when: { "me.quality.lonely": { gte: 0.5 } }, role: "seeking_company" },
```

The LLM gets a prompt with all three goal-frames stacked. It produces an act that balances them ("avoid the predator while keeping near food sources and within sight of friends"). Utility-AI behavior without coding utilities.

### Pattern 4 — Behavior contagion via reading other beings' roles

Roles can read other beings' current roles. Social signaling, emotional contagion, peer pressure.

```js
{ stack: true, when: { "nearbyBeings.anyWearing": "panicked" }, role: "concerned" },
{ stack: true, when: { "nearbyBeings.countWearing": { role: "fleeing", gte: 3 } }, role: "fleeing" },
```

A panic spreads through a crowd because each being's roleFlow reads its neighbors. Crowd dynamics emerge from individual rules.

### Pattern 5 — Time-driven behavior schedules

The `time.*` namespace makes scheduling declarative.

```js
{ when: { "time.hour": { gte: 9, lt: 17 }, "time.dayOfWeek": { in: [1,2,3,4,5] } }, role: "working" },
{ when: { "time.hour": { gte: 22 } }, role: "sleeping" },
{ role: "leisure" }  // default
```

A being works weekdays 9-5, sleeps 10pm-onwards, otherwise leisures. No scheduler-being needed; the substrate reads time as another world signal.

### Pattern 6 — Recursive authoring (beings author roles for beings)

A "trainer" role's canDo includes `create-role` and `set-roleFlow` on its students. A trainer being can mint custom roles for students and configure their behavior.

This makes the world's authoring surface in-world. New behavioral primitives emerge during play without code changes. The vocabulary of what beings can be expands as the world runs.

---

## Section 7 — The Build Order

Land in this order. Each step is independently testable. Don't bundle.

### Step 1: The cognition migration (foundational)

The structural prerequisite. Touches every reader of `operatingMode`.

**Substrate changes:**

- Strip `operatingMode` from Being schema. Drop the index.
- Add `qualities.cognition.{defaultKind, config}` to Being schema.
- Add `qualities.inhabit` to Being schema (object or null).
- Add `beingCognition(being)` helper in `lookups.js` — synchronous, no DB call, returns inhabit-aware effective cognition.
- Add optional `requiredCognition` to Role schema (closed-set: llm | human | scripted | undefined).

**Sweep:**

- Every reader of `being.operatingMode` becomes `beingCognition(being)`.
- Every writer of `operatingMode` at birth/plant migrates to `qualities.cognition.defaultKind`.
- Cherub's registration path sets `defaultKind: "human"` for identity beings.
- Birther's create-being uses substrate default: `defaultKind: "llm"` with the reality's default LLM connector.
- Seed delegates (cherub, llm-assigner, arrival, drummer, etc.) get appropriate defaultKinds per existing operatingMode values.

**Inhabit:**

- Cherub's connect handler gets a second auth path: "inherit." When caller is connected to a being in the target's lineage (descendants only, per Rule A from the prior conversation), skip credentials and issue a fresh token.
- BE:connect via inherit path stamps a normal connect fact. The connection-tracking reducer maintains `qualities.inhabit` as a projection.
- Portal opens a second tab for the inhabited being. Each tab has its own JWT.
- Tab close fires BE:release on that token. Inhabit projection clears.

**Verify:**

- Drop DB, replant. Drummer ticks (scripted), dancer-llm attempts step (llm), no orphan Acts.
- Inhabit a child being from operator-self. Second tab opens. Inhabit projection set on child. Release on tab close clears projection.

### Step 2: RoleFlow evaluator and primary-role selection

The first half of the RoleFlow primitive. Stacking comes in step 3.

**Substrate changes:**

- Add `qualities.roleFlow` to Being schema (array of clauses).
- New module `roleFlowEvaluator.js`: takes `(being, summonCtx, worldFold)`, returns the resolved primary role name.
- New module `evalWhen.js`: evaluates a `when` clause against a context, returns boolean.
- Implement the condition vocabulary (Section 4) — start with the core subjects (who/what/where/me/time), add namespaces incrementally.
- Hook the evaluator into `assign.js` where `activeRole` is computed today.

**Backward compatibility:**

- If a being has no `qualities.roleFlow`, fall back to existing role assignment (use `defaultRole`).
- Existing scripted beings and built-in delegates can leave their roleFlow unset; they continue to work as before.

**Verify:**

- Author a roleFlow on a test being with two clauses (one conditional, one default). Switch conditions. Confirm the primary role changes accordingly.
- Confirm determinism: same conditions twice → same role twice.

### Step 3: Role stacking

Adds the modifier concept on top of primary-role selection.

**Substrate changes:**

- Extend `qualities.roleFlow` clauses to support `stack: true` marker.
- Update `roleFlowEvaluator.js`:
  - First-match-wins for non-stacked clauses → primary role.
  - All matches collected for stacked clauses → modifier roles.
  - Return composed stack `[primary, ...modifiers]`.
- New module `roleComposer.js`:
  - Takes a stack, returns composed role with unioned permissions and concatenated prompts.
- Hook composer into the moment runner: fold uses composed canSee, cognition uses composed prompt, dispatch uses composed canDo/canSummon/canBe.

**Required cognition check — fall-through doctrine:**

- `resolveActiveStack` filters EACH clause by `requiredCognition` as it walks. A clause whose role declares a `requiredCognition` that doesn't match `beingCognition(being)` is skipped; the walk continues. The first non-stacked clause that survives the filter becomes primary. Stacked clauses keep accumulating; cognition-mismatched modifiers drop silently.
- If no non-stacked clause survives the filter, the primary falls back to `toBeing.defaultRole`. `defaultRole` is NOT filtered by `requiredCognition` — it's the unconditional floor; operators choose it knowing it will run under any cognition.
- Inhabit example: a dancer being normally has cognition "llm" and primary clause names `dancer-llm` (requiredCognition: "llm"). When an operator inhabits via cherub Mode-3, the connection-tracking reducer flips `qualities.connection.inhabitedBy` and the being's effective cognition becomes "human" for the duration. The next moment's `resolveActiveStack` walks the flow, skips `dancer-llm` (cognition mismatch), finds the next clause that survives — or falls back to `defaultRole`. The moment runs cleanly under the new primary; no special-case dispatch required.
- Edge case: if `entry.activeRole` was explicitly requested (caller named a specific voice) AND that role's `requiredCognition` mismatches, `composeStack` returns null and the moment skips with `role-unavailable`. The caller's explicit ask is honored over fall-through — typos and misconfigured callers fail loudly rather than silently running the wrong role.

**Verify:**

- Stack a `bored` modifier on a dancer. Confirm composed prompt contains both wallflower and bored frames.
- Confirm permissions union correctly across stacked roles.
- Confirm `requiredCognition` filtering works (a "human_conversationalist" role doesn't apply to a being with LLM cognition).

### Step 4: Live role registry

Enables authoring roles at runtime via the chain.

**Substrate changes:**

- New seed-level DO op `create-role` with arg schema for the full role spec.
- New seed-level DO op `update-role` (modify existing roles).
- New seed-level DO op `delete-role` (with care — fail if any being's roleFlow references the role).
- Role registry rehydrates from chain facts at boot. Live roles persist across restarts.
- Origin tagging: every role spec carries `origin` and (for live roles) `authoredBy` + `authoredAt`.

**Auth:**

- `create-role` requires `canDo: ["create-role"]` on the calling being's effective role stack. By default, only reality-manager and explicitly-authorized roles have this.

**Verify:**

- Author a new role via `do(role-manager, "create-role", {...})`. Confirm it appears in the registry.
- Reference the new role in a being's roleFlow. Confirm it composes correctly.
- Restart. Confirm the role persists (rehydrated from chain).

### Step 5: Reality-manager and role-manager beings + UI

The operator-facing authoring surface.

**Substrate changes:**

- Seed plant: `role-manager` being at reality root, with `canDo: ["create-role", "update-role", "delete-role"]` and reigning permissions.
- Role-manager's descriptor entry publishes `catalogs: { roles, permissions, beOps, operations }` (the delegate-as-catalog pattern from earlier).
- Reality-manager's descriptor entry publishes whatever managerial catalogs are needed.

**Portal UI:**

- Role-manager panel: reads `descriptor.beings[role-manager].catalogs`, renders pickers for canSee/canDo/canSummon/canBe, system prompt editor, requiredCognition selector. Submit fires `do(role-manager, "create-role", {...})`.
- Being panel: shows a being's roleFlow as an editable list of clauses. Add/remove/reorder clauses; pick role from registry; author when-conditions via a clause builder. Submit fires `do(being, "set-roleFlow", [...])`.
- Birther panel: mint a new being. Set initial roleFlow. Set initial cognition.
- Skin panel (from prior spec): drag-and-drop model upload; sets being's `qualities.render`.

**Verify:**

- Operator at fresh land. Mints a being via birther panel. Inhabits the child. Configures its skin, cognition, roleFlow via panels. Releases. Child runs autonomously per its configuration.

### Step 6: Emotional-modifier extension

A "library" extension that demonstrates the stacking pattern.

**Contents:**

- A small set of modifier roles: `bored`, `tired`, `focused`, `curious`, `cautious`, `urgent`, `playful`, `formal`.
- Each role has a short system prompt and `intent: "modifier"`.
- Documentation in EXTENSION_FORMAT.md showing how to author roleFlow clauses that stack these.

**Verify:**

- Stack `bored` on the wallflower-dancer when no neighbors have moved in 10 ticks. Confirm the dancer's behavior visibly shifts.

### Step 7: World signals primitive (the substrate hook for environmental/coordination patterns)

The mechanism that makes patterns 1, 2, and 5 (environmental, coordination, time) work cleanly.

**Substrate changes:**

- Add `world.<namespace>.<key>` to the condition vocabulary.
- World signals are read from space qualities — typically published on the reality root or on space qualities of relevant rooms.
- New DO op `set-world-signal` (or just `set-space-quality` if it covers the use case): writes to a space's qualities.

**Verify:**

- Drummer publishes `world.harmony.tick.alive`. Dancers' roleFlows read it. Drum stops → dancers fall to idle role. Drum starts → dancers re-acquire dance role.

### Steps 8+: Emergent patterns

Patterns 3-6 from Section 6 (goal-roles, behavior contagion, recursive authoring) don't need additional substrate. They become authoring conventions and example extensions. Add them as the world's content matures.

---

## Section 8 — What This Means

After all seven core steps land, TreeOS has these properties:

**Beings are reactive programs.** A being's behavior at any moment is computed from the chain. No internal hidden state controls behavior; the chain is everything.

**Programming is declarative.** Authors write _what conditions activate what roles_, not imperative per-moment logic. The LLM (or scripted handler, or human) fills in execution at the leaves.

**Cognition is interchangeable at the leaves.** A being can be LLM-driven, human-driven, or scripted. The roleFlow doesn't change. Switching cognition is a one-field update.

**Roles compose.** N primary roles × M modifier roles = N×M behavioral combinations from N+M role definitions. Combinatorial expressiveness without combinatorial authoring.

**Behavior is replayable.** Same chain replays to the same behavior. The roleFlow + role registry + chain are the program; replay-from-zero is the execution.

**Authoring is in-world.** Roles and roleFlows are world data. Beings with appropriate permissions author them. New behavioral primitives emerge during play.

**Coordination is implicit.** Beings that read the same world signals coordinate without messaging. Spaces affect their inhabitants by carrying qualities the inhabitants' roleFlows read.

**The world is the source code.** What the chain projects to becomes the input to every being's roleFlow. Changing the world changes behavior. The world is literally the program text.

---

## Section 9 — The Anti-Goals (What This Does NOT Do)

Be explicit about what's deliberately left out to keep the substrate small.

**No subtractive permissions.** Roles can only add capabilities, never remove them. Constraints come from prompts, not from substrate-level deny rules.

**No mid-moment role-switching.** The role stack is fixed for the moment. World changes affect the next moment.

**No nondeterministic roleFlow.** No random, no fetch-during-eval, no out-of-band data. Pure function of moment inputs.

**No role inheritance hierarchy.** Roles don't extend other roles. If you want shared behavior, factor it into a modifier role and stack it.

**No behavior accumulation over time (yet).** The roleFlow reads current world state, not historical patterns. Beings don't "develop" character organically yet. If wanted, add later as projection-from-history; defer indefinitely.

**No code execution in conditions.** The condition vocabulary is a fixed grammar of operators and namespaces. No eval, no script blocks. Keeps replay deterministic and prevents injection.

**No role-modifier role-modifier composition.** A modifier role doesn't itself have modifiers stacked on it. The stack is flat.

**No automatic role lifecycle management.** A role added by roleFlow stays as long as its condition matches. There's no "this role expires after N ticks" — express that as a condition (`when: { time.sinceLastMoment: { lte: 30 }}`).

---

## Section 10 — Old Mess This Cleans Up

Direct dissolutions of prior architecture:

- **`operatingMode` field** — gone. Replaced by `qualities.cognition` on being.
- **Being-type if/else throughout codebase** — gone. Uniform dispatch by composed role.
- **Hard-coded role per being** — gone. Roles emerge from roleFlow at moment-assign.
- **Special-case scripted-vs-llm-vs-human paths in moment runner** — collapsed. One path; cognition reads off being; behavior composes from stack.
- **Static extension role assignments** — opened up. Extensions ship role definitions; the world (via roleFlow) decides when they apply.
- **Cherub's connect duplication for inherit-vs-credential** — unified. One connect handler, two auth paths.
- **Hard-coded inhabit logic** — gone. Inhabit is a projection of BE:connect/release facts. No special inhabit state machine.

---

## Section 11 — Closing Statement

This is the doctrinal landing for what TreeOS is, finalized:

TreeOS is a declarative behavioral programming substrate where the world itself is the source of truth and the trigger for behavior. Beings are reactive programs whose behavior at every moment is composed from a stack of roles, where the stack is determined by RoleFlow — conditional rules reading the world's current fold. Cognition (LLM, human, or scripted) is the universal-fallback leaf operation that produces acts within the composed role context. Roles are world data: authored at runtime, composable, replayable. The chain is the program; replay is the debugger; the substrate is the runtime.

Roles + RoleFlow + the condition vocabulary form a small language for programming beings. Stacking gives combinatorial expressiveness from primitive role definitions. World signals enable coordination without message-passing. Spaces with qualities program their inhabitants. The reality-manager is the IDE.

The build plan above implements this architecture in seven core steps. Each step is independently testable, removes old mess, and stays primitive — no new substrate primitives beyond `qualities.cognition`, `qualities.roleFlow`, optional `requiredCognition` on roles, and the condition-vocabulary evaluator. Everything else is data and authoring conventions.

This document is the canonical reference for the RoleFlow system. When in doubt about behavior composition, role authoring, or how a being's act gets produced, return here.

# BUILT:

Comprehensive breakdown of everything that landed from the spec.

1. Substrate — the evaluator and composer
   New primitives in seed/present/roles/:

roleFlow.js — pure evaluator. resolveActiveStack({ toBeing, entry, handoff, space, callerEnrichment, previousMoment, now, worldSignals }) returns [primary, ...modifiers]. Walks clauses, filters by requiredCognition, first-match-wins for primary, all matches for stacked. ~370 lines.
roleComposer.js — folds the stack into one role-shaped spec. Unions canSee/canDo/canSummon/canBe/permissions. Composes prompts with named modifier framing ("Additionally, you are currently in this mode — emotions:bored: <body>") rather than bare divider. Primary's summon handler propagates for scripted dispatch. ~180 lines.
role-manager/role.js — role-manager delegate definition. canDo = set-role, delete-role, set-world-signal.
role-manager/ops.js — the three DO ops (below).
birther/role.js — authenticated-mint delegate (existed earlier, unchanged here).
Condition vocabulary the evaluator understands today:

Bucket Paths
Who connectedFrom, caller.beingId, caller.name, caller.role, caller.cognition, caller.isSelf, caller.isAncestor, caller.isDescendant
What verb, action, operation, intent
Where space.id, space.name, space.type, space.heavenSpace, space.quality.<ns>.<k>, coords.x/y, inHomeSpace
Me me.beingId, me.name, me.role, me.previousRole, me.cognition, me.position, me.homeSpace, me.quality.<ns>.<k>
Time time.hour, time.dayOfWeek, time.iso, time.sinceLastMoment
World world.<namespace>.<key>
Operators: eq, ne, in, notIn, gt, gte, lt, lte, present. Composites: and, or, not.

2. Schema + state changes
   Being row (seed/materials/being/being.js):

Change What
Removed operatingMode field
Removed roles: [String] carry list (and its index)
Kept defaultRole — the unconditional floor
Added in qualities qualities.cognition.defaultKind ∈ {"llm", "human", "scripted"}
Added in qualities qualities.roleFlow — array of { when?, role, stack? } clauses
Added in qualities (projected) qualities.connection.inhabitedBy — set/cleared by BE:connect / BE:release reducer
Space row qualities (no schema change, new convention):

qualities.world.<namespace>.<key> — world signals namespace on reality-root space
Roles registry (in-memory, not schema):

requiredCognition field added to role spec
origin field tagged: "seed" | "<ext-name>" | "live"
Where reducers handle these:

seed/materials/reducerHelpers.js — applySetQualities accepts arrays at namespace level when merge:false (roleFlow needs this); deep-path writes work for qualities.world.<ns>.<k>
seed/materials/being/reducer.js — applyConnectionState projects BE:connect/release into qualities.connection.inhabitedBy 3. DO operations added
All registered through seed/present/roles/role-manager/ops.js:

Op Purpose Refusal mode
set-role Create/replace live role at ./roles/<name> AND hot-register into the in-memory registry Persisted to .roles mirror; in-memory hot-register error surfaces but mirror write succeeds
delete-role Remove a live role Refuses with usage list when any being's roleFlow or defaultRole references it; force:true bypasses
set-world-signal Write <reality-root>.qualities.world.<namespace>.<key> Validates kebab-case namespace + key segments
Plumbing change in seed/scopedReality (now resources/scopedReality.js): declare.registerRole now auto-passes manifest.name as the third arg, so extension-registered roles get origin: "<ext-name>" instead of falsely tagged as "seed".

BE:birth extended in seed/ibp/verbs/be.js: Payload now accepts roleFlow (array or JSON string). Threads through summonCreateBeing → createBeingWithHome → createBeing → stamps qualities.roleFlow at birth.

4. Moment runner integration
   seed/present/beats/1-assign.js:

Loads being + space row (the space row now selects qualities too)
Async-precomputes callerEnrichment = { cognition, isAncestor, isDescendant } (Being.findById + isAncestorOf × 2)
Looks up previousMoment via findLastSealedForBeing
Snapshots reality-root's qualities.world subtree via loadWorldSignals()
Calls resolveActiveStack, then composeStack, hands the composed role to the rest of the moment runner
Dropped the roles[] carry-check entirely
Past this boundary, the rest of the runner (assemble.js, momentum.js, llmMoment.js, summon.js) reads the composed spec as if it were a regular role — they don't know stacking exists.

5. Extensions
   resources/emotions/ — modifier-role pack. Eight roles: emotions:bored / tired / focused / curious / cautious / urgent / playful / formal. Each is a short prompt, no can\* entries, intent: "modifier" tag (docs-only).

6. Portal changes
   Shared module (reality/portal/shared/):

role-manager-panel.js — three-section panel (existing roles list, create new role form, your-own roleFlow editor) reading descriptor.beings[role-manager].catalogs via the delegate-as-catalog pattern. Exports renderFlowEditor(allRoles, ctx, { headerLabel, initialFlow, targetStance }) reusable across panels.
being-flow-panel.js — per-being flow editor. Renders header (cognition, defaultRole, id tail) + the shared renderFlowEditor pointed at any being.
Flat-app:

renderer.js — inspector shows the being-flow panel inline for any non-delegate being when signed in
@role-manager inspect opens the dedicated panel via renderRoleManagerPanel
3D-app:

role-manager-panel.js + being-flow-panel.js — modal frames around the shared renderers
main.js — onBeingActivate routes role-manager to its panel; openBeingActionMenu adds synthetic "Edit Role Flow" action for every being; isGameplayInputBlocked folds in both panel-open checks
Descriptor delegate-as-catalog (seed/ibp/descriptor.js):

enrichBeings populates entry.catalogs only on role-manager's entry
Publishes { roles, addresses, operations, beOps } — names + light metadata, server-side, with reigning view inherent
addresses catalog (formerly mis-wired tools) lists curated IBP paths: ~, ./identity, ./config, etc.
The birther action's args schema now includes roleFlow (multiline JSON) 7. Verification
.test/scripts/verify-roleflow-determinism.js — 6 cases, 20 checks, 0 fails. Pure-evaluator unit test (no DB). Covers identical-inputs/identical-output, time-anchor purity, absent world signal safety, requiredCognition fall-through, 1000-call stability + perf. Evaluator at 0.004ms / composer at 0.005ms avg.

8. Documentation
   seed/FACTORY.md — new section in Roles chapter describing the stack/composer doctrine, condition vocabulary, three live-author ops, pointer to role-manager.md. Also the earlier "Delegates publish what they mediate" section under heaven.

seed/role-manager.md — the canonical spec, with the requiredCognition fall-through doctrine appended.

site/src/components/Welcome/FactoryRoles.jsx — public-facing page at /factory/roles. Eight sections covering pieces-from-extensions, single-role anatomy, three cognitions, stack + flow, when system in simple terms with three concrete examples, birth+inhabit flow, world-as-codebase synthesis.

What's done vs the spec, step by step
Step Title Status Notes
1 Cognition migration ✅ Done operatingMode gone, qualities.cognition, qualities.connection.inhabitedBy projection, beingCognition() helper, cherub Mode-3 inhabit, portal inhabit flow
2 RoleFlow evaluator + primary role ✅ Done Vocabulary covers everything in spec Section 4 except inTreeOf(beingId) as a callable and nearbyBeings.\* (those are Pattern 4 / Step 8 emergent territory)
3 Role stacking ✅ Done stack:true, composer, requiredCognition filter on composed stack
4 Live role registry ✅ Done set-role hot-registers, delete-role with reference safety, persistence via .roles mirror
5 role-manager UI ✅ Mostly Role-manager panel, per-being flow editor, birther's initial roleFlow form — all built. Skin panel and reality-manager panel deferred (you said skip Chunk 7)
6 Emotions extension ✅ Done 8 modifier roles shipped
7 World signals ✅ Done world.<ns>.<k> in vocab, set-world-signal op, snapshot via loadWorldSignals
8+ Emergent patterns 🟡 Substrate ready, not authored The patterns from Section 6 (goal-roles, behavior contagion via nearbyBeings, recursive authoring, time schedules, environmental programming) are all authorable today. The skids are there; no canonical examples shipped beyond emotions.
What needs further building
Explicitly deferred (you said no):

Skin panel — drag-and-drop qualities.render upload
Reality-manager operator panel — config/extensions/llm aggregation surface
Not built, would close authoring gaps:

nearbyBeings.\* vocabulary — read other beings' current roles (Pattern 4: behavior contagion). Substrate change: need a nearbyBeings enrichment in assign.js that scans desc.beings at the moment's space and surfaces their currently-resolved roles. Then add nearbyBeings.anyWearing, nearbyBeings.countWearing to the field catalog.
inTreeOf(beingId) operator — am I in another being's lineage. Different shape from current operators (takes a parameter); needs a new condition form.
Polish that didn't ship:

Live-role restart persistence test — quick verifier (or manual: set-role → restart → confirm registry has it). The infrastructure is there (loadLiveRolesFromSubstrate runs at boot), but no automated test yet.
intent: "modifier" surfaced in panel — currently a doctrine-only field on role definitions. The role-manager panel could group "primary" vs "modifier" roles in its pickers using this hint.
set-world-signal namespace registration — currently wild-west (any kebab-case namespace works). For a public release, you may want a registry so two extensions don't clobber each other's signals.
Reorder clauses in the flow editor — currently you can add/remove clauses but not drag-to-reorder. Order matters (first-match-wins for primary).
Save-then-reload feedback — flow editor saves work but the descriptor doesn't re-fetch automatically; user needs to navigate away and back to see the saved flow in the inspector.
In-flow JSON view + edit — for power users who want to paste / edit the raw array. Currently mad-libs-only.
Things called out in the spec that are deliberate non-goals (kept as such):

No subtractive permissions
No mid-moment role switching
No nondeterministic roleFlow
No role inheritance hierarchy
No behavior accumulation over time projections
No code execution in conditions
No modifier-of-modifier composition
No automatic role lifecycle
End-to-end verification you'd want to run yourself before declaring v1:

Sign in as tabor → role-manager panel shows emotions:\* alongside seed/extension roles with correct origins
Author a roleFlow clause on yourself with time.hour: { gte: 9, lt: 17 } stacking emotions:focused; trigger a moment in/out of window; verify composed prompt contains the right frames
set-world-signal { namespace, key, value } then watch another being whose flow reads it
Live-author a role, restart, confirm it's still in the registry (the persistence test the spec asks for)
Inhabit a child, observe caller.cognition: human in your roleFlow during the inhabit moment
Run the determinism verifier (already passes locally: 20/20)
Files to look at if you want to read the build:

seed/role-manager.md — canonical spec
seed/present/roles/roleFlow.js — evaluator
seed/present/roles/roleComposer.js — composer
seed/present/roles/role-manager/ops.js — the three live-author ops
seed/present/beats/1-assign.js — where everything plugs into the moment
portal/shared/role-manager-panel.js + being-flow-panel.js — UI
resources/emotions/ — example modifier extension
.test/scripts/verify-roleflow-determinism.js — purity contract
site/src/components/Welcome/FactoryRoles.jsx — the public explanation
That's the full RoleFlow build from the spec, what's wired, and what's left if you want to push further.
