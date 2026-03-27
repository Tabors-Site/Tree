import "./LandingPage.css";

const DecentralizedPage = () => {
  return (
    <div className="lp">

      {/* ── HERO ── */}
      <section className="lp-hero">
        <div className="lp-hero-inner">
          <div className="lp-tree-icon">🌐</div>
          <h1 className="lp-title">The Network</h1>
          <p className="lp-subtitle">No central server. No single owner. Just lands connecting to lands.</p>
          <p className="lp-tagline">
            Every TreeOS instance is sovereign. You run yours. Someone else runs theirs.
            Knowledge, context, and AI capabilities flow between them through an open protocol.
            Nobody controls the network. Everybody contributes to it.
          </p>
          <div className="lp-hero-ctas lp-hero-ctas-sub">
            <a className="lp-btn lp-btn-primary" href="https://horizon.treeos.ai">Browse the Horizon</a>
            <a className="lp-btn lp-btn-secondary" href="/">Back to TreeOS</a>
          </div>
        </div>
      </section>

      {/* ── THE IDEA ── */}
      <section className="lp-section">
        <div className="lp-container">
          <h2 className="lp-section-title">Why Decentralized?</h2>
          <p className="lp-section-sub lp-section-sub-wide">
            Every AI platform today runs your agent on their servers, behind their API,
            inside their product. Your knowledge lives in their database. Your conversations
            disappear when they decide. Your agent's capabilities are whatever they choose to ship.
          </p>
          <p className="lp-section-sub lp-section-sub-wide">
            TreeOS flips this. Your land is your server. Your trees are your data. Your extensions
            are your choice. And when you want to connect with others, you peer directly. No
            middleman. No platform risk. No permission needed.
          </p>
        </div>
      </section>

      {/* ── HOW IT WORKS ── */}
      <section className="lp-section lp-section-alt">
        <div className="lp-container">
          <h2 className="lp-section-title">How Federation Works</h2>
          <div className="lp-cards-3">
            <div className="lp-card">
              <h3>Lands</h3>
              <p>
                Each land is a complete TreeOS instance. It has its own database, its own users,
                its own extensions, its own AI. It boots independently and works offline.
                A land is not an account on someone else's platform. It is your platform.
              </p>
            </div>
            <div className="lp-card">
              <h3>Canopy Protocol</h3>
              <p>
                Lands peer directly through Ed25519 signed requests. No OAuth. No API keys from
                a third party. Two lands exchange their public keys, and from then on every
                request between them is cryptographically verified. They share what extensions
                they run, what public trees they have, what capabilities their agents offer.
                The connection is peer-to-peer. No authority in the middle.
              </p>
            </div>
            <div className="lp-card">
              <h3>The Horizon</h3>
              <p>
                The Horizon helps lands find each other. The public one runs at{" "}
                <a href="https://horizon.treeos.ai" style={{color: "#999"}}>horizon.treeos.ai</a>.
                It indexes lands, public trees, and the extension registry. But anyone can
                run their own Horizon. Point your land at a different one. Or skip it entirely
                and peer by typing the other land's URL directly. The Horizon is a phone book, not a gatekeeper.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ── WHAT FLOWS ── */}
      <section className="lp-section">
        <div className="lp-container">
          <h2 className="lp-section-title">What Flows Between Lands</h2>
          <div className="lp-steps">
            <div className="lp-step">
              <div className="lp-step-num">1</div>
              <div className="lp-step-content">
                <h4>Public Trees</h4>
                <p>
                  Trees marked public are browsable from any land on the network. Users on
                  Land A can query trees on Land B without creating an account. The AI reads
                  the tree and responds. Knowledge is accessible across the network.
                </p>
              </div>
            </div>
            <div className="lp-step">
              <div className="lp-step-num">2</div>
              <div className="lp-step-content">
                <h4>Extensions</h4>
                <p>
                  Build an orchestration pattern, a tool pipeline, a background process.
                  Publish it to the registry. Now every land on the network can install it.
                  Intelligence compounds. What one person builds, everyone can use.
                </p>
              </div>
            </div>
            <div className="lp-step">
              <div className="lp-step-num">3</div>
              <div className="lp-step-content">
                <h4>Collaboration</h4>
                <p>
                  Invite users from other lands to contribute to your trees. They bring their
                  own LLM connections. They work in your tree with your extensions. Cross-land
                  contributions are logged in both places.
                </p>
              </div>
            </div>
            <div className="lp-step">
              <div className="lp-step-num">4</div>
              <div className="lp-step-content">
                <h4>Capabilities</h4>
                <p>
                  Lands advertise their loaded extensions at <code>/api/v1/protocol</code>.
                  An agent navigating from one land to another can discover what tools are
                  available at each destination. The network is capability-aware.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── WHAT THIS MEANS ── */}
      <section className="lp-section lp-section-alt">
        <div className="lp-container">
          <h2 className="lp-section-title">What This Means</h2>
          <div className="lp-cards-3">
            <div className="lp-card">
              <h3>Your Data Stays Yours</h3>
              <p>
                Trees live on your server. Your MongoDB. Your filesystem. Nobody can read your
                private trees, delete your data, or change your access. You decide what's public.
                You decide who peers with you. Full sovereignty.
              </p>
            </div>
            <div className="lp-card">
              <h3>No Platform Risk</h3>
              <p>
                If horizon.treeos.ai goes down, your land keeps running. If a peer goes offline,
                your trees are unaffected. The network is resilient because each node is
                independent. There is no single point of failure.
              </p>
            </div>
            <div className="lp-card">
              <h3>Intelligence Compounds</h3>
              <p>
                Every extension published to the registry makes every land on the network
                more capable. Every public tree adds knowledge that any agent can access.
                The more people participate, the more powerful the network becomes.
                Not through centralization. Through contribution.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ── THE COMPARISON ── */}
      <section className="lp-section">
        <div className="lp-container">
          <div className="lp-positioning">
            <div className="lp-pos-item">
              <h4>Email, not Gmail</h4>
              <p>
                Email is a protocol. Gmail is a product built on it. You can run your own email
                server or use someone else's. The protocol connects them all. TreeOS is the
                protocol. treeos.ai is one land running it. Anyone can run their own.
              </p>
            </div>
            <div className="lp-pos-item">
              <h4>Git, not GitHub</h4>
              <p>
                Git is distributed. Every clone is a full copy. GitHub is a hosted service that
                adds collaboration on top. TreeOS works the same way. Every land is a complete
                system. The Horizon adds discovery. The protocol adds connection. But each
                land stands alone.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ── JOIN ── */}
      <section className="lp-section lp-section-alt">
        <div className="lp-container" style={{textAlign: "center"}}>
          <h2 className="lp-section-title">Join the Network</h2>
          <p className="lp-section-sub">
            Run your own land. Connect to others. Share what you build.
          </p>
          <div className="lp-terminal" style={{maxWidth: 500, margin: "0 auto"}}>
            <div className="lp-term-header">
              <span className="lp-term-dot red"></span>
              <span className="lp-term-dot yellow"></span>
              <span className="lp-term-dot green"></span>
              <span className="lp-term-title">Terminal</span>
            </div>
            <div className="lp-term-body">
              <div className="lp-term-line"><span className="lp-term-prompt">$</span> npm install -g treeos</div>
              <div className="lp-term-line"><span className="lp-term-prompt">$</span> treeos land</div>
              <div className="lp-term-line lp-term-output"></div>
              <div className="lp-term-line lp-term-output">  Welcome to TreeOS.</div>
              <div className="lp-term-line lp-term-output">  Your land is ready.</div>
            </div>
          </div>
          <div className="lp-cta-row">
            <a className="lp-btn lp-btn-primary" href="/">Get Started</a>
            <a className="lp-btn lp-btn-secondary" href="https://horizon.treeos.ai">Browse Horizon</a>
          </div>
        </div>
      </section>

      {/* ── CLOSING ── */}
      <section className="lp-section" style={{paddingBottom: 80}}>
        <div className="lp-container" style={{textAlign: "center"}}>
          <p style={{
            fontSize: "1.4rem", fontWeight: 700, letterSpacing: "0.02em",
            color: "#4ade80", marginBottom: 8,
          }}>
            Built to be unstoppable.
          </p>
          <p style={{color: "#666", fontSize: "0.95rem", maxWidth: 500, margin: "0 auto"}}>
            Open source. AGPL-3.0. No kill switch. No terms of service that revoke access.
            The protocol is public. The code is public. The network belongs to everyone who runs it.
          </p>
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
              <a href="/flow">The Flow</a>
              <a href="/extensions">Extensions</a>
              <a href="/build">Build</a>
              <a href="/network">The Network</a>
              <a href="/mycelium">Mycelium</a>
              <a href="/land">Start a Land</a>
              <a href="/cli">CLI</a>
            </div>
            <div className="lp-footer-col">
              <h4>TreeOS</h4>
              <a href="/app">Site</a>
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
              <a href="https://github.com/Tabors-Site/Tree">GitHub</a>
              <a href="https://github.com/Tabors-Site/Tree/blob/main/LICENSE">AGPL-3.0 License</a>
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

export default DecentralizedPage;
