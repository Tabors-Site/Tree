# PARALLEL FACTS — shared-reel concurrency and the two adjudication strategies

*Builder spec. This settles the long-open concurrency question: when many beings act on the same space or resource at the same time, and one being's act lands while another is still folding, what happens? The answer is two strategies, chosen by conflict type, both built on append-only facts. Strategy A is built with the dance (rung 5). Strategy B is built later, when an actual scarce resource exists to contend.*

*Depends on: atomic multi-reel seal (sealFacts) being wired, and `foldSeq` being carried on every act.*

---

## 0. The reframe that dissolves the problem — LOCKED

There is no such thing as an overwrite. Facts are append-only; the past is fixed. What looks like "being X overwrote being Y's change" is never that. It is always a **stale fold**:

> Y folded the space at seq N. By the time Y goes to seal, the space reel has advanced past N — there is a new fact (X's act) that Y didn't see. Y is about to write a fact based on a read that's now out of date.

State every conflict this way and the design becomes clean. The question is never "who wins the overwrite" — it's "Y read a stale board; does that matter, and if so, what happens to Y?"

---

## 1. Core invariants (shared by both strategies) — LOCKED, do not violate

1. **Append-only.** No write ever mutates or replaces an existing fact. A later act is a new fact, not a replacement. "Overwrite" cannot happen.
2. **The fold reads; the seal writes; only the append is serial.** A being folds on its own moment (could take 30 seconds). It acquires the space/resource reel's append lock ONLY at the instant of seal, for the duration of appending its fact(s). It holds NO lock during its fold. This is the property that lets thousands of beings share one reel without a slow being blocking anyone — they queue only for the microsecond of appending, never for each other's thinking. Nobody waits on anyone's *fold*; they only briefly take turns *writing*.
3. **Every act carries `foldSeq`** — the seq of the shared reel it folded from. This is the stale-detection key. Add it to the act/fact envelope if it isn't there. Strategy B is the consumer that makes it mandatory; Strategy A benefits from it too.

---

## 2. Most "conflicts" aren't — LOCKED

The overwhelming majority of writes to a busy shared reel are **independent** and need zero coordination:

- X moved from (3,3)→(3,4). Y moved from (7,1)→(7,2). Nothing shared. Both facts land. Both are stitches on the same fabric. No conflict, no adjudication.

Independent acts on a shared reel are the common case. Don't build coordination for them — they just append (serially, for an instant, at the lock). Adjudication is only for the case where Y's act actually *depends on* the thing that changed under it. Hold this: in a crowded space, most beings aren't touching the same cell, so most acts need nothing.

---

## 3. The two strategies — LOCKED

When Y's act *does* depend on what changed (a genuine conflict), there are exactly two resolutions. **Which one to use is determined by the conflict TYPE, declared in the space/resource's reducer — not picked globally.**

### Strategy A — let both land, reducer adjudicates (NON-BLOCKING)

Both acts seal. Both facts land on the reel. The conflict is resolved at **fold time** by the reducer reading the facts in seq order and applying a rule. Nobody is rejected; nobody retries.

- **Use for:** spatial/positional conflicts — two beings want the same cell. Reducer rule: *earlier-seq holds the cell; later-seq is bumped to the nearest free neighbor* (deterministic tiebreak: check neighbors in a fixed order, first free wins).
- **Why it works:** the resource (space) is fungible and relocatable — the loser can be silently placed one cell over without contradicting anything.
- **Scales:** no retry storm; everyone seals once. Good for thousands of beings in one space.
- **Presentism hides the bump:** the bumped being, on its next fold, simply experiences itself as being where it ended up. It has no memory of having "wanted" the contested cell. The bump is invisible from the inside — but the facts stay honest (both moves are recorded; the reducer resolves the overlap deterministically).
- **This is the dance's case** (THE-DANCE rung 5).

### Strategy B — reject-on-stale (optimistic concurrency)

The conflict is detected and resolved at **seal time.** At seal, in the SAME transaction that would append the act, re-check: has the reel advanced past the being's `foldSeq` in a way this act depends on?
- NO → append; the being won; commit.
- YES → another being already acted; **abort the seal, append nothing.** The act did not happen.

- **Use for:** scarce-resource conflicts — two beings want the one item; a unique claim/lock; a counter that must not double-decrement.
- **Why A won't work here:** the resource is unique and not relocatable — any silent placement of the loser contradicts the facts (two beings holding one item). There's no neighbor cell to absorb the loser.
- **The loser refaces:** the rejected seal produced no fact (a clean no-op, same shape as a SEE or a reaped crash). The original summon is still open (its answering act never sealed), so the scheduler re-picks it naturally — no special retry queue. The being re-folds the now-current world (item gone), and decides again.
- **Presentism for the loser:** the re-folded being has no memory of having wanted the item. It finds it gone and acts on the current world. The loss is invisible from the inside — but the facts are honest: exactly one consume exists. *That honesty is the whole reason B exists over A.*

**The selection test:** can the reducer silently place the loser somewhere valid? Cell conflict → yes → **Strategy A**. Unique item → no (any placement contradicts the facts) → **Strategy B**.

---

## 4. Strategy A — build detail (build with the dance, rung 5)

1. **Lockstep rungs (1–3) need no adjudication.** Every being folds the shared reel up to a shared seq-ceiling (`tickSeq`), so all reads are from the identical start-of-tick board and writes never race a read. If a conflict appears during lockstep, the seq-ceiling fold is broken — fix that, don't add a reducer.
2. **Turn the conflict on (rung 5):** drop the ceiling so beings fold the live board; sequence the summons so a later being can see and collide with an earlier being's just-sealed act.
3. **The reducer cell-resolution:** when folding, if two move-facts put two beings in the same cell, earlier-seq keeps the cell, later-seq is placed in the nearest free neighbor (deterministic neighbor order).
4. **Resolution is fold-time only, never a rewrite.** The loser's fact stays exactly as sealed ("I stepped to (3,4)"). The reducer is what resolves "(3,4) is taken, so you render at (3,5)." Re-folding from facts must reproduce the same bump every time.

**Verify A:**
- Two beings deterministically aimed at one cell on one tick → earlier-seq lands in the cell, later-seq renders in the adjacent free cell.
- Replay: fold from scratch — the bump reproduces identically (same winner, same neighbor). If two replays disagree, the tiebreak isn't deterministic — fix it.
- NO seal rejected, NO retry. If you see a rejection, you accidentally built B.
- A deliberately-slow being (sleep its fold 10s) does NOT delay the others' folds — only its own append queues briefly at seal.

---

## 5. Strategy B — build detail (build later, when a scarce resource exists)

The resource lives on a reel as a sequence of claim/consume facts. A consume is valid only if no other consume of the same resource landed between the being's `foldSeq` and its seal.

1. **Guarded append (compare-and-append):** at seal, in ONE atomic transaction, re-check the resource reel for any consume-fact for R with seq > the being's `foldSeq`. None → append the consume, commit. Found → abort, append nothing.
2. **The check and the append are ONE transaction.** This is the single most important rule in B. If the guard-read and the conditional write can be split, two beings both pass the check and both consume. Use the DB transaction + the resource reel's append lock to make guard+append atomic — exactly the sealFacts machinery, with a precondition check inside the transaction before the append.
3. **Rejection is a clean no-op, not an error.** Zero facts; summon stays open; scheduler re-picks; being re-folds fresh and decides again. Do NOT implement rejection as a thrown error that crashes/bubbles the moment.
4. **The retry storm self-terminates.** If 1000 beings contend, the first winner ends it: after R is consumed, every re-fold SEES R is gone and the losers DON'T re-attempt the consume — they fold the current world and choose differently. One win ends it.
   - **Watch:** the losers must re-fold and choose a DIFFERENT act, not blindly re-attempt the gone consume. If a being re-attempts a consume of an already-gone resource, that's a bug in the *being's rule* (it isn't actually re-folding), NOT in the concurrency layer.
   - **Caveat:** if the resource is contended AND replenished, you can get sustained churn. Acceptable (it's real contention), but cap re-summons per moment-chain — a being rejected K times in a row on the same correlation should release (do nothing) rather than spin. K is config, default small.

**Verify B:**
- Two beings, one item, both fold at count=1, both decide to take → exactly ONE consume lands; the other is rejected, re-folds, sees count=0, does something else. Assert: resource reel has exactly one consume; loser has zero consume-facts; loser's later acts reflect count=0.
- 50 beings, one item, all fold at count=1 → exactly one wins; 49 re-fold and divert. Assert: exactly one consume total under any interleaving. No double-consume.
- Replay: fold the resource reel from scratch — count ends at exactly 0 with one consumer; re-running replay gives the same single winner (= lowest seq among contenders, fixed in the reel). Deterministic.
- Slow-being: a being that folds 30s and seals last is correctly rejected if a faster being consumed R meanwhile — and was NOT blocked during its fold (it only finds out at seal). It does not hold up the winner.

---

## 6. Do NOT (both strategies)

- Do not call anything an "overwrite." Nothing is overwritten — it's a stale fold against an append-only past. (§0)
- Do not hold any lock across a fold. Lock at append only. (§1.2)
- Do not make `foldSeq` optional. (§1.3)
- **Strategy A:** do not resolve a cell conflict by mutating/deleting the loser's fact — fold-time reducer only. Do not let the tiebreak be non-deterministic (no Math.random, no wall-clock, no async-insertion-order). Replay must reproduce it.
- **Strategy B:** do not split the guard-check from the append — one atomic compare-and-append. Do not implement rejection as a thrown error — it's a clean no-op. Do not have the loser re-attempt the same consume on re-fold — it folds the current world and decides fresh.
- Do not build Strategy B speculatively. Build it when a real scarce resource exists. (The dance has none.)
- Do not pick one strategy globally. The conflict type decides; the space/resource reducer declares which it uses.

---

## 7. What this closes

When both are built and green (A: deterministic bump, no rejection, replay-identical; B: exactly-one-consume under any interleaving, retry self-terminates, replay-identical), the concurrency question is settled:

- **A** — non-blocking, spatial, reducer-at-fold.
- **B** — reject-on-stale, scarce, guard-at-seal.

The space/resource reducer declares which per conflict type. Both are provable by the same replay discipline: fold from facts, get the same single outcome every time. And both scale, because the only serialization anywhere is the instant of append — a slow being never holds up anyone's fold.

---

## 8. Out of scope

- Strategy B itself in the dance pass (the dance has no scarce resource — build B when one exists).
- Distributed/multi-process reel locks. `withReelLock` is in-process; single-writer holds cross-process only "by there being one process." Cross-process locking is needed before any multi-process deploy and is its own pass.
- Drift / re-negotiation of a contested meaning over time (relevant to scarce *claims* like leadership that can change hands) — later.
- Multi-resource transactions (a being consuming R1 AND R2 atomically, where it wants both-or-neither). A real extension of B; prove single-resource B first.
