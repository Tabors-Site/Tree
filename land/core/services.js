// core/services.js
// Assembles the shared services bundle that extensions receive via init(core).
// Services the host land doesn't have get no-op stubs so extensions always
// have a safe interface to call.

import { hooks as hooksModule } from "./hooks.js";
import User from "../db/models/user.js";
import Node from "../db/models/node.js";
import Contribution from "../db/models/contribution.js";
import Note from "../db/models/notes.js";

import { logContribution } from "../db/utils.js";
import { resolveTreeAccess } from "./authenticate.js";

import {
  createSession, endSession, registerSession,
  touchSession, updateSessionMeta,
  onSessionChange, setActiveNavigator, clearActiveNavigator,
  getSession, getSessionsForUser,
  setSessionAbort, abortSession, clearSessionAbort,
  SESSION_TYPES, registerSessionType,
} from "../ws/sessionRegistry.js";

import {
  startAIChat, finalizeAIChat, trackChainStep,
  ensureSession as ensureAISession,
  setAiContributionContext, getAiContributionContext, clearAiContributionContext,
} from "../ws/aiChatTracker.js";

import {
  getClientForUser, resolveRootLlmForMode, userHasLlm,
  processMessage, switchMode, setRootId, getRootId,
  setCurrentNodeId, getCurrentNodeId, getCurrentMode,
  clearSession as clearConversationSession,
  resetConversation, injectContext,
} from "../ws/conversation.js";

import { connectToMCP, closeMCPClient, getMCPClient, MCP_SERVER_URL } from "../ws/mcp.js";
import { emitNavigate, emitToUser } from "../ws/websocket.js";
import { OrchestratorRuntime } from "../orchestrators/runtime.js";
import { acquireLock, releaseLock, isLocked } from "../orchestrators/locks.js";

// ---------------------------------------------------------------------------
// Auth strategy registry (extensions register additional auth methods)
// ---------------------------------------------------------------------------

const authStrategies = [];

// ---------------------------------------------------------------------------
// No-op stubs for optional services
// Extensions that declare a service as optional get these if the host land
// doesn't have the real implementation loaded.
// ---------------------------------------------------------------------------

const NOOP_ENERGY = {
  useEnergy: async () => ({ energyUsed: 0, remaining: Infinity }),
  calculateEnergyCost: () => 0,
  registerAction: () => {},
  DAILY_LIMITS: {},
  EnergyError: class extends Error { constructor(m) { super(m); this.name = "EnergyError"; } },
};

const NOOP_CONTRIBUTIONS = {
  logContribution: async () => null,
};

const NOOP_WEBSOCKET = {
  emitNavigate: () => {},
  emitToUser: () => {},
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
  // Determine what's available on this land
  const hasEnergy = loadedExtensions.has("energy");
  const hasWebsocket = typeof emitNavigate === "function";

  let energyService = NOOP_ENERGY;
  if (hasEnergy) {
    // Energy extension will register itself and replace this
    // via core.energy = realEnergyService in its init()
    energyService = NOOP_ENERGY;
  }

  const core = {
    // --- Optional services (no-op stubs if not available) ---
    energy: energyService,

    // --- Always-available services ---
    contributions: { logContribution },
    auth: {
      resolveTreeAccess,
      registerStrategy: (name, handler) => authStrategies.push({ name, handler }),
      getStrategies: () => authStrategies,
    },

    session: {
      createSession, endSession, registerSession,
      touchSession, updateSessionMeta,
      onSessionChange, setActiveNavigator, clearActiveNavigator,
      getSession, getSessionsForUser,
      setSessionAbort, abortSession, clearSessionAbort,
      SESSION_TYPES, registerSessionType,
    },

    aiChat: {
      startAIChat, finalizeAIChat, trackChainStep,
      ensureSession: ensureAISession,
      setAiContributionContext, getAiContributionContext, clearAiContributionContext,
    },

    llm: {
      getClientForUser, resolveRootLlmForMode, userHasLlm,
      processMessage, switchMode, setRootId, getRootId,
      setCurrentNodeId, getCurrentNodeId, getCurrentMode,
      clearSession: clearConversationSession,
      resetConversation, injectContext,
    },

    mcp: { connectToMCP, closeMCPClient, getMCPClient, MCP_SERVER_URL },

    websocket: hasWebsocket
      ? { emitNavigate, emitToUser }
      : NOOP_WEBSOCKET,

    orchestrator: { OrchestratorRuntime, acquireLock, releaseLock, isLocked },

    // --- Shared models (core protocol, always available) ---
    models: { User, Node, Contribution, Note },

    // --- Middleware ---
    middleware: { resolveTreeAccess },

    // --- Hook system ---
    hooks: hooksModule,
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

export { NOOP_ENERGY, NOOP_CONTRIBUTIONS, NOOP_WEBSOCKET, authStrategies };
