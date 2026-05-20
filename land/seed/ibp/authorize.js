// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// Stance Authorization (Layer 4).
//
// One function gates every IBP verb call. The flow:
//
//   1. Derive the acting stance's properties (Layer 2 — stanceProperties.js).
//      Owner / contributor relations, role, home position relations,
//      operating mode, federation status — all computed from Layer 1
//      data (Being + Node fields).
//
//   2. Look up the applicable permission rule for this verb at the target
//      position (Layer 3 — metadata.permissions on the position, walking
//      up the parent chain to the land root). When no rule matches, fall
//      through to the extension defaults registry, then default deny.
//
//   3. Compare each `requires` entry in the rule against the stance's
//      derived properties. All must be satisfied. Returns allow or
//      deny with a reason.
//
// Lookup key shape per verb:
//   see:     "*"                                          (universal for now)
//   do:      "<action>:<param>" or "<action>"             (e.g. "set-meta:position")
//   summon:  "@<qualifier>:<intent>" or "@<qualifier>"    (qualifier supports prefix wildcard)
//   be:      "<operation>"                                (register|claim|release|switch)
//
// Specificity precedence: exact > prefix-wildcard > "*"  per key part.
// Position precedence: closer position beats farther via parent walk.
//
// Backward compat: during the rules-migration window, when no new-shape
// rule matches, the function falls back to the older
// metadata.beings.<stance>.permissions shape (arrival / owner /
// member). That fallback gets removed once governing's lifecycle has
// stamped the new-shape rules everywhere.

import Node from "../models/node.js";
import { getLandRootId } from "../landRoot.js";
import { getAncestorChain } from "../tree/ancestorCache.js";
import { deriveStanceProperties } from "../addressing/stanceProperties.js";
import { lookupDefault } from "./defaultPermissions.js";
import { IBP_ERR } from "./errors.js";

// ─────────────────────────────────────────────────────────────────────
// Legacy defaults (kept for startup's seedDefaultStancePermissions).
// The new authorize flow does NOT read these directly; it reads the
// metadata.permissions shape. These constants stay exported so the
// transition migration can populate the old-shape rows as fallback
// while new lifecycle code writes the new shape.
// ─────────────────────────────────────────────────────────────────────

export const DEFAULT_ARRIVAL_PERMISSIONS = Object.freeze({
  see:    Object.freeze({ allowed_visibility: ["public"] }),
  do:     Object.freeze({ allowed_actions: [] }),
  summon: Object.freeze({ allowed_targets: [] }),
  be:     Object.freeze({ allowed_operations: ["register", "claim"] }),
});

export const DEFAULT_OWNER_PERMISSIONS = Object.freeze({
  see:    Object.freeze({ allowed_visibility: "*" }),
  do:     Object.freeze({ allowed_actions: "*" }),
  summon: Object.freeze({ allowed_targets: "*" }),
  be:     Object.freeze({ allowed_operations: ["register", "claim", "release", "switch"] }),
});

// ─────────────────────────────────────────────────────────────────────
// Entry point
// ─────────────────────────────────────────────────────────────────────

/**
 * Authorize a verb request.
 *
 * @param {object} args
 * @param {object|null} args.identity { beingId, username } if authenticated
 * @param {"see"|"do"|"summon"|"be"} args.verb
 * @param {object} args.target     { kind, value, nodeId?, visibility?, being?, isDiscovery? }
 * @param {string} [args.action]   DO action name
 * @param {string} [args.namespace] set-meta namespace
 * @param {string} [args.intent]   SUMMON intent
 * @param {string} [args.operation] BE operation
 * @returns {Promise<{ ok: boolean, stance: string, reason?: string }>}
 */
export async function authorize(args) {
  const { identity, verb, target } = args;
  const beingId = identity?.beingId || null;
  const nodeId  = target?.nodeId || null;

  // ── Layer 2: derive stance properties ──
  const props = await deriveStanceProperties({ beingId, targetNodeId: nodeId });
  const stanceLabel = stanceLabelFromProps(props);

  // BE bootstrap exception: register/claim from arrival are always
  // permitted, gated by land-level register_enabled/claim_enabled
  // flags (enforced by the auth-being itself). Without this no one
  // could ever sign up on a fresh land.
  if (verb === "be" && props.arrival
      && (args.operation === "register" || args.operation === "claim")) {
    return { ok: true, stance: "arrival" };
  }

  // SEE discovery exception: <land>/.discovery is the land's
  // capability surface — always visible.
  if (verb === "see" && target?.isDiscovery) {
    return { ok: true, stance: stanceLabel };
  }

  // ── Build the lookup key parts for this request ──
  const keyParts = buildKeyParts(args);
  if (!keyParts) {
    return { ok: false, stance: stanceLabel, reason: `Unknown or unsupported verb shape: ${verb}` };
  }

  // ── Layer 3: walk the parent chain looking for a matching rule ──
  const matched = await findMatchingRule({ nodeId, verb, keyParts });
  if (matched) {
    return evaluateRequires(matched.rule, props, stanceLabel, matched.source);
  }

  // ── Tier 5: extension-default registry ──
  const fullKey = `${verb}:${keyParts.join(":")}`;
  let defaultRule = lookupDefault(fullKey);
  if (!defaultRule) {
    for (let i = keyParts.length - 1; i > 0; i--) {
      const shorter = `${verb}:${keyParts.slice(0, i).join(":")}`;
      defaultRule = lookupDefault(shorter);
      if (defaultRule) break;
    }
  }
  if (defaultRule) {
    return evaluateRequires(defaultRule, props, stanceLabel, "extension-default");
  }

  // ── Legacy fallback (transitional) ──
  const legacy = await legacyAuthorize(args, props);
  if (legacy) return legacy;

  // ── Tier 6: default deny ──
  return {
    ok: false,
    stance: stanceLabel,
    reason: `No permission rule matched ${verb}:${keyParts.join(":")} and no default applies`,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Key construction per verb
// ─────────────────────────────────────────────────────────────────────

function buildKeyParts(args) {
  switch (args.verb) {
    case "see":
      return ["*"];
    case "do": {
      if (!args.action) return null;
      if ((args.action === "set-meta" || args.action === "clear-meta") && args.namespace) {
        return [args.action, args.namespace];
      }
      return [args.action];
    }
    case "summon": {
      const qualifier = args.target?.being || args.target?.name;
      if (!qualifier) return null;
      const qPart = qualifier.startsWith("@") ? qualifier : `@${qualifier}`;
      return args.intent ? [qPart, args.intent] : [qPart];
    }
    case "be":
      return args.operation ? [args.operation] : null;
    default:
      return null;
  }
}

// ─────────────────────────────────────────────────────────────────────
// Layer 3: rule lookup
// ─────────────────────────────────────────────────────────────────────

async function findMatchingRule({ nodeId, verb, keyParts }) {
  if (!nodeId) {
    const landRootId = getLandRootId();
    if (!landRootId) return null;
    return matchOnNode(landRootId, verb, keyParts);
  }

  let chain;
  try {
    chain = await getAncestorChain(nodeId);
  } catch {
    chain = null;
  }
  const path = Array.isArray(chain) && chain.length
    ? chain.map((n) => String(n._id))
    : [String(nodeId)];

  for (const id of path) {
    const match = await matchOnNode(id, verb, keyParts);
    if (match) return match;
  }
  return null;
}

async function matchOnNode(nodeId, verb, keyParts) {
  const node = await Node.findById(nodeId).select("metadata").lean();
  const meta = node?.metadata;
  if (!meta) return null;
  const perms = meta instanceof Map ? meta.get("permissions") : meta.permissions;
  if (!perms) return null;
  const bucket = perms[verb];
  if (!bucket || typeof bucket !== "object") return null;

  let bestRule = null;
  let bestKey = null;
  let bestScore = -1;
  for (const [key, rule] of Object.entries(bucket)) {
    if (!rule || typeof rule !== "object") continue;
    const score = scoreKey(key, keyParts);
    if (score < 0) continue;
    if (score > bestScore) {
      bestRule = rule;
      bestKey = key;
      bestScore = score;
    }
  }
  if (!bestRule) return null;
  return { rule: bestRule, source: `${nodeId}:${bestKey}` };
}

// ─────────────────────────────────────────────────────────────────────
// Key matching with specificity scoring
// ─────────────────────────────────────────────────────────────────────

function scoreKey(ruleKey, targetParts) {
  if (!ruleKey || typeof ruleKey !== "string") return -1;
  const ruleParts = ruleKey.split(":");
  if (ruleParts.length > targetParts.length) return -1;

  let score = 0;
  for (let i = 0; i < ruleParts.length; i++) {
    const r = ruleParts[i];
    const t = targetParts[i];
    if (r === "*") {
      score += 1;
    } else if (r.endsWith("*")) {
      const prefix = r.slice(0, -1);
      if (!t.startsWith(prefix)) return -1;
      score += 2;
    } else if (r === t) {
      score += 3;
    } else {
      return -1;
    }
  }

  // Full-length keys (same number of parts as the target) beat shorter
  // "applies to any param" keys.
  if (ruleParts.length === targetParts.length) score += 10;

  return score;
}

// ─────────────────────────────────────────────────────────────────────
// Requires comparator
// ─────────────────────────────────────────────────────────────────────

function evaluateRequires(rule, props, stanceLabel, source) {
  const requires = rule?.requires;
  if (!requires || typeof requires !== "object") {
    return { ok: true, stance: stanceLabel, matched: source };
  }
  for (const [prop, expected] of Object.entries(requires)) {
    if (!compareRequirement(prop, expected, props)) {
      return {
        ok: false,
        stance: stanceLabel,
        reason: `stance does not satisfy requires.${prop} (have ${JSON.stringify(props[prop])}, need ${JSON.stringify(expected)})`,
        matched: source,
      };
    }
  }
  return { ok: true, stance: stanceLabel, matched: source };
}

function compareRequirement(propName, expected, props) {
  const actual = props[propName];

  // Home-relation properties accept a string nodeId as the expected
  // value, in which case the comparator interprets it as "this
  // specific node must be in the home's ancestor chain" (or, for
  // positionInHomeDomain, in the target's ancestor chain). Without
  // this, scoped rules like `homeInDomain: "<rulership-id>"` would
  // do a useless string-equality check against a boolean.
  if (typeof expected === "string" && (propName === "homeInDomain" || propName === "positionInHomeDomain")) {
    return Array.isArray(props.homeAncestors) && props.homeAncestors.includes(expected);
  }

  if (expected === true)  return actual === true;
  if (expected === false) return actual === false;
  if (Array.isArray(expected)) return expected.includes(actual);
  return actual === expected;
}

// ─────────────────────────────────────────────────────────────────────
// Stance label (response field — back-compat with old consumers
// that displayed "arrival" / "owner" / "member" / etc.)
// ─────────────────────────────────────────────────────────────────────

function stanceLabelFromProps(props) {
  if (props.arrival) return "arrival";
  if (props.owner)   return "owner";
  if (props.contributor) return "contributor";
  if (props.role)    return props.role;
  return "member";
}

// ─────────────────────────────────────────────────────────────────────
// Legacy fallback (old-shape metadata.beings.<stance>.permissions)
// ─────────────────────────────────────────────────────────────────────

async function legacyAuthorize(args, props) {
  const stance = props.arrival ? "arrival" : (props.owner ? "owner" : "member");
  const permissions = await loadLegacyStancePermissions(stance);
  if (!permissions) return null;
  switch (args.verb) {
    case "see":    return legacyDecideSee(stance, permissions, args);
    case "do":     return legacyDecideDo(stance, permissions, args);
    case "summon": return legacyDecideSummon(stance, permissions, args);
    case "be":     return legacyDecideBe(stance, permissions, args);
    default:       return null;
  }
}

async function loadLegacyStancePermissions(stance) {
  if (stance === "arrival") return (await readLandStanceMeta("arrival")) || DEFAULT_ARRIVAL_PERMISSIONS;
  if (stance === "owner")   return (await readLandStanceMeta("owner"))   || DEFAULT_OWNER_PERMISSIONS;
  // "member" (and any other authenticated non-owner): the legacy decide
  // functions short-circuit to allow for this stance without consulting
  // permissions. Returning an empty object engages that short-circuit
  // path instead of falling through to default-deny. Without this an
  // authenticated being who is not the owner gets FORBIDDEN on every
  // SEE / DO / SUMMON / BE because no Tier-5 default-permission rule
  // covers their stance and the kernel has no implicit member-allow.
  if (stance === "member") return {};
  return null;
}

async function readLandStanceMeta(stanceName) {
  const landRootId = getLandRootId();
  if (!landRootId) return null;
  const root = await Node.findById(landRootId)
    .select(`metadata.beings.${stanceName}.permissions`)
    .lean();
  const path = root?.metadata?.beings;
  if (!path) return null;
  const stance = path instanceof Map ? path.get(stanceName) : path[stanceName];
  if (!stance) return null;
  return stance.permissions || null;
}

function legacyDecideSee(stance, permissions, { target }) {
  if (stance === "member") return { ok: true, stance };
  const rule = permissions.see?.allowed_visibility;
  if (rule === "*") return { ok: true, stance };
  if (!Array.isArray(rule) || rule.length === 0) {
    return { ok: false, stance, reason: "stance not permitted to SEE" };
  }
  if (target?.isDiscovery) return { ok: true, stance };
  const v = target?.visibility;
  if (!v) return { ok: true, stance };
  return rule.includes(v)
    ? { ok: true, stance }
    : { ok: false, stance, reason: `visibility "${v}" not in allowed list` };
}

function legacyDecideDo(stance, permissions, { action }) {
  if (stance === "owner") return { ok: true, stance };
  if (stance === "member") return { ok: true, stance };
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

function legacyDecideSummon(stance, permissions, { target }) {
  if (stance === "owner") return { ok: true, stance };
  if (stance === "member") return { ok: true, stance };
  const rule = permissions.summon?.allowed_targets;
  if (rule === "*") return { ok: true, stance };
  if (!Array.isArray(rule) || rule.length === 0) {
    return { ok: false, stance, reason: "stance not permitted to SUMMON" };
  }
  const targetBeing = target?.being;
  if (!targetBeing) return { ok: false, stance, reason: "SUMMON requires a target being" };
  const targetTag = `@${targetBeing}`;
  return rule.includes(targetTag) || rule.includes(targetBeing)
    ? { ok: true, stance }
    : { ok: false, stance, reason: `role "${targetTag}" not in allowed list` };
}

function legacyDecideBe(stance, permissions, { operation }) {
  if (stance === "arrival" && (operation === "register" || operation === "claim")) {
    return { ok: true, stance };
  }
  if (stance === "owner") return { ok: true, stance };
  if (stance === "member") return { ok: true, stance };
  const rule = permissions.be?.allowed_operations;
  if (!Array.isArray(rule) || rule.length === 0) {
    return { ok: false, stance, reason: "stance not permitted to BE" };
  }
  if (!operation) return { ok: false, stance, reason: "BE requires an operation" };
  return rule.includes(operation)
    ? { ok: true, stance }
    : { ok: false, stance, reason: `operation "${operation}" not in allowed list` };
}

// ─────────────────────────────────────────────────────────────────────
// Seed defaults on land boot
// ─────────────────────────────────────────────────────────────────────

/**
 * Ensure the land root has explicit default stance permissions written
 * to its metadata. Idempotent. Writes the legacy shape during the
 * transition so the legacy fallback in authorize() has data; a future
 * pass writes the new metadata.permissions shape at the land root with
 * equivalent rules.
 */
export async function seedDefaultStancePermissions() {
  const landRootId = getLandRootId();
  if (!landRootId) return { seeded: false, reason: "land root not initialized" };

  const root = await Node.findById(landRootId).select("metadata").lean();
  const existing = root?.metadata?.beings;

  const updates = {};
  const hasArrival = existing instanceof Map
    ? !!existing.get("arrival")
    : !!existing?.arrival;
  const hasOwner = existing instanceof Map
    ? !!existing.get("owner")
    : !!existing?.owner;

  if (!hasArrival) {
    updates["metadata.beings.arrival"] = { permissions: DEFAULT_ARRIVAL_PERMISSIONS };
  }
  if (!hasOwner) {
    updates["metadata.beings.owner"] = { permissions: DEFAULT_OWNER_PERMISSIONS };
  }

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
 * Read the land-level BE configuration flags. Defaults to
 * register_enabled and claim_enabled both true.
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
export { IBP_ERR };
