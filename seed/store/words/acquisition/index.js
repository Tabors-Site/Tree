// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// store/words/acquisition/index.js — DO ops for acquiring ables. Both WORD-SOLE (handler-less).
//
// Per seed/AblesAreAuth.md, every able declares an `acquisition` block that says HOW other
// beings can come to hold it. The two caller-facing ops here let a being initiate that intake:
//
//   ask-able   — ask the able's host for the able. Resolution depends on the able's
//                `acquisition.asked` policy:
//                  "auto"  → grant immediately
//                  "queue" → summon the able's host owner with intent "able-request"
//                            (manual approval by owner)
//                  false   → refuse (not ask-acquirable)
//
//   take-able  — walk in and take the able. Resolution depends on `acquisition.grabbed`:
//                  true  → grant immediately
//                  false → refuse (not take-acquirable)
//
// Both ops target the SPACE hosting the able. The grant lands on the caller's being projection,
// folded from the op's own do:ask-able / do:take-able fact (applyAbleGrants reads the grant
// record off it). The caller's authority to acquire flows FROM the able's acquisition policy
// itself, not from any canDo they hold — the policy IS the gate.
//
// WORD-SOLE (handler-less, Tabor's no-mirror law): neither op has a JS handler. Each op's world
// strand is its co-located `.word` — the ONLY path. Each registers a `word` descriptor
// ({ noun:"being", able:"acquisition", idFrom:"granteeBeingId" }) + the shared `hostEnv`
// (acquisitionHostEnv); do.js's generic runOpWord resolves the word, runs it in the op's ONE
// moment with the STANDARD trigger { target, targetId, params, caller, branch }, and promotes the
// word-authored `factParams` + the grantee-being target (via idFrom) through stampsWordFact, so
// the dispatcher's ONE auto-Fact stamps the caller-attributed fact. No adapter, no JS body — this
// file is registration only.
//
//   take-able runs CALLER-mode (the taker IS the actor).
//
//   ask-able additionally declares `through: true` — HOST-FACILITATED. Its queue path `call`s the
//   able's host owner, and a fresh asker holds no able permitting a summon (it would be correctly
//   denied). word.through runs the `.word` THROUGH the caller (being-mode, identity name = i-am),
//   so the call authorizes as I, FROM i-am, the asker riding in the inbox CONTENT. The op's OWN
//   auth (doVerb authorize) and the do:ask-able attribution still use the real caller — only the
//   `.word`'s internal acts run privileged. (This is the two-actor split — caller-attributed fact
//   vs i-am owner summon — expressed in one word.)
//
// The acquisition lookups (the able spec, the take/asked policies, the already-holds read), the
// grant-record BUILD (grant-internal — a pure compute, NO fact), and the queue-path owner read
// live in acquisitionHost.js as the `see` escapes the `.word`s reach. None lays a fact.

import { registerOperation } from "../../../ibp/operations.js";
import { registerAbleWord } from "../../../present/word/ableWordRegistry.js";
import { acquisitionHostEnv } from "./acquisitionHost.js";

// Self-register this bundle's co-located WORLD strands (CONVERTING.md): the bridge resolves
// ("acquisition", "take-able") / ("acquisition", "ask-able") to their .word. Registered at load.
registerAbleWord("acquisition", "take-able", new URL("./take-able.word", import.meta.url));
registerAbleWord("acquisition", "ask-able", new URL("./ask-able.word", import.meta.url));

// ──────────────────────────────────────────────────────────────────
// ask-able — WORD-SOURCED, no handler. do.js routes through runOpWord with through:true
// (being-mode — the queue summon authorizes FROM i-am). Stamps the one caller-attributed
// do:ask-able fact, target forced to the GRANTEE being via idFrom. The auto path's factParams
// carries the grant record (applyAbleGrants folds the able grant from the ask); the
// queue/already/no-owner paths' factParams carries just the outcome (no grantedBy → nothing
// folds). The queue path's owner notification is the `.word`'s `call` (its own summon fact).
// ──────────────────────────────────────────────────────────────────

registerOperation("ask-able", {
  targets: ["space"],
  ownerExtension: "seed",
  factAction: "ask-able",
  args: {
    able: { type: "text", label: "Able to ask for", required: true },
  },
  word: { noun: "being", able: "acquisition", idFrom: "granteeBeingId", through: true },
  hostEnv: acquisitionHostEnv,
});

// ──────────────────────────────────────────────────────────────────
// take-able — WORD-SOURCED, no handler. do.js routes through runOpWord (CALLER mode): runs
// take-able.word and stamps the one caller-attributed do:take-able fact, target forced to the
// GRANTEE being (the taker) via idFrom. The grab path's factParams carries the grant record
// (applyAbleGrants folds the able grant from the take); the idempotent path's factParams carries
// just the outcome (no grantedBy → nothing folds).
// ──────────────────────────────────────────────────────────────────

registerOperation("take-able", {
  targets: ["space"],
  ownerExtension: "seed",
  factAction: "take-able",
  args: {
    able: { type: "text", label: "Able to take", required: true },
  },
  word: { noun: "being", able: "acquisition", idFrom: "granteeBeingId" },
  hostEnv: acquisitionHostEnv,
});
