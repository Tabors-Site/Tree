import log from "../core/log.js";
// orchestrators/runtime.js
// Shared lifecycle for background orchestrator pipelines.
// Wraps session, MCP, AIChat, LLM resolution, and cleanup into a single class.

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
  startAIChat,
  finalizeAIChat,
  setAiContributionContext,
  clearAiContributionContext,
} from "../ws/aiChatTracker.js";
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
   * Initialize session, LLM, AIChat, JWT, and MCP connection.
   * Returns false if lock could not be acquired.
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

    // AIChat root record
    const mainChat = await startAIChat({
      userId: this.userId,
      sessionId: this.sessionId,
      message: startMessage || this.description,
      source: this.source,
      modeKey: `${this.lockNamespace || "pipeline"}:start`,
      llmProvider: this.llmProvider,
    });
    this.mainChatId = mainChat._id;
    setAiContributionContext(this.visitorId, this.sessionId, this.mainChatId);

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
    switchMode(this.visitorId, modeKey, {
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

    const stepLlm = result?._llmProvider || this.llmProvider;
    const parsed = parseJsonSafe(result?.answer || result);

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
   * Set the final result that will be passed to finalizeAIChat on cleanup.
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
   * Tear down everything: finalize AIChat, end session, close MCP, release lock.
   * Call this in a finally block.
   */
  async cleanup() {
    if (this.mainChatId) {
      await finalizeAIChat({ chatId: this.mainChatId, ...this._finalizeArgs }).catch((e) =>
        log.error("Orchestrator", `Failed to finalize pipeline chat:`, e.message),
      );
    }
    clearAiContributionContext(this.visitorId);
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
