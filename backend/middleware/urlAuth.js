import { resolveHtmlShareAccess } from "../core/authenticate.js";

export default async function urlAuth(req, res, next) {
  try {
    const token =
      req.query.token ||
      req.params.token ||
      req.headers["authorization"]?.split(" ")[1];

    if (!token) {
      return res.status(401).json({
        message: "No share token provided",
      });
    }

    const nodeId = req.params?.nodeId || req.body?.nodeId || req.query?.nodeId;

    if (!nodeId) {
      return res.status(400).json({
        message: "nodeId is required for shared access",
      });
    }

    const result = await resolveHtmlShareAccess(nodeId, token);

    if (!result.allowed) {
      return res.status(403).json({
        message: "Invalid or unauthorized share token",
      });
    }

    req.rootId = result.rootId;

    req.userId = result.matchedUserId;
    req.username = result.matchedUsername;

    req.isHtmlShare = true;

    next();
  } catch (err) {
    console.error("[urlAuth] error:", err);
    res.status(403).json({
      message: "Share authorization failed",
    });
  }
}
