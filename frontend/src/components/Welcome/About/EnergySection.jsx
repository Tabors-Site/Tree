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
            If you connect your own LLM provider, <strong>AI chat energy
            costs are bypassed</strong>. The LLM calls route through your
            provider at your own cost instead of consuming Tree energy.
            Tree operations triggered by the AI (creating nodes, editing
            notes, etc.) still cost energy as normal.
            <br /><br />
            This means you can chat, run understanding passes, and use
            AI features as much as your provider allows, while only
            paying energy for the tree changes that result from them.
          </div>

          <div className="nrg-sub-title" style={{ marginTop: "20px" }}>LLM Slots</div>
          <div className="nrg-section-text">
            Tree supports multiple LLM connections so you can use different
            models for different tasks. There are two levels of assignment:
          </div>

          <div className="nrg-cost-grid" style={{ marginTop: "12px" }}>
            <div className="nrg-cost-row">
              <span className="nrg-cost-action"><strong>Profile LLMs</strong></span>
            </div>
            <div className="nrg-cost-row">
              <span className="nrg-cost-action">Default (used everywhere unless overridden)</span>
            </div>
            <div className="nrg-cost-row">
              <span className="nrg-cost-action">Raw Ideas (auto-placement of raw ideas)</span>
            </div>
          </div>

          <div className="nrg-cost-grid" style={{ marginTop: "12px" }}>
            <div className="nrg-cost-row">
              <span className="nrg-cost-action"><strong>Per-Tree LLMs</strong></span>
            </div>
            <div className="nrg-cost-row">
              <span className="nrg-cost-action">Placement (creating and organizing nodes)</span>
            </div>
            <div className="nrg-cost-row">
              <span className="nrg-cost-action">Respond (conversation and chat)</span>
            </div>
            <div className="nrg-cost-row">
              <span className="nrg-cost-action">Notes (writing and editing notes)</span>
            </div>
            <div className="nrg-cost-row">
              <span className="nrg-cost-action">Understanding (compression and encoding)</span>
            </div>
            <div className="nrg-cost-row">
              <span className="nrg-cost-action">Cleanup (expand and reorganize)</span>
            </div>
            <div className="nrg-cost-row">
              <span className="nrg-cost-action">Drain (short-term memory placement)</span>
            </div>
          </div>

          <div className="nrg-section-text" style={{ marginTop: "14px" }}>
            Each tree can have its own LLM for each stage. If a tree slot
            isn't set, it falls back to the tree's placement LLM, then to
            your profile default. This lets you use a fast, cheap model for
            bulk operations like cleanup and a more capable one for
            conversation or understanding.
          </div>

          <div className="nrg-highlight">
            <div className="nrg-section-text">
              <strong>How to connect:</strong> Go to your profile page to add
              LLM providers with a base URL, API key, and model name. Then
              assign them to profile slots or per-tree slots in the tree
              settings. You can enable, disable, or swap connections at any
              time. Non-AI actions (creating nodes, posting notes, etc.)
              still use energy as normal.
            </div>
          </div>

          <div className="nrg-section-text" style={{ marginTop: "12px" }}>
            If your plan expires or downgrades to Basic, your custom LLM
            connections are automatically revoked. You can re-enable them
            after upgrading.
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