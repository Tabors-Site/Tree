import "./LandingPage.css";

const NetworkPage = () => {
  return (
    <div className="lp">

      {/* ── HERO ── */}
      <section className="lp-hero" style={{minHeight: "60vh"}}>
        <div className="lp-hero-inner">
          <h1 className="lp-title">The Network</h1>
          <p className="lp-subtitle">How trees connect.</p>
          <p className="lp-tagline">
            A land is sovereign. Your data stays on your server. Your database. Your rules.
            Canopy is how sovereign lands connect without a central authority.
            Every land is a node in a distributed network.
          </p>
          <div className="lp-hero-ctas">
            <a className="lp-btn lp-btn-primary" href="https://dir.treeos.ai">Browse the Directory</a>
            <a className="lp-btn lp-btn-secondary" href="/seed">The Seed</a>
            <a className="lp-btn lp-btn-secondary" href="/ai">The AI</a>
            <a className="lp-btn lp-btn-secondary" href="/cascade">Cascade</a>
            <a className="lp-btn lp-btn-secondary" href="/extensions">Extensions</a>
          </div>
        </div>
      </section>

      {/* ── WHY DECENTRALIZED ── */}
      <section className="lp-section">
        <div className="lp-container">
          <h2 className="lp-section-title">Why Decentralized?</h2>
          <p className="lp-section-sub lp-section-sub-wide">
            Every AI platform today runs your agent on their servers, behind their API,
            inside their product. Your knowledge lives in their database. Your conversations
            disappear when they decide. Your agent's capabilities are whatever they choose to ship.
          </p>
          <p className="lp-section-sub lp-section-sub-wide">
            The seed flips this. Your land is your server. Your trees are your data. Your extensions
            are your choice. And when you want to connect with others, you peer directly. No
            middleman. No platform risk. No permission needed.
          </p>
        </div>
      </section>

      {/* ── LANDS ── */}
      <section className="lp-section lp-section-alt">
        <div className="lp-container">
          <h2 className="lp-section-title">Lands</h2>
          <p className="lp-section-sub lp-section-sub-wide">
            Each land is one server, one database, one seed. A land operator runs their own
            instance. They control who registers, what extensions load, what trees grow.
            No land depends on another to function.
          </p>
          <div className="lp-cards-3">
            <div className="lp-card">
              <h3>Sovereign</h3>
              <p style={{fontSize: "0.85rem", color: "#888"}}>
                Disconnect from the network and everything still works locally.
                Your trees, your users, your AI conversations, your cascade signals.
                The land is complete on its own. The network is optional.
              </p>
            </div>
            <div className="lp-card">
              <h3>Self-Hosted</h3>
              <p style={{fontSize: "0.85rem", color: "#888"}}>
                Run on your hardware. Your cloud. Your Raspberry Pi. Anywhere Node.js
                and MongoDB run. No vendor lock-in. No managed service required.
                The seed boots on anything.
              </p>
            </div>
            <div className="lp-card">
              <h3>Operator-Controlled</h3>
              <p style={{fontSize: "0.85rem", color: "#888"}}>
                The operator chooses which extensions to install, which users can register,
                which trees can grow, which lands to peer with. Every config key is changeable
                at runtime through CLI, API, or the AI itself.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ── CANOPY PROTOCOL ── */}
      <section className="lp-section">
        <div className="lp-container">
          <h2 className="lp-section-title">Canopy Protocol</h2>
          <p className="lp-section-sub lp-section-sub-wide">
            The protocol that connects lands. REST endpoints. Signed messages.
            Peer discovery. The trust layer between sovereign nodes.
          </p>
          <div className="lp-steps">
            <div className="lp-step">
              <div className="lp-step-num">1</div>
              <div className="lp-step-content">
                <h4>Identity</h4>
                <p>Each land generates an Ed25519 keypair on first boot. Stored in the .identity system node. The public key is shared with peers. The private key never leaves the land. Every outbound message is signed.</p>
              </div>
            </div>
            <div className="lp-step">
              <div className="lp-step-num">2</div>
              <div className="lp-step-content">
                <h4>Discovery</h4>
                <p>
                  Lands find each other through a directory service or direct peering by URL. The directory
                  at <a href="https://dir.treeos.ai" style={{color: "rgba(255,255,255,0.7)"}}>dir.treeos.ai</a> helps
                  lands discover each other and browse published extensions. It's where <code>treeos ext search</code> and <code>treeos ext publish</code> hit.
                  Anyone can run their own directory. It's a search index over public metadata that lands voluntarily advertise.
                  Extension code lives on the publishing land, not the directory. The directory is a convenience, not an authority.
                  Remove it and direct peering still works.
                </p>
              </div>
            </div>
            <div className="lp-step">
              <div className="lp-step-num">3</div>
              <div className="lp-step-content">
                <h4>Heartbeat</h4>
                <p>Peers exchange health status and extension lists on a regular interval. Heartbeats tell you what extensions a peer has, not what data they hold. Health monitoring without surveillance.</p>
              </div>
            </div>
            <div className="lp-step">
              <div className="lp-step-num">4</div>
              <div className="lp-step-content">
                <h4>Event Exchange</h4>
                <p>Cascade signals, contributions, and tree updates flow between peers as signed events. An outbox queues events for delivery. A retry mechanism handles temporary peer unavailability. Events are idempotent.</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── WHAT FLOWS ── */}
      <section className="lp-section lp-section-alt">
        <div className="lp-container">
          <h2 className="lp-section-title">What Flows Between Lands</h2>
          <div className="lp-cards-3" style={{gridTemplateColumns: "1fr 1fr"}}>
            <div className="lp-card">
              <h3>Public Trees</h3>
              <p style={{fontSize: "0.85rem", color: "#888"}}>
                Trees marked public are browsable from any land on the network. Users on
                Land A can query trees on Land B without creating an account. The AI reads
                the tree and responds. Knowledge is accessible across the network.
              </p>
            </div>
            <div className="lp-card">
              <h3>Extensions</h3>
              <p style={{fontSize: "0.85rem", color: "#888"}}>
                Build an orchestration pattern, a tool pipeline, a background process.
                Publish it to the registry. Now every land on the network can install it.
                Intelligence compounds. What one person builds, everyone can use.
              </p>
            </div>
            <div className="lp-card">
              <h3>Collaboration</h3>
              <p style={{fontSize: "0.85rem", color: "#888"}}>
                Invite users from other lands to contribute to your trees. They bring their
                own LLM connections. They work in your tree with your extensions. Their contributions
                are stored on your land. Their user data stays on theirs.
              </p>
            </div>
            <div className="lp-card">
              <h3>Capabilities</h3>
              <p style={{fontSize: "0.85rem", color: "#888"}}>
                Lands advertise their loaded extensions at <code>/api/v1/protocol</code>.
                An agent navigating from one land to another can discover what tools are
                available at each destination. The network is capability-aware.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ── HOW DATA TRAVELS ── */}
      <section className="lp-section">
        <div className="lp-container">
          <h2 className="lp-section-title">How Data Travels</h2>
          <p className="lp-section-sub lp-section-sub-wide">
            A tree on Land A writes content. Cascade fires. An extension propagates the signal
            to Land B through Canopy. Land B accepts it, processes it, writes a result.
            The metadata Map preserves everything across transit.
          </p>
          <div className="lp-cards-3" style={{gridTemplateColumns: "1fr 1fr 1fr"}}>
            <div className="lp-card">
              <h3>The Map Survives Transit</h3>
              <p style={{fontSize: "0.85rem", color: "#888"}}>
                The metadata Map uses MongoDB's Mixed type. Unknown keys survive serialization
                and deserialization. An extension that isn't installed on the receiving land still
                has its metadata preserved. When that extension is installed later, the data is already there.
              </p>
            </div>
            <div className="lp-card">
              <h3>Remote Contributions</h3>
              <p style={{fontSize: "0.85rem", color: "#888"}}>
                A user on Land A navigates to a tree on Land B. They write a note. The note
                is sent to Land B via Canopy. Land B creates a ghost user record (username +
                home land URL) and stores the contribution. The real user data stays on Land A.
              </p>
            </div>
            <div className="lp-card">
              <h3>Never Block Inbound</h3>
              <p style={{fontSize: "0.85rem", color: "#888"}}>
                The kernel's guarantee. No configuration can prevent a cascade signal from
                arriving at a land. The signal is always accepted. Always produces a result in .flow.
                Extensions decide what to do with it. But the kernel always lets it in.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ── SOVEREIGNTY ── */}
      <section className="lp-section lp-section-alt">
        <div className="lp-container">
          <h2 className="lp-section-title">Sovereignty</h2>
          <p className="lp-section-sub lp-section-sub-wide">
            User data never leaves your land unless you send it.
          </p>
          <div style={{maxWidth: 600, margin: "0 auto"}}>
            {[
              ["Your data stays home", "Trees, notes, metadata, conversations, contributions. All on your server. Your database. Your backups."],
              ["Remote users are ghosts", "When a user from another land contributes to your tree, your land creates a ghost record: a username and a home land URL. The real user data stays on their home land."],
              ["Heartbeats share status, not data", "Peers exchange extension lists and health. Not user data. Not tree content. Not notes. The network knows you exist. It doesn't know what you're doing."],
              ["Cascade is opt-in", "cascadeEnabled defaults to false. No signals flow until you turn it on. Even when on, each node chooses whether to participate via metadata.cascade.enabled."],
              ["Peering is mutual", "Both lands must agree to peer. One-sided peering is rejected. You choose your neighbors."],
              ["No platform risk", "If dir.treeos.ai goes down, your land keeps running. If a peer goes offline, your trees are unaffected. Each node is independent. There is no single point of failure."],
            ].map(([title, desc]) => (
              <div key={title} style={{
                padding: "14px 0",
                borderBottom: "1px solid rgba(255,255,255,0.05)",
              }}>
                <div style={{color: "#4ade80", fontSize: "0.85rem", fontWeight: 600, marginBottom: 4}}>{title}</div>
                <div style={{color: "#888", fontSize: "0.85rem", lineHeight: 1.7}}>{desc}</div>
              </div>
            ))}
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
                server or use someone else's. The protocol connects them all. The seed is the
                protocol. treeos.ai is one land running it. Anyone can run their own.
              </p>
            </div>
            <div className="lp-pos-item">
              <h4>Git, not GitHub</h4>
              <p>
                Git is distributed. Every clone is a full copy. GitHub is a hosted service that
                adds collaboration on top. The seed works the same way. Every land is a complete
                system. The directory adds discovery. The protocol adds connection. But each
                land stands alone.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ── WHAT THIS MEANS ── */}
      <section className="lp-section lp-section-alt">
        <div className="lp-container">
          <div className="lp-cards-3" style={{gridTemplateColumns: "1fr 1fr 1fr"}}>
            <div className="lp-card">
              <h3>Your Data Stays Yours</h3>
              <p style={{fontSize: "0.85rem", color: "#888"}}>
                Trees live on your server. Your MongoDB. Your filesystem. Nobody can read your
                private trees, delete your data, or change your access. You decide what's public.
                You decide who peers with you. Full sovereignty.
              </p>
            </div>
            <div className="lp-card">
              <h3>No Platform Risk</h3>
              <p style={{fontSize: "0.85rem", color: "#888"}}>
                If the directory goes down, your land keeps running. If a peer goes offline,
                your trees are unaffected. The network is resilient because each node is
                independent. There is no single point of failure.
              </p>
            </div>
            <div className="lp-card">
              <h3>Intelligence Compounds</h3>
              <p style={{fontSize: "0.85rem", color: "#888"}}>
                Every extension published to the registry makes every land on the network
                more capable. Every public tree adds knowledge that any agent can access.
                The more people participate, the more powerful the network becomes.
                Not through centralization. Through contribution.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ── JOIN ── */}
      <section className="lp-section">
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
          <div style={{marginTop: 24}}>
            <a className="lp-btn lp-btn-primary" href="/">Get Started</a>
            <a className="lp-btn lp-btn-secondary" href="https://dir.treeos.ai" style={{marginLeft: 12}}>Browse Directory</a>
          </div>
        </div>
      </section>

      {/* ── CLOSING ── */}
      <section className="lp-section lp-section-alt" style={{paddingBottom: 80}}>
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
          <div className="lp-footer-bottom">
            TreeOS . AGPL-3.0 . <a href="https://tabors.site" style={{color: "inherit", textDecoration: "none"}}>Tabor Holly</a>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default NetworkPage;
