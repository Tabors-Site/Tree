// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// mongo ops. One SEE op: mongo-stats — connection state, pool
// config, best-effort db.stats summary. Pure read, no facts; gated
// by canSee.

import { registerSeeOperation } from "../../../ibp/seeOps.js";

export function registerMongoOps() {
  // Explicit genesis entry point; registration runs at module load.
}

registerSeeOperation("mongo-stats", {
  description:
    "Mongo connection state: readyState, pool config, db.stats " +
    "summary (collections, objects, sizes, indexes).",
  args: {},
  handler: async () => {
    const { default: mongoose } = await import("../../../seedStory/dbConfig.js");
    const c = mongoose.connection;
    let dbStats = null;
    try {
      if (c.readyState === 1) {
        const s = await c.db.stats();
        dbStats = {
          collections: s.collections,
          objects: s.objects,
          dataSize: s.dataSize,
          storageSize: s.storageSize,
          indexes: s.indexes,
        };
      }
    } catch { /* stats are best-effort */ }
    return {
      readyState: c.readyState,
      healthy: c.readyState === 1,
      dbName: c.name || null,
      pool: {
        max: Number(process.env.MONGO_MAX_POOL_SIZE) || 50,
        min: Number(process.env.MONGO_MIN_POOL_SIZE) || 5,
      },
      dbStats,
    };
  },
});
