// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// My connection to MongoDB.
//
// Every read and write in the world I form goes through Mongoose,
// which goes through this connection. The connection's state is the
// land's lifeline; transitions are logged loudly so the operator
// sees exactly when the DB dropped and when it came back.
// isDbHealthy() is the single source of truth for DB availability.

import log from "./log.js";
import mongoose from "mongoose";

const mongooseUri = process.env.MONGODB_URI;

if (!mongooseUri) {
  log.error("DB", "MONGODB_URI is not set in .env. Cannot start.");
  log.error("DB", "Example: MONGODB_URI=mongodb://localhost:27017/land");
  process.exit(1);
}

const connectionOptions = {
  // Initial server selection (boot-time). 5s default; cloud DBs may need 15-30s.
  serverSelectionTimeoutMS: Number(process.env.MONGO_SELECTION_TIMEOUT) || 5000,

  // Connection pool. Default 10 exhausts at 100 concurrent users.
  maxPoolSize: Number(process.env.MONGO_MAX_POOL_SIZE) || 50,
  minPoolSize: Number(process.env.MONGO_MIN_POOL_SIZE) || 5,

  // Per-socket timeout. Hung queries on degraded replicas get killed
  // instead of blocking the pool forever.
  socketTimeoutMS: Number(process.env.MONGO_SOCKET_TIMEOUT) || 30000,

  // Failure detection cadence. Lower = faster detection, more overhead.
  heartbeatFrequencyMS: Number(process.env.MONGO_HEARTBEAT_MS) || 5000,
};

mongoose
  .connect(mongooseUri, connectionOptions)
  .then(() => log.verbose("DB", "MongoDB connected"))
  .catch((err) => {
    log.error("DB", `MongoDB connection failed: ${err.message}`);
    log.error("DB", "Make sure MongoDB is running and MONGODB_URI is correct in .env");
    process.exit(1);
  });

// Lifetime event monitoring. These fire after the initial connection
// succeeds and cover the rest of the process. Every transition logs
// so the operator can see DB-side disruption clearly.
mongoose.connection.on("disconnected", () => {
  log.error("DB", "MongoDB disconnected. Queries will fail until reconnected.");
});

mongoose.connection.on("reconnected", () => {
  log.info("DB", "MongoDB reconnected.");
});

mongoose.connection.on("error", (err) => {
  log.error("DB", `MongoDB connection error: ${err.message}`);
});

process.on("SIGTERM", () => {
  mongoose.connection.close(false).then(() => {
    log.verbose("DB", "MongoDB connection closed (SIGTERM)");
  });
});

// readyState: 0 disconnected, 1 connected, 2 connecting, 3 disconnecting.
// The conversation loop checks this before entering the tool loop so a
// tool result can tell the AI "database unavailable" instead of hanging.
export function isDbHealthy() {
  return mongoose.connection.readyState === 1;
}

export default mongoose;
