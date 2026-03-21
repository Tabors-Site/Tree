import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import jwt from "jsonwebtoken";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, "../..", ".env") });
//mainly for use with shared HTML pages  that sometimes need full auth for POST access
if (!process.env.JWT_SECRET) throw new Error("JWT_SECRET is required. Run the setup wizard or add it to .env");
const JWT_SECRET = process.env.JWT_SECRET;
export default function authenticateOptional(req, res, next) {
  try {
    const token =
      req.cookies?.token ||
      req.headers.authorization?.replace("Bearer ", "");

    if (!token) return next();

    const decoded = jwt.verify(token, JWT_SECRET);

    req.userId =
      decoded.userId || decoded.id || decoded._id;

    req.username = decoded.username;

    next();
  } catch {
    next();
  }
}
