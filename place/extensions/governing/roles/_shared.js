// TreeOS governing . shared helpers for the role templates.
//
// Reply emission lives in seed/cognition/replies.js (substrate-
// generic; not governing-specific). This file is a thin re-export so
// existing imports in plannerRole, contractorRole, foremanRole, and
// workerRoles keep working without a sweeping rename. New code should
// import directly from seed/cognition/replies.js.
//
// `readMetaPath` stays here . it is a small Mongoose-lean metadata-Map
// traversal utility used by governing state helpers; not yet promoted
// to seed.

export {
  emitReplyToAsker,
  emitReplyToStance,
  findChainInitialCaller,
} from "../../../seed/cognition/replies.js";

/**
 * Walk a metadata path against both Map and plain-object shapes.
 * Mongoose lean() returns metadata as a plain object whose entries may
 * be nested Maps depending on driver version.
 */
export function readMetaPath(space, path) {
  if (!space) return undefined;
  let cursor = space.qualities;
  for (const key of path) {
    if (cursor instanceof Map) cursor = cursor.get(key);
    else if (cursor && typeof cursor === "object") cursor = cursor[key];
    else return undefined;
    if (cursor === undefined || cursor === null) return undefined;
  }
  return cursor;
}
