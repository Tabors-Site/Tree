// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// spaceHost.js — host-escape glue for create-space (store/words/create-space/, the
// create-space DO op). Wires the SAME compute the JS createSpace kernel runs into
// ctx.env.host so create.word can reach it through a `see` escape.
//
// resolve-birth-space runs the NON-EMITTING floor (materials/space/spaces.js
// resolveBirthSpace): name/type/size validation, coord auto-assign inside the parent,
// spaceRoot→isRoot promotion, the beforeSpaceCreate hook, sibling-name uniqueness, the
// heaven-parent gate, and the max-children check UNDER the parent-lock, plus the uuid
// mint. It lays NO fact (a read of the floor). The parent-lock is HELD on return; this
// bridge registers its release on ctx.moment.afterSeal so it brackets the dispatcher's
// one do:create-space stamp — the max-children invariant spans check→seal, exactly as
// createSpace's own try/finally spans check→emit (the spaceLock's TTL is the backstop
// if a moment dies before seal). createSpace (the kernel) is UNTOUCHED — manifest,
// services, and sub-tree creates keep self-emitting; this is the create-matter
// precedent (the op owns its compute, the kernel stays for its other callers).
//
// callHost invokes the escape as `fn({ args: [...] }, ctx)`.

import { IbpError, IBP_ERR } from "../../../ibp/protocol.js";
import { detectTargetKind, targetIdOf } from "../../../materials/_targetShape.js";
import { resolveBirthSpace } from "../../../materials/space/spaces.js";
import { releaseSpaceLock } from "../../../materials/space/spaceLocks.js";

export function spaceHostEnv() {
  return {
    // The genuine compute: the finalized birth spec from the target + params +
    // caller. Mirrors createSpaceChild's target→parent resolution, then runs
    // resolveBirthSpace (the non-emitting createSpace floor). NO fact.
    "resolve-birth-space": async ({ args: [target, targetKind, params, caller] }, ctx) => {
      const kind = targetKind || detectTargetKind(target);
      const spec = params || {};

      // Target → parent (mirrors createSpaceChild). Non-stance: parent IS the
      // target. Stance-arrival: parent is the resolved position's spaceId; the
      // place root refuses (create inside your home instead).
      let parentId;
      if (kind === "stance") {
        if (target?.isSpaceRoot) {
          throw new IbpError(IBP_ERR.INVALID_INPUT,
            "Cannot create-child at the place root. Create inside your home (~) instead.");
        }
        if (!target?.spaceId) {
          throw new IbpError(IBP_ERR.SPACE_NOT_FOUND, "Resolved position has no spaceId");
        }
        parentId = target.spaceId;
      } else {
        parentId = targetIdOf(target);
      }

      const birth = await resolveBirthSpace({
        name: spec.name,
        type: spec.type ?? null,
        size: spec.size ?? null,
        parentId,
        beingId: caller ? String(caller) : (spec.beingId || null),
        sessionId: ctx?.moment?.sessionId ?? null,
        moment: ctx?.moment ?? null,
      });

      // The parent-lock is HELD; release AFTER the dispatcher seals the birth fact
      // (afterSeal fires post-seal), so the max-children check→stamp window is locked.
      if (birth.lockTarget) {
        const release = () => releaseSpaceLock(birth.lockTarget, birth.sessionId);
        if (ctx?.moment?.afterSeal) ctx.moment.afterSeal.push(release);
        else release();
      }

      return { enrichedSpec: birth.enrichedSpec, spaceId: birth.spaceId };
    },
  };
}
