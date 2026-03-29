import mongoose from "mongoose";

const CommentSchema = new mongoose.Schema({
  // What this comment is on
  extensionName: { type: String, required: true },
  extensionVersion: { type: String, default: null }, // null = general, specific = version-specific

  // Who wrote it (verified via CanopyToken)
  authorLandId: { type: String, required: true },
  authorDomain: { type: String, required: true },
  authorUsername: { type: String, default: "" },

  // Content
  text: { type: String, required: true, maxlength: 2000 },

  // Type: "comment" for user comments, "release" for publisher release notes
  type: { type: String, enum: ["comment", "release"], default: "comment" },

  createdAt: { type: Date, default: Date.now },
});

CommentSchema.index({ extensionName: 1, createdAt: -1 });
CommentSchema.index({ extensionName: 1, extensionVersion: 1 });
CommentSchema.index({ authorLandId: 1, extensionName: 1 });

const Comment = mongoose.model("Comment", CommentSchema);

// ── Reactions (star or flag, one per user per land per extension) ──

const ReactionSchema = new mongoose.Schema({
  extensionName: { type: String, required: true },
  // Who reacted
  authorLandId: { type: String, required: true },
  authorDomain: { type: String, required: true },
  authorUsername: { type: String, default: "" },
  // Type
  type: { type: String, enum: ["star", "flag"], required: true },

  createdAt: { type: Date, default: Date.now },
});

// One reaction per type per user per land per extension
ReactionSchema.index(
  { extensionName: 1, authorLandId: 1, authorUsername: 1, type: 1 },
  { unique: true },
);
ReactionSchema.index({ extensionName: 1, type: 1 });

const Reaction = mongoose.model("Reaction", ReactionSchema);

export default Comment;
export { Reaction };
