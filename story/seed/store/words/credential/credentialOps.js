// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// being/credentialOps.js — the four DO ops that touch a being's credential:
//
//   credential-read    return the auto-generated plaintext (decrypted).
//                      Returns null if the password was caller-chosen
//                      (no plain was stored) or if the asker has no
//                      authority.
//   credential-reset   re-mint the credential. New plaintext is
//                      auto-generated and stored encrypted; new bcrypt
//                      hash replaces the old. Returns the new plaintext
//                      to the asker. Bumps tokensInvalidBefore so older
//                      JWTs stop verifying.
//   credential-detach  the target being declares itself independent of
//                      its summoner. Self-only. After this Fact, the
//                      summoner's reads and resets are refused until
//                      the summoner stamps a credential-attach Fact.
//   credential-attach  the summoner re-asserts authority over a being
//                      that previously detached. Symmetric only in the
//                      reverse direction.
//
// Authority is folded from the chain via hasCredentialAuthority:
//   self        -> always
//   summoner    -> until target detaches
//   anyone else -> no
//
// All four are DO ops with target.kind = "being". These self-register
// at module load. `seed/services.js` imports this file for side
// effects; the registry is populated before any caller dispatches.
//
// WORD-SOLE (handler-less, Tabor's no-mirror law; mirrors create-space/index.js,
// create-matter/index.js): each op has NO JS handler — its co-located `.word` is the ONLY
// path. The op registers a `word` descriptor ({ noun:"being", idFrom:"targetBeingId" }) +
// its `hostEnv` (credentialHostEnv); do.js's generic runOpWord resolves the `.word`, runs
// it with the STANDARD trigger { target, targetKind, params, caller, branch }, and promotes
// the word-authored fact (factParams + factTarget) via stampsWordFact. There is no
// `_xViaWord` adapter and no shadow JS body — this file is registration only, so the board
// (tallyConversion) climbs by FOUR. On a clean miss (the word gone/disabled on this history)
// the op REFUSES — there is nothing to fall back to.
//
// THE FACT TARGET (the security-critical reel). The `.word` AUTHORS factTarget per op:
//   read / reset  -> the ASKER's being (factTarget $caller): a summoner reading/resetting a
//                    child's credential is the SUMMONER's act ABOUT the child, so the audit
//                    lands on the asker's OWN reel (single-writer; doer = asker = reel-owner).
//   detach        -> the being's OWN reel (self-only ⇒ caller == the being).
//   attach        -> the CHILD's reel (factTarget $targetBeingId): an authority-fact on the
//                    target's reel, the grant-inheritation pattern — detach (child's reel)
//                    and attach sit on ONE reel so isDetachedFromBeingParent orders them by
//                    seq, never the clock. The actor (through) is still the being-parent.
// The reveal (the cleartext) rides the RETURN only; stripForAudit drops it (rule 7), so the
// durable fact records who-acted-on-whom, never the secret. factParams is empty (the audit
// records the act, not a credential payload), exactly as the deleted adapter's targetsFact
// left ctx.params ({}) the fact's params.

import { registerOperation } from "../../../ibp/operations.js";
import { registerAbleWord } from "../../../present/word/ableWordRegistry.js";
import { credentialHostEnv } from "./credentialHost.js";

// Self-register each op's co-located `.word` slice (CONVERTING.md): importing this file (at
// seed boot, or in a DRY harness) registers them into the unified word fold.
//
// TWO NOUNS, on purpose. do.js's generic runOpWord resolves the op's `.word` via
// resolveAbleWord(op.word.noun, op.name, …) AND stampsWordFact stamps the audit fact's
// of.kind from that SAME op.word.noun (factResult.js) — the two roles are coupled to one
// field. These ops' fact lands on a BEING reel (of.kind MUST be "being": isDetachedFromBeingParent
// filters on `"of.kind":"being"`, lineage.js), so op.word.noun = "being" and the `.word`
// registers under the "being" noun for do.js to find it + stamp the right kind. It ALSO
// registers under the "credential" noun — the logical able grouping ("the credential able's
// four words"), and the namespace the verify harnesses resolveAbleWord(…) under. Same file,
// two fold keys ("being:<op>" + "credential:<op>") — distinct words, no collision; both
// resolve the identical IR.
for (const op of [
  "credential-reset",
  "credential-read",
  "credential-detach",
  "credential-attach",
]) {
  const url = new URL(`./${op}.word`, import.meta.url);
  registerAbleWord("being", op, url); // do.js runOpWord resolution + the being fact-kind
  registerAbleWord("credential", op, url); // the able grouping (and the harnesses' lookup)
}

// key-export MOVED to seed/materials/name/keyOps.js. The key is a NAME
// concern post-split (a being holds no key — it expresses a trueName
// whose key signs), and the old being-targeted version read
// being.qualities.auth.privateKeyEnc, a field birth.js no longer writes,
// so it returned hasKey:false for every post-split being. The Name-owned
// op resolves the being's trueName and exports the Name's key.

// signing-unlock / signing-lock REMOVED. They were the pre-split per-BEING
// signing latch — they keyed unlockSigning/lockSigning by beingId (a content
// hash), but signing is a NAME concern: the signing session is nameId-keyed
// and loadSigningKey only ever reads it by nameId, so these were dead no-ops.
// The real signing latch is the NAME session: name:connect unlocks (decrypts
// the key into the session), name:release locks. In the portal that is the ONE
// top-right name lock (sign out of the name + see name/public key); a being is
// driven/dropped by be:connect / be:release, never a separate signing toggle.

// credential-read. WORD-SOURCED — credential-read.word gates (authority SEE),
// reads (read-credential host escape, decrypts the stored blob), and reveals
// (the cleartext on the return). The audit fact lands on the ASKER's reel
// (factTarget $caller), the cleartext stripped from it (rule 7).
registerOperation("credential-read", {
  targets: ["being"],
  ownerExtension: "seed",
  factAction: "credential-read",
  word: { noun: "being", idFrom: "targetBeingId" },
  hostEnv: credentialHostEnv,
});

// credential-reset. WORD-SOURCED — credential-reset.word gates (authority SEE),
// mints (mint-credential, a crypto compute SEE), lays the three native do:set-being
// re-mint writes (password + credentialPlain + tokensInvalidBefore) on the TARGET's
// reel, and reveals the new plaintext on the return. The dispatcher's audit fact lands
// on the ASKER's reel (factTarget $caller), the plaintext stripped from it (rule 7).
registerOperation("credential-reset", {
  targets: ["being"],
  ownerExtension: "seed",
  factAction: "credential-reset",
  word: { noun: "being", idFrom: "targetBeingId" },
  hostEnv: credentialHostEnv,
});

// credential-detach. WORD-SOURCED — credential-detach.word is a self-only (or I)
// gate + the §7 return, no host write. The detach RECORD is the dispatcher's audit
// fact, on the being's OWN reel (factTarget $targetBeingId); isDetachedFromBeingParent
// walks it forward in seq order.
registerOperation("credential-detach", {
  targets: ["being"],
  ownerExtension: "seed",
  factAction: "credential-detach",
  word: { noun: "being", idFrom: "targetBeingId" },
  hostEnv: credentialHostEnv,
});

// credential-attach. WORD-SOURCED — credential-attach.word is a being-parent-only
// (or I) gate (find-being-parent host walk + the equality) + the §7 return. THE FACT
// LANDS ON THE CHILD's reel (factTarget $targetBeingId), the grant-inheritation
// pattern, so detach + attach order on ONE reel by seq. The actor (through) is the
// being-parent (the writer); the reel is the child (the subject).
registerOperation("credential-attach", {
  targets: ["being"],
  ownerExtension: "seed",
  factAction: "credential-attach",
  word: { noun: "being", idFrom: "targetBeingId" },
  hostEnv: credentialHostEnv,
});
