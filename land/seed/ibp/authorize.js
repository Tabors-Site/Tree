// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// Stance Authorization (Layer 4).
//
// One function gates every IBP verb call. The flow:
//
//   1. Derive the acting stance's properties (Layer 2 — stanceProperties.js).
//      Owner / contributor relations, role, home position relations,
//      operating mode, federation status — all computed from Layer 1
//      data (Being + Space fields).
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

import Space from "../models/space.js";
import { getLandRootId } from "../landRoot.js";
import { getAncestorChain } from "../space/ancestorCache.js";
import { deriveStanceProperties } from "../ibp/stanceProperties.js";
import { lookupDefault } from "./defaultPermissions.js";
import { IBP_ERR } from "./errors.js";

// ─────────────────────────────────────────────────────────────────────
// Default layer-2 stance permissions written on the land root.
//
// Seeded at boot by seedDefaultStancePermissions(); operators can
// override per-position with their own rules (closer rule wins on the
// ancestor walk). These map the legacy "arrival is restricted, anyone
// else can act" semantics into the unified rule shape:
//
//   metadata.permissions.<verb>.<keyParts> = { requires: { ... } }
//
// `requires: { arrival: false }` admits every authenticated stance and
// denies arrival. `requires: {}` admits everyone (arrival included).
// ─────────────────────────────────────────────────────────────────────

const LAND_ROOT_DEFAULT_PERMISSIONS = Object.freeze({
  // Default SEE / DO / SUMMON: any authenticated being.
  see:    { "*": { requires: { arrival: false } } },
  do:     { "*": { requires: { arrival: false } } },
  summon: { "*": { requires: { arrival: false } } },
  // BE: arrival can register/claim (so anyone can sign up); only
  // authenticated callers can release/switch their own session.
  be: {
    register: { requires: {} },
    claim:    { requires: {} },
    release:  { requires: { arrival: false } },
    switch:   { requires: { arrival: false } },
  },
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
 * @param {object} args.target     { kind, value, spaceId?, being?, isDiscovery? }
 * @param {string} [args.action]   DO action name
 * @param {string} [args.namespace] set-meta namespace
 * @param {string} [args.intent]   SUMMON intent
 * @param {string} [args.operation] BE operation
 * @returns {Promise<{ ok: boolean, stance: string, reason?: string }>}
 */
export async function authorize(args) {
  const { identity, verb, target } = args;
  const beingId = identity?.beingId || null;
  const spaceId  = target?.spaceId || null;

  // ── Layer 2: derive stance properties ──
  const props = await deriveStanceProperties({ beingId, targetSpace: spaceId });
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
  const matched = await findMatchingRule({ spaceId, verb, keyParts });
  if (matched) {
    return evaluateRequires(matched.rule, props, stanceLabel, matched.source);
  }

  // ── Layer 4: extension-default registry ──
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

  // ── Layer 5: default deny ──
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

async function findMatchingRule({ spaceId, verb, keyParts }) {
  if (!spaceId) {
    const landRootId = getLandRootId();
    if (!landRootId) return null;
    return matchOnSpace(landRootId, verb, keyParts);
  }

  let chain;
  try {
    chain = await getAncestorChain(spaceId);
  } catch {
    chain = null;
  }
  const path = Array.isArray(chain) && chain.length
    ? chain.map((n) => String(n._id))
    : [String(spaceId)];

  for (const id of path) {
    const match = await matchOnSpace(id, verb, keyParts);
    if (match) return match;
  }
  return null;
}

async function matchOnSpace(spaceId, verb, keyParts) {
  const space = await Space.findById(spaceId).select("metadata").lean();
  const meta = space?.metadata;
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
  return { rule: bestRule, source: `${spaceId}:${bestKey}` };
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

  // Home-relation properties accept a string spaceId as the expected
  // value, in which case the comparator interprets it as "this
  // specific space must be in the home's ancestor chain" (or, for
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
// Seed defaults on land boot
// ─────────────────────────────────────────────────────────────────────

/**
 * Plant the kernel's default stance-permission rules on the land root.
 * Idempotent. Writes the unified layer-2 rule shape that the authorize
 * walk reads at every verb call:
 *
 *   metadata.permissions.<verb>.<keyParts> = { requires: { ... } }
 *
 * The defaults preserve the historical semantics: any authenticated
 * being can act at the land root (any verb, any keyParts); arrival
 * can only BE register/claim. Per-position rules at sub-positions
 * override these via the ancestor walk picking the nearest match.
 */
export async function seedDefaultStancePermissions() {
  const landRootId = getLandRootId();
  if (!landRootId) return { seeded: false, reason: "land root not initialized" };

  const root = await Space.findById(landRootId).select("metadata").lean();
  const meta = root?.metadata;
  const permsRoot = meta instanceof Map ? meta.get("permissions") : meta?.permissions;

  const updates = {};

  // Seed each verb's bucket only if it isn't already populated. We do
  // not overwrite operator customizations.
  for (const [verb, bucket] of Object.entries(LAND_ROOT_DEFAULT_PERMISSIONS)) {
    const existingVerb = permsRoot?.[verb];
    if (existingVerb && Object.keys(existingVerb).length > 0) continue;
    updates[`metadata.permissions.${verb}`] = bucket;
  }

  // Land-level BE config flags (register/claim toggles for operators
  // who want to lock the land down).
  const auth = meta instanceof Map ? meta.get("auth") : meta?.auth;
  const hasAuth = auth instanceof Map ? auth.size > 0 : !!auth;
  if (!hasAuth) {
    updates["metadata.auth"] = { register_enabled: true, claim_enabled: true };
  }

  if (Object.keys(updates).length === 0) {
    return { seeded: false, reason: "defaults already present" };
  }
  await Space.updateOne({ _id: landRootId }, { $set: updates });
  return { seeded: true, fields: Object.keys(updates) };
}

/**
 * Read the land-level BE configuration flags. Defaults to
 * register_enabled and claim_enabled both true.
 */
export async function getAuthConfig() {
  const landRootId = getLandRootId();
  if (!landRootId) return { register_enabled: true, claim_enabled: true };
  const root = await Space.findById(landRootId).select("metadata.auth").lean();
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
