// TreeOS Seed . AGPL-3.0 . https://treeos.ai
import mongoose from "mongoose";
import { v4 as uuidv4 } from "uuid";

const ContributionSchema = new mongoose.Schema({
  _id: { type: String, default: uuidv4 },
  userId: { type: String, ref: "User", required: true },
  nodeId: { type: String, ref: "Node" },
  wasAi: { type: Boolean, default: false },
  chatId: { type: String, ref: "Chat" },
  sessionId: { type: String, index: true },

  // Action type
  action: { type: String, required: true },

  // Date
  date: { type: Date, default: Date.now },

  // ── Core action data (protocol-level operations, only the relevant one is set) ──
  statusEdited: { type: String },
  editName: { type: { oldName: String, newName: String, _id: false } },
  editType: { type: { oldType: String, newType: String, _id: false } },
  noteAction: { type: { action: { type: String, enum: ["add", "remove", "edit"] }, noteId: { type: String, ref: "Note" }, content: String, _id: false } },
  updateChild: { type: { action: { type: String, enum: ["added", "removed"] }, childId: { type: String, ref: "Node" }, _id: false } },
  updateParent: { type: { oldParentId: { type: String, ref: "Node" }, newParentId: { type: String, ref: "Node" }, _id: false } },
  branchLifecycle: { type: { action: { type: String, enum: ["retired", "revived", "revivedAsRoot"] }, fromParentId: { type: String, ref: "Node" }, toParentId: { type: String, ref: "Node" }, _id: false } },

  // Canopy federation
  wasRemote: { type: Boolean, default: false },
  homeLand: { type: String },

  // Extension data (Mixed, any extension can attach metadata via ...rest params)
  extensionData: { type: mongoose.Schema.Types.Mixed },
});

// Query indexes for contributions
ContributionSchema.index({ userId: 1, date: -1 }); // user contribution history
ContributionSchema.index({ nodeId: 1, date: -1 }); // node contribution history
ContributionSchema.index({ chatId: 1 }, { sparse: true }); // finalizeChat: Contribution.find({ chatId })

// Retention: kernel deletes contributions older than contributionRetentionDays (default 365, 0 = forever)

const Contribution = mongoose.model("Contribution", ContributionSchema);
export default Contribution;
