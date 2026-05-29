import "./LandingPage.css";
import Particles from "./Particles.jsx";

const LandPage = () => {
  return (
    <div className="lp">

      {/* ── HERO ── */}
      <section className="lp-hero" style={{minHeight: "60vh"}}>
        <Particles count={25} />
        <div className="lp-hero-inner">
          <div className="lp-tree-icon">🏔</div>
          <h1 className="lp-title">Your Land</h1>
          <p className="lp-subtitle">
            A land is your server. It stores your trees, runs your AI, hosts your
            extensions, and connects to the network. You own it. Your data stays on it.
          </p>
          <div className="lp-hero-ctas">
            <a className="lp-btn lp-btn-primary" href="#start">Start a Land</a>
            <a className="lp-btn lp-btn-secondary" href="/guide">Read the Guide</a>
          </div>
        </div>
      </section>

      {/* ── WHAT IS A LAND ── */}
      <section className="lp-section">
        <div className="lp-container">
          <h2 className="lp-section-title">What is a land</h2>
          <div className="lp-cards-3">
            <div className="lp-card">
              <div className="lp-card-icon">🖥</div>
              <h3>Your server</h3>
              <p>
                A land is a Node.js server connected to MongoDB. It runs on your machine,
                your VPS, or any hosting provider. You control it.
              </p>
            </div>
            <div className="lp-card">
              <div className="lp-card-icon">🌳</div>
              <h3>Your trees</h3>
              <p>
                Trees live on your land. Your notes, your nodes, your conversations, your
                AI context. Nothing leaves unless you peer with another land.
              </p>
            </div>
            <div className="lp-card">
              <div className="lp-card-icon">🧠</div>
              <h3>Your AI</h3>
              <p>
                You connect your own LLM. OpenAI, Anthropic, Ollama, any OpenAI-compatible
                endpoint. The AI thinks at every position in your tree using the model you chose.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ── WHAT YOU NEED ── */}
      <section className="lp-section lp-section-alt">
        <div className="lp-container">
          <h2 className="lp-section-title">What you need</h2>
          <p className="lp-section-sub">Three things. That's it.</p>
          <div className="lp-steps">
            <div className="lp-step">
              <div className="lp-step-num">1</div>
              <div className="lp-step-content">
                <h4>Node.js 18+</h4>
                <p>The runtime. LTS recommended.</p>
              </div>
            </div>
            <div className="lp-step">
              <div className="lp-step-num">2</div>
              <div className="lp-step-content">
                <h4>MongoDB</h4>
                <p>Local install or MongoDB Atlas. Free tier works.</p>
              </div>
            </div>
            <div className="lp-step">
              <div className="lp-step-num">3</div>
              <div className="lp-step-content">
                <h4>An LLM API key</h4>
                <p>OpenAI, Anthropic, or any OpenAI-compatible endpoint.</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── START A LAND ── */}
      <section className="lp-section" id="start">
        <div className="lp-container">
          <h2 className="lp-section-title">Start a land</h2>
          <p className="lp-section-sub">One command. Interactive setup walks you through the rest.</p>

          <div className="lp-terminal">
            <div className="lp-term-header">
              <span className="lp-term-dot" style={{background: "#ff5f56"}} />
              <span className="lp-term-dot" style={{background: "#ffbd2e"}} />
              <span className="lp-term-dot" style={{background: "#27c93f"}} />
              <span className="lp-term-title">terminal</span>
            </div>
            <div className="lp-term-body">
              <div className="lp-term-line">
                <span className="lp-term-prompt">$</span> npx create-treeos my-land
              </div>
              <div className="lp-term-line">
                <span className="lp-term-prompt">$</span> cd my-land
              </div>
              <div className="lp-term-line">
                <span className="lp-term-prompt">$</span> npm start
              </div>
              <div className="lp-term-line" />
              <div className="lp-term-line"><span className="lp-term-output">  Welcome to TreeOS.</span></div>
              <div className="lp-term-line"><span className="lp-term-dim">  First-run setup. Answer a few questions to configure your Land.</span></div>
              <div className="lp-term-line" />
              <div className="lp-term-line"><span className="lp-term-output">  Domain (localhost): </span><span className="lp-term-green">mysite.com</span></div>
              <div className="lp-term-line"><span className="lp-term-output">  Land name (My Land): </span><span className="lp-term-green">Research Lab</span></div>
              <div className="lp-term-line"><span className="lp-term-output">  Port (3000): </span></div>
            </div>
          </div>
        </div>
      </section>

      {/* ── CONNECT TO YOUR LAND ── */}
      <section className="lp-section lp-section-alt">
        <div className="lp-container">
          <h2 className="lp-section-title">Connect to your land</h2>
          <p className="lp-section-sub">Two ways in. Both work. Use whichever feels right.</p>

          <div style={{display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24, maxWidth: 800, margin: "0 auto"}}>
            <div>
              <h3 style={{color: "#fff", fontSize: "1.1rem", marginBottom: 12}}>Browser</h3>
              <p style={{color: "rgba(255,255,255,0.5)", fontSize: "0.9rem", lineHeight: 1.7, marginBottom: 16}}>
                Open <code style={{color: "rgba(255,255,255,0.7)"}}>http://localhost:3000</code> in your browser.
                Register, set up your LLM, and start chatting. Natural language works. Just type.
              </p>
              <p style={{color: "rgba(255,255,255,0.35)", fontSize: "0.85rem", lineHeight: 1.7}}>
                Say hello. Ask a question. Log food. Start a study session.
                The tree figures out what to do based on where you are.
              </p>
            </div>
            <div>
              <h3 style={{color: "#fff", fontSize: "1.1rem", marginBottom: 12}}>CLI</h3>
              <div className="lp-terminal" style={{marginBottom: 0}}>
                <div className="lp-term-header">
                  <span className="lp-term-dot" style={{background: "#ff5f56"}} />
                  <span className="lp-term-dot" style={{background: "#ffbd2e"}} />
                  <span className="lp-term-dot" style={{background: "#27c93f"}} />
                  <span className="lp-term-title">terminal</span>
                </div>
                <div className="lp-term-body">
                  <div className="lp-term-line"><span className="lp-term-prompt">$</span> npm install -g treeos</div>
                  <div className="lp-term-line"><span className="lp-term-prompt">$</span> treeos connect http://localhost:3000</div>
                  <div className="lp-term-line"><span className="lp-term-prompt">$</span> treeos register</div>
                  <div className="lp-term-line"><span className="lp-term-prompt">$</span> treeos start</div>
                  <div className="lp-term-line" />
                  <div className="lp-term-line"><span style={{color: "#60a5fa"}}>you@localhost</span><span style={{color: "#666"}}>/~</span> <span className="lp-term-dim">{">"}</span> hello</div>
                  <div className="lp-term-line lp-term-dim">  Home: Hey! You have no trees yet. Try: life food fitness</div>
                </div>
              </div>
            </div>
          </div>

          <div style={{textAlign: "center", marginTop: 32}}>
            <a className="lp-btn lp-btn-secondary" href="/cli">CLI Reference</a>
          </div>
        </div>
      </section>

      {/* ── WHAT'S RUNNING ── */}
      <section className="lp-section">
        <div className="lp-container">
          <h2 className="lp-section-title">What's running</h2>
          <p className="lp-section-sub">After first boot, your land has:</p>

          <div className="lp-cards-3" style={{gridTemplateColumns: "1fr 1fr"}}>
            <div className="lp-card">
              <h3>Three zones</h3>
              <p>
                Land root (/) for system management. Home (~) for personal space. Trees for
                everything else. Navigate with <code>cd</code>.
              </p>
            </div>
            <div className="lp-card">
              <h3>77 extensions on standard</h3>
              <p>
                Intelligence, cascade, proficiency apps (food, fitness, study, recovery, KB),
                navigation, orchestration, dashboard, notifications, monitoring, and more.
                105 total available. Install what you need.
              </p>
            </div>
            <div className="lp-card">
              <h3>Six system nodes</h3>
              <p>
                Land root, identity, config, peers, extensions registry, and flow
                (cascade signal history). Created at boot. Managed by the kernel.
              </p>
            </div>
            <div className="lp-card">
              <h3>The AI</h3>
              <p>
                Connected to your LLM. Thinks at every position. Navigate to a node and chat.
                The AI knows where it is, what tools it has, and what extensions are active.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ── FIRST THINGS TO DO ── */}
      <section className="lp-section lp-section-alt">
        <div className="lp-container">
          <h2 className="lp-section-title">First things to do</h2>
          <p className="lp-section-sub">Natural language works everywhere. Just type what you mean.</p>

          <div className="lp-terminal">
            <div className="lp-term-header">
              <span className="lp-term-dot" style={{background: "#ff5f56"}} />
              <span className="lp-term-dot" style={{background: "#ffbd2e"}} />
              <span className="lp-term-dot" style={{background: "#27c93f"}} />
              <span className="lp-term-title">get started</span>
            </div>
            <div className="lp-term-body">
              <div className="lp-term-line"><span className="lp-term-prompt">you@localhost</span><span style={{color: "#666"}}>~</span> <span className="lp-term-dim">{">"}</span> life food fitness study recovery</div>
              <div className="lp-term-line lp-term-dim">  Creating your Life tree...</div>
              <div className="lp-term-line lp-term-dim">  Scaffolded: Food, Fitness, Study, Recovery</div>
              <div className="lp-term-line" />
              <div className="lp-term-line"><span className="lp-term-prompt">you@localhost</span><span style={{color: "#666"}}>/Life</span> <span className="lp-term-dim">{">"}</span> I had eggs and toast for breakfast</div>
              <div className="lp-term-line lp-term-dim">  Logged. 310 cal, 18g protein.</div>
              <div className="lp-term-line" />
              <div className="lp-term-line"><span className="lp-term-prompt">you@localhost</span><span style={{color: "#666"}}>/Life</span> <span className="lp-term-dim">{">"}</span> bench 135x10x10x8</div>
              <div className="lp-term-line lp-term-dim">  Push day logged. Bench up from 130 last session.</div>
              <div className="lp-term-line" />
              <div className="lp-term-line"><span className="lp-term-prompt">you@localhost</span><span style={{color: "#666"}}>/Life</span> <span className="lp-term-dim">{">"}</span> go food</div>
              <div className="lp-term-line lp-term-dim">  Navigating to /Life/Health/Food</div>
              <div className="lp-term-line" />
              <div className="lp-term-line"><span className="lp-term-prompt">you@localhost</span><span style={{color: "#666"}}>/Life/Health/Food</span> <span className="lp-term-dim">{">"}</span> how am I doing this week</div>
              <div className="lp-term-line lp-term-dim">  Averaging 1,850 cal. Protein at 82%. Breakfast consistency improving.</div>
            </div>
          </div>

          <p style={{color: "rgba(255,255,255,0.35)", fontSize: "0.85rem", textAlign: "center", marginTop: 16}}>
            One command scaffolds your whole stack. Then just talk to it. The tree routes to the right extension.
          </p>
        </div>
      </section>

      {/* ── GROWING YOUR LAND ── */}
      <section className="lp-section">
        <div className="lp-container">
          <h2 className="lp-section-title">Growing your land</h2>
          <p className="lp-section-sub">Three paths forward.</p>

          <div className="lp-cards-3">
            <div className="lp-card">
              <h3>Add extensions</h3>
              <p>
                Browse the directory. Install what you need. Each extension adds tools,
                commands, and AI behavior. Your land becomes what you install.
              </p>
              <a href="/extensions" className="lp-split-link" style={{marginTop: 12, display: "inline-block"}}>Browse extensions</a>
            </div>
            <div className="lp-card">
              <h3>Connect to the network</h3>
              <p>
                Peer with other lands. Discover public trees. Contribute to trees on other
                lands. Your data stays on your land. Context travels.
              </p>
              <a href="/network" className="lp-split-link" style={{marginTop: 12, display: "inline-block"}}>The network</a>
            </div>
            <div className="lp-card">
              <h3>Read the guide</h3>
              <p>
                Everything in one place. CLI commands, extension format, configuration,
                federation.
              </p>
              <a href="/guide" className="lp-split-link" style={{marginTop: 12, display: "inline-block"}}>Full guide</a>
            </div>
          </div>
        </div>
      </section>

      {/* ── SECURITY WARNING ── */}
      <section className="lp-section lp-section-alt" style={{paddingTop: 40, paddingBottom: 40}}>
        <div className="lp-container" style={{maxWidth: 760}}>
          <div style={{
            padding: "24px 28px",
            background: "rgba(239, 68, 68, 0.08)",
            border: "2px solid rgba(239, 68, 68, 0.3)",
            borderRadius: 10,
          }}>
            <h3 style={{color: "#ef4444", fontSize: "1.1rem", marginTop: 0, marginBottom: 12}}>
              Review every extension before you install it.
            </h3>
            <p style={{color: "rgba(255,255,255,0.7)", lineHeight: 1.8, fontSize: "0.9rem", margin: "0 0 12px"}}>
              The kernel is safe. Extensions have full access. A malicious extension with the right
              tools can access your file system, make network calls, and execute shell commands.
              Read the code before you install from unknown sources.
            </p>
            <p style={{color: "rgba(255,255,255,0.5)", lineHeight: 1.8, fontSize: "0.85rem", margin: 0}}>
              Use <code style={{color: "#ef4444"}}>ext view</code> to inspect before
              you <code style={{color: "#ef4444"}}>ext install</code>.
              Use spatial scoping to confine dangerous extensions to specific branches.
            </p>
          </div>
        </div>
      </section>

      {/* ── FOOTER ── */}
      <footer className="lp-footer">
        <div className="lp-container">
          <div className="lp-footer-grid">
            <div className="lp-footer-col">
              <h4>Docs</h4>
              <a href="/guide">Guide</a>
              <a href="/seed">The Seed</a>
              <a href="/ai">The AI</a>
              <a href="/cascade">Cascade</a>
              <a href="/governing">Governing</a>
              <a href="/flow">The Flow</a>
              <a href="/extensions">Extensions</a>
              <a href="/build">Build</a>
              <a href="/network">The Network</a>
              <a href="/mycelium">Mycelium</a>
              <a href="/lands">Start a Land</a>
              <a href="/cli">CLI</a>
            </div>
            <div className="lp-footer-col">
              <h4>TreeOS</h4>
              <a href="/use">Use</a>
              <a href="/about/api">API</a>
              <a href="/about/gateway">Gateway</a>
              <a href="/about/energy">Energy</a>
            </div>
            <div className="lp-footer-col">
              <h4>Community</h4>
              <a href="https://horizon.treeos.ai">Horizon</a>
              <a href="/blog">Blog</a>
            </div>
            <div className="lp-footer-col">
              <h4>Source</h4>
              <a href="https://github.com/taborgreat/create-treeos">GitHub</a>
              <a href="https://github.com/taborgreat/create-treeos/blob/main/template/seed/LICENSE">AGPL-3.0 License</a>
            </div>
          </div>
          <div className="lp-footer-bottom">
            TreeOS . AGPL-3.0 . <a href="https://tabors.site" style={{color: "inherit", textDecoration: "none"}}>Tabor Holly</a>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default LandPage;
