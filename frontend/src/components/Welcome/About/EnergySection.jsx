import { Link } from "react-router-dom";
import "./EnergySection.css";

const EnergySection = () => {
  return (
    <div className="energy-docs">
      <div className="energy-docs-card">

        {/* ── BACK ── */}
        <div className="al-page-back">
          <Link className="al-back-link" to="/about">←</Link>
        </div>

        {/* ── HEADER ── */}
        <div className="energy-docs-header">
          <h2 className="energy-docs-title">⚡ Energy System</h2>
          <p className="energy-docs-subtitle">
            Energy is how Tree meters usage. Every action costs a small amount
            of energy, and your balance resets daily based on your plan.
          </p>
        </div>

        {/* ── HOW IT WORKS ── */}
        <div className="nrg-section">
          <div className="nrg-section-title">
            <span className="nrg-section-icon">🔋</span> How Energy Works
          </div>
          <div className="nrg-section-text">
            Every write action in Tree costs energy. Your balance refills
            automatically once per day based on your plan.
           
          </div>

        
        </div>

        {/* ── COST TABLE ── */}
        <div className="nrg-section">
          <div className="nrg-section-title">
            <span className="nrg-section-icon">📊</span> Energy Costs
          </div>

          <div className="nrg-sub-title">Fixed Actions</div>
          <div className="nrg-cost-grid">
            <div className="nrg-cost-row">
              <span className="nrg-cost-action">Edit status, value, goal, name, schedule</span>
              <span className="nrg-cost-amount">1</span>
            </div>
            <div className="nrg-cost-row">
              <span className="nrg-cost-action">Move node, prestige, run script, invite</span>
              <span className="nrg-cost-amount">1</span>
            </div>
            <div className="nrg-cost-row">
              <span className="nrg-cost-action">Create node, delete branch, transaction</span>
              <span className="nrg-cost-amount">2</span>
            </div>
            <div className="nrg-cost-row">
              <span className="nrg-cost-action">AI chat message</span>
              <span className="nrg-cost-amount">2</span>
            </div>
               <div className="nrg-cost-row">
              <span className="nrg-cost-action">And More</span>
              <span className="nrg-cost-amount">+</span>
            </div>
          </div>
        </div>

        {/* ── PLANS ── */}
        <div className="nrg-section">
          <div className="nrg-section-title">
            <span className="nrg-section-icon">🎫</span> Plans
          </div>
          <div className="nrg-section-text">
            Your plan determines how much energy you receive each day. Tree
            offers three tiers:
          </div>

          <div className="nrg-plan-grid">
            <div className="nrg-plan">
              <div className="nrg-plan-name">Basic</div>
              <div className="nrg-plan-energy">120 / day</div>
              <div className="nrg-plan-desc">
                Free forever. Enough for daily note-taking, light tree
                management, and occasional AI chat. No file uploads.
              </div>
            </div>
            <div className="nrg-plan">
              <div className="nrg-plan-name">Standard</div>
              <div className="nrg-plan-energy">500 / day</div>
              <div className="nrg-plan-desc">
                For active users. File uploads up to 1 GB, more room for
                AI features, scripts, and larger trees.
              </div>
            </div>
            <div className="nrg-plan">
              <div className="nrg-plan-name">Premium</div>
              <div className="nrg-plan-energy">2,000 / day</div>
              <div className="nrg-plan-desc">
                For power users and teams. No file size limits, heavy AI
                usage, and large-scale understanding runs.
              </div>
            </div>
          </div>

          <div className="nrg-section-text" style={{ marginTop: "16px" }}>
            Plans can be purchased or upgraded through your profile page via
            Stripe. If your plan expires, you're automatically moved back to
            Basic and your daily energy resets accordingly.
          </div>
        </div>

        {/* ── ADDITIONAL ENERGY ── */}
        <div className="nrg-section">
          <div className="nrg-section-title">
            <span className="nrg-section-icon">🛒</span> Additional Energy
          </div>
          <div className="nrg-section-text">
            Need more energy beyond your daily refill? You can purchase
            additional energy packs through Stripe on your profile page.
            Additional energy doesn't expire daily — it sits in a separate
            balance and is only consumed after your daily energy runs out.
          </div>
        </div>

        {/* ── DAILY RESET ── */}
        <div className="nrg-section">
          <div className="nrg-section-title">
            <span className="nrg-section-icon">🔄</span> Daily Reset
          </div>
          <div className="nrg-section-text">
            Your daily energy refills to your plan's limit once every 24 hours,
            measured from your last reset. The reset replaces your daily balance
            — it does not stack. Additional purchased energy is not affected by
            the daily reset.
          </div>
        </div>

        {/* ── CUSTOM LLM ── */}
        <div className="nrg-section">
          <div className="nrg-section-title">
            <span className="nrg-section-icon">🧠</span> Bring Your Own LLM
          </div>
          <div className="nrg-section-text">
            If you connect your own LLM provider, <strong>AI actions bypass
            the energy system entirely</strong>. Understanding runs, AI chat,
            and any other AI-powered features route directly through your
            provider at your own cost — using zero Tree energy.
            <br /><br />
            This means you can run as many understanding passes, chat sessions,
            and AI analyses as your provider allows, with no daily cap. You
            also get to choose your model — bring a faster or more capable LLM
            if the default doesn't suit your workflow.
          </div>

          <div className="nrg-highlight">
            <div className="nrg-section-text">
              <strong>How to connect:</strong> Go to your profile page and add
              your provider's base URL, API key, and model name. You can
              enable, disable, or remove the connection at any time. Non-AI
              actions (creating nodes, posting notes, etc.) still use energy
              as normal.
            </div>
          </div>

          <div className="nrg-section-text" style={{ marginTop: "12px" }}>
            If your plan expires or downgrades to Basic, your custom LLM
            connection is automatically revoked. You can re-enable it after
            upgrading.
          </div>
        </div>

        {/* ── BACK LINK ── */}
        <div className="nrg-back-links">
          <Link className="nrg-back-link" to="/about">← Back to About</Link>
        </div>

      </div>
    </div>
  );
};

export default EnergySection;