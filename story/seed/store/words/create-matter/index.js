// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// `do create-matter` — bring a new Matter into existence under target
// (target may be a space or another matter parent).
//
// WIRED bundle (mirrors store/words/grant-role/index.js): create-matter's
// world strand is create-matter.word — the handler runs it through the bridge
// (resolveRoleWord -> runRoleWord, CALLER mode, host escapes wired by
// matterHost.js) with the JS createMatterHandler body as the clean-miss
// fallback. The .word is the live path; the JS body runs only on a clean miss.
//
// Carved out of materials/matter/ops.js, which still owns set-matter,
// rename-matter, end-matter, and purge-content. The coord-bounds check
// is the shared materials/matter/coordBounds.js (one canonical copy).
//
// params: flat object — see comment above createSpaceHandler in space/ops.js
//
// The op does NOT self-emit: resolve-birth-spec computes the enriched birth
// spec + content-addressed id, the handler returns them as _factParams +
// _factTarget, and the dispatcher's one auto-Fact path lays the caller-
// attributed do:create-matter Fact (eager-fold inside logFact runs
// applyCreateMatter to materialize the row). One Fact per birth, one emit
// path for every op (do.js auto-Fact).

import { registerOperation } from "../../../ibp/operations.js";
import { stampsFact, stampsWordFact } from "../../../ibp/factResult.js";
import { IbpError, IBP_ERR } from "../../../ibp/protocol.js";
import { registerRoleWord } from "../../../present/word/roleWordRegistry.js";
import { detectTargetKind, targetIdOf } from "../../../materials/_targetShape.js";
import { assertMatterCoordInBounds } from "../../../materials/matter/coordBounds.js";
import { resolveMatterName } from "../../../materials/matter/matters.js";
import { matterContentId } from "../../../materials/matter/matterId.js";

// Self-register this slice's co-located WORLD strand (CONVERTING.md): the
// bridge resolves ("matter", "create-matter") to create-matter.word, its host
// escapes wired by matterHost.js. Registered at module load (services.js
// imports this file at seed boot, and a DRY harness importing it triggers it
// too). WIRED: _createMatterViaWord runs the `.word` through the bridge; the JS
// createMatterHandler below is the clean-miss fallback.
registerRoleWord("matter", "create-matter", new URL("./create-matter.word", import.meta.url));

// create-matter's world strand is create-matter.word: the actor gate, the
// resolve-birth-spec compute (via the host), the content-addressed birth-fact
// emit (emitBirth), and the §7 return. CALLER mode (no `through`): the create
// attributes to the asker. Returns {matterId, spaceId, parentMatterId} or null
// on a clean miss so the JS body runs.
async function _createMatterViaWord({ target, params, caller, moment }) {
  if (!moment) return null;
  const { resolveRoleWord, runRoleWord } = await import("../../../present/word/roleWordRegistry.js");
  const ir = resolveRoleWord("matter", "create-matter", moment?.actorAct?.history);
  if (!ir) return null;
  const { matterHostEnv } = await import("./matterHost.js");
  const history = moment?.actorAct?.history;
  try {
    const { result } = await runRoleWord(ir, {
      moment, history,
      trigger: {
        target,
        targetKind: detectTargetKind(target),
        params: params || {},
        caller: caller ? String(caller) : null,
        branch: history,
      },
      env: { host: matterHostEnv() },
    });
    if (!result) return null;
    // The .word authored its fact as `factParams` (the enriched birth spec the matter
    // reducer folds). Land it: the dispatcher lays the one caller-attributed
    // do:create-matter fact, targeting the new MATTER (stampsWordFact forces _factTarget,
    // since resolveAuditTarget would otherwise pick the bare spaceId). No self-emit.
    return stampsWordFact(result, "matter", "matterId");
  } catch (e) {
    if (e && e.__wordRefusal) throw new IbpError(e.code || IBP_ERR.INVALID_INPUT, e.message);
    throw e;
  }
}

async function createMatterHandler(ctx) {
  const { target, params, identity, moment } = ctx;
  // THE CONVERSION: create-matter's world strand is create-matter.word (caller
  // mode). The JS body below is the clean-miss fallback.
  const viaWord = await _createMatterViaWord({ target, params, caller: identity?.beingId, moment });
  if (viaWord) return viaWord;

  const spec = params || {};
  const targetKind = detectTargetKind(target);

  const parentMatterId = targetKind === "matter"
    ? targetIdOf(target)
    : (spec.parentMatterId || null);

  // Space: a space target IS the space; a matter target (building the
  // matter tree) lands the child in its parent's space, so targeting a
  // folder-matter "just works" without restating the space. Explicit
  // spec.spaceId is the last resort.
  let spaceId = targetKind === "space" ? targetIdOf(target) : (spec.spaceId || null);
  if (!spaceId && parentMatterId) {
    const { loadOrFold } = await import("../../../materials/projections.js");
    const parentSlot = await loadOrFold("matter", String(parentMatterId), moment?.actorAct?.history || "0");
    spaceId = parentSlot?.state?.spaceId || null;
  }

  const rawCreator = identity?.beingId || spec.beingId || null;
  const beingIdValue = rawCreator ? String(rawCreator) : null;

  // Matter type: explicit when given, CLASSIFIED when omitted — "it
  // just becomes whatever was uploaded." The classifier reads the
  // content's own signals (a cas ref's mime/filename, a {url}
  // object, bare text) and adopts the top candidate; the registry's
  // contentKinds/mime enforcement below still gates the result.
  const { getMatterType, typeAllowsContentKind, typeAllowsMime } =
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

  // Content through the store, shape-driven (no origin tag — the
  // content's own shape plus the type's contentKinds decide). This
  // wire path bypasses matters.createMatter, so the same rule
  // applies here: facts carry CAS refs, never bytes. Strings hash
  // in; a `{kind:"cas"}` ref (two-step upload via POST
  // /api/v1/content) is verified to exist; reference objects
  // (http `{url}`, ibpa `{target}`) ride as-is for types that carry
  // no owned bytes.
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
      const kind = content.encoding === "utf8" ? "text" : "binary";
      if (!typeAllowsContentKind(typeDef, kind)) {
        throw new IbpError(IBP_ERR.INVALID_INPUT,
          `create-matter: matter type "${matterType}" does not carry ${kind} content`);
      }
      if (!typeAllowsMime(typeDef, content.mimeType)) {
        throw new IbpError(IBP_ERR.INVALID_INPUT,
          `create-matter: MIME "${content.mimeType}" is not allowed for matter type "${matterType}"`);
      }
    } else if (content && typeof content === "object") {
      // A reference shape — no owned bytes; legal for types declaring
      // contentKind "none".
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

  // Name: explicit → the filename of the bytes it carries ("report.pdf"
  // arrives named "report.pdf") → a generated `<type><n>` unique within
  // this folder (space + parent matter). Matter is always named, the
  // same guarantee spaces and beings carry.
  const name = await resolveMatterName({
    name: spec.name,
    content,
    type: matterType,
    history: moment?.actorAct?.history || "0",
    spaceId,
    parentMatterId,
  });

  // Coord at birth: matter can be born at a position. Same clamp
  // doctrine as set-matter's coord write (throw, never silently
  // clamp); validated against the destination space's size.
  let coord = null;
  if (spec.coord && typeof spec.coord === "object" && !Array.isArray(spec.coord)) {
    coord = await assertMatterCoordInBounds(
      { spaceId },
      spec.coord,
      moment?.actorAct?.history || "0",
    );
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
  // Only the VALIDATED coord rides the fact (a malformed spec.coord
  // must not leak through the spread into the reducer). Stray origin
  // tags from old callers are dropped — the field is retired.
  delete enrichedSpec.coord;
  delete enrichedSpec.origin;
  if (coord && Object.keys(coord).length > 0) enrichedSpec.coord = coord;
  const actorBeingId = identity?.beingId || null;
  if (!actorBeingId) {
    throw new IbpError(
      IBP_ERR.UNAUTHORIZED,
      "create-matter requires an identified actor",
    );
  }
  // Content-addressed id: derive it from the finalized birth spec (the
  // self is never inside its own hash), then carry it as target.id. The
  // same matter born the same way gets the same id.
  const matterId = matterContentId(enrichedSpec);
  // No self-emit: the act lays the enriched spec as the do:create-matter fact,
  // targeting the content-addressed matter; the dispatcher stamps the one fact.
  return stampsFact(
    { matterId, spaceId, parentMatterId },
    enrichedSpec,
    { kind: "matter", id: matterId },
  );
}

registerOperation("create-matter", {
  targets: ["space", "matter", "stance"],
  ownerExtension: "seed",
  factAction: "create-matter",
  args: {
    name: { type: "text", label: "Name (defaults to the uploaded filename)", required: false },
    type: { type: "text", label: "Matter type (omit to classify from the content)", required: false },
    content: { type: "multiline", label: "Content (text, a cas ref from upload, or a reference object like {url}; optional)", required: false },
    coord: { type: "json", label: "Position {x,y,z?} inside the space (optional)", required: false },
  },
  // The role-walk sees `create-matter:<type>` so roles can scope
  // which matter types they may bring into the world — bare
  // `create-matter` entries keep matching (namespace semantics, same
  // shape as grant-role:<role>).
  authAction: ({ params }) =>
    typeof params?.type === "string" && params.type.length
      ? `create-matter:${params.type}`
      : "create-matter",
  handler: createMatterHandler,
});
