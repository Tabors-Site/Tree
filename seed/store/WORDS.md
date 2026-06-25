# Store words — the canonical word ↔ code map

Every word the seed declares, paired with its code (its connecter) if it has any.
A word plus its logic is a portable unit: lift the bundle into another factory and it boots there.
The factory itself is word-agnostic machinery (parser, fold, chain, dispatch, stamper, the
operations Map in `ibp/operations.js`, the ableWordRegistry bridge, the BE_OPS table) and holds no
words — **the engine now holds zero built-in words** (cherub was the last hardcoded one; it
self-registers). Delete this store and the factory still boots; it just starts nothing.

Two physical shapes in `store/words/`:

- **a flat `<name>.word`** — a CONCEPT: a pure declaration, no per-word code, grounds in the generic engine.
- **a `<dir>/` bundle** — an IMPLEMENTATION: the `.word` plus its handler(s), self-contained and portable. It registers its op + word at module load; services.js or genesis.js side-effect-imports it at boot.

---

## Concepts — the vocabulary (flat `store/words/*.word`, no per-word code)

| word    | is                                                    | grounds in (engine)                                   |
| ------- | ----------------------------------------------------- | ----------------------------------------------------- |
| word    | the root: word, verb, act (present), fact (past)      | read first at boot                                    |
| base    | One, order, head, content, hash                       | the irreducible floor                                 |
| chain   | a sealed order of acts/facts (head + hash)            | past/reel/                                            |
| fold    | a chain made present (the cache)                      | present/stamper/2-fold/foldEngine.js                  |
| weave   | the chains a being sees in one moment                 | present/stamper/2-fold/weave.js                       |
| history | a branch point in chains                              | materials/history/                                    |
| story   | all of a story's histories, sealed                    | storyIdentity.js, past/fact/chainRoots.js             |
| iam     | the self-existing sayer                               | storyIdentity.js (storyId = I's key)                  |
| name    | the identity, signs, lineage from I                   | ibp/verbs/name.js, materials/name/name.js             |
| being   | a presence a Name acts through                        | materials/being/being.js (schema)                     |
| space   | a place where things stand                            | materials/space/                                      |
| matter  | a thing in a space, of a type                         | materials/matter/matter.js (schema)                   |
| can     | the grant of a word to a being                        | wordStore.js (getWord)                                |
| able    | a composite word (a can of words)                     | present/ables/                                        |
| flow    | a conditional being-quality folding to a able         | present/ables/flow.js                                 |
| see     | read-only perception of the present fold              | ibp/verbs/see.js                                      |
| do      | change the world (make/give/take/set/move/grant/drop) | ibp/verbs/do.js + stamper                             |
| be      | the closed six-op set                                 | ibp/verbs/be.js, beOps.js, store/words/cherub/able.js |
| call    | a do that wakes a being                               | ibp/verbs/call.js                                     |
| recall  | read the past as see reads the present                | the fold/reel engine                                  |
| (verbs) | the verb schema + irregular pasts                     | folded by wordFold.js                                 |

## Implementation bundles — `store/words/<dir>/` (the .word + its handler, portable)

**All 12 implementation words extracted. Boot-verified 2026-06-19** (fresh wipe + boot: 20 ops
register, 20 concepts declared, genesis births through cherub:birth — `[Story] I am born.` — server
up, zero errors).

| bundle            | words / ops                                  | handler files                                                         | boot seam              |
| ----------------- | -------------------------------------------- | --------------------------------------------------------------------- | ---------------------- |
| key/              | name:key-export                              | keyOps.js + keyHost.js                                                | services.js            |
| set-render/       | render:set-render                            | setRender.js + setRenderHost.js                                       | services.js            |
| portal/           | portal:form-portal                           | portalOp.js + portalHost.js                                           | services.js            |
| move/             | move:move                                    | moveOp.js + moveHost.js                                               | services.js            |
| grant-able/       | being:grant-able                             | index.js + grantHost.js (carved from being/ops.js)                    | services.js            |
| credential/       | credential:attach/detach/read/reset          | credentialOps.js + credentialHost.js                                  | services.js            |
| history-pointers/ | history-manager:set-pointer + delete-pointer | index.js + historyManagerHost.js (carved from history-manager/ops.js) | genesis.js             |
| set-world-signal/ | able-manager:set-world-signal                | index.js (carved from able-manager/ops.js)                            | genesis.js             |
| model/            | render:set-model _(inert)_                   | index.js [moved modelOp.js] + model.word                              | services.js            |
| create-matter/    | matter:create-matter                         | index.js + matterHost.js (carved from matter/ops.js)                  | services.js            |
| acquisition/      | acquisition:ask-able + take-able             | index.js + acquisitionHost.js (carved from acquisitionOps.js)         | services.js            |
| cherub/           | cherub:birth + connect (BE ops)              | able.js + connectHost.js (whole dir; cherubBeOps feeds BE_OPS)        | services.js + beOps.js |

_(inert)_ = the .word is registered + declared + resolvable, but the JS handler still drives (the
cut was never wired). **Wired** words run the .word through the bridge with the JS body as a
clean-miss fallback: key, grant-able, credential, history-pointers, set-world-signal, acquisition,
cherub, and **create-matter** (wired + harness-verified 2026-06-19, verify-creatematter-cut 6/0).
**Still inert:** set-model (wiring needs a from-scratch modelHost) and move/portal/set-render (the
older inert moves).

## Able bundles — `store/words/<able>/` (the whole able: definition + its ops + host)

The factory holds zero words, and a able IS a word (`kind:"ableword"`, name = `able:op`), so a
code-bearing able belongs in the word package, not in `present/` (the engine). The three ables that
carry `.word` files moved here 2026-06-25, one at a time, boot-verified after each (genesis creates
all three from their new home, the conversion board holds at 54 word-SOLE, verify-move-cut 16/0,
verify-assigner-delegators-cut 6/0). The able MACHINERY stays factory: `present/ables/` keeps
ableComposer, registry, flow, capabilities, host, spaceLookup, seedResolvers, canStarResolver,
internalGrant, acquisition.

| bundle              | words / ops                                                                | files                                                                          | boot seam  |
| ------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------ | ---------- |
| federation-manager/ | offer-template, offer-being, request-template, accept/reject-template, fulfill/refuse-request (7) | able.js, ops.js, handlers.js, federationManagerHost.js, 7 `.word`              | genesis.js |
| llm-assigner/       | add-llm, assign-slot, delete-llm, set-being/space/story-llm (6)             | able.js, ops.js, llmAssignerHost.js, 6 `.word`                                 | genesis.js |
| able-manager/       | set-able, delete-able, set-being-flow (3)                                   | able.js, ops.js, flowOp.js, ableManagerHost.js, setBeingFlowHost.js, 3 `.word` | genesis.js |

able-manager's set-world-signal was already carved out separately (the implementation-bundle table
above). The pure able-SPECS (angel, human, scribe, arrival, birther, global, public, story-manager,
flow-composer) and the op-ables not yet word-converted (history-manager, http-server, merge-mediator,
websocket-pool) still live in `present/ables/`; they follow once converted, or when the home for a
spec-only able is decided (it mirrors as a space, not an op bundle).

## Shared-module lifts (the untangles that unblocked the carves)

- **materials/matter/coordBounds.js** — `COORD_AXES` + `assertMatterCoordInBounds`, the single canonical body (it had been verbatim-duplicated in matter/ops.js AND matterHost.js). Imported by the kept matter/ops.js (set-matter) and the create-matter bundle. Killed the duplicate.
- **present/ables/internalGrant.js** — `emitInternalGrant`, the pure grant-emit primitive lifted out of acquisitionOps.js. Imported by the **core SEE verb** (see.js, auto-on-entry grant) and the acquisition bundle. This lift is what let SEE stop reaching into a word bundle — the whole reason acquisition could move.

## Stay co-located — NONE

All implementation words have been extracted. The ableWordRegistry engine holds zero built-in words.
Remaining flagged follow-ups (not extractions): wiring the two inert cuts (set-model, create-matter)
live would each need a from-scratch host design (model.word references host fns that don't exist;
create-matter's matterHost exists but the bridge was never wired) — a separate CONVERTING pass.

## Demo / narrative programs — relocated to `present/word/examples/`

genesis/harmony/sun/being/give/matter/space .word + the 3 .ir.js + the \*-demo.js runners are teaching
scaffolding (not vocabulary), moved whole to `present/word/examples/` (slated for eventual deletion).
The parser/evaluator engine stays in present/word/.

## CAS — content-addressed, no source

| asset                | is                                            |
| -------------------- | --------------------------------------------- |
| .story/story.id      | the storyId (I's ed25519 key id)              |
| .story/story.key     | the I private key (PKCS8 PEM) — root of trust |
| .story/story.key.pub | the I public key (SPKI PEM)                   |

## Data, pending a .word — named-data still as .js

- materials/being/seedBeings.js, materials/being/seedDelegates.js (hybrid: roster + bootstrap fns)
- materials/matter/types.js
- materials/space/heavenSpaces.js
