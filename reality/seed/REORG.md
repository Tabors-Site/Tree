# Seed reorg, deferred work

A scratchpad of structural cleanups that have been seen and parked.
Nothing here is being acted on now. The folder reads worse than it
should for one more pass; that is the deliberate cost of not
churning structure mid-flight.

Each item names: what's off, the cheapest fix, why it's deferred.

---

## 1. The four beats aren't visibly grouped (deferred)

`present/` root contains `assign.js`, `momentum.js`, `stamped.js`,
`moment.js`, `run.js`, `config.js`, plus `fold/` as a subfolder.
`ls present/` shows them alphabetically (assign → config → moment →
momentum → run → stamped), which is meaningless. A newcomer cannot
tell beat 1 from beat 4 without opening files.

**Fix:** group the four beats. Either move them into a `beats/`
subfolder (with `fold/` as `beats/2-fold/`) or prefix numerically
at root (`1-assign.js`, `2-fold/`, `3-momentum.js`, `4-stamped.js`).

**Why deferred:** would touch ~30 import paths across seed and
extensions. Not worth the churn this pass.

## 2. `intake/` mixes four concerns in one folder (deferred)

8 files, 2829 lines, four responsibilities:
- arrivals: `inbox.js`, `intake.js`, `scheduler.js`, `transportAct.js`
- wakes: `subscriptions.js`, `wakeSchedule.js`
- emit: `replies.js`
- session bookkeeping: `session.js`

`subscriptions.js` and `wakeSchedule.js` aren't really intake; they
are sources that produce intake. `replies.js` is the reverse
direction entirely.

**Fix:** split into `intake/arrivals/`, `intake/wakes/`,
`intake/replies.js`, `intake/session.js`. Or pull `wakes/` and
`replies.js` out as siblings of `intake/`.

**Why deferred:** import sprawl plus the conceptual split needs to
settle before structure does.

## 3. `voices/llm/runTurn.js` is still 1905 lines (deferred)

The graceful-jingling-garden plan from an earlier session called
for splitting this into `stamper.js + momentum.js + reelAligner.js`.
The directory got the new shape; `runTurn.js` itself did not get
split.

**Fix:** extract the Phase 6 loop body into a sibling and reduce
`runTurn.js` to the orchestrator. Plan still applies; the cut lines
were inventoried in the prior plan file.

**Why deferred:** real surgery, not naming. Not the right pass.

## 4. `voices/llm/connect.js` is 1262 lines (deferred)

"Resolve the LLM client for this being" should not be that big.
Probably has the 4-layer space/being lockout walk plus client
caching plus failover handling plus DNS plus SSRF all fused.

**Fix:** split by responsibility. `resolution.js` for the walk,
`cache.js` for client caching, `failover.js` for retry/failover,
keep `connect.js` as the thin entry.

**Why deferred:** internal surgery; doesn't change present/'s
readability. Tackle after #3.

## 5. `roles/` naming inconsistency (deferred)

- `llmAssigner.js` + `llmAssignerOps.js`
- `realityManager.js` + `realityManagerTools.js`

Two roles, two different suffix conventions for their
operations/tools. Either standardize on one suffix or co-locate
each role in its own subfolder (`roles/llmAssigner/{role,ops}.js`,
`roles/realityManager/{role,tools}.js`).

**Fix:** pick one. Probably `roles/<role>/role.js + tools.js` since
the role count is small and won't dwarf the folder.

**Why deferred:** trivial but touches every caller's import path.
Batch with another roles-touching pass.

## 6. `run.js` is 48 lines of pure doc (deferred)

It names the concept of a run (a stream of moments) but holds no
code. The actual loop lives in `voices/llm/runTurn.js`.

**Fix:** fold the prose into `moment.js`'s header and delete
`run.js`. Or grow `run.js` to host the concept's actual primitive
if one ever lands.

**Why deferred:** harmless as-is. The next time we reach for it,
either grow it or delete it.

## 7. `present/config.js` name collides mentally with seed-root configs (deferred)

The seed has `reality/seed/realityConfig.js` (outward identity) and
`reality/seed/internalConfig.js` (runtime knobs). `present/config.js`
is a *router* that fans `internalConfig` values down into
present-subsystem setters (`setLlmTimeout`, `setMaxPresenceReels`,
etc.). It's not a third config store, but the name suggests it
might be.

**Fix:** rename to `present/knobs.js` or `present/internals.js` so
readers know it's a router, not a store.

**Why deferred:** rename touches ~3 callers. Easy follow-up.

## 8. FACTORY.md doc-vs-code drift around `stamper.js` (resolved 2026-05-25)

FACTORY.md listed `present/stamper.js` as a "per-being moment-frame
primitive." No such file exists; the work is split across
`assign.js`, `moment.js`, and `stamped.js`. The line was struck
from FACTORY.md in this pass. Either no file is needed, or extract
a shared `openAct` / `sealAct` primitive into a real `stamper.js`
later if the duplication becomes a pain.

**Status: resolved (struck the doc line, kept the layout).**

---

## Cross-reference

Prior plan with finer-grained cut lines for #3:
`~/.claude/plans/graceful-jingling-garden.md` (cognition → factory
restructure; runTurn split inventory still useful).
