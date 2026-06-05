// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// SubscriptionRecord. The durable shadow of an in-memory
// subscription.
//
// Subscriptions are the being's standing attention — "wake me when
// this happens at that position." The runtime registry in
// seed/present/wakes/subscriptions.js is the hot path (microsecond
// lookups during emitToSubscribers); this collection is the boot
// rehydration source. Without it, every server restart wipes every
// being's attention and existing extensions (the harmony dance,
// future ones) silently stop responding to events they were
// supposed to react to.
//
// Doctrinal note. The in-memory registry IS the source of truth at
// runtime. This collection persists only the inputs the registry
// would need to be rebuilt — event, scope, filter, priority,
// coalesceMs, the id. It's a write-through cache from the registry
// side, NOT a projection from a fact reel. A future pass could
// model subscribe/unsubscribe as facts on the being's reel; for
// now the direct write is the pragmatic durability seam, and the
// hot path stays in memory.

import mongoose from "mongoose";

const SubscriptionRecordSchema = new mongoose.Schema({
  _id: { type: String, required: true },

  beingId:    { type: String, required: true, index: true },
  event:      { type: String, required: true, index: true },
  scope:      { type: mongoose.Schema.Types.Mixed, required: true },
  filter:     { type: mongoose.Schema.Types.Mixed, default: null },
  priority:   { type: Number, default: 4 },
  coalesceMs: { type: Number, default: 0 },

  createdAt:  { type: Date, default: Date.now },
}, { _id: false, minimize: false });

SubscriptionRecordSchema.index({ beingId: 1, event: 1 });

export default mongoose.models.SubscriptionRecord
  || mongoose.model("SubscriptionRecord", SubscriptionRecordSchema);
