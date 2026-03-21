import mongoose from "mongoose";
import { v4 as uuidv4 } from "uuid";

const BookSettingsSchema = new mongoose.Schema(
  {
    // existing flags
    latestVersionOnly: { type: Boolean, default: false },
    lastNoteOnly: { type: Boolean, default: false },
    leafNotesOnly: { type: Boolean, default: false },
    filesOnly: { type: Boolean, default: false },
    textOnly: { type: Boolean, default: false },

    // status / truth filters
    active: { type: Boolean, default: false },
    completed: { type: Boolean, default: false },
    true: { type: Boolean, default: false },

    // table of contents
    toc: { type: Boolean, default: false },
    tocDepth: { type: Number, default: 0 },
  },
  { _id: false }
);

const BookSchema = new mongoose.Schema({
  _id: { type: String, default: uuidv4 },

  nodeId: {
    type: String,
    ref: "Node",
    required: true,
    index: true,
  },

  settings: {
    type: BookSettingsSchema,
    required: true,
  },

  settingsHash: {
    type: String,
    required: true,
    index: true,
  },

  shareId: {
    type: String,
    unique: true,
    index: true,
  },

  createdBy: {
    type: String,
    ref: "User",
    default: null,
  },

  createdAt: { type: Date, default: Date.now },
});

const Book = mongoose.model("Book", BookSchema);

export default Book;
