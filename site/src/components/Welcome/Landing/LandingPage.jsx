import { useRef } from "react";
import "./LandingPage.css";

const LandingPage = () => {
  const installRef = useRef(null);

  const scrollToInstall = () => {
    installRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  return (
    <div className="lp">

      {/* ── BANNER ── */}
      <div className="lp-banner">
        TreeOS is launching in the next few days.
      </div>

      {/* ── HERO ── */}
      <section className="lp-hero">
        <div className="lp-hero-inner">
          <div className="lp-tree-icon">🌳</div>
          <h1 className="lp-title">TreeOS</h1>
          <p className="lp-subtitle">An Operating System for Context</p>
          <p className="lp-tagline">
            Persistent, structured memory that AI can navigate.
            Not another chat window. A filesystem for knowledge
            that compounds over time.
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
            A self-hosted system where you and AI build hierarchical
            knowledge structures. Trees replace flat conversations with
            navigable, persistent context.
          </p>
          <div className="lp-cards-3">
            <div className="lp-card">
              <h3>Trees</h3>
              <p>
                Nodes with notes, trackable values, and children. Navigate
                with <code>cd</code> and <code>ls</code>. Build with <code>mkdir</code>.
                Not flat files. Not chat logs. Structure that persists.
              </p>
            </div>
            <div className="lp-card">
              <h3>AI Modes</h3>
              <p>
                Three strict modes. <strong>Chat</strong> reads and writes.
                <strong> Place</strong> adds content without conversation.
                <strong> Query</strong> reads only, changes nothing.
              </p>
            </div>
            <div className="lp-card">
              <h3>Node Types</h3>
              <p>
                goal, plan, task, knowledge, resource, identity.
                Six core types. Custom types valid. Free-form strings
                that tell agents what they're looking at.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ── CLI ── */}
      <section className="lp-section lp-section-alt">
        <div className="lp-container">
          <h2 className="lp-section-title">Terminal Native</h2>
          <p className="lp-section-sub">
            The CLI works like a regular terminal. <code>cd</code>, <code>ls</code>,
            <code>mkdir</code>, <code>rm</code>, <code>mv</code>. If you know a shell,
            you know TreeOS.
          </p>
          <div className="lp-terminal">
            <div className="lp-term-header">
              <span className="lp-term-dot red"></span>
              <span className="lp-term-dot yellow"></span>
              <span className="lp-term-dot green"></span>
              <span className="lp-term-title">treeos</span>
            </div>
            <div className="lp-term-body">
              <div className="lp-term-line"><span className="lp-term-prompt">tabor@treeos.ai</span><span className="lp-term-path">/Goals</span> <span className="lp-term-caret">› </span>ls</div>
              <div className="lp-term-line lp-term-output">  Fitness  ·  Career  ·  Reading  ·  Side Projects</div>
              <div className="lp-term-line lp-term-output"></div>
              <div className="lp-term-line"><span className="lp-term-prompt">tabor@treeos.ai</span><span className="lp-term-path">/Goals</span> <span className="lp-term-caret">› </span>cd Fitness</div>
              <div className="lp-term-line"><span className="lp-term-prompt">tabor@treeos.ai</span><span className="lp-term-path">/Goals/Fitness</span> <span className="lp-term-caret">› </span>tree</div>
              <div className="lp-term-line lp-term-output lp-term-green">  Fitness</div>
              <div className="lp-term-line lp-term-output lp-term-green">  ├─ Chest Day</div>
              <div className="lp-term-line lp-term-output lp-term-dim">  ├─ Leg Day  (completed)</div>
              <div className="lp-term-line lp-term-output lp-term-green">  └─ Cardio</div>
              <div className="lp-term-line lp-term-output"></div>
              <div className="lp-term-line"><span className="lp-term-prompt">tabor@treeos.ai</span><span className="lp-term-path">/Goals/Fitness</span> <span className="lp-term-caret">› </span>chat "add a back and biceps routine"</div>
              <div className="lp-term-line lp-term-output"></div>
              <div className="lp-term-line lp-term-output">  Created: Back and Biceps</div>
              <div className="lp-term-line lp-term-output">    Pull-ups 4x8, Rows 3x10, Curls 3x12</div>
            </div>
          </div>
          <div className="lp-cli-features">
            <div className="lp-cli-feat">
              <strong>Navigate</strong> cd, ls, pwd, tree
            </div>
            <div className="lp-cli-feat">
              <strong>Build</strong> mkdir, rm, mv, rename, type
            </div>
            <div className="lp-cli-feat">
              <strong>Content</strong> note, notes, value, goal
            </div>
            <div className="lp-cli-feat">
              <strong>AI</strong> chat, place, query
            </div>
            <div className="lp-cli-feat">
              <strong>Extensions</strong> ext install, ext disable
            </div>
            <div className="lp-cli-feat">
              <strong>LLM</strong> llm add, llm assign
            </div>
          </div>
        </div>
      </section>

      {/* ── HOW IT WORKS ── */}
      <section className="lp-section">
        <div className="lp-container">
          <h2 className="lp-section-title">How It Works</h2>
          <div className="lp-steps">
            <div className="lp-step">
              <div className="lp-step-num">1</div>
              <div className="lp-step-content">
                <h4>Start a Land</h4>
                <p>Your server. Stores trees, runs AI, serves the API. First boot walks you through config and extension selection.</p>
                <code>treeos land</code>
              </div>
            </div>
            <div className="lp-step">
              <div className="lp-step-num">2</div>
              <div className="lp-step-content">
                <h4>Connect</h4>
                <p>Point the CLI at any land. Register. Connect your own LLM or use the tree owner's model.</p>
                <code>treeos connect http://localhost:3000</code>
              </div>
            </div>
            <div className="lp-step">
              <div className="lp-step-num">3</div>
              <div className="lp-step-content">
                <h4>Plant a Tree</h4>
                <p>Name it. Type it. Navigate with cd and ls. Build branches with mkdir. Add notes and track values.</p>
                <code>treeos mkroot "Fitness" --type goal</code>
              </div>
            </div>
            <div className="lp-step">
              <div className="lp-step-num">4</div>
              <div className="lp-step-content">
                <h4>Use It</h4>
                <p>Chat creates and edits. Place adds content where it belongs. Query reads without changing anything. You and AI work the same tree.</p>
                <code>treeos chat "break this into weekly tasks"</code>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── EXTENSIONS ── */}
      <section className="lp-section lp-section-alt">
        <div className="lp-container">
          <h2 className="lp-section-title">Extensions</h2>
          <p className="lp-section-sub">
            Core protocol: nodes, notes, values, types, AI modes.
            Everything else is a package you install, disable, or build.
          </p>

          <div className="lp-ext-groups">
            <ExtGroup title="AI and Knowledge" items={[
              { name: "understanding", desc: "Bottom-up tree compression" },
              { name: "dreams", desc: "Daily background maintenance" },
              { name: "raw-ideas", desc: "Capture and auto-place" },
            ]} />
            <ExtGroup title="Developer" items={[
              { name: "scripts", desc: "Sandboxed JS on nodes" },
              { name: "api-keys", desc: "Programmatic access" },
              { name: "prestige", desc: "Node versioning" },
              { name: "schedules", desc: "Dates and calendar" },
            ]} />
            <ExtGroup title="Finance" items={[
              { name: "energy", desc: "Usage metering" },
              { name: "billing", desc: "Stripe subscriptions" },
              { name: "solana", desc: "On-chain wallets" },
            ]} />
            <ExtGroup title="Content" items={[
              { name: "blog", desc: "Land-level posts" },
              { name: "book", desc: "Shareable note exports" },
              { name: "html-rendering", desc: "Server-rendered pages" },
            ]} />
            <ExtGroup title="System" items={[
              { name: "user-llm", desc: "Custom model connections" },
              { name: "user-queries", desc: "Notes, tags, chats" },
              { name: "deleted-revive", desc: "Soft delete and recovery" },
              { name: "visibility", desc: "Public/private trees" },
              { name: "transaction-policy", desc: "Trade approval rules" },
            ]} />
          </div>

          <div className="lp-ext-cta">
            <a href="/about/extensions">Extension docs</a>
          </div>
        </div>
      </section>

      {/* ── FOR OPERATORS / FOR USERS ── */}
      <section className="lp-section">
        <div className="lp-container">
          <h2 className="lp-section-title">Two Ways In</h2>
          <div className="lp-split">
            <div className="lp-split-card">
              <h3>Run Your Own Land</h3>
              <p>
                Self-host. Pick extensions from the registry.
                Your data, your models, your rules.
              </p>
              <div className="lp-terminal-mini">
                <div className="lp-term-line">npm install -g treeos</div>
                <div className="lp-term-line">treeos land</div>
              </div>
              <a href="/about/land" className="lp-split-link">Land setup guide</a>
            </div>
            <div className="lp-split-card">
              <h3>Join a Land</h3>
              <p>
                Connect to an existing land. Register, bring your own
                LLM or use the tree owner's. Start building.
              </p>
              <div className="lp-terminal-mini">
                <div className="lp-term-line">npm install -g treeos</div>
                <div className="lp-term-line">treeos connect https://treeos.ai</div>
                <div className="lp-term-line">treeos register</div>
              </div>
              <a href="/about/gettingstarted" className="lp-split-link">Getting started</a>
            </div>
          </div>
        </div>
      </section>

      {/* ── FEDERATION ── */}
      <section className="lp-section lp-section-alt">
        <div className="lp-container">
          <h2 className="lp-section-title">Network</h2>
          <p className="lp-section-sub">
            Lands connect through the Canopy protocol. The directory handles
            discovery, public tree indexing, and the extension registry.
          </p>
          <div className="lp-cards-4">
            <div className="lp-card lp-card-sm">
              <h4>Peer</h4>
              <p>Direct land-to-land connections. Signed requests.</p>
            </div>
            <div className="lp-card lp-card-sm">
              <h4>Discover</h4>
              <p>Search lands and public trees across the network.</p>
            </div>
            <div className="lp-card lp-card-sm">
              <h4>Collaborate</h4>
              <p>Cross-land invites. Remote contributions. AI proxy.</p>
            </div>
            <div className="lp-card lp-card-sm">
              <h4>Registry</h4>
              <p>Publish and pull extensions. Shared package library.</p>
            </div>
          </div>
        </div>
      </section>

      {/* ── INSTALL CTA ── */}
      <section className="lp-section" ref={installRef}>
        <div className="lp-container">
          <h2 className="lp-section-title">Get Started</h2>
          <p className="lp-section-sub">One package. Two commands.</p>
          <div className="lp-terminal">
            <div className="lp-term-header">
              <span className="lp-term-dot red"></span>
              <span className="lp-term-dot yellow"></span>
              <span className="lp-term-dot green"></span>
              <span className="lp-term-title">Terminal</span>
            </div>
            <div className="lp-term-body">
              <div className="lp-term-line"><span className="lp-term-prompt">$</span> npm install -g treeos</div>
              <div className="lp-term-line lp-term-output"></div>
              <div className="lp-term-line lp-term-comment"># Start a land (server)</div>
              <div className="lp-term-line"><span className="lp-term-prompt">$</span> treeos land</div>
              <div className="lp-term-line lp-term-output"></div>
              <div className="lp-term-line lp-term-output">  Welcome to TreeOS.</div>
              <div className="lp-term-line lp-term-output">  Domain (localhost): _</div>
              <div className="lp-term-line lp-term-output"></div>
              <div className="lp-term-line lp-term-comment"># Or connect to an existing land</div>
              <div className="lp-term-line"><span className="lp-term-prompt">$</span> treeos connect https://treeos.ai</div>
              <div className="lp-term-line"><span className="lp-term-prompt">$</span> treeos register</div>
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
              <a href="/about/api">API</a>
              <a href="/about/cli">CLI</a>
              <a href="/about/extensions">Extensions</a>
            </div>
            <div className="lp-footer-col">
              <h4>System</h4>
              <a href="/about/node-types">Node Types</a>
              <a href="/about/energy">Energy</a>
              <a href="/about/dreams">Dreams</a>
              <a href="/about/gateway">Gateway</a>
            </div>
            <div className="lp-footer-col">
              <h4>Network</h4>
              <a href="/about/land">Land and Canopy</a>
              <a href="https://dir.treeos.ai">Directory</a>
              <a href="/blog">Blog</a>
            </div>
            <div className="lp-footer-col">
              <h4>Source</h4>
              <a href="https://github.com/Tabors-Site/Tree">GitHub</a>
              <a href="https://github.com/Tabors-Site/Tree/blob/main/LICENSE">AGPL-3.0 License</a>
            </div>
          </div>
          <div className="lp-footer-bottom">
            TreeOS . AGPL-3.0 . Tabor Holly
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
