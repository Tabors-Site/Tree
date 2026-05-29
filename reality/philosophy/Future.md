    # OPTIMIZATION ROADMAP — engineering responses to growth, in order of when you'll need them

*Reference document. Not a build spec — a map of the optimization moves available to TreeOS as it scales, when each becomes worth doing, and the doctrinal lines none of them is allowed to cross. The architecture is sound at scale (proven by every event-sourced multiplayer system that came before); what this document covers is the playbook for handling growth without breaking the model.*

*The governing principle: optimize when measurement shows pain, not before. Every move below is a tool to reach for; none is a thing to build speculatively. Build the system honest first (every move is a fact, every read is a fold, projections are caches), prove it works, then reach for these when reality forces it. Premature optimization here is especially dangerous because most of these moves can be misapplied in ways that quietly violate the model (mutable state, second writers, hidden authority, non-deterministic reducers).*

---

## 0. The architectural property to preserve through every optimization

Every optimization below must preserve all of these. If a move breaks any of them, it's the wrong move — find a different one. These are not goals; they are invariants.

1. **The chain is the only truth.** Facts are the single source. Every visible state is derivable from them. (MODEL.md INVARIANTS.)
2. **Append-only.** Nothing mutates a sealed fact. The past is fixed. The integrity chain holds.
3. **Reducers are pure.** `(state, fact) → state`, deterministic, replay-identical across machines and across years.
4. **Single-writer per reel.** Only a being's own moments write to its reel. Only the fold writes to a projection.
5. **Projections are caches, not state.** Drop-and-rebuild-from-chain must produce identical results.
6. **Replay holds end-to-end.** Fold from `W=∅` forward, reach byte-identical current state. No optimization is allowed to break this.
7. **Convergence is the world.** Many beings folding the same chain agree because of determinism, not because of broadcast. No optimization is allowed to introduce authoritative shared state above the fold.

If you ever find yourself proposing an optimization that requires loosening one of these — stop. The architecture's whole value (debuggability, replay, integrity, the "I can go back" property game engines can't) lives in these. Trading them for performance is trading the thing you built *for the thing everyone else has*.

---

## 1. Projections — fast reads on long reels — BUILD AS YOU NEED THEM

**The pain it solves.** Folding a reel with millions of facts to answer "where is being X right now" is slow if done cold. Reads dominate writes in most workloads; you cannot afford to re-fold the world to render a frame.

**The move.** A projection is a derived, materialized answer to a question — a row keyed on (subject, query) holding the current answer, maintained by the fold as new facts seal. Reads hit the projection (O(1)); rebuilds replay the relevant reel from seq=0 and must produce identical results.

**Examples already in TreeOS:** Being-row (figure projection of `R_b`), InboxProjection (open summons), ThreadsProjection (live coordination chains), PositionProjection (current coordinates per being per space).

**When to add one.** A specific query is hot (called many times per second) AND folding cold is too slow for the use case. Build the projection for *that query*, with a key shape that makes it O(1). Don't generalize ("we might need this someday"); the right projection comes from a real read pattern.

**Doctrinal lines.**
- **The fold is the only writer.** Never write a projection from a verb handler or an extension. The reducer owns it. If anything else writes, you have a second writer and replay will diverge.
- **The projection must be rebuildable from facts.** Test this monthly: drop the projection, rebuild from the reel, assert byte-identical to live. This is the *only* guarantee that the projection hasn't drifted.
- **The projection is never authoritative.** If a projection says one thing and the chain says another, the chain is right; the projection is broken. Fix the projection; never patch the chain.
- **No `unique:true` constraints on projection fields.** Uniqueness is a doctrinal claim that must hold at stamp-time in the verb handler, before the fact seals. An index uniqueness constraint as enforcement means a sealed fact can't be projected — reel and projection diverge.

**Pattern: schema-as-projection audit.** Periodically, for each entity row, ask: which fields are identity (constitutive, must exist before any fold) and which are figure (folded from the reel)? Only `_id` should be constitutive. Everything else should be folded. If a field looks authoritative but isn't writable from any verb, it's a projection field in hiding — name it as such.

**Cost.** A projection adds storage (one row per subject) and write amplification (every relevant fact triggers a projection update). Both are bounded and predictable. Worth it the moment a query is hot.

---

## 2. Snapshots — fast cold replays — BUILD WHEN REPLAY GETS SLOW

**The pain it solves.** Cold replay from `W=∅` becomes slow as reels grow. A million-fact reel folded from scratch is tens of seconds; ten million is minutes. Acceptable for a yearly audit; unacceptable for a verify-replay test that should run every commit.

**The move.** Periodically (every N seals on a reel, every M minutes, or both) seal a **snapshot fact** that records the reducer's state at that point. A snapshot is *itself a fact* — it lives on the reel, hash-chained, append-only. Cold replays start from the latest snapshot and replay only the facts after it, instead of from seq=0.

**Doctrinal lines.**
- **A snapshot is a fact, not a replacement for facts.** The pre-snapshot facts stay on the reel — never deleted, never compacted. The snapshot is a *checkpoint*, not a replacement of history. INNER-FOLD §9 named this; the rule holds.
- **The snapshot is verifiable.** A snapshot fact carries a hash of the state it summarizes; replay-from-zero (occasionally, as the audit) must reach the same state. If the snapshot disagrees with the audit-replay, the snapshot is wrong — discard and re-snapshot.
- **Snapshots are per-reel.** Each reel snapshots on its own cadence; no global snapshot. (A global snapshot would imply a shared time, which the model doesn't have — only per-reel local seq.)
- **Snapshots do not break the integrity chain.** The snapshot fact's `p` points at the previous fact's `h`; the next regular fact's `p` points at the snapshot's `h`. The chain threads through snapshots unchanged.

**When.** When verify-replay tests on a single reel take longer than a developer's patience (e.g., >30s). The fighting-game industry snapshots every 60 frames; financial event-sourced systems snapshot daily. Pick a cadence that keeps cold replays under your patience threshold. Likely many months out for TreeOS.

**Cost.** A snapshot is large (full reducer state per reel) but rare (every N facts). Net storage growth is modest; replay speedup is dramatic.

---

## 3. Scope discipline — bounded folds — FORMALIZE WHEN WORLDS GROW

**The pain it solves.** A being's fold reaches `R_scope` — its own reel plus the reels of spaces and matter in scope. If a being's "scope" is "the whole world," the fold's cost scales with the world. As worlds grow, naive scope kills performance.

**The move.** Make `R_scope` strictly bounded by *spatial or causal proximity*. A being in dance-floor A folds dance-floor A's reels, not dance-floor B's. A being in conversation with B folds the threads-projection that names B's relevance, not every summon ever sent. The model already names this (`R_scope` is a parameter of the fold); the optimization is enforcing it as a *small set*, always.

**Doctrinal lines.**
- **Scope is a fold-time concern, not a storage concern.** Reels are not partitioned; scope is just *which reels this fold reaches*. A being can change scope freely; reels stay intact.
- **Scope is not authority.** A being doesn't "own" its scope's reels — it just reads them. Single-writer is still enforced by reel ownership, not scope.
- **Half-turn recall still walks the braid** (INNER-FOLD §3). Recall can reach beyond the immediate spatial scope (an old act stitched to a now-relevant entity); scope discipline limits the *forward* fold, not recall's braid-walk.

**When.** When a being's fold latency starts being measurable as a fraction of a moment's budget — i.e., when folding is slow enough to feel. Standard game-engine practice (cells, octrees, areas-of-interest); TreeOS will reach this when worlds get big or beings get numerous. Months out.

**Patterns.** Spatial scoping (only the current space + adjacent spaces); causal scoping (only entities I've recently acted on or been summoned by); attentional scoping (a being can explicitly narrow its scope as part of orientation). The model accommodates all three; the engineering is in choosing one (or a hybrid) and making it the default.

---

## 4. Reel sharding / space splitting — hot-reel contention — REACH FOR ONLY UNDER PROVEN LOAD

**The pain it solves.** Many writers, one reel. The grid reel with 50 dancers writing at once is fine; with 5,000 it's a queue; with 50,000 it's a bottleneck. Append serializes; that's the model's correctness guarantee (PARALLEL-FACTS §1.2). At some scale, one reel can't keep up.

**The move.** Split the *space* that's hot. One huge dance floor becomes ten smaller dance floors, each with its own grid reel, each independently serialized. Beings in dance floor 3 see only dance floor 3's reel; they don't contend with dance floor 7. Same pattern as game-server zone sharding (MMO realms, instance-based dungeons).

**Doctrinal lines.**
- **Sharding by space, not by reel within a space.** A space has *one* reel — its truth lives there. Splitting a single space's reel into shards would mean "the dance floor's history is in two places," which is incoherent. Instead, split the *space* into multiple spaces, each with its own reel.
- **Cross-space acts are still single-act, multi-reel ΔF.** A being moving from dance floor A to dance floor B seals one act with facts on both reels — atomically, via `sealFacts`. Sharding doesn't break atomicity; it just means a smaller fraction of acts cross shards.
- **Don't shard speculatively.** Each shard is a new space with its own ontology (it's a *different place*, not the same place with different writers). If the dance floor is conceptually one place, sharding fights the model. Split when the load is real and the user-visible split is acceptable.

**When.** When a single reel's append queue is the measurable bottleneck. Probably years out for TreeOS unless a specific space becomes viral (one shared chat room with 10k users, one battlefield with 10k entities, etc.).

**Cost.** Architectural — beings can't see across shards without crossing acts. User-visible — players have to be in the same shard to interact. Same trade game MMOs make.

---

## 5. Reel-seq fold cache — repeat folds on unchanged scope — BUILD AFTER THE DANCE

**The pain it solves.** If a being is summoned repeatedly and nothing in its scope advanced, re-folding from scratch each time is redundant. The fold is a pure function of `R_scope` and the reel-seqs in scope; if neither changed, the previous face is still valid.

**The move.** A discardable cache keyed on the in-scope reel-seqs: cache the folded face against `{R_scope's reel ids → their seqs at fold time}`. On the next summon, check those seqs; if unchanged, reuse the cached face; if any advanced, re-fold. Held by the present, never authoritative, evictable under memory pressure.

**Doctrinal lines.**
- **The being is never resident.** The cache lives on the present's machinery, not on the being. Beings stay stateless between moments. The cache is the *present's* shortcut, not the being's memory. (Discussed at length earlier — per-being stampers forfeit the whole pool model.)
- **The cache is discardable.** Any eviction must be safe; re-fold from facts must produce identical results. Verify with replay: fold cold, fold via cache, assert byte-identical. If they ever diverge, the cache is buggy.
- **The cache is never written by anything else.** Only the fold writes; only the present's eviction policy removes. No verb-handler "warmth" hints, no extension caches, no manual invalidation.
- **Build honest re-fold-every-time first.** This is an optimization, not a primitive. Don't bake it into the beats. Only add it when measurement shows re-folding is the bottleneck.

**When.** After the dance is dancing and after you've measured that repeat-summon re-folds are actually expensive. Likely visible when beings are summoned at high rates against large scopes (LLM beings with long contexts, busy harmony rooms).

---

## 6. Cross-process reel locking — multi-process deployment — REQUIRED BEFORE ANY HORIZONTAL SCALE

**The pain it solves.** `withReelLock` is in-process only. Single-writer holds cross-process today only because there's one process. The moment you run two app servers against the same DB, two beings on different processes could both append to one reel simultaneously, both passing their local lock, both committing — double-write, single-writer violated, replay broken.

**The move.** A cross-process lock backed by something shared — MongoDB advisory locks, a Redis lock, a coordinator. The lock semantics are unchanged (lock at append, only the append is serial — PARALLEL-FACTS §1.2); the implementation just has to hold across processes.

**Doctrinal lines.**
- **The lock model doesn't change.** Lock around the entire transaction (per the §1.2 fix), one reel at a time, sorted-key ordering for multi-reel deadlock avoidance. Cross-process changes the *mechanism*, not the rules.
- **No fallback to "in-process locking is good enough."** Multi-process without cross-process locking is structural single-writer violation. There's no scenario where it's acceptable.
- **The lock can fail.** Network partitions, lock-service downtime, etc. The append fails loudly; the moment doesn't seal; the being refaces. Same shape as any other seal failure.

**When.** Before you deploy a second process against the same DB. Not before. (And FACTORY.md should carry the warning: single-process deployment is the only one currently safe.)

**Cost.** A lock RTT per append. With a good lock service (Redis, dedicated lock daemon), this is sub-millisecond and shouldn't change throughput meaningfully.

---

## 7. TTL / cold storage — ancient facts — LAST RESORT

**The pain it solves.** Facts accumulate forever. Eventually the DB is mostly ancient history that no live read or recent replay touches. Storage cost becomes real. Index pressure on `{beingId, seq}`, `{target, seq}`, `{actId}` grows.

**The move.** Old facts (older than some threshold *and* covered by a snapshot) move to cheaper storage — S3, cold object storage, a separate read-only DB. Cold replays that need them can fetch on demand; warm replays use the snapshot.

**Doctrinal lines.**
- **Facts are never deleted.** Even when moved to cold storage, they remain reachable. Append-only means *forever*. The model has no concept of "forgetting"; the engineering has cheap-versus-expensive places to keep things.
- **Cold-fact retrieval is a query optimization, not a model concept.** A being folding the world doesn't know whether a fact came from hot or cold storage. The storage layer is invisible.
- **Snapshots must precede cold-moving.** A cold-moved fact must be covered by a downstream snapshot, so cold replays still work (start from snapshot, fetch facts only if going further back than the snapshot).
- **Integrity chain still holds.** Cold storage doesn't break the hash chain; cold-stored facts still carry valid `p` and `h`. A cold-replay must still verify the chain.

**When.** Years out, when storage cost is a real line item and the access pattern is clearly "ancient facts almost never touched." A natural threshold: facts older than the oldest reasonable snapshot.

---

## 8. The optimizations you should NEVER reach for

These look tempting and would each break the model. The architecture buys you specific properties (replay, integrity, the ability to go back, the convergence-as-world insight) that none of these can give back once traded. They are listed here so that you (and any agent helping you) recognize them as forbidden moves, not creative ones.

**Mutable state for "things that change a lot."** Position, qualities, currentSpace — anything that changes frequently — looks like it should "just be updated in place." This is the move every game engine makes by default and the move you correctly walked away from earlier. The right answer is *always* a projection over the reel. The reel keeps the trail; the projection serves the read. Replay holds. **If you ever update a sealed fact in place, you have left the model.**

**A "current state" table as authority.** Tempting variant of the above: keep a `WorldState` table that everything reads from, treat the reel as a write-log. This makes the table authoritative and the reel a *history that may or may not match*. The relationship is exactly backwards: the reel must be authoritative, the table must be a projection. If you can't drop the table and rebuild it from facts, the model is broken.

**Skipping the seal under load.** "When the dance is hot, just update positions directly and seal a summary fact later." This is structurally a second writer. The seal is the only commit site by type; that property buys atomic batches, integrity, replay, debuggability. Loosening it under load buys throughput by breaking everything else. If load is the problem, shard the space (§4), don't bypass the seal.

**Non-deterministic reducers.** Anything that makes `(state, fact) → state` impure — wall-clock reads, Math.random in tiebreaks, async-order dependencies, ORM-side hooks. Each one quietly breaks replay; you only find out years later when a replay diverges and you can't figure out why. Audit reducers periodically; the rule is "pure function of `(state, fact)`, nothing else."

**Cross-being reel writes.** A being writing another being's reel "to save a round trip" (e.g., when A acts on B, A also stamps a courtesy fact on B's reel about it). This violates single-writer at the worst possible layer — debugging will be impossible because reel ownership becomes ambiguous. Cross-being effects always go through SUMMON; the recipient's own moment writes the recipient's reel.

**Caching that becomes authoritative.** A cache that ever serves a read the chain disagrees with — even briefly, even on a hot path. The cache must be drop-and-rebuild-identical-to-chain, always. A cache that "lies a little for performance" makes the chain non-authoritative, and the property that the chain is the only truth quietly dies.

**Allowing the wire / transport / ORM to write reels directly.** This is the credentialOps / `opts.actor` / Mongoose-as-second-writer / IBP-passing-raw-rows pattern from earlier this session. Anything that lets a non-being layer stamp a fact has bypassed the moment machinery. Every fact must ride a being's moment; every moment must seal through the one site. Structural enforcement, not vigilance.

---

## 9. The order to reach for these — in summary

1. **Projections** — already part of normal building. Every hot read pattern gets one. (Ongoing.)
2. **Cross-process reel locking** — required before any multi-process deploy. (Before scaling out.)
3. **Scope discipline** — formalize when fold latency becomes measurable. (When worlds grow.)
4. **Reel-seq fold cache** — when repeat-summon re-folds are measurably expensive. (After the dance.)
5. **Snapshots** — when verify-replay tests get slow. (Many months out.)
6. **Space splitting / sharding** — only when one space's reel is a proven bottleneck. (Years out, unless viral.)
7. **TTL / cold storage** — last resort, when storage cost is a real line item. (Years out.)

Every move in this list is engineering, not architecture. None changes what the system *is*; they all change how it *performs*. The architecture is what it was on day one: chains of facts, folded into views, sealing as the only writer, converging into a world. Performance grows around that; nothing replaces it.

---

## 10. The measurement discipline — when to reach

Don't pre-build any of these. The signal that says "now":

- **Latency on a hot read** crosses your patience threshold → projection.
- **Cold replay** of a single reel takes longer than your CI run can tolerate → snapshot.
- **Fold latency** is a measurable fraction of a moment's budget → scope discipline.
- **Repeat re-folds of the same scope** dominate fold work → seq-keyed fold cache.
- **A single reel's append queue** is the bottleneck under load → space splitting.
- **You're about to spin up a second app process** → cross-process locking (no measurement needed; this is structural).
- **Storage cost is a real budget line** → TTL / cold storage.

Run a benchmark; find the bottleneck; reach for the matching tool. The architecture supports every one of these moves; the moves are well-understood; the order is the order of measurement.

The thing that makes TreeOS hold long-term is not that it will be the fastest event-sourced system — it's that every optimization above is *available* to it without compromising the chain. Other game engines that started with mutable state can't reach for snapshots-and-replay because they have nothing to replay. You start with the harder model; every optimization is a tool you can keep adding without ever giving up what made the model worth building.