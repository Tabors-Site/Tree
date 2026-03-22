let mod;
try { mod = await import("../../extensions/raw-ideas/model.js"); }
catch {
  const mongoose = (await import("mongoose")).default;
  try { mod = { default: mongoose.model("RawIdea") }; }
  catch { const s = new mongoose.Schema({}, { strict: false }); mod = { default: mongoose.model("RawIdea", s) }; }
}
export default mod.default;
