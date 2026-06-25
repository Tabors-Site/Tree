// credentialHost.js — host-escape glue for the credential ops (credential-reset
// first; read/detach/attach share the same primitives). Wires the SAME functions
// the JS handlers in credentialOps.js call into ctx.env.host: the crypto mint/decrypt
// and the target-row load. No reimplementation — only the env adapter the `.word`
// reaches through `host:` escapes (the orchestration strand the cut deletes).
//
// The AUTHORITY and BEING-PARENT walks are NO LONGER here. They are read INLINE in the
// gates now — `If <caller> has credential authority over <target>` and `If <caller> is the
// being-parent of <target>` — resolved through floorHostEnv's hasCredentialAuthority /
// isBeingParentOf (the shared floor predicate every .word runner merges). A relation read
// as a native cond, never a value pulled out to hand-compare.
//
// callHost invokes each as `fn({ args: [...] }, ctx)` (the parser emits
// `host: fn(a, b) as c` -> params:{ args:["$a","$b"] }). After the verb-native
// collapse, NONE of these lay a fact: the authority walk is a read (now a SEE
// predicate in the .word), the crypto is compute, the three re-mint writes are
// NATIVE do:set-being acts, and the reveal rides the return — only the KDF (scrypt/AES),
// remains the host floor. The revoke cutoff is a reel-head READ (chain position), no clock.

import {
  mintCredentialSpec,
  decryptCredential,
} from "../../../materials/being/identity/credentials.js";
import { loadTargetRow, targetIdOf } from "../../../materials/_targetShape.js";

export function credentialHostEnv() {
  return {
    // resolve-target-being(target) -> the bare being id of the DO target. The WORD-SOLE
    // bridge binds the STANDARD trigger `target` as the {kind,id} identity (do.js runOpWord),
    // but a direct-bridge caller may bind a bare id string; targetIdOf normalizes BOTH to the
    // id the gates / writes / reveal key on (the SAME normalize the deleted JS adapter did via
    // targetBeingIdOf). A derive-from-inputs see (it lays no fact), in SEE_FLOOR.
    "resolve-target-being": async ({ args: [target] }) =>
      String(targetIdOf(target)),

    // see-op "mint-credential" -> the fresh credential spec the native writes + the
    // reveal-on-return read: the scrypt `hash`, the encrypted blob (`plain` ->
    // qualities.auth.credentialPlain), and the cleartext (`plaintext`, decrypted once here so
    // it rides the return, never a fact — rule 7). A pure COMPUTE perceived as a value — the
    // .word says `see mint-credential as credential`; the verb IS the nature (no fact, like
    // every see). The KDF/scrypt + AES encrypt are the genuine computation. NO clock here: the
    // revoke cutoff moved to `reel-head-of` below — a chain position, not a wall-clock instant.
    "mint-credential": async () => {
      const spec = await mintCredentialSpec(null);
      return {
        hash: spec.hash,
        plain: spec.plain,
        plaintext: decryptCredential(spec.plain),
      };
    },

    // see-op "reel-head-of" -> the target being's current reel HEAD seq on "0": the CHAIN
    // POSITION a credential-reset stamps as tokensInvalidBefore. A session token carries the
    // reel head it was minted at (iss_seq, generateToken); minted at-or-before this seq ->
    // revoked (verifyTokenStrict). The reset's own three set-being writes advance the head past
    // it, so post-reset tokens survive. A pure read (no fact), in SEE_FLOOR — the time-purge's
    // answer to "tokens from before the reset": a seq, never a clock.
    "reel-head-of": async ({ args: [target] }) => {
      const { readHead } = await import("../../../past/reel/reelHeads.js");
      return readHead("being", String(targetIdOf(target)), { history: "0" });
    },

    // readCredential(target) -> credential-read's one host escape: read the target
    // being's ENCRYPTED credential blob (qualities.auth.credentialPlain) and decrypt it
    // to the cleartext, or null when absent. Reading an encrypted credential IS a crypto
    // operation, so it stays host (the wall). Reuses the SAME loadTargetRow +
    // decryptCredential the JS handler calls (readCredentialPlainFromBeing inlined: the
    // qualities.auth.credentialPlain read, Map-safe). The cleartext rides the .word's
    // return only; the dispatcher's audit strips it (rule 7).
    "read-credential": async ({ args: [target] }, ctx) => {
      const beingRow = await loadTargetRow(
        { kind: "being", id: String(target) },
        "being",
        { moment: ctx?.moment || null },
      );
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
      loadTargetRow({ kind: "being", id: String(target) }, "being", {
        moment: ctx?.moment || null,
      }),
  };
}
