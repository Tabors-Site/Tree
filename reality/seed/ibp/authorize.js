// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// The gate. Every SEE, DO, SUMMON, BE passes through authorize().
//
// Evaluation order, first match wins:
//
//   Layer 0  cheap short-circuits, no Mongo:
//              I_AM bypass, SEE on .discovery, BE bootstrap for
//              arrival on birth/connect.
//   Layer 2  derive stance properties (stanceProperties.js).
//   Gate     extension scope: refuse `ext:op` if the extension is
//              blocked at the target's ancestor chain.
//   Layer 3  qualities.permissions rule lookup, walking the parent
//              chain. Closest rule wins; within a space, more
//              specific keyParts beat wildcards.
//   Layer 4  extension-default registry fall-through.
//   Layer 5  default deny.
//
// The `requires` comparator evaluates each entry against the Layer 2
// property bag. All must satisfy. Shape: equality plus one set
// `{includes}` form. The OR-across-properties lives in derived
// properties, not in the comparator. See PERMISSIONS.md.
//
// Lookup key per verb:
//   see     "*"
//   do      "<action>"  or  "<action>:<namespace>"
//   summon  "@<qualifier>"  or  "@<qualifier>:<intent>"  (prefix wildcard)
//   be      "<operation>"   (birth|connect|release)

import Space from "../materials/space/space.js";
import { getSpaceRootId } from "../sprout.js";
import { getAncestorChain } from "../materials/space/ancestorCache.js";
import { deriveStanceProperties } from "../ibp/stanceProperties.js";
import log from "../seedReality/log.js";
import { IBP_ERR } from "./protocol.js";
import { I_AM } from "../materials/being/seedBeings.js";
import { getOperation, isNamespaceKeyedAction } from "./operations.js";
import { isExtensionBlockedAtSpace } from "../materials/space/extensionScope.js";

// ─────────────────────────────────────────────────────────────────────
// Default permission rules written on the reality root at boot.
//
// Shape: `qualities.permissions.<verb>.<keyParts> = { requires: {...} }`
// `requires: { arrival: false }` admits authenticated, denies arrival.
// `homeOnThisReality: true` admits arrival too (ARRIVAL_PROPS sets it).
// Note: Mongoose Mixed strips empty `requires: {}` on save, so rules
// that mean "admit everyone" carry `homeOnThisReality: true` instead.
// ─────────────────────────────────────────────────────────────────────

const REALITY_ROOT_DEFAULT_PERMISSIONS = Object.freeze({
  // SEE: anyone present on this reality, including arrival.
  see: { "*": { requires: { homeOnThisReality: true } } },
  // DO / SUMMON: authenticated only.
  do:     { "*": { requires: { arrival: false } } },
  summon: { "*": { requires: { arrival: false } } },
  // BE: arrival admitted for sign-up via cherub; birther.birth and
  // non-cherub release reject arrival at the handler.
  be: {
    birth:   { requires: { homeOnThisReality: true } },
    connect: { requires: { homeOnThisReality: true } },
    release: { requires: { homeOnThisReality: true } },
  },
});

// ─────────────────────────────────────────────────────────────────────
// Heaven defaults. Heaven (`.`) is the I-Am's room and parents every
// Tier-3 heaven space. SEE is open to anyone on the reality so
// catalogs are readable; DO/SUMMON gate on the `angel` membership
// class (cherub anoints; I_AM short-circuits Layer 0).
// ─────────────────────────────────────────────────────────────────────

const HEAVEN_DEFAULT_PERMISSIONS = Object.freeze({
  see:    { "*": { requires: { homeOnThisReality: true } } },
  do:     { "*": { requires: { memberClasses: { includes: "angel" } } } },
  summon: { "*": { requires: { memberClasses: { includes: "angel" } } } },
});

// ─────────────────────────────────────────────────────────────────────
// Entry point
// ─────────────────────────────────────────────────────────────────────

/**
 * Authorize a verb request.
 *
 * @param {object} args
 * @param {object|null} args.identity { beingId, name } if authenticated
 * @param {"see"|"do"|"summon"|"be"} args.verb
 * @param {object} args.target     { kind, value, spaceId?, being?, isDiscovery? }
 * @param {string} [args.action]   DO action name
 * @param {string} [args.namespace] qualities namespace for namespace-keyed ops
 * @param {string} [args.intent]   SUMMON intent
 * @param {string} [args.operation] BE operation
 * @param {object} [args.summonCtx] caller's moment context; deltaF lets the
 *                                  ancestor walk see in-flight create-space
 *                                  specs that haven't sealed yet
 * @returns {Promise<{ ok: boolean, actor: string, reason?: string }>}
 */
export async function authorize(args) {
  const { identity, verb, target, summonCtx = null } = args;
  const beingId = identity?.beingId || null;
  const spaceId = target?.spaceId || null;

  // Layer 0: short-circuits.
  if (identity?.name === I_AM || identity?.beingId === I_AM) {
    return { ok: true, actor: I_AM };
  }
  if (verb === "see" && target?.isDiscovery) {
    return { ok: true, actor: "discovery" };
  }
  // BE bootstrap: arrival admitted on birth/connect reality-wide so
  // newcomers can sign up. Per-position rules cannot override this.
  if (
    verb === "be" &&
    !beingId &&
    (args.operation === "birth" || args.operation === "connect")
  ) {
    return { ok: true, actor: "arrival" };
  }

  // Layer 2: derive stance properties.
  const props = await deriveStanceProperties({
    beingId,
    targetSpace: spaceId,
    branch: summonCtx?.branch || "0",
  });
  const actorLabel = actorLabelFromProps(props);

  // Extension-scope gate. Refuse `ext:op` if the extension is blocked
  // at the target's ancestor chain.
  if (
    verb === "do" &&
    spaceId &&
    typeof args.action === "string" &&
    args.action.includes(":")
  ) {
    try {
      const op = getOperation(args.action);
      const ownerExt = op?.ownerExtension;
      if (ownerExt && ownerExt !== "seed") {
        const blocked = await isExtensionBlockedAtSpace(ownerExt, spaceId);
        if (blocked) {
          return {
            ok: false,
            actor: actorLabel,
            reason: `Extension "${ownerExt}" is blocked at this position`,
          };
        }
      }
    } catch {
      // Registry not initialized in some test paths. Fall through.
    }
  }

  const keyParts = buildKeyParts(args);
  if (!keyParts) {
    return {
      ok: false,
      actor: actorLabel,
      reason: `Unknown or unsupported verb shape: ${verb}`,
    };
  }

  // Layer 3: rule lookup.
  const matched = await findMatchingRule({ spaceId, verb, keyParts, summonCtx });
  if (matched) {
    return evaluateRequires(matched.rule, props, actorLabel, matched.source);
  }

  // Layer 4: extension-default registry, exact key then prefixes.
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
    return evaluateRequires(defaultRule, props, actorLabel, "extension-default");
  }

  // Layer 5: default deny.
  return {
    ok: false,
    actor: actorLabel,
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
      // Two-part key for namespace-aware ops (set-space etc.) so
      // operators can pin per-namespace permissions.
      if (args.namespace && isNamespaceKeyedAction(args.action)) {
        return [args.action, args.namespace];
      }
      return [args.action];
    }
    case "summon": {
      if (args.target?.kind === "thread") {
        return ["threads", String(args.target.id || "*")];
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

async function findMatchingRule({ spaceId, verb, keyParts, summonCtx = null }) {
  const branch = summonCtx?.branch || "0";
  if (!spaceId) {
    const spaceRootId = getSpaceRootId();
    if (!spaceRootId) return null;
    return matchOnSpace(spaceRootId, verb, keyParts, branch);
  }

  const path = await walkAncestorsWithDeltaF(spaceId, summonCtx);
  for (const id of path) {
    const match = await matchOnSpace(id, verb, keyParts, branch);
    if (match) return match;
  }
  return null;
}

// Walk the ancestor chain, consulting summonCtx.deltaF for in-flight
// create-space specs that haven't sealed yet. Lets a moment authorize
// inner acts against spaces whose Mongo row doesn't exist yet.
async function walkAncestorsWithDeltaF(spaceId, summonCtx) {
  const branch = summonCtx?.branch || "0";
  const deltaF = Array.isArray(summonCtx?.deltaF) ? summonCtx.deltaF : null;
  if (!deltaF || deltaF.length === 0) {
    let chain;
    try {
      chain = await getAncestorChain(spaceId, branch);
    } catch {
      chain = null;
    }
    return Array.isArray(chain) && chain.length
      ? chain.map((n) => String(n._id))
      : [String(spaceId)];
  }

  const path = [];
  const seen = new Set();
  let cursor = String(spaceId);
  while (cursor && !seen.has(cursor)) {
    seen.add(cursor);
    path.push(cursor);

    const { loadOrFold } = await import("../materials/projections.js");
    const slot = await loadOrFold("space", cursor, branch);
    if (slot) {
      // Mongo has the row — defer the rest of the walk to the cache.
      let chain;
      try {
        chain = await getAncestorChain(cursor, branch);
      } catch {
        chain = null;
      }
      if (Array.isArray(chain) && chain.length) {
        for (const node of chain) {
          const id = String(node._id);
          if (seen.has(id)) continue;
          seen.add(id);
          path.push(id);
        }
      }
      break;
    }

    // Row absent. Look for an in-flight create-space spec for this id.
    const pending = deltaF.find(
      (f) =>
        f?.verb === "do" &&
        f?.action === "create-space" &&
        f?.target?.kind === "space" &&
        String(f?.target?.id) === cursor,
    );
    if (!pending) break;
    cursor = pending.params?.parent || null;
  }
  return path;
}

async function matchOnSpace(spaceId, verb, keyParts, branch = "0") {
  // loadOrFold so a fresh branch sees inherited permissions until a
  // divergent set-space lands.
  const { loadOrFold } = await import("../materials/projections.js");
  const slot = await loadOrFold("space", spaceId, branch);
  const quals = slot?.state?.qualities;
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

function evaluateRequires(rule, props, actorLabel, source) {
  const requires = rule?.requires;
  if (!requires || typeof requires !== "object") {
    return { ok: true, actor: actorLabel, matched: source };
  }
  for (const [prop, expected] of Object.entries(requires)) {
    if (!compareRequirement(prop, expected, props)) {
      return {
        ok: false,
        actor: actorLabel,
        reason: `stance does not satisfy requires.${prop} (have ${JSON.stringify(props[prop])}, need ${JSON.stringify(expected)})`,
        matched: source,
      };
    }
  }
  return { ok: true, actor: actorLabel, matched: source };
}

function compareRequirement(propName, expected, props) {
  const actual = props[propName];

  // Scoped home-relation: `requires: { homeInDomain: "<spaceId>" }`
  // means the spaceId must be in the home's ancestor chain.
  if (
    typeof expected === "string" &&
    (propName === "homeInDomain" || propName === "positionInHomeDomain")
  ) {
    return Array.isArray(props.homeAncestors) && props.homeAncestors.includes(expected);
  }

  // Set membership: `requires: { memberClasses: { includes: "angel" } }`.
  // The only compound shape; OR-across-properties lives in derived
  // properties, not here.
  if (
    expected && typeof expected === "object" && !Array.isArray(expected) &&
    Object.prototype.hasOwnProperty.call(expected, "includes")
  ) {
    return Array.isArray(actual) && actual.includes(expected.includes);
  }

  if (expected === true) return actual === true;
  if (expected === false) return actual === false;
  if (Array.isArray(expected)) return expected.includes(actual);
  return actual === expected;
}

// ─────────────────────────────────────────────────────────────────────
// Actor label — names the actor's authority-class at the target for
// the response.actor field (used in error messages). Distinct from
// IBP-address stance (see ibp/address.js).
// ─────────────────────────────────────────────────────────────────────

function actorLabelFromProps(props) {
  if (props.arrival) return "arrival";
  if (props.owner) return "owner";
  if (props.contributor) return "contributor";
  if (Array.isArray(props.memberClasses)) {
    for (const className of props.memberClasses) {
      if (className === "owner" || className === "contributor") continue;
      return className;
    }
  }
  if (props.role) return props.role;
  return "member";
}

// ─────────────────────────────────────────────────────────────────────
// Seed defaults on reality boot
// ─────────────────────────────────────────────────────────────────────

/**
 * Plant the seed's default permission rules + auth flags. Idempotent.
 * An existing non-empty verb bucket is treated as operator-owned and
 * left alone.
 */
export async function seedDefaultStancePermissions(summonCtx) {
  if (!summonCtx) {
    throw new Error(
      "seedDefaultStancePermissions requires summonCtx. Wrap in withIAmAct(...).",
    );
  }
  const spaceRootId = getSpaceRootId();
  if (!spaceRootId)
    return { seeded: false, reason: "reality root not initialized" };

  const branch = summonCtx?.branch || "0";
  const seededFields = [];

  const { loadProjection } = await import("../materials/projections.js");
  const rootSlot = await loadProjection("space", spaceRootId, "0");
  const rootQualities = rootSlot?.state?.qualities || null;

  await seedRootPermissions({ spaceRootId, rootQualities, branch, seededFields });
  await seedRootAuthFlags({ spaceRootId, rootQualities, branch, seededFields });
  await seedHeavenPermissions({ summonCtx, seededFields });

  if (seededFields.length === 0) {
    return { seeded: false, reason: "defaults already present" };
  }
  return { seeded: true, fields: seededFields };
}

// Reality root permissions. Each seeder gets its own withBeingAct
// moment so the one-act-per-reel doctrine isn't violated (root
// permissions + auth flags share the place-root reel).
async function seedRootPermissions({ spaceRootId, rootQualities, branch, seededFields }) {
  const permsRoot =
    rootQualities instanceof Map
      ? rootQualities.get("permissions")
      : rootQualities?.permissions;

  const permissionsUpdate = {};
  for (const [verb, bucket] of Object.entries(REALITY_ROOT_DEFAULT_PERMISSIONS)) {
    const existingVerb = permsRoot?.[verb];
    if (existingVerb && Object.keys(existingVerb).length > 0) continue;
    permissionsUpdate[verb] = bucket;
  }

  if (Object.keys(permissionsUpdate).length === 0) return;

  const { doVerb } = await import("./verbs/do.js");
  const { withBeingAct } = await import("../sprout.js");
  await withBeingAct(I_AM, "seed root permissions", branch, async (ctx) => {
    await doVerb(
      { kind: "space", id: spaceRootId },
      "set-space",
      { field: "qualities.permissions", value: permissionsUpdate, merge: true },
      { identity: I_AM, summonCtx: ctx },
    );
  });
  for (const verb of Object.keys(permissionsUpdate)) {
    seededFields.push(`spaceRoot.qualities.permissions.${verb}`);
  }
}

// Reality-level BE config flags. Per-key conditional with merge:true
// so future additions to qualities.auth co-exist with the canonical
// flags.
async function seedRootAuthFlags({ spaceRootId, rootQualities, branch, seededFields }) {
  const auth =
    rootQualities instanceof Map
      ? rootQualities.get("auth")
      : rootQualities?.auth;
  const has = (key) => {
    if (!auth) return false;
    if (auth instanceof Map) return auth.has(key);
    return Object.prototype.hasOwnProperty.call(auth, key);
  };

  const authUpdate = {};
  if (!has("birth_enabled"))   authUpdate.birth_enabled   = true;
  if (!has("connect_enabled")) authUpdate.connect_enabled = true;
  if (Object.keys(authUpdate).length === 0) return;

  const { doVerb } = await import("./verbs/do.js");
  const { withBeingAct } = await import("../sprout.js");
  await withBeingAct(I_AM, "seed root auth flags", branch, async (ctx) => {
    await doVerb(
      { kind: "space", id: spaceRootId },
      "set-space",
      { field: "qualities.auth", value: authUpdate, merge: true },
      { identity: I_AM, summonCtx: ctx },
    );
  });
  seededFields.push("spaceRoot.qualities.auth");
}

// Heaven permissions. Rides the caller's summonCtx (heaven reel is
// separate from the place root reel).
async function seedHeavenPermissions({ summonCtx, seededFields }) {
  const { findByHeavenSpace } = await import("../materials/projections.js");
  const { HEAVEN_SPACE } = await import("../materials/space/heavenSpaces.js");
  const heavenSlot = await findByHeavenSpace(HEAVEN_SPACE.HEAVEN, "0");
  if (!heavenSlot) return;

  const heavenQualities = heavenSlot.state?.qualities || null;
  const heavenPerms =
    heavenQualities instanceof Map
      ? heavenQualities.get("permissions")
      : heavenQualities?.permissions;

  const heavenPermissionsUpdate = {};
  for (const [verb, bucket] of Object.entries(HEAVEN_DEFAULT_PERMISSIONS)) {
    const existingVerb = heavenPerms?.[verb];
    if (existingVerb && Object.keys(existingVerb).length > 0) continue;
    heavenPermissionsUpdate[verb] = bucket;
  }
  if (Object.keys(heavenPermissionsUpdate).length === 0) return;

  const { doVerb } = await import("./verbs/do.js");
  await doVerb(
    { kind: "space", id: String(heavenSlot.id) },
    "set-space",
    { field: "qualities.permissions", value: heavenPermissionsUpdate, merge: true },
    { identity: I_AM, summonCtx },
  );
  for (const verb of Object.keys(heavenPermissionsUpdate)) {
    seededFields.push(`heaven.qualities.permissions.${verb}`);
  }
}

// Read reality-level BE config flags. Defaults to true/true.
export async function getAuthConfig() {
  const spaceRootId = getSpaceRootId();
  if (!spaceRootId) return { birth_enabled: true, connect_enabled: true };
  const { loadProjection } = await import("../materials/projections.js");
  const rootSlot = await loadProjection("space", spaceRootId, "0");
  const auth = rootSlot?.state?.qualities?.auth;
  const get = (key, fallback) => {
    if (auth instanceof Map) return auth.has(key) ? auth.get(key) : fallback;
    return auth && key in auth ? auth[key] : fallback;
  };
  return {
    birth_enabled: get("birth_enabled", true) !== false,
    connect_enabled: get("connect_enabled", true) !== false,
  };
}

// Re-export for use in verb handlers.
export { IBP_ERR };

// ─────────────────────────────────────────────────────────────────────
// Extension-default permission registry (Layer 4)
//
// Extensions contribute through manifest `provides.defaultPermissions`.
// Keys match qualities.permissions shape ("do:set-qualities:position",
// "summon:@planner*", etc.). Authorize falls through here when no
// qualities.permissions rule matched on the position chain.
// ─────────────────────────────────────────────────────────────────────

const _defaultPermissions = new Map();

// Register an extension's default rules. Idempotent.
export function registerDefaultPermissions(extName, perms) {
  if (!extName || !perms || typeof perms !== "object") return;
  unregisterDefaultPermissions(extName);
  let count = 0;
  for (const [key, rule] of Object.entries(perms)) {
    if (!key || typeof key !== "string") continue;
    if (!rule || typeof rule !== "object") continue;
    _defaultPermissions.set(key, {
      requires:
        rule.requires && typeof rule.requires === "object"
          ? { ...rule.requires }
          : {},
      _extName: extName,
    });
    count++;
  }
  if (count > 0) {
    log.verbose("Authorize", `registered ${count} default permission rule(s) for "${extName}"`);
  }
}

// Remove all rules contributed by an extension. Called on uninstall.
export function unregisterDefaultPermissions(extName) {
  if (!extName) return;
  for (const [key, rule] of Array.from(_defaultPermissions.entries())) {
    if (rule._extName === extName) _defaultPermissions.delete(key);
  }
}

function lookupDefault(key) {
  if (!key) return null;
  return _defaultPermissions.get(key) || null;
}

/**
 * Enumerate the registered keys (diagnostic).
 */
export function listDefaultPermissions() {
  const out = {};
  for (const [key, rule] of _defaultPermissions) {
    out[key] = { requires: rule.requires, fromExtension: rule._extName };
  }
  return out;
}
