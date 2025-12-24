import jwt from "jsonwebtoken";
import dotenv from "dotenv";
import { resolveTreeAccess } from "../core/authenticate.js";

dotenv.config();

const JWT_SECRET = process.env.JWT_SECRET || "your_secret_key";

export default async function authenticate(req, res, next) {
  let token = null;

  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith("Bearer ")) {
    token = authHeader.slice(7).trim();
  }

  if (!token && req.cookies?.token) {
    token = req.cookies.token;
  }

  if (!token) {
    return res.status(401).json({
      message: "Access denied. No token provided.",
    });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);

    req.userId = decoded.userId;
    req.username = decoded.username;

    const nodeId = req.body?.nodeId || req.params?.nodeId || req.query?.nodeId;

    if (nodeId) {
      const access = await resolveTreeAccess(nodeId, req.userId);
      if (!access.canWrite && !access.isOwner && !access.isContributor) {
        return res.status(403).json({
          message: "You do not have access to this tree",
        });
      }
      req.rootId = access.rootId;
      req.treeAccess = access;
    }

    next();
  } catch (err) {
    console.error("Auth error:", err);
    return res.status(401).json({
      message: "Invalid or expired token or wrong nodeId",
    });
  }
}
