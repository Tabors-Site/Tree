# THE GROWING BEING — bored → reads → remembers → learns → applies

*Builder spec. The ladder of smallest-possible experiments that take a being from reactive to genuinely growing. Build after harmony (the dance) is dancing and both concurrency strategies are proven. Build before EMERGENT-LANGUAGE.md (that one depends on the half-turn and recall, which this ladder builds and exercises).*

*The governing principle, the same one that's run the whole project: keep every being SCRIPTED and DETERMINISTIC until the mechanism is proven. An LLM being would make every rung "work" instantly and prove nothing — you couldn't tell the model from the model-the-LLM-is. Prove each capability with rules you fully control and reels you can read by eye. Drop an LLM in only after the mechanical version is green; then the LLM is the interesting variable, not the confound.*

---

## 0. What this ladder is for

Harmony proved the **world-facing** half of the model: many beings, forward-fold, DO, shared world, synchronization, concurrency. It did not exercise the part that makes a being more than a reactive function — **the inward turn, the act-chain as something a being reads, and a being changing its own future based on its own past.** Your existing extensions (governing, coding, book-writer) are all forward+DO with long prompts: sophisticated, but they *respond*, they don't *grow*.

This ladder builds the smallest cases where a being's own history visibly bends its future — culminating in a being that studies something it didn't know and later acts on it. After these five rungs you'll have watched every verb and every orientation do real work (SEE, DO, SUMMON, BE; forward, half, inward) in cases small enough to debug by reading reels.

Depends on: INNER-FOLD.md (orientation, the half-turn, recall, inner acts) being built. Rung 1 is the first live test of the half-turn. If INNER-FOLD isn't built yet, build it first — this ladder is its proving ground.

---

## RUNG 1 — BORED — a being's own past bends its behavior

**Claim:** a being can change what it does based on its own act-chain, with no new state stored anywhere — the change comes entirely from folding the act-chain.

**Setup.** One being, forward-acting, in a tiny world with a few targets it can DO against (2–3 matter things). No other beings needed.

**Mechanism.** Before acting, the being does a **half-turn**: it folds the world forward AND recalls the past acts stitched to the target in front of it (INNER-FOLD §3 — recall by braid-walk, the acts that touched the now-relevant entity). Its rule reads the recalled count:

> "If I've already done X to this target N times (visible in recall), do something else instead."

**What's new vs. harmony.** A dancer acts the same way every tick. This being acts *differently because of what it has already done*. The "boredom" is not a stored counter — it's the recall surfacing the being's own repeated acts, and the rule responding to their count. Nothing is stored but facts; the behavior-change is a fold.

**Verify.**
- Watch the being repeat X a few times, then switch — by itself, from recall alone.
- Replay: drop caches, re-fold the being's reel from scratch, confirm the switch happens at the same point (it's a pure function of the recalled acts).
- Negative check: a being with an empty act-chain (fresh) does NOT switch — confirming the switch comes from history, not from a timer or a hidden counter.

**Why first:** smallest possible proof that the inward turn and the act-chain are load-bearing, not ornamental. ~20 lines of rule on top of harmony machinery. This is the recommended first thing after the dance.

---

## RUNG 2 — THINKS — inward contemplation, visible and free

**Claim:** a being can spend moments looking inward without acting (inward + SEE — the "thinking" corner of the two-axis model), and you can watch the difference between thinking and acting in the same timelapse.

**Setup.** Take the rung-1 being. Allow it inward+SEE moments before a DO.

**Mechanism.** The being does one or more **inward SEE** moments: orientation = inward (folds `{A_b}` — its own act-chain alone, world dropped), and releases — no act, no fact, no tick on the world (INNER-FOLD §2, §6). Then, when ready, a forward DO. So a "thinking" being's moment-sequence is: inward-SEE, inward-SEE, … , forward-DO.

**What's new.** This is the first time a being spends moments that leave **zero trace on the world** — pure contemplation, token-burn turned inward. In the dance, every being acts every tick. This being sometimes just thinks.

**Verify.**
- In the timelapse, the thinking-being visibly *pauses* — world frozen around it, it burns inward moments — then moves. The pause is the inward-SEEs; the move is the DO.
- Confirm the inward-SEE moments stamp NOTHING (no fact on any reel, world or self) and tick nothing on the world. (A SEE seals nothing — INNER-FOLD §6.)
- Confirm the being's local time / the world's reels are unchanged across the thinking moments — only the eventual DO leaves a mark.

**Why second:** demonstrates the two-axis insight (where-you-look × whether-you-act) ALIVE — the inward+SEE corner is what thinking actually is. Costs almost nothing on top of rung 1; it's just permitting inward orientation + SEE before the DO.

---

## RUNG 3 — READS & REMEMBERS — facts from a source, recalled later

**Claim:** a being can take in facts from an external source, and later fold a fact it took in long ago and use it in a present moment. This is *memory*, tested directly.

**Setup.** The rung-2 being, plus a **source**: a book (matter with a reel whose content is readable) or a browser-style conduit (an outside source the being can summon for content — same shape as the LLM conduit / connect.js).

**Mechanism — reading.** Reading is a DO whose effect stamps a fact on the **being's own reel**: "I read content C" (single-writer — the being writes its own reel). A book is matter (done-to, has a reel); the being DOes `read` against it and the content lands as a fact on the reader. A browser is the same: a DO whose effect is "fetch", content lands as facts on the being's reel.

**Mechanism — remembering.** Much later, in a different moment, the being does a **half-turn** and recall surfaces a fact it stamped many moments ago. The being acts using that old fact. This is the half-turn doing exactly its job (INNER-FOLD §3): an old fact surfaces because it's causally relevant to what's in front of the being now.

**What's new.** Rung 1 used the being's own *acts*. This uses facts the being *took in from outside* — and proves they persist and resurface. "Reading" is not new mechanism (it's DO + payload, you have the conduit); the discovery is that *having-read* means *a fact on the reel that can be re-folded*.

**Verify.**
- The being reads (a fact lands on its reel), many moments pass, then it folds and *uses* that fact — assert it acts on content it stamped long ago, surfaced by recall.
- Replay: re-fold from facts, confirm the same old fact surfaces at the same point. Memory is a pure function of the reel.
- Negative check: a being that never read C cannot recall C — memory comes from the reel, nothing else.

**Why third:** this is the memory test you actually want, and it's the half-turn recall on facts-from-outside rather than own-acts. It sets up rung 4, where reading has to change not just what the being *knows* but what it *can do*.

---

## RUNG 4 — LEARNS — reading changes capability (THE OPEN MODEL DECISION)

**Claim:** a being's *competence* — not just its knowledge — can change because of what it read. This is the rung that does not exist yet and requires a design decision. Make it deliberately.

**The decision.** "Learn" means more than "remember." Remembering is facts-on-the-reel (rung 3). Learning is *acting differently because of what was read* — a change in capability. There are exactly two honest places that change can live, because in this architecture knowledge lives only as facts-on-reel or as how-the-being-acts:

**Option A — behavior is a fold of the reel (elegant, implicit).**
How-I-act is itself derived from folding my own history, including facts about what I studied. Then learning is automatic: read → fact lands → next fold incorporates it → behavior shifts. No "skill" is stored anywhere; competence is re-derived every fold from everything read. Powerful and very in-spirit ("a being is the fold of its reel"). Cost: competence isn't stored, it's recomputed each fold — potentially expensive as the reel grows.

**Option B — skill-facts as instructions to the future self (explicit, controllable).**
The being studies and stamps a fact like "I now know how to do X" — and its rule reads those skill-facts and gains capabilities accordingly. Skill acquisition becomes a *visible, dated event on the reel* you can point to. More controllable, more debuggable; slightly less magical.

**Recommendation for the first build: Option B.** It makes learning a visible fact (easier to verify, easier to debug, you can watch the exact moment a being "gained a skill"), and it's a stepping-stone — you can migrate toward Option A later once you trust the loop. But the choice is yours; what matters is choosing consciously and not letting "give it a browser" smuggle the decision past you.

**Setup.** The rung-3 being, a source teaching a concrete capability (e.g. a book-matter whose content is "the lever opens the door"), and a world where that capability is testable (a closed door, a lever).

**Mechanism (Option B).** The being reads the book → stamps a skill-fact ("lever opens door") on its own reel. Its rule reads skill-facts during the fold; possessing the skill-fact unlocks the corresponding act (it now *can* pull-lever-to-open-door, where before it couldn't / wouldn't).

**What's new.** The being did not have a capability; it studied; now it has it. Its `can` (the fold's affordance — what the face offers it) changed because of a fact it stamped from reading. That's learning.

**Verify.**
- Before reading: the being faces the closed door and CANNOT/does-not open it (no skill-fact → the fold doesn't afford the act).
- After reading: facing the same closed door, the being's fold now affords pulling the lever — because the skill-fact is on its reel.
- Replay: re-fold from facts; the capability appears at exactly the moment the skill-fact was stamped. Learning is a pure function of the reel.
- Negative check: a being that never read the book never gains the capability.

**Why fourth:** this is the genuine open question in the core model, surfaced and decided with the smallest possible test. Everything before it is mechanism you have; this is a real choice. Get it working in the dumbest controllable case before anything richer.

---

## RUNG 5 — APPLIES — studied-then-acts-on-it in a NEW situation (THE FULL LOOP)

**Claim:** the complete growth loop — a being folds past study + a present situation it has not seen before, and produces a novel correct act that uses what it studied. This is the system at its core, and nothing built so far has shown it.

**Setup.** The rung-4 being (it has learned a capability from study), then placed in a **different** situation that requires applying that capability — not the exact situation it studied, a new one where the studied skill is the right tool.

**Mechanism.** In a fresh moment facing a new problem, the being folds: forward (the present situation) + half-turn recall (the relevant studied facts/skills from its reel). It combines present + studied-past into an act that solves the new situation using the studied skill. The studied skill was learned in one context; it's applied in another.

**The honest test (do this scripted, fully controlled).** Concrete dumb example: a being reads "levers open things" (general skill-fact, rung 4). Later it faces a *different* closed thing with a lever it has never encountered — and it pulls the lever, because it folds the present (closed thing + lever) plus the studied skill (levers open things) and applies the latter to the former. It was never told about *this* lever; it applies a learned principle to a novel instance.

**What's new vs. rung 4.** Rung 4 proved capability changes from reading. Rung 5 proves the capability *transfers* — applied to a situation that isn't the one it was learned in. That's the difference between memorization and skill. Your governing/coding/book-writer extensions only *pretend* to do this (they apply skills baked into their prompts; they don't acquire-then-transfer). A being that didn't know how, studied, and then applied it to a new case — that's the system breathing.

**Verify.**
- The being applies the studied skill to a situation distinct from the one it studied. Assert the act is correct AND that the being never encountered this specific instance before (so it can only be applying a learned principle, not replaying a memorized case).
- Replay: re-fold; the application reproduces. The whole loop is a pure function of the reel + the present world.
- The strong negative check: a being that studied a *different* skill, or studied nothing, does NOT solve the new situation. Application must trace to the specific study.

**Why fifth:** this is the proof. If a scripted being can study a principle and apply it to a novel instance — fully deterministic, every reel readable — then the growth loop is real, and an LLM dropped into the same harness is genuinely learning-and-applying rather than improvising. The scripted version is what tells you the difference between the model working and the LLM covering for it.

---

## The ladder as one picture

| Rung | Capability | New verb/orientation exercised | Smallest proof |
|---|---|---|---|
| 1 Bored | own past bends behavior | half-turn recall on own acts | being stops repeating itself |
| 2 Thinks | contemplation, no world-trace | inward + SEE | visible pause in timelapse, zero facts |
| 3 Reads/Remembers | external facts persist & resurface | DO-read + half-turn recall on facts | uses a fact stamped long ago |
| 4 Learns | capability changes from study | skill-fact changes the fold's `can` | couldn't, studied, now can |
| 5 Applies | skill transfers to new situation | forward + recall → novel act | applies learned principle to novel instance |

After rung 5: every verb and every orientation has done real work in a case you can debug by eye. Then — and only then — drop an LLM into a being whose mechanical growth you've already verified, and proceed to EMERGENT-LANGUAGE.md (which builds on the half-turn and recall this ladder proves).

---

## Cross-cutting discipline (applies to every rung)

- **Scripted before LLM, always.** The whole ladder is built with deterministic rules. An LLM makes everything "work" and proves nothing about the model. Add the LLM after the mechanical version is green, as the interesting variable.
- **Replay every rung.** Drop all caches, re-fold each being's reel from scratch, assert identical behavior. If any rung's behavior depends on something not in the reel, you have a hidden store — find it and remove it. Growth must be a pure function of facts.
- **Negative checks are the real proof.** For each rung, a being *without* the relevant history must *not* exhibit the behavior. That asymmetry — historied being does, fresh being doesn't, with no special-casing — is what proves the behavior comes from the reel and not from code.
- **Small enough to read by eye.** One or two beings, tiny worlds, short reels. When something surprises you, you should be able to read the entire reel and find why. Scale only after the small case is green.
- **No new primitives.** Every rung uses SEE / DO / BE / SUMMON, the three orientations, the fold, recall, and append-only facts. If a rung seems to need a new stored thing (a counter, a skill registry, a knowledge base), stop — the reel already holds it as history; fold it instead. The one *decision* (rung 4, Option A vs B) is not a new primitive; B's skill-facts are ordinary facts.

---

## Out of scope for this pass

- LLM-driven beings on any rung. (Comes after the scripted version of that rung is green.)
- Rung 4 Option A (behavior-as-fold-of-reel) if you pick B first — migrate later once the loop is trusted.
- Forgetting / skill decay (a studied thing that stops being recallable as the reel grows). Real and interesting; later. First prove growth happens at all.
- Recall cost on large reels (INNER-FOLD §9). Early beings have short histories; defer until they grow.
- Multi-being learning (one being teaching another). That's a summon + read combination and a natural follow-on, but prove single-being study-and-apply first.
