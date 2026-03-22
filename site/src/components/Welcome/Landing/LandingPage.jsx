import { useRef } from "react";
import "./LandingPage.css";

const LandingPage = () => {
  const installRef = useRef(null);

  const scrollToInstall = () => {
    installRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  return (
    <div className="lp">

      {/* ── HERO ── */}
      <section className="lp-hero">
        <div className="lp-hero-inner">
          <div className="lp-tree-icon">🌳</div>
          <h1 className="lp-title">TreeOS</h1>
          <p className="lp-subtitle">An Operating System for Context</p>
          <p className="lp-tagline">
            Build living trees of knowledge. Your AI navigates, organizes, and grows them.
          </p>
          <div className="lp-hero-ctas">
            <button className="lp-btn lp-btn-primary" onClick={scrollToInstall}>Get Started</button>
            <a className="lp-btn lp-btn-secondary" href="/about">Learn More</a>
          </div>
        </div>
      </section>

      {/* ── WHAT IS TREEOS ── */}
      <section className="lp-section">
        <div className="lp-container">
          <h2 className="lp-section-title">What is TreeOS?</h2>
          <p className="lp-section-sub">
            A self-hosted knowledge system where AI and humans build structured trees of context together.
          </p>
          <div className="lp-cards-3">
            <div className="lp-card">
              <div className="lp-card-icon">🌿</div>
              <h3>Trees</h3>
              <p>
                Hierarchical structures with nodes, notes, values, and goals.
                Not flat files. Not chat logs. Living, navigable knowledge.
              </p>
            </div>
            <div className="lp-card">
              <div className="lp-card-icon">🤖</div>
              <h3>AI Modes</h3>
              <p>
                Three interaction modes. <strong>Chat</strong> reads and writes.
                <strong> Place</strong> adds content. <strong>Query</strong> reads only.
                Clear boundaries on what AI can do.
              </p>
            </div>
            <div className="lp-card">
              <div className="lp-card-icon">🏷️</div>
              <h3>Types</h3>
              <p>
                Six core types: goal, plan, task, knowledge, resource, identity.
                Free-form strings. Custom types valid. The tree programs its own agents.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ── HOW IT WORKS ── */}
      <section className="lp-section lp-section-alt">
        <div className="lp-container">
          <h2 className="lp-section-title">How It Works</h2>
          <div className="lp-steps">
            <div className="lp-step">
              <div className="lp-step-num">1</div>
              <div className="lp-step-content">
                <h4>Start a Land</h4>
                <p>A land is your server. It stores trees, runs AI, exposes an API. One command to boot.</p>
                <code>npm land</code>
              </div>
            </div>
            <div className="lp-step">
              <div className="lp-step-num">2</div>
              <div className="lp-step-content">
                <h4>Connect and Register</h4>
                <p>Point the CLI at your land. Create an account. Connect your own LLM or use the tree owner's.</p>
                <code>treeos connect http://localhost:3000</code>
              </div>
            </div>
            <div className="lp-step">
              <div className="lp-step-num">3</div>
              <div className="lp-step-content">
                <h4>Plant Your First Tree</h4>
                <p>Name it, type it, and you're in. The AI starts building structure from your first message.</p>
                <code>treeos chat "help me plan my week"</code>
              </div>
            </div>
            <div className="lp-step">
              <div className="lp-step-num">4</div>
              <div className="lp-step-content">
                <h4>Grow Over Time</h4>
                <p>Background processes compress, reorganize, and dream on your trees while you sleep. Knowledge compounds.</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── EXTENSIONS ── */}
      <section className="lp-section">
        <div className="lp-container">
          <h2 className="lp-section-title">Extensions</h2>
          <p className="lp-section-sub">
            The core protocol handles nodes, notes, values, types, and AI modes.
            Everything else is an extension you install, disable, or build yourself.
          </p>

          <div className="lp-ext-groups">
            <ExtGroup title="AI and Knowledge" items={[
              { name: "understanding", desc: "Bottom-up tree compression" },
              { name: "dreams", desc: "Daily background maintenance" },
              { name: "raw-ideas", desc: "Capture and auto-place ideas" },
            ]} />
            <ExtGroup title="Developer" items={[
              { name: "scripts", desc: "Sandboxed JS on nodes" },
              { name: "api-keys", desc: "Programmatic access keys" },
              { name: "prestige", desc: "Node versioning" },
              { name: "schedules", desc: "Date scheduling and calendar" },
            ]} />
            <ExtGroup title="Finance" items={[
              { name: "energy", desc: "Usage metering and limits" },
              { name: "billing", desc: "Stripe subscriptions" },
              { name: "solana", desc: "On-chain wallets per node" },
            ]} />
            <ExtGroup title="Content" items={[
              { name: "blog", desc: "Land-level posts" },
              { name: "book", desc: "Shareable note compilations" },
              { name: "html-rendering", desc: "Server-rendered pages" },
            ]} />
            <ExtGroup title="System" items={[
              { name: "user-llm", desc: "Custom LLM connections" },
              { name: "user-queries", desc: "Notes, tags, chats, notifications" },
              { name: "deleted-revive", desc: "Soft delete and recovery" },
              { name: "visibility", desc: "Public/private trees" },
              { name: "transaction-policy", desc: "Trade approval rules" },
            ]} />
          </div>

          <div className="lp-ext-cta">
            <a href="/about/extensions">Full extension docs</a>
          </div>
        </div>
      </section>

      {/* ── FOR OPERATORS / FOR USERS ── */}
      <section className="lp-section lp-section-alt">
        <div className="lp-container">
          <h2 className="lp-section-title">Two Ways In</h2>
          <div className="lp-split">
            <div className="lp-split-card">
              <h3>Run Your Own Land</h3>
              <p>
                Self-host your server. Choose extensions from the registry.
                Full control over data, models, and who can join.
              </p>
              <div className="lp-terminal-mini">
                <div className="lp-term-line">git clone https://github.com/Tabors-Site/Tree</div>
                <div className="lp-term-line">npm run install:all</div>
                <div className="lp-term-line">npm land</div>
              </div>
              <a href="/about/land" className="lp-split-link">Land setup guide</a>
            </div>
            <div className="lp-split-card">
              <h3>Join a Land</h3>
              <p>
                Connect to someone else's land. Register, bring your own LLM or use
                the tree owner's. Start building trees immediately.
              </p>
              <div className="lp-terminal-mini">
                <div className="lp-term-line">npm install -g treeos</div>
                <div className="lp-term-line">treeos connect https://treeos.ai</div>
                <div className="lp-term-line">treeos register</div>
              </div>
              <a href="/about/gettingstarted" className="lp-split-link">Getting started guide</a>
            </div>
          </div>
        </div>
      </section>

      {/* ── FEDERATION ── */}
      <section className="lp-section">
        <div className="lp-container">
          <h2 className="lp-section-title">Federation</h2>
          <p className="lp-section-sub">
            Lands connect to each other through the Canopy protocol. Browse public trees
            across the network, collaborate remotely, discover new lands through the directory.
          </p>
          <div className="lp-cards-3">
            <div className="lp-card lp-card-sm">
              <h4>Peer</h4>
              <p>Add other lands as peers. Direct connections, signed requests.</p>
            </div>
            <div className="lp-card lp-card-sm">
              <h4>Discover</h4>
              <p>The directory service indexes lands and public trees. Search across the network.</p>
            </div>
            <div className="lp-card lp-card-sm">
              <h4>Collaborate</h4>
              <p>Invite users from other lands to contribute to your trees. Cross-land AI proxy.</p>
            </div>
          </div>
        </div>
      </section>

      {/* ── INSTALL CTA ── */}
      <section className="lp-section lp-section-alt" ref={installRef}>
        <div className="lp-container">
          <h2 className="lp-section-title">Get Started</h2>
          <p className="lp-section-sub">Three commands. Your land is running.</p>
          <div className="lp-terminal">
            <div className="lp-term-header">
              <span className="lp-term-dot red"></span>
              <span className="lp-term-dot yellow"></span>
              <span className="lp-term-dot green"></span>
              <span className="lp-term-title">Terminal</span>
            </div>
            <div className="lp-term-body">
              <div className="lp-term-line"><span className="lp-term-prompt">$</span> git clone https://github.com/Tabors-Site/Tree && cd Tree</div>
              <div className="lp-term-line"><span className="lp-term-prompt">$</span> npm run install:all</div>
              <div className="lp-term-line"><span className="lp-term-prompt">$</span> npm land</div>
              <div className="lp-term-line lp-term-output"></div>
              <div className="lp-term-line lp-term-output">  Welcome to TreeOS.</div>
              <div className="lp-term-line lp-term-output">  First-run setup. Answer a few questions to configure your Land.</div>
              <div className="lp-term-line lp-term-output"></div>
              <div className="lp-term-line lp-term-output">  Domain (localhost): _</div>
            </div>
          </div>
        </div>
      </section>

      {/* ── FOOTER ── */}
      <footer className="lp-footer">
        <div className="lp-container">
          <div className="lp-footer-grid">
            <div className="lp-footer-col">
              <h4>Docs</h4>
              <a href="/about/gettingstarted">Getting Started</a>
              <a href="/about/api">API Reference</a>
              <a href="/about/cli">CLI Guide</a>
              <a href="/about/extensions">Extensions</a>
            </div>
            <div className="lp-footer-col">
              <h4>Learn</h4>
              <a href="/about/node-types">Node Types</a>
              <a href="/about/energy">Energy System</a>
              <a href="/about/dreams">Tree Dreams</a>
              <a href="/about/gateway">Gateway</a>
            </div>
            <div className="lp-footer-col">
              <h4>Community</h4>
              <a href="/about/land">Land and Canopy</a>
              <a href="/blog">Blog</a>
              <a href="https://github.com/Tabors-Site/Tree">GitHub</a>
            </div>
            <div className="lp-footer-col">
              <h4>Legal</h4>
              <a href="/terms">Terms</a>
              <a href="/privacy">Privacy</a>
            </div>
          </div>
          <div className="lp-footer-bottom">
            TreeOS . AGPL-3.0 . Built by Tabor Holly
          </div>
        </div>
      </footer>
    </div>
  );
};

const ExtGroup = ({ title, items }) => (
  <div className="lp-ext-group">
    <h4 className="lp-ext-group-title">{title}</h4>
    {items.map((item) => (
      <div key={item.name} className="lp-ext-item">
        <span className="lp-ext-name">{item.name}</span>
        <span className="lp-ext-desc">{item.desc}</span>
      </div>
    ))}
  </div>
);

export default LandingPage;
