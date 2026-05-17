// TreeOS IBP — Stance Authorization.
//
// The kernel system that determines what one stance can do toward another
// stance or position through a portal connection. Every IBP verb call
// flows through this function.
//
// Inputs:
//   - identity: { userId, username } | null
//   - verb:     "see" | "do" | "talk" | "be"
//   - target:   { kind: "position"|"stance"|"land", value, nodeId?, ... }
//   - action?:  string (for DO)
//   - namespace?: string (for set-meta / clear-meta)
//   - intent?:  string (for TALK)
//   - operation?: string (for BE)
//
// Output:
//   { ok: boolean, stance: "arrival"|"owner"|"member", reason?: string }
//
// Phase 5 ships TWO real stances: arrival (unauthenticated) and owner
// (authenticated with write access at the scope). Authenticated requesters
// without write access fall through as "member" with the existing
// resolveTreeAccess semantics (visibility filter on SEE, contributor
// rules on DO). Additional named stances (guest, moderator, custom) are
// Phase 7+ work.
//
// Permission shape at metadata.embodiments.<stance>.permissions:
//   {
//     see:  { allowed_visibility: ["public"] | [] },
//     do:   { allowed_actions: [] | ["action-name", ...] | "*" },
//     talk: { allowed_targets: [] | ["@embodiment", ...] | "*" },
//     be:   { allowed_operations: ["register", "claim", "release", "switch"] }
//   }

import Node from "../seed/models/node.js";
import { getLandRootId } from "../seed/landRoot.js";
import { resolveTreeAccess } from "../seed/tree/treeAccess.js";
import { PORTAL_ERR } from "./errors.js";

// Default permissions. These are applied if the land has not configured
// stance permissions in metadata. They are also seeded into metadata on
// land boot so the configuration is explicit.

export const DEFAULT_ARRIVAL_PERMISSIONS = Object.freeze({
  see:  Object.freeze({ allowed_visibility: ["public"] }),
  do:   Object.freeze({ allowed_actions: [] }),
  talk: Object.freeze({ allowed_targets: [] }),
  be:   Object.freeze({ allowed_operations: ["register", "claim"] }),
});

export const DEFAULT_OWNER_PERMISSIONS = Object.freeze({
  see:  Object.freeze({ allowed_visibility: "*" }),
  do:   Object.freeze({ allowed_actions: "*" }),
  talk: Object.freeze({ allowed_targets: "*" }),
  be:   Object.freeze({ allowed_operations: ["register", "claim", "release", "switch"] }),
});

/**
 * Authorize a verb request.
 *
 * @param {object} args
 * @param {object|null} args.identity { userId, username } if authenticated
 * @param {"see"|"do"|"talk"|"be"} args.verb
 * @param {object} args.target     { kind, value, nodeId?, visibility? }
 * @param {string} [args.action]   DO action name
 * @param {string} [args.namespace] set-meta namespace
 * @param {string} [args.intent]   TALK intent
 * @param {string} [args.operation] BE operation
 * @returns {Promise<{ ok: boolean, stance: string, reason?: string }>}
 */
export async function authorize(args) {
  const { identity, verb } = args;

  // Resolve which stance the requester occupies at this scope.
  const stance = await resolveStance(args);

  // Load the stance's permission profile from land metadata, falling
  // back to defaults when not explicitly configured.
  const permissions = await loadStancePermissions(stance);

  // Dispatch by verb. Each branch returns the allow/deny decision.
  switch (verb) {
    case "see":  return decideSee(stance, permissions, args);
    case "do":   return decideDo(stance, permissions, args);
    case "talk": return decideTalk(stance, permissions, args);
    case "be":   return decideBe(stance, permissions, args);
    default:
      return { ok: false, stance, reason: `Unknown verb: ${verb}` };
  }
}

// ────────────────────────────────────────────────────────────────
// Stance resolution
// ────────────────────────────────────────────────────────────────

async function resolveStance({ identity, target }) {
  if (!identity?.userId) return "arrival";

  // Owner = authenticated with write access at the addressed node.
  if (target?.nodeId) {
    try {
      const access = await resolveTreeAccess(target.nodeId, identity.userId);
      if (access?.ok && access.write === true) return "owner";
    } catch {
      // Fall through. We don't fail closed on a transient lookup error.
    }
  }

  // Authenticated but not the owner of this scope. Phase 5 names this
  // "member" but doesn't load a per-stance permission profile — the
  // existing access checks (visibility, contributor) handle it. Phase 7
  // adds member as a configurable stance.
  return "member";
}

// ────────────────────────────────────────────────────────────────
// Permission loading
// ────────────────────────────────────────────────────────────────

async function loadStancePermissions(stance) {
  if (stance === "arrival") {
    const fromMeta = await readLandStanceMeta("arrival");
    return fromMeta || DEFAULT_ARRIVAL_PERMISSIONS;
  }
  if (stance === "owner") {
    const fromMeta = await readLandStanceMeta("owner");
    return fromMeta || DEFAULT_OWNER_PERMISSIONS;
  }
  // member: no explicit profile yet (Phase 7 work). Return null;
  // per-verb deciders fall through to existing access logic.
  return null;
}

async function readLandStanceMeta(stanceName) {
  const landRootId = getLandRootId();
  if (!landRootId) return null;
  const root = await Node.findById(landRootId)
    .select(`metadata.embodiments.${stanceName}.permissions`)
    .lean();
  const path = root?.metadata?.embodiments;
  if (!path) return null;
  // metadata is a Map under the hood; lean() coerces but nested Maps
  // may surface as plain objects depending on driver version.
  const stance = path instanceof Map ? path.get(stanceName) : path[stanceName];
  if (!stance) return null;
  return stance.permissions || null;
}

// ────────────────────────────────────────────────────────────────
// Per-verb decisions
// ────────────────────────────────────────────────────────────────

function decideSee(stance, permissions, { target }) {
  if (stance === "member") {
    // Fall through to existing visibility/access checks done by the
    // SEE handler. Permit at the authorize layer; the handler enforces.
    return { ok: true, stance };
  }
  if (!permissions) return { ok: false, stance, reason: "no permissions" };
  const rule = permissions.see?.allowed_visibility;
  if (rule === "*") return { ok: true, stance };
  if (!Array.isArray(rule) || rule.length === 0) {
    return { ok: false, stance, reason: "stance not permitted to SEE" };
  }
  // Discovery and bootstrap-style positions are implicitly visible.
  if (target?.isDiscovery) return { ok: true, stance };
  // The handler resolves the target node and tells us its visibility.
  // If we don't know yet, optimistically permit; the handler enforces
  // visibility downstream. This is a no-regression policy: a known
  // non-public node is denied at this layer; an unknown one is allowed
  // and the handler is the second gate.
  const v = target?.visibility;
  if (!v) return { ok: true, stance };
  return rule.includes(v)
    ? { ok: true, stance }
    : { ok: false, stance, reason: `visibility "${v}" not in allowed list` };
}

function decideDo(stance, permissions, { action }) {
  if (stance === "owner") return { ok: true, stance };
  if (stance === "member") return { ok: true, stance };
  if (!permissions) return { ok: false, stance, reason: "no permissions" };
  const rule = permissions.do?.allowed_actions;
  if (rule === "*") return { ok: true, stance };
  if (!Array.isArray(rule) || rule.length === 0) {
    return { ok: false, stance, reason: "stance not permitted to DO" };
  }
  if (!action) return { ok: false, stance, reason: "DO requires an action" };
  return rule.includes(action)
    ? { ok: true, stance }
    : { ok: false, stance, reason: `action "${action}" not in allowed list` };
}

function decideTalk(stance, permissions, { target }) {
  if (stance === "owner") return { ok: true, stance };
  if (stance === "member") return { ok: true, stance };
  if (!permissions) return { ok: false, stance, reason: "no permissions" };
  const rule = permissions.talk?.allowed_targets;
  if (rule === "*") return { ok: true, stance };
  if (!Array.isArray(rule) || rule.length === 0) {
    return { ok: false, stance, reason: "stance not permitted to TALK" };
  }
  const targetEmbodiment = target?.embodiment;
  if (!targetEmbodiment) return { ok: false, stance, reason: "TALK requires a target embodiment" };
  const targetTag = `@${targetEmbodiment}`;
  return rule.includes(targetTag) || rule.includes(targetEmbodiment)
    ? { ok: true, stance }
    : { ok: false, stance, reason: `embodiment "${targetTag}" not in allowed list` };
}

function decideBe(stance, permissions, { operation }) {
  // BE bootstrap exception: register/claim are always permitted from
  // arrival regardless of permission config, subject to the land-level
  // register_enabled/claim_enabled flags (enforced by the auth-being).
  if (stance === "arrival" && (operation === "register" || operation === "claim")) {
    return { ok: true, stance };
  }
  if (stance === "owner") return { ok: true, stance };
  if (stance === "member") return { ok: true, stance };
  if (!permissions) return { ok: false, stance, reason: "no permissions" };
  const rule = permissions.be?.allowed_operations;
  if (!Array.isArray(rule) || rule.length === 0) {
    return { ok: false, stance, reason: "stance not permitted to BE" };
  }
  if (!operation) return { ok: false, stance, reason: "BE requires an operation" };
  return rule.includes(operation)
    ? { ok: true, stance }
    : { ok: false, stance, reason: `operation "${operation}" not in allowed list` };
}

// ────────────────────────────────────────────────────────────────
// Seed defaults on land boot
// ────────────────────────────────────────────────────────────────

/**
 * Ensure the land root has explicit default stance permissions written
 * to its metadata. Called once on land boot. Does nothing if defaults
 * are already present (does not overwrite operator configuration).
 */
export async function seedDefaultStancePermissions() {
  const landRootId = getLandRootId();
  if (!landRootId) return { seeded: false, reason: "land root not initialized" };

  const root = await Node.findById(landRootId).select("metadata").lean();
  const existing = root?.metadata?.embodiments;

  const updates = {};
  const hasArrival = existing instanceof Map
    ? !!existing.get("arrival")
    : !!existing?.arrival;
  const hasOwner = existing instanceof Map
    ? !!existing.get("owner")
    : !!existing?.owner;

  if (!hasArrival) {
    updates["metadata.embodiments.arrival"] = { permissions: DEFAULT_ARRIVAL_PERMISSIONS };
  }
  if (!hasOwner) {
    updates["metadata.embodiments.owner"] = { permissions: DEFAULT_OWNER_PERMISSIONS };
  }

  // Also seed the land-level BE flags if absent.
  const auth = root?.metadata?.auth;
  const hasAuth = auth instanceof Map ? auth.size > 0 : !!auth;
  if (!hasAuth) {
    updates["metadata.auth"] = { register_enabled: true, claim_enabled: true };
  }

  if (Object.keys(updates).length === 0) {
    return { seeded: false, reason: "defaults already present" };
  }
  await Node.updateOne({ _id: landRootId }, { $set: updates });
  return { seeded: true, fields: Object.keys(updates) };
}

/**
 * Read the land-level BE configuration flags. Defaults to register_enabled
 * and claim_enabled both true.
 */
export async function getAuthConfig() {
  const landRootId = getLandRootId();
  if (!landRootId) return { register_enabled: true, claim_enabled: true };
  const root = await Node.findById(landRootId).select("metadata.auth").lean();
  const auth = root?.metadata?.auth;
  const get = (key, fallback) => {
    if (auth instanceof Map) return auth.has(key) ? auth.get(key) : fallback;
    return auth && key in auth ? auth[key] : fallback;
  };
  return {
    register_enabled: get("register_enabled", true) !== false,
    claim_enabled:    get("claim_enabled",    true) !== false,
  };
}

// Re-export for use in verb handlers.
export { PORTAL_ERR };
