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
});

// Hash password before saving
UserSchema.pre("save", async function (next) {
  if (this.isModified("password") || this.isNew) {
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
  }
  next();
});

//compare the plain password with the hashed password
UserSchema.methods.comparePassword = async function (candidatePassword) {
  return bcrypt.compare(candidatePassword, this.password);
};

const User = mongoose.model("User", UserSchema);
export default User;
