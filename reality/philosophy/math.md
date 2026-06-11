# IBP MODEL — math

_The shape of the system, minimal and internally consistent. Model: presentism + event sourcing + content addressing. Time is per-reel and local. Single-writer is strict. Identity is intrinsic._

---

### SETS

$$\mathcal{B}\ \text{beings}\qquad \mathcal{S}\ \text{spaces}\qquad \mathcal{M}\ \text{matter}$$

$$\mathcal{E} \;=\; \mathcal{B} \,\sqcup\, \mathcal{S} \,\sqcup\, \mathcal{M}$$

Disjoint union — every entity is exactly one kind. Also: $\mathcal{F}$ facts, $\mathcal{A}$ acts, $\mathcal{P}$ faces, $\mathbb{W}$ branches (worlds).

### BRANCHES — _worlds_

$$\mathbb{W} \ni w, \qquad \text{main} = 0, \qquad \mathrm{parent} : \mathbb{W}\setminus\{0\} \to \mathbb{W}$$

A branch is a divergent world sharing history with its parent up to its **branch point**. Lineage is the path to main:

$$L(w) = (\,0,\; \dots,\; \mathrm{parent}(w),\; w\,)$$

At fork time, $w$ snapshots its parent's per-reel positions:

$$\beta_w : \mathcal{E} \to \mathbb{N} \qquad \text{(per-reel branch point: the parent's } T_e \text{ at fork)}$$

Branches share one seq continuum per reel — $w$'s first own fact on $R_e$ lands at $n = \beta_w(e)+1$. Merging produces a new branch whose parent is the **common ancestor** of its sources; divergent state arrives as ordinary stamped facts. A branch never copies facts; it sees its ancestors' (below).

### REELS & CHAINS

Every entity has a **reel** per world it has been written in — an append-only sequence of facts:

$$R_e^w = (f_{\beta+1}, \dots, f_{T})\qquad \text{(its own divergence)}$$

What a world **sees** of a reel is the union of lineage segments, each ancestor contributing up to the next fork:

$$\widehat{R}_e^{\,w} \;=\; \bigcup_{i} \; R_e^{L_i(w)}\big[\, \beta_{L_i}(e) < n \le \beta_{L_{i+1}}(e) \,\big] \qquad (\text{leaf unbounded above})$$

One reel, one chain, read across worlds. Every **being** also has an **act-chain** $A_b$ per world — hash-linked like a reel: an act's identity is the hash of its _opening_ chained to the being's previous sealed act, $\mathrm{id}(a) = H(p_a \| \mathrm{canon}(\mathrm{opening}))$; the closure (status, the sealing utterance) is bookkeeping outside the identity, because what HAPPENED is the facts the act produced. Spaces and matter have reels only — they are acted upon, never act.

### FACT — _identity is intrinsic_

$$f = (\,t,\; a,\; n,\; w,\; p\,) \qquad\qquad \mathrm{id}(f) \;=\; H\big(\,p \;\|\; \mathrm{canon}(f)\,\big)$$

- $t \in \mathcal{E}$ — the **target**, whose reel $f$ lands on
- $a \in \mathcal{A}$ — the **act** that produced $f$
- $n \in \mathbb{N}$ — $f$'s **position** in its reel (the local index)
- $w \in \mathbb{W}$ — the **world** the deed happened in (committed in the digest)
- $p$ — the **prev-hash**: $\mathrm{id}$ of the fact before $f$ in $\widehat{R}_t^{\,w}$ (genesis sentinel at $n=1$)

There is no assigned identifier and no separate self-hash field — **the fact's identity IS its content hash**. The same deed, in the same world, after the same history, _is_ the same fact: storage dedup, transport ("do you have this hash?"), and tamper-evidence are properties of the addressing scheme, not mechanisms layered on it. $\mathrm{canon}$ is the canonical serialization (sorted keys, stable forms) — a versioned wire format. The doer is carried by the act: $\mathrm{doer}(f) := \mathrm{doer}(a) \in \mathcal{B}$.

### SINGLE-WRITER — _the law_

A being's reel holds only that being's own deeds:

$$f \in R_b^w,\;\; b \in \mathcal{B} \quad\Longrightarrow\quad \mathrm{doer}(f) = b$$

No such constraint on $R_s$ or $R_m$: a space/matter reel is written by whichever being acts on it. **Beings never write each other's reels.** One being reaches another only by summon.

### MOMENT

$$\mu = (\,b,\; \Phi,\; a\,)\qquad b \in \mathcal{B},\;\; \Phi \in \mathcal{P},\;\; a \in \mathcal{A} \cup \{\varnothing\}$$

One being, one face, at most one act. Two modes:

$$\textbf{SEE}\;:\;\; a = \varnothing \qquad \text{fold a face, release — no act, no fact}$$

$$\textbf{DO / BE}\;:\;\; a \neq \varnothing \qquad \text{fold, act, seal}$$

### FOLD

$$\Phi = \mathrm{Fold}(b,\; \widehat{R}_{\text{scope}}^{\,w})$$

$\widehat{R}_{\text{scope}}^{\,w}$ is the set of branch-visible reels in scope for $b$ this moment; $\Phi$ is the world framed for $b$. The face is **never stored** — folded fresh, then discarded.

### ACT

An act reads the face and yields facts:

$$a(\Phi) = \Delta\mathcal{F},\qquad \Delta\mathcal{F} \subseteq \mathcal{F}\ \ (\text{finite})$$

$\Delta\mathcal{F}$ lands across the doer's **own** reel and the reels of whatever was acted upon.

### SEAL

$$\mathrm{Seal}(\mu) = \begin{cases} a(\Phi) & a \neq \varnothing \\[4pt] \varnothing & a = \varnothing \quad (\textbf{SEE}\ \text{seals nothing}) \end{cases}$$

The seal is **atomic** — all of $\Delta\mathcal{F}$ lands, or none does:

$$\mathrm{commit}(\Delta\mathcal{F}) \in \{\,\text{all},\;\text{nothing}\,\}$$

A crashed moment leaves zero trace. Identities are computed **inside** the seal — a fact and its identity land together or not at all.

### WORLD

The world is just every reel, together:

$$\mathcal{W} \;=\; \bigcup_{e \in \mathcal{E},\, w \in \mathbb{W}} R_e^w$$

There is **no** $\mathcal{W}(\tau)$ — the world is not indexed by a clock (see TIME). A seal grows it:

$$\mathrm{Seal}(\mu) = \Delta\mathcal{F} \quad\Longrightarrow\quad \mathcal{W} \;:=\; \mathcal{W} \cup \Delta\mathcal{F}$$

Growth is monotonic; nothing is ever removed.

### PRESENT

The **present** is the engine that runs moments and applies seals — **one present per world** ($w$): a reality hosts many branches, each with its own present; a computer hosts one reality. Within a world's present:

- per being — **serial** (one live moment per $(b, w)$)
- across beings — **parallel**

Across worlds, presents are independent — the branch point freezes the shared prefix (ancestors append only above it, descendants read only below it), so no coordination exists between them except **messages**: acting into another world (sibling branch or foreign reality, same shape) is a request delivered to that world's present. There is no global tick coordinating anything. The present is the only place a moment exists.

### TIME

Time is **per-reel, per-world, and local**. An entity's time in a world is its visible reel length:

$$T_e^w = |\widehat{R}_e^{\,w}|$$

Order holds _within_ a reel's view: $\;f_n \prec f_{n+1}\;$ in $\widehat{R}_e^{\,w}$. **Across** reels there is no total order — only the partial, causal order that acts and summons stitch. The world has no scalar time. Its entire temporal state is the **vector** $(T_e^w)$. There is no global $\tau$ — a single world-clock is precisely what this model refuses.

### SUMMON

A summon is an act of one being toward another, $\;\mathrm{summon}:\mathcal{B}\to\mathcal{B}$. It stamps a fact on the summoner's **own** reel (single-writer holds):

$$f = (\,b_i,\;\; \mathrm{summon}(b_i \!\rightarrow\! b_j),\;\; n\,) \;\in\; R_{b_i}^w$$

The recipient's reel is never written. It **sees** the summon by projection:

$$\mathrm{inbox}(b_j) = \{\, f \in \mathcal{W} \;:\; f.a \ \text{is a summon naming}\ b_j \,\}$$

A projection — inbox, position index, lineage, the figure itself — is **derived**, never stored as truth.

### BEING & BECOMING

A being is three things, nothing more:

$$b = (\,\mathrm{id}_b,\;\; R_b,\;\; A_b\,)$$

$\mathrm{id}_b$ is **constant** — the bare identity, the thread. The being's **figure** — its name and qualities, all downstream facts — is a projection over its own reel:

$$\mathrm{figure}(b)^w = \mathrm{reduce}(\widehat{R}_b^{\,w})$$

**Becoming:** the reel only grows, so the figure generally differs moment to moment — while $\mathrm{id}_b$ never changes. A being is stateless between moments; it is re-folded each time it is summoned. A being's **complete biography** — across branches, across realities — is a _derived view_ composed from many reels. It has no single primary hash; the primary identities belong to the storage units (reel, branch, reality — see ROOTS).

_(A being backed by an LLM reaches its model through an_ LlmConnection _— a conduit, not an entity. It has no reel and does not appear in this shape.)_

### CONTENT — _matter's bytes_

Matter may carry bytes (a file, a model, a page). The bytes never ride the chain:

$$\mathrm{store} : \text{bytes} \mapsto H(\text{bytes}) \qquad\qquad f.\text{params.content} = (\,\text{"cas"},\; H(\text{bytes}),\; \dots\,)$$

Facts carry **refs**, the store carries **bytes**, addressed by what they are. Identical bytes store once, from any number of writes. A ref whose bytes were purged stays on the chain — the chain proves what the content _was_ (hash, size, type) even when the bytes are gone. Reference-shaped content (an http url, an inter-reality address, a disk path) rides the fact whole; it points outside, owns nothing.

### GENESIS

$$\mathcal{W} = \varnothing \qquad\qquad a_0 = \mathrm{Declare}(\text{I-AM})$$

$$\mu_0 = (\,\text{I-AM},\;\; \mathrm{Fold}(\text{I-AM},\,\varnothing),\;\; a_0\,)$$

$$\mathcal{W} \;:=\; \mathrm{Seal}(\mu_0)$$

$\mu_0$ is the one moment with no concurrency — before it the braid has not forked. Every later being is minted by a BE-act of an existing being; the I-AM is the root.

### INVARIANTS — _the laws: behavior, not data_

$$\textbf{SINGLE-WRITER}\qquad f \in R_b^w \Rightarrow \mathrm{doer}(f) = b$$

$$\textbf{ATOMIC SEAL}\qquad \mathrm{commit}(\Delta\mathcal{F}) \in \{\text{all},\,\text{nothing}\}$$

$$\textbf{PAST FIXED}\qquad f \in R_e^w\ \text{is permanent — never altered, never deleted}$$

$$\textbf{NO FUTURE}\qquad \text{no world-state exists ahead of a seal}$$

$$\textbf{PRESENT ONLY}\qquad \text{a moment exists only in the present}$$

$$\textbf{ONE SEQ SPACE}\qquad \text{branches share a reel's continuum: } n_{\text{first own}} = \beta_w(e)+1$$

$$\textbf{IDENTITY IS CONTENT}\qquad \mathrm{id}(f) = H(p \,\|\, \mathrm{canon}(f)) \text{ — never assigned}$$

### INTEGRITY

PAST FIXED is a _rule_. INTEGRITY is what makes it **verifiable** — without it, a fact could be silently altered and nothing would know. Each reel's branch-view is one **hash-chain across worlds**: every fact's identity folds in the identity before it,

$$f_n.p = \mathrm{id}(f_{n-1}) \qquad \text{where } f_{n-1} \text{ is the prior fact in } \widehat{R}_t^{\,w}$$

— so the first divergent fact of a branch chains to its **parent's** fact at the branch point. One chain, linked across the fork. Alter any past fact and its recomputed identity changes, breaking the $p$ link of the next fact, and the next — the break propagates forward and the reel fails verification _at the altered fact_. The past cannot be quietly edited; it can only be visibly broken.

$$\mathrm{verify}(\,e,\,w\,) : \text{walk } \widehat{R}_e^{\,w} \text{ — } n \text{ continuous},\;\; p \text{ continuous},\;\; \mathrm{id} \text{ recomputes} \;\Rightarrow\; \text{intact}$$

- **Per-reel, not global.** Each reel is its own chain. The first fact takes a fixed genesis $p$ (zeros). Chainless facts (place-level, target-less) still take content identities; only reel verification skips them.
- **Hashed at the seal.** Identity is computed when the fact is minted, _inside_ the atomic seal.
- **Detects, does not repair.** The chain reveals corruption; replication repairs it (a good copy from another node); wrong-but-honest facts are handled by appending corrections. Three tools, three jobs.

### ROOTS — _one number per scale_

The head fact's identity already commits to everything behind it, so each scale rolls up to a single fingerprint:

$$\mathrm{root}(R_e^w) = \mathrm{id}(f_{T}) \qquad \text{(the reel root — rolling, by construction)}$$

$$\mathrm{root}(w) = H\big(\mathrm{canon}(\,w,\; \mathrm{parent}(w),\; \beta_w,\; \{(e,\,\mathrm{root}(R_e^w))\}_{\text{sorted}},\; \{(b,\,\mathrm{root}(A_b^w))\}_{\text{sorted}}\,)\big)$$

$$\mathrm{root}(\mathcal{R}) = H\big(\mathrm{canon}(\,\text{domain},\; \{(w,\,\mathrm{root}(w))\}_{\text{sorted}}\,)\big)$$

A branch root commits to its own divergence **and** its anchor; the reality root commits to every branch. Equality of roots is equality of chain state:

$$\mathrm{root}(\mathcal{R}_1) = \mathrm{root}(\mathcal{R}_2) \;\iff\; \text{same chain, bit for bit}$$

Two realities compare entire worlds in one number; on mismatch, walk down (branch roots → reel roots → facts) to the exact divergence. Tampering anywhere breaks every root above it. Content addressing operates on **storage units** — reel, branch, reality — each with a primary root. Derived views (a biography, an extension's footprint) are first-class queries but secondary identities.

### TRANSFER — _bundles, grafts, seeds_

A bundle is a portable fragment of world. Its identity is its hash:

$$\mathrm{id}(B) = H(\mathrm{canon}(\,\text{manifest},\ \text{parameters},\ \text{content},\ \text{cas ledger}\,))$$

Bytes travel beside it, each blob verified against its own address on arrival ($H(\text{bytes}) \stackrel{?}{=} \text{claimed}$). Any edit re-stamps the identity; an unstamped edit is visible to anyone holding the hash. What was offered is provably what was delivered.

**Graft** (apply into a living world): verify $\mathrm{id}(B)$ _cold_ — refuse before anything stamps; land the bytes; stamp $\Delta\mathcal{F}$ one act, one fact at a time; then $\mathrm{verify}$ every reel the graft created. On any failure after stamping begins:

$$\overline{\Delta\mathcal{F}} \;=\; \text{reversal facts, stamped in reverse order}$$

PAST FIXED forbids removal, so **undo is more history**: the chain remembers both the attempt and the retreat, and the _figure_ — the folded present — restores to what it was before the attempt. Unstamp by stamping.

**Seed** (plant a whole reality): the bundle carries $\mathrm{root}(\mathcal{R})$ at capture. Plant lands bytes, then chain, verbatim — identities travel with their facts — and recomputes:

$$\mathrm{root}(\text{planted}) \stackrel{?}{=} B.\mathrm{root}$$

Match ⟹ the planted reality **is** the captured reality — replay is _proven_, not hoped. Mismatch ⟹ unplant: plant only ever runs against $\varnothing$, so restoring the before-state is restoring the void. Reproducible realities by construction.

### THREE IDENTITY LAYERS

$$\textbf{semantic}\quad \text{IBP addresses — where in the world; navigation}$$

$$\textbf{historical}\quad (R,\,n,\,p) \text{ — what came before; the order of becoming}$$

$$\textbf{storage}\quad \mathrm{id} = H(\cdot) \text{ — what this exactly is; dedup, transport, proof}$$

They compose; none replaces another. You navigate by the first, fold by the second, verify and move worlds by the third.

### REALITY

$$\boxed{\;\;\mathcal{R} \;=\; (\,\mathcal{W},\;\; \text{Present},\;\; \text{Laws}\,)\;\;}$$

- $\mathcal{W}$ — all reels, all worlds; beings, spaces, and matter live here
- $\text{Present}$ — the moment-engine: Fold, Seal, the live edge
- $\text{Laws}$ — the invariants above

The inhabitants $\mathcal{B},\mathcal{S},\mathcal{M}$ are not separate parts of $\mathcal{R}$ — they are _in_ $\mathcal{W}$, as the entities whose reels constitute it. And $\mathcal{R}$ itself has a name in one number: $\mathrm{root}(\mathcal{R})$.

---

### SYMBOL KEY

| symbol                                    | meaning                                                       |
| ----------------------------------------- | ------------------------------------------------------------- |
| $\mathcal{B},\ \mathcal{S},\ \mathcal{M}$ | beings, spaces, matter                                        |
| $\mathcal{E}$                             | all entities $=\mathcal{B}\sqcup\mathcal{S}\sqcup\mathcal{M}$ |
| $\mathcal{F},\ \mathcal{A},\ \mathcal{P}$ | facts, acts, faces                                            |
| $\mathbb{W},\ w$                          | branches (worlds); main $= 0$                                 |
| $L(w),\ \beta_w$                          | lineage to main; per-reel branch points                       |
| $R_e^w,\ \widehat{R}_e^{\,w}$             | an entity's own reel in $w$; its branch-visible view          |
| $A_b$                                     | a being's act-chain                                           |
| $f,\ a,\ \mu,\ \Phi$                      | fact, act, moment, face                                       |
| $\mathrm{id}(\cdot)$                      | content-hash identity (facts, bundles)                        |
| $\mathcal{W}$                             | the world — union of all reels in all worlds                  |
| $\Delta\mathcal{F},\ \overline{\Delta\mathcal{F}}$ | one seal's facts; their stamped reversal             |
| $\mathcal{R}$                             | Reality                                                       |
| $\mathrm{root}(\cdot)$                    | root hash — reel, branch, or reality                          |
| $T_e^w$                                   | local time $= \lvert \widehat{R}_e^{\,w} \rvert$              |
| $n$                                       | a fact's local index in its reel                              |
| $p$                                       | a fact's prev-hash (the prior identity)                       |
| $H,\ \mathrm{canon}$                      | hash function; canonical serialization                        |
| $B$                                       | a bundle (clone or seed)                                      |
| $\prec$                                   | ordered-before (within a reel's view only)                    |
| $\varnothing$                             | empty / none                                                  |
| $\sqcup$                                  | disjoint union                                                |
