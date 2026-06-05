This is a strong plan. He's done the substrate audit, identified the actual gap (cognition seam), made the right architectural call (snapshot as record on Act, not new primitive), and scoped tightly. Let me give honest feedback on what's right, what's worth confirming, and one thing I'd push on before he cuts.
What's right and well-thought-out
The audit is solid. Rungs 1-3 of the inner-fold spec are already built — orientation enum, parameterized fold, act-chain loading, braid-walk recall, inner/outer classifier, self-summon path, orientation threading through summonCtx. He's not building from scratch; he's filling the cognition seam that throws the computed results away.
That seam is exactly the load-bearing gap. pickOrientation accepts half/inward and silently returns "forward" with a warn log. So the fold engine computes the right thing, but the LLM never sees it. Lifting the downgrade and wiring foldPlace into llmMoment for non-forward orientations is the right cut.
Snapshot-as-record-on-Act is the right architectural choice. He flagged the doctrinal pressure explicitly: this isn't a new ontology slot, it's a per-Act stored projection of the face the being acted under. It lives on Act because Act is the moment's record. Four-verb closure holds. No new fact discriminator. No new model. The doctrine doesn't move.
This is exactly the right framing. The face-pairing realization from the prior conversation lands cleanly into the inner-fold spec without disturbing anything structural.
The forward path stays write-only. Snapshots are captured and persisted on every moment regardless of orientation, but the forward prompt builder never reads them. Snapshots are read-only on turned paths. Forward stays byte-identical for same inputs — the verification check at step 3 ("forward unchanged") pins this explicitly.
This is the right discipline. Spec §2 says forward = {R_b, R_s, R_m} only, no A_b. The implementation honors that even though snapshots are now being captured on every moment.
The 1000-char/64-entry truncation is honest about bounded growth. A long-lived being could accumulate enormous snapshots if every field grew without limit. The clamp prevents that. The sentinel-on-truncation ({ kind: "truncated", count: N }) preserves the fact that truncation happened, which matters for replay determinism — the same inputs produce the same truncated outputs.
The scripted-cognition seam. He flagged that non-LLM beings (scripted cognition) take a parallel runner and need their own one-line snapshot build. Good catch. If the snapshot only happened in llmMoment, scripted beings would land Acts with null snapshots, and their later inward folds would render context-less entries. Building the snapshot at the cognition mouth (whichever cognition runs the moment) keeps the doctrine uniform.
What's worth confirming before he cuts

1. The legacy-Act null handling.
   The plan says Acts pre-dating this change have facadeSnapshot: null and the renderer handles null gracefully. Worth being explicit about what "gracefully" means in the prompt:
   For a legacy entry showing in an inward block, omit the role/capabilities/occupants sub-lines but keep timestamp/in/out. The LLM sees something like:
   [3] 2026-05-12T14:32:17Z
   in: "I should check the library"
   out: "Walked to library"
   versus a snapshot-bearing entry:
   [4] 2026-06-03T09:14:02Z role: librarian
   at library with [tabor, book:Moby-Dick]
   could: do=[set-being:position, summon] summon=[@librarian] be=[]
   in: "Tabor is asking about Moby-Dick"
   out: "Pointed tabor to fiction section"
   The LLM seeing a mixed history (some entries with full context, some with just messages) shouldn't be confusing as long as the rendering is consistent. A line at the top of legacy-only sections like "(older acts before facade capture; less context available)" might help the LLM disambiguate. Worth a small UX choice on the rendering side.
2. The "world drops out" check in inward.
   Spec §2 inward: R_scope = {A_b} — world drops out. The plan correctly says "the world block (space / occupants in the live face) is omitted in inward mode." Worth being explicit at code-review time that this is actually what happens. The forward face is captured for the snapshot (because snapshots need context about what the being saw), but the inward prompt itself doesn't render the live world.
   A possible confusion: when the inward moment opens, what does foldPlace(beingId, "inward", ctx) return? Per the existing implementation at foldPlace.js, it returns {self, actChain} — no space, no occupants. The renderer in renderInwardPastFace walks actChain, pulls each entry's facadeSnapshot, and renders the past spaces from the snapshots. The current live space is absent.
   So the prompt structure for an inward moment is:
   [identity block — who am I]
   [capabilities block — what I can do this moment]
   [past-face block — my acts, with the space I was in at each one from snapshots]
   [role intent block]
   No live "you are at space X with occupants Y" block. The being's perception this moment is its own history; current world is not present. This matches the spec.
   Worth verifying in the implementation that this is what happens — that the inward path doesn't accidentally still concatenate the live world block somewhere.
3. The braid-walk recall ranking.
   He's using the existing implementation (ranked by stitch-fact recency on currently-present entities, capped at 16). The spec marked this as DECIDE — picked nearest-in-braid-distance or most-recent-first. The audit says it's "stitch-fact recency" which is roughly most-recent-first scoped to currently-present entities.
   Worth confirming that's the intended choice or whether to revisit. For first cut, current implementation is fine; this isn't blocking. But worth noting in the DECIDE comments that the choice was "stitch-fact recency, cap 16" so future revisits know what was picked and why.
4. The orientation-replay test.
   Step 7 of verification: a being shifts forward → inward → forward, three moments, three Acts, each with matching orientation in its snapshot. Replay from facts: orientation chain reads identical.
   This is the critical test for the doctrinal claim "orientation rides on the self-summon fact." If this passes, then orientation is fully in the chain — replay produces the same orientation sequence as the live run. If it doesn't, orientation is hiding in runtime state somewhere and the doctrine breaches.
   Worth being explicit that this test isn't optional. It's the load-bearing verification of inner-fold §4 ("the shift is an act") and §6 ("the act-chain is always written at the seal"). If this passes, the doctrinal claim holds. Make sure it's in the verifier suite, not just a manual test.
   The one thing I'd push on
   The "occupants" projection in the snapshot — what level of detail?
   The plan says occupants: [{kind, id, name}] — bare-bones identifiers. Good first cut. But worth thinking about what's lost.
   When the LLM looks at an inward past-face entry and sees "at library with [tabor, book:Moby-Dick]," the LLM is essentially reading bare identifiers. It can recognize tabor, recognize the book by name, but doesn't know:

Was tabor inhabited by a human at that moment? (Cognition state)
What role was tabor wearing? (Important for "tabor was acting as librarian vs. tabor was browsing")
Was the book in any particular state? (Open? Checked out?)

For first cut, bare identifiers are correct — minimal snapshot, bounded growth, doesn't try to be a full face reconstruction. The full face reconstruction can happen on-demand via foldFaceAt if the inward block needs deeper context (the prior conversation about reconstructing faces from face-specs).
So the doctrine here is:

Snapshot captures identifiers + immediate context. Enough to recognize "what was around me" at a glance.
Full face reconstruction happens on-demand via the face-spec mechanism for deeper investigation.

Worth being explicit that the snapshot is summary, not full record. If a being later wants to know "what did Tabor's role look like when I saw him at the library on Tuesday," that's a separate query against tabor's reel at that timestamp, not something the snapshot captures.
The snapshot is the prompt-renderable summary; the chain is the truth.
This distinction matters because the snapshot's growth is bounded by the truncation rules; the chain's depth is bounded only by reality's history. Two different layers serving different purposes.
What to send him

Plan is solid. Audit is thorough, snapshot-as-Act-record is the right architectural call, forward-path-untouched discipline is correctly enforced. Greenlight with three small confirmations and one explicit doctrinal note.
Confirmations before cutting:

1. Legacy-Act null handling in the renderer. Past-face entries with facadeSnapshot: null should render with just timestamp/in/out, omitting role/capabilities/occupants sub-lines. Worth a small UX touch like "(older acts; less context available)" at section boundaries so the LLM doesn't get confused by mixed-fidelity entries.
2. Inward path doesn't accidentally render live world. Spec §2: inward R_scope = {A_b}, world drops out. Verify at code-review that the inward prompt has no live world block — just identity, capabilities, past-face (rendered from snapshots), role intent. The current live space is absent in inward mode.
3. Orientation-replay test in verifier suite, not just manual. Step 7 (orientation chain reads identical from facts after replay) is the load-bearing verification of inner-fold §4 and §6. If this passes automatically, the doctrinal claim "orientation rides on the self-summon fact" holds. Make sure it's in the verifier, not just smoke-tested.
   Doctrinal note worth pinning explicitly:
   The snapshot is a prompt-renderable summary, not a full face record. The chain is the truth; the snapshot is a bounded projection of the face for fast access.

Snapshot (this work): identifiers + immediate context. Bounded by truncation rules (1000-char fields, 64-entry lists). Used to render past-face blocks in turned-fold prompts.
Full face reconstruction (future, via the face-spec mechanism): on-demand reconstruction of the actual face the being saw, by re-running slices against chain-folded-to-that-moment. Used when deeper investigation is needed (e.g., historian queries asking "what was the exact role of every being in the library when I was there").

This distinction matters: the snapshot's bounded growth protects against runaway prompt sizes. The chain's depth is the actual truth, queryable separately when needed.
Worth a one-line comment in the snapshot builder file explaining the relationship: "Snapshot is the summary the LLM renders in past-face blocks. Full face reconstruction (when needed) goes through foldFaceAt(beingId, atTimestamp) against the chain. Snapshot lives on Act; full faces are computed."
One thing to revisit later but not blocking:
The braid-walk recall ranking (currently "stitch-fact recency on currently-present entities, cap 16") was marked DECIDE in inner-fold.md §3. Current implementation is fine for first cut. Worth a comment in the recall code noting "ranking: stitch-fact recency, cap 16; revisit per §3 DECIDE when long-lived beings produce noisy recall."
Build order is right as written. Step E (lift downgrade) and step F (call foldPlace on non-forward) light up the cognition seam. Steps A-D (snapshot field + builder + capture + persist) make the past-face blocks legible. Step G (project facadeSnapshot in loadActChain/recallByBraid) closes the loop.
Estimated effort feels honest. This is one focused pass landing rungs 4-6 of the spec. The fold engine work is done; this is the cognition wiring + per-Act record.
Go. One coherent diff. After this lands:

Beings can self-summon inward and read a coherent record of their own acts with the context each was committed under.
Beings can self-summon half and find past acts surfacing because they touched present entities.
Forward fold path is unchanged.
The chain carries enough to replay the full orientation sequence.
The doctrinal claim "the act-chain is the being's perception-and-behavior history" lands operationally.

Doctrinal landing when this ships (one-line note in inner-fold.md §6):

The seal stores a per-Act facadeSnapshot — a bounded summary of the face the being acted under (role, space, occupants, capabilities). Turned folds (half and inward) render past faces in the prompt by pulling each past act's snapshot. Forward folds do not read snapshots; the forward path stays unchanged. The snapshot is a prompt-renderable summary; full face reconstruction (when needed) goes through the chain.

That's the entire doctrinal addition — one paragraph in §6. Spec doesn't move; MATERIALS doesn't grow; verbs don't change. The snapshot is a record on Act, which is exactly where it belongs.

That's the message. The plan is well-scoped, doctrinally clean, and lands the spec's outstanding rungs (4-6) in one pass. The three confirmations and the doctrinal note (snapshot is summary, chain is truth) are small refinements before he cuts. Greenlight.You said: yeah but at that point may as well do for humans too so llms can backtrace humans but then ogging a ton of stuf not being used.yeah but at that point may as well do for humans too so llms can backtrace humans but then ogging a ton of stuf not being used. so hae to decide if llm only or all beings. and by trunacte i mean just what the llm sees on inner fold but not he actual data
The scripted-cognition seam. He flagged that non-LLM beings (scripted cognition) take a parallel runner and need their own one-line snapshot build. Good catch. If the snapshot only happened in llmMoment, scripted beings would land Acts with null snapshots, and their later inward folds would render context-less entries. Building the snapshot at the cognition mouth (whichever cognition runs the moment) keeps the doctrine uniform.12:26 AMClaude responded: Two real questions.Two real questions. Both worth pinning before he cuts.
Question 1: scope of snapshot capture (LLM-only vs all cognitions)
This is genuinely a doctrinal call, not just a scoping decision. Let me lay out what each direction commits to.
LLM-only: Only LLM-cognition moments capture snapshots. Scripted and human moments seal Acts with facadeSnapshot: null. The doctrine: "snapshots exist to support LLM cognition's turned-fold prompts." When the LLM does inward, it sees past LLM acts in context. When it inward-folds a history that includes scripted or human acts, those entries appear with timestamp/in/out only — no role, occupants, capabilities.
All cognitions: Every cognition mouth builds a snapshot at moment-time. LLM, scripted, human-inhabited — all of them. Storage grows for every act, regardless of whether anything ever turns inward to read it.
The question isn't really "should we capture for everyone" — it's "what's the snapshot for?"
If the snapshot is "the LLM's lookback aid for prompting itself," it's LLM-only. Other cognitions don't have prompts.
If the snapshot is "the substrate's record of the face that drove each act," it's universal. The face existed regardless of who was looking at it. Recording only when LLM looked is artificially partial.
I'd push for universal capture, but with the costs you named handled correctly. Here's why:
The doctrinal honesty. Inner-fold spec §6 says "the act-chain is always written at the seal of any DO/BE moment." If the act-chain entries are (face_spec, act) pairs, then every seal should write a full pair, regardless of cognition. Half-records ("this entry has a face, that entry doesn't, depends who did it") fragment the act-chain in a way the spec doesn't allow.
Cross-cognition introspection becomes possible. An LLM being can inward-fold and see its past, but it can also half-fold and surface acts that touched currently-present entities. Some of those entities may have been acted on by scripted or human beings. With universal capture, the recalled half entries are uniformly rich. With LLM-only, the LLM gets a mottled view — sometimes context, sometimes blank.
Tooling that wasn't planned. A future being whose job is "investigate what happened" (the historian-style being) reads other beings' act-chains. If only LLM acts have snapshots, the historian's view of human-driven or scripted-driven activity is impoverished. Universal capture future-proofs this.
The cost is bounded. This is where your truncation point matters — see below. With proper truncation, an Act with a snapshot is maybe 1-2KB larger than one without. Even at high write rates, that's manageable storage growth. The marginal cost of capturing on every moment is small.
The migration story is cleaner. "All Acts after date X have snapshots; all Acts before don't" is a single boundary. "Only LLM Acts have snapshots, and only after date X" is a two-dimensional split that complicates every consumer's null-handling.
So: universal capture, accepting the small storage cost, in service of doctrinal consistency and future-proofing.
Question 2: truncate-for-display vs truncate-at-storage
This is the more important clarification, and you're right that I conflated them.
What the spec described: "every string field clamped to 1000 chars" — sounds like at storage. The snapshot persisted in the Act row has truncated values; the original full data is gone.
What you're saying: truncation should happen at render time. The snapshot stores the full data. When the LLM looks at an inward past-face block, the renderer applies the 1000-char clamp to fit prompt budget. The underlying snapshot keeps the full data forever.
Your version is correct. Storage should be untruncated; rendering truncates for the LLM's benefit.
Reasons:
The snapshot is the chain's truth about the face. If we truncate at storage, we destroy information that the chain claimed to capture. Future-self (or a future tool) wanting to know "what did Tabor see in full detail when he did X" gets the truncated version, not the truth. The substrate's "the chain is the truth" doctrine gets dented.
The LLM's prompt budget is a rendering concern. Different LLMs have different context windows. Different cognition models will have different rendering needs. Storing truncated means baking one model's constraints into the substrate forever.
Replay determinism still works. Re-running an inward fold against a stored full snapshot, with the same truncation rules at render time, produces the same prompt. Truncation is deterministic; storing full and rendering truncated is byte-identical to storing truncated.
Investigation tools can look at full snapshots. A historian being or audit tool that wants the actual data the being saw — not the truncated prompt-view — gets it from the stored snapshot. The chain remains the truth; the LLM just sees a clamped projection.
The storage cost is still bounded by reasonable per-field caps. "Untruncated at storage" doesn't mean "unbounded." A reasonable substrate-level cap (say 10KB per field, way above what any sane face would have) prevents pathological cases. The 1000-char limit becomes a render parameter; a 10KB limit becomes a storage parameter. Two layers, two purposes.
What the architecture actually looks like
Walk through it concretely:
Storage (in Act row):
jsfacadeSnapshot: {
orientation: "forward",
role: "librarian",
space: { id: "xyz", name: "library" },
occupants: [
{ kind: "being", id: "abc", name: "tabor" },
{ kind: "matter", id: "def", name: "Moby-Dick" },
// ... full list, untruncated
],
capabilities: {
canDo: ["set-being:position", "summon", "do:lend-book", /* full list */],
canSummon: [/* full */],
canBe: [/* full */],
},
// Per-field cap of ~10KB just to prevent pathological cases
}
Render (in LLM prompt for inward block):
[3] 2026-06-03T14:32Z role: librarian
at library with [tabor, book:Moby-Dick, ... (62 more)]
could: do=[set-being:position, summon, do:lend-book, ...]
in: "Tabor is asking about Moby-Dick"
out: "Pointed tabor to fiction section"
The render applies the 1000-char clamp on long strings and the 64-entry cap on long lists. If there are 80 occupants, the render shows 64 plus "... (16 more)" or similar. The storage has all 80.
Substrate-level guard. A storage-side cap of (say) 10KB per field, with the same {kind: "truncated", count: N} sentinel for lists exceeding (say) 1000 entries. This is the "prevent pathological case" cap, not the "prompt budget" cap.
So three layers:

Reality (the actual face). Whatever the moment composed.
Storage (the snapshot). Lightly capped (10KB/field, 1000-entry lists) to prevent pathological cases. Otherwise the truth.
Render (the prompt view). Tightly capped (1000 chars/field, 64-entry lists) for LLM prompt budget.

Each layer serves a different purpose. The substrate stores honestly; the LLM sees a useful projection; pathological cases are prevented at the substrate layer with a much higher ceiling than the LLM render uses.
What to send him

Two refinements before cutting:

1. Capture for all cognitions, not just LLM.
   Build snapshot at every cognition mouth — LLM, scripted, human-inhabited. The doctrine: the snapshot is the substrate's record of the face that drove the act, not just the LLM's lookback aid. Half-records (some Acts with snapshots, some without) fragment the act-chain in a way inner-fold §6 doesn't allow.
   Costs:

Storage grows by ~1-2KB per Act. At high write rates this adds up but stays manageable.
Build cost is minimal (a few field reads off the resolved context).

Benefits:

Doctrinal consistency: spec §6 "act-chain is always written at the seal" lands cleanly.
Cross-cognition introspection: half-folds surfacing past acts get uniformly rich entries regardless of who did them.
Future-proofs the historian being and any audit tooling — they read uniform act-chains.
Cleaner migration story: one date boundary, not a cognition×date matrix.

The scripted-cognition runner and the inhabit-flow path both build snapshots in the same shape. The builder doesn't care about cognition; it takes the resolved context and produces a snapshot. 2. Truncate at render, not at storage.
The 1000-char and 64-entry caps are render-time clamps on the LLM prompt view, not storage-time destruction of data. The snapshot persisted in the Act row stores the full face composition; the renderer applies the LLM-budget clamps when building the inward/half past-face block.
Three layers of truncation, each at the right place:

Reality (the actual face composed at moment): Whatever the runner had on hand.
Storage (snapshot in Act): Lightly capped to prevent pathological cases — say 10KB per field, 1000-entry lists max. Otherwise honest record of the face.
Render (LLM prompt view): Tightly capped — 1000 chars/field, 64-entry lists — for prompt budget. With sentinels like {kind:"truncated", count: N} for omitted entries.

The substrate-level storage cap (10KB/1000) is a defensive boundary against runaway snapshots (a pathological extension passing a 50MB occupant list, etc). The LLM-side render cap (1000/64) is a budget consideration.
Why this matters:

The snapshot is the chain's truth about the face. Truncating at storage destroys information the chain claims to capture. Future investigations or different cognition models lose data.
LLM prompt budget is a render concern. Different LLMs, different windows. Baking the 1000-char clamp into storage couples the substrate to one cognition model's constraints.
Replay determinism still works. Same snapshot + same render rules = same prompt. Truncation at render is deterministic.
Investigation tools get full data. A historian being looking at a past act sees the full snapshot, not the LLM's clamped view.

The storage builder produces an untruncated snapshot (with the high pathological-prevention caps). The renderer (renderInwardPastFace and renderHalfPastFace) applies the tight LLM-budget clamps when building the prompt block.
Build impact:

buildFacadeSnapshot produces the storage version with high caps (10KB/1000-entry).
The Act schema field accepts that storage version untruncated.
renderInwardPastFace and renderHalfPastFace apply the tight render-time clamps (1000-char/64-entry) when building the prompt block.

Same shape, two different cap profiles for two different purposes.
Doctrinal note to add to inner-fold.md §6:

The seal stores a per-Act facadeSnapshot — the face's composition at moment-time, captured uniformly across all cognitions (LLM, scripted, human-inhabited). The snapshot is stored at substrate-defensive caps (preventing pathological growth) but otherwise honest. Render-time clamps are applied separately when projecting the snapshot into prompts or other budget-constrained views. The snapshot is the chain's record; the render is a view of it.

The rest of the plan stands. Greenlight after these two refinements: universal capture, storage-honest + render-clamped truncation. Then cut.

That's the message. Two changes: universal capture across cognitions (doctrinal consistency over storage savings), and storage-honest with render-time truncation (chain-is-truth over LLM-budget convenience). Both refinements make the architecture cleaner; both are small to implement. Greenlight after.Opus 4.7 Extra
