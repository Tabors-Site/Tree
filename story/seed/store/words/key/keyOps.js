// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// key/keyOps.js — key custody DO ops that belong to the NAME.
//
// A being never holds a signing key after the split — the key lives on
// the Name the being expresses (Name.privateKeyEnc, did:key z-id). So
// "back up your key" / "take your identity elsewhere" is a NAME concern,
// not a being one. This file owns it.
//
//   key-export   return the Name's PRIVATE KEY (decrypted PEM) + its
//                24-word paper form to whoever is acting AS that Name.
//                The wallet "back up / exit" path. The key never leaves
//                the story except through this explicit, auth-gated,
//                owner-initiated op: it is redacted from every descriptor,
//                fact, and bundle, and never the JWT. Returned only on the
//                direct DO response channel.
//
// Target: a being (target.kind:"being") whose trueName resolves the Name
// — the portal calls it at the self stance. (DO targets a world object; a
// being is how you reach the Name it expresses. NAME is a separate verb
// layer with no DO-target kind.) The export is of the resolved NAME's key,
// and the gate is "you are acting AS that Name" (your session's nameId ===
// the resolved nameId). Driving a being you do NOT own (a father
// inhabiting a mother's being) does NOT let you export the owner's key:
// the gate compares the resolved Name, not the being you drive.
//
// WORD-SOLE (handler-less, Tabor's no-mirror law): key-export has NO JS handler. Its world
// strand is key.word — the ONLY path. This file registers a `word` descriptor
// ({ noun:"being", idFrom:"askerBeingId" }) + its `hostEnv` (keyHostEnv); do.js's generic
// runOpWord resolves key.word (via resolveAbleWord(noun, opName) — so the able key IS the
// noun), runs it with the standard trigger { target, targetKind, params, caller, branch }, and
// promotes the word-authored fact via stampsWordFact. There is no `_keyExportViaWord` adapter
// and no JS body — this file is registration only.
//
// THE NOUN is "being" — the kind of reel the audit fact lands on (the ASKER's being), the SAME
// role create-matter's noun:"matter" plays (the created matter's reel). runOpWord resolves the
// word under that noun, and stampsWordFact tags the fact target { kind:"being", id } from it; the
// asker-being id is the returned `askerBeingId` (= $caller = identity.beingId), read via idFrom.
// (key-export is a NAME-layer op, so its verb HOME is also registered under able "name" below —
// a second facet of the same word, the one the portal/bridge resolves it by — while the fact it
// lays targets a BEING; the two ables name those two facets.)
//
// The DOUBLE GATE (the I hard-refusal then the ownership gate against the connected Name) and
// the §7 reveal live in key.word; the crypto reads (load-key / paper-form) and the connected-
// Name read (resolve-name-id → ctx.identity.nameId, the SAME server ground truth the JS gate's
// `identity.nameId` read) are the see-op floor wired by keyHost.js. The audit fact lands on the
// ASKER's being, params {exportedNameId} only; the privateKeyPem/mnemonic ride the RETURN to the
// asker but stripForAudit drops them from the recorded result, so the durable fact never holds
// the key.

import { registerOperation } from "../../../ibp/operations.js";
import { registerAbleWord } from "../../../present/word/ableWordRegistry.js";
import { keyHostEnv } from "./keyHost.js";

// Self-register this slice's co-located WORLD strand (CONVERTING.md): key.word is the SOLE
// implementation, its see-op floor wired by keyHost.js. Registered at module load (services.js
// imports this file), so the `.word` is available wherever a booted story exists. TWO facets,
// one word: under able "being" (the noun runOpWord resolves the op-word by, and the kind of reel
// the audit fact lands on) and under able "name" (key-export's verb HOME — the key is a NAME
// concern — the key the portal/bridge resolves it by). Same file, both keys point at key.word.
const KEY_WORD = new URL("./key.word", import.meta.url);
registerAbleWord("being", "key-export", KEY_WORD);
registerAbleWord("name", "key-export", KEY_WORD);

// WORD-SOURCED registration — no handler. do.js routes this through runOpWord, which runs
// key.word (CALLER mode: no `through`, the export attributes to the asker) and stamps the one
// caller-attributed do:key-export audit, target forced to the ASKER's being via idFrom.
registerOperation("key-export", {
  targets: ["being"],
  ownerExtension: "seed",
  factAction: "key-export",
  word: { noun: "being", idFrom: "askerBeingId" },
  hostEnv: keyHostEnv,
});
