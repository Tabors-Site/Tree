import mongoose from "mongoose";
import { v4 as uuidv4 } from "uuid";

const CustomLlmConnectionSchema = new mongoose.Schema(
  {
    _id: {
      type: String,
      default: uuidv4,
    },

    userId: {
      type: String,
      ref: "User",
      required: true,
      index: true,
    },

    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 100,
    },

    baseUrl: {
      type: String,
      required: true,
      trim: true,
    },

    encryptedApiKey: {
      type: String,
      required: true,
    },

    model: {
      type: String,
      required: true,
      trim: true,
    },

    lastUsedAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: { createdAt: true, updatedAt: true } }
);

const CustomLlmConnection = mongoose.model(
  "CustomLlmConnection",
  CustomLlmConnectionSchema
);
export default CustomLlmConnection;
