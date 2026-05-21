// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// The gate. Every SEE, DO, SUMMON, and BE passes through me here.
//
// IBP is my communication primitive. This file is what every
// verb call crosses on its way from being to substrate. One
// function gates every SEE, DO, SUMMON, and BE. Until a verb passes
// this gate, nothing else in me hears it.
//
// I am the only exception. I act with universal authority on my own
// place — my kernel-emitted SUMMONs, my scheduled wakes, my genesis
// scaffolding — and short past the layered check. Every other
// being's verb call I evaluate.
//
// How I evaluate:
//
//   1. I derive the acting stance's properties (Layer 2 —
//      stanceProperties.js). Owner / contributor relations, role,
//      home relations, operating mode, federation status — all
//      computed from Layer 1 data (Being + Space fields).
//
//   2. I look up the applicable permission rule for this verb at
//      the target position (Layer 3 — qualities.permissions on the
//      position, walking up the parent chain to the place root).
//      When no rule matches, I fall through to the extension
//      defaults registry below, then default deny.
//
//   3. I compare each `requires` entry in the rule against the
//      stance's derived properties. All must be satisfied. I return
//      allow or deny with a reason.
//
// Lookup key shape per verb:
//   see:     "*"                                          (universal for now)
//   do:      "<action>:<param>" or "<action>"             (e.g. "set-meta:position")
//   summon:  "@<qualifier>:<intent>" or "@<qualifier>"    (qualifier supports prefix wildcard)
//   be:      "<operation>"                                (register|claim|release|switch)
//
// Specificity precedence: exact > prefix-wildcard > "*" per key
// part. Position precedence: closer position beats farther via
// parent walk.
//
// The bottom half of this file holds the default-permission
// registry that Layer 3 falls through to. Extensions contribute
// defaults through their manifest's `provides.defaultPermissions`;
// the loader calls registerDefaultPermissions(extName, perms) at
// boot.

import Space from "../models/space.js";
import { getPlaceRootId } from "../placeRoot.js";
import { getAncestorChain } from "../place/space/ancestorCache.js";
import { deriveStanceProperties } from "../ibp/stanceProperties.js";
import log from "../system/log.js";
import { IBP_ERR } from "./protocol.js";
import { I_AM } from "../place/being/seedBeings.js";

// ─────────────────────────────────────────────────────────────────────
// Default layer-2 stance permissions written on the place root.
//
// Seeded at boot by seedDefaultStancePermissions(); operators can
// override per-position with their own rules (closer rule wins on the
// ancestor walk). These map the legacy "arrival is restricted, anyone
// else can act" semantics into the unified rule shape:
//
//   qualities.permissions.<verb>.<keyParts> = { requires: { ... } }
//
// `requires: { arrival: false }` admits every authenticated stance and
// denies arrival. `requires: {}` admits everyone (arrival included).
// ─────────────────────────────────────────────────────────────────────

const PLACE_ROOT_DEFAULT_PERMISSIONS = Object.freeze({
  // Default SEE / DO / SUMMON: any authenticated being.
  see: { "*": { requires: { arrival: false } } },
  do: { "*": { requires: { arrival: false } } },
  summon: { "*": { requires: { arrival: false } } },
  // BE: arrival can register/claim (so anyone can sign up); only
  // authenticated callers can release/switch their own session.
  // create-being: cherub summons beings forth on external
  // callers' behalf; extensions add their own create-being rules
  // (e.g., "my ruler role may create sub-rulers in its tree")
  // through provides.defaultPermissions in their manifest.
  be: {
    register:       { requires: {} },
    claim:          { requires: {} },
    release:        { requires: { arrival: false } },
    switch:         { requires: { arrival: false } },
    "create-being": { requires: { role: "cherub" } },
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
  const spaceId = target?.spaceId || null;

  // The I_AM has universal authority. The seed is the source of all
  // permission on its place. Authority flows outward from the I_AM;
  // nothing extensions or operators do can gate it. Every kernel-
  // emitted act (DO-trigger fan-out, scheduled wakes, genesis
  // scaffolding) runs as the I_AM and shorts past the layered check.
  if (identity?.name === I_AM) {
    return { ok: true, stance: "I_AM" };
  }

  // ── Layer 2: derive stance properties ──
  const props = await deriveStanceProperties({ beingId, targetSpace: spaceId });
  const stanceLabel = stanceLabelFromProps(props);

  // BE bootstrap exception: register/claim from arrival are always
  // permitted, gated by place-level register_enabled/claim_enabled
  // flags (enforced by the cherub itself). Without this no one
  // could ever sign up on a fresh place.
  if (
    verb === "be" &&
    props.arrival &&
    (args.operation === "register" || args.operation === "claim")
  ) {
    return { ok: true, stance: "arrival" };
  }

  // SEE discovery exception: <place>/.discovery is the place's
  // capability surface — always visible.
  if (verb === "see" && target?.isDiscovery) {
    return { ok: true, stance: stanceLabel };
  }

  // ── Build the lookup key parts for this request ──
  const keyParts = buildKeyParts(args);
  if (!keyParts) {
    return {
      ok: false,
      stance: stanceLabel,
      reason: `Unknown or unsupported verb shape: ${verb}`,
    };
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
    return evaluateRequires(
      defaultRule,
      props,
      stanceLabel,
      "extension-default",
    );
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
      if (
        (args.action === "set-meta" || args.action === "clear-meta") &&
        args.namespace
      ) {
        return [args.action, args.namespace];
      }
      return [args.action];
    }
    case "summon": {
      // Thread target: SUMMON `.threads/<id>` is a cut. The keyParts
      // route to `summon:.threads:*` so operators can pin a stricter
      // rule at the place root if they want; the cut handler in
      // place/space/threads.js does its own participation check
      // (you must be in the rootCorrelation chain to sever it).
      if (args.target?.kind === "thread") {
        return [".threads", String(args.target.id || "*")];
      }
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
    const placeRootId = getPlaceRootId();
    if (!placeRootId) return null;
    return matchOnSpace(placeRootId, verb, keyParts);
  }

  let chain;
  try {
    chain = await getAncestorChain(spaceId);
  } catch {
    chain = null;
  }
  const path =
    Array.isArray(chain) && chain.length
      ? chain.map((n) => String(n._id))
      : [String(spaceId)];

  for (const id of path) {
    const match = await matchOnSpace(id, verb, keyParts);
    if (match) return match;
  }
  return null;
}

async function matchOnSpace(spaceId, verb, keyParts) {
  const space = await Space.findById(spaceId).select("qualities").lean();
  const quals = space?.qualities;
  if (!quals) return null;
  const perms =
    quals instanceof Map ? quals.get("permissions") : quals.permissions;
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
  if (
    typeof expected === "string" &&
    (propName === "homeInDomain" || propName === "positionInHomeDomain")
  ) {
    return (
      Array.isArray(props.homeAncestors) &&
      props.homeAncestors.includes(expected)
    );
  }

  if (expected === true) return actual === true;
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
  if (props.owner) return "owner";
  if (props.contributor) return "contributor";
  if (props.role) return props.role;
  return "member";
}

// ─────────────────────────────────────────────────────────────────────
// Seed defaults on place boot
// ─────────────────────────────────────────────────────────────────────

/**
 * Plant the kernel's default stance-permission rules on the place root.
 * Idempotent. Writes the unified layer-2 rule shape that the authorize
 * walk reads at every verb call:
 *
 *   qualities.permissions.<verb>.<keyParts> = { requires: { ... } }
 *
 * The defaults preserve the historical semantics: any authenticated
 * being can act at the place root (any verb, any keyParts); arrival
 * can only BE register/claim. Per-position rules at sub-positions
 * override these via the ancestor walk picking the nearest match.
 */
export async function seedDefaultStancePermissions() {
  const placeRootId = getPlaceRootId();
  if (!placeRootId)
    return { seeded: false, reason: "place root not initialized" };

  const root = await Space.findById(placeRootId).select("qualities").lean();
  const quals = root?.qualities;
  const permsRoot =
    quals instanceof Map ? quals.get("permissions") : quals?.permissions;

  const updates = {};

  // Seed each verb's bucket only if it isn't already populated. We do
  // not overwrite operator customizations.
  for (const [verb, bucket] of Object.entries(PLACE_ROOT_DEFAULT_PERMISSIONS)) {
    const existingVerb = permsRoot?.[verb];
    if (existingVerb && Object.keys(existingVerb).length > 0) continue;
    updates[`qualities.permissions.${verb}`] = bucket;
  }

  // Place-level BE config flags (register/claim toggles for operators
  // who want to lock the place down).
  const auth = quals instanceof Map ? quals.get("auth") : quals?.auth;
  const hasAuth = auth instanceof Map ? auth.size > 0 : !!auth;
  if (!hasAuth) {
    updates["qualities.auth"] = { register_enabled: true, claim_enabled: true };
  }

  if (Object.keys(updates).length === 0) {
    return { seeded: false, reason: "defaults already present" };
  }
  await Space.updateOne({ _id: placeRootId }, { $set: updates });
  return { seeded: true, fields: Object.keys(updates) };
}

/**
 * Read the place-level BE configuration flags. Defaults to
 * register_enabled and claim_enabled both true.
 */
export async function getAuthConfig() {
  const placeRootId = getPlaceRootId();
  if (!placeRootId) return { register_enabled: true, claim_enabled: true };
  const root = await Space.findById(placeRootId).select("qualities.auth").lean();
  const auth = root?.qualities?.auth;
  const get = (key, fallback) => {
    if (auth instanceof Map) return auth.has(key) ? auth.get(key) : fallback;
    return auth && key in auth ? auth[key] : fallback;
  };
  return {
    register_enabled: get("register_enabled", true) !== false,
    claim_enabled: get("claim_enabled", true) !== false,
  };
}

// Re-export for use in verb handlers.
export { IBP_ERR };

// ─────────────────────────────────────────────────────────────────────
// Default permission registry (Layer 3)
//
// When no explicit qualities.permissions rule matches at the target
// position or any ancestor, the authorize walk above falls through
// here for an installed-extension-provided default.
//
// Populated by extensions through their manifest:
//
//   // extensions/<name>/manifest.js
//   export default {
//     name: "position",
//     provides: {
//       defaultPermissions: {
//         "do:set-meta:position": { requires: { contributor: true } },
//       },
//     },
//   };
//
// Lifecycle:
//   - Built at boot when the extension loader sees `provides.defaultPermissions`.
//   - Rebuilt when an extension is installed / uninstalled at runtime.
//   - Missing entries return null. Never throws — uninstalled extensions
//     simply contribute nothing, and authorize falls through to default
//     deny.
//
// Data shape: `Map<key, rule>`. Keys are the same shape as
// qualities.permissions entries ("do:set-meta:position",
// "summon:@planner*", etc.). Rules carry `requires` (stance property
// requirements). The registry also stores `_extName` so an uninstall
// can remove only that extension's contributions.
// ─────────────────────────────────────────────────────────────────────

const _defaultPermissions = new Map();

/**
 * Register one extension's default permission rules. Idempotent —
 * re-registering replaces any prior rules from the same extension.
 *
 * @param {string} extName
 * @param {object} perms  map of `<key>` → { requires: {...} }
 */
export function registerDefaultPermissions(extName, perms) {
  if (!extName || !perms || typeof perms !== "object") return;
  // Remove prior rules from this extension first (idempotent reload).
  unregisterDefaultPermissions(extName);
  let count = 0;
  for (const [key, rule] of Object.entries(perms)) {
    if (!key || typeof key !== "string") continue;
    if (!rule || typeof rule !== "object") continue;
    const safe = {
      requires:
        rule.requires && typeof rule.requires === "object"
          ? { ...rule.requires }
          : {},
      _extName: extName,
    };
    _defaultPermissions.set(key, safe);
    count++;
  }
  if (count > 0) {
    log.verbose(
      "Authorize",
      `registered ${count} default permission rule(s) for "${extName}"`,
    );
  }
}

/**
 * Remove all default permission rules contributed by an extension.
 * Called when the extension is uninstalled at runtime.
 */
export function unregisterDefaultPermissions(extName) {
  if (!extName) return;
  for (const [key, rule] of Array.from(_defaultPermissions.entries())) {
    if (rule._extName === extName) _defaultPermissions.delete(key);
  }
}

/**
 * Look up a default permission rule by exact key. Returns null when
 * no extension currently contributes a default for this key.
 */
function lookupDefault(key) {
  if (!key) return null;
  return _defaultPermissions.get(key) || null;
}

/**
 * Enumerate the registered keys (diagnostic — used by introspection
 * tools that show "what default permissions are active on this place").
 */
export function listDefaultPermissions() {
  const out = {};
  for (const [key, rule] of _defaultPermissions) {
    out[key] = { requires: rule.requires, fromExtension: rule._extName };
  }
  return out;
}
