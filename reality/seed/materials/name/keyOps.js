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
//                the reality except through this explicit, auth-gated,
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

import { registerOperation } from "../../ibp/operations.js";
import { IBP_ERR, IbpError } from "../../ibp/protocol.js";
import { emitFact } from "../../past/fact/facts.js";
import { registerRoleWord } from "../../present/word/roleWordRegistry.js";

// Self-register this slice's co-located WORLD strand (CONVERTING.md): the bridge
// resolves ("name", "key-export") to key.word, its host escapes wired by keyHost.js.
// Registered at module load (services.js imports this file), so the `.word` is
// available wherever a booted reality exists; the cut reads it via the bridge.
registerRoleWord("name", "key-export", new URL("./key.word", import.meta.url));

// Resolve the NAME id this op acts on, from the being target's trueName.
async function resolveTargetNameId(target, summonCtx) {
  const { loadTargetRow } = await import("../_targetShape.js");
  const beingRow = await loadTargetRow(target, "being", { summonCtx });
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
// the crypto read, the asker-attributed audit, the §7 return). CALLER mode (no
// `through`): the audit attributes to the asker. Returns the {nameId,hasKey,
// privateKeyPem,mnemonic} result (hasKey coerced to a strict boolean — the .word's
// mark yields true|undefined), or null on a clean miss so the JS body runs.
async function _keyExportViaWord({ target, caller, asker, summonCtx }) {
  if (!summonCtx) return null;
  const { resolveRoleWord, runRoleWord } = await import("../../present/word/roleWordRegistry.js");
  const ir = resolveRoleWord("name", "key-export", summonCtx?.actorAct?.branch);
  if (!ir) return null;
  const { keyHostEnv } = await import("./keyHost.js");
  const { targetIdOf } = await import("../_targetShape.js");
  const branch = summonCtx?.actorAct?.branch || "0";
  try {
    const { result } = await runRoleWord(ir, {
      summonCtx, branch,
      // `target` is bound as an entity object (kind + id) so the .word's `see the
      // target's trueName` can loadProjection — seeRead needs ._id/.id, not a bare string.
      trigger: { target: { kind: "being", id: String(targetIdOf(target)) }, caller: caller ? String(caller) : null, asker: asker ? String(asker) : null, branch },
      env: { host: keyHostEnv() },
    });
    if (!result) return null;
    return { ...result, hasKey: !!result.hasKey };
  } catch (e) {
    if (e && e.__wordRefusal) throw new IbpError(e.code || IBP_ERR.FORBIDDEN, e.message);
    throw e;
  }
}

registerOperation("key-export", {
  targets: ["being"],
  ownerExtension: "seed",
  factAction: "key-export",
  // skipAudit: the auto-audit copies the handler RESULT into the stored
  // fact, which would persist the key. Opt out and stamp our own fact
  // recording WHO exported WHICH name's key WHEN, the key nowhere in it.
  skipAudit: true,
  handler: async ({ target, identity, summonCtx }) => {
    // THE CONVERSION: key-export's world strand is key.word, run through the bridge.
    // The JS below is the clean-miss fallback.
    const viaWord = await _keyExportViaWord({ target, caller: identity?.nameId, asker: identity?.beingId, summonCtx });
    if (viaWord) return viaWord;

    const branch = summonCtx?.actorAct?.branch;
    const nameId = await resolveTargetNameId(target, summonCtx);

    // NEVER export the reality (I_AM) key. The I_AM "name" id is the literal
    // "i-am", and loadSigningKey maps it to the reality's private key. A being
    // whose trueName resolved to i-am (e.g. a being born under i-am before it
    // was handed a sovereign name) must NOT become a door to the reality key.
    // Hard refusal, before the ownership gate (which i-am===i-am would pass).
    if (nameId === "i-am" || nameId === "I_AM") {
      throw new IbpError(
        IBP_ERR.FORBIDDEN,
        "key-export: the reality (I_AM) key is never exportable through a being.",
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

    // The authoritative key reader: i-am -> reality key; password-locked
    // Name -> the in-session PEM (null if not connected); system-encrypted
    // -> decrypt. Mirrors how the seal signs (actSig.loadSigningKey), so
    // export reflects exactly the key that signs.
    const { loadSigningKey } = await import("../../past/act/actSig.js");
    const privateKeyPem = await loadSigningKey(nameId, branch);

    // Paper form: the key's 32-byte seed as 24 BIP39 words. Same key,
    // writable by hand; the keypair rebuilds from either skin. Null when
    // the key shape can't yield a seed.
    let mnemonic = null;
    if (privateKeyPem) {
      try {
        const { seedFromPrivateKeyPem } = await import("./keys.js");
        const { entropyToMnemonic } = await import("./mnemonic.js");
        mnemonic = entropyToMnemonic(seedFromPrivateKeyPem(privateKeyPem));
      } catch { /* PEM-only export (key not seed-derivable) */ }
    }

    // Audit fact on the asker's reel: who exported which Name's key. The
    // key is never in it. Branch threaded from the moment, never defaulted.
    const askerBeingId = identity?.beingId ? String(identity.beingId) : null;
    if (askerBeingId) {
      await emitFact({
        verb:    "do",
        action:  "key-export",
        beingId: askerBeingId,
        target:  { kind: "being", id: askerBeingId },
        params:  { exportedNameId: nameId },
        actId:   summonCtx?.actId || null,
        branch,
      }, summonCtx);
    }

    return {
      nameId,                          // the public key / did:key id exported
      hasKey:  privateKeyPem !== null, // false when locked + not connected, or keyless
      privateKeyPem,                   // the Name's signing key (PEM)
      mnemonic,                        // the same key as 24 BIP39 words
    };
  },
});
