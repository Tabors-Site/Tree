import crypto from "crypto";
import { sendOk, sendError, ERR } from "../../seed/protocol.js";
import TempUser from "./model.js";
import { sendVerificationEmail } from "./core.js";
import { getLandUrl } from "../../canopy/identity.js";
import { getLandConfigValue } from "../../seed/landConfig.js";
import { getUserMeta, setUserMeta } from "../../seed/tree/userMetadata.js";

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function init(core) {
  const { default: router, setModels } = await import("./routes.js");
  setModels(core.models);
  const User = core.models.User;

  core.hooks.register("beforeRegister", async (data) => {
    const { username, password, req, res } = data;
    const email = req.body?.email;

    const requireEmail = getLandConfigValue("REQUIRE_EMAIL") !== "false";

    if (requireEmail && !email) {
      sendError(res, 400, ERR.INVALID_INPUT, "Email is required for registration");
      data.handled = true;
      return;
    }

    if (!email) return;

    if (!EMAIL_REGEX.test(email) || email.length > 320) {
      sendError(res, 400, ERR.INVALID_INPUT, "Please enter a valid email address");
      data.handled = true;
      return;
    }

    const normalizedEmail = email.trim().toLowerCase();

    const existingEmail = await User.findOne({ "metadata.email.address": normalizedEmail });
    if (existingEmail) {
      sendError(res, 400, ERR.INVALID_INPUT, "Email already registered");
      data.handled = true;
      return;
    }

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

    sendOk(res, {
      pendingVerification: true,
      message: "Check your email to complete registration",
    }, 201);
    data.handled = true;
  }, "email");

  core.hooks.register("afterRegister", async ({ user, email }) => {
    if (!email) return;
    const freshUser = await User.findById(user._id);
    if (!freshUser) return;

    // Don't overwrite if email metadata already exists (verify route sets verified: true first)
    const existing = getUserMeta(freshUser, "email");
    if (existing?.address) return;

    const normalizedEmail = email.trim().toLowerCase();
    setUserMeta(freshUser, "email", { address: normalizedEmail, verified: false });
    await freshUser.save();
  }, "email");

  try {
    const { getExtension } = await import("../loader.js");
    const htmlExt = getExtension("html-rendering");
    if (htmlExt) {
      const { default: buildHtmlRoutes } = await import("./htmlRoutes.js");
      htmlExt.router.use("/", buildHtmlRoutes());
    }
  } catch {}

  return { router };
}
