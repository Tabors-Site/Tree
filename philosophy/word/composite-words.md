# composite-words — the verb lane authors the composite .words; the engine wires the run

> **Verb-lane build doc + engine handoff.** Pairs with `moments.md` (engine lane) and `23.md`
> (the skipAudit tracker). Tabor, 2026-06-22: *"They author ready; I wire the run."* This is the
> ready handoff: the composite `.word` bodies + their host bridges, plus the exact list of what the
> engine lane must provide (E1–E7) for the spacebar-grain ones to RUN. Ground-truthed against
> `parser.js`, `create-matter/`, `set-world-signal.word`, `reducerHelpers.js`, both runners.

## Doctrine absorbed this session (so both lanes stay aligned)

- **Inner word = the message inside a call/recall/quote** (Tabor, 2026-06-22). `call tabor hello`
  → `"hello"` IS the inner word. It is NOT a separate "answer-act." A being **responds by CALLING
  the asker** with the message; the cognition-moment is only the *decision* (read the face, choose
  the Word). The deeds (do/be/name + calls/recalls/quotes that carry inner words) are the only acts.
  → Engine lane: revert the answer-act seal path in `moment.js` to "respond = a call." Verb lane:
  no answer-act anywhere in the `.word`s; a response is `call <asker> <inner-word>`.

- **No JS fallback** (Tabor, 2026-06-22): the `.word` IS the op's implementation. A JS handler
  body kept as a clean-miss "fallback" is **drift** — two implementations of one act, the exact
  duplication the Word dissolves. On a clean miss the op **refuses** (a disabled/gone word = the
  op is gone — words-as-facts: executability is a fold). So a converted op = resolve the `.word`,
  run it, refuse if it doesn't resolve; the old JS handler body is **deleted**, not demoted to a
  fallback. *(create-matter still carries a transitional JS fallback — a follow-up cut; do NOT copy
  that half of its shape.)*

- **Grain is the spacebar: one word = one fact, however rich its content** (Tabor, 2026-06-22, the
  crystallization). A composite word — "create a space named X", "add a connection named N at U with
  model M and key K" — is **ONE fact**. The name/url/model/key are the word's *content* (IS-side,
  the letters), they do NOT multiply the count. **create-matter is the proof** (all that resolve-spec
  compute, one birth fact). So `create.word` AND each llm op lay **one** `do:*` fact. The separable
  NEXT change (update the model later) is the next word = its own fact.
  - **NO five-facts grain, NO E2/E3** — that was the loop over-theorizing what the spacebar settled.
    The current one-fact `do:set-being` (whole conn at `qualities.llmConnections.<id>`) is already
    spacebar-correct.
  - **The real skipAudit work is the RUN-ONS** (buried verbs / crammed words): add's auto-assign-to-
    main is a *second verb* (→ its own word/op, not buried in add); delete's slot-clears are a *run-on*
    (→ the reducer/resolution folds the dangling ref — deleteLlmConnection's own comment already says
    readers fall through gracefully). Clean each by the spacebar and the flag drops.

## 1. create.word — ✅ LANDED + VERIFIED (2026-06-22)

**verify-createspace-cut.mjs 8/8** (genesis green + one do:create-space fact via the dispatcher,
no skipAudit/no self-emit, NO null terms, fold works, sibling-uniqueness + no-actor refuse, the
afterSeal lock-release holds). Zero regression: verify-endspace-cut 5/5, verify-creatematter-cut 6/6.
Built via the **safe additive path**: `resolveBirthSpace` (non-emitting floor) added to spaces.js,
`createSpace` kernel UNTOUCHED (manifest/services/genesis use it unchanged); the create-space OP
bypasses it (create-matter precedent). Bundle: `store/words/create-space/{create.word, spaceHost.js,
index.js}`; carved from `materials/space/ops.js` (dead handler/child left for a cleanup follow-up);
imported in services.js. No JS fallback (refuses on clean miss).

### original spec (kept for reference)

`seed/store/words/create-space/create.word` — mirrors create-matter exactly: actor gate → one host
`see resolve-birth-space` → `Return factParams`. One `do:create-space` fact via the dispatcher
(drops skipAudit on the `create-space` op). Body:

```
When a being brings a space into a place:
  If no caller, refuse with "create-space requires an identified actor" as unauthorized.
  see resolve-birth-space(target, targetKind, params, caller, branch) as birth.
  Return spaceId: $birth.spaceId, factParams: $birth.enrichedSpec.
```

- **Bridge** `create-space/spaceHost.js`: reuses `assertValidSpaceName`, `assertNameAvailableAt`,
  `assertValidSpaceSize`, `acquireSpaceLock`/`releaseSpaceLock`, `getInternalConfigValue("maxChildrenPerSpace")`,
  `getSpaceRootId()` (EXISTS sprout.js:937), `Projection.countDocuments`, `uuidv4` — the SAME calls
  the JS `createSpace` makes, NO reimplementation. Lays NO fact. Builds `enrichedSpec` with the
  **no-null-terms** conditional spreads (only the fields that ARE). Acquires the parent-lock and
  releases it in `ctx.moment.afterSeal` (EXISTS sprout.js:191 / sealAct 4-stamped.js:140) so the
  max-children invariant brackets the dispatcher's stamp.
- **index.js**: `registerAbleWord("space","create-space", …)` + `_createSpaceViaWord`
  (resolveAbleWord/runAbleWord, CALLER mode) + `stampsWordFact(result,"space","spaceId")`.
  **No JS fallback** — on a clean miss the op refuses. Carve `create-space` OUT of
  `materials/space/ops.js` (keep set-space/end-space), and DELETE the JS handler body.
- **make-heaven stays a SEPARATE moment** (its own `do:make-heaven`) — owner/coord/heaven are each
  their own word, per the spacebar. Genesis already runs the 3-moment sequence by hand
  (createStoryHeavenSpace / sprout) — `create.word` is the user/dispatch path's birth word.

## 2. The llm-connection words — ONE FACT each (the spacebar; no E2/E3)

Each is `see resolve-X(...) as r` → `Return factParams: $r.setBeingParams`; the host see (the floor)
computes + bakes the params, the dispatcher lays the **one** `do:set-being`. The conn (name/url/
model/key) rides as one value at `qualities.llmConnections.<id>` — that IS the spacebar-correct shape,
matching today's `addLlmConnection`.

- **add-llm-connection.word**: `see resolve-connection(name,baseUrl,apiKey,model) as conn` →
  `Return connectionId: $conn.connectionId, factParams: $conn.setBeingParams`. One fact.
  - **RUN-ON to clean**: today's handler *also* auto-assigns the first conn to `main` (a buried
    second verb). Spacebar fix → the assign is its OWN word. Either drop the auto-assign (UX change,
    flag for Tabor) or make "add-and-assign" a two-moment word via `runWordToStore`. For now author
    add as the pure one-fact add; note the auto-assign as a separable follow-up.
- **update-llm-connection.word**: `see resolve-connection-update(connectionId,...) as patch` →
  `Return factParams: $patch.setBeingParams`. One fact (the merged conn). The "nothing-to-update"
  case returns no factParams → the dispatcher lays nothing (a no-op word).
- **assign-llm-slot.word**: `see resolve-slot-assignment(slot,connectionId,caller) as a` →
  `Return factParams: $a.setBeingParams`. One fact (`beingLlm.slots.<slot>`). Genuinely single-aspect.
  (Host see branches being vs space — `assignConnection` / `assignSpaceConnection`.)
- **delete-llm-connection.word**: `see resolve-connection-removal(connectionId,caller) as r` →
  `Return factParams: $r.setBeingParams` (unset `<id>`, value:null). One fact.
  - **RUN-ON to clean**: today's handler also nulls every slot that pointed at the conn (N extra
    facts). Spacebar fix → delete is one fact (unset the conn); the dangling slot ref FOLDS
    (resolution falls through gracefully — `deleteLlmConnection`'s own comment). Drop the explicit
    slot-clears.

- **encryptedApiKey** rides the fact as ciphertext; **E5 confirms redact strips it** (it does).

## 3. Host bridges — reuse only (E6 is the precondition)

Extract the validate+SSRF+encrypt+uuid+conn-build block out of `connect.js addLlmConnection`
(and update/delete/assign) into shared exported `resolveConnectionSpec` / `resolveConnectionUpdate`
/ `resolveConnectionRemoval` / `resolveSlotAssignment` — each returns
`{ …computed, setBeingParams: { field, value, merge } }`, lays NO fact. The host bridge AND the
legacy fn both call them (one kernel, two callers — the "no reimplementation" rule). connect.js
exports today: addLlmConnection/updateLlmConnection/deleteLlmConnection/assignConnection/
resolveConnection — the validate*/encrypt/isValidUserSlot helpers are NOT exported (E6 lifts them).

## 4. PREREQS (the spacebar collapsed the engine list — every llm op is one fact)

The old E2/E3/E4 ("five-facts grain" support) are **dissolved** — there is no five-facts grain.
What remains:

- **E1 — afterSeal lock-span (create-space): SATISFIED TODAY.** `moment.afterSeal` exists; the
  bridge releases the parent-lock there. No engine work.
- **E5 — redact `encryptedApiKey`: CLOSED.** Verified already covered (redact.js SECRET_KEYS +
  `isSecretFieldPath` startsWith `qualities.llmConnections` / endsWith `.encryptedApiKey`).
- **E6 — connect.js kernel extraction: VERB LANE (mine), IN PROGRESS.** `resolveConnectionSpec`
  landed (addLlmConnection now calls it; behavior-preserving). `resolveConnectionUpdate` /
  `resolveConnectionRemoval` / `resolveSlotAssignment` next.
- **E7 — reducer deep-path + null-unset: ALREADY BUILT** (`applySetQualities` + `setDeepPath`).
- **runWordToStore** is only needed where a word genuinely lays MORE than one fact — i.e. ONLY if
  we keep add's auto-assign or delete's slot-clears as bundled moments. The spacebar says clean
  those run-ons instead, so the converted ops are single-fact → plain `runAbleWord` (create-matter
  shape). *(Engine still owns runWordToStore for the cognition/generative loop — separate work.)*

## 5. Write-order + tonight's plan (verb lane, autonomous while Tabor sleeps)

1. **E5** — CLOSED (verified, no work).
2. **E6** — extract the 4 resolve-* kernels (resolveConnectionSpec DONE). Behavior-preserving;
   boot-verify.
3. **llm bundles** — author the 5 one-fact `.word`s + `llmHost.js` bridge (host see → the E6
   kernels) as the ready bundle content. Activation (index → `runAbleWord`, no JS fallback, drop
   skipAudit, carve from being/ops.js) + the run-on cleans (auto-assign, slot-clears) → boot-verify.
4. **create-space bundle** — DEFERRED tonight: the `createSpace` kernel has a BROAD blast radius
   (manifest, services, spaces.js:640) — refactoring it unsupervised is the one risk to skip. The
   `.word` body + bridge spec are ready (§1); land the kernel return-spec + carve coordinated /
   Tabor-awake. *(Genesis already runs the birth sequence by hand — nothing is broken meanwhile.)*
5. **config/share/delete-config** name-op recognize-verb + **close-story** stay on 23.md's
   coordinated/deferred track.

**Reference bundles (do NOT rewrite — drift):** create-matter/, set-render.word, grant-able/,
set-world-signal.word, history-pointers/, reducerHelpers.js (E7).

**STATUS (verb lane, 2026-06-22 night):**
- ✅ **create.word LANDED + VERIFIED** (8/8, zero regression). The engine's named blocker is done —
  he can cut its caller / proceed. createSpace kernel untouched; the op lays one dispatcher-stamped
  do:create-space fact (skipAudit gone).
- ✅ Doctrine corrected (llm = one fact, E2/E3/E4 dissolved), E5 closed, E6 resolveConnectionSpec landed.
- ⏭️ **llm bundles next**, split by fact-count:
  - **update-llm-connection + assign-llm-slot** = clean one-word cuts (runAbleWord, the create.word
    shape) — mind update's no-op (return no factParams) + assign's being/space branch.
  - **add-llm-connection (auto-assign-to-main) + delete-llm-connection (slot-clears)** = multi-word
    run-ons. Per the spacebar, clean them (assign is its own word; the dangling slot folds) OR keep
    behavior as a 2-moment word via runWordToStore (engine). **The one decision left for Tabor/engine.**
- ⏸️ create-space dead-code cleanup (createSpaceHandler/Child/shapeNewSpace in space/ops.js) = follow-up.
- Coordinating via this doc + moments.md.
