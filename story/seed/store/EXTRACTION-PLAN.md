# Word extraction plan — moving each implementation word + its logic into store/words/

Goal: each implementation `.word` lands under `store/words/` WITH its handler (a portable
bundle), while the generic engine (parser, evaluator, fold, chain, dispatch, the operations Map
in `ibp/operations.js`, the roleWordRegistry bridge) STAYS factory and holds no words.

Layout (adopted): per-word dir when a word is truly single; per-GROUP dir when words share
within-group helpers. Concepts stay flat (`store/words/<name>.word`, no code); an implementation
bundle is a subdir (`store/words/<word>/`, word + its logic). That distinction is the organization.

The one systemic failure mode: **registration is a module-load side effect.** Every move must keep
the moved module imported at boot, and verify `registerOperation` + `registerRoleWord` both fired
(op in the Map AND `resolveRoleWord(role,op)` returns non-null). Op names + factAction strings stay
byte-identical (the dispatch table, lineage fold, and portal UI all key on them).

## STATUS — ✅ ALL 8 EXTRACTED + BOOT-VERIFIED (2026-06-19)

Fresh wipe + boot: all 12 ops register, 20 concepts declared onto the chain, genesis clean
(`[Story] I am born.`), server up, zero errors. Items 1-8 below are all DONE and verified.
Remaining: matter / acquisition / cherub / set-model stay co-located (flagged, see below);
the present/word demo programs → `present/word/examples/` (Tabor's call); grant-role/index.js
carries one harmless unused static `grantHostEnv` import to tidy.

## Order (lowest-entanglement first) + progress  [all 8 done]

- [ ] 1. **key-export** → `store/words/key/` (key.word, keyOps.js, keyHost.js). services.js:204 repoint. LOW.
- [ ] 2. **set-render** → `store/words/set-render/` (set-render.word, setRender.js, setRenderHost.js). services.js:235. LOW.
- [ ] 3. **portal** → `store/words/portal/` (portal.word, portalOp.js, portalHost.js). services.js:193. LOW.
- [ ] 4. **move** → `store/words/move/` (move.word, moveOp.js, moveHost.js). services.js:182. LOW.
- [ ] 5. **grant-role** → `store/words/grant-role/` (grant-role.word + grantHost.js; carve grantRoleHandler/_grantRoleViaWord out of being/ops.js into a new index.js). ADD services.js import beside :194. LOW.
- [ ] 6. **credential** (group, 4 words) → `store/words/credential/` (4 .word + ops.js + host.js; share 4 helpers). services.js:195. 3 verifiers gate. LOW.
- [ ] 7. **branch-pointers** (set-pointer + delete-pointer) → `store/words/branch-pointers/` (carve 2 of 8 ops from branch-manager/ops.js, shared host.js + new index.js). ADD genesis.js boot import. MEDIUM.
- [ ] 8. **set-world-signal** → `store/words/set-world-signal/` (carve from role-manager/ops.js's mixed 3-op file; disjoint helpers parseSignalValue/NS_SEGMENT_RE move too). ADD genesis.js boot import. MEDIUM.

## Stay co-located (do NOT move — flagged)

- **matter/create-matter** — cut is UNWIRED (handler runs pure JS, never resolveRoleWord; matterHostEnv has no consumers); shares private `assertMatterCoordInBounds` with setOnMatterHandler; ops.js co-owns 4 non-word siblings. Wire the cut first (add `_createMatterViaWord`), then revisit.
- **acquisition (ask-role/take-role)** — `emitInternalGrant` is shared by both handlers, acquisitionHost, AND the core SEE verb (see.js:718). A word bundle holding it forces SEE to reach into a word. Refactor emitInternalGrant to a shared module first.
- **cherub (birth/connect)** — birthHandler/connectHandler are 2 of 6 in the frozen `cherubBeOps` object feeding the closed BE_OPS table; the .word is control-strand only (real logic in connectHost + JS fallbacks); and cherub is the ONLY word hardcoded in roleWordRegistry's built-in map (engine-relative paths). Whole-dir move only, last, separate session.

## Shared-reader notes

- **roleWordRegistry built-in map (L32-35):** NO edit for any moved word — they self-register via `registerRoleWord` at module-load; `new URL("./x.word", import.meta.url)` resolves against the moved module's own dir. The only built-in-map entries are cherub (which stays).
- **operations Map (ibp/operations.js):** NEVER moves; each handler keeps calling `registerOperation(name, {...})` from its new home — only the import PATH deepens to `../../../`.
- **services.js side-effect imports:** repoint one line per bundle (key:204, set-render:235, portal:193, move:182, credential:195); ADD a new import for grant-role beside :194 (being/ops.js stays for revoke-role/set-being/LLM ops).
- **root genesis.js dynamic imports:** branch-pointers + set-world-signal register through genesis.js's `await import()` of the role-dir ops.js (branch-manager 754-756, role-manager 742-744). After carving, ADD an explicit `await import()` of the new store bundle index.js beside those, or the .word silently goes dark.
- **declareWordsToChain / rehydrate:** no edit — fresh dev DB, params.source path changes are fine (no migration); resolveRoleWord keys on (role,op), path-agnostic.

## Gaps / decisions (adopted)

- Name-collision: `present/word/{being,matter,space}.word` are inert narrative twins — they must NOT land in store/words (would shadow the real concept words). → an examples/ dir.
- Demo/narrative programs (7 .word + 3 .ir.js + 7 demo runners in present/word): relocate whole to `present/word/examples/`; engine (parser/evaluator) stays.
- Pre-existing (NOT ours): verify-setpointer-cut.mjs / verify-deletepointer-cut.mjs import readPointers from stale `branchRegistry.js` (actual: `historyRegistry.js`).
- Unwired cuts: matter/portal/move/set-render ship .word+host the live path never runs (JS handler is live). Relocation is inert (safe); WIRING the cut (adding `_viaWord`) is a separate per-CONVERTING.md decision.

## Verify per move

`node --check` on touched files + a contention-free resolve-check: import the moved module (fires
registration), assert `resolveRoleWord(role,op,"0")` is non-null. Full boot-verify + the per-word
verify-*.mjs harnesses when the tree is free of the other agent's server.
