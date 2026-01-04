import User from "../db/models/user.js";

export default async function authenticateOpenAIConnector(req, res, next) {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader?.startsWith("Bearer ")) {
      return res.status(401).json({
        error: "missing_authorization",
      });
    }

    const token = authHeader.slice(7).trim();

    // Safety check: only allow OpenAI-issued tokens
    if (!token.startsWith("oa_")) {
      return res.status(401).json({
        error: "invalid_token_type",
      });
    }

    const user = await User.findOne({
      "openAiConnector.token": token,
      "openAiConnector.revoked": { $ne: true },
    }).select("_id username openAiConnector");

    if (!user) {
      return res.status(401).json({
        error: "invalid_or_revoked_token",
      });
    }

    // Attach identity
    req.userId = user._id;
    req.username = user.username;
    req.authType = "openai";

    // Optional: usage tracking
    user.openAiConnector.lastUsedAt = new Date();
    await user.save();

    next();
  } catch (err) {
    console.error("[authenticateOpenAIConnector]", err);
    return res.status(500).json({
      error: "server_error",
    });
  }
}
