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
import {
  mintCredentialSpec,
  decryptCredential,
} from "./identity/credentials.js";
import { hasCredentialAuthority } from "./identity/lineage.js";
import { doVerb } from "../../ibp/verbs/do.js";

function targetBeingIdOf(target) {
  if (target && typeof target === "object" && target.kind === "being" && target.id) {
    return String(target.id);
  }
  if (typeof target === "string") return target;
  throw new IbpError(IBP_ERR.INVALID_INPUT, "credential op requires a being target");
}

function askerBeingIdOf(identity, scaffold) {
  if (scaffold) return null;
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
  handler: async ({ target, identity, scaffold }) => {
    const targetBeingId = targetBeingIdOf(target);
    const askerBeingId = askerBeingIdOf(identity, scaffold);
    if (!scaffold) {
      const ok = await hasCredentialAuthority(askerBeingId, targetBeingId);
      if (!ok) {
        throw new IbpError(
          IBP_ERR.FORBIDDEN,
          "Asker has no credential authority over target",
          { askerBeingId, targetBeingId },
        );
      }
    }
    const { loadTargetRow } = await import("../_targetShape.js");
    const beingRow = await loadTargetRow(target, "being");
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
  handler: async ({ target, identity, scaffold, summonCtx }) => {
    const targetBeingId = targetBeingIdOf(target);
    const askerBeingId = askerBeingIdOf(identity, scaffold);
    if (!scaffold) {
      const ok = await hasCredentialAuthority(askerBeingId, targetBeingId);
      if (!ok) {
        throw new IbpError(
          IBP_ERR.FORBIDDEN,
          "Asker has no credential authority over target",
          { askerBeingId, targetBeingId },
        );
      }
    }
    const credential = await mintCredentialSpec(null);
    const opts = identity ? { identity, summonCtx } : { scaffold: true, summonCtx };
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
// isDetachedFromCreator walks it forward in seq order.
registerOperation("credential-detach", {
  targets: ["being"],
  ownerExtension: "seed",
  factAction: "credential-detach",
  handler: async ({ target, identity, scaffold }) => {
    const targetBeingId = targetBeingIdOf(target);
    const askerBeingId = askerBeingIdOf(identity, scaffold);
    if (!scaffold && askerBeingId !== targetBeingId) {
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

// credential-attach. The creator re-asserts authority over a being
// that previously detached. The act of release belongs to the child;
// the act of re-binding belongs to the creator. SINGLE-WRITER: the
// Fact lands on the CREATOR's reel (the asker's reel — the asker IS
// the creator, enforced below) with the child's beingId carried in
// `result.targetBeingId` so isDetachedFromCreator can recover it on
// the lookup side.
//
// isDetachedFromCreator walks both reels (child's reel for the
// detach, creator's reel for the attach) and compares by date to
// decide the current state.
registerOperation("credential-attach", {
  targets: ["being"],
  ownerExtension: "seed",
  factAction: "credential-attach",
  handler: async ({ target, identity, scaffold }) => {
    const targetBeingId = targetBeingIdOf(target);
    const askerBeingId = askerBeingIdOf(identity, scaffold);
    if (!scaffold) {
      const { findSummonerOf } = await import("./identity/lineage.js");
      const summonerId = await findSummonerOf(targetBeingId);
      if (!summonerId || String(summonerId) !== askerBeingId) {
        throw new IbpError(
          IBP_ERR.FORBIDDEN,
          "credential-attach is creator-only",
          { askerBeingId, summonerId, targetBeingId },
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
