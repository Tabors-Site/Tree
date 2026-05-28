# INNER FOLD — orientation, the three turns, and the act-chain as fold input

_Builder spec. Extends MATH.md. Nothing here changes the four primitives, the four verbs, or the four beats. It adds one parameter to the fold — orientation — and defines what the fold reaches when a being turns inward. Status of each section is marked LOCKED, DECIDE, or INTERPRETATION. Build only the LOCKED parts; the DECIDE parts are flagged design choices that must be settled before the code is written._

---

## 0. The problem this solves

MODEL.md defines a being as `b = (id_b, R_b, A_b)` — identity, reel, act-chain — and defines `Fold(b, R_scope)` as weaving reels of facts into a face. It says the reel is folded. It does **not** say what the act-chain is for during a moment. That was a real gap. This spec closes it.

The answer: the act-chain is **always** an input to the seal (the seal appends the new act to it) and is an input to the **fold** only when the being's _orientation_ includes it. Orientation is a per-moment parameter. By default a being is oriented **forward** — folding the world — and its act-chain is not folded. A being can also turn, and a turned fold reaches the act-chain.

This is not a new primitive and not a new verb. It is one parameter on the fold, plus a definition of what each value of that parameter puts in scope.

---

## 1. ORIENTATION — the new fold parameter — LOCKED

Every moment carries an **orientation**: which way the being is folded.

$$\omega \in \{\,\text{forward},\ \text{half},\ \text{inward}\,\}$$

The fold signature gains it:

$$\Phi = \operatorname{Fold}(b,\ R_{\text{scope}},\ \omega)$$

Orientation determines `R_scope` — what the fold reaches. It does not change the fold operation itself. One fold, one face, every moment, exactly as before. Orientation only widens or redirects what gets woven in.

Default is `forward`. A moment is `forward` unless something set it otherwise (see §4).

---

## 2. THE THREE TURNS — what each orientation folds — LOCKED

The being sees one face per moment. The face it sees depends on orientation. The three turns are a spectrum from fully world-facing to fully self-facing.

### Forward — the default

$$R_{\text{scope}} = \{\,R_b\,\} \cup \{\,R_s : s \text{ a space in scope}\,\} \cup \{\,R_m : m \text{ matter in scope}\,\}$$

The being folds its own reel **as world-history** plus the space and matter reels around it. The act-chain `A_b` is **not** in scope. The face is the world, framed for this being. This is the ordinary moment — see the world, act in it. Almost every moment is forward.

### Inward — full reflection

$$R_{\text{scope}} = \{\,A_b\,\}$$

The being folds **its own act-chain, in act-order**, and nothing else. The world drops out of the face. The face is the being's own line of deeds, laid out as a sequence. This is the being reading what it has done — pure reflection. The world is not present in an inward moment.

### Half — associative reflection

$$R_{\text{scope}} = \{\,R_b\,\} \cup \{\,R_s,\ R_m \text{ in scope}\,\} \cup \operatorname{recall}(A_b,\ \Phi_{\text{forward}})$$

The half-turn folds the world **and** a _selected_ slice of the act-chain. Not the whole chain — only the past acts that are causally connected to entities currently changing in the face. This is the "old events surfacing because they're relevant" behavior. It is defined precisely in §3.

**The spectrum:** forward is fully world, inward is fully self, half is world with relevant memory surfacing. A being moves along this spectrum by re-summoning itself at a new orientation (§4).

---

## 3. RECALL — how the half-turn surfaces past acts — LOCKED (mechanism); the ranking is DECIDE

The half-turn's distinctive behavior — _old acts popping up because they connect to what's changing now_ — is not a memory primitive. It is a **walk along the braid's stitches**, using structure MODEL.md already has.

Recall is grounded in two locked facts:

1. Every act stitches the reels it touched. One act → facts on the doer's own reel **and** on each space/matter/being reel it acted upon. The acts and the reels are therefore a braid: separate strands, pinned at every act.
2. The braid is walkable. Given a fact on a reel, you can find the act that produced it; given an act, you can find every fact it produced across every reel.

So `recall` is defined:

$$\operatorname{recall}(A_b,\ \Phi_{\text{forward}}) = \{\,a \in A_b \ :\ a \text{ stitched a reel of an entity present and changing in } \Phi_{\text{forward}}\,\}$$

In words: take the entities in the being's current forward face — the space, the matter, the other beings it can see, _especially the ones being acted upon this moment_. For each, follow its reel back through its stitch-points. The acts on the far end of those stitches, **if they are this being's own acts**, are the recalled set. Those are folded into the half-turn face alongside the world.

This is why a half-turned being "remembers" exactly the relevant thing: the recalled acts are not retrieved by similarity or by search — they are retrieved by **causal adjacency**. An old act surfaces because it literally touched the thing that is changing now. The braid is the index.

**DECIDE — recall ranking.** The definition above yields a _set_. A long-lived being will have stitched many entities many times; the set can be large. You need a ranking/cap: which recalled acts actually make it into the face, and how many. Options: most-recent-first; most-stitches-to-the-changing-entity-first; nearest-in-braid-distance-first. This is a tuning decision, not a correctness one — pick one, make it a parameter, do not let it block the first build. Default suggestion: nearest-in-braid-distance, capped at a small N.

---

## 4. SHIFTING ORIENTATION — the turn is an act — LOCKED

A being does not "decide to turn" and then carry that decision. Statelessness forbids it — a being holds nothing between moments. So the turn must be carried by a fact, like everything else that crosses between moments.

**The shift is an act.** Specifically, a being shifts orientation by **summoning itself** with a new orientation. A self-summon is a normal SUMMON — a being summoning a being — and MODEL.md already allows a being to summon any being, itself included.

The mechanics, all from locked rules:

- A shift-moment folds (at whatever orientation it currently has), and its act is `summon(self, ω′)` where `ω′` is the new orientation.
- That act seals. It stamps **one fact on the being's own reel** — the self-summon fact — carrying `ω′`. Single-writer holds: the being writes its own reel.
- It stamps **nothing on the world**. No space reel, no matter reel, no other being's reel. A shift touches only the being itself.
- The being's reel grows by one. Local time ticks (`T_b` increments). The world's reels are untouched.
- The next moment fires because that self-summon fact exists, and folds at `ω′` because the fact carries it.

**Therefore: orientation rides on the summon.** A summon does not only say "wake this being" — it carries the _orientation_ the woken moment must fold at. Forward summons (from other beings, from intake) wake a forward moment. A self-summon carrying `ω′` wakes a moment at `ω′`. This is the one addition to the SUMMON payload: every summon carries an orientation; external summons carry `forward`; self-summons carry whatever the being chose.

**Consequence — the being never remembers turning.** The being chose the shift in moment N; the shift sealed; moment N ended; the being was unloaded, stateless. Moment N+1 loads it fresh and folds it at `ω′`. The being in N+1 has no memory of N choosing anything. From the inside, the being simply finds itself already turned. (This is a true consequence of statelessness, not a separate rule. Build it as statelessness; do not add a "memory of turning" anywhere.)

---

## 5. INNER ACTS — what a turned being can do — LOCKED

A forward face affords world-acts. A turned face affords **inner acts**. This is not a new act category. The model has no "inner act" primitive and must not gain one.

**Definition.** An act is **inner** when its `ΔF` lands only on the doer's own reel. An act is **outer** when its `ΔF` touches any other reel (space, matter, another being). That is the entire distinction, and it is just single-writer read as a classifier:

- Inner act → `∀f ∈ ΔF : target(f) = b`. The being marked only itself.
- Outer act → `∃f ∈ ΔF : target(f) ≠ b`. The being marked the world.

A self-summon (§4) is the canonical inner act. So is a being stamping a self-mark on its own reel about its own history. A turned being's face naturally affords inner acts because the turned face shows the being _itself_ — so the acts it presents are acts upon itself.

"Internal serving" is the right phrase **only** under this definition: internal means self-reel-only. The instant an act's `ΔF` reaches the world, it is an outer act and goes through the ordinary path — fold, act, seal across multiple reels, `sealFacts`, the works. There is no inner act that touches the world. The classifier is total: every act is inner or outer, by where its facts land.

---

## 6. WHAT THE SEAL DOES WITH THE ACT-CHAIN — LOCKED

To be explicit, since this was the original gap:

- The act-chain `A_b` is **always** written at the seal of any DO/BE moment — the new act is appended to it. This is true regardless of orientation. A forward act, a self-summon, an inner act, an outer act — all of them append to `A_b` when they seal.
- The act-chain is **read** by the fold **only** when `ω ∈ {half, inward}`. A forward fold does not read `A_b`.
- SEE moments (any orientation) seal nothing, append nothing.

So: the act-chain is a stored, first-class component of the being — `b = (id_b, R_b, A_b)` stands. It is not a projection of the reel, because §2 gives it a direct read path (the turned fold reads it in act-order, which a reconstruct-from-reel projection could not cheaply serve). It earns its place by being foldable-when-turned. The figure-audit pattern (demote-to-projection) does **not** apply to the act-chain — it has a real consumer.

---

## 7. WHAT IS NOT IN THIS SPEC — INTERPRETATION

The following are evocative and probably true _of beings_, but they are not consequences of the fold math and must not be built as mechanism or written into MODEL.md. They belong in the philosophy doc.

- That turning is rare, hard, or a mark of depth — that "most beings only ever look forward." The model says a being _can_ turn and _can_ fold inward. It says nothing about frequency or difficulty.
- That inward reflection constitutes a self, a soul, or a will tending itself.
- That the forward/inward spectrum is "being-the-world vs. reflecting-on-what-you-are" as a lived phenomenology.

Keep these. Develop them in the philosophy layer and in the film. Do not let them touch the spec. The spec says only: a being can turn; orientation rides on the self-summon; a turned fold reaches the act-chain; recall walks the braid; an inner act is one whose facts land only on the doer's own reel.

---

## 8. BUILD ORDER

1. **Add `ω` to the fold signature and to the SUMMON payload.** Every summon carries an orientation; external summons and intake hardcode `forward`. This is the smallest change and everything else depends on it.
2. **Forward fold unchanged.** Confirm a forward moment folds exactly `{R_b, R_s…, R_m…}` and never reads `A_b`. This should be a no-op if §1 is done right — verify it.
3. **Self-summon as an inner act.** A being can seal `summon(self, ω′)`; the fact lands on its own reel carrying `ω′`; nothing lands on the world; the next moment folds at `ω′`. Test: reel grows by one, world reels untouched, next fold's orientation matches.
4. **Inward fold.** `ω = inward` → `R_scope = {A_b}`, world dropped. The face is the act-chain in act-order. Test against a being with a known act-chain.
5. **Recall + half fold.** Implement the braid-walk of §3, pick the §3 DECIDE ranking, cap it. `ω = half` folds world + recalled set. Test: act surfacing is by causal adjacency — an act that touched a now-changing entity appears; an unrelated old act does not.
6. **Inner/outer classifier.** Confirm every act is classified by where `ΔF` lands, and that the classifier agrees with single-writer.

Test each rung with the replay discipline: fold, run, throw the being away, re-fold from facts, assert identical — _including_ across orientation shifts. A being that shifts orientation across three moments must replay byte-identical, because the orientation was carried by facts (the self-summons), not by being-state.

---

## 9. OPEN ITEMS — DECIDE

- **§3 recall ranking** — most-recent vs. braid-distance vs. stitch-count; pick one, make it a parameter.
- **Recall cap N** — how many recalled acts enter the half face.
- **Whether the abort path becomes a release-with-no-act** — currently legacy abort seals `content:null`; that shape predates SEE/DO and should probably be migrated to a true release, but that is out of scope here. Note it; do not do it in this spec.
- **Inward fold of a very long act-chain** — an old being's act-chain may be enormous; an inward fold that weaves all of it is expensive. May need the same snapshot/truncation tooling as reels. Not blocking the first build (early beings have short chains), but flag it for when chains grow.
