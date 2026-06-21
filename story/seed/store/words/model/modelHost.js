// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// modelHost.js — host-escape glue for model.word's `host:` escapes (store/words/model/,
// the set-model DO op). Wires the SAME primitives the JS setModelHandler calls into
// ctx.env.host so model.word can reach the genuine COMPUTE through `see`/`host:` escapes.
// NO reimplementation — every escape below calls the exact same logic the JS handler ran.
//
// THE DESIGN — param-ENRICHMENT, NOT a direct emit. set-model lays no fact of its own:
// it MUTATES the op's `params` (field / value / merge, the set-<kind> shape) in place, and
// the dispatcher's auto-fact (do.js — no skipAudit) + the qualities reducer apply the
// write as one more deep set. So the four escapes here CLOSE OVER the op's `params` object
// (modelHostEnv(params)) and mutate it; the JS fallback keeps working unchanged because it
// enriches the SAME object. The two pure-COMPUTE escapes (assert-may-set-model the per-kind
// auth gate, resolve-model-block the content-store snapshot) lay nothing and read no params.
//
// Four escapes (callHost invokes each as `fn({ args: [...] }, ctx)`):
//   assert-may-set-model — the per-kind self/author/owner gate (throws on deny). Pure read.
//   resolve-model-block  — resolve the model matter + snapshot {matterId,hash,url,name},
//                          carry the optional scale/rotation. Content-store work, NO fact.
//   write-model          — validate forMatterType (space-only + a known type), then MUTATE
//                          the closed-over params to the set-<kind> {field,value,merge}.
//   clear-model          — MUTATE params to null the model at its field path.
//
// resolveModelMatter + assertMaySetModel are EXPORTED so index.js imports them back for the
// JS fallback (the bodies are verbatim from the pre-cut index.js). ensureSkinsSpace STAYS in
// index.js (genesis.js imports it from there).

import { IbpError, IBP_ERR } from "../../../ibp/protocol.js";
import { targetIdOf } from "../../../materials/_targetShape.js";

/** Resolve + validate a model matter: exists, type model, live cas bytes. */
export async function resolveModelMatter(modelMatterId, branch) {
  const { loadOrFold } = await import("../../../materials/projections.js");
  const slot = await loadOrFold("matter", String(modelMatterId), branch);
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

/** Self / author / owner gate per target kind. */
export async function assertMaySetModel(kind, targetId, identity, branch) {
  const actor = String(identity.beingId);
  const { loadOrFold } = await import("../../../materials/projections.js");

  if (kind === "being") {
    if (String(targetId) === actor) return; // your body is yours
    const slot = await loadOrFold("being", String(targetId), branch);
    const homeSpace = slot?.state?.homeSpace || null;
    if (homeSpace && await isRootOwner(homeSpace, actor)) return;
    throw new IbpError(IBP_ERR.FORBIDDEN, "set-model: only the being itself (or the tree owner) sets a being's model");
  }

  if (kind === "matter") {
    const slot = await loadOrFold("matter", String(targetId), branch);
    if (!slot) throw new IbpError(IBP_ERR.INVALID_INPUT, "set-model: target matter not found");
    if (String(slot.state?.beingId) === actor) return; // author
    if (slot.state?.spaceId && await isRootOwner(slot.state.spaceId, actor)) return;
    throw new IbpError(IBP_ERR.FORBIDDEN, "set-model: only the matter's author (or the tree owner) sets its model");
  }

  if (kind === "space") {
    const slot = await loadOrFold("space", String(targetId), branch);
    if (!slot) throw new IbpError(IBP_ERR.INVALID_INPUT, "set-model: target space not found");
    if (String(slot.state?.owner || "") === actor) return; // space owner
    if (await isRootOwner(String(targetId), actor)) return;
    throw new IbpError(IBP_ERR.FORBIDDEN, "set-model: only the space's owner (or the tree owner) sets its model");
  }

  throw new IbpError(IBP_ERR.INVALID_INPUT, `set-model: target must be being, space, or matter (got "${kind || "untyped"}")`);
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

// Build the host env for model.word, CLOSING OVER the op's `params` object so the
// write/clear escapes can ENRICH it in place (the set-<kind> {field,value,merge} shape the
// dispatcher's auto-fact reads). NO fact is laid here — enrichment, not emission.
export function modelHostEnv(params) {
  return {
    // The per-kind self/author/owner gate. Reads the moment's branch, calls the SAME
    // assertMaySetModel the JS handler calls (throws IbpError on deny). Returns true on pass.
    "assert-may-set-model": async ({ args: [kind, target, caller] }, ctx) => {
      const targetId = targetIdOf(target);
      const branch = historyOf(ctx);
      await assertMaySetModel(kind, targetId, { beingId: caller }, branch);
      return true;
    },

    // Resolve the model matter + snapshot its body (matterId/hash/url/name) and carry the
    // optional scale/rotation through to write-model. Content-store work, lays NO fact.
    "resolve-model-block": async ({ args: [modelMatterId, scale, rotation] }, ctx) => {
      const branch = historyOf(ctx);
      const modelMatter = await resolveModelMatter(String(modelMatterId), branch);
      return {
        model: {
          matterId: String(modelMatter._id),
          hash:     modelMatter.content.hash,
          url:      `/api/v1/content/${modelMatter.content.hash}`,
          name:     modelMatter.name || modelMatter.content.name || null,
        },
        scale:    typeof scale === "number" ? scale : null,
        rotation: rotation && typeof rotation === "object" ? rotation : null,
      };
    },

    // The write: validate forMatterType (space-only + a known matter type, throwing
    // IbpError otherwise), then MUTATE the closed-over params to the set-<kind>
    // {field,value,merge} shape. For a per-type space default the model block lands at the
    // deep matterModels path; for an entity-level set the render patch (model + optional
    // scale/rotation) merges into qualities.render. NO fact — the dispatcher's auto-fact
    // + the qualities reducer apply the enriched params.
    "write-model": async ({ args: [kind, forMatterType, bundle] }) => {
      const fmt = typeof forMatterType === "string" && forMatterType.length ? forMatterType : null;
      if (fmt) {
        if (kind !== "space") {
          throw new IbpError(IBP_ERR.INVALID_INPUT, "set-model: forMatterType applies to space targets only");
        }
        const { getMatterType } = await import("../../../materials/matter/types.js");
        if (!getMatterType(fmt)) {
          throw new IbpError(IBP_ERR.INVALID_INPUT, `set-model: unknown matter type "${fmt}"`);
        }
        params.field = `qualities.render.matterModels.${fmt}`;
        params.value = bundle.model;
        params.merge = true;
        return true;
      }
      const renderPatch = { model: bundle.model };
      if (typeof bundle.scale === "number" && Number.isFinite(bundle.scale) && bundle.scale > 0) {
        renderPatch.scale = bundle.scale;
      }
      if (bundle.rotation && typeof bundle.rotation === "object") {
        renderPatch.rotation = bundle.rotation;
      }
      params.field = "qualities.render";
      params.value = renderPatch;
      params.merge = true;
      return true;
    },

    // The clear: MUTATE the closed-over params to null the model at its field path (the
    // per-type space default path when forMatterType, else the entity model). NO fact.
    "clear-model": ({ args: [kind, forMatterType] }) => {
      const fmt = typeof forMatterType === "string" && forMatterType.length ? forMatterType : null;
      params.field = fmt ? `qualities.render.matterModels.${fmt}` : "qualities.render.model";
      params.value = null;
      params.merge = false;
      return true;
    },
  };
}
