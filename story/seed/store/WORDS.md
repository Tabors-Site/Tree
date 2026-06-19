# Store words — the canonical word ↔ code map

Every word the seed declares, paired with its code (its connecter) if it has any.
A word plus its logic is a portable unit: lift the bundle into another factory and it boots there.
The factory itself is word-agnostic machinery (parser, fold, chain, dispatch, stamper, the
operations Map in `ibp/operations.js`, the roleWordRegistry bridge) and holds no words — delete
this store and the factory still boots, it just starts nothing.

Two physical shapes in `store/words/`:
- **a flat `<name>.word`** — a CONCEPT: a pure declaration, no per-word code, grounds in the generic engine.
- **a `<dir>/` bundle** — an IMPLEMENTATION: the `.word` plus its handler(s), self-contained and portable. It registers its op + word at module load; services.js or genesis.js side-effect-imports it at boot.

---

## Concepts — the vocabulary (flat `store/words/*.word`, no per-word code)

| word | is | grounds in (engine) |
|------|----|----|
| word | the root: word, verb, act (present), fact (past) | read first at boot |
| base | One, order, head, content, hash | the irreducible floor |
| chain | a sealed order of acts/facts (head + hash) | past/reel/ |
| fold | a chain made present (the cache) | present/stamper/2-fold/foldEngine.js |
| weave | the chains a being sees in one moment | present/stamper/2-fold/weave.js |
| history | a branch point in chains | materials/history/ |
| story | all of a story's histories, sealed | storyIdentity.js, past/fact/chainRoots.js |
| iam | the self-existing sayer | storyIdentity.js (storyId = I_AM's key) |
| name | the identity, signs, lineage from I_AM | ibp/verbs/name.js, materials/name/name.js |
| being | a presence a Name acts through | materials/being/being.js (schema) |
| space | a place where things stand | materials/space/ |
| matter | a thing in a space, of a type | materials/matter/matter.js (schema) |
| can | the grant of a word to a being | wordStore.js (getWord) |
| role | a composite word (a can of words) | present/roles/ |
| roleflow | a conditional being-quality folding to a role | present/roles/roleFlow.js |
| see | read-only perception of the present fold | ibp/verbs/see.js |
| do | change the world (make/give/take/set/move/grant/drop) | ibp/verbs/do.js + stamper |
| be | the closed six-op set | ibp/verbs/be.js, beOps.js, cherub/role.js |
| call | a do that wakes a being | ibp/verbs/call.js |
| recall | read the past as see reads the present | the fold/reel engine |
| (verbs) | the verb schema + irregular pasts | folded by wordFold.js |

## Implementation bundles — `store/words/<dir>/` (the .word + its handler, portable)

Extracted out of materials/ and roles/ into self-contained bundles. **Boot-verified 2026-06-19**:
fresh wipe + boot registers all 12 ops, declares the 20 concepts, genesis clean, server up, no errors.

| bundle | words / ops | handler files | boot seam |
|------|----|----|----|
| key/ | name:key-export | keyOps.js + keyHost.js | services.js |
| set-render/ | render:set-render | setRender.js + setRenderHost.js | services.js |
| portal/ | portal:form-portal | portalOp.js + portalHost.js | services.js |
| move/ | move:move | moveOp.js + moveHost.js | services.js |
| grant-role/ | being:grant-role | index.js + grantHost.js (carved from being/ops.js) | services.js |
| credential/ | credential:attach/detach/read/reset | credentialOps.js + credentialHost.js | services.js |
| branch-pointers/ | branch-manager:set-pointer + delete-pointer | index.js + branchManagerHost.js (carved from branch-manager/ops.js) | genesis.js |
| set-world-signal/ | role-manager:set-world-signal | index.js (carved from role-manager/ops.js; role-managerHost.js absorbed) | genesis.js |

## Stay co-located (not extracted — flagged)

| word | where | why it stays |
|------|----|----|
| matter:create-matter | materials/matter/ | cut unwired (handler is pure JS); shares `assertMatterCoordInBounds` with set-matter; ops.js co-owns 4 non-word siblings |
| acquisition (ask-role / take-role) | present/roles/ | `emitInternalGrant` is shared with the core SEE verb (see.js); refactor that to a shared module first |
| cherub (birth / connect) | present/roles/cherub/ | frozen into the `cherubBeOps`/BE_OPS object; the .word is control-strand only; the ONLY word hardcoded in roleWordRegistry's built-in map. Whole-dir move only, separate session |
| set-model (model.word) | materials/ | unwired cut: model.word is dormant (no registerRoleWord), handler is pure JS. Relocating is inert; wiring the cut is a separate CONVERTING decision |

## Demo / narrative programs (present/word/, NOT vocabulary)

genesis.word, harmony.word, sun.word, being.word, give.word, matter.word, space.word + the 3 .ir.js
+ the *-demo.js runners are teaching scaffolding, not boot vocabulary. They must NOT land in
store/words (being/matter/space would shadow the concept words). Recommended relocation:
`present/word/examples/` (whole-dir; the parser/evaluator engine stays). Pending Tabor's call.

## CAS — content-addressed, no source

| asset | is |
|-------|----|
| .story/story.id | the storyId (I_AM's ed25519 key id) |
| .story/story.key | the I_AM private key (PKCS8 PEM) — root of trust |
| .story/story.key.pub | the I_AM public key (SPKI PEM) |

## Data, pending a .word — named-data still as .js

- materials/being/seedBeings.js, materials/being/seedDelegates.js (hybrid: roster + bootstrap fns)
- materials/matter/types.js
- materials/space/heavenSpaces.js
