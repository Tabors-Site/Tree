import mongoose from "mongoose";
import bcrypt from "bcrypt";
import crypto from "crypto";

import { v4 as uuidv4 } from "uuid";
function generateHtmlShareToken() {
  return crypto.randomBytes(16).toString("base64url"); // URL-safe
}

const RecentRootSchema = new mongoose.Schema(
  {
    rootId: {
      type: String,
      required: true,
      ref: "Node",
    },

    rootName: {
      type: String,
      required: true,
      trim: true,
    },

    lastVisitedAt: {
      type: Date,
      default: Date.now,
    },
  },
  { _id: false },
);

const RemoteRootSchema = new mongoose.Schema(
  {
    rootId: { type: String, required: true },
    rootName: { type: String, required: true, trim: true },
    landDomain: { type: String, required: true },
    lastVisitedAt: { type: Date, default: Date.now },
  },
  { _id: false },
);

const UserSchema = new mongoose.Schema({
  _id: { type: String, required: true, default: uuidv4 },
  username: { type: String, required: true, unique: true },
  email: { type: String, required: false, unique: true, sparse: true },
  password: { type: String, required: true },

  htmlShareToken: { type: String, required: false },

  resetPasswordToken: { type: String, required: false },
  resetPasswordExpiry: { type: Date, required: false },

  roots: [{ type: String, ref: "Node" }],

  recentRoots: {
    type: [RecentRootSchema],
    default: [],
  },
  remoteRoots: {
    type: [RemoteRootSchema],
    default: [],
  },

  // Core LLM connection (set during register/setup). Extension slots in metadata.
  llmDefault: { type: String, ref: "CustomLlmConnection", default: null },

  // Access level (core auth)
  profileType: {
    type: String,
    enum: ["basic", "standard", "premium", "god"],
    default: "basic",
    required: true,
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

//generate share token on new account
UserSchema.pre("save", async function (next) {
  // Only set on first creation
  if (this.isNew && !this.htmlShareToken) {
    this.htmlShareToken = generateHtmlShareToken();
  }

  next();
});

// ── Metadata proxy helpers ──
// These let existing code use user.profileType, user.apiKeys, etc.
// without knowing the data lives in metadata. Zero caller changes needed.
function metaGet(doc, extKey, field, fallback) {
  const meta = doc.metadata instanceof Map ? doc.metadata.get(extKey) : doc.metadata?.[extKey];
  if (meta === undefined || meta === null) return fallback;
  if (field) return meta[field] !== undefined ? meta[field] : fallback;
  return meta;
}

function metaSet(doc, extKey, field, value) {
  if (!doc.metadata) doc.metadata = new Map();
  let existing;
  if (doc.metadata instanceof Map) {
    existing = doc.metadata.get(extKey) || {};
  } else {
    existing = doc.metadata[extKey] || {};
  }
  if (field) {
    existing[field] = value;
  } else {
    existing = value;
  }
  if (doc.metadata instanceof Map) {
    doc.metadata.set(extKey, existing);
  } else {
    doc.metadata[extKey] = existing;
  }
  if (doc.markModified) doc.markModified("metadata");
}

// Billing
UserSchema.virtual("planExpiresAt")
  .get(function () { return metaGet(this, "billing", "planExpiresAt", null); })
  .set(function (v) { metaSet(this, "billing", "planExpiresAt", v); });

// Energy
UserSchema.virtual("availableEnergy")
  .get(function () { return metaGet(this, "energy", "available", { amount: 350, lastResetAt: new Date() }); })
  .set(function (v) { metaSet(this, "energy", "available", v); });

UserSchema.virtual("additionalEnergy")
  .get(function () { return metaGet(this, "energy", "additional", { amount: 0, lastResetAt: new Date() }); })
  .set(function (v) { metaSet(this, "energy", "additional", v); });

UserSchema.virtual("storageUsage")
  .get(function () { return metaGet(this, "energy", "storageUsage", 0); })
  .set(function (v) { metaSet(this, "energy", "storageUsage", v); });

// API Keys
UserSchema.virtual("apiKeys")
  .get(function () { return metaGet(this, "apiKeys", null, []); })
  .set(function (v) { metaSet(this, "apiKeys", null, v); });

// LLM Assignments: main is core (llmDefault), extension slots in metadata
UserSchema.virtual("llmAssignments")
  .get(function () {
    const extSlots = metaGet(this, "userLlm", "slots", {});
    return { main: this.llmDefault, ...extSlots };
  })
  .set(function (v) {
    if (v.main !== undefined) this.llmDefault = v.main;
    const slots = {};
    for (const [key, val] of Object.entries(v)) {
      if (key !== "main") slots[key] = val;
    }
    if (Object.keys(slots).length > 0) {
      metaSet(this, "userLlm", "slots", slots);
    }
  });

// Raw Ideas
UserSchema.virtual("rawIdeaAutoPlace")
  .get(function () { return metaGet(this, "rawIdeas", "autoPlace", true); })
  .set(function (v) { metaSet(this, "rawIdeas", "autoPlace", v); });

// Ensure virtuals show in JSON/Object output
UserSchema.set("toJSON", { virtuals: true });
UserSchema.set("toObject", { virtuals: true });

const User = mongoose.model("User", UserSchema);
export default User;
