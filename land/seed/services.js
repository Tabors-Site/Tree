// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
// seed/services.js
// Assembles the shared services bundle that extensions receive via init(core).
// Services the host land doesn't have get no-op stubs so extensions always
// have a safe interface to call.

import log from "./system/log.js";
import { hooks as hooksModule } from "./system/hooks.js";
// Mode registry retired 2026-05-18. Roles are the unit of behavior; the
// mode/role split was implementation drift. See [[project_role_subsumes_mode]]
// and [[project_ibp_universal_grammar]].
import { registerSeed, unregisterSeed, getSeed, listSeeds, plantSeed, unplantSeed, listPlantedAt } from "./space/seeds.js";
import Being from "./models/being.js";
import Space from "./models/space.js";
import Did from "./models/did.js";
import Matter from "./models/matter.js";

import { logDid } from "./space/dids.js";
import { resolveSpaceAccess } from "./space/spaceFetch.js";
import { createBeing, createFirstBeing, verifyPassword, generateToken, isFirstBeing, findBeingByName } from "./being/identity.js";

import {
  createSession, endSession, registerSession,
  touchSession, updateSessionMeta,
  getActiveNavigator, setActiveNavigator, clearActiveNavigator,
  getSession, getSessionsForBeing,
  setSessionAbort, abortSession, clearSessionAbort,
  SESSION_TYPES, registerSessionType,
} from "./cognition/session.js";

import {
  startSummon, finalizeSummon,
  ensureSession as ensureChatSession,
} from "./cognition/summonTracker.js";

import {
  processMessage, switchRole, runChat,
  getCurrentRole,
  registerFailoverResolver, LLM_PRIORITY,
} from "./cognition/runChat.js";
import {
  getClientForBeing, resolveRootLlmForRole, beingHasLlm,
} from "./cognition/llmClient.js";
import {
  getRootId, setCurrentSpace, getCurrentSpace,
} from "./being/position.js";
import { connectToMCP, closeMCPClient, getMCPClient, MCP_SERVER_URL } from "./cognition/mcpClient.js";
import { registerRootLlmSlot, registerBeingLlmSlot } from "./cognition/connections.js";
import { emitNavigate, emitToBeing, emitToBeingRoom, registerSocketHandler, unregisterSocketHandler, getIO, getHttpServer } from "./ibp/pushChannel.js";
import { ok, error, sendOk, sendError, ERR } from "./ibp/protocol.js";
import { CASCADE } from "./space/cascade.js";
import { getExtMeta, readNs, setExtMeta, mergeExtMeta, incExtMeta, pushExtMeta, addToExtMetaSet, batchSetExtMeta, unsetExtMeta } from "./space/extensionMetadata.js";
import { getBeingMeta, readBeingNs, setBeingMeta, mergeBeingMeta, incBeingMeta, pushBeingMeta, addToBeingMetaSet, batchSetBeingMeta, unsetBeingMeta } from "./being/beingMetadata.js";
import { getMatterMeta, readMatterNs, setMatterMeta, mergeMatterMeta, incMatterMeta, pushMatterMeta, addToMatterMetaSet, batchSetMatterMeta, unsetMatterMeta } from "./matter/matterMetadata.js";
import { deliverCascade } from "./space/cascade.js";
import { isBeingRoot, getLandRootId } from "./landRoot.js";
import { createSpace, createSpaceBranch, deleteSpaceBranch, updateParentRelationship, editSpaceName, editSpaceType } from "./space/spaceManagement.js";
import { createMatter, editMatter, deleteMatterAndFile, transferMatter, getMatters } from "./matter/matters.js";
import { isExtensionBlockedAtNode, getBlockedExtensionsAtNode, getExtensionAtScope, isToolReadOnly, getToolOwner } from "./space/extensionScope.js";
import {
  addContributor, removeContributor,
  setOwner, removeOwner, transferOwnership,
} from "./space/ownership.js";
import {
  getAncestorChain, snapshotAncestors,
  invalidateSpace, invalidateAll, getCacheStats,
} from "./space/ancestorCache.js";
import { checkIntegrity } from "./system/integrityCheck.js";
import { checkTreeHealth, tripTree, reviveTree, isTreeAlive } from "./space/spaceCircuit.js";
import {
  acquireSpaceLock, releaseSpaceLock, acquireMultiple, releaseMultiple,
  isSpaceLocked, getLockStats as getSpaceLockStats,
} from "./space/spaceLocks.js";

// IBP substrate (sibling layer to seed/, peer of canopy/ and routes/).
// Re-exposed through core.ibp so extensions reach SUMMON/inbox/scheduler
// primitives without importing from ibp/* directly.
import { wake, abortCurrent, attachHandoff, getCurrentRootCorrelation } from "./cognition/scheduler.js";
import { cancelByRootCorrelation as inboxCancelByRootCorrelation } from "./cognition/inbox.js";
import { aggregate as ibpAggregate } from "./cognition/replyAggregator.js";
import {
  subscribe as ibpSubscribe,
  unsubscribe as ibpUnsubscribe,
  unsubscribeAllForBeing as ibpUnsubscribeAllForBeing,
} from "./cognition/subscriptions.js";
import {
  schedule as ibpSchedule,
  unschedule as ibpUnschedule,
  unscheduleAllForBeing as ibpUnscheduleAllForBeing,
  setEmitter as ibpSetScheduleEmitter,
  resetEmitter as ibpResetScheduleEmitter,
} from "./cognition/wakeSchedule.js";
import {
  registerRole as ibpRegisterRole,
  unregisterRole as ibpUnregisterRole,
} from "./being/roles/registry.js";
// Bridge-being factory retired 2026-05-18. Bridge beings were the
// stopgap that routed SUMMONs to old mode keys. With roles as the unit
// of behavior, every summonable being declares its own role spec via
// registerRole. See [[project_role_subsumes_mode]].

// The four-verb dispatcher. See [[project_seed_four_verbs_only]] memory
// for the architectural commitment.
import { doVerb, seeVerb, summonVerb, beVerb } from "./ibp/verbs.js";
import { registerDescriptorDeriver, unregisterDescriptorDeriver } from "./ibp/descriptor.js";
// Side-effect import. Registers kernel DO operations with the
// registry on load. See seed/ibp/coreOperations.js for the current set.
import "./ibp/coreOperations.js";

// ---------------------------------------------------------------------------
// Auth strategy registry (extensions register additional auth methods)
// Extensions must declare provides.authStrategies in their manifest.
// The loader wraps registerStrategy to bind the extension name automatically.
// ---------------------------------------------------------------------------

const authStrategies = [];
const _allowedStrategyExtensions = new Set();

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------
//
// The push-channel proxies imported from ./pushChannel.js no-op when no
// transport has registered. The previous NOOP_WEBSOCKET fallback was
// only there to guard against an unloaded transport — that case is now
// handled inside the proxy module itself. The bundle just always
// exposes the proxy functions.

/**
 * Build the core services bundle.
 *
 * @param {object} opts
 * @param {Map}    opts.loadedExtensions  - extensions already loaded (for checking availability)
 * @param {object} opts.overrides         - replace any service with a custom implementation
 * @returns {object} the core services bundle
 */
// Last-built bundle, stashed so kernel-internal callers (e.g. the
// plant-seed DO operation) can pass `core` to a seed's scaffold without
// the caller having to thread the bundle through the dispatcher
// signature. The loader runs buildCoreServices once and the bundle
// stays stable for the process lifetime.
let _lastBuiltCore = null;
export function getCoreServices() {
  return _lastBuiltCore;
}

export function buildCoreServices({ loadedExtensions = new Map(), overrides = {} } = {}) {
  const core = {
    // ────────────────────────────────────────────────────────────────
    // The four verbs. See [[project_seed_four_verbs_only]].
    //
    // Long-term, these are the ONLY public surface for substrate
    // operations. Today they coexist additively with the legacy
    // per-target helpers below (core.metadata, core.tree, core.matters,
    // etc.). New extension code should prefer the verbs; existing
    // helpers retire as callers migrate.
    //
    // Only `do` is registry-backed today. The other three throw until
    // their handlers land, so the surface is reserved and callers get
    // clear errors if they try to use them early.
    // ────────────────────────────────────────────────────────────────
    see:    seeVerb,
    do:     doVerb,
    summon: summonVerb,
    be:     beVerb,

    // --- Always-available services ---
    dids: { logDid },
    descriptor: {
      registerDeriver:   registerDescriptorDeriver,
      unregisterDeriver: unregisterDescriptorDeriver,
    },
    auth: {
      resolveSpaceAccess,
      createBeing, verifyPassword, generateToken, isFirstBeing, findBeingByName,
      registerStrategy: (name, handler, extName = "unknown") => {
        if (!_allowedStrategyExtensions.has(extName)) {
          log.warn("Auth", `Strategy "${name}" from "${extName}" rejected: extension must declare provides.authStrategies in manifest`);
          return false;
        }
        authStrategies.push({ name, handler, extName });
        log.verbose("Auth", `Strategy "${name}" registered by "${extName}"`);
        return true;
      },
      allowStrategyExtension: (extName) => _allowedStrategyExtensions.add(extName),
      getStrategies: () => authStrategies,
    },

    session: {
      createSession, endSession, registerSession,
      touchSession, updateSessionMeta,
      getActiveNavigator, setActiveNavigator, clearActiveNavigator,
      getSession, getSessionsForBeing,
      setSessionAbort, abortSession, clearSessionAbort,
      SESSION_TYPES, registerSessionType,
    },

    summon: {
      startSummon, finalizeSummon,
      ensureSession: ensureChatSession,
    },

    llm: {
      getClientForBeing, resolveRootLlmForRole, beingHasLlm,
      processMessage, switchRole, getRootId, runChat,
      setCurrentSpace, getCurrentSpace, getCurrentRole,
      registerRootLlmSlot, registerBeingLlmSlot, registerFailoverResolver,
      LLM_PRIORITY,
    },

    mcp: { connectToMCP, closeMCPClient, getMCPClient, MCP_SERVER_URL },

    // Push channel — proxies from seed/ibp/pushChannel.js that route to
    // the registered transport (today: WebSocket via initWebSocketServer).
    // No-op when no transport has registered. Named `websocket` for
    // back-compat with extension callers; the channel itself is
    // transport-agnostic.
    websocket: { emitNavigate, emitToBeing, emitToBeingRoom, registerSocketHandler, unregisterSocketHandler, getIO, getHttpServer },

    // The `orchestrator` and `orchestrators` service surfaces retired
    // 2026-05-18 with the substrate-driven SUMMON model. Pipelines and
    // multi-step coordination emerge from beings reacting through
    // inboxes, not from a kernel-level pipeline runtime. See
    // [[project_tree_orchestrator_deleted]].

    // --- Shared models (core protocol, always available) ---
    models: { Being, Space, Did, Matter },

    // --- Hook system ---
    hooks: hooksModule,

    // --- Extension seeds (scaffolded shapes a land can plant) ---
    // Extensions declare seeds via init() return { seeds: [...] } or
    // manifest.provides.seeds; the loader registers them. Operators plant
    // a seed at a node to bootstrap the extension's structure (Ruler,
    // beings, sub-domain nodes, starter matter). See memory
    // `extension-seeds`.
    seeds: {
      register: registerSeed,
      unregister: unregisterSeed,
      get: getSeed,
      list: listSeeds,
      plant: plantSeed,
      unplant: unplantSeed,
      listPlantedAt,
    },

    // --- Ownership (contributor and rootOwner mutations, chain-validated) ---
    ownership: { addContributor, removeContributor, setOwner, removeOwner, transferOwnership },

    // --- Tree infrastructure (cache, integrity, circuit breaker, CRUD) ---
    tree: {
      getAncestorChain, snapshotAncestors, invalidateSpace, invalidateAll, getCacheStats,
      checkIntegrity,
      checkTreeHealth, tripTree, reviveTree, isTreeAlive,
      createSpace, createSpaceBranch, deleteSpaceBranch, updateParentRelationship, editSpaceName, editSpaceType,
      isBeingRoot, getLandRootId,
    },

    // --- Matter (programmatic matter CRUD) ---
    matters: { createMatter, editMatter, deleteMatterAndFile, transferMatter, getMatters },

    // --- Space locks (structural mutation locks, tier 3 only) ---
    spaceLocks: { acquireSpaceLock, releaseSpaceLock, acquireMultiple, releaseMultiple, isSpaceLocked, getStats: getSpaceLockStats },

    // --- Space metadata (namespace-enforced read/write for extension data on nodes) ---
    metadata: { getExtMeta, readNs, setExtMeta, mergeExtMeta, incExtMeta, pushExtMeta, addToExtMetaSet, batchSetExtMeta, unsetExtMeta },

    // --- Being metadata (namespace-enforced read/write for extension data on beings) ---
    beingMetadata: { getBeingMeta, readBeingNs, setBeingMeta, mergeBeingMeta, incBeingMeta, pushBeingMeta, addToBeingMetaSet, batchSetBeingMeta, unsetBeingMeta },

    // --- Matter metadata (namespace-enforced read/write for extension data on matter) ---
    matterMetadata: { getMatterMeta, readMatterNs, setMatterMeta, mergeMatterMeta, incMatterMeta, pushMatterMeta, addToMatterMetaSet, batchSetMatterMeta, unsetMatterMeta },

    // --- Extension scope (check blocked/allowed status at positions) ---
    //
    // getExtensionAtScope is the principled way to reach across into
    // another extension. Returns null when the target is blocked at
    // this position, closing the "extension X's exports stay callable
    // even when X is blocked" hole. Prefer this over the legacy
    // getExtension(name) from the loader when you're already operating
    // at a known tree position.
    scope: { isExtensionBlockedAtNode, getBlockedExtensionsAtNode, getExtensionAtScope, isToolReadOnly, getToolOwner },

    // --- Cascade (extensions call deliverCascade to propagate signals) ---
    cascade: { deliverCascade },

    // --- IBP (Inter-Being Protocol) primitives extensions can wire into.
    //     Role templates (governing/Ruler, Planner, etc.) summon other
    //     beings via `wake`, cascade cancellations via `cancelByRoot...`,
    //     and wait for fanout replies via `aggregate`. The seed exposes
    //     the substrate so extensions never reach into ibp/* directly.
    ibp: {
      wake,
      abortCurrent,
      attachHandoff,
      getCurrentRootCorrelation,
      cancelByRootCorrelation: inboxCancelByRootCorrelation,
      aggregate: ibpAggregate,
      // DO-trigger subscriptions. Extensions register interest on
      // behalf of their beings; substrate hooks fan out matching
      // events as do-trigger SUMMONs.
      subscribe:              ibpSubscribe,
      unsubscribe:            ibpUnsubscribe,
      unsubscribeAllForBeing: ibpUnsubscribeAllForBeing,
      // Scheduled-wake registry. Beings declare wake cadences; the
      // tick loop emits scheduled-wake SUMMONs on their intervals.
      // Mode 2 (code-emitter) is the default; the embodied scheduler-
      // being flavor swaps in via setScheduleEmitter.
      schedule:               ibpSchedule,
      unschedule:             ibpUnschedule,
      unscheduleAllForBeing:  ibpUnscheduleAllForBeing,
      setScheduleEmitter:     ibpSetScheduleEmitter,
      resetScheduleEmitter:   ibpResetScheduleEmitter,
      // Role registry. Extensions register role specs (buildSystemPrompt,
      // toolNames, permissions, summon) directly. The being acting in
      // a role uses that spec to drive its LLM call or code cognition.
      // See [[project_ibp_universal_grammar]].
      registerRole:     ibpRegisterRole,
      unregisterRole:   ibpUnregisterRole,
    },

    // --- Response protocol (shapes, error codes, event types) ---
    protocol: { ok, error, sendOk, sendError, ERR, CASCADE },
  };

  // Apply overrides (lands can swap any service)
  for (const [key, value] of Object.entries(overrides)) {
    if (core[key] && typeof value === "object") {
      core[key] = { ...core[key], ...value };
    } else {
      core[key] = value;
    }
  }

  _lastBuiltCore = core;
  return core;
}

export { authStrategies };
