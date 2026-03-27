import nodemailer from "nodemailer";

function escapeHtml(str) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function createTransporter() {
  return nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS,
    },
  });
}

export async function sendResetEmail(to, link) {
  const transporter = createTransporter();
  await transporter.sendMail({
    from: `"TreeOS" <${process.env.EMAIL_USER}>`,
    to,
    subject: "Password Reset",
    html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto; padding: 40px 20px;">
        <div style="text-align: center; margin-bottom: 32px;">
          <h1 style="font-size: 24px; color: #1a1a1a; margin: 8px 0 0;">Tree</h1>
        </div>
        <p style="font-size: 16px; color: #333; line-height: 1.6;">We received a request to reset your password.</p>
        <p style="font-size: 16px; color: #333; line-height: 1.6;">Click the button below to choose a new password:</p>
        <div style="text-align: center; margin: 32px 0;">
          <a href="${link}" style="display: inline-block; background-color: #736fe6; color: white; text-decoration: none; padding: 14px 32px; border-radius: 980px; font-size: 16px; font-weight: 600;">Reset My Password</a>
        </div>
        <p style="font-size: 13px; color: #888; line-height: 1.5;">This link expires in 15 minutes. If you didn't request a password reset, you can safely ignore this email.</p>
        <hr style="border: none; border-top: 1px solid #eee; margin: 32px 0 16px;" />
        <p style="font-size: 12px; color: #aaa; line-height: 1.5;">If the button doesn't work, copy and paste this link into your browser:<br /><a href="${link}" style="color: #736fe6; word-break: break-all;">${link}</a></p>
      </div>
    `,
  });
}

export async function sendVerificationEmail(to, link, username) {
  const transporter = createTransporter();
  await transporter.sendMail({
    from: `"TreeOS" <${process.env.EMAIL_USER}>`,
    to,
    subject: "Complete Your Registration",
    html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto; padding: 40px 20px;">
        <div style="text-align: center; margin-bottom: 32px;">
          <h1 style="font-size: 24px; color: #1a1a1a; margin: 8px 0 0;">Tree</h1>
        </div>
        <p style="font-size: 16px; color: #333; line-height: 1.6;">Hey ${escapeHtml(username)}, thanks for signing up!</p>
        <p style="font-size: 16px; color: #333; line-height: 1.6;">Click the button below to verify your email and activate your account:</p>
        <div style="text-align: center; margin: 32px 0;">
          <a href="${link}" style="display: inline-block; background-color: #736fe6; color: white; text-decoration: none; padding: 14px 32px; border-radius: 980px; font-size: 16px; font-weight: 600;">Verify My Email</a>
        </div>
        <p style="font-size: 13px; color: #888; line-height: 1.5;">This link expires in 12 hours. If you didn't create this account, you can safely ignore this email.</p>
        <hr style="border: none; border-top: 1px solid #eee; margin: 32px 0 16px;" />
        <p style="font-size: 12px; color: #aaa; line-height: 1.5;">If the button doesn't work, copy and paste this link into your browser:<br /><a href="${link}" style="color: #736fe6; word-break: break-all;">${link}</a></p>
      </div>
    `,
  });
}

export { escapeHtml };
