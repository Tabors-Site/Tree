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

import { registerOperation } from "../../ibp/operations.js";
import { IBP_ERR, IbpError } from "../../ibp/protocol.js";
import { I_AM } from "./seedBeings.js";
import {
  mintCredentialSpec,
  decryptCredential,
} from "./identity/credentials.js";
import { hasCredentialAuthority } from "./identity/lineage.js";
import { doVerb } from "../../ibp/verbs/do.js";
import { emitFact } from "../../past/fact/facts.js";

function targetBeingIdOf(target) {
  if (target && typeof target === "object" && target.kind === "being" && target.id) {
    return String(target.id);
  }
  if (typeof target === "string") return target;
  throw new IbpError(IBP_ERR.INVALID_INPUT, "credential op requires a being target");
}

function askerBeingIdOf(identity) {
  if (!identity?.beingId)
    throw new IbpError(IBP_ERR.UNAUTHORIZED, "credential op requires an identified asker");
  return String(identity.beingId);
}

function readCredentialPlainFromBeing(being) {
  const q = being?.qualities;
  if (!q) return null;
  const auth = q instanceof Map ? q.get("auth") : q.auth;
  return auth?.credentialPlain || null;
}

function readPrivateKeyEncFromBeing(being) {
  const q = being?.qualities;
  if (!q) return null;
  const auth = q instanceof Map ? q.get("auth") : q.auth;
  return auth?.privateKeyEnc || null;
}

// key-export. Return the being's PRIVATE KEY (decrypted PEM) to the
// authorized owner. The wallet "back up your key" / "take your identity
// to another reality" path. The key NEVER leaves the reality except
// through this explicit, auth-gated, owner-initiated op: it is redacted
// out of every descriptor, fact, and clone bundle (qualities.auth.*),
// and never the JWT. Returned only on the direct DO response channel.
//
// skipAudit: the normal auto-audit copies the handler's RESULT into the
// stored fact (summarizeAuditResult), which would persist the key. So
// this op opts out and stamps its OWN audit fact recording WHO exported
// WHOSE key WHEN, with the key nowhere in it.
registerOperation("key-export", {
  targets: ["being"],
  ownerExtension: "seed",
  factAction: "key-export",
  skipAudit: true,
  handler: async ({ target, identity, summonCtx }) => {
    const targetBeingId = targetBeingIdOf(target);
    const askerBeingId = askerBeingIdOf(identity);
    const ok = await hasCredentialAuthority(askerBeingId, targetBeingId);
    if (!ok) {
      throw new IbpError(
        IBP_ERR.FORBIDDEN,
        "Asker has no authority to export this being's key",
        { askerBeingId, targetBeingId },
      );
    }
    const { loadTargetRow } = await import("../_targetShape.js");
    const beingRow = await loadTargetRow(target, "being", { summonCtx });
    const blob = readPrivateKeyEncFromBeing(beingRow);
    const privateKeyPem = blob ? decryptCredential(blob) : null;

    // Paper form: the key's 32-byte seed as 24 BIP39 words. Same key,
    // writable by hand; key-import rebuilds the keypair from either
    // skin. Null when the key shape can't yield a seed (foreign blob).
    let mnemonic = null;
    if (privateKeyPem) {
      try {
        const { seedFromPrivateKeyPem } = await import("../name/keys.js");
        const { entropyToMnemonic } = await import("../name/mnemonic.js");
        mnemonic = entropyToMnemonic(seedFromPrivateKeyPem(privateKeyPem));
      } catch { /* PEM-only export */ }
    }

    // Audit fact on the asker's reel: who exported whose key. Never the
    // key. Branch threaded from the moment, never defaulted.
    await emitFact({
      verb:    "do",
      action:  "key-export",
      beingId: askerBeingId,
      target:  { kind: "being", id: askerBeingId },
      params:  { exportedBeingId: targetBeingId },
      actId:   summonCtx?.actId || null,
      branch:  summonCtx?.actorAct?.branch,
    }, summonCtx);

    return {
      targetBeingId,
      beingId: targetBeingId,       // the public key / wallet address
      hasKey: privateKeyPem !== null,
      privateKeyPem,                // the owner's signing key (PEM)
      mnemonic,                     // the same key as 24 BIP39 words
    };
  },
});

// signing-unlock / signing-lock — the secondary unlock latch
// (IDENTITY.md "the felt control", signingSession.js for the model).
// Self-only: only the being itself opens or closes its own signing
// session. Unlock proves the secret (the login password, bcrypt
// checked constant-time like connect); lock needs no proof. Both are
// skipAudit + manual fact so the password never rides the dispatcher's
// auto-audit; the fact records THAT the latch moved, never the secret.
registerOperation("signing-unlock", {
  targets: ["being"],
  ownerExtension: "seed",
  factAction: "signing-unlock",
  skipAudit: true,
  args: {
    password: { type: "text", label: "Your password", required: true },
  },
  handler: async ({ target, identity, params, summonCtx }) => {
    const targetBeingId = targetBeingIdOf(target);
    const askerBeingId = askerBeingIdOf(identity);
    if (askerBeingId !== targetBeingId) {
      throw new IbpError(IBP_ERR.FORBIDDEN, "signing-unlock is self-only", { askerBeingId, targetBeingId });
    }
    const { loadTargetRow } = await import("../_targetShape.js");
    const beingRow = await loadTargetRow(target, "being", { summonCtx });
    const { verifyPassword } = await import("./identity/credentials.js");
    const ok = await verifyPassword(beingRow, String(params?.password || ""));
    if (!ok) {
      throw new IbpError(IBP_ERR.UNAUTHORIZED, "Invalid credentials");
    }
    const { unlockSigning } = await import("../name/signingSession.js");
    unlockSigning(targetBeingId);
    await emitFact({
      verb:    "do",
      action:  "signing-unlock",
      beingId: askerBeingId,
      target:  { kind: "being", id: askerBeingId },
      params:  {},
      actId:   summonCtx?.actId || null,
      branch:  summonCtx?.actorAct?.branch,
    }, summonCtx);
    return { targetBeingId, unlocked: true };
  },
});

registerOperation("signing-lock", {
  targets: ["being"],
  ownerExtension: "seed",
  factAction: "signing-lock",
  skipAudit: true,
  handler: async ({ target, identity, summonCtx }) => {
    const targetBeingId = targetBeingIdOf(target);
    const askerBeingId = askerBeingIdOf(identity);
    if (askerBeingId !== targetBeingId) {
      throw new IbpError(IBP_ERR.FORBIDDEN, "signing-lock is self-only", { askerBeingId, targetBeingId });
    }
    const { lockSigning } = await import("../name/signingSession.js");
    // Latch closes AFTER the seal so the "I lock" act itself still
    // seals signed (the last signed act of the session, honestly so).
    if (summonCtx?.afterSeal) {
      summonCtx.afterSeal.push(() => lockSigning(targetBeingId));
    } else {
      lockSigning(targetBeingId);
    }
    await emitFact({
      verb:    "do",
      action:  "signing-lock",
      beingId: askerBeingId,
      target:  { kind: "being", id: askerBeingId },
      params:  {},
      actId:   summonCtx?.actId || null,
      branch:  summonCtx?.actorAct?.branch,
    }, summonCtx);
    return { targetBeingId, unlocked: false };
  },
});

// credential-read. Return the auto-generated plaintext (if any) to
// the authorized asker. The Fact written by the dispatcher carries
// who-read-whom for audit; the plaintext itself is NOT in the Fact.
//
// SINGLE-WRITER: a summoner reading a child's credential is the
// summoner's act about the child — not the child's act. The audit
// Fact lands on the asker's own reel (doer = asker = reel-owner);
// targetBeingId rides in `result` so audit queries can find it.
// Scaffold path has no asker; the I-Am is the actor by convention.
registerOperation("credential-read", {
  targets: ["being"],
  ownerExtension: "seed",
  factAction: "credential-read",
  handler: async ({ target, identity, summonCtx }) => {
    const targetBeingId = targetBeingIdOf(target);
    const askerBeingId = askerBeingIdOf(identity);
    const ok = await hasCredentialAuthority(askerBeingId, targetBeingId);
    if (!ok) {
      throw new IbpError(
        IBP_ERR.FORBIDDEN,
        "Asker has no credential authority over target",
        { askerBeingId, targetBeingId },
      );
    }
    const { loadTargetRow } = await import("../_targetShape.js");
    const beingRow = await loadTargetRow(target, "being", { summonCtx });
    const blob = readCredentialPlainFromBeing(beingRow);
    const plaintext = blob ? decryptCredential(blob) : null;
    const reelBeingId = askerBeingId || targetBeingId;
    return {
      _factTarget: { kind: "being", id: reelBeingId },
      targetBeingId,
      hasPlain: plaintext !== null,
      plaintext,
    };
  },
});

// credential-reset. Re-mint the password. New bcrypt hash overwrites
// `password`; new encrypted plaintext overwrites
// `qualities.auth.credentialPlain`. Bumps tokensInvalidBefore so any
// session JWT issued before the reset stops verifying on the next
// verifyTokenStrict call. The dispatcher's Fact records who reset
// whom; the new plaintext is returned to the asker (and not into
// the Fact).
//
// The three set-being Facts below mutate state on the being's reel; the
// dispatcher's credential-reset Fact records the asker's act.
registerOperation("credential-reset", {
  targets: ["being"],
  ownerExtension: "seed",
  factAction: "credential-reset",
  handler: async ({ target, identity, summonCtx }) => {
    const targetBeingId = targetBeingIdOf(target);
    const askerBeingId = askerBeingIdOf(identity);
    const ok = await hasCredentialAuthority(askerBeingId, targetBeingId);
    if (!ok) {
      throw new IbpError(
        IBP_ERR.FORBIDDEN,
        "Asker has no credential authority over target",
        { askerBeingId, targetBeingId },
      );
    }
    const credential = await mintCredentialSpec(null);
    const opts = identity ? { identity, summonCtx } : { identity: I_AM, summonCtx };
    await doVerb(target, "set-being", { field: "password", value: credential.hash }, opts);
    await doVerb(
      target,
      "set-being",
      {
        field: "qualities.auth",
        value: { credentialPlain: credential.plain },
        merge: true,
      },
      opts,
    );
    await doVerb(
      target,
      "set-being",
      {
        field: "qualities.auth",
        value: { tokensInvalidBefore: new Date().toISOString() },
        merge: true,
      },
      opts,
    );
    const reelBeingId = askerBeingId || targetBeingId;
    return {
      _factTarget: { kind: "being", id: reelBeingId },
      targetBeingId,
      plaintext: decryptCredential(credential.plain),
    };
  },
});

// credential-detach. The target being declares itself independent.
// Self-only: the asker must equal the target. SINGLE-WRITER is
// naturally satisfied (asker = target, so the asker's reel IS the
// target's reel). The Fact lands on the being's own reel;
// isDetachedFromBeingParent walks it forward in seq order.
registerOperation("credential-detach", {
  targets: ["being"],
  ownerExtension: "seed",
  factAction: "credential-detach",
  handler: async ({ target, identity }) => {
    const targetBeingId = targetBeingIdOf(target);
    const askerBeingId = askerBeingIdOf(identity);
    // Self-only EXCEPT I_AM which has universal authority on its own
    // reality (parallels hasCredentialAuthority's I_AM short-circuit).
    if (askerBeingId !== targetBeingId && askerBeingId !== I_AM) {
      throw new IbpError(
        IBP_ERR.FORBIDDEN,
        "credential-detach is self-only; only the being itself can declare independence",
        { askerBeingId, targetBeingId },
      );
    }
    const reelBeingId = askerBeingId || targetBeingId;
    return {
      _factTarget: { kind: "being", id: reelBeingId },
      targetBeingId,
      detached: true,
    };
  },
});

// credential-attach. The being parent re-asserts authority over a
// being that previously detached. The act of release belongs to the
// child; the act of re-binding belongs to the being parent.
// SINGLE-WRITER: the Fact lands on the BEING PARENT's reel (the
// asker's reel — the asker IS the being parent, enforced below) with
// the child's beingId carried in `result.targetBeingId` so
// isDetachedFromBeingParent can recover it on the lookup side.
//
// isDetachedFromBeingParent walks both reels (child's reel for the
// detach, being parent's reel for the attach) and compares by date
// to decide the current state.
registerOperation("credential-attach", {
  targets: ["being"],
  ownerExtension: "seed",
  factAction: "credential-attach",
  handler: async ({ target, identity }) => {
    const targetBeingId = targetBeingIdOf(target);
    const askerBeingId = askerBeingIdOf(identity);
    // Being-parent-only EXCEPT I_AM (universal authority on its own
    // reality).
    if (askerBeingId !== I_AM) {
      const { findBeingParent } = await import("./identity/lineage.js");
      const parentBeingId = await findBeingParent(targetBeingId);
      if (!parentBeingId || String(parentBeingId) !== askerBeingId) {
        throw new IbpError(
          IBP_ERR.FORBIDDEN,
          "credential-attach is being-parent-only",
          { askerBeingId, parentBeingId, targetBeingId },
        );
      }
    }
    const reelBeingId = askerBeingId || targetBeingId;
    return {
      _factTarget: { kind: "being", id: reelBeingId },
      targetBeingId,
      attached: true,
    };
  },
});
