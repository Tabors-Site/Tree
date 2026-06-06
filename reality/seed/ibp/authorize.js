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
// reality — my seed-emitted SUMMONs, my scheduled wakes, my genesis
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
//      position, walking up the parent chain to the reality root).
//      When no rule matches, I fall through to the extension
//      defaults registry below, then default deny.
//
//   3. I compare each `requires` entry in the rule against the
//      stance's derived properties. All must be satisfied. I return
//      allow or deny with a reason.
//
// Lookup key shape per verb:
//   see:     "*"                                          (universal for now)
//   do:      "<action>:<param>" or "<action>"             (e.g. "set-qualities:position")
//   summon:  "@<qualifier>:<intent>" or "@<qualifier>"    (qualifier supports prefix wildcard)
//   be:      "<operation>"                                (birth|connect|release)
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

import Space from "../materials/space/space.js";
import { getSpaceRootId } from "../sprout.js";
import { getAncestorChain } from "../materials/space/ancestorCache.js";
import { deriveStanceProperties } from "../ibp/stanceProperties.js";
import log from "../seedReality/log.js";
import { IBP_ERR } from "./protocol.js";
import { I_AM } from "../materials/being/seedBeings.js";

// ─────────────────────────────────────────────────────────────────────
// Default layer-2 stance permissions written on the reality root.
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

const REALITY_ROOT_DEFAULT_PERMISSIONS = Object.freeze({
  // SEE: anyone present on this reality, including arrival
  // (unauthenticated visitors). The reality root is the public-facing
  // first impression; the portal's "see what you're joining before
  // committing" UX depends on this being open. Per-position rules
  // at private trees can tighten by adding
  // `qualities.permissions.see.<keyParts>` with stricter requires
  // (e.g., `requires: { arrival: false }` or
  // `requires: { contributor: true }`).
  //
  // `homeOnThisReality: true` admits arrival (ARRIVAL_PROPS sets it
  // true) AND every local being. It denies federated-remote stances
  // by default; they can opt in per-position. An empty
  // `requires: {}` would be cleaner, but Mongoose Mixed strips empty
  // nested objects on save (the same quirk Round 5 INTEGRITY caught),
  // wiping the whole rule. The condition has to carry SOMETHING.
  see: { "*": { requires: { homeOnThisReality: true } } },
  // DO / SUMMON: still authenticated-only. Arrival can look but not
  // act. (BE birth/connect has its own bootstrap exception below
  // for sign-up flows.)
  do: { "*": { requires: { arrival: false } } },
  summon: { "*": { requires: { arrival: false } } },
  // BE: arrival can birth/connect (so anyone can sign up); only
  // authenticated callers can release their own session.
  // create-being: cherub summons beings forth on external
  // callers' behalf; extensions add their own create-being rules
  // (e.g., "my ruler role may create sub-rulers in its tree")
  // through provides.defaultPermissions in their manifest.
  be: {
    // The three canonical BE ops. `homeOnThisReality: true` admits
    // ARRIVAL_PROPS (which sets it true) AND every local being, so
    // both unauthenticated callers (cherub flows) and authenticated
    // ones (birther / inhabit) pass the auth layer. Identity-flow
    // specifics are enforced at the handler:
    //   - cherub.birth / cherub.connect: arrival mints a fresh
    //     identity / binds credentials.
    //   - birther.birth: handler rejects unauthenticated callers
    //     (must already BE someone to mint a child).
    //   - inhabit-connect: handler enforces ancestor-relation auth.
    //   - release on bound session: handler is a no-op for arrival.
    //
    // `requires: {}` would be the cleanest expression but Mongoose
    // Mixed strips empty nested objects on save (the same quirk the
    // SEE rule above documents), wiping the rule entirely. The
    // condition has to carry SOMETHING; homeOnThisReality is the
    // permissive option ARRIVAL_PROPS already satisfies.
    birth: { requires: { homeOnThisReality: true } },
    connect: { requires: { homeOnThisReality: true } },
    release: { requires: { homeOnThisReality: true } },
    // create-being: any authenticated being can summon a being forth.
    // The privilege boundary lives DOWNSTREAM — the new being must
    // be parented under a space the actor can write to (their home,
    // their child trees, etc.), and the ownership check on that
    // space gates the actual mint. The default here just admits the
    // attempt; the substrate-side checks enforce the outcome.
    //
    // The previous `role: "cherub"` default was a bootstrap-era
    // intent (the cherub at the gate creates identities) but broke
    // every plant scaffold that mints beings on the operator's
    // behalf — operators have role="human", not "cherub", and the
    // strict rule rejected legitimate operator-initiated creation.
    "create-being": { requires: { arrival: false } },

    // llm-assigner BE ops. Any authenticated being can manage its
    // own LLM connections (add-llm, list/delete on its own being,
    // bind one of its connections to a slot). set-reality-llm /
    // set-space-llm pass the auth gate at this layer and the
    // llm-assigner role enforces the tighter "root operator" /
    // "tree owner" check inline. Without these rules every fresh
    // operator hits "no rule matched be:add-llm" the first time
    // they try to configure a connection.
    "add-llm": { requires: { arrival: false } },
    "assign-slot": { requires: { arrival: false } },
    "list-llms": { requires: { arrival: false } },
    "delete-llm": { requires: { arrival: false } },
    "set-reality-llm": { requires: { arrival: false } },
    "set-space-llm": { requires: { arrival: false } },
  },
});

// ─────────────────────────────────────────────────────────────────────
// Heaven space defaults. Heaven is the I-Am's room and parents every
// Tier-3 heaven space (identity, config, tools, roles, operations,
// extensions, source, peers, threads). It's not a public reality.
//
// Heaven splits read from write:
//
//   SEE: any being whose home is this reality may read the catalogs
//     (./beings, ./operations, ./roles, ./threads, ./extensions, ...).
//     Reading is how operators and ordinary beings introspect what
//     the reality has — gating SEE on canWrite hid the catalogs
//     entirely from anyone who hadn't yet been added as a heaven
//     contributor (including the rootOperator before their cherub
//     registration completes). `homeOnThisReality: true` matches the
//     same admission rule the reality root uses for SEE.
//
//   DO / SUMMON: `requires: { canWrite: true }` admits the I-Am
//     (heaven's rootOwner) and every being added as a contributor to
//     heaven. Seed delegates (cherub, birther, llm-assigner, reality-
//     manager, arrival, etc.) are contributors by boot scaffold; the
//     rootOperator becomes a heaven contributor when they register
//     through cherub. Later operators added the same way:
//     addContributor on heaven. Beings of the land lacking heaven
//     canWrite can SEE but cannot mutate.
//
// The earlier `reigning` stance was retired 2026-06-04 . it was a
// parallel roster duplicating the existing rootOwner + contributors
// model with a separate cache, matter, and DO ops. Heaven now uses
// the same ownership system as every other space.
//
// Operators can tighten this per their setup by writing explicit
// `qualities.permissions.see.<keyParts>` on heaven (or on individual
// Tier-3 spaces). The closer rule wins on the ancestor walk.
//
// BE intentionally omitted: heaven is not a sign-up destination. The
// nearest applicable BE rule comes from the reality root (register and
// claim from arrival, the rest from authenticated stances), reached
// via the ancestor walk when no rule matches at heaven itself.
// ─────────────────────────────────────────────────────────────────────

const HEAVEN_DEFAULT_PERMISSIONS = Object.freeze({
  see: { "*": { requires: { homeOnThisReality: true } } },
  do: { "*": { requires: { canWrite: true } } },
  summon: { "*": { requires: { canWrite: true } } },
});

// Historic heaven seed defaults — past values of HEAVEN_DEFAULT_PERMISSIONS
// that the seeder should migrate to the current default on boot rather
// than treat as an operator customization. When changing the heaven
// defaults, add the old shape here so persisted-from-prior-boot rules
// migrate automatically (no DB drop required).
//
// Compare shapes with `JSON.stringify` rather than deep equality
// since the persisted Mixed-type value comes back as a plain object
// either way.
const _HISTORIC_HEAVEN_SEED_DEFAULTS = {
  see: [
    // 2026-06-04 — original reigning-collapse default; tightened too
    // far. Required canWrite, hid the catalogs from anyone who hadn't
    // completed cherub registration.
    { "*": { requires: { canWrite: true } } },
  ],
  do: [],
  summon: [],
};
function _isHistoricHeavenSeedDefault(verb, bucket) {
  const olds = _HISTORIC_HEAVEN_SEED_DEFAULTS[verb] || [];
  const bucketJson = JSON.stringify(bucket);
  return olds.some((old) => JSON.stringify(old) === bucketJson);
}

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
 * @param {string} [args.namespace] set-qualities namespace
 * @param {string} [args.intent]   SUMMON intent
 * @param {string} [args.operation] BE operation
 * @param {object} [args.summonCtx] caller's moment context (carries deltaF
 *                                  so the ancestor walk can see in-flight
 *                                  create-space specs that haven't sealed
 *                                  yet — needed for scaffolds that chain
 *                                  do:create-space → do:create-matter at
 *                                  the just-stamped space within one moment)
 * @returns {Promise<{ ok: boolean, stance: string, reason?: string }>}
 */
export async function authorize(args) {
  const { identity, verb, target, summonCtx = null } = args;
  const beingId = identity?.beingId || null;
  const spaceId = target?.spaceId || null;

  // The I_AM has universal authority. The seed is the source of all
  // permission on its reality. Authority flows outward from the I_AM;
  // nothing extensions or operators do can gate it. Every seed-
  // emitted act (DO-trigger fan-out, scheduled wakes, genesis
  // scaffolding) runs as the I_AM and shorts past the layered check.
  if (identity?.name === I_AM) {
    return { ok: true, stance: I_AM };
  }

  // ── Layer 2: derive stance properties ──
  const props = await deriveStanceProperties({
    beingId,
    targetSpace: spaceId,
    branch: summonCtx?.branch || "0",
  });
  const stanceLabel = stanceLabelFromProps(props);

  // BE bootstrap exception. All three canonical BE ops are permitted
  // from arrival:
  //
  //   birth / connect     — admission ops, gated downstream by
  //                         reality-level birth_enabled / connect_enabled
  //                         flags (the cherub enforces). Without this
  //                         no one could ever sign up on a fresh reality.
  //
  //   release             — stateless no-op at the cherub level
  //                         (returns {released:true}). Allowing it
  //                         from arrival unblocks the stale-session
  //                         cleanup path: a client with a dead cookie
  //                         can release it, drop to a clean arrival
  //                         state, then birth / connect again.
  //
  // Per-op feature flags + cherub-side validation handle actual
  // authorization; this gate just lets the request reach them.
  if (verb === "be" && props.arrival) {
    if (
      args.operation === "birth" ||
      args.operation === "connect" ||
      args.operation === "release"
    ) {
      return { ok: true, stance: "arrival" };
    }
  }

  // SEE discovery exception: <reality>/.discovery is the reality's
  // capability surface — always visible.
  if (verb === "see" && target?.isDiscovery) {
    return { ok: true, stance: stanceLabel };
  }

  // ── Extension-scope gate ──
  // If the operation being authorized is registered by an extension,
  // and that extension is blocked at the target space (via
  // qualities.extensions.blocked on the ancestor chain), reject before
  // rule-matching. This is the same guarantee the MCP server used to
  // enforce for LLM tool calls; pulling it into authorize makes the
  // guarantee universal: ANY caller (the LLM voice, an extension
  // emitting a DO directly, a script) gets gated identically.
  //
  // Only fires for DO with an extension-prefixed action ("ext:op").
  // Seed ops (bare names) and the other verbs don't have
  // extension-association at the verb level today; tool-level scope
  // checks for SEE/SUMMON/BE happen in the LLM voice's tool dispatcher.
  if (
    verb === "do" &&
    spaceId &&
    typeof args.action === "string" &&
    args.action.includes(":")
  ) {
    try {
      const { getOperation } = await import("./operations.js");
      const op = getOperation(args.action);
      const ownerExt = op?.ownerExtension;
      if (ownerExt && ownerExt !== "seed") {
        const { isExtensionBlockedAtSpace } =
          await import("../materials/space/extensionScope.js");
        const blocked = await isExtensionBlockedAtSpace(ownerExt, spaceId);
        if (blocked) {
          return {
            ok: false,
            stance: stanceLabel,
            reason: `Extension "${ownerExt}" is blocked at this position`,
          };
        }
      }
    } catch {
      // Lookup failure (registry not initialized in some test paths,
      // dynamic-import flake) shouldn't lock the reality out. Fall
      // through to normal stance-rule matching.
    }
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
  const matched = await findMatchingRule({
    spaceId,
    verb,
    keyParts,
    summonCtx,
  });
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
      // Namespace-aware rules: a write to qualities.<namespace> uses
      // a two-part key [action, namespace] so an operator can pin
      // permissions per quality namespace. Covers the legacy
      // set-qualities/clear-qualities ops and the material-scoped
      // set-space/set-being/set-matter ops with
      // field="qualities.<namespace>..." (do.js extracts namespace
      // into args.namespace before this runs).
      if (
        (args.action === "set-qualities" ||
          args.action === "clear-qualities" ||
          args.action === "set-space" ||
          args.action === "set-being" ||
          args.action === "set-matter") &&
        args.namespace
      ) {
        return [args.action, args.namespace];
      }
      return [args.action];
    }
    case "summon": {
      // Thread target: SUMMON `./threads/<id>` is a cut. The keyParts
      // route to `summon:threads:*` so operators can pin a stricter
      // rule at the reality root if they want; the cut handler in
      // reality/space/threads.js does its own participation check
      // (you must be in the rootCorrelation chain to sever it).
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
// create-space specs that haven't sealed yet. Returns a list of space ids
// from the starting space up to (and including) the reality root.
//
// The doctrinal shape: a moment that creates a space and then acts at
// the new space (seed scaffolds chain do:create-space → do:create-matter)
// must be able to authorize the inner act. The new space's row doesn't
// materialize until sealAct's foldAfterCommit; until then it lives only
// as a fact spec in summonCtx.deltaF. Authorize falls back to the
// in-flight spec for its parent, then continues via Mongo's cache for
// the rest of the chain.
//
// No deltaF (boot, outside any moment, or a moment that emitted no
// creates yet): fast-path to getAncestorChain.
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
    const _slot = await loadOrFold("space", cursor, branch);
    const row = _slot ? { parent: _slot.state?.parent } : null;
    if (row) {
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

    // Row absent. Look for a pending create-space spec for this id and
    // continue walking through its declared parent. Without a match we
    // stop — the caller is acting at a space that exists nowhere.
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
  // loadOrFold (not loadProjection): on a fresh branch the space's slot
  // hasn't been cold-folded yet. A bare loadProjection returns null,
  // matchOnSpace finds no permissions, and the ancestor walk falls
  // through to "no rule" — denying writes (and heaven access) the
  // user has on main. loadOrFold walks lineage so branch-1 sees main's
  // permissions until they get explicitly overridden.
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
// Seed defaults on reality boot
// ─────────────────────────────────────────────────────────────────────

/**
 * Plant the seed's default stance-permission rules on the reality root.
 * Idempotent. Writes the unified layer-2 rule shape that the authorize
 * walk reads at every verb call:
 *
 *   qualities.permissions.<verb>.<keyParts> = { requires: { ... } }
 *
 * The defaults preserve the historical semantics: any authenticated
 * being can act at the reality root (any verb, any keyParts); arrival
 * can only BE birth/connect. Per-position rules at sub-positions
 * override these via the ancestor walk picking the nearest match.
 */
export async function seedDefaultStancePermissions(summonCtx) {
  if (!summonCtx) {
    throw new Error(
      "seedDefaultStancePermissions requires summonCtx. Wrap the call in withIAmAct(...) so each set-space Fact rides the I-Am's act.",
    );
  }
  const spaceRootId = getSpaceRootId();
  if (!spaceRootId)
    return { seeded: false, reason: "reality root not initialized" };

  const { doVerb } = await import("./verbs/do.js");

  const seededFields = [];

  // ── reality root defaults ──
  const { loadProjection: _lProot, findByHeavenSpace: _fSS } =
    await import("../materials/projections.js");
  const _rootSlot = await _lProot("space", spaceRootId, "0");
  const root = _rootSlot ? { qualities: _rootSlot.state?.qualities } : null;
  const quals = root?.qualities;
  const permsRoot =
    quals instanceof Map ? quals.get("permissions") : quals?.permissions;

  const rootUpdates = {};

  // Seed each verb's bucket only if it isn't already populated. We do
  // not overwrite operator customizations.
  for (const [verb, bucket] of Object.entries(
    REALITY_ROOT_DEFAULT_PERMISSIONS,
  )) {
    const existingVerb = permsRoot?.[verb];
    if (existingVerb && Object.keys(existingVerb).length > 0) continue;
    rootUpdates[`qualities.permissions.${verb}`] = bucket;
  }

  // reality-level BE config flags (birth/connect toggles for operators
  // who want to lock the reality down).
  const auth = quals instanceof Map ? quals.get("auth") : quals?.auth;
  const hasAuth = auth instanceof Map ? auth.size > 0 : !!auth;
  if (!hasAuth) {
    rootUpdates["qualities.auth"] = {
      birth_enabled: true,
      connect_enabled: true,
    };
  }

  for (const [field, value] of Object.entries(rootUpdates)) {
    await doVerb(
      { kind: "space", id: spaceRootId },
      "set-space",
      { field, value, merge: false },
      { scaffold: true, summonCtx },
    );
    seededFields.push(`spaceRoot.${field}`);
  }

  // ── Heaven defaults ──
  // Heaven is the I-Am's room. Owner-only by default. Beings of the
  // land see the door (heaven shows up in the reality-root children
  // listing) but SEE on "<reality>/." denies. Tier-3 heaven spaces under
  // heaven inherit this through the ancestor walk.
  const { HEAVEN_SPACE } = await import("../materials/space/heavenSpaces.js");
  const _heavenSlot = await _fSS(HEAVEN_SPACE.HEAVEN, "0");
  const heaven = _heavenSlot
    ? { _id: _heavenSlot.id, qualities: _heavenSlot.state?.qualities }
    : null;
  if (heaven) {
    const heavenQuals = heaven.qualities;
    const heavenPerms =
      heavenQuals instanceof Map
        ? heavenQuals.get("permissions")
        : heavenQuals?.permissions;
    const heavenUpdates = {};
    for (const [verb, bucket] of Object.entries(HEAVEN_DEFAULT_PERMISSIONS)) {
      const existingVerb = heavenPerms?.[verb];
      // Three cases:
      //   1. No existing rule for this verb — apply current default.
      //   2. Existing rule matches a known historic seed default that
      //      we've since changed — reseed (migrate stale defaults).
      //   3. Existing rule doesn't match any historic default —
      //      treat as an operator customization, leave alone.
      // Case 2 catches the gap that without it would force the
      // operator to drop the DB whenever a seed default changes.
      if (existingVerb && Object.keys(existingVerb).length > 0) {
        if (!_isHistoricHeavenSeedDefault(verb, existingVerb)) continue;
      }
      heavenUpdates[`qualities.permissions.${verb}`] = bucket;
    }
    for (const [field, value] of Object.entries(heavenUpdates)) {
      await doVerb(
        { kind: "space", id: String(heaven._id) },
        "set-space",
        { field, value, merge: false },
        { scaffold: true, summonCtx },
      );
      seededFields.push(`heaven.${field}`);
    }
  }

  if (seededFields.length === 0) {
    return { seeded: false, reason: "defaults already present" };
  }
  return { seeded: true, fields: seededFields };
}

/**
 * Read the reality-level BE configuration flags. Defaults to
 * birth_enabled and connect_enabled both true.
 */
export async function getAuthConfig() {
  const spaceRootId = getSpaceRootId();
  if (!spaceRootId) return { birth_enabled: true, connect_enabled: true };
  const { loadProjection: _lProot2 } =
    await import("../materials/projections.js");
  const _rootSlot2 = await _lProot2("space", spaceRootId, "0");
  const auth = _rootSlot2?.state?.qualities?.auth;
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
//         "do:set-qualities:position": { requires: { contributor: true } },
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
// qualities.permissions entries ("do:set-qualities:position",
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
 * tools that show "what default permissions are active on this reality").
 */
export function listDefaultPermissions() {
  const out = {};
  for (const [key, rule] of _defaultPermissions) {
    out[key] = { requires: rule.requires, fromExtension: rule._extName };
  }
  return out;
}
