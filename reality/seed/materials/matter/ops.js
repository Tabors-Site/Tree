// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// matter/ops.js — DO operations that target Matter.
//
//   create-matter — bring a new Matter into existence under target
//                   (target may be a space or another matter parent)
//   set-matter    — write a Matter field (schema fields or qualities)
//   end-matter    — chain-disconnect target Matter from the projection
//
// These self-register at module load. `seed/services.js` imports this
// file for side effects; the registry is populated before any caller
// dispatches.

import { registerOperation } from "../../ibp/operations.js";
import { IbpError, IBP_ERR } from "../../ibp/protocol.js";
import { emitFact } from "../../past/fact/facts.js";
import Matter from "./matter.js";
import Space from "../space/space.js";
import { I_AM } from "../being/seedBeings.js";
import { v4 as uuidv4 } from "uuid";
import { detectTargetKind, targetIdOf, loadTargetRow } from "../_targetShape.js";

const COORD_AXES = ["x", "y", "z"];

/**
 * Validate a coord write against the matter's space size. Throws
 * IbpError(INVALID_INPUT) on an out-of-bounds axis — the fact never
 * seals. Same doctrine as set-being:coord (see being/ops.js header
 * for assertCoordInBounds): silent clamping was a lie; throwing
 * keeps the chain honest.
 */
async function assertMatterCoordInBounds(matterDoc, raw, branch = "0") {
  const out = {};
  for (const a of COORD_AXES) {
    if (typeof raw[a] === "number" && Number.isFinite(raw[a])) {
      out[a] = raw[a];
    }
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

const RESERVED_SET_META_NS = new Set([
  // none today; the set kept for symmetry with space/being
]);

// ─────────────────────────────────────────────────────────────────────
// create-matter
// ─────────────────────────────────────────────────────────────────────
//
// params: flat object — see comment above createSpaceHandler in space/ops.js
//
// skipAudit because the handler stamps the do:create-matter Fact
// directly on the new matter's reel; eager-fold inside logFact runs
// applyCreateMatter to materialize the row. One Fact per birth.

async function createMatterHandler(ctx) {
  const { target, params, identity, summonCtx } = ctx;
  const spec = params || {};
  const targetKind = detectTargetKind(target);

  const matterId = uuidv4();

  const spaceId = targetKind === "space"
    ? targetIdOf(target)
    : (spec.spaceId || null);

  const parentMatterId = targetKind === "matter"
    ? targetIdOf(target)
    : (spec.parentMatterId || null);

  const rawCreator = identity?.beingId || spec.beingId || null;
  const beingIdValue = rawCreator ? String(rawCreator) : null;

  // Matter type: explicit when given, CLASSIFIED when omitted — "it
  // just becomes whatever was uploaded." The classifier reads the
  // content's own signals (a cas ref's mime/filename, a {url}
  // object, bare text) and adopts the top candidate; the registry's
  // contentKinds/mime enforcement below still gates the result.
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

  // Name: default from the content's own filename so uploads aren't
  // nameless ("report.pdf" arrives named "report.pdf").
  const name = (typeof spec.name === "string" && spec.name.length)
    ? spec.name
    : (content && typeof content === "object" && typeof content.name === "string" && content.name.length
        ? content.name
        : spec.name);

  // Coord at birth: matter can be born at a position. Same clamp
  // doctrine as set-matter's coord write (throw, never silently
  // clamp); validated against the destination space's size.
  let coord = null;
  if (spec.coord && typeof spec.coord === "object" && !Array.isArray(spec.coord)) {
    coord = await assertMatterCoordInBounds(
      { spaceId },
      spec.coord,
      summonCtx?.actorAct?.branch || "0",
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
  await emitFact(
    {
      verb: "do",
      action: "create-matter",
      beingId: String(actorBeingId),
      target: { kind: "matter", id: matterId },
      params: enrichedSpec,
      actId: summonCtx?.actId || null,
      // Branch this matter is created on — sourced from the moment ctx
      // so a plant under #1 lands matter on #1's reel, not main's.
      branch: summonCtx?.actorAct?.branch || "0",
    },
    summonCtx,
  );
  return {
    matterId,
    spaceId,
    parentMatterId,
  };
}

// ─────────────────────────────────────────────────────────────────────
// set-matter
// ─────────────────────────────────────────────────────────────────────
//
// params: { field, value, merge=true }
// field paths:
//   "name" / "content"                              → schema-field writes
//   "qualities.<namespace>"                          → set/merge that namespace
//   "qualities.<namespace>.<innerKey>"               → merge one inner key
//   value=null on a qualities path                   → unset

async function setOnMatterHandler({ target, params, summonCtx }) {
  const { field, value, merge = true } = params || {};
  if (!field || typeof field !== "string") {
    throw new Error("set-matter: `field` is required");
  }
  // Load the row at the top — set-matter needs spaceId for coord
  // clamping plus the doc for id-emitting return shapes. Passes
  // summonCtx so an in-moment chain (create-matter → set-matter
  // before seal) reads the in-flight spec from deltaF when the row
  // hasn't materialized yet.
  target = await loadTargetRow(target, "matter", { summonCtx });

  // ── qualities paths ────────────────────────────────────
  if (field.startsWith("qualities.")) {
    const rest = field.slice("qualities.".length);
    const parts = rest.split(".");
    const namespace = parts[0];
    if (RESERVED_SET_META_NS.has(namespace)) {
      throw new Error(
        `set-matter: qualities namespace "${namespace}" is not writable through set-matter; it has a dedicated verb.`,
      );
    }
    if (parts.length === 1 && value !== null) {
      if (typeof value !== "object") {
        throw new Error("set-matter: qualities-namespace value must be an object");
      }
    }
    return {
      written: true,
      matterId: String(target._id),
      ...(parts.length === 1 ? { namespace } : { field }),
      ...(value === null ? { unset: true } : {}),
    };
  }

  // ── schema-field writes ────────────────────────────────

  if (field === "name") {
    if (!value || typeof value !== "string") {
      throw new Error("set-matter: `value` must be a string for field=name");
    }
    return { matterId: String(target._id), name: value };
  }

  // spaceId: where the matter sits. Two valid value shapes:
  //   - bare space-id (transfer to a new space)
  //   - DELETED sentinel ("deleted") (soft-delete marker)
  if (field === "spaceId") {
    const { DELETED } = await import("../space/heavenSpaces.js");
    if (value === DELETED) {
      return { matterId: String(target._id), spaceId: DELETED };
    }
    if (typeof value !== "string" || !value.length) {
      throw new Error(
        `set-matter: spaceId must be a space id string or the DELETED sentinel . got ${typeof value}`,
      );
    }
    return { matterId: String(target._id), spaceId: value };
  }

  // beingId: who created the matter. Set-matter uses this only at
  // delete time to record DELETED. Live writes during create-matter
  // ride on the create-matter handler, not here.
  if (field === "beingId") {
    const { DELETED } = await import("../space/heavenSpaces.js");
    if (value === DELETED) {
      return { matterId: String(target._id), beingId: DELETED };
    }
    throw new Error(
      `set-matter: beingId only accepts the DELETED sentinel through set-matter; the creator is fixed at birth`,
    );
  }

  // coord: the matter's position inside spaceId. Same shape and
  // semantics as Being.coord — `{ x, y, z? }` clamped to Space.size.
  // A being moving matter inside a space writes here through the
  // standard set-matter path.
  if (field === "coord") {
    if (value === null || value === undefined) {
      return { matterId: String(target._id), coord: null };
    }
    if (typeof value !== "object" || Array.isArray(value)) {
      throw new Error("set-matter: `coord` value must be an object {x,y,z?} or null");
    }
    const clamped = await assertMatterCoordInBounds(target, value, summonCtx?.actorAct?.branch || "0");
    return { matterId: String(target._id), coord: clamped };
  }

  throw new Error(
    `set-matter: unknown field "${field}". Supported: name, coord, qualities.<namespace>[.<innerKey>]`,
  );
}

// ─────────────────────────────────────────────────────────────────────
// end-matter
// ─────────────────────────────────────────────────────────────────────

async function endMatterHandler({ target, identity, summonCtx }) {
  const matterId = targetIdOf(target);
  if (!matterId) throw new Error("end-matter: matterId required");
  const branch = summonCtx?.actorAct?.branch || "0";
  const { deleteMatterAndFile } = await import("./matters.js");
  let beingId = identity?.beingId;
  if (!beingId) {
    const { loadOrFold } = await import("../projections.js");
    const matterSlot = await loadOrFold("matter", matterId, branch);
    beingId = matterSlot?.state?.beingId || null;
  }
  await deleteMatterAndFile({
    matterId,
    beingId: String(beingId || ""),
    actId: summonCtx?.actId || null,
    sessionId: summonCtx?.sessionId || null,
    summonCtx,
  });
  return { removed: true, matterId };
}

// ─────────────────────────────────────────────────────────────────────
// purge-content
// ─────────────────────────────────────────────────────────────────────
//
// Physically delete the bytes behind a matter's content hash from the
// content store. The fact chain is append-only — the facts naming the
// hash remain, the projection marks the ref purged, and reads return
// the purged marker. This is the "I accidentally posted that"
// scalpel; background reclamation is casSweep's retention policy.
//
// Dedup makes purge a shared-fate decision: identical bytes are ONE
// blob, so other matter referencing the same hash goes dark too. The
// handler refuses when other live referents exist unless force=true —
// explicit, never silent.
//
// Auth: the role-walk gates canDo "purge-content" (advertised on the
// file/model types); the handler additionally enforces
// author-or-root-owner, same shape as deleteMatterAndFile.

async function purgeContentHandler({ target, params, identity, summonCtx }) {
  const matterId = targetIdOf(target);
  if (!matterId) throw new IbpError(IBP_ERR.INVALID_INPUT, "purge-content: matter target required");
  if (!identity?.beingId) {
    throw new IbpError(IBP_ERR.UNAUTHORIZED, "purge-content: identity required");
  }
  const branch = summonCtx?.actorAct?.branch || "0";

  const { loadOrFold } = await import("../projections.js");
  const slot = await loadOrFold("matter", String(matterId), branch);
  if (!slot) throw new IbpError(IBP_ERR.INVALID_INPUT, "purge-content: matter not found");
  const matter = { _id: slot.id, ...(slot.state || {}) };

  const { isCasRef } = await import("./contentStore.js");
  const hash = typeof params?.hash === "string" && params.hash.length
    ? params.hash
    : (isCasRef(matter.content) ? matter.content.hash : null);
  if (!hash) {
    throw new IbpError(IBP_ERR.INVALID_INPUT, "purge-content: matter has no stored content (pass `hash` for a historical version)");
  }

  // Owner gate: the matter's author or the tree's root owner.
  const { resolveRootSpace } = await import("../space/spaces.js");
  const { getSpaceOwner } = await import("../space/members.js");
  const rootSpace = matter.spaceId && matter.spaceId !== "deleted"
    ? await resolveRootSpace(matter.spaceId)
    : null;
  const isAuthor = String(matter.beingId) === String(identity.beingId);
  const isRootOwner = rootSpace
    ? String(getSpaceOwner(rootSpace) || "") === String(identity.beingId)
    : false;
  if (!isAuthor && !isRootOwner) {
    throw new IbpError(
      IBP_ERR.FORBIDDEN,
      "purge-content: only the matter author or the tree owner can purge its content",
    );
  }

  // Shared-fate refcount: other live matter (any branch) whose CURRENT
  // content is this hash. Purging would blind them — refuse without
  // force.
  const force = params?.force === true || params?.force === "true";
  const { default: Projection } = await import("../branch/projection.js");
  const others = await Projection.find({
    type: "matter",
    "state.content.hash": hash,
    tombstoned: { $ne: true },
    id: { $ne: String(matterId) },
  }).select("id branch").lean();
  if (others.length > 0 && !force) {
    throw new IbpError(
      IBP_ERR.RESOURCE_CONFLICT,
      `purge-content: ${others.length} other matter row(s) reference these same bytes ` +
      `(content is deduplicated by hash). Pass force=true to purge anyway — ` +
      `their content goes dark too.`,
      { referents: others.map((o) => ({ matterId: o.id, branch: o.branch })) },
    );
  }

  // Fact first — the chain explains the missing bytes. The physical
  // delete runs after the moment seals (afterSeal) so a refused seal
  // never leaves bytes gone without a fact; standalone callers (no
  // moment) emit-and-commit immediately, then delete.
  const { emitFact: _emit } = await import("../../past/fact/facts.js");
  await _emit({
    verb:    "do",
    action:  "purge-content",
    beingId: String(identity.beingId),
    target:  { kind: "matter", id: String(matterId) },
    params:  { hash, force, referents: others.length },
    actId:   summonCtx?.actId || null,
    branch,
  }, summonCtx);

  const doDelete = async () => {
    const { deleteContent } = await import("./contentStore.js");
    await deleteContent(hash);
  };
  if (summonCtx?.afterSeal) {
    summonCtx.afterSeal.push(doDelete);
  } else {
    await doDelete();
  }

  return { purged: true, matterId: String(matterId), hash, sharedReferents: others.length };
}

// ─────────────────────────────────────────────────────────────────────
// Registration
// ─────────────────────────────────────────────────────────────────────

registerOperation("create-matter", {
  targets: ["space", "matter", "stance"],
  ownerExtension: "seed",
  factAction: "create-matter",
  skipAudit: true,
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

registerOperation("set-matter", {
  targets: ["matter"],
  ownerExtension: "seed",
  factAction: "set-matter",
  // authorize keys this as do:set-matter:<namespace> when the field is
  // qualities.<namespace>... See operations.js isNamespaceKeyedAction.
  useNamespaceKey: true,
  args: {
    field: { type: "text", label: "Field (e.g. name, content, qualities.<ns>.<key>)", required: true },
    value: { type: "json", label: "Value (JSON; null to clear)", required: false },
    merge: { type: "bool", label: "Merge (for qualities objects)", default: true, required: false },
  },
  handler: setOnMatterHandler,
});

registerOperation("end-matter", {
  targets: ["matter"],
  ownerExtension: "seed",
  factAction: "end-matter",
  args: {},
  handler: endMatterHandler,
});

registerOperation("purge-content", {
  targets: ["matter"],
  ownerExtension: "seed",
  factAction: "purge-content",
  // The handler stamps the purge fact itself (fact-first, delete on
  // afterSeal); a second auto-fact would double-record the act.
  skipAudit: true,
  args: {
    hash:  { type: "text", label: "Content hash (defaults to the matter's current content)", required: false },
    force: { type: "bool", label: "Purge even when other matter shares these bytes", default: false, required: false },
  },
  handler: purgeContentHandler,
});
