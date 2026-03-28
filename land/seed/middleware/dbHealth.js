// TreeOS Seed . AGPL-3.0 . https://treeos.ai
/**
 * Database Health Middleware
 *
 * Returns 503 Service Unavailable when MongoDB is disconnected.
 * Mount on API routes so clients get a clean error instead of
 * unhandled exceptions from Mongoose operations.
 *
 * Lightweight: one function call, no async, no DB query.
 * The readyState check is in-memory (Mongoose driver state).
 */

import { isDbHealthy } from "../dbConfig.js";
import { sendError, ERR } from "../protocol.js";

export default function dbHealth(req, res, next) {
  if (!isDbHealthy()) {
    return sendError(res, 503, ERR.INTERNAL, "Database unavailable. Try again shortly.");
  }
  next();
}
