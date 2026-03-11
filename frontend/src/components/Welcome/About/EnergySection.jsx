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
            Energy is how Tree meters usage. Most actions cost a small amount
            of energy, and your balance resets daily based on your plan.
          </p>
        </div>

        {/* ── HOW IT WORKS ── */}
        <div className="nrg-section">
          <div className="nrg-section-title">
            <span className="nrg-section-icon">🔋</span> How Energy Works
          </div>
          <div className="nrg-section-text">
            Tree operations like creating nodes, editing content, and running
            scripts cost energy. Your balance refills automatically once per
            day based on your plan.
          </div>
        </div>

        {/* ── AI CHAT ── */}
        <div className="nrg-section">
          <div className="nrg-section-title">
            <span className="nrg-section-icon">💬</span> AI Chat
          </div>
          <div className="nrg-section-text">
            Tree requires you to connect your own LLM provider to use AI
            features. You bring your own API key and pay your provider
            directly for LLM usage.
            <br /><br />
            <strong>Successful AI chat messages are free</strong> and do not
            cost energy. Tree operations triggered by the AI (creating nodes,
            editing notes, etc.) still cost energy as normal.
            <br /><br />
            If an AI call fails (bad endpoint, invalid key, etc.), 2 energy
            is charged to prevent abuse.
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
              <span className="nrg-cost-action">AI chat (only on connection error)</span>
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
                management, and AI chat. No file uploads.
              </div>
            </div>
            <div className="nrg-plan">
              <div className="nrg-plan-name">Standard</div>
              <div className="nrg-plan-energy">500 / day</div>
              <div className="nrg-plan-desc">
                For active users. File uploads up to 1 GB, more room for
                scripts, and larger trees.
              </div>
            </div>
            <div className="nrg-plan">
              <div className="nrg-plan-name">Premium</div>
              <div className="nrg-plan-energy">2,000 / day</div>
              <div className="nrg-plan-desc">
                For power users and teams. No file size limits and
                large-scale understanding runs.
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
            Additional energy doesn't expire daily. It sits in a separate
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
            and does not stack. Additional purchased energy is not affected by
            the daily reset.
          </div>
        </div>

        {/* ── LLM CONNECTIONS ── */}
        <div className="nrg-section">
          <div className="nrg-section-title">
            <span className="nrg-section-icon">🧠</span> LLM Connections
          </div>
          <div className="nrg-section-text">
            Tree requires you to connect your own LLM provider to use AI
            features like chat, understanding, dreams, and raw idea
            placement. You can use any OpenAI-compatible API endpoint.
            We recommend <strong>OpenRouter</strong> for the easiest
            setup. It gives you access to hundreds of models with one
            API key.
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
              <span className="nrg-cost-action">Profile Chat (used everywhere unless overridden)</span>
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
              <strong>How to connect:</strong> When you first sign up, the
              setup page will walk you through connecting your first LLM.
              You can manage connections and slot assignments anytime from
              your profile's energy page. Any OpenAI-compatible endpoint
              works. Just provide a base URL, API key, and model name.
            </div>
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
