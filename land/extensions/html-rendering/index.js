import crypto from "crypto";
import router from "./routes.js";

function generateShareToken() {
  return crypto.randomBytes(16).toString("base64url");
}

export async function init(core) {
  const User = core.models.User;

  // Generate share token for new users
  core.hooks.register("afterRegister", async ({ user }) => {
    const freshUser = await User.findById(user._id);
    if (!freshUser) return;
    const { getUserMeta, setUserMeta } = await import("../../core/tree/userMetadata.js");
    const existing = getUserMeta(freshUser, "html");
    if (existing?.shareToken) return; // already has one
    setUserMeta(freshUser, "html", { ...existing, shareToken: generateShareToken() });
    await freshUser.save();
  }, "html-rendering");

  return { router };
}
