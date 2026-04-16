/**
 * AiCapture — one document per LLM call, capturing everything the AI
 * saw and did during that call. Augments Chat (seed model) via the
 * `chatId` FK — Chat stays a lean summary, AiCapture holds the full
 * forensic detail.
 *
 * Fields:
 *   - chatId / sessionId / userId / rootId / nodeId / mode — correlation
 *   - promptMessages[] — exactly what the AI was handed as its system
 *     prompt + conversation history, truncated per-message at 16KB and
 *     total at 128KB
 *   - responseText — the raw LLM response including any markers
 *   - toolCalls[] — per-tool forensic: name, args, result, error,
 *     signals that fired during or right after the tool
 *   - branchEvents[] — swarm branch status transitions during this call
 *   - startedAt / endedAt / abortReason / stopped
 *
 * One capture = one LLM call = one chat step. The renderer queries
 * `AiCapture.findOne({ chatId })` per step to inline the detail into
 * the session dashboard.
 *
 * Not registered as a `provides.models` entry because the extension
 * loader only uses `needs.models`/`optional.models` as a resolution
 * gate for other extensions; treeos-base imports and uses this model
 * directly without needing a dependency declaration.
 */

import mongoose from "mongoose";
import { v4 as uuidv4 } from "uuid";

// Soft limits applied at write time. Aggressive truncation prevents
// bloat while preserving the signal that truncation happened so the
// UI can show a badge.
export const CAPTURE_LIMITS = Object.freeze({
  PER_MESSAGE_BYTES: 16 * 1024,
  PROMPT_TOTAL_BYTES: 128 * 1024,
  TOOL_ARGS_BYTES: 16 * 1024,
  TOOL_RESULT_BYTES: 16 * 1024,
  RESPONSE_BYTES: 32 * 1024,
});

const PromptMessageSchema = new mongoose.Schema(
  {
    role: { type: String, required: true },
    content: { type: String, default: "" },
    name: { type: String, default: null },
    tool_call_id: { type: String, default: null },
    // OpenAI-shaped tool_calls array on assistant messages. Mixed so we
    // can store whatever the upstream sends without schema drift.
    tool_calls: { type: mongoose.Schema.Types.Mixed, default: null },
    truncated: { type: Boolean, default: false },
  },
  { _id: false },
);

const ToolCallSignalSchema = new mongoose.Schema(
  {
    kind: { type: String, required: true },
    filePath: { type: String, default: null },
    summary: { type: String, default: "" },
    payload: { type: mongoose.Schema.Types.Mixed, default: null },
    at: { type: Date, default: Date.now },
  },
  { _id: false },
);

const ToolCallSchema = new mongoose.Schema(
  {
    tool: { type: String, required: true },
    args: { type: mongoose.Schema.Types.Mixed, default: null },
    argsTruncated: { type: Boolean, default: false },
    result: { type: String, default: "" },
    resultTruncated: { type: Boolean, default: false },
    success: { type: Boolean, default: null },
    error: { type: String, default: null },
    ms: { type: Number, default: 0 },
    startedAt: { type: Date, default: Date.now },
    endedAt: { type: Date, default: null },
    signals: { type: [ToolCallSignalSchema], default: [] },
  },
  { _id: false },
);

const BranchEventSchema = new mongoose.Schema(
  {
    branchName: { type: String, required: true },
    from: { type: String, default: null },
    to: { type: String, required: true },
    reason: { type: String, default: null },
    at: { type: Date, default: Date.now },
  },
  { _id: false },
);

const AiCaptureSchema = new mongoose.Schema({
  _id: {
    type: String,
    default: uuidv4,
  },

  // Correlation to the Chat doc this capture augments
  chatId: { type: String, index: true, default: null },
  sessionId: { type: String, default: null },
  userId: { type: String, default: null },
  rootId: { type: String, default: null },
  nodeId: { type: String, default: null },
  mode: { type: String, default: null },

  // Timing
  startedAt: { type: Date, default: Date.now },
  endedAt: { type: Date, default: null },
  stopped: { type: Boolean, default: false },
  abortReason: { type: String, default: null },

  // The full "what the AI saw" snapshot — exactly the messages array
  // that went into beforeLLMCall's hook data right before the LLM
  // call fired.
  promptMessages: { type: [PromptMessageSchema], default: [] },
  promptBytes: { type: Number, default: 0 },
  promptTruncated: { type: Boolean, default: false },

  // The raw LLM response text (including [[DONE]], [[NO-WRITE]],
  // [[BRANCHES]] markers). Up to RESPONSE_BYTES.
  responseText: { type: String, default: "" },
  responseTruncated: { type: Boolean, default: false },
  modelUsed: { type: String, default: null },
  tokenUsage: { type: mongoose.Schema.Types.Mixed, default: null },

  // Per-tool detail — one entry per invocation inside this LLM call
  toolCalls: { type: [ToolCallSchema], default: [] },

  // Swarm branch status transitions attributed to this call
  branchEvents: { type: [BranchEventSchema], default: [] },
});

// Index for timeline queries at a specific tree position
AiCaptureSchema.index({ nodeId: 1, startedAt: -1 });
// Index for session-scoped chronological queries
AiCaptureSchema.index({ sessionId: 1, startedAt: -1 });
// Index for user-scoped queries
AiCaptureSchema.index({ userId: 1, startedAt: -1 });

export default mongoose.model("AiCapture", AiCaptureSchema);
