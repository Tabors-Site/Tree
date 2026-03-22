let mod;
try { mod = await import("../../extensions/dreams/model.js"); }
catch {
  const mongoose = (await import("mongoose")).default;
  try { mod = { default: mongoose.model("ShortMemory") }; }
  catch { const s = new mongoose.Schema({}, { strict: false }); mod = { default: mongoose.model("ShortMemory", s) }; }
}
export default mod.default;
