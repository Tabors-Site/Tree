import mongoose from "mongoose";

const AuthCodeSchema = new mongoose.Schema({
  code: { type: String, required: true, unique: true },
  userId: { type: String, ref: "Node", default: null },
  clientId: { type: String, required: true },

  codeChallenge: { type: String },
  codeChallengeMethod: { type: String },

  scope: { type: String },

  expiresAt: { type: Date, required: true },
});

AuthCodeSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export default mongoose.model("AuthCode", AuthCodeSchema);
