// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// innerFace.js . the one canonical face the moment is built around.
//
// Sibling doctrine to philosophy/names/innerFace.md. Every moment
// computes exactly ONE inner face. The three souls (LLM, scripted,
// human) all consume the same inner face; per-soul reformatting
// happens at the presentation layer, not at the structure layer.
//
// The canonical shape:
//
//   {
//     orientation: "forward" | "half" | "inward",
//     able:        <able name string>,
//     position:    { id, name } | null,
//     capabilities: { canDo, canSummon, canBe },
//     blocks:      [{ key, source, label, payload }, ...],
//     origin:      "local" | "foreign",
//   }
//
// `blocks` is the resolved able.canSee output. Each entry stores its
// source tag ("address" for IBP-address entries, "see" for registered
// SEE-name entries), its label, and the structured payload that was
// admitted by canSee. An empty able.canSee yields blocks: [] and the
// face is still substantive (orientation + able + position + caps).
//
// The face is built ONCE per moment, at the 2-fold beat
// (foldBeat.runFoldBeat), and rides on moment.innerFace. The LLM
// mouth formats blocks into prompt prose via innerFaceFormat.js; the
// scripted able reads ctx.innerFace as data; the human portal reads
// the live face via the my-inner-face SEE op (and the stored face off
// Act.innerFace for chain display). Cross-world overrides supersede
// the local face post-seal via normalizeForeignDescriptor.
//
// Two cap profiles live here so the relationship is obvious:
//
//   STORAGE caps (defensive). Applied by buildInnerFace before the
//   face is stashed on moment for the seal. High enough that any
//   honest face slips through unclamped; tight enough to prevent a
//   runaway extension from writing a 50MB occupant list. The
//   spaces / matter / beings of the story are the truth; storage
//   is a bounded record of the face.
//
//   RENDER caps (LLM prompt budget). Applied by clampForRender when
//   a renderer pulls a stored face into a turned-fold prompt block.
//   Different LLMs / different consumers can adjust these without
//   changing what storage holds.

import { validateOrientation } from "./orientation.js";
import { resolveBareCapabilities } from "../../ables/capabilities.js";
import { resolveCanSee } from "./canSeeResolver.js";
import { emptyWeave, addReel, mergeWeaves } from "./weave.js";
import { streamRasterFace, hasRasterSubscribers } from "./rasterStream.js";

const STORAGE_FIELD_MAX = 10_000;  // 10KB per string field . defensive
const STORAGE_LIST_MAX  = 1_000;   // 1000 entries per list . defensive
const RENDER_FIELD_MAX  = 1_000;   // 1000 chars . LLM prompt budget
const RENDER_LIST_MAX   = 64;      // 64 entries . LLM prompt budget

/**
 * Clamp a single string to a maximum length. Appends `.` when the
 * input was truncated so a reader can tell the difference between
 * a string that happened to fit and one that was cut. Non-string
 * inputs pass through unchanged so callers can hand whatever they
 * have and let the clamp decide.
 */
function clampString(value, max) {
  if (typeof value !== "string") return value;
  if (value.length <= max) return value;
  return value.slice(0, max) + "...";
}

/**
 * Clamp a list to a maximum length. Appends a single trailing
 * sentinel `{kind:"truncated", count:N}` when entries were dropped
 * so a renderer can show "... (N more)" without recomputing the cap.
 * The sentinel shape is identical at storage and render layers so
 * downstream code never has to branch on which layer truncated.
 */
function clampList(list, max) {
  if (!Array.isArray(list)) return list;
  if (list.length <= max) return list;
  return [
    ...list.slice(0, max),
    { kind: "truncated", count: list.length - max },
  ];
}

/**
 * Apply both clamps to a capabilities map. Each list is clamped
 * independently. Empty / missing lists pass through as empty arrays
 * so renderers don't need null guards.
 */
function clampCapabilities(caps, fieldMax, listMax) {
  const out = {};
  for (const key of ["canDo", "canSummon", "canBe"]) {
    const list = Array.isArray(caps?.[key]) ? caps[key] : [];
    const trimmed = clampList(
      list.map(v => clampString(v, fieldMax)),
      listMax,
    );
    out[key] = trimmed;
  }
  return out;
}

/**
 * Pull the {id, name} of the position out of the folded forward face.
 * foldPlace forward returns `space: <projection>` or null; we surface
 * it as `position` (the canonical name for the inner face).
 */
function extractPosition(foldedFace) {
  const s = foldedFace?.space;
  if (!s) return null;
  return {
    id:   s._id != null ? String(s._id) : (s.id != null ? String(s.id) : null),
    name: s.name || null,
  };
}

/**
 * Clamp one canSee block for storage. payload is opaque; we cap its
 * label and pass the payload through (canSee is the able's declared
 * perception; if a able asked for a 50KB payload, the runaway gate
 * lives at the resolver, not here).
 */
function clampBlock(block, fieldMax) {
  if (!block || typeof block !== "object") return block;
  return {
    key:     clampString(block.key,     fieldMax),
    source:  block.source || null,
    label:   clampString(block.label,   fieldMax),
    payload: block.payload,
  };
}

// ── Past-fold: the inward / half face, folded from the act-chain ──
//
// INNER-FOLD §2. When a being folds INWARD the world drops out and its
// OWN act-chain stands in as the face — the SAME rasterize, only the
// source is the being's acts instead of the space/matter/being reels.
// HALF keeps the world and appends the braid-walked recall. These
// render the act rows into the SAME { key, source, label, payload }
// block shape the world reads use, so the past-face is just more face
// blocks — one face-fold, source by orientation, no separate codepath.
// (Replaces the old cognition/llm pastFaceRender + spliced pastFaceBlock.)
// No wall-clock: an act's place in the chain (its index) is its "when".

const PAST_BANNER =
  "(older acts; less context available — entries below predate inner-face capture)";

function formatPastMessage(msg) {
  if (msg == null) return "";
  if (typeof msg === "string") return msg.trim();
  if (typeof msg === "object") {
    if (typeof msg.content === "string") return msg.content.trim();
    try { return JSON.stringify(msg.content ?? msg); } catch { return ""; }
  }
  return String(msg);
}

function formatPastCapList(list) {
  if (!Array.isArray(list) || list.length === 0) return "[]";
  const parts = list.map(v =>
    v && typeof v === "object" && v.kind === "truncated"
      ? `+${v.count} more`
      : (typeof v === "string" ? v : String(v ?? "")),
  );
  return `[${parts.join(", ")}]`;
}

// Render one past act into a Word payload from its committed innerFace
// (clamped for the render budget). Index is the act's chain position —
// its "when" — not a wall-clock. Legacy acts (no captured face) render
// reduced (index + in/out).
function renderPastEntry(index, row) {
  const snap = clampForRender(row?.innerFace);
  const inLine = formatPastMessage(row?.startMessage);
  const outLine = formatPastMessage(row?.endMessage);
  if (!snap) {
    return [
      `[${index}]`,
      inLine ? `  in:  ${inLine}` : null,
      outLine ? `  out: ${outLine}` : null,
    ].filter(Boolean).join("\n");
  }
  const ableSuffix = snap.able ? `  able: ${snap.able}` : "";
  const where = snap.position?.name ? `at ${snap.position.name}` : null;
  const could = `do=${formatPastCapList(snap.capabilities?.canDo)}, summon=${formatPastCapList(snap.capabilities?.canSummon)}, be=${formatPastCapList(snap.capabilities?.canBe)}`;
  const blockKeys = Array.isArray(snap.blocks)
    ? snap.blocks.filter(b => b && b.kind !== "truncated").map(b => b?.label || b?.key || null).filter(Boolean)
    : [];
  const lines = [`[${index}]${ableSuffix}`];
  if (where) lines.push(`  ${where}`);
  lines.push(`  could: ${could}`);
  if (blockKeys.length) lines.push(`  saw: ${blockKeys.join(", ")}`);
  if (inLine) lines.push(`  in:  ${inLine}`);
  if (outLine) lines.push(`  out: ${outLine}`);
  return lines.join("\n");
}

// Inward: the act-chain (oldest first) as face blocks, one per act.
function inwardBlocks(actChain) {
  const acts = Array.isArray(actChain) ? actChain : [];
  if (acts.length === 0) {
    return [{ key: "inward-fold", source: "past", label: "Inward fold", payload: "Your act-chain is empty. No prior acts to reflect on." }];
  }
  const out = acts.map((row, i) => ({
    key: `act-${i + 1}`, source: "past", label: `act ${i + 1}`, payload: renderPastEntry(i + 1, row),
  }));
  if (acts.some(r => !r?.innerFace)) {
    out.unshift({ key: "inward-banner", source: "past", label: "note", payload: PAST_BANNER });
  }
  return out;
}

// Half: the braid-walked recall as face blocks, grouped by stitched reel.
function halfBlocks(recalled) {
  const acts = Array.isArray(recalled) ? recalled : [];
  if (acts.length === 0) return [];
  const byReel = new Map();
  for (const row of acts) {
    const key = row?.stitchedReel ? `${row.stitchedReel.kind}:${row.stitchedReel.id}` : "(unknown)";
    if (!byReel.has(key)) byReel.set(key, []);
    byReel.get(key).push(row);
  }
  const out = [];
  let index = 1;
  for (const [reelKey, rows] of byReel) {
    out.push({
      key: `recall-${reelKey}`, source: "past", label: `acts that touched ${reelKey}`,
      payload: rows.map(r => renderPastEntry(index++, r)).join("\n\n"),
    });
  }
  return out;
}

/**
 * Build the canonical inner face for one moment.
 *
 * Called from the 2-fold beat (foldBeat.runFoldBeat) AFTER foldPlace
 * has produced the fold at this orientation. Resolves capabilities and
 * the orientation's block source ONCE, here, and returns the unified
 * face object. The blocks come from the orientation's source: forward =
 * the world (canSee reels), inward = the being's own act-chain, half =
 * world + the braid-walked recall — one rasterize, source by orientation.
 *
 * Inputs:
 *   able . the active able spec
 *   ctx  . { being, beingId, currentSpace, rootId, name, history,
 *           orientation, foldedFace } . the moment ctx; foldedFace is
 *           the result of foldPlace at this orientation
 */
export async function buildInnerFace(able, ctx = {}) {
  const orientation = validateOrientation(ctx.orientation);
  const foldedFace = ctx.foldedFace || null;

  // Capabilities . cognition-agnostic. The same canDo/canSummon/canBe
  // resolver path the LLM prompt assembly uses, returning bare-name
  // string lists.
  const capabilities = await resolveBareCapabilities(able, ctx);

  // Blocks . the face's perception this moment, from the ORIENTATION's
  // source (one rasterize, source by orientation):
  //   forward — the world: the able's canSee reels, resolved here.
  //   inward  — the world drops out; the being's own act-chain stands in
  //             as the face (INNER-FOLD §2) — folded into the same blocks.
  //   half    — the world AND the braid-walked recall, appended.
  // Each block is { key, source, label, payload } whether the source is
  // the world reels or the act-chain.
  let blocks = [];
  let canSeeWeave = emptyWeave();
  if (orientation === "inward") {
    blocks = inwardBlocks(foldedFace?.actChain);
  } else if (Array.isArray(able?.canSee) && able.canSee.length > 0) {
    try {
      const resolved = await resolveCanSee(able.canSee, ctx);
      blocks = Array.isArray(resolved?.blocks) ? resolved.blocks : [];
      if (Array.isArray(resolved?.weave)) canSeeWeave = resolved.weave;
    } catch {
      blocks = [];
      canSeeWeave = emptyWeave();
    }
  }
  if (orientation === "half") {
    blocks = [...blocks, ...halfBlocks(foldedFace?.recalled)];
  }

  const position = extractPosition(foldedFace);

  // weave . merge the canSee-side reads with the foldedFace-side
  // reads (foldPlace gating). The fold-side weave already contains
  // self (and position-space + admitted occupants on forward/half);
  // merging preserves its ordering invariants and only appends new
  // canSee reads at the tail.
  let weave = mergeWeaves(foldedFace?._weave || [], canSeeWeave);

  // Empty-canSee invariant. Even when canSee admitted nothing, the
  // weave must contain at least the self being reel so a self-fact
  // wakes the subscriber. Ables are not reel-backed today (the able
  // registry is an in-memory Map, not a fact-chain), so able flips
  // manifest as facts on the being's reel (via qualities.flow);
  // the self entry already covers the able-flip wakeup. If the able
  // primitive ever becomes reel-backed, append it here.
  const history = typeof ctx?.history === "string" && ctx.history.length ? ctx.history : "0";
  if (weave.length === 0 && ctx?.beingId) {
    addReel(weave, { reelKind: "being", reelId: String(ctx.beingId), history });
  }

  const face = {
    orientation,
    able:         clampString(able?.name || null, STORAGE_FIELD_MAX),
    position:     position
      ? {
          id:   clampString(position.id,   STORAGE_FIELD_MAX),
          name: clampString(position.name, STORAGE_FIELD_MAX),
        }
      : null,
    capabilities: clampCapabilities(capabilities, STORAGE_FIELD_MAX, STORAGE_LIST_MAX),
    blocks:       clampList(
      blocks.map(b => clampBlock(b, STORAGE_FIELD_MAX)),
      STORAGE_LIST_MAX,
    ),
    weave,
    origin:       "local",
  };

  // Live rasterization (25.md Pillar D / 26.md). Stream the face's pieces
  // in rasterization order (self -> capabilities -> world) to any watcher
  // of this being -- pure observability over the fold just computed; the
  // face returned is unchanged, and a moment nobody watches pays nothing.
  // The one stream serves all three cognitions (portal / llm / scripted).
  const rasterKey = ctx?.beingId != null ? String(ctx.beingId) : null;
  if (hasRasterSubscribers(rasterKey)) {
    streamRasterFace(rasterKey, {
      able:         face.able,
      position:     face.position,
      capabilities: face.capabilities,
      blocks:       face.blocks,
      face,
    });
  }

  return face;
}

/**
 * Take a stored inner face and return a render-ready copy with the
 * tight LLM-budget caps applied. Pure function; does not mutate.
 *
 * renderPastEntry (above) calls this once per past-act entry before
 * folding the act into the inner face's blocks. The {kind:"truncated"}
 * sentinel from a storage-side cap rides through unchanged, so a
 * renderer that already shows "... (N more)" works without having
 * to know which layer did the truncation.
 *
 * Returns null when the input face is null. Renderers MUST handle null
 * by omitting able / at / could lines and keeping only timestamp + in
 * / out . and ideally precede mixed-fidelity sections with a
 * "(older acts; less context available)" banner.
 */
export function clampForRender(face) {
  if (!face) return null;

  const blocks = Array.isArray(face.blocks) ? face.blocks : [];
  const blocksClamped = clampList(
    blocks.map(b => clampBlock(b, RENDER_FIELD_MAX)),
    RENDER_LIST_MAX,
  );

  const position = face.position
    ? {
        id:   clampString(face.position.id,   RENDER_FIELD_MAX),
        name: clampString(face.position.name, RENDER_FIELD_MAX),
      }
    : null;

  return {
    orientation:  face.orientation,
    able:         clampString(face.able, RENDER_FIELD_MAX),
    position,
    capabilities: clampCapabilities(face.capabilities, RENDER_FIELD_MAX, RENDER_LIST_MAX),
    blocks:       blocksClamped,
    // weave rides through render-clamp unchanged. It is metadata
    // (audit + subscription dispatch); renderers ignore it but
    // diagnostic consumers need to see what the face was bound to.
    weave:        Array.isArray(face.weave) ? face.weave : [],
    origin:       face.origin || "local",
  };
}

/**
 * Normalize a foreign story's descriptor into the canonical inner
 * face shape so a cross-world override supersedes the local face
 * post-seal in the same shape readers already know.
 *
 * The foreign descriptor's shape varies per the receiving story's
 * SEE pipeline. We map best-effort:
 *   . descriptor.space / .position / .address . position {id, name}
 *   . descriptor.orientation . orientation (default "forward")
 *   . descriptor.able . able name
 *   . descriptor.capabilities / .canDo / .canSummon / .canBe . caps
 *   . anything else . one "place" block carrying the raw descriptor
 *     as its payload (so consumers see the whole foreign view).
 *
 * The result carries origin: "foreign" so renderers can badge the
 * cross-world override at a glance.
 */
export function normalizeForeignDescriptor(descriptor) {
  if (!descriptor || typeof descriptor !== "object") {
    return {
      orientation:  "forward",
      able:         null,
      position:     null,
      capabilities: { canDo: [], canSummon: [], canBe: [] },
      blocks:       [],
      weave:        [],
      origin:       "foreign",
    };
  }

  let position = null;
  if (descriptor.position && typeof descriptor.position === "object") {
    position = {
      id:   descriptor.position.id != null ? String(descriptor.position.id) : null,
      name: descriptor.position.name || null,
    };
  } else if (descriptor.space && typeof descriptor.space === "object") {
    position = {
      id:   descriptor.space._id != null ? String(descriptor.space._id)
            : descriptor.space.id != null ? String(descriptor.space.id) : null,
      name: descriptor.space.name || null,
    };
  } else if (descriptor.address && typeof descriptor.address === "object") {
    position = {
      id:   descriptor.address.spaceId != null ? String(descriptor.address.spaceId) : null,
      name: descriptor.address.pathByNames || null,
    };
  }

  const orientation = (typeof descriptor.orientation === "string" && descriptor.orientation)
    ? descriptor.orientation
    : "forward";

  const able = (typeof descriptor.able === "string" && descriptor.able)
    ? descriptor.able
    : (typeof descriptor.activeAble === "string" ? descriptor.activeAble : null);

  const rawCaps = (descriptor.capabilities && typeof descriptor.capabilities === "object")
    ? descriptor.capabilities
    : {
        canDo:     descriptor.canDo,
        canSummon: descriptor.canSummon,
        canBe:     descriptor.canBe,
      };

  const blocks = [];
  // If the descriptor carries a blocks list already (foreign story
  // already speaks the canonical shape), pass them through. Otherwise
  // wrap the whole descriptor as one "place" block so the structured
  // view is still readable.
  if (Array.isArray(descriptor.blocks) && descriptor.blocks.length > 0) {
    for (const b of descriptor.blocks) {
      if (b && typeof b === "object") {
        blocks.push({
          key:     b.key || null,
          source:  b.source || null,
          label:   b.label || b.key || null,
          payload: b.payload != null ? b.payload : null,
        });
      }
    }
  } else {
    blocks.push({
      key:     "place",
      source:  "see",
      label:   "place",
      payload: descriptor,
    });
  }

  return {
    orientation,
    able:         clampString(able, STORAGE_FIELD_MAX),
    position:     position
      ? {
          id:   clampString(position.id,   STORAGE_FIELD_MAX),
          name: clampString(position.name, STORAGE_FIELD_MAX),
        }
      : null,
    capabilities: clampCapabilities(rawCaps, STORAGE_FIELD_MAX, STORAGE_LIST_MAX),
    blocks:       clampList(
      blocks.map(b => clampBlock(b, STORAGE_FIELD_MAX)),
      STORAGE_LIST_MAX,
    ),
    // weave has no meaning for a foreign descriptor (we did not fold
    // the foreign story's reels). The foreign push channel, when it
    // lands, is the channel of record for foreign updates.
    weave:        [],
    origin:       "foreign",
  };
}
