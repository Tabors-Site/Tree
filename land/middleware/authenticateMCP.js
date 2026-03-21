import jwt from "jsonwebtoken";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, "../..", ".env") });

if (!process.env.JWT_SECRET) throw new Error("JWT_SECRET is required. Run the setup wizard or add it to .env");
const JWT_SECRET = process.env.JWT_SECRET;

export default function authenticateMCP(req, res, next) {
  try {
    const token =
      req.headers["x-internal-token"];

    if (!token) {
      return res.status(401).json({ error: "Missing token" });
    }

    const decoded = jwt.verify(token, JWT_SECRET);

    req.userId =
      decoded.userId || decoded.id || decoded._id;

    req.username = decoded.username;
    req.visitorId = decoded.visitorId || null;

    next();
  } catch (err) {
    console.error("[authenticateMCP] invalid token:", err.message);
    return res.status(401).json({ error: "Invalid token" });
  }
}
