// TreeOS Seed . AGPL-3.0 . https://treeos.ai
import log from "../log.js";
// orchestrators/runtime.js
// Shared lifecycle for background orchestrator pipelines.
// Wraps session, MCP, Chat, LLM resolution, and cleanup into a single class.

import jwt from "jsonwebtoken";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, "../..", ".env") });

if (!process.env.JWT_SECRET) throw new Error("JWT_SECRET is required. Run the setup wizard or add it to .env");
const JWT_SECRET = process.env.JWT_SECRET;

import {
  switchMode,
  processMessage,
  setRootId,
  getClientForUser,
  resolveRootLlmForMode,
  clearSession,
} from "../ws/conversation.js";
import {
  trackChainStep,
  startChat,
  finalizeChat,
  setChatContext,
  clearChatContext,
} from "../ws/chatTracker.js";
import { connectToMCP, closeMCPClient, MCP_SERVER_URL } from "../ws/mcp.js";
import {
  createSession,
  endSession,
  setSessionAbort,
  clearSessionAbort,
} from "../ws/sessionRegistry.js";
import { acquireLock, releaseLock } from "./locks.js";
import { parseJsonSafe } from "./helpers.js";

export { parseJsonSafe };

export class OrchestratorRuntime {
  /**
   * @param {Object} opts
   * @param {string} opts.rootId
   * @param {string} opts.userId
   * @param {string} opts.username
   * @param {string} opts.visitorId       - unique ID for this run
   * @param {string} opts.sessionType     - SESSION_TYPES value
   * @param {string} opts.description     - human readable session description
   * @param {string} opts.modeKeyForLlm   - mode key used to resolve LLM provider
   * @param {string} [opts.source]        - "orchestrator" | "background"
   * @param {string} [opts.slot]          - LLM slot (defaults to "main")
   * @param {string} [opts.lockNamespace] - if set, acquires lock on init
   * @param {string} [opts.lockKey]       - key for lock (defaults to rootId)
   */
  constructor({
    rootId,
    userId,
    username,
    visitorId,
    sessionType,
    description,
    modeKeyForLlm,
    source = "orchestrator",
    slot = "main",
    lockNamespace,
    lockKey,
  }) {
    this.rootId = rootId;
    this.userId = userId;
    this.username = username;
    this.visitorId = visitorId;
    this.sessionType = sessionType;
    this.description = description;
    this.modeKeyForLlm = modeKeyForLlm;
    this.source = source;
    this.slot = slot;
    this.lockNamespace = lockNamespace;
    this.lockKey = lockKey ?? rootId;

    // Set during init()
    this.sessionId = null;
    this.abort = null;
    this.mainChatId = null;
    this.llmProvider = undefined;
    this.chainIndex = 1;
    this._lockHeld = false;
    this._finalizeArgs = { content: null, stopped: true, modeKey: "complete" };
  }

  /**
   * Attach to an existing session (for real-time orchestrators or chain steps).
   * Skips session creation and Chat creation.
   * If connectMcp is true, creates its own MCP connection (for chain steps
   * that use a different visitorId than the parent).
   * cleanup() closes MCP if we opened it, otherwise no-op.
   */
  async attach({ sessionId, mainChatId, llmProvider, signal, chainIndex = 1, connectMcp = false }) {
    this.sessionId = sessionId;
    this.mainChatId = mainChatId;
    this.llmProvider = llmProvider;
    this.chainIndex = chainIndex;
    this._attached = true;
    this._ownsMcp = false;
    if (signal) {
      this.abort = { signal };
    }

    if (connectMcp) {
      const internalJwt = jwt.sign(
        { userId: this.userId, username: this.username, visitorId: this.visitorId },
        JWT_SECRET,
        { expiresIn: "1h" },
      );
      await connectToMCP(MCP_SERVER_URL, this.visitorId, internalJwt);
      setRootId(this.visitorId, this.rootId);
      if (this.mainChatId) {
        setChatContext(this.visitorId, this.sessionId, this.mainChatId);
      }
      this._ownsMcp = true;
    }

    return true;
  }

  /**
   * Initialize session, LLM, Chat, JWT, and MCP connection.
   * For background pipelines. Returns false if lock could not be acquired.
   */
  async init(startMessage) {
    // Acquire lock if configured
    if (this.lockNamespace) {
      if (!acquireLock(this.lockNamespace, this.lockKey)) {
        return false;
      }
      this._lockHeld = true;
    }

    // Session + abort
    const { sessionId } = createSession({
      userId: this.userId,
      type: this.sessionType,
      description: this.description,
      meta: { rootId: this.rootId, visitorId: this.visitorId },
    });
    this.sessionId = sessionId;
    this.abort = new AbortController();
    setSessionAbort(sessionId, this.abort);

    // LLM provider resolution
    try {
      const modeConnectionId = await resolveRootLlmForMode(this.rootId, this.modeKeyForLlm);
      const clientInfo = await getClientForUser(this.userId, this.slot, modeConnectionId);
      this.llmProvider = {
        isCustom: clientInfo.isCustom,
        model: clientInfo.model,
        connectionId: clientInfo.connectionId || null,
      };
    } catch {
      this.llmProvider = undefined;
    }

    // Chat root record
    const mainChat = await startChat({
      userId: this.userId,
      sessionId: this.sessionId,
      message: startMessage || this.description,
      source: this.source,
      modeKey: `${this.lockNamespace || "pipeline"}:start`,
      llmProvider: this.llmProvider,
    });
    this.mainChatId = mainChat._id;
    setChatContext(this.visitorId, this.sessionId, this.mainChatId);

    // MCP connection
    const internalJwt = jwt.sign(
      { userId: this.userId, username: this.username, visitorId: this.visitorId },
      JWT_SECRET,
      { expiresIn: "1h" },
    );
    await connectToMCP(MCP_SERVER_URL, this.visitorId, internalJwt);

    // Set root context
    setRootId(this.visitorId, this.rootId);

    return true;
  }

  /** Whether the abort signal has been triggered. */
  get aborted() {
    return this.abort?.signal?.aborted ?? false;
  }

  /** The AbortSignal for passing into processMessage. */
  get signal() {
    return this.abort?.signal;
  }

  /**
   * Run a single LLM step: switchMode, processMessage, trackChainStep.
   * Returns the parsed JSON result (or raw answer string if not JSON).
   */
  async runStep(modeKey, { prompt, modeCtx = {}, input, treeContext }) {
    await switchMode(this.visitorId, modeKey, {
      username: this.username,
      userId: this.userId,
      rootId: this.rootId,
      clearHistory: true,
      ...modeCtx,
    });

    const startTime = new Date();
    const result = await processMessage(this.visitorId, prompt, {
      username: this.username,
      userId: this.userId,
      rootId: this.rootId,
      signal: this.signal,
      meta: { internal: true },
    });
    const endTime = new Date();

    const internal = result?._internal || {};
    const stepLlm = internal.model ? { isCustom: internal.isCustom, model: internal.model, connectionId: internal.connectionId } : this.llmProvider;
    const parsed = parseJsonSafe(result?.content || result);

    // treeContext can be a function receiving parsed result for dynamic stepResult
    const resolvedTreeContext = typeof treeContext === "function" ? treeContext(parsed) : treeContext;

    trackChainStep({
      userId: this.userId,
      sessionId: this.sessionId,
      rootChatId: this.mainChatId,
      chainIndex: this.chainIndex++,
      modeKey,
      source: this.source,
      input: input || prompt,
      output: parsed,
      startTime,
      endTime,
      llmProvider: stepLlm,
      ...(resolvedTreeContext ? { treeContext: resolvedTreeContext } : {}),
    });

    return { parsed, raw: result, llmProvider: stepLlm };
  }

  /**
   * Track a completed step without running processMessage.
   * For orchestrators that call processMessage themselves but want chain tracking.
   */
  trackStep(modeKey, { input, output, startTime, endTime, llmProvider: stepLlm, treeContext }) {
    const resolvedTreeContext = typeof treeContext === "function" ? treeContext(output) : treeContext;
    trackChainStep({
      userId: this.userId,
      sessionId: this.sessionId,
      rootChatId: this.mainChatId,
      chainIndex: this.chainIndex++,
      modeKey,
      source: this.source,
      input,
      output,
      startTime,
      endTime,
      llmProvider: stepLlm || this.llmProvider,
      ...(resolvedTreeContext ? { treeContext: resolvedTreeContext } : {}),
    });
  }

  /**
   * Set the final result that will be passed to finalizeChat on cleanup.
   */
  setResult(content, modeKey) {
    this._finalizeArgs = { content, stopped: false, modeKey };
  }

  /**
   * Mark as stopped (error or abort).
   */
  setError(message, modeKey) {
    this._finalizeArgs = { content: message, stopped: this.aborted, modeKey };
  }

  /**
   * Tear down everything: finalize Chat, end session, close MCP, release lock.
   * Call this in a finally block. No-op in attached mode (caller owns lifecycle).
   */
  async cleanup() {
    if (this._attached && !this._ownsMcp) return;
    if (this._attached && this._ownsMcp) {
      clearChatContext(this.visitorId);
      closeMCPClient(this.visitorId);
      return;
    }
    if (this.mainChatId) {
      await finalizeChat({ chatId: this.mainChatId, ...this._finalizeArgs }).catch((e) =>
        log.error("Orchestrator", `Failed to finalize pipeline chat:`, e.message),
      );
    }
    clearChatContext(this.visitorId);
    if (this.sessionId) {
      clearSessionAbort(this.sessionId);
      endSession(this.sessionId);
    }
    closeMCPClient(this.visitorId);
    clearSession(this.visitorId);
    if (this._lockHeld && this.lockNamespace) {
      releaseLock(this.lockNamespace, this.lockKey);
    }
  }
}
