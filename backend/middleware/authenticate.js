import jwt from 'jsonwebtoken';
import dotenv from "dotenv";

dotenv.config();

const JWT_SECRET = process.env.JWT_SECRET || "your_secret_key";

export default (req, res, next) => {
  // Read token from the cookie named 'token'
  const token = req.cookies?.token;

  if (!token) {
    return res
      .status(401)
      .json({ message: "Access denied. No token provided." });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.userId = decoded.userId; // Attach userId to the request object
    req.username = decoded.username;
    next();
  } catch (error) {
    res.status(400).json({ message: "Invalid t  bfoken." });
  }
};
