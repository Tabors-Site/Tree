// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// matterHost.js — host-escape glue for create-matter (matter/ops.js, the
// create-matter DO op). Wires the SAME primitives the JS createMatterHandler
// calls into ctx.env.host so matter.word can reach the genuine COMPUTE through
// `host:` escapes (the strand the cut deletes). NO reimplementation — the spec
// build below is the exact orchestration the JS handler ran, calling the same
// imported functions.
//
// Two escapes:
//   resolveBirthSpec — all the genuine compute: parent-matter spaceId
//     inheritance (a gated loadOrFold), matter-type resolution (explicit OR
//     classifyMatter over the content's own shape), the type-registry gate
//     (getMatterType + typeAllowsContentKind + typeAllowsMime, which THROW on a
//     bad type/kind/mime — content-store work for putContent/hasContent), the
//     bounded unique-name search (resolveMatterName), the coord-bounds clamp,
//     and the content-addressed row id (matterContentId). Returns the finalized
//     enriched spec + the derived matterId. NO fact laid here.
//   emitBirth — the lone WORLD write: the content-addressed do:create-matter
//     birth fact, reusing the SAME emitFact the JS handler calls, laid into the
//     live moment via ctx.summonCtx. ATTRIBUTION: the fact's beingId is stamped
//     from `caller` (the real actor, passed as an arg — survives the bridge's
//     i-am identity override), and nameId rides summonCtx.actorAct.nameId. So a
//     caller-owned create attributes to the caller; the cut suppresses the i-am
//     override (pass iam=caller) so nameId is the caller's, matching the JS.
//
// callHost invokes each as `fn({ args: [...] }, ctx)`; the write fn reads
// ctx.summonCtx to lay its fact into the in-flight moment.

import { IbpError, IBP_ERR } from "../../ibp/protocol.js";
import { emitFact } from "../../past/fact/facts.js";
import { detectTargetKind, targetIdOf } from "../_targetShape.js";
import { resolveMatterName } from "./matters.js";
import { matterContentId } from "./matterId.js";

const branchOf = (ctx) =>
  ctx?.summonCtx?.actorAct?.branch || ctx?.branch || "0";

const COORD_AXES = ["x", "y", "z"];

// Validate a coord write against the matter's space size. Throws
// IbpError(INVALID_INPUT) on an out-of-bounds axis — the same doctrine
// (and the same shape) as createMatterHandler's assertMatterCoordInBounds.
async function assertMatterCoordInBounds(matterDoc, raw, branch = "0") {
  const out = {};
  for (const a of COORD_AXES) {
    if (typeof raw[a] === "number" && Number.isFinite(raw[a])) out[a] = raw[a];
  }
  if (Object.keys(out).length === 0) return null;
  const spaceId = matterDoc?.spaceId || null;
  if (!spaceId || spaceId === "deleted") return out;
  const { loadOrFold } = await import("../projections.js");
  const spaceSlot = await loadOrFold("space", spaceId, branch);
  const size = spaceSlot?.state?.size || null;
  if (!size) return out;
  for (const a of COORD_AXES) {
    if (out[a] === undefined) continue;
    const cap = typeof size[a] === "number" && size[a] > 0 ? size[a] : null;
    if (cap === null) continue;
    const high = Number.isInteger(out[a]) ? Math.trunc(cap) - 1 : cap - Number.EPSILON;
    if (out[a] < 0 || out[a] > high) {
      throw new IbpError(
        IBP_ERR.INVALID_INPUT,
        `set-matter: coord.${a}=${out[a]} is out of bounds (0..${high} for this space)`,
        { axis: a, value: out[a], cap: high },
      );
    }
  }
  return out;
}

export function matterHostEnv() {
  return {
    // The genuine compute: resolve the finalized birth spec + the content-
    // addressed matterId from the target + params + caller. The exact body
    // createMatterHandler ran, calling the same imported primitives. NO fact.
    "resolve-birth-spec": async ({ args: [target, targetKind, params, caller] }, ctx) => {
      const branch = branchOf(ctx);
      const spec = params || {};
      const kind = targetKind || detectTargetKind(target);

      const parentMatterId = kind === "matter"
        ? targetIdOf(target)
        : (spec.parentMatterId || null);

      // Space: a space target IS the space; a matter target lands the child in
      // its parent's space (inherit via a gated loadOrFold); explicit
      // spec.spaceId is the last resort.
      let spaceId = kind === "space" ? targetIdOf(target) : (spec.spaceId || null);
      if (!spaceId && parentMatterId) {
        const { loadOrFold } = await import("../projections.js");
        const parentSlot = await loadOrFold("matter", String(parentMatterId), branch);
        spaceId = parentSlot?.state?.spaceId || null;
      }

      const rawCreator = caller || spec.beingId || null;
      const beingIdValue = rawCreator ? String(rawCreator) : null;

      // Matter type: explicit when given, CLASSIFIED from the content's own
      // signals when omitted; the registry's contentKinds/mime gate below still
      // enforces the result.
      const { getMatterType, typeAllowsContentKind, typeAllowsMime } =
        await import("./types.js");
      let matterType = typeof spec.type === "string" && spec.type.length
        ? spec.type
        : null;
      const rawContent = spec.content ?? null;
      if (!matterType) {
        const { classifyMatter } = await import("./classify.js");
        const { isCasRef } = await import("./contentStore.js");
        const input = {};
        if (typeof rawContent === "string") input.text = rawContent;
        else if (isCasRef(rawContent)) {
          input.mimeType = rawContent.mimeType || null;
          input.fileName = rawContent.name || spec.name || null;
        } else if (rawContent && typeof rawContent === "object" && typeof rawContent.url === "string") {
          input.url = rawContent.url;
        }
        const top = classifyMatter(input)[0] || null;
        matterType = top?.type || "generic";
      }
      const typeDef = getMatterType(matterType);
      if (!typeDef) {
        throw new IbpError(
          IBP_ERR.INVALID_INPUT,
          `create-matter: unknown matter type "${matterType}"`,
        );
      }

      // Content through the store, shape-driven. Facts carry CAS refs, never
      // bytes: strings hash in; a {kind:"cas"} ref is verified to exist;
      // reference objects ride as-is for types carrying no owned bytes.
      let content = rawContent;
      {
        const { putContent, hasContent, isCasRef } = await import("./contentStore.js");
        if (typeof content === "string") {
          if (!typeAllowsContentKind(typeDef, "text")) {
            throw new IbpError(IBP_ERR.INVALID_INPUT,
              `create-matter: matter type "${matterType}" does not carry text content`);
          }
          content = await putContent(content, { encoding: "utf8", name: spec.name || null });
        } else if (isCasRef(content)) {
          if (!(await hasContent(content.hash))) {
            throw new IbpError(IBP_ERR.INVALID_INPUT,
              `create-matter: unknown content hash "${content.hash.slice(0, 12)}..." — upload the bytes first`);
          }
          const kindOfContent = content.encoding === "utf8" ? "text" : "binary";
          if (!typeAllowsContentKind(typeDef, kindOfContent)) {
            throw new IbpError(IBP_ERR.INVALID_INPUT,
              `create-matter: matter type "${matterType}" does not carry ${kindOfContent} content`);
          }
          if (!typeAllowsMime(typeDef, content.mimeType)) {
            throw new IbpError(IBP_ERR.INVALID_INPUT,
              `create-matter: MIME "${content.mimeType}" is not allowed for matter type "${matterType}"`);
          }
        } else if (content && typeof content === "object") {
          if (!typeAllowsContentKind(typeDef, "none")) {
            throw new IbpError(IBP_ERR.INVALID_INPUT,
              `create-matter: matter type "${matterType}" does not carry reference content`);
          }
        } else if (content == null) {
          if (!typeAllowsContentKind(typeDef, "none")) {
            throw new IbpError(IBP_ERR.INVALID_INPUT,
              `create-matter: matter type "${matterType}" requires content`);
          }
        } else {
          throw new IbpError(IBP_ERR.INVALID_INPUT,
            "create-matter: content must be a string, a cas content ref, a reference object, or null");
        }
      }

      // Name: explicit → the carried filename → a generated `<type><n>` unique
      // within this folder (space + parent matter).
      const name = await resolveMatterName({
        name: spec.name,
        content,
        type: matterType,
        branch,
        spaceId,
        parentMatterId,
      });

      // Coord at birth: validated against the destination space's size (throw,
      // never silently clamp).
      let coord = null;
      if (spec.coord && typeof spec.coord === "object" && !Array.isArray(spec.coord)) {
        coord = await assertMatterCoordInBounds({ spaceId }, spec.coord, branch);
      }

      const enrichedSpec = {
        ...spec,
        name,
        spaceId,
        parentMatterId,
        beingId: beingIdValue,
        type: matterType,
        content,
      };
      // Only the VALIDATED coord rides the fact; stray origin tags drop.
      delete enrichedSpec.coord;
      delete enrichedSpec.origin;
      if (coord && Object.keys(coord).length > 0) enrichedSpec.coord = coord;

      // Content-addressed id: derive from the finalized spec (the self is never
      // inside its own hash), carried as target.id.
      const matterId = matterContentId(enrichedSpec);

      return { enrichedSpec, matterId, spaceId, parentMatterId };
    },

    // The lone WORLD write: the content-addressed do:create-matter birth fact,
    // reusing the SAME emitFact the JS handler calls, laid into the live moment.
    // beingId is stamped from the real caller (survives the i-am override);
    // nameId rides summonCtx.actorAct.nameId (the cut suppresses the i-am
    // override so this is the caller's name, matching the JS handler).
    emitBirth: async ({ args: [birth, caller] }, ctx) => {
      const branch = branchOf(ctx);
      const summonCtx = ctx?.summonCtx || null;
      const enrichedSpec = birth?.enrichedSpec || {};
      const matterId = birth?.matterId;
      const actorBeingId = caller ? String(caller) : null;
      if (!actorBeingId) {
        throw new IbpError(
          IBP_ERR.UNAUTHORIZED,
          "create-matter requires an identified actor",
        );
      }
      await emitFact(
        {
          verb: "do",
          action: "create-matter",
          beingId: actorBeingId,
          target: { kind: "matter", id: matterId },
          params: enrichedSpec,
          actId: summonCtx?.actId || null,
          branch,
        },
        summonCtx,
      );
      return true;
    },
  };
}
