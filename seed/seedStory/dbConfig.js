// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// The chain-of-truth's connection. The chain is an append-only FILE
// store (past/fileStore.js), not a network database.
//
// There is no network connection to wait on and no replica set to
// monitor: the store is a directory under <story>/store/. connectDB()
// ensures that directory exists and replays the moment-journal (crash
// recovery) before any read or write fires. isDbHealthy() is a cheap
// existence check on the store root.
//
// dbConfig imports nothing but the file store: connectDB() opens it,
// isDbHealthy() reports whether the store root is present. No external
// driver or connection string is involved.

import log from "./log.js";
import { existsSync } from "node:fs";
import { configureStore, storeRoot } from "../past/fileStore.js";

/**
 * Open the file store: ensure the data dir exists (configureStore makes the
 * reels/ tree). Write-through, no journal — the reel-line append IS the stamp,
 * so the on-disk reels are the truth at open and there is nothing to replay.
 *
 * The active store folder is the file equivalent of a database name: a
 * sibling under store/. It is chosen, in order, by an explicit opts.story,
 * then the STORE_NAME env var, then the default "past". Naming it
 * something new spins up a fresh, isolated store (its own reels and
 * projections under store/<name>/), exactly like pointing at a new
 * database. Tests pass an explicit root to land in a scratch dir.
 *
 * @param {{root?:string, story?:string}} [opts]
 * @returns {Promise<{root:string}>}
 */
export async function connectDB(opts = {}) {
  const story = opts.story ?? process.env.STORE_NAME ?? undefined;
  const root = configureStore({ ...opts, story });
  log.verbose("Store", `file store ready at ${root}`);
  return { root };
}

// Store health: the store is "healthy" when its root directory
// exists. configureStore (called by connectDB
// at boot) creates it; a missing root means connectDB never ran or the
// volume vanished. Synchronous + cheap — the conversation loop and the
// HTTP db-health gate check this before entering a read/write path.
export function isDbHealthy() {
  try {
    return existsSync(storeRoot());
  } catch {
    return false;
  }
}
