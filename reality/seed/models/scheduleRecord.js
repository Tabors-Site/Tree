// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// ScheduleRecord. The durable shadow of an in-memory wake schedule.
//
// Schedules are the being's standing assignment of attention to a
// cadence — "wake me every N ms." The runtime registry in
// seed/present/wakes/wakeSchedule.js is the hot path (tick-loop
// dispatch); this collection is the boot rehydration source so a
// dance-floor planted before a restart keeps its drum beating
// after.
//
// Same doctrinal note as SubscriptionRecord: this is the
// persistence shadow, not a projection from a fact reel. The
// in-memory registry is the runtime source of truth.

import mongoose from "mongoose";

const ScheduleRecordSchema = new mongoose.Schema({
  _id: { type: String, required: true },

  beingId:       { type: String, required: true, index: true },
  intervalMs:    { type: Number, required: true },
  priority:      { type: Number, default: 4 },
  content:       { type: mongoose.Schema.Types.Mixed, default: null },
  skipIfBacklog: { type: Boolean, default: true },

  createdAt:     { type: Date, default: Date.now },
}, { _id: false, minimize: false });

ScheduleRecordSchema.index({ beingId: 1 });

export default mongoose.models.ScheduleRecord
  || mongoose.model("ScheduleRecord", ScheduleRecordSchema);
