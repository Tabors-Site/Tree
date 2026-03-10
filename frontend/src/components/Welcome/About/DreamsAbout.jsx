import { Link } from "react-router-dom";
import "./DreamsAbout.css";

const DreamsAbout = () => {
  return (
    <div className="about-dreams">
      <div className="drm-card">

        {/* ── BACK ── */}
        <div className="al-page-back">
          <Link className="al-back-link" to="/about">←</Link>
        </div>

        {/* ── HEADER ── */}
        <div className="drm-header">
          <h2 className="drm-title">💤 Tree Dreams</h2>
          <p className="drm-subtitle">
            While you sleep, your trees maintain themselves. The dream cycle
            cleans up structure, drains pending thoughts, and refreshes the
            AI's understanding automatically, once a day.
          </p>
        </div>

        {/* ── SETTING DREAM TIME ── */}
        <div className="drm-section">
          <div className="drm-section-title">
            <span className="drm-section-icon">🕐</span> Setting Dream Time
          </div>
          <div className="drm-section-text">
            Each tree can have its own dream time, a daily schedule for when
            background maintenance runs. Set it on your root node's settings
            page using 24-hour <code>HH:MM</code> format (e.g. <code>03:00</code> for
            3 AM).
          </div>
          <div className="drm-code-block">
            <span className="drm-code-label">API</span>
            <code>POST /api/v1/root/:rootId/dream-time</code>
            <div className="drm-code-body">{`{ "dreamTime": "03:00" }`}</div>
          </div>
          <div className="drm-section-text drm-note">
            Pass <code>null</code> or omit the field to disable dreaming for a tree.
            Trees with fewer than 2 children are skipped automatically.
            The server checks every 30 minutes. Once the clock passes your
            dream time and the tree hasn't dreamed today, it begins.
          </div>
        </div>

        {/* ── SHORT-TERM MEMORY ── */}
        <div className="drm-section">
          <div className="drm-section-title">
            <span className="drm-section-icon">🧠</span> Short-Term Memory
          </div>
          <div className="drm-section-text">
            When you chat with a tree or place a raw idea, not everything has
            an obvious home right away. Sometimes the context is ambiguous, the
            idea spans multiple branches, or the AI just isn't confident enough
            to commit it to a specific node.
            <br /><br />
            Instead of forcing a bad placement, the system stores these items as
            <strong> short-term memories</strong> on the root node. Each one
            holds the original content, where it came from (chat, raw idea, etc.),
            and any early placement candidates the AI considered.
          </div>

          <div className="drm-memory-examples">
            <div className="drm-memory-item">
              <span className="drm-memory-source chat">chat</span>
              <span className="drm-memory-content">"we should also think about backup plans"</span>
            </div>
            <div className="drm-memory-item">
              <span className="drm-memory-source idea">raw idea</span>
              <span className="drm-memory-content">"compare pricing tiers for all three vendors"</span>
            </div>
          </div>

          <div className="drm-section-text" style={{ marginTop: 16 }}>
            These memories sit in a pending queue until the next dream. During
            the drain phase, the AI revisits each one with full tree context,
            groups related items together, scouts for the best placement, builds
            a plan, and commits them into the tree as notes or new nodes.
            <br /><br />
            Items that fail placement 3 times get escalated and skipped so they
            don't block the rest of the queue.
          </div>

          <div className="drm-status-row">
            <div className="drm-status-chip pending">
              <span className="drm-status-dot" />
              Pending
            </div>
            <div className="drm-status-chip placed">
              <span className="drm-status-dot" />
              Placed
            </div>
            <div className="drm-status-chip escalated">
              <span className="drm-status-dot" />
              Escalated
            </div>
            <div className="drm-status-chip dismissed">
              <span className="drm-status-dot" />
              Dismissed
            </div>
          </div>
        </div>

        {/* ── THE PIPELINE ── */}
        <div className="drm-section">
          <div className="drm-section-title">
            <span className="drm-section-icon">⚙️</span> The Dream Pipeline
          </div>
          <div className="drm-section-text" style={{ marginBottom: 18 }}>
            Every dream runs three phases in order. Each phase can run
            multiple passes until no more work remains.
          </div>

          <div className="drm-steps-list">

            {/* PHASE 1 */}
            <div className="drm-step-card">
              <div className="drm-step-num">01</div>
              <div className="drm-step-body">
                <div className="drm-step-title">Cleanup</div>
                <div className="drm-step-desc">
                  Two sub-stages run back to back, up to 5 passes each:
                </div>
                <div className="drm-sub-steps">
                  <div className="drm-sub-step">
                    <span className="drm-sub-dot reorganize" />
                    <div>
                      <strong>Reorganize</strong> consolidates small or redundant
                      nodes. Moves children to better parents, merges duplicates,
                      and deletes empty branches.
                    </div>
                  </div>
                  <div className="drm-sub-step">
                    <span className="drm-sub-dot expand" />
                    <div>
                      <strong>Expand</strong> finds sparse or thin branches and
                      creates sub-nodes to give them more structure. Turns flat
                      lists into meaningful hierarchies.
                    </div>
                  </div>
                </div>
                <div className="drm-step-note">
                  Passes stop early when neither sub-stage makes any changes.
                  The tree is considered stable.
                </div>
              </div>
            </div>

            <div className="drm-step-connector" />

            {/* PHASE 2 */}
            <div className="drm-step-card">
              <div className="drm-step-num">02</div>
              <div className="drm-step-body">
                <div className="drm-step-title">Short-Term Drain</div>
                <div className="drm-step-desc">
                  Processes any pending <strong>ShortMemory</strong> items that
                  accumulated from chat or raw ideas. Runs up to 5 passes.
                </div>
                <div className="drm-pipeline-row">
                  <div className="drm-pipe-stage">Cluster</div>
                  <div className="drm-pipe-arrow">→</div>
                  <div className="drm-pipe-stage">Scout</div>
                  <div className="drm-pipe-arrow">→</div>
                  <div className="drm-pipe-stage">Plan</div>
                  <div className="drm-pipe-arrow">→</div>
                  <div className="drm-pipe-stage">Build</div>
                  <div className="drm-pipe-arrow">→</div>
                  <div className="drm-pipe-stage">Place</div>
                </div>
                <div className="drm-step-note">
                  Items that fail 3 times are escalated and skipped.
                  Passes stop when no pending items remain.
                </div>
              </div>
            </div>

            <div className="drm-step-connector" />

            {/* PHASE 3 */}
            <div className="drm-step-card">
              <div className="drm-step-num">03</div>
              <div className="drm-step-body">
                <div className="drm-step-title">Understanding Run</div>
                <div className="drm-step-desc">
                  The AI builds a compressed semantic map of the entire tree.
                  It processes every node bottom up, leaves first, then parents,
                  merging child summaries layer by layer until a single root
                  encoding remains.
                </div>
                <div className="drm-tree-visual">
                  <div className="drm-layer">
                    <span className="drm-layer-label">Root encoding</span>
                    <span className="drm-layer-node root">●</span>
                  </div>
                  <div className="drm-layer-arrow">↑ merge</div>
                  <div className="drm-layer">
                    <span className="drm-layer-label">Layer 1</span>
                    <span className="drm-layer-node">●</span>
                    <span className="drm-layer-node">●</span>
                    <span className="drm-layer-node">●</span>
                  </div>
                  <div className="drm-layer-arrow">↑ merge</div>
                  <div className="drm-layer">
                    <span className="drm-layer-label">Leaves</span>
                    <span className="drm-layer-node leaf">●</span>
                    <span className="drm-layer-node leaf">●</span>
                    <span className="drm-layer-node leaf">●</span>
                    <span className="drm-layer-node leaf">●</span>
                    <span className="drm-layer-node leaf">●</span>
                  </div>
                </div>
                <div className="drm-step-note">
                  You can run understandings from any perspective you choose, but
                  the dream run is specifically tuned for navigation. It encodes
                  each node's role in the bigger picture so the AI has richer
                  semantic context when traversing the tree in future conversations.
                  <br /><br />
                  Uses incremental mode so only nodes that changed since the last
                  dream are reprocessed. Costs 1 energy per node understood.
                </div>
              </div>
            </div>

          </div>
        </div>

        {/* ── SAFEGUARDS ── */}
        <div className="drm-section">
          <div className="drm-section-title">
            <span className="drm-section-icon">🔒</span> Safeguards
          </div>
          <div className="drm-safeguards-grid">
            <div className="drm-safeguard-card">
              <div className="drm-safeguard-icon">🔐</div>
              <div>
                <div className="drm-safeguard-label">One at a time</div>
                <div className="drm-safeguard-desc">
                  An in-memory lock prevents concurrent dreams on the same tree.
                  If a dream is already running, new triggers are skipped.
                </div>
              </div>
            </div>
            <div className="drm-safeguard-card">
              <div className="drm-safeguard-icon">📅</div>
              <div>
                <div className="drm-safeguard-label">Once per day</div>
                <div className="drm-safeguard-desc">
                  Each tree records <code>lastDreamAt</code>. The scheduler
                  won't re-trigger until the next calendar day.
                </div>
              </div>
            </div>
            <div className="drm-safeguard-card">
              <div className="drm-safeguard-icon">🌱</div>
              <div>
                <div className="drm-safeguard-label">Minimum size</div>
                <div className="drm-safeguard-desc">
                  Trees with fewer than 2 top-level children are
                  skipped. No point dreaming on an empty tree.
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* ── PER-MODE LLM ── */}
        <div className="drm-section">
          <div className="drm-section-title">
            <span className="drm-section-icon">🤖</span> Custom LLMs Per Stage
          </div>
          <div className="drm-section-text">
            Each dream phase uses the tree's per-mode LLM assignments. You can
            assign different models to different stages, like a smart  model for
            cleanup and a fast model for understanding:
          </div>
          <div className="drm-llm-grid">
            <div className="drm-llm-slot">
              <span className="drm-llm-phase">Cleanup</span>
              <span className="drm-llm-key">cleanup</span>
            </div>
            <div className="drm-llm-slot">
              <span className="drm-llm-phase">Drain</span>
              <span className="drm-llm-key">drain</span>
            </div>
            <div className="drm-llm-slot">
              <span className="drm-llm-phase">Understanding</span>
              <span className="drm-llm-key">understanding</span>
            </div>
          </div>
          <div className="drm-section-text drm-note">
            If no custom LLM is assigned for a stage, it falls back to the
            tree's <code>placement</code> slot, then your account default.
          </div>
        </div>

        {/* ── BACK LINK ── */}
        <div className="drm-back-links">
          <Link className="drm-back-link" to="/about">← Back to About</Link>
        </div>

      </div>
    </div>
  );
};

export default DreamsAbout;
