import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET;

export default function urlAuth(req, res, next) {
  const token =
    req.query.token ||
    req.params.token ||
    req.headers["authorization"]?.split(" ")[1];

  if (!token) {
    return res.status(401).json({ message: "No token provided" });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.userId = decoded.userId;
    req.username = decoded.username;
    next();
  } catch (err) {
    return res.status(401).json({ message: "Invalid token" });
  }
}
