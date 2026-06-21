// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// set-model — give a being, space, or matter its 3D body.
//
// Models ARE matter (type "model", .glb bytes in the content store).
// The flow is two ops, cleanly split:
//
//   1. UPLOAD is create-matter: POST the bytes to /api/v1/content,
//      then `do create-matter { type: "model", content: <ref> }`
//      targeting the story root's `skins` space — the catalog
//      space that holds every uploaded model so the 3D portal can
//      display them all and beings can see which ids exist.
//
//   2. SET is this op: `do set-model { modelMatterId }` on a being,
//      space, or matter. Clicking a model in the skins space calls
//      this against your own being; copying the id lets you set it
//      on spaces/matter you own.
//
// The write lands at `qualities.render.model` — the same render
// namespace set-render owns — as the resolved block:
//
//   { matterId, hash, url, name }
//
// matterId is the source pointer (the model matter); hash + url are
// snapshotted so renderers load bytes straight from the content
// store with immutable caching, no second lookup.
//
// Who may set what:
//   being  — the being itself (your body is yours), or the root owner.
//   matter — the matter's author, or the root owner. Extension
//            authors set DEFAULTS for all matter of their type via
//            the type def's render.model; this op is the per-matter
//            override beings write into the story's history.
//   space  — the space's owner, or the root owner. A space's model
//            is its body in the PARENT's scene (the pyramid you
//            click to enter); the child carries its own model and
//            the parent's descriptor reaches into children to place
//            them.
//
// Targets being/space/matter — the cross-kind shape lives at
// materials/ root beside moveOp.js / portalOp.js for the same reason.

import { randomUUID as uuidv4 } from "node:crypto";
import { registerOperation } from "../../../ibp/operations.js";
import { IbpError, IBP_ERR } from "../../../ibp/protocol.js";
import { detectTargetKind, targetIdOf } from "../../../materials/_targetShape.js";
import { I_AM } from "../../../materials/being/seedBeings.js";
import { registerRoleWord } from "../../../present/word/roleWordRegistry.js";
// The auth gate + the model-matter resolve moved to modelHost.js (the host-escape glue);
// import them back for the JS fallback below (the bodies are verbatim).
import { resolveModelMatter, assertMaySetModel } from "./modelHost.js";

// Self-register this slice's co-located WORLD strand (CONVERTING.md): the bridge resolves
// ("render", "set-model") to model.word, its host escapes wired by modelHost.js. WIRED:
// _setModelViaWord runs the `.word` through the bridge (CALLER mode); the JS
// setModelHandler below is the clean-miss fallback.
registerRoleWord("render", "set-model", new URL("./model.word", import.meta.url));

const SKINS_SPACE_NAME = "skins";

/**
 * Find (or mint) the story root's `skins` space — the model
 * catalog. A normal space, not heaven: it forks with branches like
 * everything else, so each branch shows its own models. Called at
 * boot (genesis background furniture) so uploads always have a home;
 * idempotent by name-under-root.
 */
export async function ensureSkinsSpace(branch = "0", moment = null) {
  const { getSpaceRootId } = await import("../../../sprout.js");
  const rootId = getSpaceRootId();
  if (!rootId) throw new IbpError(IBP_ERR.INTERNAL, "ensureSkinsSpace: story root not ready");

  const { default: Projection } = await import("../../../materials/history/projection.js");
  // Branch-local first, then main's inherited row (the lazy-fill
  // idiom): the catalog is minted on main and inherited by branches.
  for (const b of branch === "0" ? ["0"] : [branch, "0"]) {
    const row = await Projection.findOne({
      history: b, type: "space",
      "state.parent": String(rootId),
      "state.name": SKINS_SPACE_NAME,
      tombstoned: { $ne: true },
    }).select("id").lean();
    if (row) return String(row.id);
  }

  const id = uuidv4();
  const { emitFact } = await import("../../../past/fact/facts.js");
  await emitFact({
    verb:    "do",
    act:     "create-space",
    through: I_AM,
    of:      { kind: "space", id },
    params: {
      name:   SKINS_SPACE_NAME,
      type:   "space",
      parent: String(rootId),
      size:   { x: 100, y: 100 },
      qualities: {},
    },
    actId:  moment?.actId || null,
    history: branch,
  }, moment);
  return id;
}

// set-model's world strand is model.word: the auth gate, the model-block resolve, and the
// set-<kind> param-enrichment (via the host). CALLER mode (no `through`): the set attributes
// to the asker. Returns {set:true,...} / {cleared:true,...} with params enriched in place
// (field/value/merge), or null on a clean miss so the JS body runs. WordRefusal → IbpError.
async function _setModelViaWord({ target, params, caller, moment }) {
  if (!moment) return null;
  const { resolveRoleWord, runRoleWord } = await import("../../../present/word/roleWordRegistry.js");
  const ir = resolveRoleWord("render", "set-model", moment?.actorAct?.history);
  if (!ir) return null;
  const { modelHostEnv } = await import("./modelHost.js");
  const branch = moment?.actorAct?.history;
  try {
    const { result } = await runRoleWord(ir, {
      moment, branch,
      trigger: {
        target,
        kind: detectTargetKind(target),
        caller: caller ? String(caller) : null,
        modelMatterId: params?.modelMatterId ?? null,
        scale: params?.scale ?? null,
        rotation: params?.rotation ?? null,
        clear: params?.clear ?? false,
        forMatterType: params?.forMatterType ?? null,
        branch,
      },
      // The host env CLOSES OVER the op's params so write-model/clear-model enrich it in
      // place (the same object the dispatcher's auto-fact reads). NO emit, NO skipAudit.
      env: { host: modelHostEnv(params) },
    });
    return result || null;
  } catch (e) {
    if (e && e.__wordRefusal) throw new IbpError(e.code || IBP_ERR.INVALID_INPUT, e.message);
    throw e;
  }
}

async function setModelHandler({ target, params, identity, moment }) {
  if (!identity?.beingId) {
    throw new IbpError(IBP_ERR.UNAUTHORIZED, "set-model: identity required");
  }
  // THE CONVERSION: set-model's world strand is model.word (caller mode). It enriches the
  // op's params (field/value/merge) in place and returns the §7 result; the JS body below
  // is the clean-miss fallback.
  const viaWord = await _setModelViaWord({ target, params, caller: identity.beingId, moment });
  if (viaWord) return viaWord;

  const kind = detectTargetKind(target);
  const targetId = targetIdOf(target);
  if (!targetId) throw new IbpError(IBP_ERR.INVALID_INPUT, "set-model: target required");
  const branch = moment?.actorAct?.history || "0";

  await assertMaySetModel(kind, targetId, identity, branch);

  // forMatterType: a SPACE-level default for every matter of one type
  // sitting in that space ("all notes here look like this"). Lives at
  // the space's qualities.render.matterModels.<type>; the descriptor
  // resolves matter models as per-matter override → space per-type
  // default → the type def's extension default.
  const forMatterType = typeof params?.forMatterType === "string" && params.forMatterType.length
    ? params.forMatterType
    : null;
  if (forMatterType) {
    if (kind !== "space") {
      throw new IbpError(IBP_ERR.INVALID_INPUT, "set-model: forMatterType applies to space targets only");
    }
    const { getMatterType } = await import("../../../materials/matter/types.js");
    if (!getMatterType(forMatterType)) {
      throw new IbpError(IBP_ERR.INVALID_INPUT, `set-model: unknown matter type "${forMatterType}"`);
    }
  }
  const fieldPath = forMatterType
    ? `qualities.render.matterModels.${forMatterType}`
    : "qualities.render.model";

  // The op stamps its OWN fact (action "set-model"): the handler did
  // the authorization above (self/author/owner), so delegating the
  // write to set-<kind> would wrongly demand the caller also hold
  // set-being:render etc. wherever they stand (you wear a model from
  // /skins while standing in /skins). The fact carries the same
  // {field, value, merge} shape the set-<kind> trio uses — params are
  // enriched in place (the grant-role pattern) and the qualities
  // reducer applies it as one more deep write.

  // ── Clear path ──
  if (params?.clear === true || params?.clear === "true") {
    params.field = fieldPath;
    params.value = null;
    params.merge = false;
    return { cleared: true, kind, targetId: String(targetId), ...(forMatterType ? { forMatterType } : {}) };
  }

  if (!params?.modelMatterId) {
    throw new IbpError(
      IBP_ERR.INVALID_INPUT,
      "set-model: `modelMatterId` required (upload first via create-matter type=model, or pass clear=true)",
    );
  }
  const modelMatter = await resolveModelMatter(String(params.modelMatterId), branch);
  const model = {
    matterId: String(modelMatter._id),
    hash:     modelMatter.content.hash,
    url:      `/api/v1/content/${modelMatter.content.hash}`,
    name:     modelMatter.name || modelMatter.content.name || null,
  };

  // One render write, one fact. Per-type space defaults write only
  // the model block at their deep path; entity-level sets can bundle
  // scale/rotation, merged into the existing render block (the
  // animations/sounds channels stay untouched).
  if (forMatterType) {
    params.field = fieldPath;
    params.value = model;
    params.merge = true;
    return { set: true, kind, targetId: String(targetId), forMatterType, model };
  }
  const renderPatch = { model };
  if (typeof params?.scale === "number" && Number.isFinite(params.scale) && params.scale > 0) {
    renderPatch.scale = params.scale;
  }
  if (params?.rotation && typeof params.rotation === "object") {
    renderPatch.rotation = params.rotation;
  }
  params.field = "qualities.render";
  params.value = renderPatch;
  params.merge = true;

  return { set: true, kind, targetId: String(targetId), model };
}

registerOperation("set-model", {
  targets: ["being", "space", "matter"],
  ownerExtension: "seed",
  factAction: "set-model",
  args: {
    modelMatterId: { type: "text", label: "Model matter id (a type=model matter, e.g. from /skins)", required: false },
    forMatterType: { type: "text", label: "Space targets only: set as the default for all matter of this type in the space", required: false },
    scale:         { type: "json", label: "Scale (positive number, optional)", required: false },
    rotation:      { type: "json", label: "Rotation {x,y,z} (optional)", required: false },
    clear:         { type: "bool", label: "Remove the model", default: false, required: false },
  },
  handler: setModelHandler,
});
