import mongoose from "mongoose";
import { v4 as uuidv4 } from "uuid";

const TempUserSchema = new mongoose.Schema({
  _id: { type: String, required: true, default: uuidv4 },

  username: {
    type: String,
    required: true,
  },

  email: {
    type: String,
    required: true,
  },

  // Stored in plaintext. Protected by verification token + 12 hour TTL + MongoDB TTL auto-delete.
  // The real bcrypt hash happens when User.create() runs the User model's pre-save hook.
  // Do NOT hash here. TempUser hashing + User hashing = double-hash = user can never log in.
  password: {
    type: String,
    required: true,
  },

  verificationToken: {
    type: String,
    required: true,
    unique: true,
  },

  expiresAt: {
    type: Date,
    required: true,
    index: { expireAfterSeconds: 0 },
  },
});

export default mongoose.model("TempUser", TempUserSchema);
