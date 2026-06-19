// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// Position address parse/format. A being's position is stored as a
// String in `Being.position`. The string carries either:
//
//   bare spaceId            same-world position (this story,
//                           current branch of access)
//   "<story>#<branch>/<spaceId>"
//                           cross-world position (foreign story
//                           and/or foreign branch)
//
// Per CROSS-WORLD.md "The position quality":
//
//   For a being at home, <story> is the home domain and <branch>
//   is the active branch. For a foreign-position being, both can
//   differ. The substrate uses the position to determine where verbs
//   default to: SEE / DO / SUMMON / BE against the being's stance
//   routes to whatever story+branch their position currently names.
//
// Always operates on ACTUAL branch paths, never pointers — pointer
// resolution happens at the address-parsing perimeter before any
// position write. See CROSS-WORLD.md "Pointers vs actual branches."

// Capture order: story (required when cross-world), branch
// (optional within story), spaceId (required).
//
// Examples:
//   "abc-123"                       → same-world: { spaceId: "abc-123" }
//   "tabors.site#0/abc-123"         → cross-world: { story, branch, spaceId }
//   "tabors.site#4a/abc-123"        → cross-world: { story, branch, spaceId }
//   "tabors.site/abc-123"           → cross-world story only: { story, branch: "0", spaceId }
const CROSS_WORLD_RE = /^([^#/]+)(?:#([^/]+))?\/(.+)$/;

/**
 * Parse a position string into its components. Bare spaceId returns
 * the spaceId only (the rest is implicit-this-world). Cross-world
 * shape returns the full triple.
 *
 * @param {string|null|undefined} position
 * @returns {{ story?: string, branch?: string, spaceId: string }|null}
 */
export function parsePositionAddress(position) {
  if (typeof position !== "string" || !position.length) return null;
  const m = CROSS_WORLD_RE.exec(position);
  if (m) {
    return {
      story: m[1],
      branch:  m[2] || "0",
      spaceId: m[3],
    };
  }
  // Bare spaceId — same-world. No story / branch prefix.
  return { spaceId: position };
}

/**
 * Format a position triple into the canonical string. Same-world
 * positions (story / branch absent) format as bare spaceId.
 * Cross-world positions format as "<story>#<branch>/<spaceId>".
 *
 * @param {{ story?: string, branch?: string, spaceId: string }} parts
 * @returns {string}
 */
export function formatPositionAddress({ story, branch, spaceId } = {}) {
  if (typeof spaceId !== "string" || !spaceId.length) {
    throw new Error("formatPositionAddress: spaceId is required");
  }
  if (!story) return spaceId;
  const b = branch || "0";
  return `${story}#${b}/${spaceId}`;
}

/**
 * True when the position address points at a different world than
 * the provided "home" tuple. Use to decide whether a verb should
 * route cross-world or operate locally.
 *
 * @param {string} position
 * @param {{ story: string, branch?: string }} home
 * @returns {boolean}
 */
export function isPositionCrossWorld(position, home) {
  const parts = parsePositionAddress(position);
  if (!parts) return false;
  if (!parts.story) return false;  // bare spaceId is always same-world
  if (!home?.story) return true;
  if (parts.story !== home.story) return true;
  const positionBranch = parts.branch || "0";
  const homeBranch     = home.branch  || "0";
  return positionBranch !== homeBranch;
}
