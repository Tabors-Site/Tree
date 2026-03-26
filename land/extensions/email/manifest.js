export default {
  name: "email",
  version: "1.0.0",
  description:
    "Without this extension, registration is instant: pick a username and password, you're " +
    "in. That simplicity is intentional for development and private lands. But public-facing " +
    "lands need email verification to prevent throwaway accounts and provide a recovery " +
    "path when passwords are forgotten. This extension adds both. " +
    "\n\n" +
    "Registration flow changes completely when email is installed. The beforeRegister hook " +
    "intercepts the normal registration process. Instead of creating a user immediately, " +
    "it creates a TempUser record with the username, bcrypt-hashed password, normalized " +
    "email address, and a cryptographic verification token. A styled HTML email is sent " +
    "with a verification link. The link expires after 12 hours. Clicking it creates the " +
    "real user account, stores the verified email in user metadata, fires afterRegister " +
    "hooks, generates a JWT, sets the auth cookie, and redirects to setup. The TempUser " +
    "record is deleted. Duplicate registrations with the same email or username " +
    "automatically clean up previous pending TempUser records. " +
    "\n\n" +
    "Password reset uses a separate token flow. The forgot-password endpoint accepts an " +
    "email, looks up the user by the email stored in their metadata, generates a 256-bit " +
    "reset token stored in user metadata with a 15-minute expiry, and sends a styled " +
    "reset email. The reset endpoint validates the token, updates the password, clears " +
    "the reset token, and invalidates all existing JWT sessions by writing a " +
    "tokensInvalidBefore timestamp to the user's auth metadata. This forces re-login on " +
    "all devices after a password change. " +
    "\n\n" +
    "Rate limiting protects the email endpoints. Forgot-password is capped at three " +
    "requests per hour per IP. The response is deliberately identical whether the email " +
    "exists or not, preventing enumeration. Email sending uses nodemailer with Gmail " +
    "transport configured via EMAIL_USER and EMAIL_PASS environment variables. If " +
    "html-rendering is installed, the forgot-password page renders as a styled HTML form.",

  needs: {
    services: ["auth"],
    models: ["User"],
  },

  optional: {
    extensions: ["html-rendering"],
  },

  provides: {
    models: {
      TempUser: "./model.js",
    },
    routes: "./routes.js",
    tools: false,
    jobs: false,
    env: [
      { key: "EMAIL_USER", required: true, description: "Email account for sending (e.g. Gmail address)" },
      { key: "EMAIL_PASS", required: true, secret: true, description: "Email account password or app password" },
    ],
    cli: [],
    hooks: {
      fires: [],
      listens: ["beforeRegister", "afterRegister"],
    },
  },
};
