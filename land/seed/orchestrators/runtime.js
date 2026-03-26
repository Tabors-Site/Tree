// TreeOS Seed . AGPL-3.0 . https://treeos.ai
// orchestrators/runtime.js
// Shared lifecycle for background orchestrator pipelines.
// Wraps session, MCP, Chat, LLM resolution, lock, and cleanup into a single class.
// Every background pipeline (dreams, understanding, cleanup, raw ideas) uses this.

import log from "../log.js";
import jwt from "jsonwebtoken";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);


if (!process.env.JWT_SECRET) throw new Error("JWT_SECRET is required");
const JWT_SECRET = process.env.JWT_SECRET;

import {
  switchMode, processMessage, setRootId, getClientForUser,
  resolveRootLlmForMode, clearSession,
} from "../ws/conversation.js";
import {
  trackChainStep, startChat, finalizeChat,
  setChatContext, clearChatContext,
} from "../ws/chatTracker.js";
import { connectToMCP, closeMCPClient, MCP_SERVER_URL } from "../ws/mcp.js";
import {
  createSession, endSession, getSession, setSessionAbort, clearSessionAbort,
} from "../ws/sessionRegistry.js";
import { acquireLock, releaseLock, renewLock } from "./locks.js";
import { parseJsonSafe } from "./helpers.js";

export { parseJsonSafe };

import { getLandConfigValue } from "../landConfig.js";

const MAX_CHAIN_STEPS = 500; // circuit breaker, not configurable (runaway prevention)

// Configurable via land config, read at use time
function initTimeoutMs() { return Number(getLandConfigValue("orchestratorInitTimeout")) || 30000; }
function mcpConnectRetries() { return Math.max(0, Math.min(Number(getLandConfigValue("mcpConnectRetries")) || 2, 10)); }

export class OrchestratorRuntime {
  constructor({
    rootId, userId, username, visitorId, sessionType, description,
    modeKeyForLlm, source = "orchestrator", slot = "main",
    lockNamespace, lockKey,
  }) {
    if (!userId) throw new Error("OrchestratorRuntime requires userId");
    if (!visitorId) throw new Error("OrchestratorRuntime requires visitorId");

    this.rootId = rootId;
    this.userId = userId;
    this.username = username || "system";
    this.visitorId = visitorId;
    this.sessionType = sessionType;
    this.description = description || "Pipeline run";
    this.modeKeyForLlm = modeKeyForLlm;
    this.source = source;
    this.slot = slot;
    this.lockNamespace = lockNamespace;
    this.lockKey = lockKey ?? rootId;

    this.sessionId = null;
    this.abort = null;
    this.mainChatId = null;
    this.llmProvider = undefined;
    this.chainIndex = 1;
    this._lockHeld = false;
    this._cleaned = false;
    this._attached = false;
    this._ownsMcp = false;
    this._startedAt = null;
    // Default: not finalized. cleanup() will finalize as error if setResult/setError never called.
    this._finalizeArgs = null;
  }

  // ─────────────────────────────────────────────────────────────────────
  // ATTACH (join existing session, for real-time orchestrator chain steps)
  // ─────────────────────────────────────────────────────────────────────

  async attach({ sessionId, mainChatId, llmProvider, signal, chainIndex = 1, connectMcp = false }) {
    if (!sessionId) throw new Error("attach() requires sessionId");

    // Verify session still exists
    const session = getSession(sessionId);
    if (!session) throw new Error(`attach() failed: session ${sessionId} does not exist`);

    this.sessionId = sessionId;
    this.mainChatId = mainChatId;
    this.llmProvider = llmProvider;
    this.chainIndex = chainIndex;
    this._attached = true;
    this._ownsMcp = false;
    this._startedAt = Date.now();
    if (signal) this.abort = { signal };

    if (connectMcp) {
      await this._connectMcp();
      this._ownsMcp = true;
    }

    return true;
  }

  // ─────────────────────────────────────────────────────────────────────
  // INIT (background pipelines: full lifecycle ownership)
  // ─────────────────────────────────────────────────────────────────────

  async init(startMessage) {
    // Acquire lock if configured. Pass visitorId as owner for owner-checked release.
    if (this.lockNamespace) {
      if (!acquireLock(this.lockNamespace, this.lockKey, { owner: this.visitorId, reason: this.description })) {
        return false;
      }
      this._lockHeld = true;
    }

    this._startedAt = Date.now();

    // Everything below is wrapped so partial failures trigger cleanup.
    // Timeout prevents infinite hang if MCP or DB is unreachable.
    const initWork = async () => {
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

      // MCP connection (with retry)
      await this._connectMcp();
    };

    let initTimer;
    try {
      await Promise.race([
        initWork(),
        new Promise((_, reject) => {
          const timeout = initTimeoutMs();
          initTimer = setTimeout(() => reject(new Error(`init() timed out after ${timeout}ms`)), timeout);
        }),
      ]);
      return true;
    } catch (err) {
      // Partial init failure. Clean up everything that was created.
      log.error("Orchestrator", `init() failed: ${err.message}. Cleaning up.`);
      await this.cleanup();
      throw err;
    } finally {
      clearTimeout(initTimer);
    }
  }

  get aborted() { return this.abort?.signal?.aborted ?? false; }
  get signal() { return this.abort?.signal; }
  get durationMs() { return this._startedAt ? Date.now() - this._startedAt : 0; }

  // ─────────────────────────────────────────────────────────────────────
  // RUN STEP (single LLM call within the pipeline)
  // ─────────────────────────────────────────────────────────────────────

  async runStep(modeKey, { prompt, modeCtx = {}, input, treeContext }) {
    // Guard against use after cleanup
    if (this._cleaned) throw new Error("Pipeline already cleaned up. Cannot run more steps.");

    // Abort check before starting any work
    if (this.aborted) throw new Error("Pipeline aborted");

    // Chain step circuit breaker
    if (this.chainIndex > MAX_CHAIN_STEPS) {
      throw new Error(`Pipeline exceeded ${MAX_CHAIN_STEPS} steps. Possible runaway loop.`);
    }

    // Renew lock if held (prevents TTL expiry during long pipelines)
    if (this._lockHeld && this.lockNamespace) {
      renewLock(this.lockNamespace, this.lockKey, this.visitorId);
    }

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

    // Validate result
    if (!result) {
      log.warn("Orchestrator", `runStep(${modeKey}) returned null/undefined`);
    }

    const internal = result?._internal || {};
    const stepLlm = internal.model
      ? { isCustom: internal.isCustom, model: internal.model, connectionId: internal.connectionId }
      : this.llmProvider;
    const parsed = parseJsonSafe(result?.content || result);

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
   */
  trackStep(modeKey, { input, output, startTime, endTime, llmProvider: stepLlm, treeContext }) {
    if (this._cleaned || this.chainIndex > MAX_CHAIN_STEPS) return;
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

  setResult(content, modeKey) {
    this._finalizeArgs = { content, stopped: false, modeKey };
  }

  setError(message, modeKey) {
    this._finalizeArgs = { content: message, stopped: this.aborted, modeKey };
  }

  // ─────────────────────────────────────────────────────────────────────
  // CLEANUP (idempotent, always safe to call)
  // ─────────────────────────────────────────────────────────────────────

  async cleanup() {
    if (this._cleaned) return;
    this._cleaned = true;

    // Abort any in-flight work
    if (this.abort && typeof this.abort.abort === "function" && !this.aborted) {
      try { this.abort.abort(); } catch {}
    }

    const duration = this.durationMs;

    // Attached mode: only clean up what we own
    if (this._attached) {
      if (this._ownsMcp) {
        clearChatContext(this.visitorId);
        await closeMCPClient(this.visitorId).catch(() => {});
      }
      if (duration > 0) {
        log.debug("Orchestrator", `Attached run completed in ${Math.round(duration / 1000)}s (${this.chainIndex - 1} steps)`);
      }
      return;
    }

    // Full cleanup for background pipelines
    if (this.mainChatId) {
      const args = this._finalizeArgs || { content: "Pipeline ended without result", stopped: true, modeKey: "error" };
      await finalizeChat({ chatId: this.mainChatId, ...args }).catch(e =>
        log.error("Orchestrator", `Failed to finalize pipeline chat: ${e.message}`)
      );
    }

    clearChatContext(this.visitorId);

    if (this.sessionId) {
      clearSessionAbort(this.sessionId);
      endSession(this.sessionId);
    }

    await closeMCPClient(this.visitorId).catch(() => {});
    clearSession(this.visitorId);

    if (this._lockHeld && this.lockNamespace) {
      releaseLock(this.lockNamespace, this.lockKey, this.visitorId);
      this._lockHeld = false;
    }

    if (duration > 0) {
      log.debug("Orchestrator", `Pipeline completed in ${Math.round(duration / 1000)}s (${this.chainIndex - 1} steps)`);
    }
  }

  // ─────────────────────────────────────────────────────────────────────
  // INTERNAL: MCP connection with retry
  // ─────────────────────────────────────────────────────────────────────

  async _connectMcp() {
    const internalJwt = jwt.sign(
      { userId: this.userId, username: this.username, visitorId: this.visitorId },
      JWT_SECRET,
      { expiresIn: "4h" },
    );

    for (let attempt = 0; attempt <= mcpConnectRetries(); attempt++) {
      try {
        await connectToMCP(MCP_SERVER_URL, this.visitorId, internalJwt);
        setRootId(this.visitorId, this.rootId);
        return;
      } catch (err) {
        if (attempt < mcpConnectRetries()) {
          log.warn("Orchestrator", `MCP connect failed (attempt ${attempt + 1}/${mcpConnectRetries() + 1}): ${err.message}. Retrying...`);
          await new Promise(r => setTimeout(r, 1000 * (attempt + 1))); // linear backoff
        } else {
          throw err;
        }
      }
    }
  }
}
