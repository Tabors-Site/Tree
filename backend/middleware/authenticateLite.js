import dotenv from "dotenv";
import jwt from "jsonwebtoken";

dotenv.config();
//mainly for use with shared HTML pages  that sometimes need full auth for POST access
const JWT_SECRET = process.env.JWT_SECRET || "your_secret_key";
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
