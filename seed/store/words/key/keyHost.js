// keyHost.js — the host floor for key.word's see-ops (the key-export slice).
//
// key-export is WORD-SOLE (handler-less): key.word IS the op, run by do.js's runOpWord;
// this file wires the see-op floor the `.word` reaches via `see <op> as …`. The CONTROL
// strand (resolve the Name off the being target, the DOUBLE GATE, the §7 return) is the
// `.word`; the genuine COMPUTATION (the crypto reads) stays host. It calls the SAME
// functions the seal signs with — loadSigningKey, seedFromPrivateKeyPem, entropyToMnemonic —
// with ZERO reimplementation; only the read glue lives here.
//
// callHost invokes each builtin as `fn({ args: [...] }, ctx)`. All three are pure READS
// (no fact). The word lays NO fact of its own: the lone WORLD fact, the audit (who
// exported which Name's key, the key NOWHERE in it), is the dispatcher's ONE auto-Fact
// — the `.word` returns _factParams {exportedNameId} + the asker's being (idFrom →
// _factTarget), and do.js stamps the caller-attributed do:key-export audit. No host: emit.

import { loadSigningKey } from "../../../past/act/actSig.js";
import { seedFromPrivateKeyPem } from "../../../materials/name/keys.js";
import { entropyToMnemonic } from "../../../materials/name/mnemonic.js";

const historyOf = (ctx) =>
  ctx?.moment?.actorAct?.history || ctx?.history || "0";

export function keyHostEnv() {
  return {
    // resolve-name-id → the CONNECTED Name id of the asker (ctx.identity.nameId), the
    // server ground truth the signing session is keyed by. This is the ownership-gate axis:
    // the .word compares the target being's resolved owner against THIS, never the driven
    // being's trueName — so a Name driving a being it does NOT own (a father inhabiting a
    // mother's being) cannot export the owner's key, exactly as the JS gate's
    // `identity.nameId !== nameId` enforced. A read of the session (no args, no fact).
    "resolve-name-id": (_p, ctx) =>
      ctx?.identity?.nameId != null ? String(ctx.identity.nameId) : null,

    // loadKey(nameId) → THE authoritative key reader, the SAME one the seal signs
    // with (actSig.loadSigningKey): i-am → story key; password-locked Name → the
    // in-session PEM (null if not connected); system-encrypted → decrypt. Null when
    // locked-and-not-connected or keyless. The history is the moment's, never defaulted
    // for a real export (the "0" fallback only covers a standalone harness run).
    "load-key": async ({ args: [nameId] }, ctx) =>
      loadSigningKey(String(nameId), historyOf(ctx)),

    // paperForm(privateKeyPem) → the key's 32-byte seed as 24 BIP39 words (the SAME
    // entropyToMnemonic(seedFromPrivateKeyPem(pem)) the JS handler runs). Null when the
    // PEM is absent or its shape can't yield a seed (PEM-only export), matching the JS
    // try/catch-to-null. Same key, writable by hand; the keypair rebuilds from either skin.
    "paper-form": ({ args: [privateKeyPem] }) => {
      if (!privateKeyPem) return null;
      try {
        return entropyToMnemonic(seedFromPrivateKeyPem(privateKeyPem));
      } catch {
        return null; // PEM-only export (key not seed-derivable)
      }
    },
  };
}
