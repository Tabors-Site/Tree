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
// an http link, an inter-story doorway — one schema for all of
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

import log from "../../seedStory/log.js";
import { getInternalConfigValue } from "../../internalConfig.js";
import { randomUUID as uuidv4 } from "node:crypto";
import { loadProjection, loadOrFold, listByType, assertHistoryOrThrow, listMatterNamesInFolder } from "../projections.js";
import { matterContentId } from "./matterId.js";
import { emitFact, sealFacts } from "../../past/fact/facts.js";
import { getStoryConfigValue } from "../../storyConfig.js";
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
  missingRequiredField,
} from "./types.js";

// Place-config-driven knobs. Read at call time so config changes take
// effect without restart.
function matterMaxChars()    { return Math.max(100, Number(getInternalConfigValue("matterMaxChars"))    || 5000); }
function maxMatterPerSpace() { return Math.max(1,   Number(getInternalConfigValue("maxMatterPerSpace")) || 1000); }
function matterQueryLimit()  { return Math.max(1,   Math.min(Number(getInternalConfigValue("matterQueryLimit"))  || 5000, 50000)); }


// Upload-policy knobs (story config, same keys the upload route
// honors). Read at call time.
function maxUploadBytes() {
  return Math.max(1024, Number(getStoryConfigValue("maxUploadBytes")) || 100 * 1024 * 1024);
}
function allowedMimeTypes() {
  const v = getStoryConfigValue("allowedMimeTypes");
  return Array.isArray(v) && v.length > 0 ? v : null;
}
function mimeAllowedByStory(mimeType) {
  const allow = allowedMimeTypes();
  if (!allow) return true;
  const bare = String(mimeType || "").split(";")[0].trim().toLowerCase();
  return allow.some((p) => {
    const pat = String(p).toLowerCase();
    if (pat === bare) return true;
    return pat.endsWith("/*") && bare.startsWith(pat.slice(0, -1));
  });
}

// ── Naming ──────────────────────────────────────────────────────
//
// Every matter ends up named, the same guarantee spaces and beings
// already carry. The name comes from, in order: what the caller asked
// for, the filename of the bytes it carries (an upload of "report.pdf"
// arrives named "report.pdf"), and only when neither exists, a
// generated `<type><n>` that is unique within the folder. Names are
// labels inside a container, not addresses, so they pass through
// verbatim (a filename keeps its dots and spaces); only the generated
// floor is sanitized to a clean prefix.

function escapeRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ── Matter-at-space read (curated) ──────────────────────────────
//
// No curated findByParent for matter (that helper is being-only) and no
// matter-in-space projection query, so "matter at a space" composes from
// listByType("matter", history) + a per-slot reload, filtered by
// state.spaceId. listByType already does the history-lineage union (parent-
// inheritance shadow + branchPoint gating) and excludes tombstoned slots —
// the same shadow/tombstone semantics the old hand-rolled non-main union in
// listMattersAt reproduced, now centralized. Returns full slots
// ({state, foldedSeq, position, tombstoned, type, id, history}) so callers
// read s.id / s.state exactly as the old Projection.find().lean() rows.
async function listMatterSlotsAtSpace(history, spaceId) {
  const wantSpace = String(spaceId);
  const occupants = await listByType("matter", history);
  const out = [];
  for (const o of occupants) {
    // loadOrFold (not loadProjection): an occupant inherited from a parent
    // history has its slot only in the parent until cold-folded. loadOrFold
    // materializes the leaf-history view; loadProjection would return null and
    // silently drop inherited matter.
    const slot = await loadOrFold("matter", o.id, history);
    if (!slot || slot.tombstoned) continue;
    if (String(slot.state?.spaceId ?? "") !== wantSpace) continue;
    out.push(slot);
  }
  return out;
}

/**
 * Pick the next free `<type><n>` within a folder. Mirrors the being
 * name generator (identity/birth.js) but scoped to (space, parent).
 *
 * @param {string} type            the matter type, used as the prefix
 * @param {object} opts
 * @param {string} [opts.history="0"]
 * @param {string} opts.spaceId
 * @param {string|null} [opts.parentMatterId=null]
 * @returns {Promise<string>}
 */
export async function generateUniqueMatterName(type, { history = "0", spaceId, parentMatterId = null } = {}) {
  const safe = String(type || "matter").replace(/[^A-Za-z0-9_-]/g, "") || "matter";
  const pattern = new RegExp(`^${escapeRegex(safe)}[0-9]*$`, "i");
  const existing = await listMatterNamesInFolder(history, spaceId, parentMatterId, pattern);
  const taken = new Set(existing.map((n) => n.toLowerCase()));
  let n = existing.length;
  for (let i = 0; i < 10000; i++) {
    const candidate = `${safe}${n}`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
    n++;
  }
  // Astronomically unreachable; fall back to a uuid suffix rather than
  // loop forever.
  return `${safe}-${uuidv4().slice(0, 8)}`;
}

/**
 * Resolve the name a matter will be born with. Explicit wins; then the
 * filename carried by the content (cas ref `name`); then a generated
 * floor unique to the folder. Returns a string, never null.
 *
 * @param {object} args
 * @param {string|null} [args.name]    explicit caller name
 * @param {*}           [args.content] resolved content (cas ref or shape)
 * @param {string}      args.type
 * @param {string}      [args.history="0"]
 * @param {string}      args.spaceId
 * @param {string|null} [args.parentMatterId=null]
 * @returns {Promise<string>}
 */
export async function resolveMatterName({ name, content, type, history = "0", spaceId, parentMatterId = null }) {
  if (typeof name === "string" && name.trim().length) return name.trim();
  if (content && typeof content === "object" && typeof content.name === "string" && content.name.length) {
    return content.name;
  }
  return generateUniqueMatterName(type, { history, spaceId, parentMatterId });
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
  name = null,
  content = null,
  bytes = null,
  mimeType = null,
  fileName = null,
  beingId,
  spaceId,
  parentMatterId = null,
  actId = null,
  sessionId = null,
  initialQualities = {},
  moment = null,
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
  // REQUIRED-FIELD validation (the `has` schema, all-rules-fold §4). Gated behind the type declaring
  // any required field, so schema-less types are unaffected. A declared field Y maps to
  // qualities.<type>.<Y> (here, the caller's initialQualities); an optional ("may have") field is not
  // required. Required-set only — never a closed allowlist (the open qualities layer stays open).
  if (typeDef.fields?.length) {
    const missing = missingRequiredField(typeDef, initialQualities);
    if (missing) {
      throw new Error(`type "${type}" requires field "${missing}"`);
    }
  }
  const history = assertHistoryOrThrow(moment?.actorAct?.history, "matters(moment)");

  const spaceIdBare = String(spaceId);
  const _spaceSlot = await loadOrFold("space", spaceIdBare, history);
  const targetSpace = _spaceSlot ? {
    heavenSpace: _spaceSlot.state?.heavenSpace,
    parent:    _spaceSlot.state?.parent,
  } : null;
  if (!targetSpace) throw new Error("Space not found or deleted");
  if (!targetSpace.parent) throw new Error("Space not found or deleted");
  if (targetSpace.heavenSpace) throw new Error("Cannot modify heaven spaces");

  const max = maxMatterPerSpace();
  const count = (await listMatterSlotsAtSpace(history, spaceIdBare)).length;
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
    if (!mimeAllowedByStory(mt)) {
      throw new Error(`MIME type "${mt}" is not allowed on this story`);
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
  // Every matter is named: explicit → filename it carries → a generated
  // floor unique within this folder. The same guarantee the verb-path
  // handler gives, so both create paths land named rows.
  const resolvedName = await resolveMatterName({
    name,
    content: finalContent,
    type,
    history,
    spaceId: spaceIdBare,
    parentMatterId,
  });
  const matterParams = {
    type,
    name:      resolvedName,
    content:   finalContent,
    spaceId:   spaceIdBare,
    parentMatterId: parentMatterId ? String(parentMatterId) : null,
    beingId:   String(beingId),
    qualities: hookData.qualities || {},
  };
  // Content-addressed id from the finalized spec (the self is never in
  // its own hash), then carried as target.id. Same recipe as the verb
  // handler so both paths land deterministic, verifiable ids.
  const matterId = matterContentId(matterParams);
  // Eager singleton commit: the next line reads Matter.findById, so
  // the Fact must have committed (the eager-fold materializes the
  // Matter row only on commit). Same read-back constraint as
  // createBeing.
  await sealFacts([{
    verb:    "do",
    act:     "create-matter",
    through: String(beingId),
    of:      { kind: "matter", id: matterId },
    params:  matterParams,
    actId,
    sessionId,
    history: history,
  }]);
  const _newSlot = await loadProjection("matter", matterId, history);
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
  await hooks.run("afterMatter", { matter: newMatter, spaceId, beingId, type, sizeKB, action: "create", actId, sessionId, history }).catch((err) => {
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
  moment = null,
}) {
  if (!matterId || !beingId) throw new Error("Missing required fields");

  const history = assertHistoryOrThrow(moment?.actorAct?.history, "matters(moment)");
  const _matterSlot = await loadOrFold("matter", matterId, history);
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
    act:     "set-matter",
    through: String(beingId),
    of:      { kind: "matter", id: String(matter._id) },
    params:  { field: "content", value: newRef },
    actId,
    sessionId,
    history: history,
  }, moment);
  matter.content = newRef;

  // deltaKB threads into afterMatter for downstream reactions. No
  // incQuality here: storage is a projection of the matter Facts,
  // not a direct quality write.

  // Awaited: see comment in createMatter above. Callers (tool handlers
  // on the LLM path) need the syntax validator complete before they
  // return, or the next turn reads stale state.
  await hooks.run("afterMatter", { matter, spaceId: matter.spaceId, beingId, type: matter.type || "generic", sizeKB: newSizeKB, deltaKB, action: "edit", actId, sessionId, history }).catch((err) => {
    log.warn("Matter", `afterMatter hook chain failed: ${err?.message}`);
  });

  return { message: "Matter updated successfully", matter };
}

async function getMatters({ spaceId, limit, offset, startDate, endDate, history }) {
  assertHistoryOrThrow(history, "matters.getMatters(opts)");
  if (!spaceId) throw new Error("Missing required parameter: spaceId");

  const dateRange = validateDateRange(startDate, endDate);
  const safeLimit = Math.min(Math.max(Number(limit) || 100, 1), matterQueryLimit());
  const safeOffset = Math.max(0, Number(offset) || 0);

  const spaceIdBare = String(spaceId);
  // Curated matter-at-space read, then the old query view (date filter on
  // state.createdAt, newest-first by state.createdAt, offset/limit) applied in
  // JS. dateRange.createdAt is the {$gte,$lte} Date range buildDate
  // produced; honored field-for-field here.
  let rows = await listMatterSlotsAtSpace(history, spaceIdBare);
  // FLAG (clock removal): the date-RANGE filter on createdAt was a CLOCK query (callers pass a Date
  // {$gte,$lte}). createdAt is gone — matter carries bornOrd, the clock-free birth ordinal — and a
  // birth ordinal can't honor a wall-clock range, so the date filter is DISABLED (returns the full set,
  // not silently empty). Decision pending: restore it via an inert `at` witness on the matter (a
  // display-only birth date, never sorted/ordered on for truth) or drop the date-range feature.
  void dateRange;
  rows.sort((a, b) => (b.state?.bornOrd ?? 0) - (a.state?.bornOrd ?? 0)); // newest first by birth order
  rows = rows.slice(safeOffset, safeOffset + safeLimit);

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

// endMatter — retire a matter. The being only ever sees "delete matter"; there is no file work
// (the old `deleteMatterAndFile` name was a fossil from when JS owned the blob 1:1 — content-
// addressing dissolved that, so the bytes are never deleted here, only the reference is dropped and
// casSweep reclaims at refcount-zero). Auth + storage accounting only; the do:end-matter fact is the
// dispatcher's, and the matter reducer folds the ended state from it (23.md: one act, one fact).
async function endMatter({
  matterId, beingId,
  actId = null, sessionId = null,
  moment = null,
}) {
  const history = assertHistoryOrThrow(moment?.actorAct?.history, "matters(moment)");
  const _mSlot = await loadOrFold("matter", matterId, history);
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

  // ONE act, ONE fact (23.md). end-matter stamps NO fact here: the do:end-matter the dispatcher
  // auto-Fact lays IS the act, and the matter reducer FOLDS its two consequences — absent from its
  // space (spaceId=DELETED, which isGone tombstones from) and unheld (beingId=DELETED). The old
  // two hand-stamped set-matter facts were the 2-field-object false shape; the verb names the intent
  // the being sees ("delete matter"), the reducer derives the rest. The bytes are never touched
  // (content-addressed + shared; casSweep owns blob lifecycle) — this verb has no host/file effect.
  matter.spaceId = DELETED;
  matter.beingId = DELETED;

  // fileSizeKB threads into afterMatter. No incQuality: storage is
  // a projection of the matter Facts, not a direct quality write.

  if (fileOwnerId && fileOwnerId !== DELETED) {
    hooks.run("afterMatter", {
      matter, spaceId, beingId: fileOwnerId,
      type: matter.type || "generic", fileSizeKB,
      action: "delete", fileDeleted: false,
      actId, sessionId, history,
    }).catch(() => {});
  }

  return { message: "Matter removed." };
}

async function transferMatter({
  matterId, targetSpace, beingId,
  actId = null, sessionId = null,
  moment = null,
}) {
  if (!matterId || !targetSpace || !beingId) {
    throw new Error("Missing required fields: matterId, targetSpace, beingId");
  }

  const history = assertHistoryOrThrow(moment?.actorAct?.history, "matters(moment)");
  const _mSlot2 = await loadOrFold("matter", matterId, history);
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

  const _tSlot = await loadOrFold("space", targetSpaceBare, history);
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
    act:     "set-matter",
    through: String(beingId),
    of:      { kind: "matter", id: String(matter._id) },
    params:  { field: "spaceId", value: targetSpaceBare },
    actId,
    sessionId,
    history: history,
  }, moment);
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
async function listMattersAt(spaceId, { limit = 50, history } = {}) {
  assertHistoryOrThrow(history, "matters.listMattersAt(opts)");
  if (!spaceId) return [];
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
  // Curated matter-at-space read. The old hand-rolled non-main union (this
  // history's own matters + main's matters that existed at branch creation,
  // with shadow + tombstone semantics) is exactly what listByType's lineage
  // walk inside listMatterSlotsAtSpace now does — main and non-main both go
  // through the one path. Newest-first by state.createdAt, capped at limit.
  const rows = await listMatterSlotsAtSpace(history, String(spaceId));
  rows.sort((a, b) => (b.state?.bornOrd ?? 0) - (a.state?.bornOrd ?? 0)); // newest first by birth order (clock-free)
  return rows.slice(0, limit).map(toEntry);
}

/**
 * Read one matter by id. Lean by default — the caller wants a
 * plain object to inspect, not a hydrated doc to save back. Pass
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
  const history = assertHistoryOrThrow(opts?.history, "matters.getMatter(opts)");
  const slot = await loadOrFold("matter", matterId, history);
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
 *                                web / cross-story / filesystem
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
  endMatter,
  transferMatter,
  listMattersAt,
};
