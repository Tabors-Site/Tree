let mod;
try { mod = await import("../../extensions/understanding/models/understandingRun.js"); }
catch {
  const mongoose = (await import("mongoose")).default;
  try { mod = { default: mongoose.model("UnderstandingRun") }; }
  catch { const s = new mongoose.Schema({}, { strict: false }); mod = { default: mongoose.model("UnderstandingRun", s) }; }
}
export default mod.default;
