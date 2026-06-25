// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// The index floor, DERIVED, not declared.
//
// In the file store (past/fileStore.js) the find* lookups (name→id,
// space→occupants, parent→children, kind→ids, heavenSpace→id) are
// served by the store's own inverted index, which is maintained
// incrementally on every snapshot write and is fully rebuildable from
// the reels (fileStore.rebuildIndex). There is no catalog to
// materialize and no secondary index to create. The index is a pure
// fold of the chain.
//
// Both functions are kept as NO-OPS so their callers (genesis.js for
// ensureIndexes; the extension loader's wire phase for
// ensureExtensionIndexes) need not change. Signatures and return shapes
// are stable across callers.

import log from "./log.js";

/**
 * No-op. File-store indexes are derived from the reels and maintained
 * incrementally by the store; there is nothing to verify or create at
 * genesis. Returns a stable report shape so genesis.js's call site is
 * unchanged.
 *
 * @returns {Promise<{ verified: number, created: number, errors: string[] }>}
 */
export async function ensureIndexes() {
  log.verbose("Indexes", "file-store indexes are derived; nothing to verify");
  return { verified: 0, created: 0, errors: [] };
}

/**
 * No-op. Extension-declared secondary indexes are not a file-store
 * concept; the file store derives its lookups from the chain. Kept so
 * the loader's wire-phase call site is unchanged.
 *
 * @param {Array<{ collection: string, fields: object, options?: object }>} indexes
 * @param {string} extName - for logging
 */
export async function ensureExtensionIndexes(indexes, extName) {
  if (indexes && Array.isArray(indexes) && indexes.length > 0) {
    log.verbose(
      "Indexes",
      `Extension ${extName} declared ${indexes.length} index(es); file store derives its lookups — ignored.`,
    );
  }
}
