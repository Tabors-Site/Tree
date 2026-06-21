// keyHost.js — the host env for key.word's `host:` escapes (the key-export slice).
//
// The CONTROL strand (resolve the Name off the being target via `see`, the DOUBLE
// GATE, the §7 return) is the `.word`; the genuine COMPUTATION stays host. This is
// the thin adapter that wires keyOps.js's key-export PRIMITIVES into ctx.env.host so
// the `.word` reaches the REAL crypto with ZERO reimplementation — it calls the SAME
// functions the JS handler calls (loadSigningKey, seedFromPrivateKeyPem,
// entropyToMnemonic); only the orchestration glue lives here, which is the strand the
// cut deletes from keyOps.js.
//
// callHost invokes each builtin as `fn({ args: [...] }, ctx)`. Both are pure crypto
// (no fact). The word lays NO fact of its own: the lone WORLD fact, the audit (who
// exported which Name's key, the key NOWHERE in it), is the dispatcher's ONE auto-Fact
// — the cut promotes the returned `nameId` into _factParams {exportedNameId} + forces
// _factTarget at the asker's being, and do.js stamps the caller-attributed do:key-export
// audit. There is no host: emit escape (recordExport is retired).

import { loadSigningKey } from "../../../past/act/actSig.js";
import { seedFromPrivateKeyPem } from "../../../materials/name/keys.js";
import { entropyToMnemonic } from "../../../materials/name/mnemonic.js";

const historyOf = (ctx) =>
  ctx?.moment?.actorAct?.history || ctx?.history || "0";

export function keyHostEnv() {
  return {
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
