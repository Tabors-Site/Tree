import mongoose from "mongoose";
import bcrypt from "bcrypt";
import { v4 as uuidv4 } from "uuid";

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

  profileType: {
    type: String,
    enum: ["basic", "standard", "premium", "god"],
    default: "basic",
    required: true,
  },

  availableEnergy: {
    type: EnergySchema,
    required: true,
    default: () => ({
      amount: 60,
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

const User = mongoose.model("User", UserSchema);
export default User;
