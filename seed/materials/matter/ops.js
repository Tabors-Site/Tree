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
import { registerAbleWord } from "../../present/word/ableWordRegistry.js";
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
// purge-content (WORD-SOLE, registered below). No JS handler.
// ─────────────────────────────────────────────────────────────────────
//
// Physically delete the bytes behind a matter's content hash from the
// content store. The fact chain is append-only: the facts naming the
// hash remain, the projection marks the ref purged, and reads return
// the purged marker. This is the "I accidentally posted that"
// scalpel; background reclamation is casSweep's retention policy.
//
// Dedup makes purge a shared-fate decision: identical bytes are ONE
// blob, so other matter referencing the same hash goes dark too. The
// host refuses when other live referents exist unless force=true,
// explicit, never silent.
//
// purge-content.word is the SOLE path. Auth (author-or-root-owner, same
// shape as end-matter), hash resolution, and the shared-fate refcount
// gate are the host see-op resolve-purge (purgeContentHostEnv,
// purgeContentHost.js); the FACT-FIRST afterSeal content delete runs
// there too. No JS handler.

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
  // The act laid on the fact is `delete` (the consistent THING-cease verb across space/matter); the
  // op NAME stays `end-matter` (the unique dispatch key callers speak — the global op REGISTRY can
  // hold only one `delete`). The matter reducer matches `act === "delete"` to fold the cease.
  factAction: "delete",
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
