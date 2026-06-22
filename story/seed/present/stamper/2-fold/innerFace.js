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
//     role:        <role name string>,
//     position:    { id, name } | null,
//     capabilities: { canDo, canSummon, canBe },
//     blocks:      [{ key, source, label, payload }, ...],
//     origin:      "local" | "foreign",
//   }
//
// `blocks` is the resolved role.canSee output. Each entry stores its
// source tag ("address" for IBP-address entries, "see" for registered
// SEE-name entries), its label, and the structured payload that was
// admitted by canSee. An empty role.canSee yields blocks: [] and the
// face is still substantive (orientation + role + position + caps).
//
// The face is built ONCE per moment, at the 2-fold beat
// (foldBeat.runFoldBeat), and rides on moment.innerFace. The LLM
// mouth formats blocks into prompt prose via innerFaceFormat.js; the
// scripted role reads ctx.innerFace as data; the human portal reads
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
import { resolveBareCapabilities } from "../../roles/capabilities.js";
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
 * label and pass the payload through (canSee is the role's declared
 * perception; if a role asked for a 50KB payload, the runaway gate
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

/**
 * Build the canonical inner face for one moment.
 *
 * Called from the 2-fold beat (foldBeat.runFoldBeat) AFTER foldPlace
 * has produced the forward face. Resolves capabilities and the role's
 * canSee list ONCE, here, and returns the unified face object.
 *
 * Inputs:
 *   role . the active role spec
 *   ctx  . { being, beingId, currentSpace, rootId, name, history,
 *           orientation, foldedFace } . the moment ctx; foldedFace is
 *           the result of foldPlace at this orientation
 */
export async function buildInnerFace(role, ctx = {}) {
  const orientation = validateOrientation(ctx.orientation);
  const foldedFace = ctx.foldedFace || null;

  // Capabilities . cognition-agnostic. The same canDo/canSummon/canBe
  // resolver path the LLM prompt assembly uses, returning bare-name
  // string lists.
  const capabilities = await resolveBareCapabilities(role, ctx);

  // canSee . the role's declared perception this moment. Resolved
  // once, here. Each block is { key, source, label, payload }. An
  // inward orientation drops the world: canSee is the world; we
  // skip the resolution and let the inward past-face stand alone.
  let blocks = [];
  let canSeeWeave = emptyWeave();
  if (orientation !== "inward" && Array.isArray(role?.canSee) && role.canSee.length > 0) {
    try {
      const resolved = await resolveCanSee(role.canSee, ctx);
      blocks = Array.isArray(resolved?.blocks) ? resolved.blocks : [];
      if (Array.isArray(resolved?.weave)) canSeeWeave = resolved.weave;
    } catch {
      blocks = [];
      canSeeWeave = emptyWeave();
    }
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
  // wakes the subscriber. Roles are not reel-backed today (the role
  // registry is an in-memory Map, not a fact-chain), so role flips
  // manifest as facts on the being's reel (via qualities.roleFlow);
  // the self entry already covers the role-flip wakeup. If the role
  // primitive ever becomes reel-backed, append it here.
  const history = typeof ctx?.history === "string" && ctx.history.length ? ctx.history : "0";
  if (weave.length === 0 && ctx?.beingId) {
    addReel(weave, { reelKind: "being", reelId: String(ctx.beingId), history });
  }

  const face = {
    orientation,
    role:         clampString(role?.name || null, STORAGE_FIELD_MAX),
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
      role:         face.role,
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
 * Renderers (renderInwardPastFace, renderHalfPastFace) call this
 * once per past-act entry before formatting. The {kind:"truncated"}
 * sentinel from a storage-side cap rides through unchanged, so a
 * renderer that already shows "... (N more)" works without having
 * to know which layer did the truncation.
 *
 * Returns null when the input face is null. Renderers MUST handle null
 * by omitting role / at / could lines and keeping only timestamp + in
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
    role:         clampString(face.role, RENDER_FIELD_MAX),
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
 *   . descriptor.role . role name
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
      role:         null,
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

  const role = (typeof descriptor.role === "string" && descriptor.role)
    ? descriptor.role
    : (typeof descriptor.activeRole === "string" ? descriptor.activeRole : null);

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
    role:         clampString(role, STORAGE_FIELD_MAX),
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
