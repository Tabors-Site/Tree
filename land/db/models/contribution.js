import mongoose from "mongoose";
import { v4 as uuidv4 } from "uuid";

const ContributionSchema = new mongoose.Schema({
  _id: { type: String, default: uuidv4 },
  userId: { type: String, ref: "User", required: true },
  nodeId: { type: String, ref: "Node" },
  wasAi: { type: Boolean, default: false },
  aiChatId: { type: String, ref: "AIChat", default: null },
  sessionId: { type: String, default: null, index: true },

  // Action type. Core types are validated. Extensions can register custom types.
  action: { type: String, required: true },

  // Energy cost (if energy extension is installed)
  energyUsed: { type: Number, min: 0 },

  // Node version at time of action (prestige extension sets this via hook)
  nodeVersion: { type: String, required: true },

  // Date
  date: { type: Date, default: Date.now },

  // ── Core action data (protocol-level operations) ──

  // editStatus
  statusEdited: { type: String, enum: ["completed", "active", "trimmed", "divider"] },

  // editNameNode
  editNameNode: {
    type: { oldName: String, newName: String, _id: false },
  },

  // editType
  editType: {
    type: { oldType: String, newType: String, _id: false },
  },

  // note (add/remove/edit)
  noteAction: {
    type: {
      action: { type: String, enum: ["add", "remove", "edit"] },
      noteId: { type: String, ref: "Note" },
      content: String,
      _id: false,
    },
  },

  // updateChildNode
  updateChildNode: {
    type: {
      action: { type: String, enum: ["added", "removed"] },
      childId: { type: String, ref: "Node" },
      _id: false,
    },
  },

  // updateParent
  updateParent: {
    type: {
      oldParentId: { type: String, ref: "Node" },
      newParentId: { type: String, ref: "Node" },
      _id: false,
    },
  },

  // branchLifecycle (retire/revive)
  branchLifecycle: {
    type: {
      action: { type: String, enum: ["retired", "revived", "revivedAsRoot"] },
      fromParentId: { type: String, ref: "Node" },
      toParentId: { type: String, ref: "Node" },
      _id: false,
    },
  },

  // inviteAction
  inviteAction: {
    type: {
      action: { type: String, enum: ["invite", "acceptInvite", "denyInvite", "removeContributor", "switchOwner"] },
      receivingId: { type: String, ref: "User" },
      _id: false,
    },
  },

  // Canopy federation
  wasRemote: { type: Boolean, default: false },
  homeLand: { type: String, default: null },

  // ── Extension data (Mixed, any extension can attach metadata) ──
  // Extension-specific action data goes here instead of hardcoded fields.
  // e.g. { values: { strength: 10 }, goals: { strength: 20 } }
  // e.g. { script: { scriptId: "...", logs: [...] } }
  // e.g. { transaction: { event: "created", side: "A", ... } }
  extensionData: { type: mongoose.Schema.Types.Mixed, default: null },
});

const Contribution = mongoose.model("Contribution", ContributionSchema);
export default Contribution;
