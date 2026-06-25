// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// modelHost.js — host-escape glue for model.word's `see` escapes (store/words/model/,
// the set-model DO op). Wires the SAME primitives the old JS setModelHandler called into
// ctx.env.host so model.word can reach the genuine COMPUTE through `see` escapes. NO
// reimplementation — every escape below calls the exact same logic the handler ran.
//
// THE DESIGN — the word AUTHORS its fact, the host READS. set-model lays no separate fact:
// the dispatcher's auto-fact (do.js runOpWord → stampsWordFact) stamps the ONE caller-
// attributed do:set-model. model.word RETURNS that fact's params (field / value / merge,
// the set-<kind> shape) as `factParams` plus a {kind,id} `factTarget` (the dynamic reel:
// being | space | matter); the qualities reducer applies the write. The host escapes are
// PURE READS — they compute the field/value/merge block and RETURN it; they mutate nothing
// (no closed-over params, so the generic runOpWord can call modelHostEnv() with no args),
// lay no fact, and are spoken as `see` (a see is inert).
//
// SEE_FLOOR is a CLOSED set (17.md) — a `.word` may only call see-ops on the recognized list,
// so this slice reuses its two existing floor names: assert-may-set-model and resolve-model-block.
//
// Two escapes (callHost invokes each as `fn({ args: [...] }, ctx)`):
//   assert-may-set-model — the per-kind self/author/owner gate (throws on deny). Returns true.
//   resolve-model-block  — the ONE block builder, branched on `clear`. SET: resolve the model
//                          matter + snapshot {matterId,hash,url,name}, validate forMatterType
//                          (space-only + a known type), build the set-<kind> {field,value,merge}
//                          (a per-type space default at qualities.render.matterModels.<type>, else
//                          {model[,scale][,rotation]} merged into qualities.render). CLEAR: the
//                          {field, value:null, merge:false} that nulls the model at its field path.
//                          Content-store work + field-path computation; lays NO fact.
//
// resolveModelMatter + assertMaySetModel stay EXPORTED (the slice's reusable primitives).
// ensureSkinsSpace STAYS in index.js (genesis.js imports it from there).

import { IbpError, IBP_ERR } from "../../../ibp/protocol.js";
import { targetIdOf } from "../../../materials/_targetShape.js";

/** Resolve + validate a model matter: exists, type model, live cas bytes. */
export async function resolveModelMatter(modelMatterId, history) {
  const { loadOrFold } = await import("../../../materials/projections.js");
  const slot = await loadOrFold("matter", String(modelMatterId), history);
  if (!slot) {
    throw new IbpError(IBP_ERR.INVALID_INPUT, `set-model: model matter "${modelMatterId}" not found`);
  }
  const matter = { _id: slot.id, ...(slot.state || {}) };
  if ((matter.type || "generic") !== "model") {
    throw new IbpError(
      IBP_ERR.INVALID_INPUT,
      `set-model: matter "${modelMatterId}" is type "${matter.type || "generic"}", not "model"`,
    );
  }
  const { isCasRef } = await import("../../../materials/matter/contentStore.js");
  if (!isCasRef(matter.content)) {
    throw new IbpError(IBP_ERR.INVALID_INPUT, "set-model: model matter carries no stored bytes");
  }
  if (matter.content.purged) {
    throw new IbpError(IBP_ERR.INVALID_INPUT, "set-model: this model's bytes were purged");
  }
  return matter;
}

/** Per-kind self / author / owner auth READ. Returns true iff the actor may set this target's
 *  model, false otherwise (a missing target folds to false). NO throw — the decision is the
 *  .word's gate (mirrors owner's may-set-owner): the word refuses (forbidden) on false. */
export async function maySetModel(kind, targetId, identity, history) {
  const actor = String(identity.beingId);
  const { loadOrFold } = await import("../../../materials/projections.js");

  if (kind === "being") {
    if (String(targetId) === actor) return true; // your body is yours
    const slot = await loadOrFold("being", String(targetId), history);
    const homeSpace = slot?.state?.homeSpace || null;
    return Boolean(homeSpace && (await isRootOwner(homeSpace, actor)));
  }

  if (kind === "matter") {
    const slot = await loadOrFold("matter", String(targetId), history);
    if (!slot) return false;
    if (String(slot.state?.beingId) === actor) return true; // author
    return Boolean(slot.state?.spaceId && (await isRootOwner(slot.state.spaceId, actor)));
  }

  if (kind === "space") {
    const slot = await loadOrFold("space", String(targetId), history);
    if (!slot) return false;
    if (String(slot.state?.owner || "") === actor) return true; // space owner
    return await isRootOwner(String(targetId), actor);
  }

  return false; // untyped target
}

async function isRootOwner(spaceId, actorId) {
  try {
    const { resolveRootSpace } = await import("../../../materials/space/spaces.js");
    const { getSpaceOwner } = await import("../../../materials/space/members.js");
    const root = await resolveRootSpace(String(spaceId));
    return String(getSpaceOwner(root) || "") === String(actorId);
  } catch {
    return false;
  }
}

const historyOf = (ctx) =>
  ctx?.moment?.actorAct?.history || ctx?.history || "0";

// Normalize forMatterType: a non-empty string or null. Shared by both block builders.
function normalizeForMatterType(forMatterType) {
  return typeof forMatterType === "string" && forMatterType.length ? forMatterType : null;
}

// Build the host env for model.word. NO closed-over params — every escape is a pure READ
// that RETURNS its result; the word promotes it to the fact (factParams / factTarget) and
// the dispatcher stamps the one do:set-model. modelHostEnv() takes no args (the generic
// runOpWord calls hostEnv() with none).
export function modelHostEnv() {
  return {
    // The per-kind self/author/owner auth READ. Returns true iff the actor may set this target's
    // model; the .word refuses (forbidden) on false. No throw — the decision is the word's gate.
    "may-set-model": async ({ args: [kind, target, caller] }, ctx) => {
      const targetId = targetIdOf(target);
      const history = historyOf(ctx);
      return await maySetModel(kind, targetId, { beingId: caller }, history);
    },

    // resolve-model-block — the ONE see (reusing the SEE_FLOOR name; the door is a closed set)
    // that builds the do:set-model fact's params: the set-<kind> { field, value, merge }. Two
    // shapes, branched on `clear`:
    //
    //   clear=true  → null the model at its field path (no model resolve): the per-type space
    //                 default path (qualities.render.matterModels.<type>) when forMatterType,
    //                 else the entity model (qualities.render.model). value:null, merge:false.
    //
    //   clear=false → resolve the model matter + snapshot its body ({matterId,hash,url,name}),
    //                 validate forMatterType (space-only + a known matter type, throwing
    //                 IbpError otherwise), and build the block: a per-type space default lands
    //                 the model block at the deep matterModels path (merge:true); an entity-level
    //                 set merges the render patch (model + optional positive scale + rotation)
    //                 into qualities.render.
    //
    // Content-store work + the field-path computation; lays NO fact (the word promotes the
    // returned block to factParams; the dispatcher stamps the one do:set-model).
    "resolve-model-block": async ({ args: [kind, modelMatterId, scale, rotation, forMatterType, clear] }, ctx) => {
      const fmt = normalizeForMatterType(forMatterType);

      if (clear === true || clear === "true") {
        return {
          field: fmt ? `qualities.render.matterModels.${fmt}` : "qualities.render.model",
          value: null,
          merge: false,
        };
      }

      const history = historyOf(ctx);
      const modelMatter = await resolveModelMatter(String(modelMatterId), history);
      const model = {
        matterId: String(modelMatter._id),
        hash:     modelMatter.content.hash,
        url:      `/api/v1/content/${modelMatter.content.hash}`,
        name:     modelMatter.name || modelMatter.content.name || null,
      };

      if (fmt) {
        if (kind !== "space") {
          throw new IbpError(IBP_ERR.INVALID_INPUT, "set-model: forMatterType applies to space targets only");
        }
        const { getMatterType } = await import("../../../materials/matter/types.js");
        if (!getMatterType(fmt)) {
          throw new IbpError(IBP_ERR.INVALID_INPUT, `set-model: unknown matter type "${fmt}"`);
        }
        return { field: `qualities.render.matterModels.${fmt}`, value: model, merge: true };
      }

      const renderPatch = { model };
      if (typeof scale === "number" && Number.isFinite(scale) && scale > 0) {
        renderPatch.scale = scale;
      }
      if (rotation && typeof rotation === "object") {
        renderPatch.rotation = rotation;
      }
      return { field: "qualities.render", value: renderPatch, merge: true };
    },
  };
}
