// TreeOS Seed . AGPL-3.0 . https://treeos.ai
import mongoose from "mongoose";
import { v4 as uuidv4 } from "uuid";
import { CONTENT_TYPE } from "../protocol.js";

const NoteSchema = new mongoose.Schema({
  _id: {
    type: String,
    default: uuidv4,
  },
  contentType: {
    type: String,
    enum: Object.values(CONTENT_TYPE),
    required: true,
  },
  content: {
    type: String,
    required: true, // file link if contentType is "file", text content if "text"
  },
  userId: {
    type: String,
    ref: "User",
    required: true,
  },
  nodeId: {
    type: String,
    ref: "Node",
    required: true,
  },
  metadata: {
    type: Map,
    of: mongoose.Schema.Types.Mixed,
    default: () => new Map(),
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

// Extensions tag notes via metadata (prestige writes version, treeos writes isReflection).
// maxNotesPerNode (config, default 1000) checked in createNote before write.
// Retention: kernel deletes notes when their nodeId is set to DELETED (soft-delete).

const Note = mongoose.model("Note", NoteSchema);
export default Note;
