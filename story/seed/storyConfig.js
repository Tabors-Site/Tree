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
import { I } from "./materials/being/seedBeings.js";
import { registerOperation } from "./ibp/operations.js";
import { registerAbleWord } from "./present/word/ableWordRegistry.js";
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
    // The library reel rides history "0" (nameActConfig stamps with history:"0"); the curated
    // getFactsOnReelWhere returns it seq-ascending (matching the old .sort({ seq: 1 })), filtered
    // here to the two config acts the old `act: { $in }` selected.
    const { getFactsOnReelWhere } = await import("./past/fact/facts.js");
    const { getStoryDomain } = await import("./ibp/address.js");
    const { initial, reduce } = await import("./materials/library/reducer.js");
    const libraryId = getStoryDomain();
    const facts = getFactsOnReelWhere(
      "0",
      "library",
      libraryId,
      (f) => f.act === "config-set" || f.act === "config-delete",
    );

    let state = initial();
    for (const f of facts) state = reduce(state, f);

    // Strip keys that would fail validation (manual DB edits, proto pollution, lean() leaks).
    const clean = {};
    for (const [k, v] of Object.entries(state.config || {})) {
      if (DANGEROUS_KEYS.has(k)) {
        log.warn(
          "Story",
          `Dangerous config key "${k}" found on the library reel. Skipped.`,
        );
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
// no moment threading, no ./config space. The acting Name is the caller's identity, else the I.
async function nameActConfig(act, params, identity) {
  const nameId = (identity?.nameId ?? identity?.beingId) || I;
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

export async function setStoryConfigValue(
  key,
  value,
  { internal, identity } = {},
) {
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
// scaffold-only). The helper's name-act IS the op's fact, so each handler returns `ranAsMoments(...)`
// — the zero-skipAudit marker telling the dispatcher to stamp none of its own (NOT `skipAudit`). The
// op `targets:["space"]` is just the dispatch vehicle — config is no longer a space (the target is
// ignored; the write lands on the library reel).
//
// Self-register at module load — `seed/services.js` imports storyConfig.js as a side effect so the
// registry is populated before any caller dispatches.

// configHostEnv — the floor see-ops for set-config.word / delete-config.word (the validation +
// PROTECTED_KEYS gate) plus the post-seal `after-name-act` cache refresh. WORD-SOLE: the .word is the
// CONTROL strand; these are the genuine computes (reusing the SAME validateKey / validateValue /
// PROTECTED_KEYS the JS handler used) + the read-after-write cache hook do.js's runOpNameAct calls
// AFTER the name-act seals. A host throw is the .word's refusal.
export function configHostEnv() {
  return {
    // resolve-config-set(key, value, caller) → validate + author the config-set name-act params.
    // Throws the SAME Errors the handler threw (validateKey, value-required, PROTECTED_KEYS,
    // validateValue). The I-Am (internal — caller is the I being, falling back to ctx.identity when the
    // .word omits the arg) may write protected keys (seedVersion / disabledExtensions); others refused.
    "resolve-config-set": ({ args: [key, value, caller] }, ctx) => {
      validateKey(key);
      if (value === undefined || value === null) {
        throw new Error(
          "set-config: `value` is required (use delete-config to remove)",
        );
      }
      const internal = (caller ?? ctx?.identity?.beingId) === I;
      if (PROTECTED_KEYS.has(key) && !internal) {
        throw new Error(
          `Config key "${key}" is protected and cannot be modified manually`,
        );
      }
      validateValue(value);
      return { key, value, factParams: { key, value } };
    },
    // resolve-config-delete(key, caller) → validate + author the config-delete name-act params. The
    // I-Am may delete protected keys; others are refused. factParams carries just { key } (bodiless).
    "resolve-config-delete": ({ args: [key, caller] }, ctx) => {
      validateKey(key);
      const internal = (caller ?? ctx?.identity?.beingId) === I;
      if (PROTECTED_KEYS.has(key) && !internal) {
        throw new Error(
          `Config key "${key}" is protected and cannot be deleted manually`,
        );
      }
      return { key, factParams: { key } };
    },
    // after-name-act — the post-seal cache refresh (read-after-write). do.js's runOpNameAct calls this
    // AFTER the config name-act seals. config-set's factParams carries { key, value } → cache[key] =
    // value; config-delete carries { key } only → drop cache[key]. The library reel is the truth; this
    // keeps the in-memory read cache fresh until the next fold (initStoryConfig).
    "after-name-act": ({ args: [factParams] }) => {
      if (!factParams || typeof factParams.key !== "string") return;
      if (!configCache) configCache = {};
      if ("value" in factParams) configCache[factParams.key] = factParams.value;
      else delete configCache[factParams.key];
    },
  };
}

// Self-register the co-located world strands so resolveAbleWord("config", <op>) finds them.
registerAbleWord("config", "set-config", new URL("./set-config.word", import.meta.url));
registerAbleWord("config", "delete-config", new URL("./delete-config.word", import.meta.url));

// set-config — WORD-SOURCED, no handler. do.js's runOpWord routes it via word.factVerb:"name" to
// runOpNameAct: set-config.word validates + authors factParams {key,value}; the dispatcher lays the
// 5D config-set NAME-ACT (verb:"name") on the library reel, then runs configHostEnv's after-name-act
// cache refresh. factAction:"config-set" is the name-act's act (matching nameActConfig). The
// PROTECTED_KEYS gate + the I-internal carve-out live in resolve-config-set (host), unchanged.
registerOperation("set-config", {
  targets: ["space"],
  ownerExtension: "seed",
  factAction: "config-set",
  args: {
    key: { type: "text", label: "Config key", required: true },
    value: { type: "json", label: "Value (JSON)", required: true },
  },
  word: { noun: "library", able: "config", factVerb: "name" },
  hostEnv: configHostEnv,
});

// delete-config — WORD-SOURCED, no handler. Same name-act path; the config-delete NAME-ACT carries
// just { key }. The dropped-key cache refresh is configHostEnv's after-name-act.
registerOperation("delete-config", {
  targets: ["space"],
  ownerExtension: "seed",
  factAction: "config-delete",
  args: {
    key: { type: "text", label: "Config key", required: true },
  },
  word: { noun: "library", able: "config", factVerb: "name" },
  hostEnv: configHostEnv,
});

// ─────────────────────────────────────────────────────────────────────
// close-story — exit the running server (graceful shutdown).
// ─────────────────────────────────────────────────────────────────────
//
// Story-wide control: stops the Node process. Restricted to the root
// operator (the first registered human). Rather than wiring a new
// shutdown path, the handler re-raises SIGTERM to itself on a short
// delay — long enough for the DO ack to flush over the wire before
// begin.js's existing SIGTERM handler closes WS / HTTP and calls
// process.exit. skipAudit: there's nothing to fold once the world stops,
// and the act-chain can't observe its own server's death.
//
// close-story is a STORY-LEVEL lifecycle act: closing the whole story halts EVERY
// future act across ALL its reels (being, matter, fact) — NOT close-history (which
// ends one branch). Its fact lives on the LIBRARY reel (the out-of-history story reel,
// like config) as a 5D NAME-ACT, paired with a dispatch gate (ENGINE) that refuses
// acts once the story is closed.
//
// WORD-SOLE (Tabor's no-mirror law): NO JS handler. close-story.word VALIDATES (the heaven-authority
// gate, the floor read has-heaven-authority) + authors the name-act's `factParams` ({ closedBy });
// do.js's runOpNameAct (word.factVerb:"name") lays the 5D close-story NAME-ACT (verb:"name", bodiless)
// on the library reel — the EXACT shape the old withNameAct laid — then runs closeStoryHostEnv's
// `after-name-act`: the in-process latch (markStoryClosed) + the 250ms self-SIGTERM. The shutdown runs
// ONLY after the name-act SEALS, so a refused/unauthorized act never shuts the story down (strictly
// safer than the old handler, which gated first but still ran the shutdown inline in the same call).

// closeStoryHostEnv — the floor read (has-heaven-authority) + the post-seal shutdown (after-name-act)
// for close-story.word. has-heaven-authority wraps the SAME hasHeavenAuthority(beingId) the JS handler
// called (heaven owner OR angel able). after-name-act latches the dispatch gate + triggers the graceful
// SIGTERM, run by do.js's runOpNameAct AFTER the close-story name-act seals.
export function closeStoryHostEnv() {
  return {
    // has-heaven-authority(caller) → does the caller hold heaven authority (owner or angel able)?
    // The SAME gate the JS handler used; a `.word` `If not has-heaven-authority(caller)` refuses on false.
    "has-heaven-authority": async ({ args: [caller] }) => {
      if (!caller) return false;
      const { hasHeavenAuthority } =
        await import("./materials/space/heavenLineage.js");
      return await hasHeavenAuthority(String(caller));
    },
    // after-name-act — the post-seal shutdown. Runs ONLY after the close-story name-act seals (do.js's
    // runOpNameAct), so a refused act never reaches here. Mirrors the old handler's tail: latch the
    // dispatch gate in-process (every subsequent act refuses immediately; the library-reel fact also
    // latches a restarted server on its first act), then let the ack flush and self-SIGTERM — begin.js's
    // SIGTERM handler closes senses + process.exit. Timing/behavior identical to the old inline shutdown.
    "after-name-act": async ({ args: [factParams] }) => {
      const { markStoryClosed } = await import("./storyLifecycle.js");
      markStoryClosed();
      log.warn(
        "Seed",
        `close-story requested by ${factParams?.closedBy} (heaven authority). Shutting down.`,
      );
      setTimeout(() => {
        try {
          process.kill(process.pid, "SIGTERM");
        } catch {
          process.exit(0);
        }
      }, 250);
    },
  };
}

registerAbleWord("config", "close-story", new URL("./close-story.word", import.meta.url));

registerOperation("close-story", {
  targets: ["space"],
  ownerExtension: "seed",
  factAction: "close-story",
  args: {},
  word: { noun: "library", able: "config", factVerb: "name" },
  hostEnv: closeStoryHostEnv,
});
