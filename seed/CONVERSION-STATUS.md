# TreeOS JS → Rust conversion status

A folder-by-folder map of the `seed/` + `protocols/` JavaScript and where it landed in Rust — which
crate it became, or whether it's **DEAD** (retired / collapsed / replaced, never ported on purpose).

The doctrine driving the "dead" column: the six wire verbs **collapse to two primitives** (`moment` +
`act`), the transport becomes the binary's own zero-dep WS server, output is always a **Word** (no JSON
envelopes), and runtime/Node infrastructure (express, socket.io, mcp, winston logging, migrations) is
reimplemented by the `treeos` binary rather than ported line-for-line.

---

## The Rust crates (the spine, bottom-up, then the layers)

| Crate | Ports (JS source) | Role |
|---|---|---|
| **treehash** | `past/fact/hash.js`, `past/act/actHash.js` | Tier 1: canonical JSON + SHA-256 (content id). Zero-dep. |
| **treefold** | `materials/*/reducer.js` + `reducerHelpers.js` | Tier 2: per-kind fold reducers (being/space/matter/name/library) + the fold loop. |
| **treeverify** | `past/fact/verifyReel.js` | Tier 3: re-hash + walk p-links (chain verification). |
| **treestore** | `past/fileStore.js`, `past/reel/*`, `past/act/actChain.js` | Tier 4: append-only reels + the stamp (act→fact) + the ord. |
| **treecas** | `materials/matter/contentStore.js` | content-byte store (sha256-sharded). |
| **treesign** | `materials/name/{keys,credentials,passwordKey,mnemonic}.js`, `past/act/actSig.js` | ALL crypto: ed25519, BIP39, password-lock (scrypt+AES), credential AES/scrypt, HS256 JWT, PKCS8 PEM↔seed, act-sig. |
| **treeword** | `present/word/parser.js` | Word text → IR (the parser). + the **renderer** (IR → Word, the inverse). |
| **treeval** | `present/word/evaluator.js`, `cond.js` | rasterize: act IR → fact spec; the cond evaluator; able-walk; auth. |
| **treewordfold** | `present/word/wordStore.js` | the word-fold (declare-word facts → the live op/type/able set). |
| **treeibp** | `ibp/*` (the verb layer) → the **2-primitive collapse** | `moment` (perceive) + `act` (one Word); run_body_host + the see-op resolver seam. |
| **treehost** | the `materials/**/*Host.js` resolver bodies | the host SEE-OP bridge (`see resolve-X` → native validation + fact spec). |
| **treegenesis** | `seedStory/genesis.js` | the genesis planter (the parentless root birth). |
| **treeproj** | `past/fileStore.js` loadSnapshot/saveSnapshot | the `.proj` snapshot cache (read side). |
| **treesecondary** | `present/intake/inbox.js`, threads, `materials/being/position.js` | cross-cutting projections (inbox / threads / position), pure fold. |
| **treecognition** | `present/cognition/**` | the THINKING: scripted + LLM deciders, prompt, chain, SSRF, failover, transport. |
| **treeaddress** | `ibp/address.js`, `materials/history/historyPath.js` | the IBP Address grammar + history-path arithmetic. |
| **treeprotocol** | `ibp/protocol.js`, `materials/redact.js` | the error taxonomy + envelopes + secret redaction. |
| **treematter** | `materials/matter/classify.js` + `types.js` (seed types) | matter type classification (pure scoring). |
| **treebook** | `store/book/*`, `present/book/*` | the guarded book-reader (sequential `.word` → acts). |
| **treeos** | the BINARY | boots/serves; the moment/act/cognize wire over WS; the act + config edge. |
| **treehash-node** | (FFI) | napi wrapper so JS can delegate to treehash during migration. |

---

## seed/ — folder by folder

### `seed/ibp/` — the wire verb layer
| File | → | Status |
|---|---|---|
| `address.js` | **treeaddress** | ported (the grammar). |
| `protocol.js` | **treeprotocol** | ported (IBP_ERR + httpStatusFor + envelopes). |
| `operations.js`, `descriptor.js`, `resolver.js` | treeibp + treewordfold | the op registry is the word-fold now. |
| `verbs/{do,see,call,be,type}.js`, `factResult.js`, `nameOps/beOps/seeOps.js` | **DEAD** | the six-verb dispatch **collapsed to moment/act** (treeibp). |

### `seed/materials/` — the five materials
| File group | → | Status |
|---|---|---|
| `*/reducer.js`, `reducerHelpers.js` | **treefold** | ported (the fold). |
| `*/​*Host.js` (set-being/set-space/create/end/matter/move/rename/purge/owner/grant/inheritation/cherub…) | **treehost** | ported as native resolvers (his lane). |
| `being/identity/birth.js` (validate+spec) | **treehost** `resolve_birth_being` | ported. |
| `name/{keys,credentials,passwordKey,mnemonic}.js` | **treesign** | crypto floor ported (byte-compatible). |
| `matter/classify.js` + `types.js` | **treematter** | ported (kernel seed types; ext types via word-fold). |
| `matter/contentStore.js` | **treecas** | ported. |
| `history/historyPath.js` | **treeaddress::history** | ported (branch arithmetic). |
| `library/reducer.js` | **treefold** `reduce_library` | ported (config + names catalog). |
| `redact.js` | **treeprotocol::redact** | ported (secret stripping). |
| `being/position.js` | **treesecondary** | ported (position fold). |
| `matter/casSweep.js`, `history/histories.js` (registry), `name/login.js` (session) | (deferred) | I/O orchestration over the projection lane; resolver halves are in treehost. |

### `seed/past/` — the chain
| File | → | Status |
|---|---|---|
| `fact/hash.js`, `act/actHash.js` | **treehash** | ported. |
| `fileStore.js`, `reel/*` | **treestore** | ported (reels + stamp + ord). |
| `fact/verifyReel.js` | **treeverify** | ported. |
| `act/actSig.js` | **treesign** | ported. |
| `act/actChain.js` | **treestore** (moment-seal) | the act-chain head/CAS is the moment-seal. |
| `projections/*` | **treeproj** + **treesecondary** | ported (snapshots + cross-cutting). |

### `seed/present/` — the runtime
| Folder | → | Status |
|---|---|---|
| `word/parser.js` | **treeword** | ported (+ the renderer, the inverse). |
| `word/evaluator.js`, `cond.js` | **treeval** | ported (rasterize + cond). |
| `word/wordStore.js` | **treewordfold** | ported (the word-fold). |
| `cognition/**` | **treecognition** | ported (deciders + boundary + loop). |
| `cognition/**` JSON tool-call envelope | **DEAD** | output is a Word now, not a JSON tool_call. |
| `book/*` | **treebook** | ported (the book reader). |
| `intake/inbox.js`, threads | **treesecondary** | ported (the fold). |
| `intake/scheduler.js`, `stamper/{1-assign,3-momentum,4-stamped}.js`, `2-fold/*` | (runtime) | the present-loop orchestration: fold=treefold, momentum=treecognition, seal=treeibp; the async loop itself is the binary's wiring (in progress). |
| `ables/registry.js`, `flow.js`, `capabilities.js` | treeibp `fold_able_noun` + treehost `able_manager` | the able spec folds; the registry is the word-fold. |
| `wakes/*` | (runtime) | trigger scheduling — not ported (Node event loop). |

### `seed/seedStory/` — boot infra
| File | → | Status |
|---|---|---|
| `genesis.js` | **treegenesis** | ported. |
| `log.js`, `dbConfig.js`, `indexes.js`, `migrations/*` | **DEAD** | Node infra (winston/sqlite/migrations); the `treeos` binary boots from scratch. |

### `seed/store/` — the vocabulary + books
| | → | Status |
|---|---|---|
| `store/words/**/*.word`, `store/book/*` | DATA (read by the binary) | the `.word` vocabulary + books are read by treeibp/treebook, not "ported". |

---

## protocols/ — the wire

| Folder | → | Status |
|---|---|---|
| `ibp/protocol.js` (dispatchIbp), `verbs/*`, `envelope.js` | **DEAD / collapsed** | the verb dispatch → moment/act; envelope parse ≈ treeaddress; the wire is `treeos/src/ibp.rs` (moment/act over WS). |
| `ibp/{canopy,peers,secureChannel,federation}.js` | (deferred) | cross-story federation membrane (the other agent's surface). |
| `transports/http/**` (express app, middleware, auth) | **DEAD** | treeos has its own zero-dep HTTP server. |
| `transports/ws/**` (socket.io) | **DEAD** | treeos has its own zero-dep WS server (moment/act). |
| `transports/mcp/**` | **DEAD** | retired by decision (mcp can die). |

---

## Summary

- **Spine (1–4): fully ported** — treehash, treefold, treeverify, treestore, treecas.
- **Crypto: fully ported** — treesign (ed25519, BIP39, password-lock, credential, JWT, PEM↔seed), all byte-compatible with the JS, cross-checked.
- **Word engine: ported** — treeword (parse + render), treeval (rasterize + cond), treewordfold.
- **IBP: collapsed to moment/act** — treeibp; the six-verb dispatch + the transports are DEAD.
- **Materials host reads: ported** — treehost (the `*Host.js` resolver bodies), driven live from the binary via `run_op_word`.
- **Cognition: ported + running** — treecognition (scripted/llm/default), over WS.
- **Projections: ported** — treeproj (snapshots) + treesecondary (inbox/threads/position).
- **Wire: the two primitives over WebSocket** — `treeos/src/ibp.rs`, no REST, secrets redacted.

**Still in flight:** the present-loop runtime (wake → cognize → act async orchestration), the LLM/session/federation/pointer host see-ops (the membrane), the matter-type extension fold, and HTTPS for cloud LLMs. **Dead by design:** the six verbs, the JSON envelope, express/socket.io/mcp transports, and the Node boot infra.
