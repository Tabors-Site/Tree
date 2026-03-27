// TreeOS Seed . AGPL-3.0 . https://treeos.ai
// Database connection. Every query in the system flows through this.
// Connection state is monitored. Transitions are logged. isDbHealthy()
// is the single source of truth for DB availability across the kernel.

import log from "./log.js";
import mongoose from "mongoose";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);


const mongooseUri = process.env.MONGODB_URI;

if (!mongooseUri) {
  log.error("DB", "MONGODB_URI is not set in .env. Cannot start.");
  log.error("DB", "Example: MONGODB_URI=mongodb://localhost:27017/land");
  process.exit(1);
}

// ─────────────────────────────────────────────────────────────────────────
// CONNECTION OPTIONS
// ─────────────────────────────────────────────────────────────────────────

const connectionOptions = {
  // How long to wait for initial server selection (boot-time).
  // 5s default. Cloud databases may need 15-30s.
  serverSelectionTimeoutMS: Number(process.env.MONGO_SELECTION_TIMEOUT) || 5000,

  // Connection pool. Default pool is 10, which exhausts at 100 concurrent users.
  maxPoolSize: Number(process.env.MONGO_MAX_POOL_SIZE) || 50,
  minPoolSize: Number(process.env.MONGO_MIN_POOL_SIZE) || 5,

  // Per-socket timeout. If a query takes longer than this, the socket is killed.
  // Prevents hung queries on degraded replicas from blocking the pool forever.
  socketTimeoutMS: Number(process.env.MONGO_SOCKET_TIMEOUT) || 30000,

  // How often the driver pings the server to detect failures.
  // Lower = faster failure detection. Higher = less network overhead.
  heartbeatFrequencyMS: Number(process.env.MONGO_HEARTBEAT_MS) || 5000,
};

// ─────────────────────────────────────────────────────────────────────────
// CONNECT
// ─────────────────────────────────────────────────────────────────────────

mongoose
  .connect(mongooseUri, connectionOptions)
  .then(() => log.verbose("DB", "MongoDB connected"))
  .catch((err) => {
    log.error("DB", `MongoDB connection failed: ${err.message}`);
    log.error("DB", "Make sure MongoDB is running and MONGODB_URI is correct in .env");
    process.exit(1);
  });

// ─────────────────────────────────────────────────────────────────────────
// CONNECTION EVENT MONITORING
// ─────────────────────────────────────────────────────────────────────────
// These fire after the initial connection succeeds. They cover the entire
// lifetime of the process. Every state transition is logged so operators
// see exactly when the DB dropped and when it came back.

mongoose.connection.on("disconnected", () => {
  log.error("DB", "MongoDB disconnected. Queries will fail until reconnected.");
});

mongoose.connection.on("reconnected", () => {
  log.info("DB", "MongoDB reconnected.");
});

mongoose.connection.on("error", (err) => {
  log.error("DB", `MongoDB connection error: ${err.message}`);
});

// Close cleanly on process termination
process.on("SIGTERM", () => {
  mongoose.connection.close(false).then(() => {
    log.verbose("DB", "MongoDB connection closed (SIGTERM)");
  });
});

// ─────────────────────────────────────────────────────────────────────────
// HEALTH CHECK
// ─────────────────────────────────────────────────────────────────────────

/**
 * Check if the database connection is healthy.
 * Returns true if MongoDB is connected and responsive.
 * The conversation loop checks this before entering the tool loop.
 * readyState: 0 = disconnected, 1 = connected, 2 = connecting, 3 = disconnecting
 */
export function isDbHealthy() {
  return mongoose.connection.readyState === 1;
}

export default mongoose;
