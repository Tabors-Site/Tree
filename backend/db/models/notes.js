const mongoose = require("mongoose");
const { v4: uuidv4 } = require("uuid");

const NoteSchema = new mongoose.Schema({
  _id: {
    type: String,
    default: uuidv4,
  },
  contentType: {
    type: String,
    enum: ["file", "text"],
    required: true,
  },
  content: {
    type: String,
    required: true, // This will store the file link if `contentType` is "file" or text content if `contentType` is "text"
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
  version: {
    type: String,
    required: true,
  },
  isReflection: {
    type: Boolean,
    required: true,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

const Note = mongoose.model("Note", NoteSchema);
module.exports = Note;
