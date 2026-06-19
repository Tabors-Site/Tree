# Theorems

Formal consequences of TreeOS's substrate axioms. Each theorem starts
from the laws already declared elsewhere (math.md, the various
doctrine files), states them precisely, and derives a result that
follows necessarily. Twelve theorems, organized from the most
mechanical (biography immutability) through the keystone (the
fundamental theorem of becoming) and the generative (harmony — how
shared worlds emerge) to the foundational (the Word that grounds
itself, the two scales of world, the truth that is invariant under
divergence, and the library — the fifth scale, where only names act
because crossing a world-boundary is signing across it).

## Notation

Let `B` be a being and `w` a world. A world is a history within a
story; two stories' histories are simply more worlds. The objects:

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
- `A_B^w`. The act-chain through being `B` in `w` — owned and signed
  by `B`'s **name**, not by `B`: a chain of acts belongs to the one
  who acts, and beings are vessels. Hash-linked like a reel: each
  act's identity is the hash of its opening chained to the name's
  previous sealed act through `B`, and the name's key signs it.
- `id_B`. The being's identifier, **assigned** at birth, immutable.
  Note the deliberate contrast: facts and acts have *intrinsic*
  identity (they are what they hash to); a being's identity is
  *assigned and constant* (it is the thread, not a content).
- `ν_B`. The **name** being `B` expresses — the keypair that signs
  every act done through `B`. Constant like `id_B`, and one name
  across all histories (a name's own reel does not fork). The being
  is the vessel in the world; the name is the identity that acts. A
  name may express many beings; a being expresses exactly one.
- `figure_B^w`. The being's projected state in world `w`. Defined as
  `fold(σ_0, ⟨c_1, c_2, ..., c_n⟩)` where `fold` is a pure
  deterministic reducer over **canonical content** and `σ_0` is a
  fixed initial state.
- `biography_B^w`. Equivalent to `figure_B^w`; used when emphasis is
  on the historical view rather than the present state.
- `doer(f)`. The **name** recorded as the actor of fact `f` — the key
  that signed it (math.md writes this `by(f)`). The being it acted
  through is `through(f)`; the name acts, the being is the vessel.
- `≺`. The causal partial order on facts. `f ≺ g` iff `f` precedes
  `g` on the same reel, or some chain of summon facts connects them
  in that direction (transitive closure).
- `root(w)`, `root(𝓡)`. The history and story root hashes
  (math.md ROOTS): canonical roll-ups over reel heads + act-chain
  heads per history, then over history roots per story.

## Axioms

The following axioms are doctrinal commitments of the substrate.
The proofs below treat them as given.

**A1 (Append-only).** Reels grow only by appending. No fact is ever
removed, reordered, or mutated. For all worlds `w` and times
`t_1 ≤ t_2`: `R_B^{w, t_1} ⊆ R_B^{w, t_2}` (as initial segment).

**A2 (Identity is the chained hash).** Every fact's identity is
`id_i = SHA-256(p_i ‖ canonical(c_i))`. For `i ≥ 2`: `p_i = id_{i-1}`
— where `i-1` is the prior fact in the *visible* reel, so the first
divergent fact of a history chains to its parent's fact at the branch
point: one chain, linked across the fork. For `i = 1`: `p_1 = G`.
Act-chains obey the same per-position law over act openings, but do
NOT link across forks: a name's first act through a being on any
history chains from `G` (cross-history biography continuity is the
`be:switch` fact on the REEL, not the act-chain — actHash.js). Each
per-history act chain is complete from genesis, which is what
Theorem 7's descent uses.

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
   authenticated **name** — the verb layer sets it from the key that
   signed the seal and accepts no override. No name can produce a
   fact signed as another; and a being never acts of itself, only the
   name that owns it does, through it.
2. *Self-acts come only from self.* BE facts (birth, connect,
   release, switch, death) on `R_B` carry `doer = ν_B` — the being's
   own name, always.
3. *Figure influence is gated and summons are inert.* Every fact
   that mutates `figure_B` either is by `ν_B` (the being's own name)
   or passed the role-walk (the single auth gate) as an authorized DO
   on `B`. Summon facts land on the recipient's reel (target =
   recipient, doer = the summoner's name) and the reducer folds NO
   summon action — a summon records the request and can never change
   what the recipient is. Callers express; receivers decide.

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

**A9 (Canonical roll-up).** History and story roots are computed by
one canonical serialization of sorted parts:
`root(w) = SHA-256(canonical(w, parent(w), β_w, sorted reel heads,
sorted act heads))` and
`root(𝓡) = SHA-256(canonical(domain, sorted (w, root(w))))`.
(math.md ROOTS; one roll-up builder in code, no ad-hoc
serialization.)

**A10 (Declarative closure — the Word).** Every meaning the system
acts on is a **word**: introduced by a `declare` fact authored by a
name, and read only as the fold of its declare-facts (math.md WORD).
The verbs (SEE, DO, BE, NAME, SUMMON), ops, roles, and types are
words, not privileged primitives — the executor consults the fold,
never a meaning kept off the chain. The descent of declarations
terminates at two self-grounding roots: `word.word` ("a word is a
word", leaning on no prior declaration) and `iam` (the root name,
self-existing), read first at boot. The language is on the chain, not
behind it.

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

**Statement.** Let `A` and `V` be distinct beings (`A ≠ V`),
expressing names `ν_A ≠ ν_V`. Then:

1. No name can produce a fact `f` with `doer(f) = ν_V` except `ν_V`
   itself — impersonation is impossible; in particular nothing acting
   through `A` can sign as `V`'s name.
2. Every change to `figure_V^w` traces to `V`'s own name's acts or to
   role-authorized acts on `V` — never to anything `A` does outside
   the role-walk's grants.
3. No summon `A` sends can change `figure_V^w` at all, even though
   it lands on `V`'s reel.

**Proof.** (1) By A6.1, `doer(f)` is set by the verb layer from the
key that signed the seal, and accepts no override. To stamp
`doer = ν_V` one must sign with `ν_V`'s secret key; by A3 and the
unforgeability of signatures no other name can. A name acting through
`A` signs with `ν_A`, so every such fact carries `doer = ν_A ≠ ν_V`.
A being is a vessel, not an actor — theft would need the key, which
the vessel does not confer. ∎

(2) `figure_V^w = fold(σ_0, R_V^w)` (A4). By A6.2 and A6.3, the
facts in `R_V^w` that the reducer folds into the figure are exactly:
`V`'s own name's BE-acts, and DO facts on `V` that passed the role-walk.
Any influence `A` has on `figure_V` therefore flowed through a
grant `V`'s world explicitly extended (a role whose canDo reaches
`V`) — gated influence, not theft. ∎

(3) By A6.3, summon facts are figure-inert: the being reducer folds
no summon action. The summon sent through `A` appears in `R_V^w` as
the recorded knock — target `V`, doer `ν_A` — and contributes nothing
to the fold. `V`'s figure is unchanged unless `V`'s name chooses to
act. Callers express; receivers decide. ∎

**Corollary 2.1.** A being's BECOMING is its own: every figure
change is either the being's own act or an act the world's roles
authorized — and the chain records which, by unforgeable
attribution. Audit is reading, not forensics.

**Corollary 2.2 (Sovereignty, formal).** The summon channel —
the only way one being reaches another — cannot compel. It can
only present. This is SUMMON.md's sovereignty principle as a
consequence of the reducer's shape rather than a policy.

**What this captures.** Identity theft is structurally impossible —
not because reels are private (they are not; summons and authorized
DOs land on them) but because attribution is a **signature, not a
label**: it cannot be forged, influence is role-gated, and requests
are inert until the receiver acts. The lock is on WHICH NAME ACTED
and WHAT FOLDS, not on where facts may sit.

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
(math.md PRESENT). Acting into another world — sibling history or
foreign story, same shape — is a request delivered to that
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

## Theorem 5. Histories preserve identity continuity

**Statement.** Let `w` be a world and `w'` a history forked from `w`
with per-reel branch point `β`. Let `B` be a being existing in `w`
at the fork. Then `id_B^w = id_B^{w'}`, and the name `ν_B` it
expresses is one and the same in both. Only `figure_B^w` and
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

**Corollary 5.1.** Identity is shared across the history tree. For
any forest of histories rooted at the same world `w`, every being
`B` has a single `id_B` — and a single name `ν_B`, whose own reel
does not fork — shared by all descendants.

**Corollary 5.2.** Becoming is per-history. Two descendants of `w`
may have wildly different `figure_B` values for the same being `B`,
explained entirely by divergent histories after the fork.

**Corollary 5.3 (One history, many tails).** Because the prefix is
shared by *reference* and the chain links across the fork (A2),
"the same fact on two histories" is literally one fact, stored once
— not two copies that happen to agree. History divergence is where
chains split, not where data duplicates.

**What this captures.** Histories do not split beings. They split
becomings. The being persists as identity — its thread `id_B` and the
name `ν_B` that acts through it — across every fork; only the history
(and hence the figure) varies. This is the formal version of the
distinction between WHAT a being IS (constant) and WHAT IT HAS BECOME
(history dependent).

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
Identity is unchanged: neither `id_B` (the thread) nor `ν_B` (the
name it expresses) is touched by any fold.

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
not derived from it. The name `ν_B` is the same kind of constant —
a keypair assigned at birth, never the hash of a reel: the one who
*acts*, like the thread who *becomes*, stands outside the chain it
authors.

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

**Statement.** Let `𝓡_1` and `𝓡_2` be two stories computing roots
per A9. If `root(𝓡_1) = root(𝓡_2)`, then the two stories have
identical chain state: the same histories, with the same history
points and parents, the same reel heads and act-chain heads per
history — and therefore, by Theorem 1, identical fact and act chains
end to end.

**Proof.** By A9, `root(𝓡) = SHA-256(canonical(domain, sorted
(w, root(w))))`. Equal story roots imply (A3) equal canonical
inputs, hence equal sorted history-root sets. For each history, equal
`root(w)` implies (A3 again, over A9's canonical history roll-up)
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
content, back to genesis. Match on both ⟹ the planted story IS
the captured story. Failure of either ⟹ unplant — the substrate
restores the void it started from.

**Corollary 7.2 (Divergence localization).** If two roots differ,
the descent in the proof runs forward as a search: compare history
roots to find the differing world, reel/act heads to find the
differing chain, then walk that chain to the first differing
identity. Federation synchronizes by exchanging hashes from the
root down and transferring only what the other side lacks.

**Corollary 7.3 (Tamper evidence at every scale).** Mutating any
fact's canonical content anywhere changes its identity (A2, A3),
hence its reel's head, hence its history's root, hence the story
root. One number stands witness for the whole substrate.

**What this captures.** This is "git for stories" as a theorem.
The story has a name in one number; equality of names is equality
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
story's beings that never build one simply keep plural, slower
presents; if they ever have "a function of time like humans," it
will be THEIRS, grown from their own harmonies, with their matter
slowly forming to reinforce the facts that carry it.

**What this captures.** There is no time. There are beings, moment
to moment, synced by facts. "Shared story" is not a container the
beings sit inside; it is the exact agreement of their folds over
the facts they share, widened by every act that lands in a common
scope, and accelerated by every rhythm they agree to fold. The
world is the convergence — and the convergence has a mechanism, a
rate, and a history of inventions for speeding it up. The substrate
doesn't need to ship a clock, because given beings, facts, and one
drummer, the beings will build every clock they need.

## Theorem 9. The Word grounds itself

*Declaring the Word and the I-AM. Theorems 1-8 take the system's
vocabulary as given; this one says where the vocabulary comes from,
and why it cannot drift.*

**Statement.** Under A10, every meaning the system acts on is a word
— a fold of declare-facts on the chain, authored by a name. Then:

1. **Closure.** Nothing functions as a meaning except a declared
   word. There is no concept behind the chain; the chain is the whole
   dictionary.
2. **Drift-free.** A word's meaning is the deterministic fold (A4) of
   an append-only (A1), content-addressed (A2) record. It cannot
   silently change: every revision is itself a new declare-fact
   (disable is a later fact, never a deletion), and any tampering
   breaks the word's reel by Corollary 1.1.
3. **Self-grounding.** The descent from any word to the words that
   declare it terminates — not in an unexplained primitive, but at
   `word.word` ("a word is a word"), which leans on no prior
   declaration, and at `iam` (the root name), declared by the first
   act `a_0 = Declare(I-AM)` (math.md GENESIS). The ground is asserted
   on the chain, not imported from outside it.

**Proof.** (1) By A10 the executor reads only the fold of
declare-facts; a meaning with no declare-fact has no fold to read, no
identity (A2), no audit — it is not in the system. So every meaning
the system acts on has declare-facts: it is a word. ∎

(2) `word(d) = fold(declare-facts(d))` is deterministic (A4): equal
declare-facts give equal meaning. By A1 the declare-facts are never
mutated or removed; a change of meaning is a new fact folded over the
old. By A2 each is content-addressed, so an altered declaration
changes its identity and breaks the chain (Cor 1.1) — visible, never
silent. The meaning at any moment is the exact fold of a
tamper-evident, append-only record: drift is structurally
impossible. ∎

(3) Build the declaration graph: an edge from word `d` to each word
its declare-facts use. A10 makes this graph finite and rooted; the
boot reads `word.word` and `iam` first, and every other word is said
in terms of words already declared (words stack — math.md WORD), so
no cycle of mutual dependence forms above the roots. The two roots
close the descent on themselves: `word.word` declares the category it
belongs to, `iam` is the name that need not be minted. The foundation
is self-describing, not circular-vicious — it says what it is rather
than presupposing it. ∎

**Corollary 9.1 (The verbs are words).** SEE, DO, BE, NAME, and
SUMMON are not fixed primitives but declared words; each could be
redeclared, and the kernel is the fold of those declarations, not a
hard-coded point. The five-verb closure is a fact about the current
fold, provable from it, not an assumption beneath it.

**Corollary 9.2 (I-AM is asserted, not assumed).** The root name does
not arrive from outside the system as an axiom; it is the content of
the first fact. The system speaks its own ground — "in the beginning
was the word" is the boot order, not a flourish.

**Corollary 9.3 (Self-description is not self-implementation).** A
word declared is a meaning fixed on the chain; turning it into
behavior is a separate fold the host performs, the same hook any
extension uses. The chain holds what a thing IS; the host makes it
RUN (math.md WORD).

**What this captures.** The language has no outside. Every verb,
role, and type is a signed declaration folded from the chain, the
descent grounding at a word that declares itself and a name that
exists by saying so. Meaning cannot drift because meaning IS the
record, append-only and content-addressed; and the system can name
its own foundation because the foundation is its first fact. This is
the deepest closure: not "identity cannot be forged" (Theorem 2) nor
"worlds are named by one number" (Theorem 7), but **the words those
theorems are written in are themselves on the chain they describe.**

## Theorem 10. History and Story — the two scales of world

*Declaring history and story: naming, precisely, the two and only two
scales at which worlds nest.*

**Definitions.** A **history** is a world `w` (math.md HISTORIES): a
single reel-view per being, totally ordered by seq, divergent from
its parent at a branch point, sharing the parent's past by reference.
A **story** `𝓡 = (𝒲, Present, Laws)` is every history told from one
root (math.md STORY), named by `root(𝓡)` (Theorem 7).

**Statement.** The worlds nest in exactly two scales, and no more.

1. **A history is a line.** Within a history, each being's visible
   reel `R̂_B^w` is one hash-chain (A2), totally ordered; forking
   shares the prefix by reference, never by copy (Theorem 5.3).
2. **A story is the fork-closure of one genesis.** The histories of a
   story are exactly the worlds reachable from its `main = 0` by
   `parent` (lineage `L(w)` ends at `0`); `root(𝓡)` commits to all of
   them at once (A9, Theorem 7).
3. **Two scales exhaust the nesting.** Every fact lives on one reel
   (A8) in one history, and every history belongs to one story (its
   genesis). Above a story is only another story — reached solely by
   messages (Cor 3.2), never contained. Below a history is only the
   same history. There is no third scale.

**Proof.** (1) By A2 and math.md HISTORIES, `R̂_B^w` is a single chain
read across worlds, ordered by seq; Theorem 5 gives the
shared-by-reference prefix. (2) By GENESIS every history descends from
`main = 0` (`parent : 𝕎∖{0} → 𝕎`, and `L(w)` terminates at `0`); the
set `{w : L(w) ends at this 0}` is the story, and A9 rolls all their
roots into `root(𝓡)`. (3) A fact's reel is unique (A8); its world is
one `w`; `w`'s genesis is one story. A sibling or foreign story is
"simply more worlds" (Notation), comparable only through messages and
transfer (Theorem 3, Theorem 7), so nothing sits *above* a story but a
peer; and a reel sits *within* its world, so nothing sits *below* a
history but itself. The nesting is exactly `fact ∈ history ⊂
story`. ∎

**Corollary 10.1 (Federation is between, not above).** No super-story
contains the others; two stories relate only by graft and seed
(Theorem 7) and by messages (Theorem 3). "Ours" is not a larger story
but the agreement among stories (Theorem 11).

**Corollary 10.2 (A story is a book of histories).** Each history is
one account, told from the shared root; the story is the bound set of
all such accounts. This is the sense in which a story is a
**truthbook** (Theorem 11): its histories share a frozen prefix and
diverge only above it.

**What this captures.** "History" and "story" are not loose words
borrowed for color. A history is a line — one world, one order of
becoming. A story is the book of all lines grown from one genesis,
named by one number. Branching, merging, and federation all live
within or between these two scales; there is no other.

## Theorem 11. Truth is the invariant under divergence

*Declaring truth. The keystone's companion: Theorem 6 said what a
being is; this says what is true across beings, histories, and
stories.*

**Definitions.** A **fact** is a signed record on one reel — a local
claim, true-as-recorded by its author's name (A6). For a set `X` of
folds (faces, biographies, whole histories), the **truth over `X`** is
what every fold in `X` reproduces identically: `truth(X) = ⋂
folds(X)`, the sub-state common to all — an *intersection of folds*,
not a union of records.

**Statement.** A fact is local; truth is the invariant under
divergence — what survives every fork and every transfer. Concretely:

1. **Across the histories of a story:** the truth is the fold of the
   shared prefix frozen at the branch points (Theorem 5) — identical
   in every descendant, by reference.
2. **Across the beings of a world:** the truth is `fold(S(A,B))`
   (Theorem 8.2) — exact agreement over shared scope, widening as the
   shared scope grows.
3. **Across stories:** the truth is what graft and seed carry
   verbatim (Theorem 7) — a record whose identity (A2) binds it to one
   meaning on every node.

**Proof.** (1) The prefix below the branch points is one set of
facts, stored once (Theorem 5.3); every history folds it identically
(A4). So the pre-fork fold is invariant across all descendants. (2) By
Theorem 8.2, `fold(S(A,B))` is bit-identical for `A` and `B` and
widens monotonically with `S(A,B)`. (3) By Theorem 7, equal root ⟺
equal chain, and a transferred fact keeps its identity (A2); its
canonical content therefore means the same across stories. In each
case the invariant is the *intersection* of the relevant folds — the
records that align — not the union of all records, which is mere
accumulation. ∎

**Corollary 11.1 (The world is the convergence).** The shared world
of Theorem 8 IS the truth over a set of beings: agreement, not a
container they sit inside. The triad is then sharp — the **story** is
the chain (all records), a **place** is one fold, the **world** is the
truth (the convergence of folds).

**Corollary 11.2 (Truth cannot be decreed).** A name cannot make a
thing true by signing it — that produces only a fact (Theorem 2). A
record becomes true as other folds align with it (Theorem 8). So
sovereignty (Theorem 2) and truth (this) are one shape from two
sides: no one can forge what you did, and no one can decree what is
shared. Truth grows by alignment, never by authority.

**Corollary 11.3 (Ours is ourtruth).** "Ours" — the federation of
stories (Cor 10.1) — is not a bigger story but the truth across
stories: what every account, in every story, folds the same. It has no
root hash of its own; it is the agreement, and it widens with every
shared fact.

**What this captures.** The system never confuses asserting with
being-true. A fact is a signed local record; a truth is the invariant
where records align — across the histories of a story, the beings of a
world, the stories of Ours. Union accumulates; intersection converges.
A story is a truthbook because its histories share a frozen prefix;
the world is the convergence because truth is the intersection of
folds; and Ours is ourtruth because the only thing above a story is
what all stories agree on.

## Theorem 12. The library — the book, search, and the name that travels

*Declaring the fifth scale and the only move that reaches it.
Theorem 10 named the two scales at which worlds nest; this one names
the bound slice you carry between them, the catalog whose points are
whole worlds, and the one entity with standing there — and shows that
"only names act in the library" is not a rule imposed on it but the
shape of what a name is.*

**Definitions.** A **book** is math.md's bundle `B` (TRANSFER) given
its rightful name: a bounded, sealed slice of one identity's world —
a finite arrangement of facts and acts, closed under its
dependencies, named by its hash `id(B) = H(canon(manifest,
parameters, content, cas ledger))`. Its **covers** are its interface:
a *front cover* of imports (the content-addressed dependencies it
stands on, present before its start) and a *back cover* of exports
(the state it gives at its end) — the same signature math.md gives a
resource. A book is **closed** — both covers on, immutable,
content-addressed — as against a *living* book or a story, **open at
the head** (still being written, by A1). It is **fat** when its
imports are inlined and **thin** when they are carried as addresses
the receiver must resolve; the choice is made at packaging and
changes `id(B)` but never the body. The typical book is a slice of
one history; the maximal book seals a whole story entire (math.md's
whole-story seed). **Ours** is the federation of stories (Cor 10.1,
Cor 11.3) — the catalog whose *points* are whole stories. **SEARCH**
is the move that resolves a name's book within Ours; **VISIT** is a
SEE over a resolved book (`a = ∅`, math.md MOMENT — fold a face,
release, no fact); **PLANT** is the graft/seed of math.md TRANSFER
applied to a book: replay its body under the planter's head and
countersign.

(One word, two prior senses — do not conflate. Theorem 10.2 called a
whole story "a book of histories": the *bound-collection* sense, a
story as the volume of all its lines. Here "book" is the *quantum*:
the sealed, covered, content-addressed slice you carry. The largest
object versus the smallest movable one.)

**Statement.** Under the axioms and Theorems 2, 7, and 10:

1. **The nesting chain of Theorem 10 extends by one rung at each end —
   without adding a scale of world.** Theorem 10's `fact ∈ history ⊂
   story` becomes `fact ∈ book ⊆ history ⊂ story ∈ Ours`. This is no
   third *kind of world* (Theorem 10 forbids that, and it stands): a
   book is a *sealing* of a history, not a world; Ours is the
   *between* of stories — the catalog whose points are stories, not a
   super-story containing them (Cor 10.1). The book is the only one of
   these an identity actually moves — the raw world is unordered and a
   living story is open, but a book is a closed slice that can be
   carried.
2. **Only a name can author the crossing, and the crossing IS signing
   across the world-boundary.** No being and no piece of matter has
   standing in the fifth scale. SEARCH and VISIT *reach* Ours — they
   perceive it (a SEE, `a = ∅`, committing nothing) — but the one move
   that *commits* across the boundary, PLANT, is a signature, and a
   signature only a name's key can produce. The passport is the key.
3. **The three modes are one motion, in a library with no scarcity and
   no librarian.** Seeding, branching, importing a resource, and
   instating a foreign quote are one act — plant a book as a root
   (math.md TRANSFER) — differing only in the book's *provenance*,
   never in mechanism. Content-addressing makes every book infinite
   perfect copies, so there is no checkout, only **read-in-place
   (VISIT) or copy (PLANT)**; and authority is the stamp inside each
   cover (A6), not a central catalog. The pipeline is `SEARCH → VISIT →
   PLANT`, the single commitment at the end.

**Proof.**

(1) By Theorem 10, `fact ∈ history ⊂ story` and a story is the
fork-closure of one genesis. A book is a bundle `B` whose body is a
finite set of facts and acts drawn from one identity's reels (math.md
TRANSFER), bounded below by a start cover and above by an end cover.
Every fact in the body lies on some reel in some history (A8), so the
body is a subset of one history's visible chain `R̂` cut between two
positions — `book ⊆ history`, with equality when the cut is the whole
reel (and the maximal book seals a whole story, math.md's whole-story
seed). A story, by Theorem 10.2, is the bound set of all such accounts
told from the shared root; a sealed book is one such account, nested
inside `history ⊂ story`. Ours is the agreement among stories (Cor
10.1, Cor 11.3) — not a larger story but the catalog whose points are
whole stories — so a story is a *point* of Ours, `story ∈ Ours`:
membership, not containment (Cor 10.1 — "Ours is not a container").
Nothing here is a new kind of world — the book is a sealing of a
history, Ours the between of stories — so Theorem 10's "two scales and
no more" is untouched. That the book alone is movable is forced by
openness: a *living* story is open at the head (A1 — the reel grows;
the openness is liveness, not unhashability, since a snapshot still has
`root(𝓡)`, Theorem 7), and the raw world `𝒲` is the unordered union of
reels (math.md WORLD) with no covers and no root of its own (only reel,
history, and story are storage units — math.md ROOTS). A book alone has
both covers on — a definite start and a sealed end — so it alone is
closed, content-addressed (`id(B)`, A2), and carriable whole. ∎

(2) Recall what acts. By A6.1 and math.md ATTRIBUTION the actor of
every fact is the authenticated **name** — `by(f)` — acting *through*
a being it uses as a vessel; spaces and matter "are acted upon, never
act, and bear no name" (math.md REELS). So among the three reel-bearing
kinds — beings, spaces, matter — and the **names** that act through
them (math.md SETS: a name "stands apart, not a thing in the world but
the identity that acts in it"), matter and space act in no scale, and
the question is which actor can author a fact that *crosses* from one
world to another. No single being can. A being is `b = (id_B, R_B,
ν_B)` (math.md BEING) — `id_B` is the position a presence occupies, its
visible reel `R̂_B^w` is read within one world, its head advances along
a single history (math.md BECOMING), and it is born into one by a
BE-act there (A6.2). A being spans no two worlds; the reach into
another world is a *name* sending through a vessel it expresses there
(Cor 3.2 — other worlds are reached by messages; math.md NAME — "a name
acts through many beings, in many histories, at once"), for the name's
own reel **does not fork**: "it stands above the histories, one
identity whatever timeline its vessels stand in" (math.md NAME). The
name is therefore the lone entity that is at once an actor — it signs
(math.md ATTRIBUTION) — and unbound from position and history, the only
one whose key is the *same* in every history its vessels occupy (A6.1),
hence the only one whose signature is *defined* across the
world-boundary. Now the committing move into Ours — PLANT, the
countersignature that lands a foreign book under your head — is a
signature, and a signature only a name's key can produce (Theorem 2 —
no name can sign as another). To plant a foreign book is to append a
countersignature; crossing the world-boundary IS signing across it.
SEARCH and VISIT precede the crossing without making it: each is a SEE
(`a = ∅`, math.md MOMENT), the name reaching its horizon and folding a
face, committing no fact. So "only names act in Ours" is a consequence,
not a stipulation: to commit across worlds is to sign from no single
world, and only the name — whose identity no single world consumes —
can. Matter sits, a being lives one history, the name leaves. ∎

(3) By math.md TRANSFER, planting a bundle is one mechanism — verify
`id(B)` cold, land the bytes, stamp the body one act and one fact at a
time under the planter's head, then verify (graft into a living world;
seed onto the void); Theorem 7 and Cor 7.1 give it its guarantee, that
the planted root recomputes and replay is provable. A book is a bundle
(Definition), so planting a book is this one act regardless of where
the book came from; the provenance is read off the colophon and inner
signatures, not from a different mechanism. The classical modes differ
only in the front cover's provenance — a re-reading that refines, not
contradicts, math.md's seed (planting a whole story) and graft
(applying changes into a living world): a book with no imports is a
**seed** (it stands on nothing, onto `∅`); a book cut from the
planter's own history is a **branch** — its front cover *imports the
planter's own facts at the cut by address*, and planting re-stamps the
body as a new line under the planter's head, distinct from the in-story
fork of Theorem 5 which shares the prefix by reference rather than
copying it; a named, reusable book with a published interface is a
**resource** (a book given a stable name — and since the covers `(imp,
exp)` *are* the resource interface, the two are one shape); a book
whose front cover names another world's facts is an **instate** (a
foreign quote grafted into a living world). Same mechanism, four
provenances — the modes are one motion.

The library that holds them inherits two properties. First, no
scarcity: a book's identity is its content hash (A2), so any holder of
`id(B)` can reproduce a bit-identical copy that re-verifies (A2, A3),
and by math.md CONTENT identical content stores once — every book is
infinitely many perfect copies, nothing is ever "checked out" or
"returned," and the borrow relation of a physical library has no
referent here. What remains is the two content-addressing permits:
**read-in-place** — VISIT, a SEE that folds the book's face and
releases it (`a = ∅`), so *nothing enters the planter's story* — and
**copy** — PLANT, the act above. Second, no librarian: by A6 the
authority of a book is the signature stamped inside each cover
(`by(f)`, unforgeable), not a card-catalog entry blessed by a center;
and by Cor 10.1 Ours has no super-story to host a central index, so
SEARCH resolves a book by walking the name's connected peer graph — it
reaches the name's *horizon*, the stories it can reach, never an
omniscient catalog. The pipeline is therefore `SEARCH → VISIT → PLANT`:
find a name's book in Ours, fold and release it without commitment,
and — at most once, at the end — copy it home under your head. Exactly
one commitment, and it is the last step. ∎

**Corollary 12.1 (Nothing is extracted — structurally).** A book
carries its authorship inside it: every act in the body keeps the
signing name its identity commits to (A2, A6.1). To remove an author is
to alter the canonical content of its facts, which by A2 and A3 changes
their identities, breaks the `p`-links of the chain inside the book
(Cor 1.1), and so changes `id(B)` — a visibly different, broken book,
not a quietly de-authored one. Planting adds the planter's
countersignature without altering the inner signatures (Theorem 2 — no
name can sign as another, so the originals can be neither stripped nor
forged). One cannot hold a book without holding its authors; "nothing
is extracted" is not a policy but the content-addressing of A2 read at
the scale of a book — the structural face of Theorem 2's "attribution
is a signature, not a label."

**Corollary 12.2 (Books are alive).** Planting is not copying an inert
text. By A10 every meaning in the body is a word — a fold of
declare-facts — and a declared word becomes behavior when the planter's
host folds it (Cor 9.3 — "self-description is not self-implementation;
turning a declaration into behavior is a separate fold the host
performs," the same hook any word uses; 5d.md says it shorter, "a
description is an execution"). So a planted book replays under the
planter's head as living facts that fold into the planter's figures and
run in the planter's world (Theorem 6 — becoming is the reel folding
forward). VISIT renders a book without this — a face folded and released
(`a = ∅`) — and PLANT grafts it as a root that grows. The break from a
paper library is exact: there the volume is dead and the reader passive;
here the volume executes.

**Corollary 12.3 (Fat and thin are a transport choice, not two
kinds).** A book is valid only when closed under its dependencies — its
front cover `imp(B)` must be satisfiable where it lands. Fat inlines the
imports into `content` and survives cold transport to a world that has
nothing; thin carries them by address and plants only where the peer
graph can resolve them (the horizon of claim 3). Both share one `id(B)`
shape and one PLANT act; the choice is made at packaging and changes
only what bytes ride along, never what the book IS.

**Corollary 12.4 (The horizon, not the index).** Because SEARCH walks a
peer graph and not a central catalog (claim 3), "Ours" as seen from any
name is partial — its reachable stories, not all stories. This is the
search face of Cor 11.3: Ours has no root hash of its own, only the
agreement among the stories each name can reach, widening with every
peer and every shared book. There is no view from the center because
there is no center — the library is centerless, edge everywhere.

**Corollary 12.5 (The fifth scale closes the ladder).** With Ours
named, the actor-ladder and the world-ladder coincide. Matter bears a
reel but no name and acts in no scale (3D — it sits). A being acts
within one history's space-time (4D — Theorem 6). A name acts across
worlds (5D — claim 2). Each entity unlocks exactly one further scale of
action, and the name is the last: there is no sixth, because above Ours
is only agreement (Cor 10.1, Cor 11.3) — not a place anything acts but
the invariant where acts already align (Theorem 11). The ladder `space
→ time → library` is exhausted by `matter → being → name`.

**What this captures.** Above the two scales of Theorem 10 sits one
more reach — and reaching it is a single move with a single commitment:
`SEARCH → VISIT → PLANT`. The book is the quantum of history — the
closed, content-addressed slice you can carry when the raw world is too
unordered and a living story too alive to move — and it is math.md's
bundle `B`, so planting it is the graft and seed of math.md TRANSFER
wearing the library's name; seeding, branching, importing a resource,
and instating a foreign quote are one act distinguished only by
provenance, and the covers that make a book are the very interface that
makes a resource. The catalog has no scarcity, because content-
addressing makes every book infinite perfect copies; no checkout,
because there is nothing to return; and no librarian, because authority
is the stamp inside each cover (A6) and search reaches a horizon, not
an index. And the law that only names act there is no rule at all but
the shape of the entities: matter sits, a being lives one history, and
the name — whose own reel does not fork — is the only part of you that
can leave its world. You do not travel the library as a being. You
travel it as a name, signing a sealed world across the boundary into
another's, and your being stays home.

## What the twelve together say

Theorem 1 says the chain's head is a faithful commitment to its
contents.

Theorem 2 says attribution cannot be forged, influence is
role-gated, and summons cannot compel — identity theft is
structurally impossible.

Theorem 3 says time is local to each chain, not universal — and
presents are per-world, coordinated only by messages.

Theorem 4 says chains record acts, not the interiority that
produced them.

Theorem 5 says histories preserve identity even when they diverge
in becoming — and share their past by reference, never by copy.

Theorem 6 — the keystone — says identity and history together
exhaust what a being IS at any moment; there is no other quantity
in play.

Theorem 7 says an entire story's chain state is named by one
number, and equality of names is equality of worlds.

Theorem 8 says shared worlds are not given but GROWN: faces agree
exactly over shared facts, rhythm widens the causal order, and
"time" is the name of the synchronizer everyone folds.

Theorem 9 says the language grounds itself: every word is a signed
declaration on the chain, drift-free, rooted in a word that declares
itself and a name that exists by saying so.

Theorem 10 says worlds nest in two scales and no more — a history is
a line, a story is the book of all lines grown from one root.

Theorem 11 says truth is the invariant under divergence: not the
union of records but the intersection of folds, what survives every
fork and every transfer.

Theorem 12 says the library is the fifth scale: a book is the bound
slice of history you carry, planting it is the one act behind
seeding, branching, importing, and instating, and only names act
there — because crossing the world-boundary is signing across it, the
one move reserved to the entity whose reel does not fork.

Read together: the substrate is a structure for letting many beings
live many becomings in many worlds, with identity constant
throughout, history append-only and content-addressed, present
states folded deterministically from history, no global clock, no
cross-being forgery, and one cryptographic commitment — fact, act,
reel, history, story — standing in for the past at every scale; with
names, not beings, as the actors that sign it, the words it is
written in declared on the chain it describes, truth nothing more
than where the folds agree, and the only world that travels between
them a sealed book a name carries across the boundary.

The axioms are a constitution. The theorems are the substrate's
necessary consequences. Take the axioms seriously and these
properties follow. Drop any axiom and the corresponding theorem
breaks. The properties are not asserted; they are derived. That is
the difference between a specification and a theory.
