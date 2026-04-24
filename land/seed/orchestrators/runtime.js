// TreeOS Seed . AGPL-3.0 . https://treeos.ai
// orchestrators/runtime.js
// Shared lifecycle for background orchestrator pipelines.
// Wraps session, MCP, Chat, LLM resolution, lock, and cleanup into a single class.
// Every background extension pipeline uses this.

import log from "../log.js";
import jwt from "jsonwebtoken";
import { randomUUID } from "node:crypto";

if (!process.env.JWT_SECRET) throw new Error("JWT_SECRET is required");
const JWT_SECRET = process.env.JWT_SECRET;

import {
  switchMode, processMessage, setRootId, getClientForUser,
  resolveRootLlmForMode, clearSession, LLM_PRIORITY,
} from "../llm/conversation.js";

export { LLM_PRIORITY };
import {
  trackChainStep, startChat, startChainStep, finalizeChat,
  setChatContext, clearChatContext,
} from "../llm/chatTracker.js";
import { connectToMCP, closeMCPClient, MCP_SERVER_URL } from "../ws/mcp.js";
import {
  createSession, endSession, getSession, setSessionAbort, clearSessionAbort,
} from "../ws/sessionRegistry.js";
import { acquireLock, releaseLock, renewLock } from "./locks.js";
import { parseJsonSafe } from "./helpers.js";
import { resolveInternalAiSessionKey } from "../llm/sessionKeys.js";

export { parseJsonSafe };

import { getLandConfigValue } from "../landConfig.js";

function MAX_CHAIN_STEPS() { return Math.max(10, Math.min(Number(getLandConfigValue("maxChainSteps")) || 500, 5000)); }

// Configurable via land config, read at use time
function initTimeoutMs() { return Number(getLandConfigValue("orchestratorInitTimeout")) || 30000; }
function mcpConnectRetries() { return Math.max(0, Math.min(Number(getLandConfigValue("mcpConnectRetries")) || 2, 10)); }

export class OrchestratorRuntime {
  constructor({
    rootId, userId, username, sessionType, description,
    modeKeyForLlm, source = "orchestrator", slot = "main",
    lockNamespace, lockKey, llmPriority,

    // Session identity — three ways to specify, in priority order:
    //   1. `aiSessionKey` — explicit pass-through (attaching to an existing
    //      session, typically the user's live orchestrator chain).
    //   2. `scope` + `purpose` (+ optional `extra`) — declare a named
    //      internal lane. Mirrors runChat's resolver.
    //   3. Neither — generate `ephemeral:${uuid}` for one-shot pipelines
    //      that don't need cross-run chat memory.
    aiSessionKey = null,
    scope = null,
    purpose = null,
    extra = null,
  }) {
    if (!userId) throw new Error("OrchestratorRuntime requires userId");

    // ── Build the ai-chat session key ─────────────────────────────────
    // Shares the resolver with runChat so pipelines and one-shot LLM
    // calls produce identically-shaped keys for the same intent.
    const { key: resolvedKey } = resolveInternalAiSessionKey({
      aiSessionKey, scope, purpose, extra, userId, rootId,
      makeEphemeral: randomUUID,
    });

    this.rootId = rootId;
    this.userId = userId;
    this.username = username || "system";
    this.visitorId = resolvedKey;
    this.sessionType = sessionType;
    this.description = description || "Pipeline run";
    this.modeKeyForLlm = modeKeyForLlm;
    this.source = source;
    this.slot = slot;
    this.lockNamespace = lockNamespace;
    this.lockKey = lockKey ?? rootId;
    this.llmPriority = llmPriority || null;

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
    if (this.chainIndex > MAX_CHAIN_STEPS()) {
      throw new Error(`Pipeline exceeded ${MAX_CHAIN_STEPS()} steps. Possible runaway loop.`);
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
      llmPriority: this.llmPriority,
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

    // What we record for the chain step. parseJsonSafe returns null for
    // plain-text answers (e.g., summarize prompts that explicitly ask for
    // prose). Fall back to raw content so the Chat record gets an end
    // message — otherwise the step shows "pending" forever in the UI
    // even though the LLM completed successfully.
    const trackedOutput = parsed ?? result?.content ?? result?.answer ?? null;

    trackChainStep({
      userId: this.userId,
      sessionId: this.sessionId,
      rootChatId: this.mainChatId,
      chainIndex: this.chainIndex++,
      modeKey,
      source: this.source,
      input: input || prompt,
      output: trackedOutput,
      startTime,
      endTime,
      llmProvider: stepLlm,
      ...(resolvedTreeContext ? { treeContext: resolvedTreeContext } : {}),
    });

    return { parsed, raw: result, llmProvider: stepLlm };
  }

  /**
   * Open a live chain step Chat record BEFORE running the LLM work.
   *
   * Use this when you need the chatId up front so you can swap the
   * active chat context (so tool calls made during processMessage
   * land on this step's record, not the root). Contrast with
   * trackStep() which is fire-and-forget after the fact.
   *
   * Returns { chatId, chainIndex } or null if cleanup already ran or
   * the chain-step circuit breaker tripped.
   *
   *   const step = await rt.beginChainStep("tree:code-plan", promptText, { treeContext });
   *   if (step) setChatContext(visitorId, rt.sessionId, step.chatId);
   *   await processMessage(...);                           // tool calls land on step.chatId
   *   await rt.finishChainStep(step.chatId, { output: result.content });
   */
  async beginChainStep(modeKey, input, {
    treeContext,
    llmProvider: stepLlm,
    parentChatId = null,
    dispatchOrigin = null,
  } = {}) {
    if (this._cleaned) return null;
    if (this.chainIndex > MAX_CHAIN_STEPS()) return null;
    if (!this.sessionId || !this.userId) return null;

    const chainIndex = this.chainIndex++;
    const resolvedTreeContext = typeof treeContext === "function" ? treeContext() : treeContext;

    const chat = await startChainStep({
      userId: this.userId,
      sessionId: this.sessionId,
      rootChatId: this.mainChatId,
      chainIndex,
      modeKey,
      source: this.source,
      input: input || "",
      treeContext: resolvedTreeContext,
      llmProvider: stepLlm || this.llmProvider,
      parentChatId,
      dispatchOrigin,
    });

    if (!chat) return null;
    return { chatId: chat._id, chainIndex };
  }

  /**
   * Finalize a chain step opened via beginChainStep. Writes the OUT
   * (endMessage.content) via finalizeChat. Safe to call after cleanup
   * (the finalizeChat no-ops on a missing chatId).
   *
   * `stopped: true` marks the step as cancelled/errored in the UI so
   * failed branches get the Stopped badge.
   */
  async finishChainStep(chatId, { output, stopped = false, modeKey } = {}) {
    if (!chatId) return;
    try {
      await finalizeChat({
        chatId,
        content: typeof output === "string" ? output : (output == null ? null : JSON.stringify(output)),
        stopped: !!stopped,
        modeKey: modeKey || this.modeKeyForLlm || this.source,
      });
    } catch (err) {
      log.debug("Orchestrator", `finishChainStep(${chatId}) failed: ${err.message}`);
    }
  }

  /**
   * Track a completed step without running processMessage.
   */
  trackStep(modeKey, { input, output, startTime, endTime, llmProvider: stepLlm, treeContext }) {
    if (this._cleaned || this.chainIndex > MAX_CHAIN_STEPS()) return;
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
