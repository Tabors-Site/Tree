// TreeOS Seed . AGPL-3.0 . https://treeos.ai
import mongoose from "mongoose";
import { v4 as uuidv4 } from "uuid";

const ChatSchema = new mongoose.Schema({
  _id: {
    type: String,
    default: uuidv4,
  },

  // -----------------------------------
  // Who owns the AI session
  // -----------------------------------
  userId: {
    type: String,
    ref: "User",
    required: true,
    index: true,
  },

  // -----------------------------------
  // Session grouping (links the full chain)
  // -----------------------------------
  sessionId: {
    type: String,
    required: true,
    index: true,
  },

  // -----------------------------------
  // Chain position (order within session)
  // -----------------------------------
  chainIndex: {
    type: Number,
    default: 0,
  },

  // -----------------------------------
  // Links steps back to their root chat (chainIndex 0)
  // Root records set this to their own _id
  // -----------------------------------
  rootChatId: {
    type: String,
    default: null,
    index: true,
  },

  // -----------------------------------
  // Dispatch lineage
  // -----------------------------------
  // Parent chat step id — points to the chat that DISPATCHED this one.
  // Root user turns have parentChatId === null. Branch dispatches set
  // it to the orchestrator's root chat step id, so the renderer can
  // show "dispatched from X" and "dispatched to N branches" links and
  // the operator can walk the tree as a dispatch lineage.
  // Optional + indexed + backward-compat (existing docs: null).
  parentChatId: {
    type: String,
    default: null,
    index: true,
  },

  // Why this chat was created. Informational; the renderer uses it to
  // label the "dispatched from" link correctly. Values:
  //   "user"         — the root turn from a human message
  //   "continuation" — a continuation step inside the same session
  //   "branch-swarm" — the start of a branch chain spawned by swarm
  //   "plan-expand"  — a step of an expanded [[PLAN]] item
  //   "retry"        — a retry of a previously-failed branch
  dispatchOrigin: {
    type: String,
    default: null,
  },

  // -----------------------------------
  // Start message
  // -----------------------------------
  startMessage: {
    content: {
      type: String,
      required: true,
    },

    // Free-form string. Callers set whatever describes the origin.
    // The kernel does not interpret this value.
    source: {
      type: String,
      default: "user",
    },

    time: {
      type: Date,
      default: Date.now,
      required: true,
    },

    _id: false,
  },

  // -----------------------------------
  // End message from AI
  // -----------------------------------
  endMessage: {
    content: {
      type: String,
      default: null,
    },
    time: {
      type: Date,
      default: null,
    },
    stopped: {
      type: Boolean,
      default: false,
    },
    _id: false,
  },

  // -----------------------------------
  // AI Context (which mode handled this)
  // -----------------------------------
  aiContext: {
    // zone = bigMode (tree, home, land). mode = subMode (navigate, edit, default).
    zone: {
      type: String,
      default: "home",
      index: true,
    },
    mode: {
      type: String,
      default: "default",
    },
    _id: false,
  },

  // -----------------------------------
  // Tree orchestrator context (only in tree mode)
  // Tracks where navigation landed and plan metadata
  // -----------------------------------
  treeContext: {
    // The node navigator resolved to for this step
    targetNodeId: {
      type: String,
      ref: "Node",
    },
    targetNodeName: String,
    targetPath: String,

    // Plan step metadata
    planStepIndex: Number,
    planTotalSteps: Number,
    directive: String,

    // Execution result
    stepResult: {
      type: String,
      enum: ["success", "failed", "skipped", "pending"],
    },
    resultDetail: String,

    // Room linkage. When a room-agent subscription dispatches through
    // runChat, the resulting chat carries the room's node id and the
    // subscription id so the per-node chats page can show a "via room
    // <name>" link and the room transcript can cross-reference the
    // chat record.
    roomNodeId: {
      type: String,
      ref: "Node",
      default: null,
    },
    roomSubId: {
      type: String,
      default: null,
    },

    _id: false,
  },

  // -----------------------------------
  // LLM provider info
  // -----------------------------------
  llmProvider: {
    isCustom: {
      type: Boolean,
      default: false,
    },
    model: {
      type: String,
      default: null,
    },
    connectionId: {
      type: String,
      ref: "LlmConnection",
      default: null,
    },
    _id: false,
  },

  // -----------------------------------
  // Contributions made during this call
  // -----------------------------------
  contributions: [
    {
      type: String,
      ref: "Contribution",
    },
  ],

  // -----------------------------------
  // Tool calls made by the AI during this chat's tool loop.
  // Each element is a short trace of one MCP tool invocation. The
  // conversation.js loop appends one entry per call (atomic $push with
  // a cap) so the chat record holds the full step-by-step of what
  // the AI did. Rendered in CLI `chats` history and the dashboard
  // chat view. Capped at 50 per chat to keep document size bounded.
  //
  // `args` holds the 2KB summary used by history listings. `argsFull`
  // and `resultFull` carry the whole payload up to ~1MB each so the
  // audit page can replay exactly what the AI saw. `truncated` flags
  // when either hit the cap.
  // -----------------------------------
  toolCalls: [
    {
      tool: { type: String, required: true },
      args: { type: mongoose.Schema.Types.Mixed, default: null },
      argsFull: { type: mongoose.Schema.Types.Mixed, default: null },
      resultFull: { type: String, default: null },
      truncated: { type: Boolean, default: false },
      success: { type: Boolean, default: true },
      error: { type: String, default: null },
      ms: { type: Number, default: 0 },
      at: { type: Date, default: Date.now },
      _id: false,
    },
  ],

  // -----------------------------------
  // The rendered system prompt the AI received for this step.
  // Captured at the start of the chat (or chain step) so the operator
  // can audit why the AI behaved the way it did. No size cap here; the
  // onDocumentPressure hook warns if a chat document crosses its cap.
  // -----------------------------------
  systemPrompt: {
    type: String,
    default: null,
  },

  // -----------------------------------
  // Accumulated output of the enrichContext hook — everything each
  // extension injected into the AI's working context before the LLM
  // call. Mixed so extensions can store their own shapes.
  // -----------------------------------
  enrichedContext: {
    type: mongoose.Schema.Types.Mixed,
    default: null,
  },

  // -----------------------------------
  // Mode switches that happened mid-chain. A single chat step usually
  // runs in one mode but the orchestrator can swap modes mid-run
  // (handoffs, nested dispatches). This log keeps the lineage so
  // auditors can see the full mode journey.
  // -----------------------------------
  modeHistory: [
    {
      modeKey: { type: String, required: true },
      at: { type: Date, default: Date.now },
      reason: { type: String, default: null },
      _id: false,
    },
  ],
});

// Query all steps in a chain
ChatSchema.index({ sessionId: 1, chainIndex: 1 });
ChatSchema.index({ userId: 1, "startMessage.time": -1 }); // user chat history queries

// Query by target node (sparse — most home-mode chats lack this field)
ChatSchema.index({ "treeContext.targetNodeId": 1 }, { sparse: true });

// Retention: kernel deletes chats older than chatRetentionDays (default 90, 0 = forever)
ChatSchema.index({ "startMessage.time": 1 });

const Chat = mongoose.model("Chat", ChatSchema, "aichats");

export default Chat;
