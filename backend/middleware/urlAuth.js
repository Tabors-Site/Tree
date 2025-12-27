import { resolveHtmlShareAccess } from "../core/authenticate.js";

export default async function urlAuth(req, res, next) {
  try {
    const shareToken =
      req.query.token ||
      req.params.token ||
      req.headers["authorization"]?.split(" ")[1];

    if (!shareToken) {
      return res.status(401).json({
        message: "No share token provided",
      });
    }

    const userId =
      req.params?.userId || req.body?.userId || req.query?.userId || null;

    const nodeId =
      req.params?.nodeId ||
      req.body?.nodeId ||
      req.query?.nodeId ||
      req.params?.rootId || // 👈 ADD THIS
      null;

    if (!userId && !nodeId) {
      return res.status(400).json({
        message: "userId or nodeId is required for shared access",
      });
    }

    const result = await resolveHtmlShareAccess({
      userId,
      nodeId,
      shareToken,
    });

    if (!result.allowed) {
      return res.status(403).json({
        message: "Invalid or unauthorized share token",
      });
    }

    req.userId = result.matchedUserId;
    req.username = result.matchedUsername;
    req.rootId = result.rootId ?? null;
    req.isHtmlShare = true;

    next();
  } catch (err) {
    console.error("[urlAuth] error:", err);
    res.status(403).json({
      message: "Share authorization failed",
    });
  }
}
