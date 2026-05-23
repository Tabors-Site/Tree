// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// Seed runtime configuration. The knobs that tune how the live
// machine operates — LLM call shape, session caches, scheduler
// backpressure, hook timeouts, fold limits, cleanup intervals.
//
// Distinct from realityConfig.js, which holds the reality's outward-
// facing identity (REALITY_NAME, realityUrl, federation directory,
// security domains). Reality config is about what the reality IS to
// the outside world; seed config is about how the apparatus runs
// internally.
//
// Both files write to the same underlying store — the .config seed
// space's qualities Map — through the storage primitives realityConfig
// owns. This file is a thin facade: its own defaults table, its own
// get/set names so callers reach the right surface at import time.

import {
  setRealityConfigValue,
  deleteRealityConfigValue,
  getRealityConfigValue,
} from "./realityConfig.js";

/**
 * Seed runtime defaults. Every knob the live machine reads. Each
 * caller falls back to this value when no override sits in
 * .config. Adding a knob means: add it here AND read it via
 * `getFactoryConfigValue(key)` at the use site.
 */
export const FACTORY_CONFIG_DEFAULTS = {
  // LLM call shape
  llmTimeout: 900,
  llmMaxRetries: 3,
  maxToolIterations: 15,
  maxConversationMessages: 30,
  toolCallTimeout: 60,
  toolResultMaxBytes: 50000,
  llmMaxConcurrent: 20,
  failoverTimeout: 15,
  maxMessageContentBytes: 32768,
  carryMessages: 4,
  llmClientCacheTtl: 300,
  maxConnectionsPerUser: 15,
  dnsLookupTimeout: 5000,

  // Conversation compression
  conversationCompression: true,
  compressionThreshold: 20,
  compressionKeep: 8,

  // Act content
  maxChatContentBytes: 100000,

  // Sessions / presence
  sessionTTL: 900,
  staleSessionTimeout: 1800,
  maxSessions: 10000,
  maxConnectionsPerIp: 20,
  maxPresences: 50000,
  maxScopedSessions: 20000,
  stalePresenceTimeout: 1800,

  // Matter limits
  matterMaxChars: 5000,
  maxMatterPerSpace: 1000,
  matterQueryLimit: 5000,
  matterSearchLimit: 500,
  maxDocumentSizeBytes: 14680064,

  // Space tree, ancestor cache, integrity
  maxChildrenPerSpace: 1000,
  maxContributorsPerSpace: 500,
  ancestorCacheTTL: 30000,
  ancestorCacheMaxEntries: 50000,
  ancestorCacheMaxDepth: 100,

  // Structural mutation locks
  spaceLockTimeoutMs: 30000,
  spaceLockWaitMs:    5000,

  // Quality namespace limits
  qualityNamespaceMaxBytes: 524288,
  qualityMaxNestingDepth:   8,

  // Hooks
  hookTimeoutMs: 5000,
  hookMaxHandlers: 100,
  hookCircuitThreshold: 5,
  hookCircuitHalfOpenMs: 300000,
  hookChainTimeoutMs: 15000,

  // Tools
  toolCircuitThreshold: 5,
  maxRegisteredTools: 500,
  maxExtensionIndexes: 20,

  // Fact queries
  factQueryLimit: 5000,

  // Scheduler backpressure
  summonInboxDepth:    100,
  summonsPerSecond:    10,
  summonMaxAgeSeconds: 3600,

  // Tree circuit breaker
  treeCircuitEnabled: false,
  maxTreeSpaces: 10000,
  maxTreeQualityBytes: 1073741824,
  maxTreeErrorRate: 100,
  circuitSpaceWeight: 0.4,
  circuitDensityWeight: 0.3,
  circuitErrorWeight: 0.3,
  circuitCheckInterval: 3600000,

  // Cleanup
  uploadCleanupInterval: 21600000,
  uploadGracePeriodMs:   3600000,
  uploadCleanupBatchSize: 1000,

  // Wire-layer tuning (socket.io)
  socketMaxBufferSize: null,
  socketPingTimeout:   null,
  socketPingInterval:  null,
  socketConnectTimeout: null,
};

/**
 * Read a seed runtime knob. Returns the .config override when set,
 * otherwise the FACTORY_CONFIG_DEFAULTS entry, otherwise null. Callers
 * that want to know whether a value came from override vs default
 * should compare against the defaults table directly.
 */
export function getFactoryConfigValue(key) {
  const stored = getRealityConfigValue(key);
  if (stored != null) return stored;
  return key in FACTORY_CONFIG_DEFAULTS ? FACTORY_CONFIG_DEFAULTS[key] : null;
}

/**
 * Write a seed runtime knob. Routes through the same underlying
 * .config-space writer realityConfig uses; both surfaces share the
 * same store.
 */
export const setFactoryConfigValue    = setRealityConfigValue;
export const deleteFactoryConfigValue = deleteRealityConfigValue;

/**
 * Every seed runtime knob with effective value, default, and
 * whether overridden. Mirrors realityConfig.getConfigWithDefaults for
 * the seed side. Used by the dashboard surface to show full state.
 */
export function getFactoryConfigWithDefaults() {
  const result = {};
  for (const [key, defaultValue] of Object.entries(FACTORY_CONFIG_DEFAULTS)) {
    const override = getRealityConfigValue(key);
    const hasOverride = override != null;
    result[key] = {
      value: hasOverride ? override : defaultValue,
      default: defaultValue,
      custom: hasOverride,
    };
  }
  return result;
}
