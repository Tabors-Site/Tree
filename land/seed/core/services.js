// TreeOS Seed . AGPL-3.0 . https://treeos.ai
// seed/services.js
// Assembles the shared services bundle that extensions receive via init(core).
// Services the host land doesn't have get no-op stubs so extensions always
// have a safe interface to call.

import log from "./log.js";
import { hooks as hooksModule } from "./hooks.js";
// Mode registry retired 2026-05-18. Roles are the unit of behavior; the
// mode/role split was implementation drift. See [[project_role_subsumes_mode]]
// and [[project_ibp_universal_grammar]].
import { registerSeed, unregisterSeed, getSeed, listSeeds, plantSeed, unplantSeed, listPlantedAt } from "./seeds.js";
import Being from "../models/being.js";
import Node from "../models/node.js";
import Did from "../models/did.js";
import Artifact from "../models/artifact.js";

import { logDid } from "../tree/dids.js";
import { resolveTreeAccess } from "../tree/treeAccess.js";
import { createBeing, createFirstBeing, verifyPassword, generateToken, isFirstBeing, findBeingByUsername } from "./auth.js";

import {
  createSession, endSession, registerSession,
  touchSession, updateSessionMeta,
  getActiveNavigator, setActiveNavigator, clearActiveNavigator,
  getSession, getSessionsForBeing,
  setSessionAbort, abortSession, clearSessionAbort,
  SESSION_TYPES, registerSessionType,
} from "../../transports/ws/sessionRegistry.js";

import {
  startSummon, finalizeSummon,
  ensureSession as ensureChatSession,
} from "../llm/summonTracker.js";

import {
  processMessage, switchRole, runChat,
  getCurrentRole,
  registerFailoverResolver, LLM_PRIORITY,
} from "../llm/runChat.js";
import {
  getClientForBeing, resolveRootLlmForRole, beingHasLlm,
} from "../llm/llmClient.js";
import {
  setRootId, getRootId, setCurrentNodeId, getCurrentNodeId,
} from "../being/position.js";
import { connectToMCP, closeMCPClient, getMCPClient, MCP_SERVER_URL } from "../../transports/ws/mcp.js";
import { registerRootLlmSlot, registerBeingLlmSlot } from "../llm/connections.js";
import { emitNavigate, emitToBeing, registerSocketHandler, unregisterSocketHandler, getIO, getHttpServer } from "../../transports/ws/websocket.js";
import { ok, error, sendOk, sendError, ERR, WS, CASCADE } from "./protocol.js";
import { getExtMeta, readNs, setExtMeta, mergeExtMeta, incExtMeta, pushExtMeta, addToExtMetaSet, batchSetExtMeta, unsetExtMeta } from "../tree/extensionMetadata.js";
import { getBeingMeta, readBeingNs, setBeingMeta, mergeBeingMeta, incBeingMeta, pushBeingMeta, addToBeingMetaSet, batchSetBeingMeta, unsetBeingMeta } from "../tree/beingMetadata.js";
import { getArtifactMeta, readArtifactNs, setArtifactMeta, mergeArtifactMeta, incArtifactMeta, pushArtifactMeta, addToArtifactMetaSet, batchSetArtifactMeta, unsetArtifactMeta } from "../tree/artifactMetadata.js";
import { deliverCascade } from "../tree/cascade.js";
import { isBeingRoot, getLandRootId } from "../landRoot.js";
import { createNode, createNodeBranch, deleteNodeBranch, updateParentRelationship, editNodeName, editNodeType } from "../tree/treeManagement.js";
import { createArtifact, editArtifact, deleteArtifactAndFile, transferArtifact, getArtifacts } from "../tree/artifacts.js";
import { isExtensionBlockedAtNode, getBlockedExtensionsAtNode, getExtensionAtScope, isToolReadOnly, getToolOwner } from "../tree/extensionScope.js";
import {
  addContributor, removeContributor,
  setOwner, removeOwner, transferOwnership,
} from "../tree/ownership.js";
import {
  getAncestorChain, snapshotAncestors,
  invalidateNode, invalidateAll, getCacheStats,
} from "../tree/ancestorCache.js";
import { checkIntegrity } from "../tree/integrityCheck.js";
import { checkTreeHealth, tripTree, reviveTree, isTreeAlive } from "../tree/treeCircuit.js";
import {
  acquireNodeLock, releaseNodeLock, acquireMultiple, releaseMultiple,
  isNodeLocked, getLockStats as getNodeLockStats,
} from "../tree/nodeLocks.js";

// IBP substrate (sibling layer to seed/, peer of canopy/ and routes/).
// Re-exposed through core.ibp so extensions reach SUMMON/inbox/scheduler
// primitives without importing from ibp/* directly.
import { wake, abortCurrent, attachHandoff, getCurrentRootCorrelation } from "../../protocols/ibp/scheduler.js";
import { cancelByRootCorrelation as inboxCancelByRootCorrelation } from "../../protocols/ibp/inbox.js";
import { aggregate as ibpAggregate } from "../../protocols/ibp/replyAggregator.js";
import {
  subscribe as ibpSubscribe,
  unsubscribe as ibpUnsubscribe,
  unsubscribeAllForBeing as ibpUnsubscribeAllForBeing,
} from "../../protocols/ibp/subscriptions.js";
import {
  schedule as ibpSchedule,
  unschedule as ibpUnschedule,
  unscheduleAllForBeing as ibpUnscheduleAllForBeing,
  setEmitter as ibpSetScheduleEmitter,
  resetEmitter as ibpResetScheduleEmitter,
} from "../../protocols/ibp/schedule.js";
import {
  registerRole as ibpRegisterRole,
  unregisterRole as ibpUnregisterRole,
} from "../../protocols/ibp/roles/registry.js";
// Bridge-being factory retired 2026-05-18. Bridge beings were the
// stopgap that routed SUMMONs to old mode keys. With roles as the unit
// of behavior, every summonable being declares its own role spec via
// registerRole. See [[project_role_subsumes_mode]].

// The four-verb dispatcher (Phase 1: only `do` is registry-backed; the
// other three throw with a "not yet implemented" message until later
// phases). See [[project_seed_four_verbs_only]] memory for the plan.
import { doVerb, seeVerb, summonVerb, beVerb } from "./verbs.js";
// Side-effect import. Registers kernel DO operations with the
// registry on load. See seed/coreOperations.js for the current set.
import "./coreOperations.js";

// ---------------------------------------------------------------------------
// Auth strategy registry (extensions register additional auth methods)
// Extensions must declare provides.authStrategies in their manifest.
// The loader wraps registerStrategy to bind the extension name automatically.
// ---------------------------------------------------------------------------

const authStrategies = [];
const _allowedStrategyExtensions = new Set();

// ---------------------------------------------------------------------------
// No-op stubs for optional services
// Extensions that declare a service as optional get these if the host land
// doesn't have the real implementation loaded.
// ---------------------------------------------------------------------------

const NOOP_WEBSOCKET = {
  emitNavigate: () => {},
  emitToBeing: () => {},
  registerSocketHandler: () => {},
  unregisterSocketHandler: () => {},
  getIO: () => null,
  getHttpServer: () => null,
};

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

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
  const hasWebsocket = typeof emitNavigate === "function";

  const core = {
    // ────────────────────────────────────────────────────────────────
    // The four verbs (Phase 1 — Tabor 2026-05-18, [[project_seed_four_verbs_only]]).
    //
    // Long-term, these are the ONLY public surface for substrate
    // operations. Today they coexist additively with the legacy
    // per-target helpers below (core.metadata, core.tree, core.artifacts,
    // etc.). New extension code should prefer the verbs; existing
    // helpers retire wave by wave starting Phase 4.
    //
    // Only `do` is registry-backed in Phase 1. The other three throw
    // until their phases land, so the surface is reserved and callers
    // get clear errors if they try to use them early.
    // ────────────────────────────────────────────────────────────────
    see:    seeVerb,
    do:     doVerb,
    summon: summonVerb,
    be:     beVerb,

    // --- Always-available services ---
    dids: { logDid },
    auth: {
      resolveTreeAccess,
      createBeing, verifyPassword, generateToken, isFirstBeing, findBeingByUsername,
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
      processMessage, switchRole, setRootId, getRootId, runChat,
      setCurrentNodeId, getCurrentNodeId, getCurrentRole,
      registerRootLlmSlot, registerBeingLlmSlot, registerFailoverResolver,
      LLM_PRIORITY,
    },

    mcp: { connectToMCP, closeMCPClient, getMCPClient, MCP_SERVER_URL },

    websocket: hasWebsocket
      ? { emitNavigate, emitToBeing, registerSocketHandler, unregisterSocketHandler, getIO, getHttpServer }
      : NOOP_WEBSOCKET,

    // The `orchestrator` and `orchestrators` service surfaces retired
    // 2026-05-18 with the substrate-driven SUMMON model. Pipelines and
    // multi-step coordination emerge from beings reacting through
    // inboxes, not from a kernel-level pipeline runtime. See
    // [[project_tree_orchestrator_deleted]].

    // --- Shared models (core protocol, always available) ---
    models: { Being, Node, Did, Artifact },

    // --- Hook system ---
    hooks: hooksModule,

    // --- Extension seeds (scaffolded shapes a land can plant) ---
    // Extensions declare seeds via init() return { seeds: [...] } or
    // manifest.provides.seeds; the loader registers them. Operators plant
    // a seed at a node to bootstrap the extension's structure (Ruler,
    // beings, sub-domain nodes, starter artifacts). See memory
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
      getAncestorChain, snapshotAncestors, invalidateNode, invalidateAll, getCacheStats,
      checkIntegrity,
      checkTreeHealth, tripTree, reviveTree, isTreeAlive,
      createNode, createNodeBranch, deleteNodeBranch, updateParentRelationship, editNodeName, editNodeType,
      isBeingRoot, getLandRootId,
    },

    // --- Artifacts (programmatic artifact CRUD) ---
    artifacts: { createArtifact, editArtifact, deleteArtifactAndFile, transferArtifact, getArtifacts },

    // --- Node locks (structural mutation locks, tier 3 only) ---
    nodeLocks: { acquireNodeLock, releaseNodeLock, acquireMultiple, releaseMultiple, isNodeLocked, getStats: getNodeLockStats },

    // --- Node metadata (namespace-enforced read/write for extension data on nodes) ---
    metadata: { getExtMeta, readNs, setExtMeta, mergeExtMeta, incExtMeta, pushExtMeta, addToExtMetaSet, batchSetExtMeta, unsetExtMeta },

    // --- Being metadata (namespace-enforced read/write for extension data on beings) ---
    beingMetadata: { getBeingMeta, readBeingNs, setBeingMeta, mergeBeingMeta, incBeingMeta, pushBeingMeta, addToBeingMetaSet, batchSetBeingMeta, unsetBeingMeta },

    // --- Artifact metadata (namespace-enforced read/write for extension data on artifacts) ---
    artifactMetadata: { getArtifactMeta, readArtifactNs, setArtifactMeta, mergeArtifactMeta, incArtifactMeta, pushArtifactMeta, addToArtifactMetaSet, batchSetArtifactMeta, unsetArtifactMeta },

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
      // events as do-trigger SUMMONs. Slice 6a.
      subscribe:              ibpSubscribe,
      unsubscribe:            ibpUnsubscribe,
      unsubscribeAllForBeing: ibpUnsubscribeAllForBeing,
      // Scheduled-wake registry. Beings declare wake cadences; the
      // tick loop emits scheduled-wake SUMMONs on their intervals.
      // Mode 2 (code-emitter) is the default; the embodied scheduler-
      // being flavor swaps in via setScheduleEmitter. Slice 6b.
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
    protocol: { ok, error, sendOk, sendError, ERR, WS, CASCADE },
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

export { NOOP_WEBSOCKET, authStrategies };
