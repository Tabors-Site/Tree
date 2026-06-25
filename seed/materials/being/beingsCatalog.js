// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// beingsCatalog.js — global being catalog.
//
// Per the locked model, beings live at their home position. The
// per-position SEE descriptor's `beings[]` array only shows beings homed
// at THAT position. The catalog returned here is the cross-position
// view: every Being row, regardless of home. Used by clients (the
// flat-app, future tooling) to render a global list — answers "what
// beings exist?" the way `./operations` answers "what operations exist?"
//
// History-aware. Default history is "0" (main); callers can scope to a
// specific history to see that history's beings (lazy inheritance from
// main applies via listByType).

const MAX_LIMIT = 500;

/**
 * Build the beings-catalog descriptor.
 *
 * @param {object} [opts]
 * @param {number} [opts.limit=200]
 * @param {string} [opts.history="0"]
 * @returns {Promise<{ beings: object[], count: number }>}
 */
export async function describeBeingsCatalog(opts = {}) {
  const limit = Math.min(Math.max(Number(opts.limit) || 200, 1), MAX_LIMIT);
  const history = opts.history || "0";
  const { listByType, loadProjections } = await import("../projections.js");
  const { beingCognition } = await import("./identity/lookups.js");

  // listByType gives us {type, id} pairs; batch-load the full slots to
  // get state (name, qualities, etc.) for each.
  const slotRefs = await listByType("being", history);
  const slice = slotRefs.slice(0, limit);
  const slots = await loadProjections("being", slice.map((r) => r.id), history);

  const entries = slice.map((slotRef) => {
    const slot = slots.get(slotRef.id);
    const state = slot?.state || {};
    return {
      beingId:       String(slotRef.id),
      name:          state.name || null,
      cognition:     beingCognition(state),
      defaultAble:   state.defaultAble || null,
      homeSpace:     state.homeSpace || null,
      parentBeingId: state.parentBeingId || null,
      bornOrd:       state.bornOrd ?? null,
    };
  });
  // Sort by birth order (bornOrd = the birth fact's append ordinal), first-created first — clock-free,
  // the ordinal IS the order (no `new Date(createdAt)`). Replaces the legacy createdAt-asc sort.
  entries.sort((a, b) => (a.bornOrd ?? 0) - (b.bornOrd ?? 0));

  return { beings: entries, count: entries.length };
}
