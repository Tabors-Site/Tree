import dotenv from "dotenv";
import jwt from "jsonwebtoken";

dotenv.config();

const JWT_SECRET = process.env.JWT_SECRET || "your_secret_key";
export default function authenticateOptional(req, res, next) {
  try {
    const token = req.cookies?.token;
    if (!token) return next();
    const decoded = jwt.verify(token, JWT_SECRET);

    req.userId = decoded.userId;
    req.username = decoded.username;
    next();
  } catch {
    next(); // swallow errors
  }
}
