// CustomLlmConnection bridge.
// If user-llm extension is installed, re-exports from it.
// If not, provides a minimal stub model.

let mod;
try {
  mod = await import("../../extensions/user-llm/model.js");
} catch {
  // user-llm extension not installed. Provide stub.
  const mongoose = (await import("mongoose")).default;
  const schema = new mongoose.Schema({
    _id: String,
    userId: String,
    name: String,
    baseUrl: String,
    model: String,
  }, { strict: false });
  try {
    mod = { default: mongoose.model("CustomLlmConnection") };
  } catch {
    mod = { default: mongoose.model("CustomLlmConnection", schema) };
  }
}

export default mod.default;
