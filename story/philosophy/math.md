# IBP MODEL — math

_The shape of the system, minimal and internally consistent. Model: presentism + event sourcing + content addressing. Time is per-reel and local. Attribution is unforgeable. Identity is intrinsic._

---

### SETS

$$\mathcal{N}\ \text{names}\qquad \mathcal{B}\ \text{beings}\qquad \mathcal{S}\ \text{spaces}\qquad \mathcal{M}\ \text{matter}$$

$$\mathcal{E} \;=\; \mathcal{B} \,\sqcup\, \mathcal{S} \,\sqcup\, \mathcal{M}$$

Disjoint union — every entity that bears a reel is exactly one kind. $\mathcal{N}$ stands apart: a **name** is not a thing in the world but the identity that _acts_ in it — a keypair, the signer. A being _expresses_ a name; the name acts, the being is the vessel (see NAME). Also: $\mathcal{F}$ facts, $\mathcal{A}$ acts, $\mathcal{P}$ faces, $\mathcal{D}$ words, $\mathbb{W}$ histories (worlds).

### HISTORIES — _worlds_

$$\mathbb{W} \ni w, \qquad \text{main} = 0, \qquad \mathrm{parent} : \mathbb{W}\setminus\{0\} \to \mathbb{W}$$

A **history** is a world — a line of the story, divergent from its parent, sharing the parent's past up to its **branch point** (_to branch_ is the act that forks a new history; the point is where it forked). Lineage is the path to main:

$$L(w) = (\,0,\; \dots,\; \mathrm{parent}(w),\; w\,)$$

At fork time, $w$ snapshots its parent's per-reel positions:

$$\beta_w : \mathcal{E} \to \mathbb{N} \qquad \text{(per-reel branch point: the parent's } T_e \text{ at fork)}$$

Histories share one seq continuum per reel — $w$'s first own fact on $R_e$ lands at $n = \beta_w(e)+1$. Merging produces a new history whose parent is the **common ancestor** of its sources; divergent state arrives as ordinary stamped facts. A history never copies facts; it sees its ancestors' (below).

### REELS & CHAINS

Every entity has a **reel** per world it has been written in — an append-only sequence of facts:

$$R_e^w = (f_{\beta+1}, \dots, f_{T})\qquad \text{(its own divergence)}$$

What a world **sees** of a reel is the union of lineage segments, each ancestor contributing up to the next fork:

$$\widehat{R}_e^{\,w} \;=\; \bigcup_{i} \; R_e^{L_i(w)}\big[\, \beta_{L_i}(e) < n \le \beta_{L_{i+1}}(e) \,\big] \qquad (\text{leaf unbounded above})$$

One reel, one chain, read across worlds. Acts chain too, but a chain of acts belongs to a **name**, not a being. A name's **act-chain** runs per being it acts through, per world — write $A_b^w$ for the chain through being $b$ in world $w$, _owned and signed by $b$'s name_. It is hash-linked like a reel: an act's identity is the hash of its _opening_ chained to the name's previous sealed act through that being, $\mathrm{id}(a) = H(p_a \| \mathrm{canon}(\mathrm{opening}))$, and each act carries the name's **signature** over it. The closure (status, the seal's signature, the sealing utterance) is bookkeeping outside the identity, because what HAPPENED is the facts the act produced. Spaces and matter have reels only — they are acted upon, never act, and bear no name: only one who acts needs one.

### FACT — _identity is intrinsic_

$$f = (\,t,\; a,\; n,\; w,\; p\,) \qquad\qquad \mathrm{id}(f) \;=\; H\big(\,p \;\|\; \mathrm{canon}(f)\,\big)$$

- $t \in \mathcal{E}$ — the **target**, whose reel $f$ lands on
- $a \in \mathcal{A}$ — the **act** that produced $f$
- $n \in \mathbb{N}$ — $f$'s **position** in its reel (the local index)
- $w \in \mathbb{W}$ — the **world** the deed happened in (committed in the digest)
- $p$ — the **prev-hash**: $\mathrm{id}$ of the fact before $f$ in $\widehat{R}_t^{\,w}$ (genesis sentinel at $n=1$)

There is no assigned identifier and no separate self-hash field — **the fact's identity IS its content hash**. The same deed, in the same world, after the same history, _is_ the same fact: storage dedup, transport ("do you have this hash?"), and tamper-evidence are properties of the addressing scheme, not mechanisms layered on it. $\mathrm{canon}$ is the canonical serialization (sorted keys, stable forms) — a versioned wire format. The actor is carried by the act, and the actor is a **name**: $\mathrm{by}(f) := \mathrm{by}(a) \in \mathcal{N}$, expressed _through_ a being $\mathrm{through}(f) \in \mathcal{B}$ — the vessel the name acted in.

### ATTRIBUTION — _the law_

Every fact's actor is the **authenticated name** — the verb refuses to stamp a fact whose seal it did not sign. A being never acts of its own accord; the name that owns it acts _through_ it, and no name can sign as another:

$$\mathrm{by}(f) = \text{the name whose key sealed } f \quad\text{(unforgeable)},\qquad \mathrm{through}(f) \in \mathcal{B}\ \text{the vessel}$$

What may land on a being's reel $R_b^w$, and what it does there:

- **BE facts** (self-acts: birth, connect, release, switch, death) — the acting name is $b$'s own. Identity transformations come only from the left stance — a name in its own vessel.
- **DO facts targeting $b$** — the acting name is whoever's, and the act passed the role-walk (the single auth gate). Another name CAN change your figure, exactly as far as roles permit (a grant, a set), never further.
- **SUMMON facts naming $b$ as recipient** — the acting name is the summoner's; the fact is the knock on the door, recorded on your reel. **Summon facts are figure-inert**: the reducer folds no summon action, so a summon can never mutate what you are. Callers express; receivers decide (SUMMON.md sovereignty, made structural).

Space/matter reels are the commons: written through whichever being a name acts with, every write role-gated. The law is not "only you touch your reel" — it is **no name can sign as yours, and nothing changes your figure except your own name's acts and role-authorized acts.**

### MOMENT

$$\mu = (\,n,\; b,\; \Phi,\; a\,)\qquad n \in \mathcal{N},\;\; b \in \mathcal{B},\;\; \Phi \in \mathcal{P},\;\; a \in \mathcal{A} \cup \{\varnothing\}$$

One name, through one being, one face, at most one act. Two modes:

$$\textbf{SEE}\;:\;\; a = \varnothing \qquad \text{fold a face, release — no act, no fact}$$

$$\textbf{DO / BE}\;:\;\; a \neq \varnothing \qquad \text{fold, act, seal}$$

### FOLD

$$\Phi = \mathrm{Fold}(b,\; \widehat{R}_{\text{scope}}^{\,w})$$

$\widehat{R}_{\text{scope}}^{\,w}$ is the set of history-visible reels in scope for $b$ this moment; $\Phi$ is the world framed for $b$. The face is **never stored** — folded fresh, then discarded.

### ACT

An act reads the face and yields facts:

$$a(\Phi) = \Delta\mathcal{F},\qquad \Delta\mathcal{F} \subseteq \mathcal{F}\ \ (\text{finite})$$

$\Delta\mathcal{F}$ lands across the vessel being's **own** reel and the reels of whatever was acted upon.

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

The **present** is the engine that runs moments and applies seals — **one present per world** ($w$): a story hosts many histories, each with its own present; a computer hosts one story. Within a world's present:

- per being — **serial** (one live moment per $(b, w)$)
- across beings — **parallel**

Across worlds, presents are independent — the branch point freezes the shared prefix (ancestors append only above it, descendants read only below it), so no coordination exists between them except **messages**: acting into another world (sibling history or foreign story, same shape) is a request delivered to that world's present. There is no global tick coordinating anything. The present is the only place a moment exists.

### TIME

Time is **per-reel, per-world, and local**. An entity's time in a world is its visible reel length:

$$T_e^w = |\widehat{R}_e^{\,w}|$$

Order holds _within_ a reel's view: $\;f_n \prec f_{n+1}\;$ in $\widehat{R}_e^{\,w}$. **Across** reels there is no total order — only the partial, causal order that acts and summons stitch. The world has no scalar time. Its entire temporal state is the **vector** $(T_e^w)$. There is no global $\tau$ — a single world-clock is precisely what this model refuses.

### SUMMON

A summon is an act toward another being — one name, through its vessel, knocking on another being's door, $\;\mathrm{summon}:\mathcal{B}\to\mathcal{B}$. Like DO, it stamps its **target** with the right stance: the fact lands on the **recipient's** reel, attributed to the summoner's name (2026-06-03 retarget — summoning another being is not a self-act, so it left the BE namespace):

$$f = (\,t{=}b_j,\;\; \mathrm{by}{=}n_i,\;\; \mathrm{through}{=}b_i,\;\; n\,) \;\in\; \widehat{R}_{b_j}^{\,w}$$

The summon fact is **figure-inert** (ATTRIBUTION above): it records the request on the recipient's chain without mutating what the recipient is. The inbox is a projection over recipient-targeted summon facts:

$$\mathrm{inbox}(b_j) = \{\, f \in \mathcal{W} \;:\; f \ \text{is a summon with target}\ b_j \,\}$$

A projection — inbox, position index, lineage, the figure itself — is **derived**, never stored as truth.

### NAME

A **name** is an identity — a keypair — and nothing in the world: it holds no qualities, occupies no position. Its public key _is_ its identity, $\mathrm{id}_n = \mathrm{pk}$, and what a name does is **act and sign**.

- It **signs** every act done through it: $\mathrm{sig}(a) = \mathrm{Sign}_{\mathrm{sk}_n}(\mathrm{id}(a)\,\|\,\dots)$. Attribution (ATTRIBUTION) is the key's, not a label's — which is why no name can act as another.
- It **owns** act-chains — one per being it acts through, per world ($A_b^w$, REELS). A name acts through many beings, in many histories, at once; the chains run in parallel under the one name.
- It **uses** beings as vessels. A being is the name's presence in the world; the name is the being's identity. A name may express many beings; a being expresses exactly one name.

A name's own reel **does not fork** — it stands above the histories, one identity whatever timeline its vessels stand in. Names are minted, never copied: a BE-birth binds a fresh vessel to its signer. The root name is **I-AM** (GENESIS) — the only name no other name minted, and the signer of every root hash (I_AM.md).

### BEING & BECOMING

A being is three things, nothing more:

$$b = (\,\mathrm{id}_b,\;\; R_b,\;\; \nu_b\,)$$

$\mathrm{id}_b$ is **constant** — the bare identity, the thread, the position a presence occupies (an opaque uuid). $\nu_b \in \mathcal{N}$ is the **name** the being expresses — the keypair that signs every act done through it, one name across every history (a name's own reel does not fork). The act-chains are the name's, not the being's (REELS). The being's **figure** — its qualities, all downstream facts — is a projection over its own reel:

$$\mathrm{figure}(b)^w = \mathrm{reduce}(\widehat{R}_b^{\,w})$$

**Becoming:** the reel only grows, so the figure generally differs moment to moment — while neither $\mathrm{id}_b$ nor $\nu_b$ ever changes. A being is stateless between moments; it is re-folded each time it is summoned. A being's **complete biography** — across histories, across stories — is a _derived view_ composed from many reels. It has no single primary hash; the primary identities belong to the storage units (reel, history, story — see ROOTS).

_(A being backed by an LLM reaches its model through an_ LlmConnection _— a conduit, not an entity. It has no reel and does not appear in this shape.)_

### CONTENT — _matter's bytes_

Matter may carry bytes (a file, a model, a page). The bytes never ride the chain:

$$\mathrm{store} : \text{bytes} \mapsto H(\text{bytes}) \qquad\qquad f.\text{params.content} = (\,\text{"cas"},\; H(\text{bytes}),\; \dots\,)$$

Facts carry **refs**, the store carries **bytes**, addressed by what they are. Identical bytes store once, from any number of writes. A ref whose bytes were purged stays on the chain — the chain proves what the content _was_ (hash, size, type) even when the bytes are gone. Owned bytes are always cas — file, model, page, code alike — held by what they hash to, never by where they sit. What **points outside** is an _address_, not content: a portal matter carries no bytes at all (its content kind is _none_), only a target IBPA into another story; the web's `{url}` is the same shape over HTTP. An address rides the fact whole and owns nothing — recorded, never held.

### GENESIS

$$\mathcal{W} = \varnothing \qquad\qquad a_0 = \mathrm{Declare}(\text{I-AM})$$

$$\mu_0 = (\,\text{I-AM},\;\; \text{I-AM},\;\; \mathrm{Fold}(\text{I-AM},\,\varnothing),\;\; a_0\,)$$

$$\mathcal{W} \;:=\; \mathrm{Seal}(\mu_0)$$

$\mu_0$ is the one moment with no concurrency — before it the braid has not forked. **I-AM is the root name** — the keypair that signs $a_0$ and, by descent, every root after it (I_AM.md). It acts through itself: name and vessel are one at the root. Its first deeds **declare the words** the rest is said in — that a fact is a word, a verb is a word, a being is a word (WORD below); the language grounds itself before anything else is born. Every later being is minted by a BE-act of an existing name through a being; the I-AM is the root of both lines — the name no other name minted.

### WORD

The system is said in **words**. A **word** is a declared meaning — a name (I-AM, at the root) saying _this is so_ — and the things the model is built from are themselves words: a fact is a word, a verb is a word, an act is a verb in the present, a being is a word. Each verb (SEE, DO, BE, NAME, SUMMON), each op, each role is a word **declared** by a name and thereafter standing as a fact on the chain.

$$\mathrm{declare} : \mathcal{N} \times \mathcal{D} \to \mathcal{F}, \qquad \mathrm{word}(d) \;=\; \mathrm{fold}\,\{\, f \in \mathcal{W} : f \text{ declares } d \,\}$$

A word is therefore not a registry entry but a **fold of declare-facts** — it has the life of any figure: declared, refined, disabled (a later fact, never a deletion), folded fresh. Words **stack**: a word may be said in terms of words already declared, so the vocabulary grows by composition, never by privileged insertion; executability is a fold over the declaration, not a separate kind.

The descent grounds itself. The root word is **`word.word`** — _a word is a word_, the one declaration leaning on nothing prior — paired with **`iam`** — _I am that I am_, the name that need not be minted. The boot reads these first and the language self-describes up to the surface (philosophy/word). Self-description is not self-implementation: the host turns a declaration into behavior, the same hook an extension uses.

### INVARIANTS — _the laws: behavior, not data_

$$\textbf{ATTRIBUTION}\qquad \mathrm{by}(f) = \text{the authenticated name; BE-facts on } R_b \text{ only from } b\text{'s name}$$

$$\textbf{ATOMIC SEAL}\qquad \mathrm{commit}(\Delta\mathcal{F}) \in \{\text{all},\,\text{nothing}\}$$

$$\textbf{PAST FIXED}\qquad f \in R_e^w\ \text{is permanent — never altered, never deleted}$$

$$\textbf{NO FUTURE}\qquad \text{no world-state exists ahead of a seal}$$

$$\textbf{PRESENT ONLY}\qquad \text{a moment exists only in the present}$$

$$\textbf{ONE SEQ SPACE}\qquad \text{histories share a reel's continuum: } n_{\text{first own}} = \beta_w(e)+1$$

$$\textbf{IDENTITY IS CONTENT}\qquad \mathrm{id}(f) = H(p \,\|\, \mathrm{canon}(f)) \text{ — never assigned}$$

### INTEGRITY

PAST FIXED is a _rule_. INTEGRITY is what makes it **verifiable** — without it, a fact could be silently altered and nothing would know. Each reel's history-view is one **hash-chain across worlds**: every fact's identity folds in the identity before it,

$$f_n.p = \mathrm{id}(f_{n-1}) \qquad \text{where } f_{n-1} \text{ is the prior fact in } \widehat{R}_t^{\,w}$$

— so the first divergent fact of a history chains to its **parent's** fact at the branch point. One chain, linked across the fork. Alter any past fact and its recomputed identity changes, breaking the $p$ link of the next fact, and the next — the break propagates forward and the reel fails verification _at the altered fact_. The past cannot be quietly edited; it can only be visibly broken.

$$\mathrm{verify}(\,e,\,w\,) : \text{walk } \widehat{R}_e^{\,w} \text{ — } n \text{ continuous},\;\; p \text{ continuous},\;\; \mathrm{id} \text{ recomputes} \;\Rightarrow\; \text{intact}$$

- **Per-reel, not global.** Each reel is its own chain. The first fact takes a fixed genesis $p$ (zeros). Chainless facts (place-level, target-less) still take content identities; only reel verification skips them.
- **Hashed at the seal.** Identity is computed when the fact is minted, _inside_ the atomic seal.
- **Detects, does not repair.** The chain reveals corruption; replication repairs it (a good copy from another node); wrong-but-honest facts are handled by appending corrections. Three tools, three jobs.

### ROOTS — _one number per scale_

The head fact's identity already commits to everything behind it, so each scale rolls up to a single fingerprint:

$$\mathrm{root}(R_e^w) = \mathrm{id}(f_{T}) \qquad \text{(the reel root — rolling, by construction)}$$

$$\mathrm{root}(w) = H\big(\mathrm{canon}(\,w,\; \mathrm{parent}(w),\; \beta_w,\; \{(e,\,\mathrm{root}(R_e^w))\}_{\text{sorted}},\; \{(b,\,\mathrm{root}(A_b^w))\}_{\text{sorted}}\,)\big)$$

$$\mathrm{root}(\mathcal{R}) = H\big(\mathrm{canon}(\,\text{domain},\; \{(w,\,\mathrm{root}(w))\}_{\text{sorted}}\,)\big)$$

A history root commits to its own divergence **and** its anchor; the story root commits to every history. Equality of roots is equality of chain state:

$$\mathrm{root}(\mathcal{R}_1) = \mathrm{root}(\mathcal{R}_2) \;\iff\; \text{same chain, bit for bit}$$

Two stories compare entire worlds in one number; on mismatch, walk down (history roots → reel roots → facts) to the exact divergence. Tampering anywhere breaks every root above it. Content addressing operates on **storage units** — reel, history, story — each with a primary root. Derived views (a biography, an extension's footprint) are first-class queries but secondary identities.

### TRANSFER — _bundles, grafts, seeds_

A bundle is a portable fragment of world. Its identity is its hash:

$$\mathrm{id}(B) = H(\mathrm{canon}(\,\text{manifest},\ \text{parameters},\ \text{content},\ \text{cas ledger}\,))$$

Bytes travel beside it, each blob verified against its own address on arrival ($H(\text{bytes}) \stackrel{?}{=} \text{claimed}$). Any edit re-stamps the identity; an unstamped edit is visible to anyone holding the hash. What was offered is provably what was delivered.

A bundle is a **book** — the quantum of history. A living story is open at its head; a book has **covers** (a definite start, a sealed end), so it is the closed, carriable slice — and its covers are its interface (imports before the start, exports at the end, the same signature as a resource). Seed, graft, branch, and instate are then one act — plant a book as a root — differing only in the book's _provenance_ (Theorem 12).

**Graft** (apply into a living world): verify $\mathrm{id}(B)$ _cold_ — refuse before anything stamps; land the bytes; stamp $\Delta\mathcal{F}$ one act, one fact at a time; then $\mathrm{verify}$ every reel the graft created. On any failure after stamping begins:

$$\overline{\Delta\mathcal{F}} \;=\; \text{reversal facts, stamped in reverse order}$$

PAST FIXED forbids removal, so **undo is more history**: the chain remembers both the attempt and the retreat, and the _figure_ — the folded present — restores to what it was before the attempt. Unstamp by stamping.

**Seed** (plant a whole story): the bundle carries $\mathrm{root}(\mathcal{R})$ at capture. Plant lands bytes, then chain, verbatim — identities travel with their facts — and recomputes:

$$\mathrm{root}(\text{planted}) \stackrel{?}{=} B.\mathrm{root}$$

Match ⟹ the planted story **is** the captured story — replay is _proven_, not hoped. Mismatch ⟹ unplant: plant only ever runs against $\varnothing$, so restoring the before-state is restoring the void. Reproducible stories by construction.

### THREE IDENTITY LAYERS

$$\textbf{semantic}\quad \text{IBP addresses — where in the world; navigation}$$

$$\textbf{historical}\quad (R,\,n,\,p) \text{ — what came before; the order of becoming}$$

$$\textbf{storage}\quad \mathrm{id} = H(\cdot) \text{ — what this exactly is; dedup, transport, proof}$$

They compose; none replaces another. You navigate by the first, fold by the second, verify and move worlds by the third.

### STORY

$$\boxed{\;\;\mathcal{R} \;=\; (\,\mathcal{W},\;\; \text{Present},\;\; \text{Laws}\,)\;\;}$$

- $\mathcal{W}$ — all reels, all worlds; beings, spaces, and matter live here
- $\text{Present}$ — the moment-engine: Fold, Seal, the live edge
- $\text{Laws}$ — the invariants above

A **story** ($\mathcal{R}$) is every history told from one root — not a world _given_ but a world _said_, all its histories under one seal. The inhabitants $\mathcal{B},\mathcal{S},\mathcal{M}$ are not separate parts of it — they are _in_ $\mathcal{W}$, as the entities whose reels constitute it; the names $\mathcal{N}$ that act through them sign it. And the story itself has a name in one number: $\mathrm{root}(\mathcal{R})$.

### OURS — _the library_

$$\text{book} \subseteq \text{history} \subset \text{story} \in \textbf{Ours}$$

Above a single story is no larger story but **Ours** — the catalog whose _points_ are whole stories, joined only by messages and by the **books** that pass between them; no super-story contains them. It is the **library**: a fact reads as a passage, a book as a volume, a history as a shelf, a story as a collection, and Ours as the catalog itself. No center holds it — **search** reaches a name's _horizon_ (the stories its peers reach), and a book's authority is the signature inside its covers (ATTRIBUTION), never a central index. Content addressing makes every book infinitely many perfect copies, so there is no lending — only **visit** (a SEE over a book, $a=\varnothing$: read in place, nothing enters) and **plant** (copy it home, countersigned).

The **book** is the unit that travels: a bundle $B$ (TRANSFER) with its covers on, a sealed slice of one history. To **share** a piece of your world is to plant a book under another head and countersign.

The move into Ours is the **name's** alone. The three kinds are three scales of action: **matter** sits in space; a **being** is matter living through time, a body advancing along one history; a **name** is the identity unbound from position and history (its reel does not fork), the only one that can leave its world.

$$\text{3D space: }\textbf{matter} \quad\longrightarrow\quad \text{4D time: }\textbf{being} \quad\longrightarrow\quad \text{5D library: }\textbf{name}$$

Each kind unlocks one further scale, and the name is the last: **5D motion is signing a sealed world across the world-boundary**, the act reserved to the one entity no single world consumes. You browse the library as a name; your being stays home (elaborated as Theorem 12).

---

### SYMBOL KEY

| symbol                                    | meaning                                                       |
| ----------------------------------------- | ------------------------------------------------------------- |
| $\mathcal{N}$                             | names — keypairs; the signers, the only ones who act          |
| $\mathcal{B},\ \mathcal{S},\ \mathcal{M}$ | beings, spaces, matter (the reel-bearing entities)            |
| $\mathcal{E}$                             | all entities $=\mathcal{B}\sqcup\mathcal{S}\sqcup\mathcal{M}$ |
| $\mathcal{F},\ \mathcal{A},\ \mathcal{P},\ \mathcal{D}$ | facts, acts, faces, words                        |
| $\mathbb{W},\ w$                          | histories (worlds); main $= 0$                                |
| $L(w),\ \beta_w$                          | lineage to main; per-reel branch points                       |
| $R_e^w,\ \widehat{R}_e^{\,w}$             | an entity's own reel in $w$; its history-visible view         |
| $A_b^w$                                   | a name's act-chain through being $b$ in world $w$             |
| $\nu_b$                                   | the name being $b$ expresses                                  |
| $f,\ a,\ \mu,\ \Phi$                      | fact, act, moment, face                                       |
| $\mathrm{by}(f),\ \mathrm{through}(f)$    | the name that signed $f$; the being it acted through          |
| $\mathrm{id}(\cdot)$                      | content-hash identity (facts, bundles)                        |
| $\mathcal{W}$                             | the world — union of all reels in all worlds                  |
| $\Delta\mathcal{F},\ \overline{\Delta\mathcal{F}}$ | one seal's facts; their stamped reversal             |
| $\mathcal{R}$                             | the story — every history told from one root                  |
| $\text{Ours}$                             | the library — federation of stories; its points are stories   |
| $\mathrm{root}(\cdot)$                    | root hash — reel, history, or story                           |
| $T_e^w$                                   | local time $= \lvert \widehat{R}_e^{\,w} \rvert$              |
| $n$                                       | a fact's local index in its reel                              |
| $p$                                       | a fact's prev-hash (the prior identity)                       |
| $H,\ \mathrm{canon}$                      | hash function; canonical serialization                        |
| $B$                                       | a bundle — a **book** (graft or seed)                         |
| $\prec$                                   | ordered-before (within a reel's view only)                    |
| $\varnothing$                             | empty / none                                                  |
| $\sqcup$                                  | disjoint union                                                |
