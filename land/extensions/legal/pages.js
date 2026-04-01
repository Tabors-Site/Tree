import { page } from "../html-rendering/html/layout.js";
import { baseStyles, responsiveBase } from "../html-rendering/html/baseStyles.js";

const legalCss = `
  ${baseStyles}
  ${responsiveBase}
  .legal-container {
    max-width: 720px;
    margin: 0 auto;
    padding: 40px 24px;
    color: rgba(255,255,255,0.8);
    font-size: 15px;
    line-height: 1.9;
  }
  .legal-container h1 {
    font-size: 28px;
    font-weight: 700;
    color: white;
    margin-bottom: 24px;
  }
  .legal-container h2 {
    font-size: 18px;
    font-weight: 600;
    color: white;
    margin: 28px 0 12px;
  }
  .legal-container p {
    margin-bottom: 16px;
    color: rgba(255,255,255,0.7);
  }
  .legal-container ul {
    margin: 12px 0 16px 24px;
    color: rgba(255,255,255,0.65);
  }
  .legal-container li {
    margin-bottom: 6px;
  }
  .legal-container a {
    color: rgba(74, 222, 128, 0.9);
  }
`;

export function renderTermsPage() {
  return page({
    title: "Terms of Service",
    css: legalCss,
    body: `
    <div class="legal-container">
      <h1>Terms of Service</h1>
      <p>Last updated: March 2026</p>

      <h2>1. Acceptance</h2>
      <p>By using this TreeOS land, you agree to these terms. If you do not agree, do not use the service.</p>

      <h2>2. The Service</h2>
      <p>TreeOS is an open source operating system for AI agents. This land is an instance operated by its owner. Your data is stored on this land's database. The land operator controls what extensions are installed and how the service runs.</p>

      <h2>3. Your Data</h2>
      <p>You own your data. Trees, notes, and contributions belong to you. The land operator stores your data to provide the service. You can export your data at any time using the seed-export extension if installed.</p>

      <h2>4. AI Usage</h2>
      <p>This service uses AI language models. AI responses are generated and may contain errors. Do not rely on AI output for medical, legal, or financial decisions. The land operator configures which AI models are used.</p>

      <h2>5. Acceptable Use</h2>
      <p>Do not use this service to:</p>
      <ul>
        <li>Store illegal content</li>
        <li>Attempt to access other users' data</li>
        <li>Abuse API rate limits or consume excessive resources</li>
        <li>Reverse engineer the security mechanisms</li>
      </ul>

      <h2>6. Termination</h2>
      <p>The land operator may terminate your account at any time. You may delete your account at any time.</p>

      <h2>7. Open Source</h2>
      <p>TreeOS is licensed under AGPL-3.0. The source code is available at <a href="https://github.com/taborgreat/create-treeos">GitHub</a>.</p>

      <h2>8. No Warranty</h2>
      <p>This service is provided as-is. No guarantees of uptime, data preservation, or AI accuracy.</p>
    </div>`,
    js: "",
  });
}

export function renderPrivacyPage() {
  return page({
    title: "Privacy Policy",
    css: legalCss,
    body: `
    <div class="legal-container">
      <h1>Privacy Policy</h1>
      <p>Last updated: March 2026</p>

      <h2>1. What We Collect</h2>
      <ul>
        <li>Username and password (password is hashed with bcrypt)</li>
        <li>Email address (if the email extension is installed)</li>
        <li>Tree content: nodes, notes, contributions, metadata</li>
        <li>AI conversation history (stored per session)</li>
        <li>Usage patterns (if inverse-tree or analytics extensions are installed)</li>
      </ul>

      <h2>2. How We Use It</h2>
      <p>Your data is used to provide the service. Tree content is sent to AI language models for conversation. The land operator configures which models and endpoints are used.</p>

      <h2>3. Data Storage</h2>
      <p>All data is stored in the land's MongoDB database. Data stays on the land operator's infrastructure unless federation (Canopy) is enabled, in which case data may be shared with peered lands as configured.</p>

      <h2>4. Third Parties</h2>
      <p>AI model providers receive your conversation content. The land operator chooses which providers to use. No data is sold to third parties.</p>

      <h2>5. Your Rights</h2>
      <ul>
        <li>Access your data through the API or HTML interface</li>
        <li>Export your trees using seed-export</li>
        <li>Delete your account and data</li>
        <li>Request information about what data is stored</li>
      </ul>

      <h2>6. Cookies</h2>
      <p>A JWT authentication cookie is used for login sessions. No tracking cookies. No analytics cookies unless explicitly installed by the land operator.</p>

      <h2>7. Contact</h2>
      <p>Contact the land operator for privacy questions.</p>
    </div>`,
    js: "",
  });
}
