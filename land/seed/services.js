// TreeOS Seed . AGPL-3.0 . https://treeos.ai
// seed/services.js
// Assembles the shared services bundle that extensions receive via init(core).
// Services the host land doesn't have get no-op stubs so extensions always
// have a safe interface to call.

import log from "./log.js";
import { hooks as hooksModule } from "./hooks.js";
import { registerMode, setDefaultMode, setNodeMode } from "./modes/registry.js";
import { registerOrchestrator, getOrchestrator } from "./orchestrators/registry.js";
import User from "./models/user.js";
import Node from "./models/node.js";
import Contribution from "./models/contribution.js";
import Note from "./models/note.js";

import { logContribution } from "./tree/contributions.js";
import { resolveTreeAccess } from "./tree/treeAccess.js";
import { createUser, createFirstUser, verifyPassword, generateToken, isFirstUser, findUserByUsername } from "./auth.js";

import {
  createSession, endSession, registerSession,
  touchSession, updateSessionMeta,
  getActiveNavigator, setActiveNavigator, clearActiveNavigator,
  getSession, getSessionsForUser,
  setSessionAbort, abortSession, clearSessionAbort,
  SESSION_TYPES, registerSessionType,
} from "./ws/sessionRegistry.js";

import {
  startChat, finalizeChat, trackChainStep,
  ensureSession as ensureChatSession,
  setChatContext, getChatContext, clearChatContext,
} from "./llm/chatTracker.js";

import {
  getClientForUser, resolveRootLlmForMode, userHasLlm,
  processMessage, switchMode, setRootId, getRootId, runChat,
  setCurrentNodeId, getCurrentNodeId, getCurrentMode,
  clearSession as clearConversationSession,
  resetConversation, injectContext, registerModeAssignment, registerModeTimeout, registerModeRetries,
  registerFailoverResolver, LLM_PRIORITY,
} from "./llm/conversation.js";
import { runPipeline } from "./orchestrators/pipeline.js";

import { connectToMCP, closeMCPClient, getMCPClient, MCP_SERVER_URL } from "./ws/mcp.js";
import { registerRootLlmSlot, registerUserLlmSlot } from "./llm/connections.js";
import { emitNavigate, emitToUser, registerSocketHandler, unregisterSocketHandler, getIO } from "./ws/websocket.js";
import { OrchestratorRuntime } from "./orchestrators/runtime.js";
import { acquireLock, releaseLock, forceReleaseLock, renewLock, isLocked, getLockInfo, listLocks } from "./orchestrators/locks.js";
import { ok, error, sendOk, sendError, ERR, WS, CASCADE } from "./protocol.js";
import { getExtMeta, setExtMeta, mergeExtMeta, incExtMeta, pushExtMeta, batchSetExtMeta, unsetExtMeta } from "./tree/extensionMetadata.js";
import { getUserMeta, setUserMeta, incUserMeta, pushUserMeta, batchSetUserMeta, unsetUserMeta, addToUserMetaSet } from "./tree/userMetadata.js";
import { deliverCascade } from "./tree/cascade.js";
import { isUserRoot, getLandRootId } from "./landRoot.js";
import { createNode, createNodeBranch, deleteNodeBranch, updateParentRelationship, editNodeName, editNodeType } from "./tree/treeManagement.js";
import { createNote, editNote, deleteNoteAndFile, transferNote, getNotes } from "./tree/notes.js";
import { isExtensionBlockedAtNode, getBlockedExtensionsAtNode, isToolReadOnly, getToolOwner, getModeOwner, getModesOwnedBy } from "./tree/extensionScope.js";
import {
  addContributor, removeContributor,
  setOwner, removeOwner, transferOwnership,
} from "./tree/ownership.js";
import {
  getAncestorChain, snapshotAncestors,
  invalidateNode, invalidateAll, getCacheStats,
} from "./tree/ancestorCache.js";
import { checkIntegrity } from "./tree/integrityCheck.js";
import { checkTreeHealth, tripTree, reviveTree, isTreeAlive } from "./tree/treeCircuit.js";
import {
  acquireNodeLock, releaseNodeLock, acquireMultiple, releaseMultiple,
  isNodeLocked, getLockStats as getNodeLockStats,
} from "./tree/nodeLocks.js";

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
  emitToUser: () => {},
  registerSocketHandler: () => {},
  unregisterSocketHandler: () => {},
  getIO: () => null,
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
export function buildCoreServices({ loadedExtensions = new Map(), overrides = {} } = {}) {
  const hasWebsocket = typeof emitNavigate === "function";

  const core = {
    // --- Always-available services ---
    contributions: { logContribution },
    auth: {
      resolveTreeAccess,
      createUser, verifyPassword, generateToken, isFirstUser, findUserByUsername,
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
      getSession, getSessionsForUser,
      setSessionAbort, abortSession, clearSessionAbort,
      SESSION_TYPES, registerSessionType,
    },

    chat: {
      startChat, finalizeChat, trackChainStep,
      ensureSession: ensureChatSession,
      setChatContext, getChatContext, clearChatContext,
    },

    llm: {
      getClientForUser, resolveRootLlmForMode, userHasLlm,
      processMessage, switchMode, setRootId, getRootId, runChat, runPipeline,
      setCurrentNodeId, getCurrentNodeId, getCurrentMode,
      clearSession: clearConversationSession,
      resetConversation, injectContext, registerModeAssignment, registerModeTimeout, registerModeRetries,
      registerRootLlmSlot, registerUserLlmSlot, registerFailoverResolver,
      LLM_PRIORITY,
    },

    mcp: { connectToMCP, closeMCPClient, getMCPClient, MCP_SERVER_URL },

    websocket: hasWebsocket
      ? { emitNavigate, emitToUser, registerSocketHandler, unregisterSocketHandler, getIO }
      : NOOP_WEBSOCKET,

    orchestrator: { OrchestratorRuntime, acquireLock, releaseLock, forceReleaseLock, renewLock, isLocked, getLockInfo, listLocks },

    // --- Shared models (core protocol, always available) ---
    models: { User, Node, Contribution, Note },

    // --- Hook system ---
    hooks: hooksModule,
    modes: { registerMode, setDefaultMode, setNodeMode },
    orchestrators: { register: registerOrchestrator, get: getOrchestrator },

    // --- Ownership (contributor and rootOwner mutations, chain-validated) ---
    ownership: { addContributor, removeContributor, setOwner, removeOwner, transferOwnership },

    // --- Tree infrastructure (cache, integrity, circuit breaker, CRUD) ---
    tree: {
      getAncestorChain, snapshotAncestors, invalidateNode, invalidateAll, getCacheStats,
      checkIntegrity,
      checkTreeHealth, tripTree, reviveTree, isTreeAlive,
      createNode, createNodeBranch, deleteNodeBranch, updateParentRelationship, editNodeName, editNodeType,
      isUserRoot, getLandRootId,
    },

    // --- Notes (programmatic note CRUD) ---
    notes: { createNote, editNote, deleteNoteAndFile, transferNote, getNotes },

    // --- Node locks (structural mutation locks, tier 3 only) ---
    nodeLocks: { acquireNodeLock, releaseNodeLock, acquireMultiple, releaseMultiple, isNodeLocked, getStats: getNodeLockStats },

    // --- Metadata (namespace-enforced read/write for extension data on nodes) ---
    metadata: { getExtMeta, setExtMeta, mergeExtMeta, incExtMeta, pushExtMeta, batchSetExtMeta, unsetExtMeta },

    // --- User metadata (namespace-enforced read/write for extension data on users) ---
    userMetadata: { getUserMeta, setUserMeta, incUserMeta, pushUserMeta, batchSetUserMeta, unsetUserMeta, addToUserMetaSet },

    // --- Extension scope (check blocked/allowed status at positions) ---
    scope: { isExtensionBlockedAtNode, getBlockedExtensionsAtNode, isToolReadOnly, getToolOwner, getModeOwner, getModesOwnedBy },

    // --- Cascade (extensions call deliverCascade to propagate signals) ---
    cascade: { deliverCascade },

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

  return core;
}

export { NOOP_WEBSOCKET, authStrategies };
