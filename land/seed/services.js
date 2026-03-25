// seed/services.js
// Assembles the shared services bundle that extensions receive via init(core).
// Services the host land doesn't have get no-op stubs so extensions always
// have a safe interface to call.

import { hooks as hooksModule } from "./hooks.js";
import { registerMode, setDefaultMode } from "./ws/modes/registry.js";
import { registerOrchestrator, getOrchestrator } from "./orchestratorRegistry.js";
import User from "./models/user.js";
import Node from "./models/node.js";
import Contribution from "./models/contribution.js";
import Note from "./models/note.js";

import { logContribution } from "./utils.js";
import { resolveTreeAccess } from "./tree/treeAccess.js";
import { createUser, verifyPassword, generateToken, isFirstUser, findUserByUsername } from "./auth.js";

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
} from "./ws/chatTracker.js";

import {
  getClientForUser, resolveRootLlmForMode, userHasLlm,
  processMessage, switchMode, setRootId, getRootId, runChat, runPipeline,
  setCurrentNodeId, getCurrentNodeId, getCurrentMode,
  clearSession as clearConversationSession,
  resetConversation, injectContext, registerModeAssignment, registerModeTimeout, registerModeRetries,
} from "./ws/conversation.js";

import { connectToMCP, closeMCPClient, getMCPClient, MCP_SERVER_URL } from "./ws/mcp.js";
import { registerRootLlmSlot, registerUserLlmSlot } from "./llm/connections.js";
import { emitNavigate, emitToUser, registerSocketHandler, unregisterSocketHandler } from "./ws/websocket.js";
import { OrchestratorRuntime } from "./orchestrators/runtime.js";
import { acquireLock, releaseLock, isLocked } from "./orchestrators/locks.js";
import { ok, error, sendOk, sendError, ERR, WS, CASCADE, STATUS } from "./protocol.js";
import { deliverCascade } from "./tree/cascade.js";
import {
  addContributor, removeContributor,
  setOwner, removeOwner, transferOwnership,
} from "./tree/ownership.js";
import {
  getAncestorChain, snapshotAncestors,
  invalidateNode, invalidateAll, getCacheStats,
} from "./tree/ancestorCache.js";
import { checkIntegrity } from "./tree/integrityCheck.js";

// ---------------------------------------------------------------------------
// Auth strategy registry (extensions register additional auth methods)
// ---------------------------------------------------------------------------

const authStrategies = [];

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
      registerStrategy: (name, handler) => authStrategies.push({ name, handler }),
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
      registerRootLlmSlot, registerUserLlmSlot,
    },

    mcp: { connectToMCP, closeMCPClient, getMCPClient, MCP_SERVER_URL },

    websocket: hasWebsocket
      ? { emitNavigate, emitToUser, registerSocketHandler, unregisterSocketHandler }
      : NOOP_WEBSOCKET,

    orchestrator: { OrchestratorRuntime, acquireLock, releaseLock, isLocked },

    // --- Shared models (core protocol, always available) ---
    models: { User, Node, Contribution, Note },

    // --- Hook system ---
    hooks: hooksModule,
    modes: { registerMode, setDefaultMode },
    orchestrators: { register: registerOrchestrator, get: getOrchestrator },

    // --- Ownership (contributor and rootOwner mutations, chain-validated) ---
    ownership: { addContributor, removeContributor, setOwner, removeOwner, transferOwnership },

    // --- Tree infrastructure (cache, integrity) ---
    tree: { getAncestorChain, snapshotAncestors, invalidateNode, invalidateAll, getCacheStats, checkIntegrity },

    // --- Cascade (extensions call deliverCascade to propagate signals) ---
    cascade: { deliverCascade },

    // --- Response protocol (shapes, error codes, event types) ---
    protocol: { ok, error, sendOk, sendError, ERR, WS, CASCADE, STATUS },
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
