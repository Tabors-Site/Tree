// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// matter/coordBounds.js — the ONE canonical matter coord-bounds check.
//
// Lifted from matter/ops.js (where create-matter + set-matter both
// reached for it) and matterHost.js (which carried a verbatim second
// copy). Both now import from here: set-matter's coord branch in
// matter/ops.js and the create-matter bundle in
// store/words/create-matter/.
//
// Same doctrine as set-being:coord (see being/ops.js header for
// assertCoordInBounds): silent clamping was a lie; throwing on an
// out-of-bounds axis keeps the chain honest — the fact never seals.
//
// The SAME honesty applies one step earlier, at the SHAPE: a present
// axis that isn't a finite number is REFUSED, never silently dropped.
// Skipping an absent axis is a legit partial update ({x} alone moves
// along one axis); skipping a PROVIDED-but-garbage axis (z:"foo") is the
// clamp-lie in another coat — the caller named z, the row would seal
// without it and report success. So: absent ⇒ skip, present-but-non-
// finite ⇒ throw (the same hole move.word's z gate closes).

import { IbpError, IBP_ERR } from "../../ibp/protocol.js";

export const COORD_AXES = ["x", "y", "z"];

/**
 * The per-axis bounds CHECK against an already-resolved `size`, the ONE
 * place the cell-vs-position math lives so callers don't each carry a copy
 * (move's resolve-source did, and that inline copy was the asserted — not
 * proven — twin of this one). Throws IbpError(INVALID_INPUT) on an
 * out-of-bounds axis. The math is deliberately two-way:
 *   - an INTEGER coord is a 0-indexed CELL → valid range [0, trunc(size)-1]
 *     (a size-10 axis has cells 0..9; cell 10 doesn't exist);
 *   - a FLOAT coord is a continuous POSITION → valid range [0, size) (the
 *     `size - EPSILON` upper edge is the largest double below size).
 * Non-finite axes are skipped (callers gate shape upstream — set-matter via
 * assertMatterCoordInBounds's throw, move via move.word's finite-number
 * gates). `op` / `noun` label the error for the calling verb.
 */
export function assertCoordWithinSize(coord, size, { op = "set-matter", noun = "space" } = {}) {
  if (!size) return;
  for (const a of COORD_AXES) {
    const v = coord?.[a];
    if (!Number.isFinite(v)) continue;
    const cap = typeof size[a] === "number" && size[a] > 0 ? size[a] : null;
    if (cap === null) continue;
    const high = Number.isInteger(v) ? Math.trunc(cap) - 1 : cap - Number.EPSILON;
    if (v < 0 || v > high) {
      throw new IbpError(
        IBP_ERR.INVALID_INPUT,
        `${op}: coord.${a}=${v} is out of bounds (0..${high} for this ${noun})`,
        { axis: a, value: v, cap: high },
      );
    }
  }
}

/**
 * Validate a coord write against the matter's space size. Throws
 * IbpError(INVALID_INPUT) on a present-but-non-finite axis (the shape)
 * or an out-of-bounds axis (the size) — the fact never seals. An absent
 * axis (undefined/null) is skipped, leaving a partial update intact.
 */
export async function assertMatterCoordInBounds(matterDoc, raw, history = "0") {
  const out = {};
  for (const a of COORD_AXES) {
    const v = raw?.[a];
    if (v === undefined || v === null) continue; // axis not provided — a legit partial update
    if (typeof v !== "number" || !Number.isFinite(v)) {
      // present-but-garbage: refuse rather than silently drop. The drop would lie —
      // the caller asked to set this axis and the row would seal without it.
      throw new IbpError(
        IBP_ERR.INVALID_INPUT,
        `set-matter: coord.${a}=${JSON.stringify(v)} must be a finite number`,
        { axis: a, value: v },
      );
    }
    out[a] = v;
  }
  if (Object.keys(out).length === 0) return null;
  const spaceId = matterDoc?.spaceId || null;
  if (!spaceId || spaceId === "deleted") return out;
  const { loadOrFold } = await import("../projections.js");
  const spaceSlot = await loadOrFold("space", spaceId, history);
  const size = spaceSlot?.state?.size || null;
  // the bounds math (the ONE copy) — out is finite-only by here, so the
  // helper's non-finite skip is a no-op and only the size check runs.
  assertCoordWithinSize(out, size, { op: "set-matter", noun: "space" });
  return out;
}
