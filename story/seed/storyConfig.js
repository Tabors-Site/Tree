// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// story identity, remembered across reboots.
//
// What this story IS to the outside world — its name, public URL,
// federation directory, accepted MIME types, boundary security
// domains. Things the discovery payload surfaces, things a peer
// story sees when it reaches in.
//
// Config lives on the ONE 5D library reel (of:{kind:"library"}) — each setting is a config-set
// NAME-ACT (verb:"name", bodiless, signed by the acting Name; no being, out of any history; 5d.md).
// `initStoryConfig()` folds those facts back through the library reducer into a read cache. There
// is no `./config` heaven space anymore. `getStoryConfigValue(key)` / `setStoryConfigValue(key,
// value)` are the only sanctioned paths in/out for story-identity keys; boot-time defaults come
// from CONFIG_DEFAULTS + the env fallback in getStoryConfigValue (nothing is pre-seeded at genesis).
//
// Seed runtime knobs (LLM call shape, scheduler backpressure, hook timeouts, cleanup intervals —
// the apparatus's internal tuning) live in [internalConfig.js](internalConfig.js). Both files write
// to the SAME underlying store (this file owns the storage primitive); the split is conceptual —
// readers reach the right surface at import-site.

// Module-state declarations FIRST (before imports that may chain
// back into this module during their own top-level). `var` is used
// deliberately: a circular import that lands a callback into
// getStoryConfigValue mid-load would hit a TDZ ReferenceError on
// `let` here. var has no TDZ; same semantics, immune to that race.
// The chain in question:
//   ancestorCache.js (top-level scheduleCleanup) → getTTL →
//   getInternalConfigValue → getStoryConfigValue → reads cache.
// If storyConfig is mid-import when that fires, cache must be
// readable as `undefined` (treated as null), not throw.
var configCache = null;
var initialized = false;
var cachedStoryUrl = null;

import log from "./seedStory/log.js";
import { I_AM } from "./materials/being/seedBeings.js";
import { registerOperation } from "./ibp/operations.js";
// NOTE: protocol.js + identity.js are pulled in lazily inside the
// close-story handler (dynamic import), not at the top level — this
// module loads very early (see the circular-import note above) and a
// static import of the being/identity chain here risks a load-order TDZ.

// The story's public connection URL. Other realities, browsers, and the
// IBP discovery endpoint all reach me at this URL. Derived from
// STORY_DOMAIN + PORT; STORY_PUBLIC_URL overrides the whole value for
// reverse-proxy deploys where the constructed URL would be wrong.
// Port suffix only for local domains; public domains sit behind proxies.
export function getStoryUrl() {
  if (cachedStoryUrl) return cachedStoryUrl;
  if (process.env.STORY_PUBLIC_URL) {
    cachedStoryUrl = process.env.STORY_PUBLIC_URL.replace(/\/+$/, "");
    return cachedStoryUrl;
  }
  const raw = process.env.STORY_DOMAIN || "localhost";
  const domain = raw
    .replace(/^https?:\/\//, "")
    .replace(/\/+$/, "")
    .replace(/:\d+$/, "");
  const port = process.env.PORT || 80;
  const isLocal =
    domain === "localhost" ||
    domain.startsWith("localhost") ||
    domain.startsWith("127.") ||
    domain.startsWith("192.168.") ||
    domain.startsWith("10.") ||
    domain.endsWith(".lan") ||
    domain.endsWith(".local") ||
    !domain.includes(".");
  const protocol = isLocal ? "http" : "https";
  const portSuffix = isLocal && port != 80 && port != 443 ? `:${port}` : "";
  cachedStoryUrl = `${protocol}://${domain}${portSuffix}`;
  return cachedStoryUrl;
}

const PROTECTED_KEYS = new Set(["seedVersion", "disabledExtensions"]);

const CONFIG_KEY_RE = /^[a-zA-Z][a-zA-Z0-9_]{0,63}$/;
const DANGEROUS_KEYS = new Set([
  "__proto__",
  "constructor",
  "prototype",
  "toString",
  "valueOf",
  "hasOwnProperty",
]);
const MAX_VALUE_BYTES = 65536;

function validateKey(key) {
  if (typeof key !== "string") throw new Error("Config key must be a string");
  if (!CONFIG_KEY_RE.test(key))
    throw new Error(
      `Invalid config key "${key}". Must be alphanumeric + underscores, start with letter, max 64 chars.`,
    );
  if (DANGEROUS_KEYS.has(key))
    throw new Error(`Config key "${key}" is reserved`);
}

function validateValue(value) {
  if (value === undefined) return;
  try {
    const size = JSON.stringify(value).length;
    if (size > MAX_VALUE_BYTES) {
      throw new Error(
        `Config value exceeds ${MAX_VALUE_BYTES} byte limit (${size} bytes)`,
      );
    }
  } catch (e) {
    if (e.message.includes("limit")) throw e;
    throw new Error("Config value must be JSON-serializable");
  }
}

// Keys allowed to fall back to process.env before initStoryConfig() runs.
// `var` (not `const`): getStoryConfigValue reads this set, and the
// circular-import callback (see top-of-file note) may fire it before
// the const initializer runs. var hoists and accepts `undefined` on
// early reads; the `BOOT_ENV_KEYS.has` call below short-circuits via
// optional chaining for that case.
var BOOT_ENV_KEYS = new Set([
  "socketMaxBufferSize",
  "socketPingTimeout",
  "socketPingInterval",
  "socketConnectTimeout",
  "maxConnectionsPerIp",
  "STORY_NAME",
  "storyUrl",
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
    // Config lives on the ONE 5D library reel (of:{kind:"library"}) as config-set/config-delete
    // NAME-ACTS — story-level data, out of any history, no being. Replay those facts through the
    // library reducer (facts-as-projection: the fold IS the truth). No more ./config heaven space.
    const Fact = (await import("./past/fact/fact.js")).default;
    const { getStoryDomain } = await import("./ibp/address.js");
    const { initial, reduce } = await import("./materials/library/reducer.js");
    const libraryId = getStoryDomain();
    const facts = await Fact.find({
      "of.kind": "library",
      "of.id": libraryId,
      act: { $in: ["config-set", "config-delete"] },
    }).sort({ seq: 1 }).lean();

    let state = initial();
    for (const f of facts) state = reduce(state, f);

    // Strip keys that would fail validation (manual DB edits, proto pollution, lean() leaks).
    const clean = {};
    for (const [k, v] of Object.entries(state.config || {})) {
      if (DANGEROUS_KEYS.has(k)) {
        log.warn("Story", `Dangerous config key "${k}" found on the library reel. Skipped.`);
        continue;
      }
      if (k.startsWith("$") || k.startsWith("_")) continue;
      clean[k] = v;
    }
    configCache = clean;
  } catch (err) {
    log.error(
      "Story",
      `Failed to load config from the library reel: ${err.message}. Using empty config.`,
    );
    configCache = {};
  }
}

export function getStoryConfigValue(key) {
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

// A config write is a 5D NAME-ACT on the library reel — emit a config-set/config-delete fact
// (verb:"name", bodiless, signed by the acting Name) within its own withNameAct. Self-contained:
// no moment threading, no ./config space. The acting Name is the caller's identity, else the I_AM.
async function nameActConfig(act, params, identity) {
  const nameId = (identity?.nameId ?? identity?.beingId) || I_AM;
  const { withNameAct } = await import("./sprout.js");
  const { emitFact } = await import("./past/fact/facts.js");
  const { getStoryDomain } = await import("./ibp/address.js");
  const libraryId = getStoryDomain();
  await withNameAct(nameId, `config:${act}:${params.key}`, async (m) => {
    await emitFact(
      {
        verb: "name",
        act,
        through: null,
        by: nameId,
        of: { kind: "library", id: libraryId },
        params,
        actId: m.actId,
        history: "0",
      },
      m,
    );
  });
}

export async function setStoryConfigValue(key, value, { internal, identity } = {}) {
  validateKey(key);
  if (PROTECTED_KEYS.has(key) && !internal) {
    throw new Error(
      `Config key "${key}" is protected and cannot be modified manually`,
    );
  }
  validateValue(value);

  await nameActConfig("config-set", { key, value }, identity);

  if (!configCache) configCache = {};
  configCache[key] = value;
  log.verbose("Story", `Config set: ${key}`);
}

export async function deleteStoryConfigValue(key, { internal, identity } = {}) {
  validateKey(key);
  if (PROTECTED_KEYS.has(key) && !internal) {
    throw new Error(
      `Config key "${key}" is protected and cannot be deleted manually`,
    );
  }

  await nameActConfig("config-delete", { key }, identity);

  if (configCache) delete configCache[key];
  log.verbose("Story", `Config deleted: ${key}`);
}

// Place-identity defaults. What this story IS to the outside
// world. Seed runtime knobs (LLM timeout, scheduler limits, hooks,
// caches, etc.) live in [internalConfig.js](internalConfig.js).
export const CONFIG_DEFAULTS = {
  // Identity + federation
  STORY_NAME: "My Place",
  storyUrl: null,
  timezone: null,
  storyLlmConnection: null,

  // Host observation switches (seed/materials/host/). Facts stamped
  // by the http-server / websocket-pool beings; flipping one to false
  // stops stamping immediately (in-memory counters keep counting).
  hostRequestFacts: true,
  hostConnectionFacts: true,

  // Boundary security (what the story accepts at its edge)
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
  // size in the spec . the story root, being homes, and ad-hoc
  // user-created spaces all land at this size unless the caller
  // overrides. Beings' coord writes are clamped against the space's
  // size (per being.coord), so a sized space lets the portal render
  // a walkable grid and the substrate keep positions in-bounds.
  //
  // `maxSpaceSize` caps any axis on size writes (create + set-space).
  // A request to make a 10^9-cell space throws INVALID_INPUT. Keep
  // this generous . it's a sanity guard, not a budget.
  defaultSpaceSize: { x: 50, y: 50 },
  maxSpaceSize: { x: 1000, y: 1000, z: 1000 },

  // Protected (shown but not modifiable via public API)
  seedVersion: null,
  disabledExtensions: [],
};

export function getAllStoryConfig() {
  if (!configCache) return {};
  try {
    return JSON.parse(JSON.stringify(configCache));
  } catch {
    return {};
  }
}

// Every known key with its effective value, default, and whether it's
// overridden in the DB. Used by story-manager to show full state.
export function getConfigWithDefaults() {
  const dbValues = getAllStoryConfig();
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
export async function initStoryConfig() {
  await loadConfigFromDb();
  initialized = true;
  log.verbose(
    "Story",
    `Config loaded from ./config space (${Object.keys(configCache).length} keys)`,
  );
}

// For when another process modifies ./config directly (migration, manual repair).
export async function reloadStoryConfig() {
  await loadConfigFromDb();
  log.info(
    "Story",
    `Config reloaded from ./config space (${Object.keys(configCache).length} keys)`,
  );
}

// ─────────────────────────────────────────────────────────────────────
// DO operations: set-config / delete-config
// ─────────────────────────────────────────────────────────────────────
//
// Writes route through the two ops below, which wrap setStoryConfigValue /
// deleteStoryConfigValue. The helpers themselves lay the canonical Fact — a 5D NAME-ACT
// (config-set / config-delete, verb:"name", bodiless) on the library reel — and handle cache
// invalidation, validation, and the PROTECTED_KEYS gate (seedVersion / disabledExtensions are
// scaffold-only). `skipAudit: true` so the outer DO dispatch does NOT double-stamp; the helper's
// name-act IS the audit Fact. The op `targets:["space"]` is just the dispatch vehicle — config is
// no longer a space (the target is ignored; the write lands on the library reel).
//
// Self-register at module load — `seed/services.js` imports storyConfig.js as a side effect so the
// registry is populated before any caller dispatches.

registerOperation("set-config", {
  targets: ["space"],
  ownerExtension: "seed",
  skipAudit: true,
  args: {
    key: { type: "text", label: "Config key", required: true },
    value: { type: "json", label: "Value (JSON)", required: true },
  },
  handler: async ({ params, identity }) => {
    const { key, value } = params || {};
    if (!key || typeof key !== "string") {
      throw new Error("set-config: `key` is required");
    }
    if (value === undefined) {
      throw new Error(
        "set-config: `value` is required (use delete-config to remove)",
      );
    }
    // I_AM-internal flows (migrations, first-boot bootstrap, manifest sync) may write
    // PROTECTED_KEYS (seedVersion, disabledExtensions). Other beings stay subject to the
    // protected-key gate inside setStoryConfigValue.
    await setStoryConfigValue(key, value, {
      internal: identity?.beingId === I_AM,
      identity,
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
  handler: async ({ params, identity }) => {
    const { key } = params || {};
    if (!key || typeof key !== "string") {
      throw new Error("delete-config: `key` is required");
    }
    await deleteStoryConfigValue(key, {
      internal: identity?.beingId === I_AM,
      identity,
    });
    return { deleted: true, key };
  },
});

// ─────────────────────────────────────────────────────────────────────
// close-story — exit the running server (graceful shutdown).
// ─────────────────────────────────────────────────────────────────────
//
// Story-wide control: stops the Node process. Restricted to the root
// operator (the first registered human). Rather than wiring a new
// shutdown path, the handler re-raises SIGTERM to itself on a short
// delay — long enough for the DO ack to flush over the wire before
// begin.js's existing SIGTERM handler closes WS / Mongo / HTTP and calls
// process.exit. skipAudit: there's nothing to fold once the world stops,
// and the act-chain can't observe its own server's death.
//
// TODO (23.md — library-reel batch): close-story is a STORY-LEVEL lifecycle
// act. Closing the whole story halts EVERY future act across ALL its reels
// (being, matter, fact) — it is NOT close-history (which ends one branch).
// So its fact belongs on the LIBRARY reel (the out-of-history story reel,
// like config), paired with a dispatch gate that refuses acts once the
// story is closed — NOT a space-reel do-op. Grouped with config/history in
// the library-reel batch; until that lands it stays a host-control shutdown
// (the skipAudit is honest here precisely because the story-level fact has
// no home yet — a space reel is the wrong reel).

registerOperation("close-story", {
  targets: ["space"],
  ownerExtension: "seed",
  skipAudit: true,
  args: {},
  handler: async ({ identity }) => {
    const { IbpError, IBP_ERR } = await import("./ibp/protocol.js");
    const { hasHeavenAuthority } =
      await import("./materials/space/heavenLineage.js");
    if (!identity?.beingId) {
      throw new IbpError(
        IBP_ERR.UNAUTHORIZED,
        "close-story requires an authenticated being.",
      );
    }
    if (!(await hasHeavenAuthority(identity.beingId))) {
      throw new IbpError(
        IBP_ERR.FORBIDDEN,
        "Only beings with heaven authority (owner or angel able) can close the story.",
      );
    }
    log.warn(
      "Seed",
      `close-story requested by ${identity.beingId} (heaven authority). Shutting down.`,
    );
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
