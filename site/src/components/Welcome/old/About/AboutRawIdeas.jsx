
import "./AboutRawIdeas.css";

const AboutRawIdeas = () => {
  return (
    <div className="about-raw-ideas">
      <div className="ari-card">

        {/* ── BACK ── */}
        <div className="al-page-back">
          <a className="al-back-link" href="/about">←</a>
        </div>

        {/* ── HEADER ── */}
        <div className="ari-header">
          <h2 className="ari-title">💡 Raw Ideas</h2>
          <p className="ari-subtitle">
            Drop in thoughts or files. The AI finds the right place in your
            trees and places them — no manual sorting required.
          </p>
        </div>

        {/* ── WHAT ARE RAW IDEAS ── */}
        <div className="ari-section">
          <div className="ari-section-text">
            You can place raw ideas in the dashboard on your profile home.
            These are notes where you don't want to assign them to a specific
            tree, or maybe you're copying AI chats or context from another
            site. They live outside of your trees and are deposited in
            automatically every 15 minutes. The Raw Idea Orchestrator will choose the best tree you have and hand it off, or reject if no trees match.
          </div>
        </div>

        {/* ── HOW IT WORKS ── */}
        <div className="ari-section">
          <div className="ari-section-title">
            <span className="ari-section-icon">⚙️</span> How It Works
          </div>

          <div className="ari-steps-list">

            <div className="ari-step-card">
              <div className="ari-step-num">01</div>
              <div className="ari-step-body">
                <div className="ari-step-title">Capture a thought or file</div>
                <div className="ari-step-desc">
                  Paste any text — a task, idea, or note — or attach a file. Both are stored as raw ideas. Only text ideas can be auto-placed by AI; files can be transferred manually.
                </div>
                <div className="ari-chip-row">
                  <span className="ari-chip text">"repaint the living room"</span>
                  <span className="ari-chip text">"book flights for August"</span>
                  <span className="ari-chip file">📎 notes.pdf</span>
                </div>
              </div>
            </div>

            <div className="ari-step-connector" />

            <div className="ari-step-card">
              <div className="ari-step-num">02</div>
              <div className="ari-step-body">
                <div className="ari-step-title">AI picks the best-fit tree</div>
                <div className="ari-step-desc">
                  The orchestrator scores every tree you own against the idea's content. If no tree scores above 35% confidence the idea is marked <strong>Stuck</strong> and you can place it manually.
                </div>
                <div className="ari-score-row">
                  <div className="ari-score-item dimmed">
                    <TreeIcon color="rgba(255,255,255,0.35)" />
                    <span className="ari-score-name">Work</span>
                    <span className="ari-score-pct">8%</span>
                  </div>
                  <div className="ari-score-item selected">
                    <TreeIcon color="rgba(130,170,255,1)" />
                    <span className="ari-score-name">Travel</span>
                    <span className="ari-score-pct selected">94% ✓</span>
                  </div>
                  <div className="ari-score-item dimmed">
                    <TreeIcon color="rgba(255,255,255,0.35)" />
                    <span className="ari-score-name">Home</span>
                    <span className="ari-score-pct">19%</span>
                  </div>
                </div>
              </div>
            </div>

            <div className="ari-step-connector" />

            <div className="ari-step-card">
              <div className="ari-step-num">03</div>
              <div className="ari-step-body">
                <div className="ari-step-title">Tree orchestrator places it</div>
                <div className="ari-step-desc">
                  The tree orchestrator navigates the chosen tree, finds the most relevant node, and places the idea as a note. It can create new branches when no existing node is a good fit.
                </div>
                <div className="ari-tree-mini">
                  <div className="ari-mini-node root">
                    <span className="ari-mini-dot blue" /> Travel
                  </div>
                  <div className="ari-mini-indent">
                    <div className="ari-mini-node">
                      <span className="ari-mini-dot green" /> Summer Trip
                    </div>
                    <div className="ari-mini-indent">
                      <div className="ari-mini-node">Accommodation</div>
                      <div className="ari-mini-node placed">
                        <span className="ari-mini-dot amber" /> Flights ✦
                        <span className="ari-mini-badge">placed</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

          </div>
        </div>

        {/* ── OUTCOMES ── */}
        <div className="ari-section">
          <div className="ari-section-title">
            <span className="ari-section-icon">🎯</span> Outcomes
          </div>
          <div className="ari-outcomes-grid">
            <div className="ari-outcome-card succeeded">
              <div className="ari-outcome-dot" />
              <div>
                <div className="ari-outcome-label">Succeeded</div>
                <div className="ari-outcome-desc">Placed on a node. A full AI decision trace is saved to your Chat History.</div>
              </div>
            </div>
            <div className="ari-outcome-card stuck">
              <div className="ari-outcome-dot" />
              <div>
                <div className="ari-outcome-label">Stuck</div>
                <div className="ari-outcome-desc">No tree scored above 35% or the tree rejected the idea. Place it manually with the transfer form.</div>
              </div>
            </div>
            <div className="ari-outcome-card processing">
              <div className="ari-outcome-dot" />
              <div>
                <div className="ari-outcome-label">Processing</div>
                <div className="ari-outcome-desc">AI is actively working on it. Delete and transfer are blocked until it finishes.</div>
              </div>
            </div>
          </div>
        </div>

        {/* ── PREMIUM ── */}
        <div className="ari-section ari-section--premium">
          <div className="ari-section-title">
            <span className="ari-section-icon">⚡</span> Premium Plan — Always Organised
          </div>
          <div className="ari-section-text">
            Premium Plan users don't need to manually trigger Auto-place. The server processes pending text raw ideas into your trees automatically every 15 minutes — even when you're not logged in.
          </div>
        </div>

        {/* ── BACK LINK ── */}
        <div className="ari-back-links">
          <a className="ari-back-link" href="/about">← Back to About</a>
        </div>

      </div>
    </div>
  );
};

const TreeIcon = ({ color }) => (
  <svg width="22" height="26" viewBox="0 0 24 28" fill="none">
    <line x1="12" y1="26" x2="12" y2="10" stroke={color} strokeWidth="1.5" />
    <line x1="12" y1="18" x2="6" y2="10" stroke={color} strokeWidth="1" />
    <line x1="12" y1="14" x2="18" y2="8" stroke={color} strokeWidth="1" />
    <circle cx="6" cy="9" r="2.5" fill={color} />
    <circle cx="18" cy="7" r="2.5" fill={color} />
    <circle cx="12" cy="9" r="2.5" fill={color} />
  </svg>
);

export default AboutRawIdeas;
