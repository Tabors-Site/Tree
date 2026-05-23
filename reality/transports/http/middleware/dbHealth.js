// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// DB health gate. Returns 503 when MongoDB is disconnected so
// clients get a clean error instead of an unhandled exception from
// the next Mongoose call. One in-memory readyState check; no async,
// no DB query.

import { isDbHealthy } from "../../../seed/parentReality/dbConfig.js";
import { sendError, IBP_ERR } from "../../../seed/ibp/protocol.js";

export default function dbHealth(req, res, next) {
  if (!isDbHealthy()) {
    return sendError(res, 503, IBP_ERR.INTERNAL, "Database unavailable. Try again shortly.");
  }
  next();
}
