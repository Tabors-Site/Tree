# governing/roles/ — new-shape role templates (in-progress)

Parallel folder to `modes/` for the queue-driven rewrite. Both directories
coexist during the migration; the kernel reads from `modes/` until the
new roles are wired and validated, then the old `modes/` directory is
deleted.

## Why parallel, not in-place

The orchestrator's still running in `tree-orchestrator/`. Half-converting
governing in place would break things mid-flight. Writing new code beside
the old lets the system keep working while the new shape is built.

When the new roles are ready and verified end-to-end:

1. `index.js` swaps role-template registration from `modes/*` imports to
   `roles/*` imports.
2. The hire-* tools in `rulerTools.js` (already SUMMON-based) and the
   dispatch flow in `tree-orchestrator/dispatch.js` (being absorbed
   here) point at the new roles.
3. `modes/` deleted in the same diff that flips registration.
4. `tree-orchestrator/dispatch.js`, `ruling.js`, etc. deleted once
   nothing imports them.

## What changes between `modes/` and `roles/`

The old `modes/` files are "modes" — system prompts + tool lists.
They run inside the orchestrator's runChat loop. Each mode is data
the orchestrator interprets.

The new `roles/` files are "role templates" — full `role.summon`
functions that the kernel's scheduler invokes when a SUMMON arrives
in the inbox. Each role is the BEING ACTING. The orchestrator is gone.

Same LLM cognition inside; different scaffolding outside.

| Old (`modes/`) | New (`roles/`) |
|---|---|
| `mode.buildSystemPrompt(ctx)` reads snapshot, returns prompt string | `role.summon(message, ctx)` does it all — read substrate, build prompt, run LLM call, return result |
| `mode.toolNames: [...]` declares tools; orchestrator wires them | `role.summon` itself uses the tool layer the same way (MCP); the tool list is enumerated in the prompt build |
| Wakeup is a side-channel (`setRulerWakeup`, hook-bridge) | Wakeup is the SUMMON itself — `message.inReplyTo` + sender stance tells the role this is a reply |
| `runRulerTurn` in tree-orchestrator wires Ruler invocation | Kernel scheduler invokes `role.summon` directly; no orchestrator |
| Multi-step pipelines via `OrchestratorRuntime` | Multi-step is composition: role emits SUMMONs to other roles; `aggregate()` collects replies for fanout |
| Tool-driven dispatch via `setRulerDecision` + post-LLM dispatcher | Tools emit SUMMONs inline; no central dispatcher |

## Migration plan (Phase A of seed-first strategy)

Start from Ruler outward. Each step uses the substrate already built
(SUMMON queue, scheduler, role-pluralization, `aggregate()`, etc.).

1. **`rulerRole.js`** — Ruler's role.summon. Handles user messages AND
   reply-typed inbox entries (from Planner/Contractor/Foreman replies)
   uniformly. Replaces `runRulerTurn`. The existing
   `renderRulerSnapshot` + `governing` tools are reused unchanged.
2. **`plannerRole.js`** — Planner's role.summon. After emitting the
   plan artifact, SUMMONs the Ruler with the result (reply-typed).
   Replaces the `governing:plannerCompleted` hook firing path.
3. **`contractorRole.js`** — Contractor's role.summon. Same pattern
   as Planner (emit contract artifact, SUMMON Ruler with reply).
4. **`foremanRole.js`** — Foreman's role.summon. Absorbs the worker
   dispatch logic from `tree-orchestrator/dispatch.js`:
   - Walks plan steps.
   - For each leaf-group: SUMMONs the typed worker beings in parallel.
   - Uses `core.declare.aggregate({ correlations: [...], minReplies: N })`
     to wait for replies.
   - Synthesizes outcome; emits next step's SUMMONs (sub-Ruler for
     branch steps, next leaf-group otherwise).
   - On settle, SUMMONs Ruler with the result.
5. **`workerRoles.js`** — the four typed workers (build/refine/review/
   integrate). Mostly thin role.summon wrappers around the existing
   workspace tool logic. Reply-typed SUMMON back to Foreman on
   completion.
6. **`replyHandler.js`** — shared helper for detecting reply-typed
   inbox entries (via `message.inReplyTo` + sender role match) and
   loading the relevant substrate (active plan emission, contracts
   emission, execution record) for synthesis.
7. **Wire-up in `governing/index.js`** — register new roles via
   `core.declare.registerRole`. Old `modes/` registrations stay for the
   migration window so legacy callers keep working until flip.
8. **Flip the dispatch path**: `rulerTools.js`'s `hire-planner` etc.
   already emit SUMMONs to the planner role. Foreman's dispatch
   absorbed in step 4; the `governing-dispatch-execution` tool now
   SUMMONs the foreman with a `dispatch-plan` content payload instead
   of calling `dispatchSwarmPlan`. The orchestrator path retires.
9. **Delete** `modes/`, `tree-orchestrator/dispatch.js`, `ruling.js`,
   `orchestrator.js`, `graph.js`, `steppedMode.js`. Delete the hook
   subscribers in `governing/index.js`. Collapse `runChat` to a thin
   "deliver SUMMON" wrapper. Simplify the WS layer.

## What the substrate already provides (so this rewrite is bounded)

- `core.declare.registerRole(name, def)` — register the role template
- `core.declare.aggregate({ correlations, minReplies, timeoutMs })` —
  wait-for-N-replies primitive for the Foreman→Workers fanout
- `core.declare.schedule(beingId, opts)` — scheduled-wake registry (not
  used heavily by governing, but available)
- `core.declare.cancelByRootCorrelation(nodeId, beingId, rootCorrelation)`
  + scheduler `abortCurrent(beingId)` — cancellation cascade
- `core.declare.subscribe(beingId, opts)` — DO-trigger subscriptions if
  any role wants to react to substrate writes
- `Being.roles[]` + `defaultRole` + envelope.activeRole — role-
  composition kernel-level (per identity-durable-role-composable memo)

The roles only have to be the role.summon functions. The substrate
plumbing carries everything else.

## What stays from the legacy code

- **`state/`** — the substrate primitives (`rulerSnapshot.js`,
  `planNode.js`, `contractsNode.js`, `executionNode.js`,
  `rulerDecisions.js`, etc.). These are pure substrate readers and
  writers; both legacy and new roles use them.
- **`rulerTools.js`, `foremanTools.js`, `flagTools.js`** — the MCP
  tools the LLMs call. Already SUMMON-based for the hire-* path
  (Slices 4, 5a, 5b); rest stays as substrate writes.
- **`renderRulerSnapshot`** — the snapshot the Ruler reads at the
  top of every turn. Pure substrate read; reused unchanged.
- **`governing/index.js`** — the extension init. Updated to register
  new roles instead of new modes; hook subscribers deleted at the
  flip; everything else stays.

## Status

- 2026-05-18 — folder created; README written; rulerRole.js next.

References:
- [project_seed_first_strategy.md](../../.../.claude/projects/.../memory/project_seed_first_strategy.md)
- [project_identity_durable_role_composable.md](../../.../.claude/projects/.../memory/project_identity_durable_role_composable.md)
- [project_summon_is_being_plus_role.md](../../.../.claude/projects/.../memory/project_summon_is_being_plus_role.md)
