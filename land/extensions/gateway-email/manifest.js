export default {
  name: "gateway-email",
  version: "1.0.0",
  description: "Email channel type for the gateway. SMTP sending, webhook-based receiving. Works with SendGrid, Mailgun, Postmark, AWS SES, or any SMTP server.",

  needs: {
    extensions: ["gateway"],
  },

  optional: {},

  provides: {
    models: {},
    routes: false,
    tools: false,
    jobs: false,
    orchestrator: false,
    energyActions: {},
    sessionTypes: {},
    env: [
      { key: "SMTP_HOST", required: false, description: "SMTP server hostname (e.g., smtp.gmail.com, smtp.sendgrid.net)" },
      { key: "SMTP_PORT", required: false, default: "587", description: "SMTP port (587 for TLS, 465 for SSL, 25 for unencrypted)" },
      { key: "SMTP_USER", required: false, description: "SMTP username or API key name" },
      { key: "SMTP_PASS", required: false, secret: true, description: "SMTP password or API key" },
      { key: "SMTP_FROM", required: false, description: "Default from address (e.g., notifications@yourdomain.com)" },
      { key: "EMAIL_INBOUND_SECRET", required: false, secret: true, autoGenerate: true, description: "Shared secret for verifying inbound email webhooks" },
    ],
    cli: [],
  },
};
