let mod;
try { mod = await import("../../extensions/dreams/notification.model.js"); }
catch {
  const mongoose = (await import("mongoose")).default;
  try { mod = { default: mongoose.model("Notification") }; }
  catch { const s = new mongoose.Schema({}, { strict: false }); mod = { default: mongoose.model("Notification", s) }; }
}
export default mod.default;
