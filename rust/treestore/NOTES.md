# treestore NOTES

Tier 4: the append-only store + the stamp (where an act turns into a fact). This file records
the state of the act/fact-boundary CORRUPTION-PREVENTION (Theorem 7 Scope + Cor 7.1, "the
torn-write self-heals; a committed fact is never overwritten"). MOMENT-SEAL-BUILDOUT.md Step 2.

Truth model in force: **(B)** - reels are content-addressed truth, the act-chain is its peer.
**Byte-identical to today's JS** on a clean (non-torn) sequence; no `.acts` `deltaF` field; the
`.head`/`.acthead` files are the unchanged `{head, headHash}` / bare-id pointers. ADDITIVE ONLY.

---

## STEP 2 FINDING - what was ALREADY here for recovery (before this step)

The forward HALF of Cor 7.1 was already present; the BACKWARD half (drop the orphan tail) was not.

### Already correct (no change needed)

- **The head IS the commit marker.** A fact is committed only when `.head` advances to it
  (`store.rs::write_fact_doc` writes the reel line, THEN `write_reel_head`). An act is committed
  only when `.acthead` advances to it under CAS (`act_log.rs::advance_act_head_file`). A line on
  disk whose head never advanced is an orphan - uncommitted, not yet real.

- **The seq/p re-derive from the HEAD, not from the reel tail.** Both halves of the commit key off
  the same `.head` read:
  - the SEAL (`commit.rs::seal_moment` -> `stamp.rs::compute_fact_doc`) computes `seq = head.head+1`,
    `p = head.headHash` from `read_reel_head`;
  - the WRITE (`store.rs::write_fact_doc`) re-reads `read_reel_head` for the idempotency check.
  Because `.head` is the COMMIT MARKER and a torn write never advanced it, after a crash the next
  commit reads the SAME lagging (true) head and computes the SAME `seq`/`p` as the orphan. So the
  next good fact already lands at the orphan's seq, chaining from the true head. **This is the
  forward self-heal, and it is already correct** - `verifyReel's walked head is the exact truth`
  (theorems.md Theorem 7 Scope) falls out because nothing reads the reel tail to allocate seq.

- **Idempotent replay** (`store.rs::write_fact_doc`: `if cur.head >= seq { replayed }`). A settled
  retry (the line landed AND the head advanced on a prior pass) is a pure no-op. The act side has
  the same: `act_log.rs::advance_act_head` returns `Replayed` when `cur == act_id`.

- **The act-chain CANNOT fork.** `advance_act_head` refuses (`ChainMoved`) when `cur != expect_prev`
  (a stale author can't overwrite a committed act-chain head).

- **`parse_reel` already SKIPS a torn mid-append line** (`reel.rs`: an unparseable trailing line is
  dropped, like JS `readReel`). That covers a HALF-written final line. It does NOT cover a FULLY
  written orphan line whose head never advanced - that line parses fine.

### The GAP this step closes (verified by probe, see the test)

`store.rs::durable_append` is APPEND, never overwrite. So after a torn write the orphan line stays
physically on the reel, and the next good fact is appended AFTER it. The reel then holds TWO lines
at the same seq (orphan + good). `verify_fact_chain` walks [orphan(seqN), good(seqN), next(seqN+1)]
and breaks with **`seq-gap`** (it sees seqN twice). Proven directly: a torn `set-being("TORN")`
followed by a real `set-being("REAL")` produced `{"ok":false,"reason":"seq-gap","brokenAt":3}`.

So the forward seq/p re-derivation is right, but the **orphan tail is never removed**, which breaks
the reel. The missing piece is the BACKWARD half: walk to the true (correctly-chained) head and
physically drop the orphan tail BEFORE appending the fresh moment (overwrite-forward). The JS has
this primitive (`fileStore.js::truncateReelTo`, used today only for a failed verbatim INSTATE
rollback); it was never ported to Rust and was never wired into the live commit path, because in JS
a crash mid-`commitMoment` is caught by the single global commit mutex + the `.head`-never-advanced
window, and the NEXT commit's truncate was never needed there. In the Node-free Rust runtime the
self-heal must run inside the commit path itself.

### Act side

Same shape: a torn act (line in `.acts`, `.acthead` not advanced) leaves an orphan act. The next act
re-derives `p` from the true `.acthead` (`read_act_head_file`) and computes the same id; but `.acts`
is also append-only, so the orphan act line survives and `verify_act_chain` breaks (`prev-mismatch`
at the duplicate). The recovery must drop the orphan act tail too, bounded by `.acthead`.

### THE KEY SUBTLETY (the pure walk vs the committed head - discovered + proven)

A torn write that completed its LINE (only the head-advance was lost) leaves an orphan that is a
*perfectly valid standalone fact*: it parses, its `_id` re-hashes, and it chains from the prior fact.
So `verify_fact_chain([fact1, orphan2])` returns `{ok:true}` - **the p-walk ALONE cannot tell a
committed fact from a head-lagging orphan.** What marks the orphan uncommitted is *exactly* that
`.head` never advanced to it (theorems.md Theorem 7 Scope: "headHash one fact behind ... the root
witnesses the lagging head"). Therefore:

- the **orphan boundary is the committed `.head` / `.acthead`** (the commit marker), NOT the walk's
  end. The recovery keeps the committed prefix `[1 .. .head.head]` verbatim and drops everything past
  it. This is what "the walked head is the exact truth" means operationally: walk *up to* the
  committed head.
- the **pure `walked_*_head(list)` helpers** (the walk over just the rows) answer a *different*
  question - "the last *correctly-chained* link" - and catch a genuinely BROKEN (bad-`p`/hash) tail
  (tampering, a corrupt half-line). They are exported + tested, but the commit-path recovery bounds by
  the committed head, because a clean orphan does not break the walk.

---

## STEP 2 BUILD - what this step adds (ADDITIVE)

- **`recover.rs`**:
  - `walked_reel_head(facts)` / `walked_act_head(acts)` - the pure walk (reusing
    `treeverify::verify_fact_chain` / `verify_act_chain`): the last correctly-chained `(seq,id)` / id,
    a *broken* tail excluded. On a break at 1-based `count`, the chain held to index `count-2`, so the
    true head is that link. (Catches tamper / a corrupt line; see the subtlety above for why the
    commit path does not rely on this for the head-lagging orphan.)
  - `recover_reel_before_commit(root, history, kind, id)` - read the committed `.head` (the true head)
    + the reel; if the reel carries lines PAST the committed seq, rewrite the reel to the committed
    prefix and reassert `.head` at the committed tip (orphan overwritten-forward, zero trace). The
    walk cross-checks the committed prefix is intact; a *committed* prefix that fails verification is
    TAMPER (INTEGRITY "detects, does not repair") and is left untouched, never truncated. A CLEAN reel
    (file tip seq <= committed head) is untouched -> byte-identical.
  - `recover_act_before_commit(...)` - the act-chain peer, bounded by `.acthead`.

- **commit_moment** calls `recover_act_before_commit` for the act-chain and `recover_reel_before_commit`
  for each target reel BEFORE it appends the new moment (right after the `Factless` check, before the
  act append). NEVER touches a committed fact; only the uncommitted tail (past `.head`/`.acthead`) is
  dropped. The seal already keys seq/p off the same `.head`, so the fresh fact lands at the orphan's
  seq chaining from the true head. Public signature of `commit_moment` is UNCHANGED (other agent's
  `treeibp::act` depends on it): `commit_moment(root, act, ord) -> Committed`.

### PUBLIC SIGNATURE NOTE (for the treeibp/treeos agent)

`commit_moment(root: &Path, act: &Json, ord: f64) -> Result<Committed, CommitError>` is unchanged.
The recovery runs internally, before the append, and is a no-op on a clean store. No new error
variant is surfaced to callers (a recovery I/O failure folds into the existing `CommitError::Io`).

---

## STEP 3 BUILD - the SIGNED seal via an injection seam (ADDITIVE, treestore stays ZERO-CRYPTO)

The doctrine-correct seal must SIGN: every act rides a signature that commits to the act's identity AND
the committed factIds (`seed/past/act/actSig.js`), so neither the act nor its facts can be swapped after
the seal. But treestore is the determinism-spine floor and MUST NOT pull crypto (`treesign`). The
resolution is an INJECTION SEAM: a new function takes a `sign` CLOSURE and treestore signs nothing
itself.

- **`commit_moment_signed(root, act, ord, sign: &dyn Fn(&Json, &[String]) -> Json) -> Result<Committed,
  CommitError>`** (additive, next to `commit_moment`; `commit_moment` is UNCHANGED). The closure receives
  `(the FULLY STAMPED act opening, the committed factIds)` and returns the `sig` subdoc
  (`{alg, by, value}`). It is the CALLER's crypto (genesis / the act path build it from `treesign`);
  treestore never depends on `treesign`. `treesign` is ONLY a **dev-dependency** of this crate, used by
  the round-trip test `tests/signed_commit.rs` (verified: `cargo tree -p treestore -e normal,build` has
  no `treesign`; it appears only under `-e dev`).

- **ACT-FIRST ordering** (the invariant that makes the act the moment's anchor):
  0. PAIR-CHECK / SELF-HEAL - the SAME `recover_*_before_commit` as `commit_moment`.
  1. SEAL the facts PURELY (`seal_moment`, NO write) to learn their `_id`s, so the signature can name
     them. The run-on (fan-out across >1 reel) is refused HERE, before the chain is touched - same floor
     as `commit_moment`. `seal_moment` only READS reel heads; the recovery already settled those heads,
     so sealing before the act write sees the same heads the post-act write would. Nothing is persisted.
  2. STAMP the act (`compute_act_doc` -> `_id` + chain `p`; `ord` post-id), call `sign(&act_doc,
     &fact_ids)`, attach the returned `sig` as a CLOSURE field (outside `content_of_act`, so `_id` is
     unchanged), append the SIGNED act line, advance `.acthead` under CAS. The act carries the signature
     and lands FIRST.
  3. WRITE the facts the seal ALREADY computed (reuse the `SealedFacts`, never re-sealed). These are the
     exact facts the act's sig named in step 2.

- **Why the seal moves earlier than in `commit_moment`.** `commit_moment` writes the act, then seals +
  writes facts. `commit_moment_signed` must know the factIds BEFORE the act is signed, so it seals
  (purely) first. This is safe because `seal_moment` is a pure read (it never writes), the recovery has
  already run, and the per-reel `.head` it reads is the same head the later fact write re-reads - so the
  factIds it computes ARE the factIds that get written. Verified by the round-trip test: the payload
  rebuilt from the STORED act + `Committed.fact_ids` verifies against the signer's key.

- **NO WALL TIME (the time-purge): the Rust SIGN + STAMP are CLOCK-FREE.** TIME is order (the chain
  `p`/`seq` and the global append `ord`), never a wall-clock (`philosophy/crystalized.md`). The act
  the seal stamps carries **NO `at`**, the stamp writes **NO `date`** on facts, and the going-forward
  `treesign::build_act_sig_payload` carries **NO `time`**. The ONLY non-digest ordinal the stamp adds
  is `ord` (a clock-free global append ordinal, KEEP it). Old JS acts baked the wall-clock into their
  sig; treesign verifies those ONLY through its explicit `build_act_sig_payload_legacy` read path
  (`verify_act_sig` = pure-first, legacy-fallback), never for new signing. The round-trip test signs
  + verifies the PURE (clock-free) payload; a tamper on a real field still fails (tested).
  - Reading an OLD store that HAS `at`/`date` is fine: those fields are inert (outside every canonical
    `_id`, since `content_of`/`content_of_act` exclude `date`/wall-clock); the Rust just never writes
    them. So the stamp is byte-identical-or-purer than the JS: it omits a wall-clock the JS used to add.

### The round-trip test (`tests/signed_commit.rs`, dev-dep `treesign`)

Three tests, all green: (1) a **Name-signed** act (the actor IS an ed25519 pubkey) round-trips -
`commit_moment_signed` -> read the act line -> rebuild the PURE (clock-free) payload from the stored
act + committed factIds -> `verify_name_sig` is TRUE, the stamped act carries NO `at` and the payload
NO `time` (the time-purge), the named fact landed, both chains verify, a tamper fails; (2) a
**story / "i-am"** act (signed with a story seed) verifies via `verify_with_pubkey` (the
`verifyWithPublicKeyPem` path), and `verify_name_sig("i-am", ...)` correctly fails ("i-am" is not a
pubkey id); (3) the seam is **additive** - a factless signed act is refused before the chain is touched,
and the un-signed `commit_moment` still stamps unchanged (its act carries NO `sig`). All pre-existing
tests (torn-write self-heal, clean byte-identical recovery, act-CAS, stamp/store vectors) stay green.

### PUBLIC SURFACE NOTE (for the treeibp/treeos/genesis agents)

`commit_moment` is byte-identical and UNCHANGED. `commit_moment_signed` is the additive signed peer;
genesis (Step 4) and the act path (Step 5) call it, supplying a `sign` closure built from `treesign`
(`load_story_seed` -> `build_act_sig_payload` -> `sign_value` for "i-am"; `keypair_from_seed` /
`build_act_sig_payload` / `sign_value` for a Name). treestore itself adds NO dependency.
