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
import { registerRoleWord } from "../../present/word/roleWordRegistry.js";

// Self-register this module's co-located `.word` slices (CONVERTING.md): importing
// credentialOps.js (at seed boot, or in a DRY harness) registers them so
// resolveRoleWord("credential", "credential-reset") finds the world strand. The cut
// in the handler runs it through the bridge with credentialHostEnv(); the JS body is
// the clean-miss fallback.
registerRoleWord("credential", "credential-reset", new URL("./credential-reset.word", import.meta.url));
registerRoleWord("credential", "credential-read", new URL("./credential-read.word", import.meta.url));
registerRoleWord("credential", "credential-detach", new URL("./credential-detach.word", import.meta.url));
registerRoleWord("credential", "credential-attach", new URL("./credential-attach.word", import.meta.url));

// credential-detach / credential-attach: pure-gate world strands (self-only / being-
// parent-only). The detach/attach RECORD is the dispatcher's audit fact, so the .word
// only gates + returns. Shared cut helper (CALLER mode); returns {targetBeingId,
// detached|attached} or null on a clean miss. The cut re-adds _factTarget.
async function _credentialGateViaWord(opName, { caller, target, summonCtx }) {
  if (!summonCtx) return null;
  const { resolveRoleWord, runRoleWord } = await import("../../present/word/roleWordRegistry.js");
  const ir = resolveRoleWord("credential", opName, summonCtx?.actorAct?.branch);
  if (!ir) return null;
  const { credentialHostEnv } = await import("./credentialHost.js");
  const b = summonCtx?.actorAct?.branch;
  try {
    const { result } = await runRoleWord(ir, {
      summonCtx, branch: b,
      trigger: { caller: String(caller), target: String(target), branch: b },
      env: { host: credentialHostEnv() },
    });
    return result || null;
  } catch (e) {
    if (e && e.__wordRefusal) throw new IbpError(e.code || IBP_ERR.FORBIDDEN, e.message);
    throw e;
  }
}

// credential-read's world strand is credential-read.word (the gate→read→reveal). CALLER
// mode. Returns {targetBeingId, hasPlain, plaintext} or null on a clean miss. The cut
// re-adds _factTarget (the asker's reel) + coerces hasPlain to a strict boolean.
async function _credentialReadViaWord({ caller, target, branch, summonCtx }) {
  if (!summonCtx) return null;
  const { resolveRoleWord, runRoleWord } = await import("../../present/word/roleWordRegistry.js");
  const ir = resolveRoleWord("credential", "credential-read", summonCtx?.actorAct?.branch);
  if (!ir) return null;
  const { credentialHostEnv } = await import("./credentialHost.js");
  const b = branch || summonCtx?.actorAct?.branch; // the moment's branch; never floor to "0"
  try {
    const { result } = await runRoleWord(ir, {
      summonCtx, branch: b,
      trigger: { caller: String(caller), target: String(target), branch: b },
      env: { host: credentialHostEnv() },
    });
    if (!result) return null;
    return { ...result, hasPlain: !!result.hasPlain };
  } catch (e) {
    if (e && e.__wordRefusal) throw new IbpError(e.code || IBP_ERR.FORBIDDEN, e.message);
    throw e;
  }
}

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
  handler: async ({ target, identity, summonCtx, branch }) => {
    const targetBeingId = targetBeingIdOf(target);
    const askerBeingId = askerBeingIdOf(identity);

    // THE CONVERSION: credential-read's world strand is credential-read.word (caller
    // mode). The dispatcher needs _factTarget (the asker's reel) for the audit fact,
    // which the .word omits — re-add it around the bridge result. JS = clean-miss fallback.
    const viaWord = await _credentialReadViaWord({ caller: askerBeingId, target: targetBeingId, branch, summonCtx });
    if (viaWord) return { _factTarget: { kind: "being", id: askerBeingId || targetBeingId }, ...viaWord };

    const ok = await hasCredentialAuthority(askerBeingId, targetBeingId, branch);
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
// credential-reset's world strand is credential-reset.word (the authority gate, the
// mint, the three credential writes, the reveal). CALLER mode (no `through`) — the writes
// attribute to the asker. Returns {targetBeingId, plaintext}, or null on a clean miss.
async function _credentialResetViaWord({ caller, target, branch, summonCtx }) {
  if (!summonCtx) return null;
  const { resolveRoleWord, runRoleWord } = await import("../../present/word/roleWordRegistry.js");
  const ir = resolveRoleWord("credential", "credential-reset", summonCtx?.actorAct?.branch);
  if (!ir) return null;
  const { credentialHostEnv } = await import("./credentialHost.js");
  const b = branch || summonCtx?.actorAct?.branch; // the moment's branch; never floor to "0"
  try {
    const { result } = await runRoleWord(ir, {
      summonCtx, branch: b,
      trigger: { caller: String(caller), target: String(target), branch: b },
      env: { host: credentialHostEnv() },
    });
    return result || null;
  } catch (e) {
    if (e && e.__wordRefusal) throw new IbpError(e.code || IBP_ERR.FORBIDDEN, e.message);
    throw e;
  }
}

registerOperation("credential-reset", {
  targets: ["being"],
  ownerExtension: "seed",
  factAction: "credential-reset",
  handler: async ({ target, identity, summonCtx, branch }) => {
    const targetBeingId = targetBeingIdOf(target);
    const askerBeingId = askerBeingIdOf(identity);

    // THE CONVERSION: credential-reset's world strand is credential-reset.word, run
    // through the bridge in CALLER mode (the three set-being writes attribute to the
    // asker). The dispatcher needs _factTarget (the asker's reel) for its audit fact,
    // which the .word return omits — re-add it around the bridge result. JS body below
    // is the clean-miss fallback.
    const viaWord = await _credentialResetViaWord({ caller: askerBeingId, target: targetBeingId, branch, summonCtx });
    if (viaWord) return { _factTarget: { kind: "being", id: askerBeingId || targetBeingId }, ...viaWord };

    const ok = await hasCredentialAuthority(askerBeingId, targetBeingId, branch);
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
  handler: async ({ target, identity, summonCtx }) => {
    const targetBeingId = targetBeingIdOf(target);
    const askerBeingId = askerBeingIdOf(identity);
    // THE CONVERSION: the world strand is credential-detach.word (caller mode). JS fallback.
    const viaWord = await _credentialGateViaWord("credential-detach", { caller: askerBeingId, target: targetBeingId, summonCtx });
    if (viaWord) return { _factTarget: { kind: "being", id: askerBeingId || targetBeingId }, ...viaWord };
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
  handler: async ({ target, identity, summonCtx }) => {
    const targetBeingId = targetBeingIdOf(target);
    const askerBeingId = askerBeingIdOf(identity);
    // THE CONVERSION: the world strand is credential-attach.word (caller mode). JS fallback.
    const viaWord = await _credentialGateViaWord("credential-attach", { caller: askerBeingId, target: targetBeingId, summonCtx });
    if (viaWord) return { _factTarget: { kind: "being", id: askerBeingId || targetBeingId }, ...viaWord };
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
