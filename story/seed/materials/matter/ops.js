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
import { targetIdOf } from "../_targetShape.js";
import { registerAbleWord } from "../../present/word/ableWordRegistry.js";
import { stampsFact } from "../../ibp/factResult.js";
import { renameMatterHostEnv } from "./renameMatterHost.js";
import { setMatterHostEnv } from "./setMatterHost.js";
import { purgeContentHostEnv } from "./purgeContentHost.js";
import { endMatterHostEnv } from "./endMatterHost.js";

// Self-register the co-located world strand so resolveAbleWord("matter", "rename-matter") finds it
// (CONVERTING.md step 3). rename-matter is WORD-SOLE: rename-matter.word is the ONLY path (do.js
// runOpWord runs it); there is no JS handler to fall back to.
registerAbleWord("matter", "rename-matter", new URL("./rename-matter.word", import.meta.url));

// set-matter is WORD-SOLE: set-matter.word is the ONLY path (do.js runOpWord runs it); there is no
// JS handler. The genuine substrate reads (CAS-content existence, DELETED sentinel, coord-bounds)
// bottom out in resolve-set-matter-spec (setMatterHost.js), reusing loadTargetRow + isCasRef/
// hasContent + assertMatterCoordInBounds — the SAME helpers the old handler called.
registerAbleWord("matter", "set-matter", new URL("./set-matter.word", import.meta.url));
registerAbleWord("matter", "purge-content", new URL("./purge-content.word", import.meta.url));

// end-matter is WORD-SOLE: end-matter.word is the ONLY path (do.js runOpWord runs it); there is no JS
// handler. There is no host out (bytes are content-addressed; the reducer folds the tombstone from the
// do:end-matter verb). The lone substrate read is the author-or-root-owner auth in resolve-end-matter-
// spec (endMatterHost.js), reusing loadTargetRow + resolveRootSpace + getSpaceOwner.
registerAbleWord("matter", "end-matter", new URL("./end-matter.word", import.meta.url));

// ─────────────────────────────────────────────────────────────────────
// set-matter — WORD-SOLE (registered below). No JS handler.
// ─────────────────────────────────────────────────────────────────────
//
// Write one Matter field — a schema scalar (name / content / spaceId / beingId / coord) or a
// qualities path (qualities.<ns>[.<inner>]). set-matter.word is the SOLE path. The CONTROL strand
// (the `field`-required gate + the return) is the .word; the genuine substrate READS — load the
// matter row, the CAS-content existence check (isCasRef + hasContent), the DELETED-sentinel
// comparisons, and the COORD-BOUNDS check (assertMatterCoordInBounds reads Space.size and THROWS) —
// are the host see-op resolve-set-matter-spec (setMatterHost.js), reaching the SAME helpers the old
// handler called. The .word returns { matterId, factParams }; do.js's runOpWord promotes factParams +
// the matter target (idFrom:"matterId") via stampsWordFact, so the lone do:set-matter fact lands on
// the matter's reel and applySetField / applySetQualities fold it exactly as before — the same
// { field, value[, merge] } the dispatcher stamped (from ctx.params) when a JS handler stood here.

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

  // Shared-fate refcount: other live matter whose CURRENT content is this
  // hash. Purging would blind them — refuse without force.
  //
  // FLAG (cross-history scope loss): the legacy query was history-AGNOSTIC
  // ("any history" — it scanned EVERY history's matter projections for the
  // hash). The curated projection layer is per-history (listByType(type,
  // history) + loadProjection); there is NO curated all-histories content-
  // hash scan. This dead handler (the LIVE purge-content path is
  // purgeContentHostEnv / purgeContentHost.js, which still carries the raw
  // Projection.find) is translated to the OWN-history (the moment's
  // history) refcount only — a sibling history referencing the same bytes
  // is no longer counted here. A true cross-history dedup refcount needs a
  // new curated primitive (e.g. projections.findByContentHash across the
  // history lineage).
  const force = params?.force === true || params?.force === "true";
  const { listByType, loadProjection } = await import("../projections.js");
  const others = [];
  for (const occ of await listByType("matter", history)) {
    if (String(occ.id) === String(matterId)) continue;
    const slot = await loadProjection("matter", String(occ.id), history);
    if (!slot || slot.tombstoned) continue;
    if (slot.state?.content?.hash === hash) {
      others.push({ id: String(occ.id), history });
    }
  }
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

// WORD-SOLE: set-matter.word is the only path (do.js runOpWord). idFrom:"matterId" targets the
// fact at the matter and promotes the word's factParams ({field, value[, merge]}); resolve-set-matter-
// spec (setMatterHostEnv) is the lone host READ (load + CAS existence + DELETED + coord-bounds). No
// handler.
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
  word: { noun: "matter", able: "matter", idFrom: "matterId" },
  hostEnv: setMatterHostEnv,
});

// WORD-SOLE COMPOSITE: rename-matter.word is the only path. resolve-rename-spec (renameMatterHostEnv)
// is the lone host READ (load + folder-uniqueness) as a `see`; the write is a `do set-matter` leaf-call
// on field "name". No factAction / idFrom — the op lays no own fact; the set-matter deed carries its
// own target and fact (do.js discovers the deed via wordHasDeeds and runs it per-act-moment).
registerOperation("rename-matter", {
  targets: ["matter"],
  ownerExtension: "seed",
  args: {
    name: { type: "text", label: "New name (per-folder uniqueness enforced)", required: true },
  },
  word: { noun: "matter" },
  hostEnv: renameMatterHostEnv,
});

// WORD-SOLE: end-matter.word is the only path (do.js runOpWord). idFrom:"matterId" targets the
// do:end-matter fact at the matter; the reducer folds the tombstone (spaceId/beingId = DELETED) from
// the verb. resolve-end-matter-spec (endMatterHostEnv) is the lone host READ (load + author-or-root-
// owner auth). No handler. No host out (bytes are content-addressed; casSweep + purge-content own them).
registerOperation("end-matter", {
  targets: ["matter"],
  ownerExtension: "seed",
  factAction: "end-matter",
  args: {},
  word: { noun: "matter", able: "matter", idFrom: "matterId" },
  hostEnv: endMatterHostEnv,
});

// WORD-SOLE: purge-content.word is the only path (do.js runOpWord). idFrom:"matterId" targets the
// do:purge-content fact at the matter and promotes the word's factParams ({hash, force, referents});
// resolve-purge (purgeContentHostEnv) is the lone host READ (load + hash resolve + author/owner gate
// + shared-fate refcount gate + the FACT-FIRST afterSeal content delete). No handler. applyPurgeContent
// folds the fact (marking the ref purged); the physical delete runs post-seal.
registerOperation("purge-content", {
  targets: ["matter"],
  ownerExtension: "seed",
  factAction: "purge-content",
  args: {
    hash:  { type: "text", label: "Content hash (defaults to the matter's current content)", required: false },
    force: { type: "bool", label: "Purge even when other matter shares these bytes", default: false, required: false },
  },
  word: { noun: "matter", able: "matter", idFrom: "matterId" },
  hostEnv: purgeContentHostEnv,
});
