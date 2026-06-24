// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// purgeContentHost.js — the floor see-op for purge-content.word (matter/ops.js, the purge-content DO
// op). Physically delete the bytes behind a matter's content hash from the content store.
//
// The CONTROL strand (the caller gate + the return) is the .word; the genuine substrate READS + the
// gates this op needs — load the matter, resolve the hash, the author-or-root-owner auth gate, and
// the SHARED-FATE refcount gate (other live matter referencing the same dedup'd bytes; refuses
// without force) — are one host see-op, `resolve-purge`. It REUSES the SAME primitives the JS handler
// called (loadOrFold / isCasRef / resolveRootSpace / getSpaceOwner / Projection refcount); it
// reimplements nothing. A host throw is this word's refusal.
//
// FACT-FIRST: the physical delete runs on the moment's afterSeal (the dispatcher's do:purge-content
// fact seals IN-moment, then deleteContent runs post-seal — the chain explains the missing bytes
// BEFORE they go). resolve-purge schedules that delete onto ctx.moment.afterSeal — the SAME hook the
// handler pushed to — so it is deferred, not run during the read. The block it returns is { matterId,
// hash, sharedReferents, factParams:{hash,force,referents} }; do.js's runOpWord (stampsWordFact,
// idFrom:"matterId") lays the one do:purge-content fact on the matter's reel, and applyPurgeContent
// folds it (marking the ref purged).

import { IBP_ERR, IbpError } from "../../ibp/protocol.js";

const historyOf = (ctx) => ctx?.moment?.actorAct?.history || ctx?.history || "0";

export function purgeContentHostEnv() {
  return {
    // resolve-purge(matterId, hash, force, caller) — load + resolve hash + auth + refcount gate, then
    // schedule the post-seal content delete. Throws the SAME IbpErrors the handler threw. NO fact laid
    // here (the dispatcher stamps the one do:purge-content from the returned factParams).
    "resolve-purge": async ({ args: [matterId, hashArg, force, caller] }, ctx) => {
      if (!matterId)
        throw new IbpError(IBP_ERR.INVALID_INPUT, "purge-content: matter target required");
      if (!caller)
        throw new IbpError(IBP_ERR.UNAUTHORIZED, "purge-content: identity required");
      const history = historyOf(ctx);

      const { loadOrFold } = await import("./../projections.js");
      const slot = await loadOrFold("matter", String(matterId), history);
      if (!slot)
        throw new IbpError(IBP_ERR.INVALID_INPUT, "purge-content: matter not found");
      const matter = { _id: slot.id, ...(slot.state || {}) };

      const { isCasRef } = await import("./contentStore.js");
      const hash =
        typeof hashArg === "string" && hashArg.length
          ? hashArg
          : isCasRef(matter.content)
            ? matter.content.hash
            : null;
      if (!hash) {
        throw new IbpError(
          IBP_ERR.INVALID_INPUT,
          "purge-content: matter has no stored content (pass `hash` for a historical version)",
        );
      }

      // Owner gate: the matter's author or the tree's root owner.
      const { resolveRootSpace } = await import("../space/spaces.js");
      const { getSpaceOwner } = await import("../space/members.js");
      const rootSpace =
        matter.spaceId && matter.spaceId !== "deleted"
          ? await resolveRootSpace(matter.spaceId)
          : null;
      const isAuthor = String(matter.beingId) === String(caller);
      const isRootOwner = rootSpace
        ? String(getSpaceOwner(rootSpace) || "") === String(caller)
        : false;
      if (!isAuthor && !isRootOwner) {
        throw new IbpError(
          IBP_ERR.FORBIDDEN,
          "purge-content: only the matter author or the tree owner can purge its content",
        );
      }

      // Shared-fate refcount: other live matter (any history) whose CURRENT content is this hash.
      // Purging would blind them — refuse without force.
      const forced = force === true || force === "true";
      const { default: Projection } = await import("../history/projection.js");
      const others = await Projection.find({
        type: "matter",
        "state.content.hash": hash,
        tombstoned: { $ne: true },
        id: { $ne: String(matterId) },
      })
        .select("id history")
        .lean();
      if (others.length > 0 && !forced) {
        throw new IbpError(
          IBP_ERR.RESOURCE_CONFLICT,
          `purge-content: ${others.length} other matter row(s) reference these same bytes ` +
            `(content is deduplicated by hash). Pass force=true to purge anyway — ` +
            `their content goes dark too.`,
          { referents: others.map((o) => ({ matterId: o.id, history: o.history })) },
        );
      }

      // FACT-FIRST: defer the physical delete to afterSeal (same as the handler). The dispatcher's
      // do:purge-content fact seals first; deleteContent runs post-seal.
      const doDelete = async () => {
        const { deleteContent } = await import("./contentStore.js");
        await deleteContent(hash);
      };
      if (ctx?.moment?.afterSeal) ctx.moment.afterSeal.push(doDelete);
      else await doDelete();

      return {
        matterId: String(matterId),
        hash,
        sharedReferents: others.length,
        factParams: { hash, force: forced, referents: others.length },
      };
    },
  };
}
