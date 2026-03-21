import { Link } from "react-router-dom";
import "./PrivacySection.css";

const PrivacySection = () => {
  return (
    <div className="privacy-docs">
      <div className="privacy-docs-card">

        {/* ── HEADER ── */}
        <div className="privacy-docs-header">
          <div className="prv-icon">🔒</div>
          <h1 className="privacy-docs-title">Privacy Policy</h1>
          <div className="prv-last-updated">Last Updated: March 19, 2026</div>
        </div>

        {/* ── 1 ── */}
        <div className="prv-section">
          <div className="prv-section-title">1. Introduction</div>
          <div className="prv-section-text">
            This Privacy Policy explains how TreeOS ("Service", "we", "us", or "our") at {new URL(import.meta.env.VITE_TREE_FRONTEND_DOMAIN).hostname} collects, uses, stores, and protects your information when you use the Service.
            <br /><br />
            By using the Service, you consent to the data practices described in this policy. If you do not agree, please do not use the Service.
          </div>
        </div>

        {/* ── 2 ── */}
        <div className="prv-section">
          <div className="prv-section-title">2. Information We Collect</div>
          <div className="prv-section-text">
            <strong>Account Information:</strong> When you create an account, we collect your username and email address.
            <br /><br />
            <strong>User Content:</strong> We store files, trees (node-based organizational structures), notes, AI chat conversations, and other content you create or upload through the Service.
            <br /><br />
            <strong>Payment Information:</strong> When you make a purchase, payment is processed by Stripe. We store Stripe payment session IDs to track transaction status, but we do not store your credit card number, CVV, or other full payment card details. Stripe's handling of your payment data is governed by <a href="https://stripe.com/privacy" className="prv-link" target="_blank" rel="noopener noreferrer">Stripe's Privacy Policy</a>.
            <br /><br />
            <strong>Passwords:</strong> We store your account password in an encrypted (hashed) format. We never store or have access to your plaintext password.
            <br /><br />
            <strong>API Keys:</strong> If you use custom LLM connections or programmatic API access, we store associated API keys. All API keys and passwords are encrypted at rest on our backend servers.
            <br /><br />
            <strong>Cryptocurrency Wallets:</strong> If you use Solana-related features, your wallet private keys are stored securely on our backend servers. We use the Jupiter API to facilitate Solana transactions and actions.
            <br /><br />
            <strong>Technical Information:</strong> We may collect your IP address, browser type, device information, and general usage data to operate and improve the Service.
          </div>
        </div>

        {/* ── 3 ── */}
        <div className="prv-section">
          <div className="prv-section-title">3. Cookies &amp; Authentication</div>
          <div className="prv-section-text">
            We use cookies and similar browser storage to operate the Service. For example, we store:
            <br /><br />
            <strong>Authentication Token (JWT):</strong> A secure token used to keep you logged in across sessions.
            <br /><br />
            <strong>Username:</strong> Stored locally for display and session purposes.
            <br /><br />
            <strong>Share Token:</strong> Used to enable shared URL access to your content for others you choose to share with.
            <br /><br />
            These cookies are essential to the functioning of the Service. We do not use advertising cookies or third-party tracking cookies. By using the Service, you consent to the use of these essential cookies.
          </div>
        </div>

        {/* ── 4 ── */}
        <div className="prv-section">
          <div className="prv-section-title">4. How We Use Your Information</div>
          <div className="prv-section-text">
            We use the information we collect to: provide, operate, and maintain the Service; authenticate your identity and manage your sessions; process purchases and manage your plan and energy status; store and serve your uploaded files and user content; communicate with you regarding your account or the Service; and detect and prevent fraud, abuse, or violations of our Terms of Service.
            <br /><br />
            We do not sell, rent, or trade your personal information to third parties.
          </div>
        </div>

        {/* ── 5 ── */}
        <div className="prv-section">
          <div className="prv-section-title">5. File Storage</div>
          <div className="prv-section-text">
            Files, trees (which are composed of individual nodes), notes, AI chat conversations, and other content you upload or generate through the Service are stored on our servers to provide the Service to you. Your content is associated with your account and is not publicly accessible unless you explicitly share it via a share token or other sharing feature.
            <br /><br />
            We do not access, review, or use your uploaded content for any purpose other than providing the Service, unless required by law.
          </div>
        </div>

        {/* ── 6 ── */}
        <div className="prv-section">
          <div className="prv-section-title">6. Data Retention</div>
          <div className="prv-section-text">
            We retain your account information, user content, and uploaded files for as long as your account is active or as needed to provide the Service.
            <br /><br />
            If you delete your account, we will make reasonable efforts to delete your personal data and uploaded files within 30 days, except where we are required to retain certain information by law or for legitimate business purposes (such as fraud prevention or resolving disputes).
            <br /><br />
            Stripe payment session IDs may be retained for record-keeping and dispute resolution purposes.
          </div>
        </div>

        {/* ── 7 ── */}
        <div className="prv-section">
          <div className="prv-section-title">7. Data Security</div>
          <div className="prv-section-text">
            We take reasonable measures to protect your information, including: using HTTPS encryption for all data transmitted between your browser and our servers; storing authentication tokens securely; hashing all account passwords so plaintext passwords are never stored or accessible; encrypting all API keys (including custom LLM connection keys and programmatic access keys) at rest on our backend; securely storing Solana wallet private keys on our backend infrastructure; and relying on Stripe for PCI-compliant payment processing.
            <br /><br />
            However, no method of transmission or storage is 100% secure. We cannot guarantee absolute security and are not liable for unauthorized access resulting from circumstances beyond our reasonable control.
          </div>
        </div>

        {/* ── 8 ── */}
        <div className="prv-section">
          <div className="prv-section-title">8. Third-Party Services</div>
          <div className="prv-section-text">
            The Service uses the following third-party provider:
            <br /><br />
            <strong>Stripe</strong> — for payment processing. Stripe may collect and process your payment information in accordance with their own privacy policy. We encourage you to review <a href="https://stripe.com/privacy" className="prv-link" target="_blank" rel="noopener noreferrer">Stripe's Privacy Policy</a>.
            <br /><br />
            <strong>Jupiter API</strong> — for facilitating Solana blockchain transactions and actions. Jupiter may process transaction data in accordance with their own policies.
            <br /><br />
            We do not embed third-party advertising, analytics, or social media trackers.
          </div>
        </div>

        {/* ── 9 ── */}
        <div className="prv-section">
          <div className="prv-section-title">9. Cryptocurrency &amp; Solana Wallet Disclaimer</div>
          <div className="prv-section-text">
            The Service may provide features that interact with the Solana blockchain via the Jupiter API. Solana wallet private keys are stored securely on our backend servers to facilitate these features on your behalf.
            <br /><br />
            By using any cryptocurrency-related features, you acknowledge and agree that:
            <br /><br />
            <strong>No Liability for Loss:</strong> Tree is not responsible for any loss, theft, or unauthorized access to cryptocurrency funds, whether resulting from technical failures, security breaches, blockchain network issues, market volatility, smart contract errors, or any other cause.
            <br /><br />
            <strong>No Financial Advice:</strong> The Service does not provide financial, investment, or trading advice. Any cryptocurrency transactions you initiate through the Service are made at your own risk and discretion.
            <br /><br />
            <strong>Blockchain Irreversibility:</strong> Transactions on the Solana blockchain are irreversible. Once a transaction is confirmed on-chain, it cannot be undone, cancelled, or refunded by Tree.
            <br /><br />
            <strong>Use at Your Own Risk:</strong> Cryptocurrency features are provided on an "as-is" basis. You are solely responsible for evaluating the risks associated with using these features and for any resulting gains or losses.
          </div>
          <div className="prv-highlight">
            <div className="prv-section-text">
              <strong>Tree is not liable for any loss of cryptocurrency funds under any circumstances.</strong> By using wallet or blockchain features, you accept full responsibility for all associated risks.
            </div>
          </div>
        </div>

        {/* ── 10 ── */}
        <div className="prv-section">
          <div className="prv-section-title">10. Your Rights</div>
          <div className="prv-section-text">
            You have the right to:
            <br /><br />
            <strong>Access:</strong> Request a copy of the personal data we hold about you.
            <br /><br />
            <strong>Correction:</strong> Request correction of inaccurate personal data.
            <br /><br />
            <strong>Account Deletion:</strong> Request deletion of your account profile data, including your password, email address, and other personal identifiers. We will process deletion requests within 30 days, subject to any legal retention requirements.
            <br /><br />
            <strong>Content Retention:</strong> Please be aware that trees (nodes), notes, AI chat conversations, and other user-generated content cannot be deleted upon account deletion. This content is interconnected with other users' structures and plans within the Service, and removing it would compromise the integrity of shared and dependent data. By using the Service and creating content, you acknowledge and accept this limitation.
            <br /><br />
            To exercise any of these rights, contact us at treeffiency@gmail.com.
          </div>
          <div className="prv-highlight">
            <div className="prv-section-text">
              <strong>Profile data (password, email, etc.) can be deleted on request.</strong> Trees, nodes, notes, AI chats, and other interconnected content are retained permanently as they are integral to the Service's shared data structures.
            </div>
          </div>
        </div>

        {/* ── 11 ── */}
        <div className="prv-section">
          <div className="prv-section-title">11. EU Users (GDPR)</div>
          <div className="prv-section-text">
            If you are located in the European Economic Area (EEA), the United Kingdom, or Switzerland, you have additional rights under the General Data Protection Regulation (GDPR):
            <br /><br />
            <strong>Legal Basis for Processing:</strong> We process your data based on: contractual necessity (to provide the Service and fulfill purchases), legitimate interests (to operate, secure, and improve the Service), and your consent (where applicable, such as accepting cookies).
            <br /><br />
            <strong>Additional Rights:</strong> In addition to the rights listed in Section 10, you may have the right to restrict processing of your data, object to processing based on legitimate interests, withdraw consent at any time where processing is based on consent, and lodge a complaint with your local data protection authority.
            <br /><br />
            <strong>Data Transfers:</strong> Your data may be transferred to and stored on servers located outside the EEA. By using the Service, you consent to this transfer. We take reasonable steps to ensure your data is treated securely and in accordance with this policy.
            <br /><br />
            To exercise your GDPR rights, contact us at treeffiency@gmail.com.
          </div>
        </div>

        {/* ── 12 ── */}
        <div className="prv-section">
          <div className="prv-section-title">12. California Users (CCPA)</div>
          <div className="prv-section-text">
            If you are a California resident, you have rights under the California Consumer Privacy Act (CCPA):
            <br /><br />
            <strong>Right to Know:</strong> You may request what personal information we collect, use, and disclose.
            <br /><br />
            <strong>Right to Delete:</strong> You may request deletion of your personal information, subject to certain exceptions.
            <br /><br />
            <strong>Right to Non-Discrimination:</strong> We will not discriminate against you for exercising your CCPA rights.
            <br /><br />
            <strong>No Sale of Personal Information:</strong> We do not sell your personal information to third parties as defined under the CCPA.
            <br /><br />
            To submit a CCPA request, contact us at treeffiency@gmail.com.
          </div>
        </div>

        {/* ── 13 ── */}
        <div className="prv-section">
          <div className="prv-section-title">13. Children's Privacy</div>
          <div className="prv-section-text">
            The Service is not directed to children under 18. We do not knowingly collect personal information from anyone under 18. If we become aware that we have collected data from a minor, we will take steps to delete it promptly. If you believe a minor has provided us with personal data, please contact us at treeffiency@gmail.com.
          </div>
        </div>

        {/* ── 14 ── */}
        <div className="prv-section">
          <div className="prv-section-title">14. Changes to This Policy</div>
          <div className="prv-section-text">
            We may update this Privacy Policy from time to time. Changes will be posted on this page with an updated "Last Updated" date. Continued use of the Service after changes means you accept the updated policy.
          </div>
        </div>

        {/* ── 15 ── */}
        <div className="prv-section">
          <div className="prv-section-title">15. Contact</div>
          <div className="prv-section-text">
            If you have questions about this Privacy Policy or wish to exercise your rights, contact us:
            <br /><br />
            <strong>TreeOS</strong><br />
            Email: treeffiency@gmail.com<br />
            Website: {new URL(import.meta.env.VITE_TREE_FRONTEND_DOMAIN).hostname}
          </div>
        </div>

     
        

      </div>
    </div>
  );
};

export default PrivacySection;