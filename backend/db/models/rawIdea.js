import mongoose from "mongoose";
import { v4 as uuidv4 } from "uuid";

const RawIdeaSchema = new mongoose.Schema({
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
    required: true,
  },
  userId: {
    type: String,
    ref: "User",
    required: true,
  },
  tagged: [
    {
      type: String,
      ref: "User",
    },
  ],
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

const RawIdea = mongoose.model("RawIdea", RawIdeaSchema);
export default RawIdea;
