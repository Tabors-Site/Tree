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

import { IbpError, IBP_ERR } from "../../ibp/protocol.js";

export const COORD_AXES = ["x", "y", "z"];

/**
 * Validate a coord write against the matter's space size. Throws
 * IbpError(INVALID_INPUT) on an out-of-bounds axis — the fact never
 * seals.
 */
export async function assertMatterCoordInBounds(matterDoc, raw, branch = "0") {
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
