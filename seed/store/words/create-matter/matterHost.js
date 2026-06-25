// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// matterHost.js — host-escape glue for create-matter (store/words/create-matter/,
// the create-matter DO op). Wires the SAME primitives the JS createMatterHandler
// calls into ctx.env.host so create-matter.word can reach the genuine COMPUTE through
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
//     live moment via ctx.moment. ATTRIBUTION: the fact's beingId is stamped
//     from `caller` (the real actor, passed as an arg — survives the bridge's
//     i-am identity override), and nameId rides moment.actorAct.by. So a
//     caller-owned create attributes to the caller; the cut suppresses the i-am
//     override (pass iam=caller) so nameId is the caller's, matching the JS.
//
// callHost invokes each as `fn({ args: [...] }, ctx)`; the write fn reads
// ctx.moment to lay its fact into the in-flight moment.

import { IbpError, IBP_ERR } from "../../../ibp/protocol.js";
import { emitFact } from "../../../past/fact/facts.js";
import { detectTargetKind, targetIdOf } from "../../../materials/_targetShape.js";
import { resolveMatterName } from "../../../materials/matter/matters.js";
import { matterContentId } from "../../../materials/matter/matterId.js";
import { assertMatterCoordInBounds } from "../../../materials/matter/coordBounds.js";

const historyOf = (ctx) =>
  ctx?.moment?.actorAct?.history || ctx?.history || "0";

export function matterHostEnv() {
  return {
    // The genuine compute: resolve the finalized birth spec + the content-
    // addressed matterId from the target + params + caller. The exact body
    // createMatterHandler ran, calling the same imported primitives. NO fact.
    "resolve-birth-spec": async ({ args: [target, targetKind, params, caller] }, ctx) => {
      const history = historyOf(ctx);
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
        const { loadOrFold } = await import("../../../materials/projections.js");
        const parentSlot = await loadOrFold("matter", String(parentMatterId), history);
        spaceId = parentSlot?.state?.spaceId || null;
      }

      const rawCreator = caller || spec.beingId || null;
      const beingIdValue = rawCreator ? String(rawCreator) : null;

      // Matter type: explicit when given, CLASSIFIED from the content's own
      // signals when omitted; the registry's contentKinds/mime gate below still
      // enforces the result.
      const { getMatterType, typeAllowsContentKind, typeAllowsMime, missingRequiredField } =
        await import("../../../materials/matter/types.js");
      let matterType = typeof spec.type === "string" && spec.type.length
        ? spec.type
        : null;
      const rawContent = spec.content ?? null;
      if (!matterType) {
        const { classifyMatter } = await import("../../../materials/matter/classify.js");
        const { isCasRef } = await import("../../../materials/matter/contentStore.js");
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
      // REQUIRED-FIELD validation (the `has` schema, all-rules-fold §4). Gated behind the type
      // declaring any required field, so schema-less types are unaffected. A declared field Y maps
      // to qualities.<type>.<Y>; an optional field ("may have") is not required.
      if (typeDef.fields?.length) {
        const missing = missingRequiredField(typeDef, spec.qualities);
        if (missing) {
          throw new IbpError(
            IBP_ERR.INVALID_INPUT,
            `create-matter: type "${matterType}" requires field "${missing}"`,
          );
        }
      }

      // Content through the store, shape-driven. Facts carry CAS refs, never
      // bytes: strings hash in; a {kind:"cas"} ref is verified to exist;
      // reference objects ride as-is for types carrying no owned bytes.
      let content = rawContent;
      {
        const { putContent, hasContent, isCasRef } = await import("../../../materials/matter/contentStore.js");
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
        history,
        spaceId,
        parentMatterId,
      });

      // Coord at birth: validated against the destination space's size (throw,
      // never silently clamp).
      let coord = null;
      if (spec.coord && typeof spec.coord === "object" && !Array.isArray(spec.coord)) {
        coord = await assertMatterCoordInBounds({ spaceId }, spec.coord, history);
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
    // nameId rides moment.actorAct.by (the cut suppresses the i-am
    // override so this is the caller's name, matching the JS handler).
    emitBirth: async ({ args: [birth, caller] }, ctx) => {
      const history = historyOf(ctx);
      const moment = ctx?.moment || null;
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
          act: "create-matter",
          through: actorBeingId,
          of: { kind: "matter", id: matterId },
          params: enrichedSpec,
          actId: moment?.actId || null,
          history,
        },
        moment,
      );
      return true;
    },
  };
}
