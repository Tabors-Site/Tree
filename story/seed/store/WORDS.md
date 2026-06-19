# Store words — the canonical word ↔ code map

Every word the seed declares, paired with its code (its connecter) if it has any.
A word plus its logic is meant to be a portable unit: lift it and its code into another
factory and it boots there. The factory itself is word-agnostic machinery (parser, fold,
chain, dispatch, stamper) and holds no words — delete this store and the factory still boots,
it just starts nothing.

Kinds:
- **concept** — a declaration that folds to a declare-word fact; its connecter is the generic engine, no per-word code.
- **word + code** — a .word that runs, paired with the handler(s) that implement it.
- **cas** — content-addressed material (no source text).
- **data (pending .word)** — named-data still as a .js, to be written as a .word.

---

## Concepts — the vocabulary (in `store/words/`, no per-word code)

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

## Words + code — the .word and the handler it runs (paired, co-located today)

| word | code (connecter) |
|------|----|
| materials/being/credential-attach.word | credentialHost.js + credentialOps.js |
| materials/being/credential-detach.word | credentialOps.js |
| materials/being/credential-read.word | credentialOps.js + credentialHost.js (decrypt) |
| materials/being/credential-reset.word | credentialOps.js (pure-word, no host escape) |
| materials/being/grant-role.word | grantHost.js + ops.js (grantRoleHandler) |
| materials/matter/matter.word | matterHost.js + ops.js (createMatterHandler) |
| materials/model.word | the set-model handler |
| materials/move.word | moveOp.js + moveHost.js |
| materials/name/key.word | keyHost.js + keyOps.js (key-export) |
| materials/portal.word | portalHost.js + portalOp.js (form-portal) |
| ibp/set-render.word | setRender.js + setRenderHost.js |
| present/roles/ask-role.word | acquisitionOps.js (_askRoleViaWord) |
| present/roles/take-role.word | acquisitionOps.js (_takeRoleViaWord) |
| present/roles/cherub/cherub.word | cherub/role.js (birthHandler) |
| present/roles/cherub/cherub-connect.word | connectHost.js + cherub/role.js (connectHandler) |
| present/roles/role-manager/role-manager.word | role-manager/ops.js (set-world-signal) |
| present/roles/branch-manager/branch-manager.word | branch-manager/ops.js (set-pointer) |
| present/roles/branch-manager/delete-pointer.word | branch-manager/ops.js (delete-pointer) |
| present/word/genesis.word | parser.js + evaluator.js (the creation narrative) |
| present/word/cherub-birth.ir.js | evaluator.js (Word IR, five birth facts) |
| present/word/harmony.ir.js | evaluator.js (Word IR, music-room flows) |
| present/word/sun.ir.js | evaluator.js (Word IR, day/night machine) |

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

---

NOTE (move state): the 20 concepts + verbs.word have moved into `store/words/`. The words-with-code
still sit beside their handlers in their materials/roles dirs (paired by proximity); bundling each
into `store/words/<word>/` with its handler is the deeper portability step, done incrementally so
the shared ops.js handlers can be decoupled from the generic engine without breaking the boot.
