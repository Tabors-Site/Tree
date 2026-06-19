# Stays extraction — the 4 entangled words (overnight 2026-06-19)

Designed by the stays-extraction-design pass; decisions made autonomously (Tabor: "figure it out
with your reasoning unless SUPER HARD"). Execute ONE AT A TIME, verify each (node --check +
contention-free resolve-check + a full boot), in the order below. The generic engine
(parser/evaluator/fold/chain/dispatch, operations Map, roleWordRegistry bridge, BE_OPS) stays factory.

## Decisions (made — not pending)
- **matter/create-matter: WIRE THE CUT.** Word-first handler + JS clean-miss fallback, exactly like grant-role's `_grantRoleViaWord`. matter.word is unwired today; this carve wires it live (caller mode). Keep `skipAudit:true` (matterHost.emitBirth is the world write).
- **matter coordBounds home: materials/matter/coordBounds.js** (NOT under store/ — that would invert the dependency, kept ops.js importing from a word bundle).
- **acquisition: lift emitInternalGrant → present/roles/internalGrant.js** (factory shared, function-export, no boot import). see.js:718 imports it instead of acquisitionOps.js. The bundle is already-wired (live cut) — preserve, don't add. FIX grantInternal `history:`→`branch:` (latent fork bug).
- **set-model: MOVE-INERT.** Register the word (key `(render, set-model)` — op name differs from set-render so k(role,op) is unique), handler stays pure JS. Wiring needs a net-new modelHost.js + rewriting model.word's stale host-fn names = net-new code, a separate follow-up. Leave model.word byte-identical.
- **cherub: WHOLE-DIR move** present/roles/cherub/ → store/words/cherub/ (role.js carries the whole frozen cherubBeOps intact — splitting fractures BE_OPS). Self-register the 2 words via registerRoleWord, then DELETE the 2 hardcoded built-in entries in roleWordRegistry (L32-35) — the engine becomes wordless. Repoint beOps.js:31, genesis.js (L559/622/698), the verifiers, examples/cherub-word-demo.js. Add a services.js side-effect import so registration is a declared boot fact (not dependent on the beOps import chain).

## Order + targets + boot seam + progress
- [ ] 1. **set-model** → store/words/model/ (index.js[=moved modelOp.js]+model.word). Seam: services.js:188 repoint. LOW.
- [ ] 2. **matter/create-matter** → store/words/create-matter/ (index.js + create-matter.word + matterHost.js) + NEW materials/matter/coordBounds.js. Seam: services.js add beside matter/ops.js import. MEDIUM.
- [ ] 3. **acquisition** → store/words/acquisition/ (index.js + ask-role.word + take-role.word + acquisitionHost.js) + NEW present/roles/internalGrant.js. Seam: services.js:214 repoint. MEDIUM (see.js:718 cross-cut).
- [ ] 4. **cherub** → store/words/cherub/ (role.js + cherub.word + cherub-connect.word + connectHost.js). Seams: roleWordRegistry built-in delete + beOps.js:31 + genesis.js×3 + services.js add. MEDIUM-HIGH.

## Shared-module lifts (do FIRST within each word)
- materials/matter/coordBounds.js — COORD_AXES + assertMatterCoordInBounds (single canonical body; kills matterHost's verbatim dup). Importers: kept matter/ops.js (setOnMatterHandler) + the create-matter bundle host.
- present/roles/internalGrant.js — emitInternalGrant (verbatim from acquisitionOps.js:346-377). Importers: see.js:718 + the acquisition bundle host + index. No boot import (function-export).

## Flags for Tabor (morning, NOT silently fixed unless noted)
- matter ops.js: resolveMatterName called with `history:` but signature is `branch:` → silently branch=undefined. FIXED during the carve (the moved JS body uses `branch:`).
- acquisition: grantInternal passes `history:` to emitInternalGrant which wants `branch:` → explicit branch dropped on forks. FIXED during the carve.
- cherub genesis.js:698-707: `cherubBeing.register(...)` is a STALE/broken call (no `register` method exists; swallowed by the catch). LEFT as-is — pre-existing, separate from this carve. Needs a decision.
- set-model: model.word's header names host fns that don't exist (assertMaySetModel/resolveModelBlock/clearModel/writeModel). Inert move leaves it byte-identical; wiring is a from-scratch host design (follow-up).

## Verify per word
node --check touched files + resolve-check (import the bundle, assert resolveRoleWord(role,op) non-null + op in the Map) + the per-word verify-*.mjs harness + a full fresh-wipe boot (all ops register, concepts declared, genesis clean, no errors). Boot the tree free (recycle the stale :3000 server).
