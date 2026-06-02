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
// Read-only. No moment. Auth: any authenticated being can list; tighten
// later if a position-scoped variant is needed.

const MAX_LIMIT = 500;

/**
 * Build the beings-catalog descriptor.
 *
 * @param {object} [opts]
 * @param {number} [opts.limit=200]
 * @returns {Promise<{ beings: object[], count: number }>}
 */
export async function describeBeingsCatalog(opts = {}) {
  const limit = Math.min(Math.max(Number(opts.limit) || 200, 1), MAX_LIMIT);
  const Being = (await import("./being.js")).default;
  const { beingCognition } = await import("./identity/lookups.js");
  const rows = await Being.find({})
    .select("_id name qualities roles defaultRole homeSpace parentBeingId createdAt")
    .sort({ createdAt: 1 })
    .limit(limit)
    .lean();

  return {
    beings: rows.map((b) => ({
      beingId:       String(b._id),
      name:          b.name,
      cognition:     beingCognition(b),
      roles:         Array.isArray(b.roles) ? b.roles : [],
      defaultRole:   b.defaultRole || null,
      homeSpace:     b.homeSpace ? String(b.homeSpace) : null,
      parentBeingId: b.parentBeingId ? String(b.parentBeingId) : null,
      createdAt:     b.createdAt || null,
    })),
    count: rows.length,
  };
}
