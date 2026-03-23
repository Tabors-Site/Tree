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
            A public orchestration system where people build, share, and run
            LLM complexity on a federated network. Not another chat window.
            Infrastructure where AI agents live, persist, and compound intelligence.
          </p>
          <div className="lp-hero-ctas">
            <button className="lp-btn lp-btn-primary" onClick={scrollToInstall}>Get Started</button>
            <a className="lp-btn lp-btn-secondary" href="/about">Learn More</a>
          </div>
          <a className="lp-hero-example" href="/app">
            Example App <span>built on the protocol</span>
          </a>
        </div>
      </section>

      {/* ── THE GAP ── */}
      <section className="lp-section">
        <div className="lp-container">
          <h2 className="lp-section-title">The Problem</h2>
          <p className="lp-section-sub lp-section-sub-wide">
            Every useful pattern for making AI agents smarter is locked inside private codebases.
            Memory compression, tool pipelines, orchestration chains. Every AI product runs the
            agent on their infrastructure, behind their API, inside their product. You use their
            agent in their house. Nobody is building the public orchestration layer.
          </p>
          <p className="lp-section-sub lp-section-sub-wide">
            TreeOS says: here is the kernel. Run your own house. Your agent lives with you. Connect to
            other houses through an open protocol. Share what you build. Install what others build.
            The intelligence compounds across the network.
          </p>
        </div>
      </section>

      {/* ── WHAT IS TREEOS ── */}
      <section className="lp-section lp-section-alt">
        <div className="lp-container">
          <h2 className="lp-section-title">Core Concepts</h2>
          <div className="lp-cards-3">
            <div className="lp-card">
              <h3>The Kernel</h3>
              <p>
                Trees, nodes, notes (text or file), and the AI conversation loop.
                The minimum structure an agent needs to live somewhere persistent.
                Navigate with <code>cd</code> and <code>ls</code>. Build with <code>mkdir</code>.
                Six node types tell agents what they are looking at.
                Extensions add values, schedules, scripts, and more through metadata.
              </p>
            </div>
            <div className="lp-card">
              <h3>Extensions</h3>
              <p>
                Packaged units of LLM complexity. An understanding run, a script sandbox,
                a wallet integration, a dream cycle. Each one is a folder with a manifest.
                Install it, restart, and both human and agent gain new capabilities.
              </p>
            </div>
            <div className="lp-card">
              <h3>Lands</h3>
              <p>
                Sovereign instances of TreeOS. You run yours. Someone else runs theirs.
                Each land chooses its own extensions, manages its own trees, runs its own AI.
                No central authority. Your land, your packages, your call.
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
          <h2 className="lp-section-title">Get Running</h2>
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
                <p>Name it. Type it. Navigate with cd and ls. Build branches with mkdir. Add notes (text or files).</p>
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
            npm let developers stop rewriting the same JavaScript functions. TreeOS does
            the same thing for agent orchestration. Instead of sharing code that humans run,
            you share capabilities that agents run, on a persistent structure that agents inhabit.
          </p>

          <div className="lp-ext-groups">
            <ExtGroup title="AI and Knowledge" items={[
              { name: "understanding", desc: "Bottom-up tree compression" },
              { name: "dreams", desc: "Daily background maintenance", href: "/about/dreams" },
              { name: "raw-ideas", desc: "Capture and auto-place", href: "/about/raw-ideas" },
            ]} />
            <ExtGroup title="Developer" items={[
              { name: "scripts", desc: "Sandboxed JS on nodes" },
              { name: "api-keys", desc: "Programmatic access" },
              { name: "prestige", desc: "Node versioning" },
              { name: "schedules", desc: "Dates and calendar" },
            ]} />
            <ExtGroup title="Data" items={[
              { name: "values", desc: "Numeric values and goals" },
              { name: "transactions", desc: "Value trades between nodes" },
              { name: "energy", desc: "Usage metering", href: "/about/energy" },
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
            ]} />
          </div>

          <div className="lp-ext-cta">
            <a href="/about/extensions">Extension docs</a>
          </div>
        </div>
      </section>

      {/* ── FOR DIFFERENT AUDIENCES ── */}
      <section className="lp-section">
        <div className="lp-container">
          <h2 className="lp-section-title">Who Is This For?</h2>
          <div className="lp-cards-3">
            <div className="lp-card">
              <h3>Developers</h3>
              <p>
                A modular runtime for persistent AI agents with a federated extension
                system. The kernel manages tree-structured data and an MCP-based AI loop.
                Extensions register their own tools, routes, models, and jobs.
              </p>
            </div>
            <div className="lp-card">
              <h3>AI Builders</h3>
              <p>
                Every orchestration pattern you build dies in your repo.
                TreeOS makes orchestration composable and shareable. Package your
                memory system, your reasoning chain, your tool pipeline as an extension.
                Publish it. Now every agent on the network can use it.
              </p>
            </div>
            <div className="lp-card">
              <h3>Everyone Else</h3>
              <p>
                The internet was built for documents.
                AI agents need persistent structure, memory, tools, and the ability
                to interact with other agents. TreeOS is what the internet
                might look like if it were designed for agents from the start.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ── FEDERATION ── */}
      <section className="lp-section lp-section-alt">
        <div className="lp-container">
          <h2 className="lp-section-title">The Network</h2>
          <p className="lp-section-sub">
            The Canopy Protocol is how lands discover and peer with each other.
            Lands advertise their loaded extensions. The foundation for capability-aware
            federation where agents can navigate between lands, carrying context
            and discovering what tools exist at each destination.
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

      {/* ── POSITIONING ── */}
      <section className="lp-section">
        <div className="lp-container">
          <div className="lp-positioning">
            <div className="lp-pos-item">
              <h4>"Why not just use ChatGPT?"</h4>
              <p>
                Those are products where you visit an AI in someone else's house.
                TreeOS is infrastructure where the AI lives in yours. The agent persists.
                It accumulates context. It gains capabilities through extensions you choose.
                It federates through an open protocol. It is not a chat product. It is the
                layer beneath chat products.
              </p>
            </div>
            <div className="lp-pos-item">
              <h4>"Why not just self-host a model?"</h4>
              <p>
                A model is a brain with no body. TreeOS is the body. The persistent structure,
                the memory, the tools, the network. It is model-agnostic. The kernel runs an AI
                conversation loop via MCP. What model powers it is your choice on your land.
              </p>
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
              <h4>Protocol</h4>
              <a href="/about/node-types">Node Types</a>
              <a href="/about/gateway">Gateway</a>
              <a href="/about/land">Land and Canopy</a>
              <a href="/about/extensions">Extensions</a>
            </div>
            <div className="lp-footer-col">
              <h4>Network</h4>
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
        {item.href ? (
          <a href={item.href} className="lp-ext-name lp-ext-link">{item.name}</a>
        ) : (
          <span className="lp-ext-name">{item.name}</span>
        )}
        <span className="lp-ext-desc">{item.desc}</span>
      </div>
    ))}
  </div>
);

export default LandingPage;
