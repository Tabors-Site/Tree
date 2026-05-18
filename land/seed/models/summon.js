// TreeOS Seed . AGPL-3.0 . https://treeos.ai
//
// Summon — the record of one being's invocation.
//
// One being processes one inbox entry through one LLM call (possibly with
// tool calls) producing one output. "Summoning" is the verb; a `Summon`
// is the record of one wake-and-act. The kernel's IBP-aligned record
// surface:
//
//   DO emits        → Did records      (what was done)
//   SUMMON arrives  → Inbox entries    (delivery queue)
//   Summoning fires → Summon records   (one being's wake)
//   Artifact writes → Artifact records (things at a position)
//
// Conversation is the graph of Summons joined by parentSummonId and
// rootSummonId. A "thread" between two beings is the set of Summons
// sharing a ibpAddress; a chain dispatch (Ruler → Planner →
// Contractor) is a tree of Summons linked by parentSummonId. The record
// itself describes one turn of attention, not a conversation.
//
// Replaces the older Chat model. Field renames: rootSummonId → rootSummonId,
// parentSummonId → parentSummonId.

import mongoose from "mongoose";
import { v4 as uuidv4 } from "uuid";

const SummonSchema = new mongoose.Schema({
  _id: {
    type: String,
    default: uuidv4,
  },

  // The "asker" being — who initiated this summoning.
  beingIn: {
    type: String,
    ref: "Being",
    required: true,
    index: true,
  },

  // The "responder" being — who is being summoned.
  beingOut: {
    type: String,
    ref: "Being",
    default: null,
    index: true,
  },

  // IBP Address — canonical sorted stance::stance identifier for the
  // conversation context this Summon belongs to. See seed/llm/ibpAddress.js.
  ibpAddress: {
    type: String,
    default: null,
    index: true,
  },

  // Session grouping (links the full chain).
  sessionId: {
    type: String,
    required: true,
    index: true,
  },

  // Chain position (order within session).
  chainIndex: {
    type: Number,
    default: 0,
  },

  // Links steps back to their root Summon (chainIndex 0).
  // Root records set this to their own _id.
  rootSummonId: {
    type: String,
    default: null,
    index: true,
  },

  // Parent Summon id — points to the Summon that DISPATCHED this one.
  // Root user turns have parentSummonId === null. Branch dispatches set
  // it to the orchestrator's root Summon id, so the renderer can show
  // "dispatched from X" and "dispatched to N branches" links and the
  // operator can walk the tree as a dispatch lineage.
  parentSummonId: {
    type: String,
    default: null,
    index: true,
  },

  // Why this Summon was created. Informational; the renderer uses it to
  // label the "dispatched from" link correctly. Values:
  //   "user", "continuation", "branch-swarm", "plan-expand", "retry".
  dispatchOrigin: {
    type: String,
    default: null,
  },

  // Start message
  startMessage: {
    content: { type: String, required: true },
    source:  { type: String, default: "user" },
    time:    { type: Date, default: Date.now, required: true },
    _id: false,
  },

  // End message from AI
  endMessage: {
    content: { type: String, default: null },
    time:    { type: Date, default: null },
    stopped: { type: Boolean, default: false },
    _id: false,
  },

  // AI Context (which mode handled this).
  // zone = bigMode (tree, home, land). mode = subMode.
  aiContext: {
    zone: { type: String, default: "home", index: true },
    mode: { type: String, default: "default" },
    _id: false,
  },

  // The role the responder was acting in for this Summon. Sourced
  // from `envelope.activeRole` when the sender specified one, else
  // from `beingOut.defaultRole`. Captures (beingOut, activeRole) per
  // summon so audit answers "what was Tabor doing here" — which
  // capacity, not just which identity. See project-identity-durable-
  // role-composable.
  activeRole: {
    type: String,
    default: null,
    index: true,
  },

  // Tree orchestrator context (only in tree mode).
  treeContext: {
    targetNodeId:   { type: String, ref: "Node" },
    targetNodeName: String,
    targetPath:     String,
    planStepIndex:  Number,
    planTotalSteps: Number,
    directive:      String,
    stepResult:     { type: String, enum: ["success", "failed", "skipped", "pending"] },
    resultDetail:   String,
    roomNodeId:     { type: String, ref: "Node", default: null },
    roomSubId:      { type: String, default: null },
    _id: false,
  },

  // LLM provider info.
  llmProvider: {
    isCustom:     { type: Boolean, default: false },
    model:        { type: String, default: null },
    connectionId: { type: String, ref: "LlmConnection", default: null },
    _id: false,
  },

  // Dids made during this summoning (audit trail of DO emissions).
  dids: [{ type: String, ref: "Did" }],

  // Tool calls made by the AI during this Summon's tool loop.
  // One trace per MCP invocation. `args` is the 2KB summary; `argsFull`
  // and `resultFull` carry full payloads up to ~1MB each for audit.
  // Capped at 50 entries per Summon by the appendToolCall write.
  toolCalls: [
    {
      tool:       { type: String, required: true },
      args:       { type: mongoose.Schema.Types.Mixed, default: null },
      argsFull:   { type: mongoose.Schema.Types.Mixed, default: null },
      resultFull: { type: String, default: null },
      truncated:  { type: Boolean, default: false },
      success:    { type: Boolean, default: true },
      error:      { type: String, default: null },
      ms:         { type: Number, default: 0 },
      at:         { type: Date, default: Date.now },
      _id: false,
    },
  ],

  // Rendered system prompt the AI received for this step.
  systemPrompt: { type: String, default: null },

  // Accumulated output of the enrichContext hook.
  enrichedContext: { type: mongoose.Schema.Types.Mixed, default: null },

  // Mode switches that happened mid-chain.
  modeHistory: [
    {
      modeKey: { type: String, required: true },
      at:      { type: Date, default: Date.now },
      reason:  { type: String, default: null },
      _id: false,
    },
  ],
});

// Query all steps in a chain.
SummonSchema.index({ sessionId: 1, chainIndex: 1 });
SummonSchema.index({ beingIn: 1, "startMessage.time": -1 });
SummonSchema.index({ beingOut: 1, "startMessage.time": -1 });
SummonSchema.index({ beingIn: 1, beingOut: 1, "startMessage.time": -1 }, { sparse: true });
// Audit query: "every time beingOut acted in activeRole, newest first."
// Indexes the same-being-different-role chains that the architecture admits.
SummonSchema.index({ beingOut: 1, activeRole: 1, "startMessage.time": -1 }, { sparse: true });
SummonSchema.index({ ibpAddress: 1, "startMessage.time": -1 }, { sparse: true });
SummonSchema.index({ "treeContext.targetNodeId": 1 }, { sparse: true });

// Retention: kernel deletes Summons older than summonRetentionDays (default 90, 0 = forever).
SummonSchema.index({ "startMessage.time": 1 });

const Summon = mongoose.model("Summon", SummonSchema, "summons");
export default Summon;
