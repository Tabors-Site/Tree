// credentialHost.js — host-escape glue for the credential ops (credential-reset
// first; read/detach/attach share the same primitives). Wires the SAME functions
// the JS handlers in credentialOps.js call into ctx.env.host: the authority FOLD,
// the crypto mint/decrypt, the target-row load, the being-parent lookup, and the
// ordered set-being writes. No reimplementation — only the env adapter the `.word`
// reaches through `host:` escapes (the orchestration strand the cut deletes).
//
// callHost invokes each as `fn({ args: [...] }, ctx)` (the parser emits
// `host: fn(a, b) as c` -> params:{ args:["$a","$b"] }). After the verb-native
// collapse, NONE of these lay a fact: the authority walk is a read (now a SEE
// predicate in the .word), the crypto is compute, the three re-mint writes are
// NATIVE do:set-being acts, and the reveal rides the return — only the KDF and its
// cutoff instant remain host (the one external-resource escape).

import { mintCredentialSpec, decryptCredential } from "../../../materials/being/identity/credentials.js";
import { hasCredentialAuthority, findBeingParent } from "../../../materials/being/identity/lineage.js";
import { loadTargetRow } from "../../../materials/_targetShape.js";

const historyOf = (ctx) => ctx?.moment?.actorAct?.history || ctx?.history || "0";

export function credentialHostEnv() {
  return {
    // hasCredentialAuthority(caller, target, branch) -> the being-tree authority
    // fold (lineage.js): self/I_AM short-circuit, else the asker's NAME (trueName)
    // owning the target or an ancestor / holding a covering point. One composite
    // predicate the JS handler calls as a unit.
    hasCredentialAuthority: async ({ args: [caller, target, history] }, ctx) =>
      hasCredentialAuthority(String(caller), String(target), history || historyOf(ctx)),

    // see-op "mint-credential" -> the fresh credential spec the native writes + the
    // reveal-on-return read: the scrypt `hash`, the encrypted blob (`plain` ->
    // qualities.auth.credentialPlain), the cleartext (`plaintext`, decrypted once here so
    // it rides the return, never a fact — rule 7), and the cutoff instant (`resetAt`). A
    // pure COMPUTE perceived as a value — the .word says `see mint-credential as
    // credential`; the verb IS the nature (no fact, like every see). The KDF/scrypt + AES
    // encrypt are the genuine computation; `resetAt` is the ONE wall-clock read, scoped to
    // this crypto see-op (rule 13's token-cutoff) — never the eval loop.
    "mint-credential": async () => {
      const spec = await mintCredentialSpec(null);
      return {
        hash:      spec.hash,
        plain:     spec.plain,
        plaintext: decryptCredential(spec.plain),
        resetAt:   new Date().toISOString(),
      };
    },

    // readCredential(target) -> credential-read's one host escape: read the target
    // being's ENCRYPTED credential blob (qualities.auth.credentialPlain) and decrypt it
    // to the cleartext, or null when absent. Reading an encrypted credential IS a crypto
    // operation, so it stays host (the wall). Reuses the SAME loadTargetRow +
    // decryptCredential the JS handler calls (readCredentialPlainFromBeing inlined: the
    // qualities.auth.credentialPlain read, Map-safe). The cleartext rides the .word's
    // return only; the dispatcher's audit strips it (rule 7).
    "read-credential": async ({ args: [target] }, ctx) => {
      const beingRow = await loadTargetRow({ kind: "being", id: String(target) }, "being", { moment: ctx?.moment || null });
      const q = beingRow?.qualities;
      const auth = q instanceof Map ? q.get("auth") : q?.auth;
      const blob = auth?.credentialPlain || null;
      return blob ? decryptCredential(blob) : null;
    },

    // ── shared with the other credential ops (detach/attach) ──────────────

    // decryptCredential(blob) -> the stored plaintext (the blob is
    // qualities.auth.credentialPlain; null when caller-chosen or absent).
    decryptCredential: ({ args: [blob] }) => decryptCredential(blob),

    // loadTargetRow(target) -> the being row for credential-read (its
    // qualities.auth.credentialPlain). Threads moment so an in-flight row resolves.
    loadTargetRow: async ({ args: [target] }, ctx) =>
      loadTargetRow({ kind: "being", id: String(target) }, "being", { moment: ctx?.moment || null }),

    // findBeingParent(target) -> the being-parent beingId for credential-attach's
    // being-parent-only gate (reads the be:birth fact's parentBeingId).
    "find-being-parent": async ({ args: [target] }) => findBeingParent(String(target)),
  };
}
