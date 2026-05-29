# EMERGENT LANGUAGE — shorthand that grows between beings from shared fold history

*Builder spec, for eventually. This is a discovery experiment, not a feature. The deliverable is not "a language system" — it is the smallest possible conditions under which a private shorthand **emerges** between two beings from ordinary interaction, with nothing stored anywhere but reels and nothing read but folds. If a pair with shared history can decode each other's shorthand and a stranger cannot — with no dictionary primitive anywhere — the experiment succeeded and the stamper system is shown to grow language on its own.*

*Build after: harmony (dance) is dancing, both concurrency strategies are proven, and at least rungs 1–3 of the "being that grows" ladder (bored / reads / remembers) are working. This depends on summon-with-payload, the half-turn (recall), and replay-from-facts all being solid.*

---

## 0. The one-line claim being tested

Two beings who share a history of interactions both carry the same interaction-facts in their reels. Because each fold holds that history, either being can send a **reference** instead of a full **payload** — and the reference decodes inside both folds, because both folded the history that gives it meaning. The reference is itself a fact. So a private language is an emergent, dated, foldable record of two beings converging — not a stored schema.

The experiment proves the claim if and only if: **a shorthand reference resolves for a being with the shared history and fails (or means nothing) for a being without it — with no dictionary anywhere in the system.**

---

## 1. What this is NOT — the trap to avoid — CRITICAL

Do **not** build a shared dictionary, a reference-registry, a protocol table, or any side-store where "agreed meanings" live. The instant you build a place where `ping → {meaning}` is stored as authoritative data, you have left the model and the experiment is void — you'd be testing a lookup table, not emergent language.

The whole point is that the meaning of a reference lives **only** in the reels as ordinary interaction-facts, and is recovered **only** by folding. There is no `meanings` collection. There is no `protocol` object. If a being wants to know what `ping` means, it folds its own reel (and recall surfaces the interactions where `ping` was established) and decodes it there. Same as a human remembering an inside joke by remembering the events that made it — not by looking it up in a dictionary.

If you find yourself adding a primitive whose job is "store what references mean," stop. That is the failure mode. The reel already stores it, as history.

---

## 2. The mechanism, in existing primitives only — LOCKED shape

Everything below uses only: SUMMON (with payload), DO, the fold, the half-turn (recall), and append-only facts. No new verb, no new store.

### 2.1 A summon already carries a payload

`SUMMON target {payload}`. The payload today is full content ("here is the board state", "answer this question"). The only new thing this experiment introduces is that a payload may be a **reference** — a short token — instead of full content. That's it. A reference is just a small payload. The system doesn't treat it specially; it's the *being* that decodes it by folding.

### 2.2 A reference is established by ordinary interaction

There is no "define a reference" verb. A reference comes to mean something the way an inside joke does: through a sequence of interactions that both beings folded.

- A summons B with full content C, and tags it with a short label L (the label is part of the payload — `{label: "ping", content: C}`).
- B folds it, acts, responds. Both beings now have a fact on their reels: "an interaction labeled L carried content C" (A's reel: I sent L=C; B's reel: I received/answered L).
- Repeat a few times. Now both reels hold several facts binding L to a kind-of-content.

After enough repetitions, **L is decodable from either being's reel** — folding the history of L tells you what L has meant.

### 2.3 A reference is *used* by sending the label without the content

- Later, A summons B with `{label: "ping"}` and **no content**.
- B receives a payload that is just a reference. To act on it, B does a **half-turn**: it folds its own reel with recall keyed on the entities/labels in the payload. Recall surfaces the past interactions labeled `ping`. B decodes `ping` from its own history, reconstructs what `ping` means, and acts as if the full content had been sent.
- The full content was never transmitted. Only the label crossed. The meaning came from B's own fold of shared history. **That is the compression: reference instead of payload, decoded by fold.**

### 2.4 The reference is itself a fact — provenance for free

Every step above stamps ordinary facts (summons, responses) on both reels. So the *history of how L came to mean what it means* is literally readable: fold either being's reel, filter to label L, and you see the dated sequence of interactions that built the meaning. The language is provenanced. You can answer "when and how did `ping` start meaning this?" by folding. Nothing extra is built to get this — it's a consequence of append-only reels.

---

## 3. Why decoding works for the pair and fails for a stranger — the actual test

A being decodes `ping` by folding its **own** reel for the history of `ping`. Therefore:

- **B (shared history)** folds, recall surfaces B's many past `ping` interactions, `ping` decodes. ✓
- **A stranger C (no history)** receives `{label: "ping"}`, half-turns, folds its own reel for `ping` — finds **nothing**. `ping` is undecodable. C cannot act on it (must SEE/release, or summon back "I don't understand", or request full content). ✗ — and this failure is *correct*. It's why jargon is opaque to newcomers.

This is the experiment's pass/fail line. The same reference, sent to two beings, resolves for the one with shared fold-history and is gibberish to the one without — **with no dictionary anywhere.** If that holds, the stamper system grew a private language on its own.

---

## 4. Community scale — the shared substrate — LOCKED shape, build second

A two-being shorthand generalizes to a community language **not** as N×N private agreements but as a **shared fold of common facts.** Beings that all fold the same public substrate (the same space, the same shared interactions) share the history that makes a common shorthand decodable for all of them.

This is exactly `sync` from the harmony design:

$$\operatorname{sync}(b_i, b_j) = \text{overlap of the facts } b_i \text{ and } b_j \text{ have both folded}$$

- High `sync` between two beings → high shared context → community shorthand decodes for both.
- Low `sync` → the same shorthand is gibberish → outsider.

So in-group/out-group comprehension is a **predicted consequence of fold-overlap**, not a coded feature. A community language is the shorthand that the *common substrate of facts* makes mutually decodable. To build the community version: many beings folding one public space, references established through public interactions on that space, and `sync` measured across the population. Newcomers (low `sync`) won't decode the shorthand until they've folded enough common history — which is, correctly, what "learning the local language" is.

Do not store a "community dictionary" either. Same rule. The community language lives in the common facts on the public space's reel, folded by each member. `sync` is a cross-cutting projection (a measure), never an authoritative store of meanings.

---

## 5. Build order (rungs)

Keep everything scripted and deterministic. No LLMs until the mechanical version is proven — an LLM would *look* like it's decoding shared references when it might just be improvising plausible meanings, which would make the experiment prove nothing. Prove it with rules you fully control first.

1. **Two beings, full-content interactions, labeled.** A summons B with `{label, content}`; B folds, acts, responds. Both reels accumulate labeled interaction-facts. Confirm: after K interactions, both reels hold K facts binding the label to its content. (No shorthand yet — just building the history.)

2. **Decode-from-own-reel.** Give B a scripted decoder: on receiving `{label}` with no content, half-turn, recall the label's history from its own reel, reconstruct the content. Test: B reconstructs the same content that was sent in full during rung 1, purely from folding its own reel. (This proves a being can recover meaning from history.)

3. **Reference instead of payload.** A summons B with `{label: "ping"}` and no content. B decodes via rung 2 and acts correctly. Measure the payload size: the reference summon is a fraction of the full-content summon. (This is the compression, demonstrated.)

4. **The stranger test — the pass/fail rung.** Send the identical `{label: "ping"}` to C, a being with no `ping` history. C half-turns, finds nothing, cannot decode — and responds correctly (declines / asks for full content / SEE-releases). Assert: same reference, B decodes, C cannot — and there is no dictionary anywhere in the system. This rung passing **is** the experiment succeeding.

5. **Community substrate (optional, later).** Many beings fold one public space. References established through public interactions. Measure `sync` across the population. Confirm: high-`sync` beings decode the community shorthand; a freshly-spawned low-`sync` being does not, until it has folded enough common history. Watch a newcomer "learn the local language" by accumulating common facts.

---

## 6. Verification discipline

- **Replay.** The whole language must be reconstructable from facts alone. Drop every cache, re-fold each being's reel from scratch, and confirm each being decodes the same references the same way. If decoding depends on anything not in the reel, you've built a hidden store — find it and remove it.
- **No-dictionary audit.** Grep the codebase for any structure mapping references to meanings. There must be none. The only place a reference's meaning exists is as the sequence of interaction-facts on reels. If a `meanings`/`protocol`/`refs` store exists, the experiment is invalid.
- **Provenance check.** For any established reference, fold a being's reel and produce the dated sequence of interactions that built its meaning. If you can't, the language isn't actually living in the reel.
- **Asymmetry check (the point).** The same reference must resolve for the historied being and fail for the stranger, with zero code that special-cases "stranger." The difference must come entirely from what each being's fold contains.

---

## 7. What success means

If rung 4 passes — same reference, decoded by the being with shared fold-history, undecodable by the being without, and no dictionary anywhere — then the stamper system has been shown to **grow language rather than store it.** The protocol is emergent, provenanced, and foldable; comprehension is a consequence of shared history; and in-group opacity is a consequence of fold-overlap. None of it was engineered as a feature. You built the conditions — summon-with-reference, decode-by-fold — and the language showed up in the reels.

That is the deepest small demonstration available in this architecture: not beings that *use* a protocol, but two beings that *converge* one on the record, and a community that settles on a common one because it folded a common world.

---

## 8. Out of scope for this pass

- Any dictionary / registry / protocol store. (Forbidden — see §1.)
- LLM-driven decoding. (Rung 6+, only after the scripted version proves the mechanism. An LLM that "understands" a reference proves nothing about the model; a scripted decoder that recovers it from the reel proves everything.)
- Conflict between competing meanings for one label (drift, re-negotiation). Real and interesting, but later — get one stable emergent reference working first.
- Optimizing the half-turn recall for large reels. Early beings have short histories; address recall cost when histories grow (same deferral as INNER-FOLD §9).
- Forgetting / reference decay. A reference whose interactions are old/buried may stop decoding — a real phenomenon, but a later study. First prove a reference decodes at all.
