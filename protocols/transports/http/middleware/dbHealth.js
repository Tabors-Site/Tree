// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// Store health gate. Returns 503 when the file store is not open so
// clients get a clean error instead of an unhandled exception from
// the next store read. One existence check on the store root; no
// async, no query.

import { isDbHealthy } from "../../../../seed/seedStory/dbConfig.js";
import { sendError, IBP_ERR } from "../../../../seed/ibp/protocol.js";

export default function dbHealth(req, res, next) {
  if (!isDbHealthy()) {
    return sendError(res, 503, IBP_ERR.INTERNAL, "Database unavailable. Try again shortly.");
  }
  next();
}
