export default {
  name: "gateway-email",
  version: "1.0.0",
  builtFor: "treeos-connect",
  description:
    "Registers the email channel type with the gateway core, enabling trees to send and " +
    "receive messages over email. Output channels send notifications via SMTP using " +
    "nodemailer. Any SMTP server works: Gmail, Outlook, SendGrid, Mailgun, Postmark, " +
    "AWS SES, or self-hosted. SMTP credentials can be set globally via environment " +
    "variables (SMTP_HOST, SMTP_USER, SMTP_PASS) or overridden per channel for " +
    "multi-account setups." +
    "\n\n" +
    "Input channels receive inbound email via webhook. The extension exposes a public " +
    "endpoint at POST /api/v1/gateway/email/:channelId that accepts payloads from any " +
    "major email service. A normalizer detects the payload format automatically: SendGrid " +
    "Inbound Parse (multipart form with from/subject/text), Mailgun Routes (form with " +
    "sender/body-plain), Postmark Inbound (JSON with From/Subject/TextBody), AWS SES via " +
    "SNS (nested JSON with mail.source and content), or raw JSON (from/subject/text). " +
    "SNS subscription confirmations are auto-confirmed. Each channel generates a unique " +
    "webhook secret on creation for verifying inbound posts via query parameter or header." +
    "\n\n" +
    "Input-output channels close the loop. When an inbound email is processed through the " +
    "tree orchestrator and produces a reply, the extension sends that reply back to the " +
    "original sender as an email with a \"Re:\" subject line, using the same SMTP " +
    "configuration. A from-filter on the channel config optionally restricts which sender " +
    "addresses or domains are accepted, preventing unwanted inbound traffic. The email " +
    "subject line is prepended to the message text as context so the AI sees the topic. " +
    "Sender names are extracted from the From header (\"John Doe <john@example.com>\" " +
    "becomes \"John Doe\") for clean attribution in the gateway pipeline.",

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
