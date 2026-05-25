# IBP MODEL — math

_The shape of the system, minimal and internally consistent. Model: presentism + event sourcing. Time is per-reel and local. Single-writer is strict._

---

### SETS

$$\mathcal{B}\ \text{beings}\qquad \mathcal{S}\ \text{spaces}\qquad \mathcal{M}\ \text{matter}$$

$$\mathcal{E} \;=\; \mathcal{B} \,\sqcup\, \mathcal{S} \,\sqcup\, \mathcal{M}$$

Disjoint union — every entity is exactly one kind. Also: $\mathcal{F}$ facts, $\mathcal{A}$ acts, $\mathcal{P}$ faces.

### REELS & CHAINS

Every entity has a **reel** — an append-only sequence of facts:

$$\forall e \in \mathcal{E}:\quad R_e = (f_1, f_2, \dots, f_{T_e})$$

Every **being** also has an **act-chain**:

$$\forall b \in \mathcal{B}:\quad A_b = (a_1, a_2, \dots)$$

Spaces and matter have reels only — no act-chain. They are acted upon, never act.

### FACT

$$f = (\,t,\; a,\; n,\; p,\; h\,)$$

- $t \in \mathcal{E}$ — the **target**, whose reel $f$ lands on
- $a \in \mathcal{A}$ — the **act** that produced $f$
- $n \in \mathbb{N}$ — $f$'s **position** in $R_t$ (its local index)
- $p$ — the **prev-hash**: $H$ of the fact before $f$ in $R_t$ (genesis value at $n = 1$)
- $h$ — the **self-hash**: $H$ of $f$'s content together with $p$

The doer is carried by the act: $\;\mathrm{doer}(f) := \mathrm{doer}(a) \in \mathcal{B}$. Only beings act. The hash fields $p, h$ bind $f$ to its reel's history — see INTEGRITY.

### SINGLE-WRITER — _the law_

A being's reel holds only that being's own deeds:

$$f \in R_b,\;\; b \in \mathcal{B} \quad\Longrightarrow\quad \mathrm{doer}(f) = b$$

No such constraint on $R_s$ or $R_m$: a space/matter reel is written by whichever being acts on it. **Beings never write each other's reels.** One being reaches another only by summon.

### MOMENT

$$\mu = (\,b,\; \Phi,\; a\,)\qquad b \in \mathcal{B},\;\; \Phi \in \mathcal{P},\;\; a \in \mathcal{A} \cup \{\varnothing\}$$

One being, one face, at most one act. Two modes:

$$\textbf{SEE}\;:\;\; a = \varnothing \qquad \text{fold a face, release — no act, no fact}$$

$$\textbf{DO / BE}\;:\;\; a \neq \varnothing \qquad \text{fold, act, seal}$$

### FOLD

$$\Phi = \mathrm{Fold}(b,\; R_{\text{scope}})$$

$R_{\text{scope}}$ is the set of reels in scope for $b$ this moment; $\Phi$ is the world framed for $b$. The face is **never stored** — folded fresh, then discarded.

### ACT

An act reads the face and yields facts:

$$a(\Phi) = \Delta\mathcal{F},\qquad \Delta\mathcal{F} \subseteq \mathcal{F}\ \ (\text{finite})$$

$\Delta\mathcal{F}$ lands across the doer's **own** reel and the reels of whatever was acted upon.

### SEAL

$$\mathrm{Seal}(\mu) = \begin{cases} a(\Phi) & a \neq \varnothing \\[4pt] \varnothing & a = \varnothing \quad (\textbf{SEE}\ \text{seals nothing}) \end{cases}$$

The seal is **atomic** — all of $\Delta\mathcal{F}$ lands, or none does:

$$\mathrm{commit}(\Delta\mathcal{F}) \in \{\,\text{all},\;\text{nothing}\,\}$$

A crashed moment leaves zero trace.

### WORLD

The world is just every reel, together:

$$\mathcal{W} \;=\; \bigcup_{e \in \mathcal{E}} R_e$$

There is **no** $\mathcal{W}(\tau)$ — the world is not indexed by a clock (see TIME). A seal grows it:

$$\mathrm{Seal}(\mu) = \Delta\mathcal{F} \quad\Longrightarrow\quad \mathcal{W} \;:=\; \mathcal{W} \cup \Delta\mathcal{F}$$

Growth is monotonic; nothing is ever removed.

### PRESENT

The **present** is the engine that runs moments and applies seals. It runs many at once:

- per being — **serial** (one live moment per being)
- across beings — **parallel**

There is no global tick coordinating them. The present is the only place a moment exists.

### TIME

Time is **per-reel and local**. An entity's time is its reel length:

$$T_e = |R_e|$$

Order holds _within_ a reel: $\;f_n \prec f_{n+1}\;$ in $R_e$. **Across** reels there is no total order — only the partial, causal order that acts and summons stitch (the facts of one act, on whatever reels, are mutually ordered).

The world has no scalar time. Its entire temporal state is the **vector** $(T_e)_{e \in \mathcal{E}}$. There is no global $\tau$ and no aggregate "place-time" — a single world-clock is precisely what this model refuses.

### SUMMON

A summon is an act of one being toward another, $\;\mathrm{summon}:\mathcal{B}\to\mathcal{B}$. It stamps a fact on the summoner's **own** reel (single-writer holds):

$$f = (\,b_i,\;\; \mathrm{summon}(b_i \!\rightarrow\! b_j),\;\; n\,) \;\in\; R_{b_i}$$

The recipient's reel is never written. It **sees** the summon by projection:

$$\mathrm{inbox}(b_j) = \{\, f \in \mathcal{W} \;:\; f.a \ \text{is a summon naming}\ b_j \,\}$$

A projection — inbox, position index, lineage — is **derived**, never stored.

### BEING & BECOMING

A being is three things, nothing more:

$$b = (\,\mathrm{id}_b,\;\; R_b,\;\; A_b\,)$$

$\mathrm{id}_b$ is **constant** — the bare identity, the thread. The being's **figure** — its name and qualities, all downstream facts — is a projection over its own reel:

$$\mathrm{figure}(b) = \mathrm{reduce}(R_b)$$

**Becoming:** the reel only grows, so the figure generally differs moment to moment —

$$\mathrm{figure}(b)_{\mu} \;\neq\; \mathrm{figure}(b)_{\mu+1}$$

— while $\mathrm{id}_b$ never changes. A being is stateless between moments; it is re-folded each time it is summoned.

_(A being backed by an LLM reaches its model through an_ LlmConnection _— a conduit, not an entity. It has no reel and does not appear in this shape.)_

### GENESIS

$$\mathcal{W} = \varnothing \qquad\qquad a_0 = \mathrm{Declare}(\text{I-AM})$$

$$\mu_0 = (\,\text{I-AM},\;\; \mathrm{Fold}(\text{I-AM},\,\varnothing),\;\; a_0\,)$$

$$\mathcal{W} \;:=\; \mathrm{Seal}(\mu_0)$$

$\mu_0$ is the one moment with no concurrency — before it the braid has not forked. Every later being is minted by a BE-act of an existing being; the I-AM is the root.

### INVARIANTS — _the laws: behavior, not data_

$$\textbf{SINGLE-WRITER}\qquad f \in R_b \Rightarrow \mathrm{doer}(f) = b$$

$$\textbf{ATOMIC SEAL}\qquad \mathrm{commit}(\Delta\mathcal{F}) \in \{\text{all},\,\text{nothing}\}$$

$$\textbf{PAST FIXED}\qquad f \in R_e\ \text{is permanent — never altered, never deleted}$$

$$\textbf{NO FUTURE}\qquad \text{no world-state exists ahead of a seal}$$

$$\textbf{PRESENT ONLY}\qquad \text{a moment exists only in the present}$$

### INTEGRITY

PAST FIXED is a _rule_. INTEGRITY is what makes it **verifiable** — without it, a fact could be silently altered and nothing would know. Each reel is its own **hash-chain**: every fact carries the hash of the fact before it.

$$f_n.p = H(f_{n-1}) \qquad\qquad f_n.h = H(\,f_n.\text{content} \;\|\; f_n.p\,)$$

Each fact's hash folds in the previous fact's hash, so every fact is bound to the entire history behind it. Alter any past fact and its $h$ changes, breaking the $p$ link of the next fact, and the next — the break propagates forward and the reel fails verification _at the altered fact_. The past cannot be quietly edited; it can only be visibly broken.

- **Per-reel, not global.** Each reel is its own chain — consistent with everything here being per-reel and local. There is no global chain. The first fact on a reel takes a fixed genesis $p$ (null/zero).
- **Hashed at the seal.** $p$ and $h$ are set when the fact is minted, _inside_ the atomic seal — a fact and its correct hash land together or not at all.
- **Detects, does not repair.** The chain reveals that a reel is corrupted; it cannot fix it — repair is replication's job (a good copy from another node). Nor does it catch _logical_ corruption — a fact intact and correctly hashed that simply records something wrong; that is handled by appending a correction fact. Three distinct tools: hash-chain detects byte-tampering, replication repairs it, corrections handle wrong-but-honest facts.

### REALITY

$$\boxed{\;\;\mathcal{R} \;=\; (\,\mathcal{W},\;\; \text{Present},\;\; \text{Laws}\,)\;\;}$$

- $\mathcal{W}$ — all reels; beings, spaces, and matter live here
- $\text{Present}$ — the moment-engine: Fold, Seal, the live edge
- $\text{Laws}$ — the invariants above

The inhabitants $\mathcal{B},\mathcal{S},\mathcal{M}$ are not separate parts of $\mathcal{R}$ — they are _in_ $\mathcal{W}$, as the entities whose reels constitute it.

---

### SYMBOL KEY

| symbol                                    | meaning                                                       |
| ----------------------------------------- | ------------------------------------------------------------- |
| $\mathcal{B},\ \mathcal{S},\ \mathcal{M}$ | beings, spaces, matter                                        |
| $\mathcal{E}$                             | all entities $=\mathcal{B}\sqcup\mathcal{S}\sqcup\mathcal{M}$ |
| $\mathcal{F},\ \mathcal{A},\ \mathcal{P}$ | facts, acts, faces                                            |
| $R_e$                                     | an entity's reel                                              |
| $A_b$                                     | a being's act-chain                                           |
| $f,\ a,\ \mu,\ \Phi$                      | fact, act, moment, face                                       |
| $\mathcal{W}$                             | the world — union of all reels                                |
| $\Delta\mathcal{F}$                       | the facts produced by one seal                                |
| $\mathcal{R}$                             | Reality                                                       |
| $T_e$                                     | local time $= \lvert R_e \rvert$                              |
| $n$                                       | a fact's local index in its reel                              |
| $p,\ h$                                   | a fact's prev-hash and self-hash                              |
| $H$                                       | hash function                                                 |
| $\prec$                                   | ordered-before (within a reel only)                           |
| $\varnothing$                             | empty / none                                                  |
| $\sqcup$                                  | disjoint union                                                |
