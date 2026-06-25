# Pre-OS readiness sweep — 2026-06-11

The full-sweep pass before the OS (Rust) port. A 6-examiner + critic workflow read the live DB, all seed/protocol/transport/portal code, SUMMON.md, INTAKE.md, and the portals; every headline was verified in code before acting. The chain core came back port-ready (627/627 facts CAS-clean, 337/337 acts hex64+p, zero stale folds, verifyReel passing). Scheduling, federation, portal-auth, and test infra were not — this sweep closed the correctness and security gaps and built the port's conformance scaffolding.

Everything below LANDED and is verified. The three OPEN FORKS at the end need a Tabor decision; none blocks the JS build.

## Landed — Tier 0 (wiring breaks)

- **Priority pick order.** The inbox sorted on the `priority` STRING enum, which sorts lexically to BACKGROUND-first — the exact inverse of intent. Added a numeric `priorityRank` (HUMAN 1, GATEWAY 2, INTERACTIVE 3, BACKGROUND 4); the fold writes it, the pick sorts on it, the index matches. Verified: mixed rows pick HUMAN first, FIFO within class.
- **Federation intent** was dropped at the assign message build (the auth walk gated on it, the able handler never saw it). Threaded through.
- **Dead `summonCreateBeing` branch** deleted from summon.js (the file's own doctrine says birth is a BE op); broken `../../intake/scheduler.js` import path fixed.
- **3D portal** referenced retired `openAuthPanel`/`hideAuth*` (ReferenceErrors) — repointed to `openFlatPanel`; portal-walk sent a bogus `set-being:position` op name — fixed to `set-being`; `debugLiveEvents` defaulted true — now false.
- **SIGTERM double-handler** in dbConfig.js raced begin.js's shutdown (closing Mongo under in-flight lanes) — removed; begin.js is sole shutdown owner.
- **8 scratch-DB harnesses** moved from /tmp into `.test/e2e/` with repo-relative paths + a `run-e2e.sh` runner.

## Landed — Tier 1 (correctness)

- **Scheduler lane wedge.** The DB-health gate sat BEFORE the try, so its early `return` skipped the finally that clears `running` — a single DB blip wedged a being's lane until restart. Moved inside the try; replaced the sticky health cache with dbConfig's live `isDbHealthy()` (the gate exists for mid-run outages a cache can't see).
- **Inbox starvation + branch leakage.** The pick now takes an exclusion set, so one blocked top row (failed cognition, paused/deleted branch) falls through to the next-best row instead of breaking the whole drain; paused/deleted rows skip-and-continue, not break. The sever sweep is branch-scoped (severing a thread on one branch no longer evicts a sibling branch's rows). Index realigned to the real pick shape (recipient + inboxSpaceId).
- **End-matter name lock.** Ended matter (spaceId=DELETED) never tombstoned its projection slot, so its name stayed locked per branch forever and a same-named successor's create-fact committed while its projection insert died on E11000. Added a reducer-owned `isGone` predicate; the fold tombstones on it. Proven: create → end → re-create same name succeeds.
- **E11000 fold poisoning.** A name collision between two live reels (the unique index is a backstop on a CACHE; facts already committed) threw E11000 on every subsequent fold forever — the aggregate never materialized. Now the loser materializes as `<name>~conflict-<id8>` with a `nameConflict` marker; the chain is honored, the cache heals. (_id-race E11000 is distinguished and retried, not deconflicted.)
- **Act-chain concurrent fork.** Open→seal is a read-compute-write on the head; two concurrent openers forked the chain silently. Closed with a CAS'd head advance inside the seal (ACT_CHAIN_MOVED aborts the whole seal) + a per-(branch,being) reentrant lock on the direct helpers. Proven: 8 concurrent acts, chain verifies, exact count. (See PORT-NOTES #5.)
- **Stale doctrine comments** (assign's "orphan facts on partial fail" — false since ΔF accumulates; the retired ΔF=1 two-write shape) corrected; all `[[memory-slug]]` refs stripped from source.

## Landed — Tier 2 (port infrastructure)

- **Canon conformance vectors** frozen at `seed/past/fact/canon.vectors.json` (canonicalize cases, computeHash, fact + act identities, chaining), generated from the reference impl, checked by `verify-canon-vectors.js` (52/52). The Rust canonicalize/hash verifies against this byte-for-byte or every identity changes at the border. Footguns pinned: -0→"0", 1e21→"1e+21", empty-object values dropped, empty arrays kept, Date→ISO-ms-Z, NaN/Infinity→null, recursive key sort. (PORT-NOTES #17.)
- **HTTP request-fact scale test** run for real (`http-scale-e2e.mjs`): 1200-request fetch burst, every request answered, every request stamped, zero drops, honest batching (no batch > BATCH_MAX 50), the http being's act chain + the request-log reel both verify after the storm. ~1778 req/s.

## Landed — Tier 3 (security)

- **CSWSH** (cross-site WebSocket hijack). Production set the session cookie `SameSite=None` (sent on every cross-site request) while the WS layer read the cookie token FIRST and the origin gate accepted all origins — any page a logged-in user visited could drive SEE/DO/SUMMON/BE as them. Closed two ways: the cookie is now `SameSite=Lax` everywhere (the portal is same-origin; programmatic clients use the bearer token), AND the WS layer honors the cookie token only when the handshake Origin is this reality. Bearer `handshake.auth.token` is always honored.
- **WS token revocation.** The WS path authenticated with bare `decodeToken` — no tombstone or revocation check — so a stolen token kept full verb access for 30 days and tombstoned beings kept authenticating. Now `verifyTokenStrict` runs at the handshake (one DB read: existence + `tokensInvalidBefore`).
- **WS auth rate limit.** `be:connect`/`be:birth` were unthrottled over the socket (the HTTP limiter was a fiction) — unlimited bcrypt brute force and permanent registration flooding into the append-only chain. Added per-IP throttling mirroring the HTTP windows (connect 10/15min, birth 5/hr). All three proven in `ws-security-e2e.mjs` (9/9).

## Landed — Tier 4 (PORT-NOTES opens)

- **#10 duplicated branch-resolution** — BUILT. authorize() and the verb layer now delegate to one `resolveTargetBranch` primitive; the branch that GATES an act and the branch a fact STAMPS on can't diverge. Conformance test pins it (14/14).
- **#15 scope-gate** — HARDENED to fail closed. The fact-emission scope check swallowed any non-IbpError as "pre-bootstrap," so a resolver bug or DB error during scope resolution silently ALLOWED the out-of-scope write. Now only the module load is swallowed; a throw from the check refuses the write (SCOPE_CHECK_FAILED).
- **#17 canon vectors** — frozen (above).
- **#5 act-chain concurrency** — guard noted in PORT-NOTES (above).

## OPEN FORKS — need a Tabor decision

### A. The source mirror is dead and churning (BLOCKER-class, but the feature is already unreachable)

`genesis.js:319` calls `ensureSourceTree()` on every fresh plant. `createSourceMatter` writes `new Matter().save()` into the legacy `matters` collection, but every read (`source.js` root + children lookups) queries the `Projection` collection — they never match, so each boot recreates the whole tree (the live DB holds 1591 orphan source rows, 0 with a reelHead, 0 with a projection). The feature is unreachable through the four verbs (getMatters queries only Projection). PORT-NOTES #7 already set the direction: source becomes matter-facts-as-files on Node, and disappears entirely on the OS.

**Recommendation: disable the `ensureSourceTree()` boot call** (one comment in genesis.js) until it's rebuilt fact-backed. It does nothing reachable today and only churns dead rows. Reversible. Alternatives: (b) rebuild fact-backed now (real work, arguably premature pre-port), (c) band-aid reads+writes to the same store (PORT-NOTES says don't copy this pattern). This removes the visible `./source` heaven space, so it's your call.

### B. capPayload silently truncates oversized summon content (PORT-NOTES #3, ANSWERED-but-unbuilt)

The inbox IS a projection of summon facts, so summon content lands inline in the fact and `capPayload` (default 512KB) replaces anything larger with a lossy `{_truncated, preview}`. The acute consumer is federation bundle delivery (push-subtree caches the whole bundle as a fact value; deliver-bundle ships it as summon content) — above the cap it silently becomes garbage. #3's answer is ref-boxing: oversized content goes to the content store, the fact carries a CAS ref (like matter bytes), small messages stay inline.

**Recommendation: build the threshold + ref-resolution now** if you intend to test federation before the port; otherwise leave capPayload as the documented backstop and let the port copy a finished seam. `contentStore.putContent` already exists and is idempotent, so the write side is small; the work is ref-resolution in the read paths (scheduler pick, assemble, inbox panels).

### C. Human inbox closure event

A summon row closes when the answering ACT seals (a being can answer by doing the asked thing, no reply text). For an LLM/code being that's automatic. For a HUMAN inhabiting the inbox panel, there's no defined "I'm done with this" event that seals an answering act — so a human-targeted summon has no clean closure path. This is a design question (what act does a human's "dismiss/answer" emit?), not a bug. Flagging it because it determines whether human-occupied beings can use the inbox at all. No code changed; needs your model of the human-in-the-loop closure.

## Two findings surfaced during the final regression

- **`npm test` ran nothing.** The glob was `test/*.test.js` but the dir is `.test/` — a silent no-op that looked green. Repointed `npm test` at the current dependency-free verifiers (canon vectors + branch resolution, 66 checks) and added `npm run test:e2e` for the self-booting suite. The six legacy `.test/*.test.js` unit suites (scheduler, subscriptions, replies, …) all import the pre-`present/` `seed/factory/` tree and mock the old inbox model — they predate the materials/present/past reorganization and need a port, not a glob fix. The 12 e2e harnesses now carry the scheduling/inbox/act-chain regression coverage they aimed at.

- **Boot manifest reconciliation races `isHostReady`.** genesis fires the tools/ables/operations manifest sync as a fire-and-forget `(async () => …)()` (genesis.js ~942), so its per-item `withIAmAct` acts drain in the background after boot-ready. Harmless in production (the manifest is self-healing) but it means a deterministic genome capture can race it. The act-chain lock (T1e) serializes the I-Am chain, which lengthened the drain and turned a latent race in publish-test (wipe-then-replant) into a deterministic failure — fixed by waiting for fact-count quiescence before the wipe. If boot-ready should ever GUARANTEE the manifest is built (it doesn't today, by design), that's a product decision, not a test bug.

## Test inventory added this sweep

- `.test/e2e/fold-integrity-e2e.mjs` — end-matter tombstone + name-collision self-heal
- `.test/e2e/act-chain-e2e.mjs` — per-(branch,being) act serialization + CAS head advance
- `.test/e2e/ws-security-e2e.mjs` — token revocation + tombstone refusal + BE rate limit
- `.test/e2e/http-scale-e2e.mjs` — real fetch burst, honest batching, chain after storm
- `.test/e2e/run-e2e.sh` — self-booting runner for all e2e harnesses
- `.test/scripts/gen-canon-vectors.mjs` + `verify-canon-vectors.js` — canon conformance
- `.test/scripts/verify-branch-resolution.js` — branch-precedence conformance
