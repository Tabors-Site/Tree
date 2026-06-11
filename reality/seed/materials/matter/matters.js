// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// Matter. What fills a space.
//
// Space is the where; Matter is the what-sits-there. Together they
// make a position something rather than empty potential. This file
// is the place I create, edit, and retire Matter — the operations
// behind the seed's create-matter / edit-matter / delete-matter
// verbs.
//
// I do not split Matter's schema by what it carries. Text, a file,
// an http link, an inter-reality doorway — one schema for all of
// them. ONE field characterizes each piece:
//
//   type — what the matter IS (types.js): the registered matter
//          type, the substrate's main extension point. The type's
//          content shape says where bytes live (CAS ref = owned;
//          {url}/{target}/{path} = referenced) — there is no
//          separate origin tag to drift.
//
// Content is CONTENT-ADDRESSED. For owned bytes (text and
// binary alike) the bytes live in the content store
// (contentStore.js), hashed by SHA-256; facts and projections carry
// the ref `{ kind:"cas", hash, size, mimeType, name, encoding,
// preview }`, never raw bytes. Identical bytes store once; an edit
// references a new hash; the retention sweeper (casSweep.js) and the
// purge-content op manage old blobs.
//
// Hooks. beforeMatter and afterMatter fire on every write. Before
// hooks can mutate the payload or cancel the create; after hooks run
// in parallel for reactive work. Extensions characterize Matter
// through hookData.qualities under their own namespace. hookData.
// content carries the CAS ref; a hook that replaces it with a string
// gets the string re-hashed into the store transparently.
//
// Soft-delete. Retiring a Matter sets spaceId and beingId to the
// DELETED sentinel; the row stays for audit but no longer lives in
// the world. Bytes stay in the content store under retention policy.

import log from "../../seedReality/log.js";
import { getInternalConfigValue } from "../../internalConfig.js";
import { v4 as uuidv4 } from "uuid";
import Matter from "./matter.js";
import Space from "../space/space.js";
import { loadProjection, loadOrFold, assertBranchOrThrow } from "../projections.js";
import { emitFact, sealFacts } from "../../past/fact/facts.js";
import { getRealityConfigValue } from "../../realityConfig.js";
import { resolveRootSpace } from "../space/spaces.js";
import { getSpaceOwner } from "../space/members.js";
import { hooks } from "../../hooks.js";
import { DELETED } from "../space/heavenSpaces.js";
import { IBP_ERR, IbpError } from "../../ibp/protocol.js";
import {
  putContent,
  getContentText,
  hasContent,
  isCasRef,
  purgedMarker,
} from "./contentStore.js";
import {
  getMatterType,
  typeAllowsContentKind,
  typeAllowsMime,
} from "./types.js";

// Place-config-driven knobs. Read at call time so config changes take
// effect without restart.
function matterMaxChars()    { return Math.max(100, Number(getInternalConfigValue("matterMaxChars"))    || 5000); }
function maxMatterPerSpace() { return Math.max(1,   Number(getInternalConfigValue("maxMatterPerSpace")) || 1000); }
function matterQueryLimit()  { return Math.max(1,   Math.min(Number(getInternalConfigValue("matterQueryLimit"))  || 5000, 50000)); }


// Upload-policy knobs (reality config, same keys the upload route
// honors). Read at call time.
function maxUploadBytes() {
  return Math.max(1024, Number(getRealityConfigValue("maxUploadBytes")) || 100 * 1024 * 1024);
}
function allowedMimeTypes() {
  const v = getRealityConfigValue("allowedMimeTypes");
  return Array.isArray(v) && v.length > 0 ? v : null;
}
function mimeAllowedByReality(mimeType) {
  const allow = allowedMimeTypes();
  if (!allow) return true;
  const bare = String(mimeType || "").split(";")[0].trim().toLowerCase();
  return allow.some((p) => {
    const pat = String(p).toLowerCase();
    if (pat === bare) return true;
    return pat.endsWith("/*") && bare.startsWith(pat.slice(0, -1));
  });
}

// Size cap applies universally. Stance-auth-based exemptions can
// hang here later if a use case warrants them.
async function assertMatterTextWithinLimit(content) {
  if (!content || typeof content !== "string") return;
  const max = matterMaxChars();
  if (content.length > max) {
    throw new Error(`Matter exceeds maximum length of ${max} characters`);
  }
}

function validateDateRange(startDate, endDate) {
  if (!startDate && !endDate) return {};
  const start = startDate ? Date.parse(startDate) : NaN;
  const end = endDate ? Date.parse(endDate) : NaN;
  if (startDate && isNaN(start)) throw new Error("Invalid startDate format");
  if (endDate && isNaN(end)) throw new Error("Invalid endDate format");
  if (!isNaN(start) && !isNaN(end) && end < start) throw new Error("endDate must be after startDate");
  if (!isNaN(start) && !isNaN(end) && (end - start) > 365 * 24 * 60 * 60 * 1000) {
    throw new Error("Date range cannot exceed 365 days");
  }
  const range = {};
  if (!isNaN(start)) range.$gte = new Date(start);
  if (!isNaN(end)) range.$lte = new Date(end);
  return Object.keys(range).length > 0 ? { createdAt: range } : {};
}

async function createMatter({
  type = "generic",
  content = null,
  bytes = null,
  mimeType = null,
  fileName = null,
  beingId,
  spaceId,
  actId = null,
  sessionId = null,
  initialQualities = {},
  summonCtx = null,
}) {
  if (!beingId || !spaceId) {
    throw new Error("Missing required fields: beingId, spaceId");
  }
  const typeDef = getMatterType(type);
  if (!typeDef) {
    throw new Error(
      `Unknown matter type "${type}". Registered types: seed basics plus extension-registered "<ext>:<type>" names.`,
    );
  }
  const branch = assertBranchOrThrow(summonCtx?.actorAct?.branch, "matters(summonCtx)");

  const { loadOrFold } = await import("../projections.js");
  const { default: Projection } = await import("../branch/projection.js");
  const spaceIdBare = String(spaceId);
  const _spaceSlot = await loadOrFold("space", spaceIdBare, branch);
  const targetSpace = _spaceSlot ? {
    heavenSpace: _spaceSlot.state?.heavenSpace,
    parent:    _spaceSlot.state?.parent,
  } : null;
  if (!targetSpace) throw new Error("Space not found or deleted");
  if (!targetSpace.parent) throw new Error("Space not found or deleted");
  if (targetSpace.heavenSpace) throw new Error("Cannot modify heaven spaces");

  const max = maxMatterPerSpace();
  const count = await Projection.countDocuments({
    branch, type: "matter",
    "state.spaceId": spaceIdBare,
    tombstoned: { $ne: true },
  });
  if (count >= max) {
    throw new Error(`Space has reached the maximum of ${max} matter entries. Delete old matter before adding new ones.`);
  }

  // Build the content payload, shape-driven (no origin tag — the
  // content's shape + the type's contentKinds decide). Owned bytes —
  // text and binary alike — land in the content store and the fact
  // carries the ref. The chain holds facts ABOUT content; the store
  // holds the bytes (philosophy/OS/OS.md). The put happens BEFORE
  // the fact seals: a crash in the gap leaves an unreferenced blob
  // the sweeper's grace period owns. Never delete inline on error —
  // that races deduplication. Reference shapes (http {url}, ibpa
  // {target}, source {path}) ride as-is for types that carry no
  // owned bytes.
  let finalContent = content;
  if (bytes != null) {
    // Binary content (upload path).
    const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
    if (!typeAllowsContentKind(typeDef, "binary")) {
      throw new Error(`Matter type "${type}" does not carry binary content`);
    }
    if (buf.length > maxUploadBytes()) {
      throw new Error(`Content exceeds maxUploadBytes (${maxUploadBytes()} bytes)`);
    }
    const mt = mimeType || "application/octet-stream";
    if (!mimeAllowedByReality(mt)) {
      throw new Error(`MIME type "${mt}" is not allowed on this reality`);
    }
    if (!typeAllowsMime(typeDef, mt)) {
      throw new Error(`MIME type "${mt}" is not allowed for matter type "${type}"`);
    }
    finalContent = await putContent(buf, { mimeType: mt, name: fileName });
  } else if (typeof content === "string") {
    if (!typeAllowsContentKind(typeDef, "text")) {
      throw new Error(`Matter type "${type}" does not carry text content`);
    }
    await assertMatterTextWithinLimit(content);
    finalContent = await putContent(content, { encoding: "utf8", name: fileName });
  } else if (isCasRef(content)) {
    // Two-step upload: the bytes were stored via POST /api/v1/content
    // and the caller hands the ref. Verify the blob actually exists
    // here so a fact never references bytes this store never held.
    if (!(await hasContent(content.hash))) {
      throw new Error(`Unknown content hash "${content.hash.slice(0, 12)}..." — upload the bytes first`);
    }
    const kind = content.encoding === "utf8" ? "text" : "binary";
    if (!typeAllowsContentKind(typeDef, kind)) {
      throw new Error(`Matter type "${type}" does not carry ${kind} content`);
    }
    if (!typeAllowsMime(typeDef, content.mimeType)) {
      throw new Error(`MIME type "${content.mimeType}" is not allowed for matter type "${type}"`);
    }
    finalContent = content;
  } else if (content && typeof content === "object") {
    // A reference shape (http {url}, ibpa {target}, source {path},
    // extension reference types). No owned bytes — legal for types
    // declaring contentKind "none".
    if (!typeAllowsContentKind(typeDef, "none")) {
      throw new Error(`Matter type "${type}" does not carry reference content`);
    }
  } else if (content == null) {
    if (!typeAllowsContentKind(typeDef, "none")) {
      throw new Error(`Matter type "${type}" requires content`);
    }
    finalContent = null;
  } else {
    throw new Error(
      "Invalid content: pass a string (text), bytes (Buffer), a cas content ref, a reference object, or null",
    );
  }

  // ── HOOKS ────────────────────────────────────────
  const hookData = { spaceId, content: finalContent, beingId, type, qualities: { ...initialQualities } };
  const hookResult = await hooks.run("beforeMatter", hookData);
  if (hookResult.cancelled) {
    const code = hookResult.timedOut ? IBP_ERR.HOOK_TIMEOUT : IBP_ERR.HOOK_CANCELLED;
    throw new IbpError(code, hookResult.reason || "Matter creation cancelled by extension");
  }
  finalContent = hookData.content;
  // Compat shim: a before-hook that swaps in a raw string gets it
  // hashed into the store — facts never carry loose bytes.
  if (typeof finalContent === "string") {
    await assertMatterTextWithinLimit(finalContent);
    finalContent = await putContent(finalContent, { encoding: "utf8", name: fileName });
  }

  // ── FACT-DRIVEN BIRTH (Slice C-matter-full, 2026-05-23) ──
  // Stamps a do:birth Fact on the new matter's reel; eager-fold's
  // applyCreateMatter + initProjection materializes the row. No more
  // direct Matter.save() — the fact is the commit.
  const matterId = uuidv4();
  // Eager singleton commit: the next line reads Matter.findById, so
  // the Fact must have committed (the eager-fold materializes the
  // Matter row only on commit). Same read-back constraint as
  // createBeing.
  await sealFacts([{
    verb:    "do",
    action:  "create-matter",
    beingId: String(beingId),
    target:  { kind: "matter", id: matterId },
    params:  {
      type,
      content:   finalContent,
      spaceId:   spaceIdBare,
      beingId:   String(beingId),
      qualities: hookData.qualities || {},
    },
    actId,
    sessionId,
    branch,
  }]);
  const _newSlot = await loadProjection("matter", matterId, branch);
  if (!_newSlot) {
    throw new Error(
      `createMatter: birth Fact stamped but row ${matterId} not materialized`,
    );
  }
  const newMatter = { _id: _newSlot.id, ...(_newSlot.state || {}) };

  // Size attributed to the matter owner. Passed through to afterMatter
  // for the future projection. Per the every-write-through-DO/BE
  // rule, the seed no longer maintains a being.qualities.storage cache
  // by direct incQuality; storage is a projection of the matter Facts.
  let sizeKB = 0;
  if (isCasRef(finalContent) && typeof finalContent.size === "number") {
    sizeKB = Math.ceil(finalContent.size / 1024);
  }

  // Await the hook chain so reactive work (syntax validation, contract
  // signaling) completes BEFORE the caller returns.
  // Without this, the tool handler returns success to the LLM's tool
  // loop while the validator is still running, and the next turn's
  // context read misses freshly-written signals — a race that lets
  // the AI walk past blocking errors. After hooks run parallel so
  // awaiting the Promise.all adds no serialization latency beyond
  // the slowest single handler.
  await hooks.run("afterMatter", { matter: newMatter, spaceId, beingId, type, sizeKB, action: "create", actId, sessionId, branch }).catch((err) => {
    log.warn("Matter", `afterMatter hook chain failed: ${err?.message}`);
  });

  // Fact stamping is the dispatcher's job. The op handler (create-matter)
  // returns _factTarget pointing at this matter so one Fact per op call
  // names the substrate event.
  return { message: "Matter created successfully", matter: newMatter };
}

async function editMatter({
  matterId, content, beingId,
  lineStart = null, lineEnd = null,
  actId = null, sessionId = null,
  summonCtx = null,
}) {
  if (!matterId || !beingId) throw new Error("Missing required fields");

  const branch = assertBranchOrThrow(summonCtx?.actorAct?.branch, "matters(summonCtx)");
  const _matterSlot = await loadOrFold("matter", matterId, branch);
  if (!_matterSlot) throw new Error("Matter not found");
  const matter = { _id: _matterSlot.id, ...(_matterSlot.state || {}) };
  if (String(matter.beingId) !== String(beingId)) throw new Error("Unauthorized");
  if ((matter.type || "generic") === "source") {
    throw new Error("Cannot edit source matter: the seed's disk mirror is read-only");
  }
  const typeDef = getMatterType(matter.type || "generic");
  if (typeDef && !typeAllowsContentKind(typeDef, "text")) {
    throw new Error(`Matter type "${matter.type}" does not carry editable text content`);
  }

  // Resolve the current text through the content store. The
  // projection carries the ref; the bytes live at the hash. Purged
  // content refuses the edit honestly — there is nothing to splice.
  let oldContent = "";
  if (isCasRef(matter.content)) {
    if (matter.content.encoding !== "utf8") {
      throw new Error("Cannot text-edit binary content; create new matter or set-matter a fresh upload ref");
    }
    const text = await getContentText(matter.content.hash);
    if (text == null) {
      throw new Error(
        `Content ${matter.content.hash.slice(0, 12)}... is no longer in the store (purged or reclaimed); cannot edit`,
      );
    }
    oldContent = text;
  } else if (typeof matter.content === "string") {
    // Pre-CAS legacy row (dev DBs are wiped; this is belt-and-braces).
    oldContent = matter.content;
  }
  let newContent;

  if (lineStart !== null && lineEnd !== null) {
    const lines = oldContent.split("\n");
    const start = Math.max(0, lineStart);
    const end = Math.min(lines.length, lineEnd);
    if (start > end) throw new Error(`Invalid line range: ${start}-${end}`);
    lines.splice(start, end - start, ...(content ?? "").split("\n"));
    newContent = lines.join("\n");
  } else if (lineStart !== null && lineEnd === null) {
    const lines = oldContent.split("\n");
    const start = Math.max(0, Math.min(lineStart, lines.length));
    lines.splice(start, 0, ...(content ?? "").split("\n"));
    newContent = lines.join("\n");
  } else {
    newContent = content ?? "";
  }

  await assertMatterTextWithinLimit(newContent);

  if (oldContent === newContent) {
    return { message: "No changes", matter };
  }

  let finalText = newContent;
  {
    // Hooks see the TEXT on the edit path — this is the text-editing
    // surface, and validators (syntax checkers et al) want the words.
    const hookData = { spaceId: matter.spaceId, content: newContent, beingId, type: matter.type || "generic", qualities: {} };
    await hooks.run("beforeMatter", hookData);
    if (typeof hookData.content === "string") finalText = hookData.content;
  }

  // New version → new hash. Identical bytes would have early-outed
  // above; a hook mutation could still land on the same text, in
  // which case putContent dedups to the same blob and the fact
  // records the (unchanged) ref — harmless.
  const newRef = await putContent(finalText, {
    encoding: "utf8",
    name: isCasRef(matter.content) ? matter.content.name : null,
  });

  const oldSizeKB = Math.ceil(Buffer.byteLength(oldContent, "utf8") / 1024);
  const newSizeKB = Math.ceil(newRef.size / 1024);
  const deltaKB = newSizeKB - oldSizeKB;

  // Fact-driven content update. The reducer's applySetField writes
  // state.content from the fact — the REF, never the bytes. The old
  // version's blob stays in the store under retention policy; the
  // old fact still names its hash, so history reads can resolve it.
  await emitFact({
    verb:    "do",
    action:  "set-matter",
    beingId: String(beingId),
    target:  { kind: "matter", id: String(matter._id) },
    params:  { field: "content", value: newRef },
    actId,
    sessionId,
    branch,
  }, summonCtx);
  matter.content = newRef;

  // deltaKB threads into afterMatter for downstream reactions. No
  // incQuality here: storage is a projection of the matter Facts,
  // not a direct quality write.

  // Awaited: see comment in createMatter above. Callers (tool handlers
  // on the LLM path) need the syntax validator complete before they
  // return, or the next turn reads stale state.
  await hooks.run("afterMatter", { matter, spaceId: matter.spaceId, beingId, type: matter.type || "generic", sizeKB: newSizeKB, deltaKB, action: "edit", actId, sessionId, branch }).catch((err) => {
    log.warn("Matter", `afterMatter hook chain failed: ${err?.message}`);
  });

  return { message: "Matter updated successfully", matter };
}

async function getMatters({ spaceId, limit, offset, startDate, endDate, branch }) {
  assertBranchOrThrow(branch, "matters.getMatters(opts)");
  if (!spaceId) throw new Error("Missing required parameter: spaceId");

  const dateRange = validateDateRange(startDate, endDate);
  const safeLimit = Math.min(Math.max(Number(limit) || 100, 1), matterQueryLimit());
  const safeOffset = Math.max(0, Number(offset) || 0);

  const { default: Projection } = await import("../branch/projection.js");
  const spaceIdBare = String(spaceId);
  const where = {
    branch, type: "matter",
    "state.spaceId": spaceIdBare,
    tombstoned: { $ne: true },
  };
  if (dateRange.createdAt) {
    where["state.createdAt"] = dateRange.createdAt;
  }
  const rows = await Projection.find(where)
    .sort({ "state.createdAt": -1 })
    .skip(safeOffset)
    .limit(safeLimit)
    .lean();

  // Batch-load author names from the being projection slots.
  const authorIds = [...new Set(rows.map((r) => r.state?.beingId).filter(Boolean))];
  const { loadProjections: _lP } = await import("../projections.js");
  const authorSlots = await _lP("being", authorIds, "0");

  return {
    matters: rows.map(s => {
      const m = s.state || {};
      const beingIdBare = m.beingId || null;
      const author = beingIdBare ? authorSlots.get(beingIdBare) : null;
      return {
        _id:        s.id,
        type:       m.type || "generic",
        content:    m.content,
        name:       m.name ?? null,
        authorName: author?.state?.name ?? null,
        beingId:    beingIdBare,
        spaceId:    m.spaceId,
        qualities:  m.qualities,
        createdAt:  m.createdAt,
        updatedAt:  m.updatedAt,
      };
    }),
  };
}

async function deleteMatterAndFile({
  matterId, beingId,
  actId = null, sessionId = null,
  summonCtx = null,
}) {
  const branch = assertBranchOrThrow(summonCtx?.actorAct?.branch, "matters(summonCtx)");
  const _mSlot = await loadOrFold("matter", matterId, branch);
  if (!_mSlot) throw new Error("Matter not found");
  const matter = { _id: _mSlot.id, ...(_mSlot.state || {}) };

  // Author first — no tree walk needed when the actor made the
  // matter. The walk only runs for non-authors, and heaven matter
  // (e.g. connection rows in ./host/websocket) has no owned tree
  // root by design: resolveRootSpace throws at the heaven boundary,
  // which here just means "no root owner", not an error.
  const isAuthor = String(matter.beingId) === String(beingId);
  let isRootOwner = false;
  if (!isAuthor) {
    try {
      const rootSpace = await resolveRootSpace(matter.spaceId);
      isRootOwner = String(getSpaceOwner(rootSpace) || "") === String(beingId);
    } catch { /* heaven boundary or broken tree: author rule decides */ }
  }

  if (!isAuthor && !isRootOwner) {
    throw new Error("Only the matter author or the tree owner can delete this matter");
  }

  const fileOwnerId = matter.beingId;
  const { spaceId } = matter;
  // No inline blob delete: bytes are content-addressed and possibly
  // shared by other matter (dedup). The retention sweeper (casSweep)
  // and the explicit purge-content op own blob lifecycle.
  const fileSizeKB = isCasRef(matter.content) && typeof matter.content.size === "number"
    ? Math.ceil(matter.content.size / 1024)
    : 0;

  // Fact-driven soft-delete. Two do:set facts on the matter's reel:
  // spaceId=DELETED, beingId=DELETED. The per-reel append lock keeps
  // them visible-together to a concurrent fold.
  const setMatterField = (field, value) =>
    emitFact({
      verb:    "do",
      action:  "set-matter",
      beingId: String(beingId),
      target:  { kind: "matter", id: String(matter._id) },
      params:  { field, value },
      actId,
      sessionId,
      branch,
    }, summonCtx);
  await setMatterField("spaceId", DELETED);
  await setMatterField("beingId", DELETED);
  matter.spaceId = DELETED;
  matter.beingId = DELETED;

  // fileSizeKB threads into afterMatter. No incQuality: storage is
  // a projection of the matter Facts, not a direct quality write.

  if (fileOwnerId && fileOwnerId !== DELETED) {
    hooks.run("afterMatter", {
      matter, spaceId, beingId: fileOwnerId,
      type: matter.type || "generic", fileSizeKB,
      action: "delete", fileDeleted: false,
      actId, sessionId, branch,
    }).catch(() => {});
  }

  return { message: "Matter removed." };
}

async function transferMatter({
  matterId, targetSpace, beingId,
  actId = null, sessionId = null,
  summonCtx = null,
}) {
  if (!matterId || !targetSpace || !beingId) {
    throw new Error("Missing required fields: matterId, targetSpace, beingId");
  }

  const branch = assertBranchOrThrow(summonCtx?.actorAct?.branch, "matters(summonCtx)");
  const _mSlot2 = await loadOrFold("matter", matterId, branch);
  if (!_mSlot2) throw new Error("Matter not found");
  const matter = { _id: _mSlot2.id, ...(_mSlot2.state || {}) };
  if (matter.spaceId === DELETED) throw new Error("Cannot transfer deleted matter");

  const targetSpaceBare = String(targetSpace);

  const rootSpace = await resolveRootSpace(matter.spaceId);
  const isAuthor = String(matter.beingId) === String(beingId);
  const isRootOwner = String(getSpaceOwner(rootSpace) || "") === String(beingId);
  if (!isAuthor && !isRootOwner) {
    throw new Error("Only the matter author or the tree owner can transfer this matter");
  }

  const _tSlot = await loadOrFold("space", targetSpaceBare, branch);
  if (!_tSlot) throw new Error("Target Space not found");

  const targetRoot = await resolveRootSpace(targetSpaceBare);
  if (targetRoot._id.toString() !== rootSpace._id.toString()) {
    throw new Error("Cannot transfer matter between different trees");
  }

  const sourceSpaceId = matter.spaceId;
  // Fact-driven transfer. One do:set fact updates spaceId; the reducer's
  // applySetField writes the row.
  await emitFact({
    verb:    "do",
    action:  "set-matter",
    beingId: String(beingId),
    target:  { kind: "matter", id: String(matter._id) },
    params:  { field: "spaceId", value: targetSpaceBare },
    actId,
    sessionId,
    branch,
  }, summonCtx);
  matter.spaceId = targetSpaceBare;

  return { message: "Matter transferred successfully", matterId: matterId.toString(), from: { spaceId: sourceSpaceId }, to: { spaceId: targetSpaceBare } };
}

/**
 * List matter rows at a space, slim shape (matterId, name, beingId,
 * type, content, qualities). Hits Matter directly so the returned
 * `name` is the matter's own — getMatters populates beingId and
 * overwrites name with the being's name, which the descriptor pass
 * specifically needs to avoid.
 */
async function listMattersAt(spaceId, { limit = 50, branch } = {}) {
  assertBranchOrThrow(branch, "matters.listMattersAt(opts)");
  if (!spaceId) return [];
  const { default: Projection } = await import("../branch/projection.js");
  const toEntry = (s) => {
    const m = s.state || {};
    return {
      matterId: String(s.id),
      name: m.name || null,
      beingId: m.beingId || null,
      type: m.type || "generic",
      content: m.content || null,
      qualities: m.qualities instanceof Map
        ? Object.fromEntries(m.qualities)
        : (m.qualities || {}),
    };
  };
  const spaceIdBare = String(spaceId);
  const baseQuery = (b) => ({
    branch: b, type: "matter",
    "state.spaceId": spaceIdBare,
    tombstoned: { $ne: true },
  });

  if (branch === "0") {
    const rows = await Projection.find(baseQuery("0"))
      .sort({ "state.createdAt": -1 })
      .limit(limit)
      .lean();
    return rows.map(toEntry);
  }
  // Non-main: union branch's own matters with main's matters that
  // existed at branch creation. Shadow + tombstone semantics.
  const { getBranchPoint } = await import("../branch/branches.js");
  const [branchRows, mainRows] = await Promise.all([
    Projection.find(baseQuery(branch)).lean(),
    Projection.find(baseQuery("0")).lean(),
  ]);
  const shadowedIds = new Set(branchRows.map((s) => s.id));
  const tombs = await Projection.find({
    branch, type: "matter", tombstoned: true,
  }).select("id").lean();
  for (const t of tombs) shadowedIds.add(t.id);
  const mainVisible = [];
  for (const cand of mainRows) {
    if (shadowedIds.has(cand.id)) continue;
    const bp = await getBranchPoint(branch, "matter", cand.id);
    if (bp && bp > 0) mainVisible.push(cand);
  }
  const all = [...branchRows, ...mainVisible];
  all.sort((a, b) => {
    const at = a.state?.createdAt ? new Date(a.state.createdAt).getTime() : 0;
    const bt = b.state?.createdAt ? new Date(b.state.createdAt).getTime() : 0;
    return bt - at; // newest first
  });
  return all.slice(0, limit).map(toEntry);
}

/**
 * Read one matter by id. Lean by default — the caller wants a
 * plain object to inspect, not a Mongoose doc to save back. Pass
 * `{ doc: true }` to get the hydrated doc instead (needed when the
 * caller will mutate + save).
 *
 * Lives here so cognition / extension callers don't reach for
 * Matter.findById directly. The four-verb discipline routes
 * substrate access through primitives in this folder; this is
 * matter's primitive for "fetch by id."
 */
async function getMatter(matterId, opts = {}) {
  if (!matterId || typeof matterId !== "string") return null;
  const branch = assertBranchOrThrow(opts?.branch, "matters.getMatter(opts)");
  const slot = await loadOrFold("matter", matterId, branch);
  if (!slot) return null;
  return { _id: slot.id, ...(slot.state || {}) };
}

/**
 * Read-through content resolver — matter's primitive for "give me
 * the bytes/text behind this matter." Cognition + extension callers
 * use this instead of touching contentStore directly or assuming
 * content is a string.
 *
 * Returns:
 *   { matter, ref, text }        ibp text content (utf8)
 *   { matter, ref, buffer }      ibp binary content
 *   { matter, ref, purged: true} bytes gone (purged / reclaimed)
 *   { matter, ref: null }        no owned bytes (null content, or a
 *                                web / cross-reality / filesystem
 *                                reference shape — read matter.content
 *                                directly for those)
 *   null                         matter not found
 */
async function getMatterContent(matterId, opts = {}) {
  const matter = await getMatter(matterId, opts);
  if (!matter) return null;
  const ref = isCasRef(matter.content) ? matter.content : null;
  if (!ref) {
    // Legacy inline string (pre-CAS row): surface it as text.
    if (typeof matter.content === "string") {
      return { matter, ref: null, text: matter.content };
    }
    return { matter, ref: null };
  }
  if (ref.encoding === "utf8") {
    const text = await getContentText(ref.hash);
    if (text == null) return { matter, ref, ...purgedMarker(ref) };
    return { matter, ref, text };
  }
  const { getContent } = await import("./contentStore.js");
  const buffer = await getContent(ref.hash);
  if (buffer == null) return { matter, ref, ...purgedMarker(ref) };
  return { matter, ref, buffer };
}

export {
  createMatter, editMatter, getMatter, getMatters, getMatterContent,
  deleteMatterAndFile,
  transferMatter,
  listMattersAt,
};
