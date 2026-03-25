// TreeOS Seed . AGPL-3.0 . https://treeos.ai
import mongoose from "mongoose";
import bcrypt from "bcrypt";
import { v4 as uuidv4 } from "uuid";

const UserSchema = new mongoose.Schema({
  _id: { type: String, required: true, default: uuidv4 },
  username: { type: String, required: true, unique: true },
  password: { type: String, required: true, select: false },

  // Navigation (tree root list) lives in metadata.nav.roots, managed by navigation extension.

  // Core LLM connection (set during register/setup). Extension slots in metadata.
  llmDefault: { type: String, ref: "LlmConnection", default: null },

  // Admin flag (kernel auth decisions: private IP bypass, size limit bypass)
  isAdmin: {
    type: Boolean,
    default: false,
  },

  // Canopy (distributed network) fields
  isRemote: {
    type: Boolean,
    default: false,
  },
  homeLand: {
    type: String,
    default: null,
  },

  // Extension data (same pattern as Node.metadata)
  metadata: { type: Map, of: mongoose.Schema.Types.Mixed, default: new Map() },
});

// Hash password before saving
UserSchema.pre("save", async function (next) {
  if (!this.isModified("password")) return next();

  // If already a bcrypt hash, do not re-hash
  if (this.password.startsWith("$2a$") || this.password.startsWith("$2b$")) {
    return next();
  }

  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

//compare the plain password with the hashed password
UserSchema.methods.comparePassword = async function (candidatePassword) {
  return bcrypt.compare(candidatePassword, this.password);
};


// No virtuals. Extension data lives in metadata.
// Callers use getUserMeta/setUserMeta from core/tree/userMetadata.js
// or getExtMeta/setExtMeta from core/tree/extensionMetadata.js.

const User = mongoose.model("User", UserSchema);
export default User;
