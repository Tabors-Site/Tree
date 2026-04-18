# swarm

Parallel inquiry as a primitive. Swarm dispatches a compound task into N child branches that each run as their own session, tracks their status, retries failures, resumes interrupted work.

## What this extension is for

Any goal that decomposes into independent sub-investigations that later reconverge. Code projects (backend + frontend + shared contracts), research papers (literature review + methodology + results + discussion), book chapters, data pipelines, curriculum modules, scientific protocols, legal briefs with multiple argument threads. Swarm is domain-agnostic; domain extensions layer policy on top.

## What this extension is NOT

Swarm owns no conversation modes and no domain knowledge. It doesn't know what a syntax error is, it doesn't know what a citation is, it doesn't know what a chapter outline looks like. All of that belongs to the domain extensions that subscribe to swarm's hooks.

## The contract

Swarm owns the metadata namespace `metadata.swarm` on every swarm-aware node (project roots and branches). Fields:

- `role` — `"project"` or `"branch"`
- `initialized` — true when the node has been promoted via ensureProject
- `systemSpec` — top-level task description (project root only)
- `subPlan.branches[]` — decomposition list, per-entry statuses
- `contracts[]` — invariants every branch respects (shape opaque to swarm)
- `inbox[]` — lateral signals; payloads opaque to swarm
- `aggregatedDetail` — rolled-up descendant state (filesWritten counts, status tallies, etc.)
- `events[]` — flat audit log, debounced
- `status` — pending | running | done | failed | paused (branch-level)

Domain extensions own their own namespaces for their own concerns. code-workspace keeps `metadata.code-workspace.role`, `workspacePath`, `planSteps`, etc. A book-workspace would do the same under `metadata.book-workspace`.

## The lifecycle hooks

All hooks fire via `core.hooks.fire("swarm:<name>", payload)`. Handlers that mutate the payload's `results` array will trigger a retry pass after `afterAllBranchesComplete`.

| Hook | Payload | When |
|------|---------|------|
| `swarm:afterProjectInit` | `{ projectNode, owner, systemSpec }` | ensureProject set role=project |
| `swarm:beforeBranchRun` | `{ branchNode, rootProjectNode, branch, branchMode }` | About to dispatch a branch |
| `swarm:afterBranchComplete` | `{ branchNode, rootProjectNode, branch, result, branchMode }` | Branch terminated (done / failed / paused). Handler can flip `result.status` to force a retry. |
| `swarm:afterAllBranchesComplete` | `{ rootProjectNode, results, branches, core, signal }` | Every branch terminated. Cross-branch validators run here. Handler can flip `results[].status` to trigger retry. |
| `swarm:branchRetryNeeded` | `{ rootProjectNode, results, branches }` | Status changes detected after afterAllBranchesComplete. Informational. |

## Coupling rules

- Extensions can call swarm exports via `getExtension("swarm")`.
- Extensions subscribe to swarm hooks via their manifest's `hooks.listens`.
- Swarm never imports from other extensions. Zero `getExtension("<anything>")` calls live in this folder.
- Swarm may dynamically import seed utilities (log, Node model, extensionScope for mode resolution). Everything else flows in as a callback (`runBranch`, `emitStatus`) or through `core`.

Violating any of the above breaks the decoupling. If you feel tempted, add a new hook instead.

## Branch mode resolution

Swarm does not know `tree:code-plan`. When dispatching a branch, it resolves the mode key in this order:

1. `branch.mode` — explicit in the `[[BRANCHES]]` block
2. `defaultBranchMode` — argument passed to `runBranchSwarm`
3. Ancestor walk — nearest extension on the branch node's ancestor chain whose `-plan` mode is registered

The walk uses `seed/tree/extensionScope.js` so it matches the kernel's mode/tool resolution chain.

## The [[BRANCHES]] block

Emitted by whichever mode the architect is running in. Swarm parses:

```
[[BRANCHES]]
branch: backend
  spec: Node.js + Express server with auth, swipe, match endpoints.
  mode: tree:code-plan     # optional; overrides the resolver
  slot: code-plan          # optional; LLM slot hint
  path: backend
  files: package.json, server.js, auth.js, db.js
[[/BRANCHES]]
```

And the optional `[[CONTRACTS]]` block for shared invariants. Parser is tolerant of malformed closers (several stages of fallback) because models sometimes emit `[[]/BRANCHES]]` / `[[end branches]]` variants.
