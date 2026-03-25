// TreeOS Seed . AGPL-3.0 . https://treeos.ai
import log from "./log.js";
import mongoose from "mongoose";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, "..", ".env") });
const mongooseUri = process.env.MONGODB_URI;

mongoose
  .connect(mongooseUri, {
    serverSelectionTimeoutMS: Number(process.env.MONGO_SELECTION_TIMEOUT) || 5000,
    maxPoolSize: Number(process.env.MONGO_MAX_POOL_SIZE) || 50,
    minPoolSize: Number(process.env.MONGO_MIN_POOL_SIZE) || 5,
  })
  .then(() => log.verbose("DB", "MongoDB connected"))
  .catch((err) => {
    log.error("DB", "MongoDB connection failed:", err.message);
    log.error("DB", "Make sure MongoDB is running and MONGODB_URI is correct in .env");
    process.exit(1);
  });

/**
 * Check if the database connection is healthy.
 * Returns true if MongoDB is connected and responsive.
 * The conversation loop checks this before entering the tool loop.
 */
export function isDbHealthy() {
  return mongoose.connection.readyState === 1;
}

export default mongoose;
