// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// facadeSnapshot.js — the bounded record of the face an act was
// committed under.
//
// Stored on Act. Read by turned folds (half / inward). The forward
// path never reads it. Captured uniformly across LLM, scripted, and
// human-inhabited cognitions so the act-chain never carries half-
// records (INNER-FOLD §6: "the act-chain is always written at the
// seal of any DO/BE moment").
//
// Two cap profiles live here so the relationship is obvious:
//
//   STORAGE caps (defensive). Applied by buildFacadeSnapshot when
//   the snapshot is produced for persistence on Act. High enough
//   that any honest face slips through unclamped; tight enough to
//   prevent a runaway extension from writing a 50MB occupant list.
//   The chain is the truth; storage is a bounded record of the face.
//
//   RENDER caps (LLM prompt budget). Applied by clampForRender when
//   a renderer pulls a stored snapshot into a turned-fold prompt
//   block. Different LLMs / different consumers can adjust these
//   without changing what storage holds.
//
// Full face reconstruction (when needed for deeper investigation)
// goes through the chain, not through this snapshot. The snapshot
// is a prompt-renderable summary; the chain is the truth.
//
// The act-chain with snapshots is the being's memory, but the
// inward fold isn't only a reading surface — it's a place the
// being can reason on what it has done and act there before
// turning back. An inward moment can seal inner acts (per spec
// §5: ΔF lands only on the doer's own reel — self-summons,
// self-marks). The being thinks alone, leaves a record of the
// thinking in its own chain, then self-summons forward to act
// in shared space with that reasoning behind it. So this snapshot
// is also doing double duty: it makes the inward room legible to
// the being who walks back into it next moment, after which the
// being's deeds there become part of what future-self will find.



import { validateOrientation } from "./orientation.js";

const STORAGE_FIELD_MAX = 10_000;  // 10KB per string field — defensive
const STORAGE_LIST_MAX  = 1_000;   // 1000 entries per list — defensive
const RENDER_FIELD_MAX  = 1_000;   // 1000 chars — LLM prompt budget
const RENDER_LIST_MAX   = 64;      // 64 entries — LLM prompt budget

/**
 * Clamp a single string to a maximum length. Appends `…` when the
 * input was truncated so a reader can tell the difference between
 * a string that happened to fit and one that was cut. Non-string
 * inputs pass through unchanged so callers can hand whatever they
 * have and let the clamp decide.
 */
function clampString(value, max) {
  if (typeof value !== "string") return value;
  if (value.length <= max) return value;
  return value.slice(0, max) + "…";
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
 * Apply both clamps to an occupant entry. Bare-bones shape:
 * {kind, id, name}.
 */
function clampOccupant(occ, fieldMax) {
  if (!occ || typeof occ !== "object") return occ;
  if (occ.kind === "truncated") return occ;
  return {
    kind: clampString(occ.kind, fieldMax),
    id:   clampString(occ.id,   fieldMax),
    name: clampString(occ.name, fieldMax),
  };
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
 * Pull a bare-bones occupant list out of whatever shape the runner
 * had on hand. foldPlace's forward face returns
 * occupants: [{type, id, state}] — `state.name` is the canonical
 * name field for a being / matter / space projection. Best-effort:
 * if a name can't be located, fall back to the id.
 */
function extractOccupants(face) {
  const raw = Array.isArray(face?.occupants) ? face.occupants : [];
  return raw.map(o => ({
    kind: o.type || o.kind || null,
    id:   o.id != null ? String(o.id) : null,
    name: o.state?.name || o.name || (o.id != null ? String(o.id) : null),
  }));
}

/**
 * Pull the {id, name} of the position the being saw out of the
 * face. foldPlace forward returns space: <projection> or null.
 */
function extractSpace(face) {
  const s = face?.space;
  if (!s) return null;
  return {
    id:   s._id != null ? String(s._id) : (s.id != null ? String(s.id) : null),
    name: s.name || null,
  };
}

/**
 * Build the storage snapshot. Applies STORAGE caps only — the
 * defensive bound against runaway data. The returned object is
 * what gets persisted on Act.facadeSnapshot.
 *
 * Inputs:
 *   orientation . the ω this moment ran under
 *   role        . the activeRole string (already on Act, but kept
 *                 self-contained so a renderer doesn't need to
 *                 cross-reference)
 *   face        . the forward face the runner had on hand. Shape
 *                 from foldPlace: {self, space, occupants}. For
 *                 inward moments the runner may pass {} or a sparse
 *                 face — that's fine, the extractors handle gaps.
 *   capabilities . {canDo, canSummon, canBe} as string lists. The
 *                 prompt builder already resolved these; we just
 *                 store the names.
 */
export function buildFacadeSnapshot({ orientation, role, face, capabilities } = {}) {
  const ω = validateOrientation(orientation);

  const occupants = extractOccupants(face).map(o => clampOccupant(o, STORAGE_FIELD_MAX));
  const occupantsCapped = clampList(occupants, STORAGE_LIST_MAX);

  const space = extractSpace(face);
  const spaceCapped = space
    ? {
        id:   clampString(space.id,   STORAGE_FIELD_MAX),
        name: clampString(space.name, STORAGE_FIELD_MAX),
      }
    : null;

  return {
    orientation: ω,
    role: clampString(role || null, STORAGE_FIELD_MAX),
    space: spaceCapped,
    occupants: occupantsCapped,
    capabilities: clampCapabilities(capabilities, STORAGE_FIELD_MAX, STORAGE_LIST_MAX),
  };
}

/**
 * Take a stored snapshot and return a render-ready copy with the
 * tight LLM-budget caps applied. Pure function; does not mutate.
 *
 * Renderers (renderInwardPastFace, renderHalfPastFace) call this
 * once per past-act entry before formatting. The {kind:"truncated"}
 * sentinel from a storage-side cap rides through unchanged, so a
 * renderer that already shows "... (N more)" works without having
 * to know which layer did the truncation.
 *
 * Returns null when the input snapshot is null (legacy Acts pre-
 * dating the facadeSnapshot field). Renderers MUST handle null by
 * omitting role / at / could lines and keeping only timestamp +
 * in / out — and ideally precede mixed-fidelity sections with a
 * "(older acts; less context available)" banner.
 */
export function clampForRender(snapshot) {
  if (!snapshot) return null;

  const occupants = Array.isArray(snapshot.occupants) ? snapshot.occupants : [];
  const occupantsClamped = clampList(
    occupants.map(o => clampOccupant(o, RENDER_FIELD_MAX)),
    RENDER_LIST_MAX,
  );

  const space = snapshot.space
    ? {
        id:   clampString(snapshot.space.id,   RENDER_FIELD_MAX),
        name: clampString(snapshot.space.name, RENDER_FIELD_MAX),
      }
    : null;

  return {
    orientation: snapshot.orientation,
    role: clampString(snapshot.role, RENDER_FIELD_MAX),
    space,
    occupants: occupantsClamped,
    capabilities: clampCapabilities(snapshot.capabilities, RENDER_FIELD_MAX, RENDER_LIST_MAX),
  };
}
