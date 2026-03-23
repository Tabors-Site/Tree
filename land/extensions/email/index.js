import crypto from "crypto";
import router from "./routes.js";
import TempUser from "./model.js";
import { sendVerificationEmail } from "./core.js";
import { getLandUrl } from "../../canopy/identity.js";
import { getLandConfigValue } from "../../core/landConfig.js";

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function init(core) {
  const User = core.models.User;

  // Intercept registration when email is involved.
  // If this land requires email, block registration without it.
  // If email is provided, create TempUser and send verification.
  core.hooks.register("beforeRegister", async (data) => {
    const { username, password, email, req, res } = data;

    const requireEmail = getLandConfigValue("REQUIRE_EMAIL") !== "false";

    if (requireEmail && !email) {
      res.status(400).json({ message: "Email is required for registration" });
      data.handled = true;
      return;
    }

    if (!email) return; // No email provided, let core handle it

    // Validate email
    if (!EMAIL_REGEX.test(email) || email.length > 320) {
      res.status(400).json({ message: "Please enter a valid email address" });
      data.handled = true;
      return;
    }

    const normalizedEmail = email.trim().toLowerCase();

    // Check duplicate email in metadata
    const existingEmail = await User.findOne({ "metadata.email.address": normalizedEmail });
    if (existingEmail) {
      res.status(400).json({ message: "Email already registered" });
      data.handled = true;
      return;
    }

    // Clean up any existing temp users for this email/username
    await TempUser.deleteMany({
      $or: [
        { email: normalizedEmail },
        { username: { $regex: `^${escapeRegex(username)}$`, $options: "i" } },
      ],
    });

    const verificationToken = crypto.randomBytes(32).toString("hex");

    await TempUser.create({
      username,
      email: normalizedEmail,
      password,
      verificationToken,
      expiresAt: Date.now() + 1000 * 60 * 60 * 12, // 12 hours
    });

    const verifyUrl = `${getLandUrl()}/api/v1/user/verify/${verificationToken}`;
    await sendVerificationEmail(normalizedEmail, verifyUrl, username);

    res.status(201).json({
      pendingVerification: true,
      message: "Check your email to complete registration",
    });
    data.handled = true;
  }, "email");

  // After registration, store email in metadata if provided (for non-verification flows)
  core.hooks.register("afterRegister", async ({ user, email }) => {
    if (!email) return;
    const normalizedEmail = email.trim().toLowerCase();
    const freshUser = await User.findById(user._id);
    if (!freshUser) return;
    if (freshUser.metadata instanceof Map) {
      freshUser.metadata.set("email", { address: normalizedEmail, verified: false });
    } else {
      if (!freshUser.metadata) freshUser.metadata = {};
      freshUser.metadata.email = { address: normalizedEmail, verified: false };
    }
    if (freshUser.markModified) freshUser.markModified("metadata");
    await freshUser.save();
  }, "email");

  return { router };
}
