let mod;
try { mod = await import("../../extensions/understanding/models/understandingNode.js"); }
catch {
  const mongoose = (await import("mongoose")).default;
  try { mod = { default: mongoose.model("UnderstandingNode") }; }
  catch { const s = new mongoose.Schema({}, { strict: false }); mod = { default: mongoose.model("UnderstandingNode", s) }; }
}
export default mod.default;
