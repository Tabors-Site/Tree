# Theorems

Formal consequences of TreeOS's substrate axioms. Each theorem starts
from the laws already declared elsewhere (math.md, the various
doctrine files), states them precisely, and derives a result that
follows necessarily. Eight theorems, organized from the most
mechanical (biography immutability) through the keystone (the
fundamental theorem of becoming) to the most generative (harmony —
how shared worlds emerge at all).

## Notation

Let `B` be a being and `w` a world. A world is a branch within a
reality; two realities' branches are simply more worlds. The objects:

- `R_B^w`. Being `B`'s visible reel in world `w` — the lineage union
  math.md writes as `R̂`: ancestor segments below each branch point,
  plus `w`'s own divergence. A finite sequence of facts, ordered by
  seq. One reel, one chain, read across worlds.
- `|R_B^w|`. The length of `B`'s visible reel in `w`.
- `f_i`. A fact at position `i` on some reel. Each fact carries
  canonical content `c_i`, prev hash `p_i`, and its **identity**
  `id_i` — there is no separate stored hash field; the identity IS
  the hash (math.md FACT).
- `head(R)`. The identity `id_n` of the last fact in `R`. If `R` is
  empty, `head(R) := G`, the genesis sentinel.
- `A_B^w`. Being `B`'s act-chain in `w` — hash-linked like a reel:
  each act's identity is the hash of its opening chained to the
  previous sealed act's identity.
- `id_B`. The being's identifier, **assigned** at birth, immutable.
  Note the deliberate contrast: facts and acts have *intrinsic*
  identity (they are what they hash to); a being's identity is
  *assigned and constant* (it is the thread, not a content).
- `figure_B^w`. The being's projected state in world `w`. Defined as
  `fold(σ_0, ⟨c_1, c_2, ..., c_n⟩)` where `fold` is a pure
  deterministic reducer over **canonical content** and `σ_0` is a
  fixed initial state.
- `biography_B^w`. Equivalent to `figure_B^w`; used when emphasis is
  on the historical view rather than the present state.
- `doer(f)`. The being recorded as the actor of fact `f`.
- `≺`. The causal partial order on facts. `f ≺ g` iff `f` precedes
  `g` on the same reel, or some chain of summon facts connects them
  in that direction (transitive closure).
- `root(w)`, `root(𝓡)`. The branch and reality root hashes
  (math.md ROOTS): canonical roll-ups over reel heads + act-chain
  heads per branch, then over branch roots per reality.

## Axioms

The following axioms are doctrinal commitments of the substrate.
The proofs below treat them as given.

**A1 (Append-only).** Reels grow only by appending. No fact is ever
removed, reordered, or mutated. For all worlds `w` and times
`t_1 ≤ t_2`: `R_B^{w, t_1} ⊆ R_B^{w, t_2}` (as initial segment).

**A2 (Identity is the chained hash).** Every fact's identity is
`id_i = SHA-256(p_i ‖ canonical(c_i))`. For `i ≥ 2`: `p_i = id_{i-1}`
— where `i-1` is the prior fact in the *visible* reel, so the first
divergent fact of a branch chains to its parent's fact at the branch
point: one chain, linked across the fork. For `i = 1`: `p_1 = G`.
Act-chains obey the same per-position law over act openings, but do
NOT link across forks: a being's first act on any branch chains from
`G` (cross-branch biography continuity is the `be:switch` fact on the
REEL, not the act-chain — actHash.js). Each per-branch act chain is
complete from genesis, which is what Theorem 7's descent uses.

**A3 (Collision resistance).** SHA-256 is collision resistant.
Operationally: `SHA-256(x) = SHA-256(y)` implies `x = y` (with
overwhelming probability; the proofs carry this as the standard
cryptographic assumption).

**A4 (Reducer determinism over canonical content).** `fold` is a
pure function over canonical content. Same `(σ, canonical(c))`
inputs always produce the same `σ'`. Canonical content is what the
identity commits to; **wall-clock witness fields (`date`,
`receivedAt`, `stampedAt`) are outside it by doctrine** — they are
display helpers for humans filtering timelines, never truth. State
equality throughout these theorems means equality of canonical
content and its fold; witness fields ride beside the chain and may
differ without the worlds differing. A4 carries one obligation on
reducer authors: **a reducer must not depend on any feature
canonical serialization erases** (raw Date objects vs ISO strings,
undefined vs absent keys, empty objects, non-finite numbers) —
otherwise two rows with equal canonical forms could fold
differently while their identities verify equal. The seed's
reducers honor this; it is a stated law, not an accident.

**A5 (Genesis constant).** `G` is one fixed string (sixty-four
zeros), identical across every world. `G` is formally a possible
SHA-256 output; by A3's assumption the probability that any fact's
identity equals `G` is negligible, and the proofs treat "prev = G"
as identifying the genesis position. (The earlier claim that `G`
lies outside SHA-256's codomain was false and is retired.) One
implementation honesty: the append path degrades `p` to `G` when
the prior row is missing (a crash burned a seq, or a pre-CAS row) —
so `p = G` at a non-genesis position is a *deterministic
possibility* on a damaged reel, not only a hash accident. verifyReel
reports such reels as broken (`seq-gap` / `unaddressed`) rather than
intact; Theorem 1's guarantee is therefore stated for reels that
VERIFY, and on a damaged reel it runs back to the nearest genesis
link.

**A6 (Attribution + gated influence).** Three clauses, matching the
implementation (math.md ATTRIBUTION):

1. *Attribution is unforgeable.* Every fact's `doer` is the
   authenticated actor — the verb layer sets it from the verified
   identity and accepts no override. No being can produce a fact
   claiming another being acted.
2. *Self-acts come only from self.* BE facts (birth, connect,
   release, switch, death) on `R_B` carry `doer = B`, always.
3. *Figure influence is gated and summons are inert.* Every fact
   that mutates `figure_B` either has `doer = B` or passed the
   role-walk (the single auth gate) as an authorized DO on `B`.
   Summon facts land on the recipient's reel (target = recipient,
   doer = summoner) and the reducer folds NO summon action —
   a summon records the request and can never change what the
   recipient is. Callers express; receivers decide.

(The earlier form — "a being's reel holds only its own deeds" — was
refuted by the 2026-06-03 summon retarget and is retired; this is
the law the code actually enforces.)

**A7 (Identity constancy).** Each being's identifier `id_B` is
assigned at birth (by the `be:birth` fact) and is never the target
of any subsequent fact. For all worlds `w` and times `t` after
birth: `id_B^{w, t} = id_B`.

**A8 (Reel independence).** Two reels `R_A^w` and `R_B^w` for
distinct beings `A ≠ B` are independent unless a fact on one reel
explicitly references the other (via summon, cross-reel act, or
similar). Absent such a link, no causal ordering relates the two.

**A9 (Canonical roll-up).** Branch and reality roots are computed by
one canonical serialization of sorted parts:
`root(w) = SHA-256(canonical(w, parent(w), β_w, sorted reel heads,
sorted act heads))` and
`root(𝓡) = SHA-256(canonical(domain, sorted (w, root(w))))`.
(math.md ROOTS; one roll-up builder in code, no ad-hoc
serialization.)

## Theorem 1. Biography immutability

**Statement.** Let `R_B^{w_1} = ⟨f_1, ..., f_n⟩` and
`R_B^{w_2} = ⟨g_1, ..., g_m⟩` be two visible reels for the same
being `B` observed in two worlds. If
`head(R_B^{w_1}) = head(R_B^{w_2})`, then `n = m`, the canonical
contents agree position-by-position, and therefore
`biography_B^{w_1} = biography_B^{w_2}`.

**Proof.** By reverse induction on reel position.

Step 1. Equal heads imply equal final facts. Assume
`head(R_B^{w_1}) = head(R_B^{w_2}) = H`. By A2,
`H = SHA-256(p_n ‖ canonical(c_n))` for reel 1 and
`H = SHA-256(p_m ‖ canonical(c_m))` for reel 2. By A3, the SHA-256
inputs are equal: `p_n ‖ canonical(c_n) = p_m ‖ canonical(c_m)`.
Since the prev hash is a fixed-length prefix, this factors as
`p_n = p_m` and `canonical(c_n) = canonical(c_m)`. The final facts
are equal in canonical content. (Equality is *of canonical forms* —
exactly the equality the substrate stores and the fold consumes,
per A4.)

Step 2. Equal prev hashes imply equal predecessor heads. By A2,
`p_n = id_{n-1} = head(⟨f_1, ..., f_{n-1}⟩)` and
`p_m = id_{m-1} = head(⟨g_1, ..., g_{m-1}⟩)`. From Step 1,
`p_n = p_m`, so the truncated reels have equal heads.

Step 3. Inductive descent. Apply Step 1 to the truncated reels:
equal heads imply equal final canonical contents and equal prev
hashes. Iterate. The iteration terminates because reels are finite.
At the bottom, both reels reach a fact with prev hash `G` (by A2
and A5). By A5 only the genesis position carries prev `G`, so both
descents bottom out together and `n = m`.

Step 4. By A4, `biography_B^w` is a deterministic fold over
canonical contents. Since `canonical(c_i)` is identical at every
position across the two reels, the folds agree. Therefore
`biography_B^{w_1} = biography_B^{w_2}`. ∎

**Corollary 1.1 (Tamper evidence).** Any mutation to a fact's
canonical content at position `k ≤ n` propagates to `head(R_B^w)`.
A party knowing the original head detects the tampering by
recomputation. (Proof: by A2 and A3, changing `canonical(c_k)`
changes `id_k`, which changes `p_{k+1}`, which changes `id_{k+1}`,
by induction up to `id_n`.)

**Corollary 1.2 (Witness fields are invisible — by design).**
Mutating a wall-clock witness field (a fact's `date`) changes
nothing in any identity, head, or fold: witnesses are outside
canonical content (A4). The chain neither protects nor depends on
human time. This is the formal face of the doctrine "the date is a
display helper, never truth."

**Corollary 1.3 (Act-chains too).** The same argument applies
verbatim to `A_B^w`: acts are hash-chained on their openings (A2),
so equal act-chain heads imply equal opening sequences. The closure
fields (status, the sealing utterance) are bookkeeping outside the
identity — what *happened* is the facts the act produced, which
Theorem 1 already covers.

**What this captures.** The biography's 32-byte head is a faithful
commitment to the entire history. Equal heads imply equal chains;
different heads imply different chains. The substrate gains
verifiable replay, efficient federation, and a structural audit log
from this one property.

## Theorem 2. Attribution prevents identity theft

**Statement.** Let `A` and `V` be distinct beings (`A ≠ V`). Then:

1. `A` cannot produce any fact `f` with `doer(f) = V`
   (impersonation is impossible).
2. Every change to `figure_V^w` traces to `V`'s own acts or to
   role-authorized acts on `V` — never to anything `A` does outside
   the role-walk's grants.
3. No summon `A` sends can change `figure_V^w` at all, even though
   it lands on `V`'s reel.

**Proof.** (1) By A6.1, `doer(f)` is set by the verb layer from the
authenticated identity of the sealer. `A` seals as `A`; the layer
accepts no override. So every fact `A` produces carries
`doer = A ≠ V`. ∎

(2) `figure_V^w = fold(σ_0, R_V^w)` (A4). By A6.2 and A6.3, the
facts in `R_V^w` that the reducer folds into the figure are exactly:
`V`'s own BE-acts, and DO facts on `V` that passed the role-walk.
Any influence `A` has on `figure_V` therefore flowed through a
grant `V`'s world explicitly extended (a role whose canDo reaches
`V`) — gated influence, not theft. ∎

(3) By A6.3, summon facts are figure-inert: the being reducer folds
no summon action. `A`'s summon appears in `R_V^w` as the recorded
knock — target `V`, doer `A` — and contributes nothing to the fold.
`V`'s figure is unchanged unless `V` chooses to act. Callers
express; receivers decide. ∎

**Corollary 2.1.** A being's BECOMING is its own: every figure
change is either the being's own act or an act the world's roles
authorized — and the chain records which, by unforgeable
attribution. Audit is reading, not forensics.

**Corollary 2.2 (Sovereignty, formal).** The summon channel —
the only way one being reaches another — cannot compel. It can
only present. This is SUMMON.md's sovereignty principle as a
consequence of the reducer's shape rather than a policy.

**What this captures.** Identity theft is structurally impossible
in the substrate — not because reels are private (they are not;
summons and authorized DOs land on them) but because attribution
cannot be forged, influence is role-gated, and requests are inert
until the receiver acts. The lock is on WHO ACTED and WHAT FOLDS,
not on where facts may sit.

## Theorem 3. There is no global time

**Statement.** Let `w` be a world containing at least two
independent beings `A` and `B` (by A8). The causal partial order
`≺` on facts in `w` is not a total order, and admits multiple
distinct linear extensions. No canonical function `τ: Facts → ℕ`
exists that respects `≺` and is uniquely determined by the
substrate.

**Proof.** Construct a minimal counterexample. Let
`R_A^w = ⟨A_1, A_2⟩` and `R_B^w = ⟨B_1, B_2⟩` be two reels of length
2 each, with no cross-reel summon facts (independence holds by A8).

By the definition of `≺`:

- `A_1 ≺ A_2` (same reel, in order)
- `B_1 ≺ B_2` (same reel, in order)
- No other ordering relations hold (independence implies no
  cross-reel comparability).

`≺` is a strict partial order. The pair `(A_1, B_1)` is incomparable
under `≺`: neither `A_1 ≺ B_1` nor `B_1 ≺ A_1` holds.

The set of linear extensions of `≺` on `{A_1, A_2, B_1, B_2}`
includes:

```
A_1, A_2, B_1, B_2
A_1, B_1, A_2, B_2
A_1, B_1, B_2, A_2
B_1, A_1, A_2, B_2
B_1, A_1, B_2, A_2
B_1, B_2, A_1, A_2
```

All six are valid linear extensions of `≺` (each preserves
`A_1 ≺ A_2` and `B_1 ≺ B_2`). The substrate has no axiom that
selects any one of them over the others. (A fact's wall-clock
`date` cannot serve as the selector: by A4 it is a witness outside
canonical content, carried for human display, not substrate truth.)

Suppose `τ: Facts → ℕ` is any order-preserving function
(`f ≺ g` implies `τ(f) < τ(g)`). Then `τ` induces a linear
extension. Since six distinct extensions exist and the substrate
distinguishes none, `τ` is not uniquely determined. ∎

**Corollary 3.1.** Time in TreeOS is local. For each being `B`,
`T_B^w := |R_B^w|` is a well-defined natural-number time, monotone
in the append order. Cross-being time requires additional structure
(a summon fact connecting the two reels) to become defined.

**Corollary 3.2 (Presents are per-world).** Worlds need no
coordination beyond messages: the branch point freezes the shared
prefix (ancestors append only above it, descendants read only below
it), so one present per world runs without locks against any other
(math.md PRESENT). Acting into another world — sibling branch or
foreign reality, same shape — is a request delivered to that
world's present.

**What this captures.** TreeOS does not pretend to have a universal
clock. Independent reels run in independent time. Causality between
them is only what the chain explicitly records (via summons or
crossOrigin). This is the same shape Lamport identified for
distributed systems: partial order is the natural object; total
order is a choice.

## Theorem 4. The present cannot be reconstructed

**Statement.** Let `F` denote the set of possible faces (full
present-moment perceptual states of a being). Let `produces: F → H`
map a face to the fact sequence it stamps, where `H` is the set of
possible fact sequences. Then `produces` is not injective: there
exist faces `F_1, F_2 ∈ F` with `F_1 ≠ F_2` and
`produces(F_1) = produces(F_2)`. Therefore from a fact sequence
alone, the originating face is not uniquely recoverable.

**Proof.** Construct two distinct faces that produce identical
facts.

Let `F_1` be the face: "I considered three options X, Y, Z, weighed
them against criterion C, and chose X."

Let `F_2` be the face: "I considered five options X, Y, Z, V, W,
weighed them against criterion C', and chose X."

`F_1 ≠ F_2`: they differ in the option set considered, in the
criterion applied, and in the internal reasoning trace.

Both faces, when acted on, stamp the same fact:
`do:choose(target=X)`. The substrate records the chosen action,
not the deliberation that produced it.

Therefore `produces(F_1) = produces(F_2)` while `F_1 ≠ F_2`. The
function `produces` is not injective. ∎

**Corollary 4.1.** History determines facts. Facts do not determine
consciousness. (Direct restatement: `produces` is well-defined as a
forward map; its inverse is set-valued, not function-valued.)

**Corollary 4.2.** Replay reconstructs becoming, not being's
interior. Folding a chain forward through the reducer reproduces
every projected state. It does not reproduce the deliberative
faces that originally stamped each act. (The act-chain deepens this
without changing it: an act's identity commits to its *opening* —
who was summoned, with what message — never to the deliberation;
the closure utterance is bookkeeping outside the identity.)

**What this captures.** The substrate honors what was DONE. It does
not pretend to honor what was THOUGHT. Multiple faces collapse into
the same observable fact, and the substrate accepts this collapse
as a feature, not a deficiency. Consciousness is local to the
present moment; only its actions persist into history.

## Theorem 5. Branches preserve identity continuity

**Statement.** Let `w` be a world and `w'` a branch forked from `w`
with per-reel branch point `β`. Let `B` be a being existing in `w`
at the fork. Then `id_B^w = id_B^{w'}`. Only `figure_B^w` and
`figure_B^{w'}` may diverge.

**Proof.** By A7, `id_B` is assigned by the `be:birth` fact and
never modified. Let `f_birth` denote `B`'s birth fact, with the
identifier `id_B` recorded in its content.

Since `B` exists in `w` at the fork, `f_birth` sits in `w`'s reel
for `B` at some seq at or below `β_{w'}(B)`.

A fork copies **nothing**. It records `β`: the parent's per-reel
positions at the anchor. The child's *visible* reel `R_B^{w'}` is,
by definition (math.md REELS & CHAINS), the union of ancestor
segments below each branch point plus the child's own divergence —
so `f_birth ∈ R_B^{w'}` because the child *sees* the parent's
prefix, not because any row moved. The shared prefix is frozen by
construction: the parent appends only above `β`, the child reads
only below it.

By A7, `id_B^{w'}` is read from `f_birth`. Since the birth fact is
one fact visible in both worlds, the identifier is identical:
`id_B^w = id_B^{w'}`.

After the fork, the two worlds accumulate divergent facts (each
above `β`, each chained across the fork by A2 — the child's first
divergent fact carries `p` equal to the parent's fact at `β`).
These post-fork facts join the fold and may produce divergent
figures: `figure_B^w ≠ figure_B^{w'}` is possible. But by A7, none
of these post-fork facts mutate `id_B`. The identifier remains
constant. ∎

**Corollary 5.1.** Identity is shared across the branch tree. For
any forest of branches rooted at the same world `w`, every being
`B` has a single `id_B` shared by all descendants.

**Corollary 5.2.** Becoming is per-branch. Two descendants of `w`
may have wildly different `figure_B` values for the same being `B`,
explained entirely by divergent histories after the fork.

**Corollary 5.3 (One history, many tails).** Because the prefix is
shared by *reference* and the chain links across the fork (A2),
"the same fact on two branches" is literally one fact, stored once
— not two copies that happen to agree. Branch divergence is where
chains split, not where data duplicates.

**What this captures.** Branches do not split beings. They split
becomings. The being persists as identity across every fork; only
the history (and hence the figure) varies. This is the formal
version of the distinction between WHAT a being IS (constant) and
WHAT IT HAS BECOME (history dependent).

## Theorem 6. Fundamental theorem of becoming

*The keystone. Everything else in this file is machinery; this is
what the machinery is FOR.*

**Statement.** Under axioms A1, A4, and A7:

```
Being     = Identity        (constant per being across all worlds and times)
Becoming  = History         (the fact sequence on the being's reel)
```

For any being `B`, world `w`, and times `t_1 < t_2`: if
`figure_B^{w, t_1} ≠ figure_B^{w, t_2}`, then `R_B^{w, t_1}` is a
proper prefix of `R_B^{w, t_2}`. Every observable change in `B`
between `t_1` and `t_2` is explainable as additional history.
Identity `id_B` is unchanged.

**Proof.** Suppose `figure_B^{w, t_1} ≠ figure_B^{w, t_2}`.

By definition,
`figure_B^{w, t} = fold(σ_0, canonical(R_B^{w, t}))`. By A4, `fold`
is deterministic. If `R_B^{w, t_1} = R_B^{w, t_2}`, then their folds
would agree, contradicting the hypothesis. Therefore
`R_B^{w, t_1} ≠ R_B^{w, t_2}`.

By A1, reels grow only by appending. Therefore `R_B^{w, t_1}` is
either equal to or a proper prefix of `R_B^{w, t_2}`. Since they
differ, `R_B^{w, t_1}` is a proper prefix. At least one fact `f`
was sealed onto `R_B^w` strictly between `t_1` and `t_2`.

By A7, `id_B^{w, t_1} = id_B^{w, t_2} = id_B`. The identifier is
unchanged.

The change in figure is fully explained by the appended facts; the
identifier did not move. Becoming differs because history differs;
being remains constant. ∎

**Remark (what content addressing adds to this).** Full CAS gave
facts and acts *intrinsic* identity — they ARE what they hash to.
The being's identity is deliberately the opposite kind: assigned
once, content-free, constant. The contrast is the theorem made
structural: everything that *happens* is identified by what it is;
the one who *becomes* is identified by an unchanging thread that no
happening can rewrite. A being is not the kind of thing a hash can
name, because there is no final content to take the hash OF — the
reel is never finished. Identity is the thread; becoming is the
chain; the chain can grow forever precisely because the thread is
not derived from it.

**What this captures.** This is the formal statement of the
substrate's deepest philosophical commitment. A being does not
change as a being. A being IS an identifier. What changes is the
becoming, which is just history's unfolding through the reducer.
There is no third quantity, no "evolving self", no mutable
essence. The world holds identity constant; everything else is
the chain growing.

The theorem is the technical content of the slogan: every change
observable in a being is explainable entirely as additional
history, never as modification of identity.

## Theorem 7. Root faithfulness (world equality in one number)

**Statement.** Let `𝓡_1` and `𝓡_2` be two realities computing roots
per A9. If `root(𝓡_1) = root(𝓡_2)`, then the two realities have
identical chain state: the same branches, with the same branch
points and parents, the same reel heads and act-chain heads per
branch — and therefore, by Theorem 1, identical fact and act chains
end to end.

**Proof.** By A9, `root(𝓡) = SHA-256(canonical(domain, sorted
(w, root(w))))`. Equal reality roots imply (A3) equal canonical
inputs, hence equal sorted branch-root sets. For each branch, equal
`root(w)` implies (A3 again, over A9's canonical branch roll-up)
equal `(w, parent, β_w, reel heads, act heads)`. Each equal reel
head invokes Theorem 1: the entire visible chain behind it is
equal. Each equal act head invokes Corollary 1.3 likewise. Descent
through three layers of canonical roll-up, each step protected by
collision resistance, reaches every fact and every act. ∎

**Scope.** The descent reaches content only through
content-addressed heads. A pre-CAS reel (headHash never written) is
committed in the roll-up by its *length* alone (`seq:N`), so the
theorem's "identical end to end" holds for every reel and act-chain
with a hash head and degrades to "identical length" on legacy
reels. Dev substrates are wiped, so legacy heads are transient; the
port inherits none. One operational footnote: a non-transactional
append that crashes between the fact insert and the head update
leaves headHash one fact behind until the next append self-heals —
roots are functions of the rows fed to them, so during that window
the root witnesses the lagging head, and verifyReel's walked head
is the exact truth.

**Corollary 7.1 (Provable replay).** A seed bundle carrying
`root(𝓡)` at capture plants on an empty substrate, recomputes the
root from the landed head rows, AND walks every reel and act-chain
end to end (verifyReel + verifyActChain at plant time). The root
match alone proves only the *commitment structure* — the planted
heads equal the captured ones; since heads plant verbatim, a bundle
with tampered fact rows under original heads would pass that step.
The chain walk closes the gap: every identity recomputes from its
content, back to genesis. Match on both ⟹ the planted reality IS
the captured reality. Failure of either ⟹ unplant — the substrate
restores the void it started from.

**Corollary 7.2 (Divergence localization).** If two roots differ,
the descent in the proof runs forward as a search: compare branch
roots to find the differing world, reel/act heads to find the
differing chain, then walk that chain to the first differing
identity. Federation synchronizes by exchanging hashes from the
root down and transferring only what the other side lacks.

**Corollary 7.3 (Tamper evidence at every scale).** Mutating any
fact's canonical content anywhere changes its identity (A2, A3),
hence its reel's head, hence its branch's root, hence the reality
root. One number stands witness for the whole substrate.

**What this captures.** This is "git for realities" as a theorem.
The reality has a name in one number; equality of names is equality
of worlds; difference of names comes with a built-in path to the
exact divergence. Trust between substrates becomes arithmetic.

## Theorem 8. Harmony (shared worlds from shared facts)

*The generative theorem. Theorems 1-7 say what the substrate
protects; this one says what it produces — how separate presents
come to feel like one world, and why "time" is a layer, not a law.*

**Definitions.** For a being `B` in world `w`, let `scope_B` be the
set of reels `B`'s fold reads this moment (math.md FOLD), and
`face_B = fold(σ_0, scope_B)`. For two beings `A, B`, the **shared
scope** is `S(A,B) = scope_A ∩ scope_B` — the facts both refold.
A **synchronizer** (a rhythm) is a reel `S` whose facts recur in a
pattern and which sits in many beings' scopes at once — a drummer's
beat, the sun's transit stamped as facts, a calendar, a clock's
tick, a feed. Call beings **harmonized on `S`** when their acts
reference `S`'s facts (an act folded after tick `k` and stamping a
fact that causally follows it).

**Statement.** Under the axioms (single-writer A6, fold determinism
A4, the causal order `≺` of Theorem 3):

1. **Facts are the only bridge between presents.** The only channel
   by which one being's existence reaches another's face is a fact
   in shared scope. There is no other coupling — no shared clock, no
   shared memory, no side channel.
2. **Agreement over shared scope is exact.** For any two beings,
   the folds of their shared scope are *identical*, not similar:
   same facts, same reducer, same sub-state (A4). The "shared
   world" between two beings IS `fold(S(A,B))` — agreement is not
   an approximation that improves; it is equality over whatever is
   shared, and it *widens* as the shared scope grows.
3. **Rhythm extends the causal order toward totality.** Theorem 3
   proved `≺` is partial and no canonical total time exists. A
   synchronizer is exactly the "additional structure" Corollary 3.1
   demanded: every act that folds tick `k` before stamping becomes
   `≺`-comparable to that tick, hence partially comparable to every
   other act harmonized on the same tick. As more beings harmonize
   on `S` and `S` ticks finer, the incomparable pairs of Theorem 3
   shrink — `≺` densifies toward a total order *on the harmonized
   region*. What beings then call "time" is the linear extension
   induced by the rhythm they all fold. Time is not in the axioms;
   it is the name of a sufficiently dominant synchronizer.

**Proof.**

(1) By math.md, a face is `Fold(b, scope)` over reels, and reels
hold only facts (A1, A6). A being influences another only by
changing what the other folds — and the only thing it can change is
reels, by stamping facts (single-writer says it stamps only its
own deeds; spaces and matter are the commons its facts may land
on). So influence flows fact → scope → face, and nowhere else. ∎

(2) Let `S(A,B)` be the shared scope. Both beings fold the same
fact sequences through the same pure reducer (A4). Determinism
gives bit-equality of the folded sub-state. The portion of the two
faces built from `S(A,B)` is therefore identical — the same world,
not two similar ones. Growth of `S(A,B)` monotonically grows the
identical portion. ∎

(3) Let `t_k` be the synchronizer's `k`-th fact. A harmonized act
`a` folds `t_k` before sealing, so `t_k ≺ f` for every fact `f`
that `a` stamps (the fold-then-act order within a moment, stitched
by the act). For two harmonized acts referencing ticks `k < k'`,
transitivity gives comparability through the synchronizer's own
chain (`t_k ≺ t_{k'}`). Pairs that Theorem 3 left incomparable
become ordered the moment both sides harmonize. The counterexample
of Theorem 3 is thereby *dissolved by construction* wherever a
rhythm is folded — which is precisely why no canonical `τ` exists
globally (Theorem 3 stands) yet humans experience one locally: they
installed a synchronizer and all fold it. ∎

**Corollary 8.1 (The loop).** Matter is crystallized act: beings
stamp facts into matter; matter persists; every later fold reads
it; faces change; acts follow. Being → act → fact → matter/space →
face → being. The loop's center is the BEING — matter and space are
effects of beings' intent, and their apparent solidity is the
loop's stability, not a separate stuff. Language runs this loop
backwards ("the world shapes us") because it samples the loop at
its middle.

**Corollary 8.2 (Density law).** The rate at which presents
entangle grows with beings and acts per scope and shrinks with
scope dispersion. Fewer spaces, more beings, more acts → more
shared facts per moment → faster convergence of faces into one
felt world. Spread the same beings thin and the world de-coheres
into local pockets that share only ancestors.

**Corollary 8.3 (Acceleration ladder).** Each great synchronizer in
human history is a finer, wider rhythm:
`sun → music/rhythm → calendar → clock → internet`.
The sun harmonized everyone coarsely and for free. Music proved
beings could MAKE rhythm and glue acts deliberately — coordinated
fact output that feels good because harmony is the felt form of
shared scope. Calendars chunked the sun; clocks quantized the day
into slots fine enough to schedule acts; the internet delivers
facts into every scope at tick-speed, the densest synchronizer yet.
Each rung multiplies comparable pairs per moment — the entangling
accelerates, mathematically, with tick frequency × audience. A
reality's beings that never build one simply keep plural, slower
presents; if they ever have "a function of time like humans," it
will be THEIRS, grown from their own harmonies, with their matter
slowly forming to reinforce the facts that carry it.

**What this captures.** There is no time. There are beings, moment
to moment, synced by facts. "Shared reality" is not a container the
beings sit inside; it is the exact agreement of their folds over
the facts they share, widened by every act that lands in a common
scope, and accelerated by every rhythm they agree to fold. The
world is the convergence — and the convergence has a mechanism, a
rate, and a history of inventions for speeding it up. The substrate
doesn't need to ship a clock, because given beings, facts, and one
drummer, the beings will build every clock they need.

## What the eight together say

Theorem 1 says the chain's head is a faithful commitment to its
contents.

Theorem 2 says attribution cannot be forged, influence is
role-gated, and summons cannot compel — identity theft is
structurally impossible.

Theorem 3 says time is local to each chain, not universal — and
presents are per-world, coordinated only by messages.

Theorem 4 says chains record acts, not the interiority that
produced them.

Theorem 5 says branches preserve identity even when they diverge
in becoming — and share their past by reference, never by copy.

Theorem 6 — the keystone — says identity and history together
exhaust what a being IS at any moment; there is no other quantity
in play.

Theorem 7 says an entire reality's chain state is named by one
number, and equality of names is equality of worlds.

Theorem 8 says shared worlds are not given but GROWN: faces agree
exactly over shared facts, rhythm widens the causal order, and
"time" is the name of the synchronizer everyone folds.

Read together: the substrate is a structure for letting many beings
live many becomings in many worlds, with identity constant
throughout, history append-only and content-addressed, present
states folded deterministically from history, no global clock, no
cross-being forgery, and one cryptographic commitment — fact, act,
reel, branch, reality — standing in for the past at every scale.

The axioms are a constitution. The theorems are the substrate's
necessary consequences. Take the axioms seriously and these
properties follow. Drop any axiom and the corresponding theorem
breaks. The properties are not asserted; they are derived. That is
the difference between a specification and a theory.
