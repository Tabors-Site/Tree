// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// matter/ops.js — DO operations that target Matter.
//
//   set-matter     — write a Matter field (schema fields or qualities)
//   rename-matter  — first-class rename (per-folder uniqueness check)
//   end-matter     — chain-disconnect target Matter from the projection
//   purge-content  — physically delete the bytes behind a content hash
//
// create-matter was carved out into store/words/create-matter/ (its
// own MOVE-INERT bundle, registered via seed/services.js).
//
// These self-register at module load. `seed/services.js` imports this
// file for side effects; the registry is populated before any caller
// dispatches.

import { registerOperation } from "../../ibp/operations.js";
import { IbpError, IBP_ERR } from "../../ibp/protocol.js";
import { targetIdOf, loadTargetRow } from "../_targetShape.js";
import { assertMatterCoordInBounds } from "./coordBounds.js";
import { registerAbleWord } from "../../present/word/ableWordRegistry.js";
import { stampsFact } from "../../ibp/factResult.js";
import { renameMatterHostEnv } from "./renameMatterHost.js";

// Self-register the co-located world strand so resolveAbleWord("matter", "rename-matter") finds it
// (CONVERTING.md step 3). rename-matter is WORD-SOLE: rename-matter.word is the ONLY path (do.js
// runOpWord runs it); there is no JS handler to fall back to.
registerAbleWord("matter", "rename-matter", new URL("./rename-matter.word", import.meta.url));

const RESERVED_SET_META_NS = new Set([
  // none today; the set kept for symmetry with space/being
]);

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

async function setOnMatterHandler({ target, params, moment }) {
  const { field, value, merge = true } = params || {};
  if (!field || typeof field !== "string") {
    throw new Error("set-matter: `field` is required");
  }
  // Load the row at the top — set-matter needs spaceId for coord
  // clamping plus the doc for id-emitting return shapes. Passes
  // moment so an in-moment chain (create-matter → set-matter
  // before seal) reads the in-flight spec from deltaF when the row
  // hasn't materialized yet.
  target = await loadTargetRow(target, "matter", { moment });

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

  // content: the matter's bytes. Accepts a CAS ref ({kind:"cas",
  // hash, ...}) the caller has already put into the content store
  // (mirror-mount writes flow through here; vim splices, FUSE
  // truncate, etc.), or null to clear. The handler verifies the
  // hash actually lives in the store so a fact never references
  // missing bytes.
  if (field === "content") {
    if (value === null) {
      return { matterId: String(target._id), content: null };
    }
    const { isCasRef, hasContent } = await import("./contentStore.js");
    if (!isCasRef(value)) {
      throw new IbpError(
        IBP_ERR.INVALID_INPUT,
        "set-matter: content value must be a CAS ref ({kind:\"cas\", hash, ...}) or null",
      );
    }
    if (!(await hasContent(value.hash))) {
      throw new IbpError(
        IBP_ERR.INVALID_INPUT,
        `set-matter: unknown content hash "${String(value.hash).slice(0, 12)}..." (bytes not in store)`,
      );
    }
    return { matterId: String(target._id), content: value };
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
    const clamped = await assertMatterCoordInBounds(target, value, moment?.actorAct?.history || "0");
    return { matterId: String(target._id), coord: clamped };
  }

  throw new Error(
    `set-matter: unknown field "${field}". Supported: name, content, spaceId, beingId, coord, qualities.<namespace>[.<innerKey>]`,
  );
}

// ─────────────────────────────────────────────────────────────────────
// rename-matter — WORD-SOLE (registered below). No JS handler.
// ─────────────────────────────────────────────────────────────────────
//
// First-class verb for "the matter's name changes." Live writes
// (mirror-mount FUSE rename, future portal rename gestures) come
// through here so the audit trail names the intent ("I renamed this
// matter") instead of recording a bare set-matter on the name field.
//
// rename-matter.word is the SOLE path. The `name`-required gate + the
// return are the .word; the world READ (load the matter, require its
// spaceId, run the per-(spaceId, parentMatterId) folder-uniqueness
// check) is the host see-op resolve-rename-spec (renameMatterHost.js),
// reaching loadTargetRow + listMatterNamesInFolder. The .word returns
// { matterId, name, factParams: { field:"name", value } }; do.js's
// runOpWord promotes factParams + the matter target (idFrom:"matterId")
// via stampsWordFact, so the lone do:rename-matter fact lands on the
// matter's reel and applySetField folds the name exactly like set-being
// / set-space lay a scalar field.

// ─────────────────────────────────────────────────────────────────────
// end-matter
// ─────────────────────────────────────────────────────────────────────

async function endMatterHandler({ target, identity, moment }) {
  const matterId = targetIdOf(target);
  if (!matterId) throw new Error("end-matter: matterId required");
  const history = moment?.actorAct?.history || "0";
  const { endMatter } = await import("./matters.js");
  let beingId = identity?.beingId;
  if (!beingId) {
    const { loadOrFold } = await import("../projections.js");
    const matterSlot = await loadOrFold("matter", matterId, history);
    beingId = matterSlot?.state?.beingId || null;
  }
  await endMatter({
    matterId,
    beingId: String(beingId || ""),
    actId: moment?.actId || null,
    sessionId: moment?.sessionId || null,
    moment,
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
// Auth: the able-walk gates canDo "purge-content" (advertised on the
// file/model types); the handler additionally enforces
// author-or-root-owner, same shape as endMatter.

async function purgeContentHandler({ target, params, identity, moment }) {
  const matterId = targetIdOf(target);
  if (!matterId) throw new IbpError(IBP_ERR.INVALID_INPUT, "purge-content: matter target required");
  if (!identity?.beingId) {
    throw new IbpError(IBP_ERR.UNAUTHORIZED, "purge-content: identity required");
  }
  const history = moment?.actorAct?.history || "0";

  const { loadOrFold } = await import("../projections.js");
  const slot = await loadOrFold("matter", String(matterId), history);
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

  // Shared-fate refcount: other live matter (any history) whose CURRENT
  // content is this hash. Purging would blind them — refuse without
  // force.
  const force = params?.force === true || params?.force === "true";
  const { default: Projection } = await import("../history/projection.js");
  const others = await Projection.find({
    type: "matter",
    "state.content.hash": hash,
    tombstoned: { $ne: true },
    id: { $ne: String(matterId) },
  }).select("id history").lean();
  if (others.length > 0 && !force) {
    throw new IbpError(
      IBP_ERR.RESOURCE_CONFLICT,
      `purge-content: ${others.length} other matter row(s) reference these same bytes ` +
      `(content is deduplicated by hash). Pass force=true to purge anyway — ` +
      `their content goes dark too.`,
      { referents: others.map((o) => ({ matterId: o.id, history: o.history })) },
    );
  }

  // ONE act, ONE fact (23.md): purge-content returns its OWN do:purge-content fact (the dispatcher
  // stamps it; applyPurgeContent folds it, marking the ref purged) — no self-emit, no skipAudit. The
  // physical delete still runs AFTER the moment seals (afterSeal), so the chain explains the missing
  // bytes BEFORE they go (fact-first is preserved: the dispatcher's fact seals in-moment, then the host
  // deleteContent runs post-seal). deleteContent is the host floor, gated by the refcount check above.
  const doDelete = async () => {
    const { deleteContent } = await import("./contentStore.js");
    await deleteContent(hash);
  };
  if (moment?.afterSeal) {
    moment.afterSeal.push(doDelete);
  } else {
    await doDelete();
  }

  return stampsFact(
    { purged: true, matterId: String(matterId), hash, sharedReferents: others.length },
    { hash, force, referents: others.length },
    { kind: "matter", id: String(matterId) },
  );
}

// ─────────────────────────────────────────────────────────────────────
// Registration
// ─────────────────────────────────────────────────────────────────────

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

// WORD-SOLE: rename-matter.word is the only path (do.js runOpWord). idFrom:"matterId" targets
// the fact at the matter and promotes the word's factParams ({field:"name", value}); resolve-
// rename-spec (renameMatterHostEnv) is the lone host READ (load + folder-uniqueness). No handler.
registerOperation("rename-matter", {
  targets: ["matter"],
  ownerExtension: "seed",
  factAction: "rename-matter",
  args: {
    name: { type: "text", label: "New name (per-folder uniqueness enforced)", required: true },
  },
  word: { noun: "matter", idFrom: "matterId" },
  hostEnv: renameMatterHostEnv,
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
  // ONE act, ONE fact: the handler returns stampsFact and the dispatcher stamps the do:purge-content
  // fact (applyPurgeContent folds it); the physical delete runs on afterSeal, so fact-first holds.
  // No skipAudit (23.md: every act its own dispatcher-stamped fact).
  args: {
    hash:  { type: "text", label: "Content hash (defaults to the matter's current content)", required: false },
    force: { type: "bool", label: "Purge even when other matter shares these bytes", default: false, required: false },
  },
  handler: purgeContentHandler,
});
