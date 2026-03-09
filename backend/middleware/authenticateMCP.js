import jwt from "jsonwebtoken";
import dotenv from "dotenv";

dotenv.config();

const JWT_SECRET = process.env.JWT_SECRET || "your_secret_key";

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
