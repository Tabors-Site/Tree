// Governing role lifecycle (substrate-as-universal-workspace shape).
//
// promoteToRuler is the single function that records a node taking on
// ruler authority for a domain. After this rewrite, it ALSO spawns the
// full governing being family at the rulership node:
//
//   Ruler being           (parented to the requesting user-being via
//                          parentBeingId; root Rulers have no parent)
//   ├── Planner being     (being-tree child of Ruler, same homeSpace)
//   ├── Contractor being  (being-tree child of Ruler, same homeSpace)
//   └── Foreman being     (being-tree child of Ruler, same homeSpace)
//
// All four live at the same rulership node. The being-tree carries the
// cognitive hierarchy; the node tree stays clean (no plan/contracts/
// execution trio nodes anymore). Plans/contracts/executions become
// artifacts authored by their owning beings (Planner authors plans,
// etc.) . see [[project_substrate_as_universal_workspace]] for the
// framing.
//
// promoteToRuler is called at every depth uniformly:
//
//   1. Root node, on user request arrival. Orchestrator promotes the
//      root before dispatching a Planner.
//   2. Branch node, on sub-Ruler dispatch. Branch IS a sub-Ruler, not a
//      Worker pretending to coordinate.
//   3. Worker mid-build, on scope undershoot. Worker's own node
//      promotes retroactively and its sub-branches dispatch under the
//      new Ruler.
//
// Idempotent. A second promote on a node already marked as ruler
// returns the existing record without changing acceptedAt or re-
// spawning beings.
//
// metadata.governing has shape:
//   {
//     role: "ruler",
//     acceptedAt: ISO timestamp,
//     reason: short string describing why,
//     promotedFrom: "root" | "branch-dispatch" | "worker-undershoot",
//     beings: { ruler, planner, contractor, foreman } // beingIds
//   }

import Space from "../../../seed/models/space.js";
import log  from "../../../seed/system/log.js";

export const NS = "governing";

// The four beings the rulership spawns. Add roles here when governing
// learns to spawn additional inner beings (e.g. judge, herald).
const INNER_ROLES = ["planner", "contractor", "foreman"];

export const PROMOTED_FROM = {
  ROOT: "root",
  BRANCH_DISPATCH: "branch-dispatch",
  WORKER_UNDERSHOOT: "worker-undershoot",
};

/**
 * Promote a node to Ruler AND spawn the inner-being family at the same
 * node parented to the Ruler being. Idempotent: a second call on an
 * already-promoted node returns the existing record without re-spawning.
 *
 * Returns the governing metadata record after the write (including the
 * beings map with the four governing beingIds).
 *
 * Requires `core` with the verb surface available . the helpers chain
 * through `core.do` for all writes.
 *
 * Ruler parent resolution (preferred order):
 *   1. explicit `parentBeingId` arg — sub-Ruler dispatch threads the
 *      parent Ruler's beingId here so the sub-Ruler is its child.
 *   2. `identity.beingId` — when called through core.do, this is the
 *      requesting being; the Ruler becomes its child. Matches "if I
 *      promote a node, the Ruler is my child."
 *   3. `delegateToHigherBeing.beingId` — root Ruler fallback to the
 *      tree's rootOwner (the human who spawned the tree).
 *
 * Null parent is reserved for the very root being of the land only;
 * Rulers should always have a parent in the resolved chain.
 */
export async function promoteToRuler({ spaceId, reason, promotedFrom, parentBeingId = null, identity = null, core }) {
  if (!spaceId) return null;
  if (!core?.do) throw new Error("promoteToRuler requires `core` (verb surface)");
  if (!Object.values(PROMOTED_FROM).includes(promotedFrom)) {
    promotedFrom = PROMOTED_FROM.ROOT;
  }

  const node = await Space.findById(spaceId);
  if (!node) return null;

  const existing = node.metadata instanceof Map
    ? node.metadata.get(NS)
    : node.metadata?.[NS];

  if (existing?.role === "ruler" && existing?.acceptedAt) {
    // Already promoted. Idempotent return.
    return existing;
  }

  const acceptedAt = new Date().toISOString();
  const data = {
    role: "ruler",
    acceptedAt,
    reason: typeof reason === "string" ? reason.slice(0, 200) : null,
    promotedFrom,
  };

  // Delegate-to-higher-being. Only root Rulers carry this — sub-Rulers
  // inherit their higher being through their parentBeingId / the
  // parent Ruler. For root, governing records the tree's `rootOwner`
  // (the human being who spawned the tree).
  if (!node.parent && node.rootOwner) {
    data.delegateToHigherBeing = { beingId: String(node.rootOwner) };
  }

  // 1. Stamp governing role on the node.
  await core.do(node, "set-meta", {
    namespace: NS,
    data,
    merge: false,
  }, { identity });

  // 2. Spawn the Ruler being at this node. Parent chain prefers explicit
  //    parentBeingId (sub-Ruler dispatch), then the requesting being
  //    (identity.beingId from the verb surface), then the tree's
  //    delegate higher being (rootOwner for root rulerships).
  const effectiveParentBeingId =
    parentBeingId ||
    identity?.beingId ||
    data.delegateToHigherBeing?.beingId ||
    null;

  // createBeingWithHome handles both the parentBeingId stamp on the
  // new being AND the $addToSet into the parent's children list, so
  // no separate link write is needed here.
  const { createBeingWithHome } = await import("../../../seed/being/identity.js");
  const rulerCreated = await createBeingWithHome({
    operatingMode: "llm",
    role:          "ruler",
    homeSpace:     String(spaceId),
    parentBeingId: effectiveParentBeingId,
  });
  const rulerBeingId = String(rulerCreated.being._id);

  // 3. Spawn each inner being (Planner, Contractor, Foreman) as a
  //    being-tree child of the Ruler. All live at the SAME node . no
  //    more trio child nodes. The being tree carries the cognitive
  //    hierarchy; the node tree stays clean.
  const innerBeings = {};
  for (const role of INNER_ROLES) {
    const innerCreated = await createBeingWithHome({
      operatingMode: "llm",
      role,
      homeSpace:     String(spaceId),
      parentBeingId: rulerBeingId,
    });
    innerBeings[role] = String(innerCreated.being._id);
  }

  // 4. Record the spawned beings on the node's governing namespace so
  //    descriptor lookups / queries can find them by role without
  //    walking the being tree every time.
  const beingsRegistry = {
    ruler:      { beingId: rulerBeingId,            installedAt: acceptedAt, installedBy: "governing", from: promotedFrom },
    planner:    { beingId: innerBeings.planner,     installedAt: acceptedAt, installedBy: "governing" },
    contractor: { beingId: innerBeings.contractor,  installedAt: acceptedAt, installedBy: "governing" },
    foreman:    { beingId: innerBeings.foreman,     installedAt: acceptedAt, installedBy: "governing" },
  };
  await core.do(node, "set-meta", {
    namespace: "beings",
    data: beingsRegistry,
    merge: true,
  }, { identity });

  // 5. Stance permissions at the rulership node.
  //
  //    @ruler is the open entry point — humans, citizens, federated
  //    visitors can all summon. Inner beings (planner / contractor /
  //    foreman) are protected: only beings of governing roles whose
  //    home is within this rulership's subtree can summon them.
  await core.do(node, "set-meta", {
    namespace: "permissions",
    data: {
      summon: {
        "@ruler*":      { requires: {} },
        "@planner*":    { requires: { role: ["ruler", "planner", "contractor", "foreman"], homeInDomain: String(spaceId) } },
        "@contractor*": { requires: { role: ["ruler", "planner", "contractor", "foreman"], homeInDomain: String(spaceId) } },
        "@foreman*":    { requires: { role: ["ruler", "planner", "contractor", "foreman"], homeInDomain: String(spaceId) } },
      },
    },
    merge: true,
  }, { identity });

  log.info("Governing",
    `🤴 Space ${String(spaceId).slice(0, 8)} ("${node.name || "?"}") promoted to Ruler ` +
    `(from=${promotedFrom}, parent=${effectiveParentBeingId ? String(effectiveParentBeingId).slice(0, 8) : "none"}) ` +
    `+ spawned ${INNER_ROLES.length} inner beings`);

  try {
    const { hooks } = await import("../../../seed/system/hooks.js");
    hooks.run("governing:rulerPromoted", {
      spaceId: String(spaceId),
      data: { ...data, beings: { ruler: rulerBeingId, ...innerBeings } },
    }).catch(() => {});
  } catch (err) {
    log.debug("Governing", `governing:rulerPromoted hook fire failed: ${err.message}`);
  }

  return { ...data, beings: { ruler: rulerBeingId, ...innerBeings } };
}

/**
 * Read the governing record for a node. Returns null if the node has
 * not been promoted.
 */
export async function readRole(spaceId) {
  if (!spaceId) return null;
  const node = await Space.findById(spaceId).select("metadata").lean();
  if (!node) return null;
  const meta = node.metadata instanceof Map
    ? Object.fromEntries(node.metadata)
    : (node.metadata || {});
  return meta[NS] || null;
}

/**
 * Convenience predicate: has this node been promoted to Ruler?
 */
export async function isRuler(spaceId) {
  const record = await readRole(spaceId);
  return record?.role === "ruler";
}

/**
 * Walk DOWN from a root node, collecting every Ruler scope in the
 * subtree. Returns a flat ordered list with depth attached, in
 * tree-walk order (parents before children, depth-first). The root
 * appears at depth=0 if it's itself a Ruler.
 *
 * Used by the governance dashboard to render the full rulership tree
 * on one page. The single-step buildRulerSnapshot walks 1 level down
 * (immediate sub-Rulers); this helper produces the full recursive
 * list so the dashboard can render an indented tree.
 *
 * MAX_RULERS is a runaway-protection ceiling. Real trees have at
 * most a few dozen Ruler scopes; 256 is paranoia. Hitting the cap
 * suggests a bug (cycle, exploded sub-Ruler dispatch) and is logged
 * once when the walk terminates.
 */
const MAX_RULERS = 256;

export async function walkRulers(rootId) {
  if (!rootId) return [];
  const Space = (await import("../../../seed/models/space.js")).default;
  const out = [];
  const visited = new Set();

  async function visit(spaceId, depth) {
    if (out.length >= MAX_RULERS) return;
    if (!spaceId) return;
    const idStr = String(spaceId);
    if (visited.has(idStr)) return;
    visited.add(idStr);

    const node = await Space.findById(idStr).select("_id name metadata children").lean();
    if (!node) return;
    const meta = node.metadata instanceof Map
      ? Object.fromEntries(node.metadata)
      : (node.metadata || {});
    if (meta[NS]?.role === "ruler") {
      out.push({
        depth,
        rulerNodeId: idStr,
        name: node.name || "(unnamed)",
      });
      // Only descend below Ruler scopes — non-Ruler descendants of a
      // non-Ruler ancestor can't host Ruler grandchildren in this
      // architecture (Rulers are stamped at scope dispatch time, so
      // sub-Rulers always have a Ruler parent).
      const childIds = Array.isArray(node.children) ? node.children.map(String) : [];
      for (const cid of childIds) {
        await visit(cid, depth + 1);
      }
    } else if (depth === 0) {
      // Root that isn't a Ruler yet — common for fresh trees before
      // first user message. Walk children defensively in case an
      // earlier session promoted a sub-tree without promoting the
      // root. Doesn't recurse deeper than direct children for
      // non-Ruler nodes to avoid scanning entire trees.
      const childIds = Array.isArray(node.children) ? node.children.map(String) : [];
      for (const cid of childIds) {
        const child = await Space.findById(cid).select("_id metadata").lean();
        if (!child) continue;
        const cmeta = child.metadata instanceof Map
          ? Object.fromEntries(child.metadata)
          : (child.metadata || {});
        if (cmeta[NS]?.role === "ruler") {
          await visit(cid, 1);
        }
      }
    }
  }

  await visit(rootId, 0);
  if (out.length >= MAX_RULERS) {
    log.warn("Governing/walkRulers",
      `walkRulers hit MAX_RULERS=${MAX_RULERS} starting from ${String(rootId).slice(0, 8)}; ` +
      `truncated. Indicates a runaway dispatch or cycle worth investigating.`);
  }
  return out;
}

/**
 * Walk upward from a node, return the nearest ancestor (or self) marked
 * as Ruler. Returns the lean Space document, or null if no Ruler found
 * before reaching the tree root.
 *
 * Used by callers that need "the Ruler governing this position" — e.g.
 * swarm's resume detection, dispatcher's scope resolution. Bounded
 * 64-depth walk; visited-set guard against cycles.
 */
export async function findRulerScope(spaceId) {
  if (!spaceId) return null;
  const Space = (await import("../../../seed/models/space.js")).default;
  const visited = new Set();
  let cursor = String(spaceId);
  for (let i = 0; i < 64; i++) {
    if (!cursor || visited.has(cursor)) break;
    visited.add(cursor);
    const n = await Space.findById(cursor).select("_id name parent metadata").lean();
    if (!n) return null;
    const meta = n.metadata instanceof Map
      ? Object.fromEntries(n.metadata)
      : (n.metadata || {});
    if (meta[NS]?.role === "ruler") return n;
    if (!n.parent) return null;
    cursor = String(n.parent);
  }
  return null;
}
