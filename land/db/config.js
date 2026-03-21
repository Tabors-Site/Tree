import mongoose from "mongoose";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, "../..", ".env") });
const mongooseUri = process.env.MONGODB_URI;

mongoose
  .connect(mongooseUri, {})
  .then(() => console.log("MongoDB connected"))
  .catch((err) => {
    console.error("MongoDB connection failed:", err.message);
    console.error("Make sure MongoDB is running and MONGODB_URI is correct in .env");
    process.exit(1);
  });

export default mongoose;
