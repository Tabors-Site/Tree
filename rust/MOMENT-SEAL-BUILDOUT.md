# TreeOS — Moment-Seal & Node-Free Runtime Buildout

> Working doc. Claude drafted it from the tree-docs/philosophy corpus + the current Rust
> port state. **Tabor: read, correct, and add your calls inline** (look for `> DECISION:` and
> `> OPEN:` markers). Once you've marked it up we build it in the numbered steps. Nothing here
> is committed code yet — it is the plan.
>
> Source note: `tree-docs` (github) is private and unreachable from here (no token / no `gh`).
> This is distilled from the LOCAL `philosophy/` corpus (`mongorust`, `rasterize`, `signum`,
> `I_AM`, `root`, `math`, `theorems`, `dns`, the whole `word/` 0–27 + `moments` +
> `reading-the-trail`). When you drop a token I'll reconcile against `tree-docs`.

---

## A. WHERE WE ARE (the ground we build on)

- **The goal (Tabor):** a standalone **Node-free Rust binary** (`treeos`) that **boots + reads + acts + serves** a Story, sharing the byte-identical chain format. The JS is the live system *until* the Rust port is done; we replace it area-by-area. We are **NOT** wiring JS to call Rust (the napi `treehash-node` cutover was a detour — Node-in-the-loop is the opposite of the goal). The kernel crates are keepers; the JS→native wiring is throwaway.
- **The world/host line (phase0-cutlist — the single decision rule):** for every site ask *"would two different realities differ here?"* — **yes ⇒ WORLD** (`.word`, foldable, federatable: genesis, ables, DO-ops, types, identity ops); **no ⇒ HOST** (stays Rust/native). The irreducible HOST kernel = **crypto + CAS + raw IO + the minimal evaluator + the stamper (the four beats) + transports**. The moment-seal is squarely HOST. That is our lane.
- **What's already in Rust + proven byte-identical:** the determinism spine `treehash → treefold → treeverify → treestore → treeproj`. `commit_moment` exists (act-first ordered) in `treestore/src/moment.rs`. The other agent owns the Word/IBP layer (`treeword`, `treeval`, `treeibp`) and the server shell (`treeos`: `chain.rs` reads .proj/reels, `wire.rs` is an http/ws front). **Don't collide with those.**
- **What this buildout adds (the HOST frontier the docs call the hard part):** the **doctrine-correct moment-seal** — (1) the act writes its **act-log AND** its fact (the full pair), (2) **ed25519 signing in Rust** (the genesis frontier), (3) the **act/fact-boundary corruption-prevention** (no journal), and (4) **genesis** = plant a fresh Story headless. **Update (latest state):** `treeos` is already a complete binary that **writes** — it runs Words via `treeibp::act` with no Node. So this work is **not** a net-new act path; it is the doctrine-correct **seal + ed25519 signing + act/fact corruption-prevention that lives UNDERNEATH `treeibp::act`/the treestore commit**, plus `genesis`. Step 5 below reconciles with that existing write path (coordinate with the other agent who owns `treeos`/`treeibp`), rather than adding acting from scratch.

---

## B. THE DOCTRINE THE SEAL MUST ENCODE (distilled, with the verbatim invariants)

These are the laws the Rust seal cannot violate. Sources in parens.

1. **The Spacebar Law — one word = one commit = one fact = one moment.** (`word/23.md`, `word/moments.md`) A word's *compositeness* (`create space named X`) is its **content, not a count of facts** — it folds to ONE fact. `stampsFacts` (one act → N facts) is **rejected**; keep `stampsFact` **singular**. A Word of N deeds is **N MOMENTS in sequence** (`runWordToStore`), each its own chain-link, the chain re-folding between — never N facts crammed in one moment. *(The genesis root birth is the lone sanctioned 2-fact fusion — see §D.)*
2. **act = present, fact = past; the seal is the only change.** (`word/1.md`, `word/9.md`, `reading-the-trail.md`) "An act is the clause in the present, and the instant it seals it is a fact, the same clause in the past; **the seal is the only change. An act is always its own fact this way.**" Tense is the foundation. `be → chain` (the laid order, sealed past), `is → fold` (the read into the present).
3. **Atomic seal; a crashed moment leaves zero trace.** (`math.md`) "The seal is **atomic** — all of ΔF lands, or none does: `commit(ΔF) ∈ {all, nothing}`." "**A crashed moment leaves zero trace.**" "**Identities are computed inside the seal** — a fact and its identity land together or not at all."
4. **Identity IS content; computed, never assigned.** (`math.md`, `theorems.md`) `id(f) = H(p ‖ canon(f))`, `p = id(f_{n-1})`, genesis `p = G` (sixty-four zeros). "There is no assigned identifier and no separate self-hash field — the fact's identity IS its content hash." Act-chain obeys the same per-position law over act *openings* but **does NOT link across forks** (a name's first act through a being on any history chains from `G`).
5. **PAST FIXED — append-only, never overwrite, never mutate, never reorder.** (`math.md` A1, `theorems.md`) Change = **append a newer fact the fold prefers**, never edit. Undo = **reversal facts** stamped in reverse ("unstamp by stamping"), never deletion. **I-genesis facts are never overwritten** (guard already built).
6. **Determinism is required by CAS replay, not a nicety.** (`word/2.md`, `math.md` A4) `canon` = **sorted keys, fixed forms, fixed number handling, NO wall-clock, NO randomness** inside evaluation, a **versioned wire format**; `p` is a **fixed-length prefix** of the hash input. Wall-clock witnesses (`date`/`at`/`receivedAt`) are **OUTSIDE canon** — display only, never folded, never in `id`. "The same `.word` yields the same chain." *(treehash already proves this 43/43.)*
7. **Attribution is the key's, not a label's.** (`math.md` ATTRIBUTION, `signum.md`, `word/17.md`) `by` = the **Name** (the signer, ed25519) — always a Name ref, never a key value, never a being. `through` = the being it acts through (absent for Name-layer acts). The verb **"refuses to stamp a fact whose seal it did not sign."** No name can sign as another. The being **keys** the act-chain (`story:history:beingId`); the Name **signs** — do NOT re-key to nameId (a Name acts across stories).
8. **`fact.verb` is in the hash — never re-derive a sealed fact's verb.** (`word/17.md`) Derive verb from the word's kind **at STAMP time only**, never at read time. A signed foreign deed's verb is **recorded, never re-derived** (re-deriving changes the hash, breaks the sig, forks the chain).
9. **TIME is order, not count.** (`crystalized.md`, time-purge memory) The **chain head is the program counter / the now**; idle is still. Order = seq · causal link · lineage · the global append ordinal (`ord`/`bornOrd`). No wall-clock dependency anywhere in the fold or the seal.
10. **The view/face is folded fresh, never stored.** (`math.md`, reading-the-trail) Projections (.proj, indexes, position, inbox) are **caches, rebuildable downward**; the only irreducible truth is the chain. The longest fold (`genesis → head`) reads back as the creation story and begins "I am."

---

## C. THE ACT/FACT BOUNDARY — corruption-prevention with NO journal (the heart)

This is the piece Tabor flagged hardest. Here is the model the docs actually describe, and the one design fork that needs your call.

### C.1 The truth model (mongorust.md, verbatim)
> "**The act IS the atomic unit — no separate WAL.** The journal entry is the act, and the act was always the atomic unit. An act lays its N facts as **one moment** … there's no 'half a moment' to recover from because a moment was never divisible. The act-write **is** the truth-write; **reel files are the fold of the act-log by reel — even reel files are a cache; the only irreducible truth is the act-log.**"

So the canonical stack is: **act-log (TRUTH)** → reel files (fold by reel) → `.head` snapshots → in-memory map. Recovery: "any moment written-but-not-marked-done gets **re-applied (idempotent, because facts are content-addressed — re-applying a fact with the same hash is a no-op)**."

### C.2 The torn-write / orphan mechanism (theorems.md, Theorem 7 Scope + Cor 7.1, verbatim)
> "a non-transactional append that crashes between the fact insert and the head update **leaves headHash one fact behind until the next append self-heals** — roots are functions of the rows fed to them, so during that window the root witnesses the lagging head, and **verifyReel's walked head is the exact truth.**"

Putting C.1 and C.2 together — **Tabor's "simple elegant solution," reconstructed:**

- The **head pointer is the commit marker.** A fact/act is *committed* exactly when its head (`.head` / `.acthead`) advances to it. A line on disk whose head never advanced is an **orphan** — uncommitted, not yet real.
- A torn write (line written, head not advanced) leaves an orphan; **the head trails it.** `verifyReel` **walks** the reel and the *walked head is the truth* — it ignores the orphan tail.
- **The next act self-heals:** it re-derives `p` from the *walked* (true) head and appends correctly **past** the orphan. The orphan is **left behind / overwritten-forward** — i.e. the next good fact takes that seq position, chaining from the true head. The crashed moment **leaves zero trace** (the orphan is never committed, so it never happened).
- **NEVER overwrite a committed (head-advanced) fact** — that breaks every downstream `p` link and the reel fails verification *at* the altered fact ("the break propagates forward"). Overwriting *committed* data is the one thing that corrupts the whole chain. Overwriting an *uncommitted orphan* is fine (it was never real).
- **The pair:** every moment is an act ⟷ its fact(s). A complete pair = the act committed **and** its fact present. An **orphan = an incomplete pair** (a fact whose act didn't commit, or vice-versa) — removed/healed by the next act, never by mutating the past.

This is the whole corruption story, and it is **why the journal could be deleted:** the head-as-commit-marker + walk-to-true-head + content-addressed idempotency replaces the WAL. No `commitMoment` WAL, no replica set, no transaction.

### C.3 The one fork that needs your call

The two readings of C.1/C.2 differ in *what carries the recoverable truth*, and it changes the code:

> **DECISION (truth model):**
>
> **(A) Act-log is THE truth, reels are its fold (mongorust, literal).** The act-log entry carries the **whole moment** (the act opening + the facts it lays = its ΔF). Writing the act-log entry is the single atomic commit; reels are *re-derived* from it; recovery = replay the act-log (idempotent). **Cleanest** (one atomic unit, "no half a moment"), simplest recovery. **Cost:** the act-log line gains a `deltaF`/moment field → the `.acts` bytes diverge from today's JS `.acts` (the reels + `act_id`(opening-hash) + sig stay identical, and old act lines without `deltaF` are still complete/verifiable, so it's *additive + verification-compatible*, but a raw byte-diff of `.acts` differs, which may touch federation since signed acts cross the wire).
>
> **(B) Reels are truth, act-chain is a co-equal peer (today's code + math.md REEL).** Two commit points (`.head` + `.acthead`); recovery is purely the C.2 head-trails-self-heal; **byte-identical to today, zero format change.** **Cost:** the moment has two heads, so atomicity is "both advanced" rather than one indivisible append; a torn write between the two needs the pair-check to discard the orphan side. The act signs the **factIds** (as today), so to stay *act-first* the seal computes the factIds deterministically (deltaF + reel-`p`) **before** writing, signs, then writes — same bytes, act-first order.
>
> **Claude's lean:** **(B) for the cutover** (keep the byte-identical chain so `treeos` reads existing Stories + the other agent's federation isn't disturbed), with the **pair-check + head-as-commit-marker** giving the corruption guarantee; then **(A) as the end-state** once we're willing to re-genesis / version the act-log (it's the doctrinally pure "act is the atomic unit"). **Tabor — which, and is a one-time act-log format bump acceptable?**

### C.4 Act-first vs the current JS order (a real bug we're fixing either way)
Today `4-stamped.js` is **facts-first**: `commitMoment` writes the facts → signs the act over their `factIds` → appends the act. Tabor: that order is wrong; **the act commits, the fact derives.** Under **(B)** we keep the same *bytes* but flip to *act-first order* (compute factIds → sign → write act → derive facts), and the head-as-commit-marker makes the order safe. Under **(A)** the act-log entry simply *is* the commit and the reels derive after. Either way the memory `project_treestore_write_cutover.md` line is corrected: **acts write, then fact after; the act is the moment's deed; the fact is its stamp.**

---

## D. SIGNING & GENESIS (the crypto frontier)

### D.1 The scheme (must be byte-identical to `materials/name/keys.js` + `past/act/actSig.js`)
- **ed25519.** A **Name's id IS its public key**, encoded `z` + base58btc(`0xed01` ‖ raw32) (the did:key multibase form). Self-certifying: verify straight from the id, no directory. (`keys.js`, `dns.md`)
- **Sign = `crypto.sign(null, canonicalize(payload), privPem)` → base64.** The payload (`buildActSigPayload`) is `{actId, by, through, to, story, history, p, factIds(sorted), time(at ISO)}`. The sig **commits to**: the act's opening hash (`actId`), its chain position (`p`), and the **sorted committed factIds** — so neither act nor facts can be swapped after the seal. It rides as a **closure field** (`act.sig`), outside `contentOfAct`, so it never changes `act._id`.
- **Keys:** a being's Name holds an ed25519 keypair (priv = 32-byte seed, PKCS8 = 16-byte prefix ‖ seed; BIP39 mnemonic ↔ seed). **I / the story** signs with the **story key** (`storyIdentity`); `i-am` is not a pubkey so verification routes to the story public key.
- > **OPEN (crypto deps):** the determinism-spine crates are zero-dep on purpose. ed25519 needs a crate (`ed25519-dalek` + `sha2`/`curve25519-dalek`, and base58 + BIP39). Proposal: a **new `treesign` crate** that owns ALL crypto (so the spine stays zero-dep and the trust surface is one auditable place), depending only on vetted crypto crates. Tabor: OK to add `ed25519-dalek` et al. in an isolated `treesign` crate?

### D.2 Genesis — plant a fresh Story headless (I_AM.md, root.md, signum.md, 5d.md)
- **One root keypair, generated once at first boot** (BIP39 → ed25519). It signs the genesis fact and every Merkle root forever. **No second keypair at genesis.** The id (pubkey, did:key form) names **both** I-the-being and the-reality — one id, two views.
- **The genesis fact = the self-grounding root birth:** the lone sanctioned fusion `name:declare` + `be:birth` in one atomic moment — I asserts its own being (AM) and names itself, **parentless** (the only birth with `params.parentBeingId == null`). It is **asserted/signed, not folded** ("the Root is signed, never folded"; "you do not write the I, the signing reveals it" — the signer field IS the identity).
- **Then descend the first beings** (seed delegate / founder operator) from I through the being-tree, each a normal content-hash being whose facts chain from the genesis fact. **I holds and signs; the descendants act.**
- This is the path from `treeos` *read+serve* → **act+genesis**: with `treesign` + the seal, `treeos` can generate the I key, build+sign the root-birth, and write fact #0 of a fresh chain with **no Node**.

---

## E. THE BUILD, IN STEPS (each independently verifiable; leave a note file per step)

> Method (Tabor's rules): **steps, not a big bang**; **parallel agents** where independent; **leave notes in files** (each step writes/updates `rust/<crate>/NOTES.md`); **DON'T delete JS that's still in use** — JS is the live system until the port's done, so each step *adds* Rust + proves parity and leaves the JS path intact; **don't pollute** — match surrounding style, no dead scaffolding.

**Step 0 — Lock the doctrine (this doc).** Tabor marks up §C.3, §D.1 OPENs. Output: the decisions filled in. *(No code.)*

**Step 1 — `treesign` crate (crypto, isolated).** ed25519 sign/verify + the Name-id codec (base58btc/multicodec did:key) + the canonical sig payload (`buildActSigPayload`) + BIP39 seed↔keypair. *Invariant:* §D.1, byte-identical to `keys.js`/`actSig.js`. *Proof:* a conformance test signs/verifies vectors captured from the live JS (same key, same payload → same base64 sig; verify a real signed act from a genesis store). *JS:* untouched. *Note:* `rust/treesign/NOTES.md`.

**Step 2 — The act/fact pair-check + head-as-commit-marker in `treestore`.** Implement C.2: `verify-walked-head` (the true head ignoring an orphan tail), `next-append-self-heals` (re-derive `p` from the walked head), and the **pair-check** (an act ⟷ its fact; an orphan is discarded forward, a committed fact is never overwritten). *Invariant:* §C.2, "zero trace," "never overwrite committed." *Proof:* a torn-write test (write a fact line, do NOT advance the head; next append must land at the orphan's seq from the true head; verifyReel intact; a committed fact is never touched). *JS:* untouched (this is new Rust recovery; JS keeps its current path). *Note:* update `treestore/NOTES.md`.

**Step 3 — Doctrine-correct `commit_moment` (the full seal).** Per the §C.3 decision: the seal computes factIds deterministically → **signs the act** (`treesign`) → writes the act-log **and** the fact(s) **act-first**, atomically, never overwriting; consequences are left to the fold, never co-stamped; SEE (`ΔF=∅`) seals nothing. *Invariant:* §B 1–7, §C. *Proof:* a moment committed in Rust folds + verifies byte-identical to the JS-committed equivalent (reels identical; act_id + sig identical under (B)); the run-on guard refuses ΔF>1 except the genesis root birth. *JS:* still untouched — Rust path proven in tests first. *Note:* `treestore/NOTES.md`.

**Step 4 — Genesis: plant a fresh Story headless.** §D.2: generate the I keypair → build + sign the root-birth (the `name:declare`+`be:birth` fusion, parentless) → write fact #0 → descend the seed delegates. *Invariant:* §D.2, the I-immutability guard. *Proof:* a Rust-planted genesis store **boots + folds + verifies** with no Node, and (if (B)) is byte-comparable to a JS genesis. *JS:* a parallel path, JS genesis still works. *Note:* `rust/treeos/NOTES.md` (coordinate with the other agent — genesis touches their `treeos`).

**Step 5 — Wire act+genesis into `treeos` (boot+read+act+SERVE).** `treeos` already reads/serves; add the **act** path (an inbound signed act → `commit_moment` → fold) and the **genesis** subcommand. *Invariant:* the world/host line (only HOST here; ops/types/identity stay `.word`). *Proof:* `treeos` boots a fresh Story, accepts a signed act over the wire, stamps it, serves the updated fold — **no Node in the loop.** *JS:* unchanged; this is the parallel Node-free runtime maturing. *Note:* `treeos/NOTES.md`.

**Later (not this pass, noted for order):** federation (IBP/Peering, signed address facts, `receive` verifying a book's colophon before plant — `book.md`/`dns.md`); the P6 compile-Word; the P7 **conformance suite** (the frozen corpus every host incl. the Rust kernel must pass — this is the eventual gate that validates the whole port).

---

## F. GUARDRAILS (Tabor's standing constraints)
- **Don't delete JS that's still used.** JS is the live system until the Rust port is complete; every step *adds* Rust and proves parity, leaving the JS path intact. Delete a JS area only when its Rust replacement fully subsumes it (and even then, per Tabor: reimplement-then-delete, never pick at it).
- **Don't pollute the codebase.** Match surrounding style/comment density; no dead scaffolding; the napi `treehash-node` wiring is throwaway (don't extend it further).
- **Steps + notes + agents.** Each step is independently verifiable, writes a `NOTES.md`, and uses parallel agents where the work is independent (e.g. Step 1 `treesign` and Step 2 pair-check are independent — run together).
- **Coordinate on shared crates.** `treeos`/`treeibp`/`treeword`/`treeval` are the other agent's lane; Steps 4–5 touch `treeos`, so leave notes and don't revert their in-flight edits.

---

## G. OPEN DECISIONS FOR TABOR (the short list to mark up)
1. **§C.3 truth model:** (A) act-log-is-truth (carries the moment; cleanest; act-log format bump) vs (B) reels-truth + pair-check (byte-identical; two heads). One-time `.acts` format bump acceptable?
2. **§D.1 crypto deps:** OK to add `ed25519-dalek`/`bip39`/base58 in an isolated `treesign` crate (spine stays zero-dep)?
3. **Act-line `deltaF`:** if (A), the act-log carries its ΔF for recovery — confirm.
4. **Genesis ownership:** Steps 4–5 land in `treeos` (other agent's crate). Coordinate, or do genesis in a `treegenesis` crate of ours that `treeos` calls?
5. **Anything the private `tree-docs` says that contradicts the above** — drop a token and I'll reconcile.
