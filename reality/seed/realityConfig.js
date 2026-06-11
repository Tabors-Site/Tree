// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// Place identity, remembered across reboots.
//
// What this reality IS to the outside world — its name, public URL,
// federation directory, accepted MIME types, boundary security
// domains. Things the discovery payload surfaces, things a peer
// reality sees when it reaches in.
//
// At genesis I plant the `./config` heaven space and write the
// boot-time settings into its qualities Map. Every later boot, I
// read that Map back through `initRealityConfig()`.
// `getRealityConfigValue(key)` and `setRealityConfigValue(key, value)`
// are the only sanctioned paths in or out for reality-identity keys.
//
// Seed runtime knobs (LLM call shape, scheduler backpressure, hook
// timeouts, cleanup intervals — the apparatus's internal tuning)
// live in [internalConfig.js](internalConfig.js). Both files write to the
// SAME underlying store (this file owns the storage primitive);
// the split is conceptual — readers reach the right surface at
// import-site.

// Module-state declarations FIRST (before imports that may chain
// back into this module during their own top-level). `var` is used
// deliberately: a circular import that lands a callback into
// getRealityConfigValue mid-load would hit a TDZ ReferenceError on
// `let` here. var has no TDZ; same semantics, immune to that race.
// The chain in question:
//   ancestorCache.js (top-level scheduleCleanup) → getTTL →
//   getInternalConfigValue → getRealityConfigValue → reads cache.
// If realityConfig is mid-import when that fires, cache must be
// readable as `undefined` (treated as null), not throw.
var configCache = null;
var initialized = false;
var cachedRealityUrl = null;

import log from "./seedReality/log.js";
import Space from "./materials/space/space.js";
import { HEAVEN_SPACE } from "./materials/space/heavenSpaces.js";
import { I_AM } from "./materials/being/seedBeings.js";
import { registerOperation } from "./ibp/operations.js";
// NOTE: protocol.js + identity.js are pulled in lazily inside the
// close-reality handler (dynamic import), not at the top level — this
// module loads very early (see the circular-import note above) and a
// static import of the being/identity chain here risks a load-order TDZ.

// The reality's public connection URL. Other realities, browsers, and the
// IBP discovery endpoint all reach me at this URL. Derived from
// REALITY_DOMAIN + PORT; REALITY_PUBLIC_URL overrides the whole value for
// reverse-proxy deploys where the constructed URL would be wrong.
// Port suffix only for local domains; public domains sit behind proxies.
export function getRealityUrl() {
  if (cachedRealityUrl) return cachedRealityUrl;
  if (process.env.REALITY_PUBLIC_URL) {
    cachedRealityUrl = process.env.REALITY_PUBLIC_URL.replace(/\/+$/, "");
    return cachedRealityUrl;
  }
  const raw = process.env.REALITY_DOMAIN || "localhost";
  const domain = raw.replace(/^https?:\/\//, "").replace(/\/+$/, "").replace(/:\d+$/, "");
  const port = process.env.PORT || 80;
  const isLocal =
    domain === "localhost"          ||
    domain.startsWith("localhost")  ||
    domain.startsWith("127.")       ||
    domain.startsWith("192.168.")   ||
    domain.startsWith("10.")        ||
    domain.endsWith(".lan")         ||
    domain.endsWith(".local")       ||
    !domain.includes(".");
  const protocol = isLocal ? "http" : "https";
  const portSuffix = isLocal && port != 80 && port != 443 ? `:${port}` : "";
  cachedRealityUrl = `${protocol}://${domain}${portSuffix}`;
  return cachedRealityUrl;
}

const PROTECTED_KEYS = new Set([
  "seedVersion",
  "disabledExtensions",
]);

const CONFIG_KEY_RE = /^[a-zA-Z][a-zA-Z0-9_]{0,63}$/;
const DANGEROUS_KEYS = new Set(["__proto__", "constructor", "prototype", "toString", "valueOf", "hasOwnProperty"]);
const MAX_VALUE_BYTES = 65536;

function validateKey(key) {
  if (typeof key !== "string") throw new Error("Config key must be a string");
  if (!CONFIG_KEY_RE.test(key)) throw new Error(`Invalid config key "${key}". Must be alphanumeric + underscores, start with letter, max 64 chars.`);
  if (DANGEROUS_KEYS.has(key)) throw new Error(`Config key "${key}" is reserved`);
}

function validateValue(value) {
  if (value === undefined) return;
  try {
    const size = JSON.stringify(value).length;
    if (size > MAX_VALUE_BYTES) {
      throw new Error(`Config value exceeds ${MAX_VALUE_BYTES} byte limit (${size} bytes)`);
    }
  } catch (e) {
    if (e.message.includes("limit")) throw e;
    throw new Error("Config value must be JSON-serializable");
  }
}

// Keys allowed to fall back to process.env before initRealityConfig() runs.
// `var` (not `const`): getRealityConfigValue reads this set, and the
// circular-import callback (see top-of-file note) may fire it before
// the const initializer runs. var hoists and accepts `undefined` on
// early reads; the `BOOT_ENV_KEYS.has` call below short-circuits via
// optional chaining for that case.
var BOOT_ENV_KEYS = new Set([
  "socketMaxBufferSize", "socketPingTimeout", "socketPingInterval", "socketConnectTimeout",
  "maxConnectionsPerIp", "REALITY_NAME", "realityUrl", "HORIZON_URL",
]);

// Every returned value is a deep copy so callers can't pollute the cache.
function deepCopy(value) {
  if (value === null || typeof value !== "object") return value;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return value;
  }
}

async function loadConfigFromDb() {
  try {
    const { findByHeavenSpace } = await import("./materials/projections.js");
    const configSlot = await findByHeavenSpace(HEAVEN_SPACE.CONFIG, "0");
    if (!configSlot || !configSlot.state?.qualities) {
      log.warn("Reality", "No config heaven space found or qualities is empty. Using empty config.");
      configCache = {};
      return;
    }
    // All config keys live under qualities.config.<key>.
    const q = configSlot.state.qualities;
    const configNs = q instanceof Map ? q.get("config") : q.config;
    if (!configNs || typeof configNs !== "object") {
      configCache = {};
      return;
    }
    const raw = configNs instanceof Map
      ? Object.fromEntries(configNs)
      : { ...configNs };

    // Strip keys that would fail validation (manual DB edits, proto
    // pollution injected directly into MongoDB, Mongoose lean() leaks).
    const clean = {};
    for (const [k, v] of Object.entries(raw)) {
      if (DANGEROUS_KEYS.has(k)) {
        log.warn("Reality", `Dangerous config key "${k}" found in DB. Skipped.`);
        continue;
      }
      if (k.startsWith("$") || k.startsWith("_")) continue;
      clean[k] = v;
    }
    configCache = clean;
  } catch (err) {
    log.error("Reality", `Failed to load config from DB: ${err.message}. Using empty config.`);
    configCache = {};
  }
}

export function getRealityConfigValue(key) {
  if (configCache && key in configCache && configCache[key] != null) {
    return deepCopy(configCache[key]);
  }
  // Guard BOOT_ENV_KEYS access — if this runs during the circular-import
  // window noted at top-of-file, the var declaration may not have
  // executed yet (var hoists but BOOT_ENV_KEYS is undefined until its
  // initializer line). Optional-chain so a callback that fires too
  // early returns null cleanly instead of throwing.
  if (!initialized && BOOT_ENV_KEYS?.has(key)) {
    return process.env[key] || null;
  }
  return null;
}

// Cached _id of the `./config` heaven space. Looked up on first write
// and stable thereafter — the heaven spaces are created once at
// genesis and never deleted. Avoids the heavenSpace-marker scan on every
// config write during boot.
let cachedConfigSpaceId = null;
async function getConfigSpace() {
  const { loadProjection, findByHeavenSpace } = await import("./materials/projections.js");
  if (cachedConfigSpaceId) {
    const slot = await loadProjection("space", cachedConfigSpaceId, "0");
    if (slot) return { _id: slot.id, ...slot.state };
    cachedConfigSpaceId = null; // stale; refetch
  }
  const slot = await findByHeavenSpace(HEAVEN_SPACE.CONFIG, "0");
  if (slot) {
    cachedConfigSpaceId = String(slot.id);
    return { _id: slot.id, ...slot.state };
  }
  return null;
}

export async function setRealityConfigValue(key, value, { internal, identity, summonCtx } = {}) {
  validateKey(key);
  if (PROTECTED_KEYS.has(key) && !internal) {
    throw new Error(`Config key "${key}" is protected and cannot be modified manually`);
  }
  validateValue(value);
  if (!summonCtx) {
    throw new Error(
      `setRealityConfigValue(${key}) requires summonCtx. Runtime callers thread the moment's ctx; seed-internal callers (e.g. migrations) wrap in withIAmAct(...).`,
    );
  }

  const configSpace = await getConfigSpace();
  if (!configSpace) {
    throw new Error("Config write failed: config heaven space not found at <reality>/./config. Reality may need repair.");
  }

  // Route through do.set-space so the write IS a Fact on the `./config`
  // space's reel. internal=true (seed scaffolding) attributes via the
  // scaffold path; user-driven writes thread caller identity. Either
  // way, the fact joins the wrapping moment's ΔF.
  const { doVerb } = await import("./ibp/verbs/do.js");
  const opts = identity
    ? { identity, summonCtx }
    : { identity: I_AM, summonCtx };
  await doVerb(
    { kind: "space", id: String(configSpace._id) },
    "set-space",
    { field: `qualities.config.${key}`, value },
    opts,
  );

  if (!configCache) configCache = {};
  configCache[key] = value;

  log.verbose("Reality", `Config set: ${key}`);
}

export async function deleteRealityConfigValue(key, { internal, identity, summonCtx } = {}) {
  validateKey(key);
  if (PROTECTED_KEYS.has(key) && !internal) {
    throw new Error(`Config key "${key}" is protected and cannot be deleted manually`);
  }
  if (!summonCtx) {
    throw new Error(
      `deleteRealityConfigValue(${key}) requires summonCtx. Runtime callers thread the moment's ctx; seed-internal callers wrap in withIAmAct(...).`,
    );
  }

  const configSpace = await getConfigSpace();
  if (!configSpace) {
    throw new Error("Config delete failed: config heaven space not found at <reality>/./config.");
  }

  const { doVerb } = await import("./ibp/verbs/do.js");
  const opts = identity
    ? { identity, summonCtx }
    : { identity: I_AM, summonCtx };
  await doVerb(
    { kind: "space", id: String(configSpace._id) },
    "set-space",
    { field: `qualities.config.${key}`, value: null },
    opts,
  );

  if (configCache) delete configCache[key];
  log.verbose("Reality", `Config deleted: ${key}`);
}

// Place-identity defaults. What this reality IS to the outside
// world. Seed runtime knobs (LLM timeout, scheduler limits, hooks,
// caches, etc.) live in [internalConfig.js](internalConfig.js).
export const CONFIG_DEFAULTS = {
  // Identity + federation
  REALITY_NAME: "My Place",
  realityUrl: null,
  HORIZON_URL: "https://horizon.treeos.ai",
  timezone: null,
  realityLlmConnection: null,

  // Host observation switches (seed/materials/host/). Facts stamped
  // by the http-server / websocket-pool beings; flipping one to false
  // stops stamping immediately (in-memory counters keep counting).
  hostRequestFacts: true,
  hostConnectionFacts: true,

  // Boundary security (what the reality accepts at its edge)
  allowedLlmDomains: [],
  allowedFrameDomains: [],
  allowedMimeTypes: null,
  uploadEnabled: true,
  maxUploadBytes: 104857600,
  // Content-store retention (matter/casSweep.js):
  //   "all"    — keep every version's bytes while any fact names its
  //              hash (full history; identical bytes still dedup)
  //   "latest" — keep only bytes that some live projection's CURRENT
  //              content references; old versions reclaim on sweep
  // Targeted deletion is the purge-content op, not this policy.
  contentRetention: "all",
  jwtExpiryDays: 30,
  cookieDomain: null,

  // Spatial defaults for spaces (Space.size shape: `{ x, y, z? }`).
  // `defaultSpaceSize` fills in when a space is created without a
  // size in the spec . the reality root, being homes, and ad-hoc
  // user-created spaces all land at this size unless the caller
  // overrides. Beings' coord writes are clamped against the space's
  // size (per being.coord), so a sized space lets the portal render
  // a walkable grid and the substrate keep positions in-bounds.
  //
  // `maxSpaceSize` caps any axis on size writes (create + set-space).
  // A request to make a 10^9-cell space throws INVALID_INPUT. Keep
  // this generous . it's a sanity guard, not a budget.
  defaultSpaceSize: { x: 50, y: 50 },
  maxSpaceSize:     { x: 1000, y: 1000, z: 1000 },

  // Protected (shown but not modifiable via public API)
  seedVersion: null,
  disabledExtensions: [],
};

export function getAllRealityConfig() {
  if (!configCache) return {};
  try {
    return JSON.parse(JSON.stringify(configCache));
  } catch {
    return {};
  }
}

// Every known key with its effective value, default, and whether it's
// overridden in the DB. Used by reality-manager to show full state.
export function getConfigWithDefaults() {
  const dbValues = getAllRealityConfig();
  const result = {};

  for (const [key, defaultValue] of Object.entries(CONFIG_DEFAULTS)) {
    const hasOverride = key in dbValues;
    result[key] = {
      value: hasOverride ? dbValues[key] : defaultValue,
      default: defaultValue,
      custom: hasOverride,
    };
  }

  for (const [key, value] of Object.entries(dbValues)) {
    if (!(key in result)) {
      result[key] = { value, default: null, custom: true };
    }
  }

  return result;
}

// Call once after ensureSpaceRoot(). After this runs, env fallback is disabled.
export async function initRealityConfig() {
  await loadConfigFromDb();
  initialized = true;
  log.verbose("Reality", `Config loaded from ./config space (${Object.keys(configCache).length} keys)`);
}

// For when another process modifies ./config directly (migration, manual repair).
export async function reloadRealityConfig() {
  await loadConfigFromDb();
  log.info("Reality", `Config reloaded from ./config space (${Object.keys(configCache).length} keys)`);
}

// ─────────────────────────────────────────────────────────────────────
// DO operations: set-config / delete-config
// ─────────────────────────────────────────────────────────────────────
//
// Reads route through `ibp:see` on `<reality>/./config` (returns the
// cached snapshot); writes route through the two ops below which wrap
// setRealityConfigValue / deleteRealityConfigValue. The wrappers
// handle cache invalidation, validation, and the PROTECTED_KEYS gate
// (seedVersion and disabledExtensions can only be written from
// scaffold flows).
//
// `skipAudit: true` because the underlying helpers route their writes
// through `do.set-space` on the `./config` space and that inner set IS
// the canonical audit Fact. Without skipAudit the outer op would
// double-stamp.
//
// Self-register at module load — `seed/services.js` imports
// realityConfig.js as a side effect so the registry is populated
// before any caller dispatches.

registerOperation("set-config", {
  targets: ["space"],
  ownerExtension: "seed",
  skipAudit: true,
  args: {
    key: { type: "text", label: "Config key", required: true },
    value: { type: "json", label: "Value (JSON)", required: true },
  },
  handler: async ({ params, identity, summonCtx }) => {
    const { key, value } = params || {};
    if (!key || typeof key !== "string") {
      throw new Error("set-config: `key` is required");
    }
    if (value === undefined) {
      throw new Error(
        "set-config: `value` is required (use delete-config to remove)",
      );
    }
    // I_AM-internal flows (migrations, first-boot bootstrap, manifest
    // sync) may write PROTECTED_KEYS (seedVersion, disabledExtensions).
    // Other beings stay subject to the protected-key gate inside
    // setRealityConfigValue. `internal` used to be derived from a
    // `scaffold` ctx field; `identity.beingId === I_AM` is the same
    // signal post-retirement.
    await setRealityConfigValue(key, value, {
      internal: identity?.beingId === I_AM,
      identity,
      summonCtx,
    });
    return { key, value };
  },
});

registerOperation("delete-config", {
  targets: ["space"],
  ownerExtension: "seed",
  skipAudit: true,
  args: {
    key: { type: "text", label: "Config key", required: true },
  },
  handler: async ({ params, identity, summonCtx }) => {
    const { key } = params || {};
    if (!key || typeof key !== "string") {
      throw new Error("delete-config: `key` is required");
    }
    await deleteRealityConfigValue(key, {
      internal: identity?.beingId === I_AM,
      identity,
      summonCtx,
    });
    return { deleted: true, key };
  },
});

// ─────────────────────────────────────────────────────────────────────
// close-reality — exit the running server (graceful shutdown).
// ─────────────────────────────────────────────────────────────────────
//
// Reality-wide control: stops the Node process. Restricted to the root
// operator (the first registered human). Rather than wiring a new
// shutdown path, the handler re-raises SIGTERM to itself on a short
// delay — long enough for the DO ack to flush over the wire before
// begin.js's existing SIGTERM handler closes WS / Mongo / HTTP and calls
// process.exit. skipAudit: there's nothing to fold once the world stops,
// and the act-chain can't observe its own server's death.

registerOperation("close-reality", {
  targets: ["space"],
  ownerExtension: "seed",
  skipAudit: true,
  args: {},
  handler: async ({ identity }) => {
    const { IbpError, IBP_ERR } = await import("./ibp/protocol.js");
    const { hasHeavenAuthority } = await import("./materials/space/heavenLineage.js");
    if (!identity?.beingId) {
      throw new IbpError(IBP_ERR.UNAUTHORIZED, "close-reality requires an authenticated being.");
    }
    if (!(await hasHeavenAuthority(identity.beingId))) {
      throw new IbpError(
        IBP_ERR.FORBIDDEN,
        "Only beings with heaven authority (owner or angel role) can close the reality.",
      );
    }
    log.warn("Seed", `close-reality requested by ${identity.beingId} (heaven authority). Shutting down.`);
    // Let the ack return first; then trigger the graceful shutdown wired
    // in begin.js (SIGTERM handler closes senses + process.exit).
    setTimeout(() => {
      try {
        process.kill(process.pid, "SIGTERM");
      } catch {
        process.exit(0);
      }
    }, 250);
    return { closing: true };
  },
});
