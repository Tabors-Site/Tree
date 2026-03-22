let mod;
try { mod = await import("../../extensions/book/model.js"); }
catch {
  const mongoose = (await import("mongoose")).default;
  try { mod = { default: mongoose.model("Book") }; }
  catch { const s = new mongoose.Schema({}, { strict: false }); mod = { default: mongoose.model("Book", s) }; }
}
export default mod.default;
