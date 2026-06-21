// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// name/keyOps.js — key custody DO ops that belong to the NAME.
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
// (The being-side key-export that used to live in being/credentialOps.js
// read being.qualities.auth.privateKeyEnc — a field birth.js stopped
// writing once the key moved to the Name — so it returned hasKey:false
// for every post-split being. This replaces it.)
//
// Target: a being (target.kind:"being") whose trueName resolves the Name
// — the portal calls it at the self stance. (DO targets a world object; a
// being is how you reach the Name it expresses. NAME is a separate verb
// layer with no DO-target kind.) The export is of the resolved NAME's key,
// and the gate is "you are acting AS that Name" (your session's nameId ===
// the resolved nameId). Driving a being you do NOT own (a father
// inhabiting a mother's being) does NOT let you export the owner's key:
// the gate compares the resolved Name, not the being you drive.

import { registerOperation } from "../../../ibp/operations.js";
import { laysFact } from "../../../ibp/factResult.js";
import { IBP_ERR, IbpError } from "../../../ibp/protocol.js";
import { registerRoleWord } from "../../../present/word/roleWordRegistry.js";

// Self-register this slice's co-located WORLD strand (CONVERTING.md): the bridge
// resolves ("name", "key-export") to key.word, its host escapes wired by keyHost.js.
// Registered at module load (services.js imports this file), so the `.word` is
// available wherever a booted story exists; the cut reads it via the bridge.
registerRoleWord("name", "key-export", new URL("./key.word", import.meta.url));

// Resolve the NAME id this op acts on, from the being target's trueName.
async function resolveTargetNameId(target, moment) {
  const { loadTargetRow } = await import("../../../materials/_targetShape.js");
  const beingRow = await loadTargetRow(target, "being", { moment });
  const trueName = beingRow?.trueName || null;
  if (!trueName) {
    throw new IbpError(
      IBP_ERR.INVALID_INPUT,
      "key-export: target being expresses no trueName (no Name to export)",
    );
  }
  return String(trueName);
}

// key-export's world strand is key.word (resolve the Name via `see`, the double gate,
// the crypto read, the §7 return). CALLER mode (no `through`): the audit attributes to
// the asker. The .word lays NO fact — it returns {nameId,hasKey,privateKeyPem,mnemonic};
// this cut promotes the resolved `nameId` into _factParams {exportedNameId} and forces
// _factTarget at the ASKER's being, so the dispatcher's ONE auto-Fact lays the caller-
// attributed (through = asker) do:key-export AUDIT — the SAME fact recordExport self-
// emitted, now on the one emit path, the key NOWHERE in it (stripForAudit drops the
// privateKeyPem/mnemonic reveals from the recorded result; _factParams never carries
// them). Returns the result with _factParams/_factTarget attached (hasKey coerced to a
// strict boolean — the .word's mark yields true|undefined), or null on a clean miss.
async function _keyExportViaWord({ target, caller, asker, moment }) {
  if (!moment) return null;
  const { resolveRoleWord, runRoleWord } = await import("../../../present/word/roleWordRegistry.js");
  const ir = resolveRoleWord("name", "key-export", moment?.actorAct?.history);
  if (!ir) return null;
  const { keyHostEnv } = await import("./keyHost.js");
  const { targetIdOf } = await import("../../../materials/_targetShape.js");
  const history = moment?.actorAct?.history || "0";
  try {
    const { result } = await runRoleWord(ir, {
      moment, history,
      // `target` is bound as an entity object (kind + id) so the .word's `see the
      // target's trueName` can loadProjection — seeRead needs ._id/.id, not a bare string.
      trigger: { target: { kind: "being", id: String(targetIdOf(target)) }, caller: caller ? String(caller) : null, asker: asker ? String(asker) : null, branch: history },
      env: { host: keyHostEnv() },
    });
    if (!result) return null;
    const out = { ...result, hasKey: !!result.hasKey };
    // The audit fact (do.js auto-Fact): who exported which Name's key, the key nowhere
    // in it. params = {exportedNameId}, of = the asker's being (the audit lands on the
    // asker's reel, NOT the keyholder target — resolveAuditTarget would otherwise fall
    // back to the being target). No asker → no fact (matches the old `if (askerBeingId)`).
    const askerBeingId = asker ? String(asker) : null;
    return askerBeingId && out.nameId
      ? laysFact(out, { exportedNameId: String(out.nameId) }, { kind: "being", id: askerBeingId })
      : out;
  } catch (e) {
    if (e && e.__wordRefusal) throw new IbpError(e.code || IBP_ERR.FORBIDDEN, e.message);
    throw e;
  }
}

registerOperation("key-export", {
  targets: ["being"],
  ownerExtension: "seed",
  factAction: "key-export",
  // NO skipAudit. The op no longer self-emits — it returns _factParams
  // ({exportedNameId}, the key NOWHERE in it) + _factTarget (the asker's
  // being), and the dispatcher's ONE auto-Fact path lays the caller-
  // attributed do:key-export audit. The handler RESULT carries the
  // privateKeyPem/mnemonic reveal (to the asker over the wire), but
  // stripForAudit (do.js summarizeAuditResult) drops those reveal keys
  // from the recorded result, so the durable fact never holds the key.
  handler: async ({ target, identity, moment }) => {
    // THE CONVERSION: key-export's world strand is key.word, run through the bridge.
    // The JS below is the clean-miss fallback.
    const viaWord = await _keyExportViaWord({ target, caller: identity?.nameId, asker: identity?.beingId, moment });
    if (viaWord) return viaWord;

    const history = moment?.actorAct?.history;
    const nameId = await resolveTargetNameId(target, moment);

    // NEVER export the story (I_AM) key. The I_AM "name" id is the literal
    // "i-am", and loadSigningKey maps it to the story's private key. A being
    // whose trueName resolved to i-am (e.g. a being born under i-am before it
    // was handed a sovereign name) must NOT become a door to the story key.
    // Hard refusal, before the ownership gate (which i-am===i-am would pass).
    if (nameId === "i-am" || nameId === "I_AM") {
      throw new IbpError(
        IBP_ERR.FORBIDDEN,
        "key-export: the story (I_AM) key is never exportable through a being.",
        { nameId },
      );
    }

    // Ownership gate: you may export only the key of a Name you are
    // currently acting AS. socket.nameId rides identity.nameId (server
    // ground truth, never client payload), so this is the same proof the
    // signing session is keyed by — no separate authority axis. (Do NOT
    // use the being-tree's hasCredentialAuthority here; that gates
    // inhabitation of a being's password, the wrong axis for a Name key.)
    const callerNameId = identity?.nameId ? String(identity.nameId) : null;
    if (!callerNameId || callerNameId !== nameId) {
      throw new IbpError(
        IBP_ERR.FORBIDDEN,
        "key-export: you can export only the key of the Name you are connected as",
        { callerNameId, nameId },
      );
    }

    // The authoritative key reader: i-am -> story key; password-locked
    // Name -> the in-session PEM (null if not connected); system-encrypted
    // -> decrypt. Mirrors how the seal signs (actSig.loadSigningKey), so
    // export reflects exactly the key that signs.
    const { loadSigningKey } = await import("../../../past/act/actSig.js");
    const privateKeyPem = await loadSigningKey(nameId, history);

    // Paper form: the key's 32-byte seed as 24 BIP39 words. Same key,
    // writable by hand; the keypair rebuilds from either skin. Null when
    // the key shape can't yield a seed.
    let mnemonic = null;
    if (privateKeyPem) {
      try {
        const { seedFromPrivateKeyPem } = await import("../../../materials/name/keys.js");
        const { entropyToMnemonic } = await import("../../../materials/name/mnemonic.js");
        mnemonic = entropyToMnemonic(seedFromPrivateKeyPem(privateKeyPem));
      } catch { /* PEM-only export (key not seed-derivable) */ }
    }

    // No self-emit. The audit fact (who exported which Name's key, the key
    // never in it) is the dispatcher's ONE auto-Fact: return _factParams
    // ({exportedNameId}) + _factTarget (the asker's being — so the audit
    // lands on the asker's reel, NOT the keyholder target). do.js stamps the
    // caller-attributed (through = asker) do:key-export fact. No asker → no
    // _factParams, so the dispatcher still folds nothing key-specific (matches
    // the old `if (askerBeingId)` guard). The privateKeyPem/mnemonic ride the
    // RETURN to the asker, but stripForAudit drops them from the recorded result.
    const askerBeingId = identity?.beingId ? String(identity.beingId) : null;
    const out = {
      nameId,                          // the public key / did:key id exported
      hasKey:  privateKeyPem !== null, // false when locked + not connected, or keyless
      privateKeyPem,                   // the Name's signing key (PEM)
      mnemonic,                        // the same key as 24 BIP39 words
    };
    return askerBeingId
      ? laysFact(out, { exportedNameId: nameId }, { kind: "being", id: askerBeingId })
      : out;
  },
});
