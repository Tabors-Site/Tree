import { Link } from "react-router-dom";
import "./TermsSection.css";

const TermsSection = () => {
  return (
    <div className="terms-docs">
      <div className="terms-docs-card">

        {/* ── HEADER ── */}
        <div className="terms-docs-header">
          <div className="tos-icon">📜</div>
          <h1 className="terms-docs-title">Terms of Service</h1>
          <div className="tos-last-updated">Last Updated: February 13, 2026</div>
        </div>

        {/* ── 1 ── */}
        <div className="tos-section">
          <div className="tos-section-title">1. Overview</div>
          <div className="tos-section-text">
            Welcome to Tree ("Service", "we", "us", or "our"). By accessing or using the Service at tree.tabors.site, you agree to these Terms of Service ("Terms"). If you do not agree, please do not use the Service.
            <br /><br />
            Tree is a web-based platform that provides digital organizational features including trees, notes, and usage-based energy credits. All purchases grant access to features within the Service and do not represent ownership of any real-world asset.
            <br /><br />
            You must be at least 18 years old to use the Service.
          </div>
        </div>

        {/* ── 2 ── */}
        <div className="tos-section">
          <div className="tos-section-title">2. Accounts</div>
          <div className="tos-section-text">
            You are responsible for maintaining the security of your account and any activity that occurs under it. You agree to provide accurate information and keep your login credentials confidential.
            <br /><br />
            We reserve the right to suspend or terminate accounts that violate these Terms or engage in abuse, fraud, or harmful activity.
          </div>
        </div>

        {/* ── 3 ── */}
        <div className="tos-section">
          <div className="tos-section-title">3. Energy System &amp; Digital Purchases</div>
          <div className="tos-section-text">
            Tree operates on an energy-based usage system. Energy is consumed as you interact with the Service. Your daily energy allowance resets automatically once every 24 hours. If more than 24 hours have passed since your last reset, the reset will occur the next time you access the Service, and the 24-hour reset period will then be measured from that reset time.
            <br /><br />
            The Service offers the following purchasable options:
            <br /><br />
            Plan names and features, daily energy amounts, usage limits, energy costs, and pricing are described within the Service interface and may change from time to time at our discretion.
            <br /><br />
            <strong>30-Day Energy Plans</strong> — Time-limited plans that grant access to enhanced features and a higher daily energy allowance for 30 days from the date of purchase. Plans automatically expire after 30 days. Upon expiration, your account reverts to the basic tier.
            <br /><br />
            <strong>Additional Energy (Reserve)</strong> — One-time purchases of bonus energy that supplements your plan. Reserve energy is only consumed after your plan's daily available energy has been fully used. Reserve energy does not expire and remains available unless the account is terminated for violation of these Terms.
            <br /><br />
            All purchases are digital, non-transferable, and non-redeemable for cash. They are provided solely for use within the Service and are subject to change or modification at our discretion.
            <br /><br />
            Payments are securely processed by Stripe. We do not store full payment card details. Prices, taxes, and availability may vary by region and may change at any time.
          </div>
        </div>

        {/* ── 4 ── */}
        <div className="tos-section">
          <div className="tos-section-title">4. Plans, Expiration &amp; Usage Limits</div>
          <div className="tos-section-text">
            <strong>Plan Duration:</strong> 30-day plans grant 30 days of enhanced access from the date of purchase.
            <br /><br />
            <strong>Stacking Plans:</strong> If you purchase the same plan you already have, the new 30 days are added to your remaining time. For example, if you have 12 days left and buy another 30-day plan, you will have 42 days remaining.
            <br /><br />
            <strong>Upgrading Plans:</strong> If you upgrade to a higher-tier plan, your remaining days on the current plan are converted into additional (reserve) energy. The conversion is calculated as: days remaining × the daily energy allowance of your current plan. The new higher-tier plan then begins immediately with its own 30-day duration.
            <br /><br />
            <strong>Daily Energy Reset:</strong> Your plan's daily energy allowance resets every 24 hours from the time of your last daily reset. Unused daily energy does not roll over after the reset.
            <br /><br />
            <strong>Reserve Energy:</strong> Additional purchased energy acts as a reserve and is only drawn upon once your plan's daily energy allocation is fully consumed.
            <br /><br />
            <strong>Downgrade on Expiration:</strong> When a plan expires, your account returns to the basic tier with standard energy limits and feature access. Any remaining additional (reserve) energy you have purchased will carry over and remain available after downgrade. No partial refunds are given for unused time.
            <br /><br />
            By purchasing, you acknowledge that digital features may be consumed immediately upon access.
          </div>
        </div>

        {/* ── 5 ── */}
        <div className="tos-section">
          <div className="tos-section-title">5. Refund Policy</div>
          <div className="tos-section-text">
            All purchases are final and non-refundable. Because purchases provide immediate access to digital features and energy, no refunds will be issued under any circumstances, including unused plan time, unused reserve energy, dissatisfaction with the Service, or cases where the Service is modified, suspended, or discontinued.
          </div>
          <div className="tos-highlight">
            <div className="tos-section-text">
              <strong>No refunds.</strong> By completing a purchase, you acknowledge and agree that all sales are final.
            </div>
          </div>
        </div>

        {/* ── 6 ── */}
        <div className="tos-section">
          <div className="tos-section-title">6. Acceptable Use</div>
          <div className="tos-section-text">
            You agree not to: abuse, exploit, or interfere with the Service; attempt to reverse engineer or disrupt platform functionality; use automated scraping, bots, or unauthorized automation; manipulate the energy system or exploit bugs for unearned credits; or upload or distribute illegal or harmful content.
            <br /><br />
            Violation may result in suspension or permanent account termination without notice or refund.
          </div>
        </div>

        {/* ── 7 ── */}
        <div className="tos-section">
          <div className="tos-section-title">7. Intellectual Property</div>
          <div className="tos-section-text">
            All content, software, design, and branding within the Service remain the property of Tree or its licensors. You are granted a limited, non-exclusive license to use the Service for personal or authorized purposes.
          </div>
        </div>

        {/* ── 8 ── */}
        <div className="tos-section">
          <div className="tos-section-title">8. Service Availability</div>
          <div className="tos-section-text">
            The Service is provided on an "as-is" and "as-available" basis. We may update, modify, suspend, or discontinue features or the Service at any time without liability. We do not guarantee uninterrupted availability or error-free operation.
            <br /><br />
            <strong>Service Discontinuation:</strong> Tree reserves the right to suspend or permanently discontinue the Service, in whole or in part, at any time, with or without notice. In the event of service discontinuation, you acknowledge that access to the Service, including any unused plan time or energy, may be lost and no refunds will be issued.
          </div>
        </div>

        {/* ── 9 ── */}
        <div className="tos-section">
          <div className="tos-section-title">9. Limitation of Liability</div>
          <div className="tos-section-text">
            To the maximum extent permitted by law, Tree shall not be liable for indirect, incidental, or consequential damages, including loss of data, profits, or access resulting from use of the Service.
          </div>
        </div>

        {/* ── 10 ── */}
        <div className="tos-section">
          <div className="tos-section-title">10. Termination</div>
          <div className="tos-section-text">
            We may suspend or terminate access if you violate these Terms, engage in fraud, or create risk to the platform or other users. You may stop using the Service at any time. Termination does not entitle you to refunds for previously purchased digital features or unused energy.
          </div>
        </div>

        {/* ── 11 ── */}
        <div className="tos-section">
          <div className="tos-section-title">11. Privacy</div>
          <div className="tos-section-text">
            Your use of the Service is also governed by our{" "}
            <Link to="/privacy" className="tos-link">Privacy Policy</Link>,
            which explains how we collect, use, store, and protect your information.
          </div>
        </div>

        {/* ── 12 ── */}
        <div className="tos-section">
          <div className="tos-section-title">12. Changes to These Terms</div>
          <div className="tos-section-text">
            We may update these Terms periodically. Continued use of the Service after changes means you accept the updated Terms.
          </div>
        </div>

        {/* ── 13 ── */}
        <div className="tos-section">
          <div className="tos-section-title">13. Governing Law</div>
          <div className="tos-section-text">
            These Terms shall be governed by and construed in accordance with the laws of the State of <strong>Oregon</strong>, United States, without regard to its conflict of law principles.
          </div>
        </div>

        {/* ── 14 ── */}
        <div className="tos-section">
          <div className="tos-section-title">14. Contact</div>
          <div className="tos-section-text">
            If you have questions about these Terms, contact us:
            <br /><br />
            <strong>Tree</strong><br />
            Email: treeffiency@gmail.com<br />
            Website: tree.tabors.site
          </div>
        </div>

      

      </div>
    </div>
  );
};

export default TermsSection;