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
      ref: "Node"
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
  { _id: false }
);

const ApiKeySchema = new mongoose.Schema(
  {
    _id: { type: String, default: uuidv4 },
    keyHash: { type: String, required: true },
    name: { type: String, default: "API Key" },
    lastUsedAt: { type: Date, default: null },
    revoked: { type: Boolean, default: false },

    usageCount: { type: Number, default: 0 },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

const OpenAIConnectorSchema = new mongoose.Schema(
  {
    token: { type: String, required: true },
    createdAt: { type: Date, default: Date.now },
    lastUsedAt: { type: Date, default: null },
    revoked: { type: Boolean, default: false },
  },
  { _id: false }
);

const EnergySchema = new mongoose.Schema(
  {
    amount: {
      type: Number,
      required: true,
    },
    lastResetAt: {
      type: Date,
      required: true,
      default: Date.now,
    },
  },
  { _id: false }
);

const UserSchema = new mongoose.Schema({
  _id: { type: String, required: true, default: uuidv4 },
  username: { type: String, required: true, unique: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },

  htmlShareToken: { type: String, required: false },

  resetPasswordToken: { type: String, required: false },
  resetPasswordExpiry: { type: Date, required: false },

  apiKeys: [ApiKeySchema],

  roots: [{ type: String, ref: "Node" }],
  
  recentRoots: {
    type: [RecentRootSchema],
    default: [],
  },
  profileType: {
    type: String,
    enum: ["basic", "standard", "premium", "god"],
    default: "basic",
    required: true,
  },

  planExpiresAt: {
  type: Date,
  default: null,  // null = basic/no paid plan
},

  availableEnergy: {
    type: EnergySchema,
    required: true,
    default: () => ({
      amount: 350,// matches basic daily limit
      lastResetAt: new Date(),
    }),
  },

  additionalEnergy: {
  type: EnergySchema,
  required: true,
  default: () => ({
    amount: 0,
    lastResetAt: new Date(),
  }),
},
  storageUsage: {
    type: Number, // in MB
    default: 0,
  },
  openAiConnector: {
    type: OpenAIConnectorSchema,
    required: false,
  },
  llmAssignments: {
    main: { type: String, ref: "CustomLlmConnection", default: null },
    rawIdea: { type: String, ref: "CustomLlmConnection", default: null },
  },
  rawIdeaAutoPlace: {
    type: Boolean,
    default: true,
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

const User = mongoose.model("User", UserSchema);
export default User;
