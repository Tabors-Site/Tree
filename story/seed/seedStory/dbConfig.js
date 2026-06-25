// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// The chain-of-truth's connection — now a FILE store, not Mongo.
//
// The storage was ripped from Mongo to an append-only file store
// (philosophy/mongorust.md; past/fileStore.js). There is no
// network connection to wait on and no replica set to monitor: the
// store is a directory under <story>/store/. connectDB() ensures that
// directory exists and replays the moment-journal (crash recovery)
// before any read or write fires. isDbHealthy() is a cheap existence
// check on the store root — the file-store peer of Mongo's readyState.
//
// The Mongo→FileStore rip is complete: dbConfig no longer imports or
// re-exports mongoose. connectDB() opens the file store; isDbHealthy()
// is the file-store peer of Mongo's readyState. No mongoose remains
// anywhere in the tree — the optional Mongo extension and every
// mongoose seam have been deleted, so `npm uninstall mongoose` is safe.

import log from "./log.js";
import { existsSync } from "node:fs";
import {
  configureStore,
  storeRoot,
  replayJournal,
} from "../past/fileStore.js";

/**
 * Open the file store: ensure the data dir exists (configureStore makes
 * journal/ + reels/), then replay the moment-journal so any moment that
 * was committed-to-WAL but not yet acked is re-applied idempotently
 * before the first read/write. The story name selects the store folder
 * (default "past"); tests pass an explicit root.
 *
 * @param {{root?:string, story?:string}} [opts]
 * @returns {Promise<{root:string, replayed:number, torn:boolean}>}
 */
export async function connectDB(opts = {}) {
  const root = configureStore(opts);
  const { replayed, torn } = replayJournal();
  if (replayed > 0) {
    log.info("DB", `file store ready at ${root} — replayed ${replayed} journal record(s)`);
  } else {
    log.verbose("DB", `file store ready at ${root}`);
  }
  if (torn) {
    log.warn("DB", "moment-journal had a torn trailing record (a crash mid-commit); it was discarded.");
  }
  return { root, replayed, torn };
}

// The file-store peer of Mongo's readyState: the store is "healthy"
// when its root directory exists. configureStore (called by connectDB
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
