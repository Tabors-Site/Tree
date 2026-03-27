import "./LandingPage.css";

const FlowPage = () => {
  return (
    <div className="lp">

      {/* ── HERO ── */}
      <section className="lp-hero" style={{minHeight: "55vh"}}>
        <div className="lp-hero-inner">
          <h1 className="lp-title">The Flow</h1>
          <p className="lp-subtitle">How data moves through TreeOS.</p>
          <p className="lp-tagline">
            TreeOS is a water cycle. Data enters from the outside world, lands
            receive it, trees pull what they need, the AI transforms it, and
            output flows back out. Every part of the metaphor maps to a real
            mechanism in the system.
          </p>
          <div className="lp-hero-ctas lp-hero-ctas-sub">
            <a className="lp-btn lp-btn-secondary" href="/cascade">Cascade (technical spec)</a>
            <a className="lp-btn lp-btn-secondary" href="/seed">The Seed</a>
          </div>
        </div>
      </section>

      {/* ── THE MAP ── */}
      <section className="lp-section">
        <div className="lp-container">
          <h2 className="lp-section-title">The Water Cycle</h2>
          <p className="lp-section-sub lp-section-sub-wide">
            Nine parts. Each one is a real component of the system wearing a name
            that describes what it actually does.
          </p>

          <div style={{maxWidth: 720, margin: "0 auto"}}>

            {/* Sky */}
            <div style={{
              padding: "20px 24px", marginBottom: 2,
              background: "rgba(148, 163, 184, 0.04)",
              borderTop: "1px solid rgba(148, 163, 184, 0.1)",
            }}>
              <div style={{display: "flex", gap: 16, alignItems: "baseline"}}>
                <span style={{color: "#94a3b8", fontSize: "0.8rem", fontWeight: 600, minWidth: 110, textTransform: "uppercase", letterSpacing: "0.5px"}}>The sky</span>
                <span style={{color: "var(--color-text-primary)", fontSize: "0.95rem", fontWeight: 500}}>The Horizon</span>
              </div>
              <p style={{color: "var(--color-text-secondary)", fontSize: "0.85rem", lineHeight: 1.7, margin: "8px 0 0", paddingLeft: 126}}>
                Where lands look to find other lands. <code>horizon.treeos.ai</code> is one sky.
                Anyone can run their own. It indexes lands and published extensions.
                Remove it and direct peering still works. The sky helps you see farther.
                It does not carry data.
              </p>
            </div>

            {/* Clouds */}
            <div style={{
              padding: "20px 24px", marginBottom: 2,
              background: "rgba(255, 255, 255, 0.02)",
            }}>
              <div style={{display: "flex", gap: 16, alignItems: "baseline"}}>
                <span style={{color: "#e2e8f0", fontSize: "0.8rem", fontWeight: 600, minWidth: 110, textTransform: "uppercase", letterSpacing: "0.5px"}}>Clouds</span>
                <span style={{color: "var(--color-text-primary)", fontSize: "0.95rem", fontWeight: 500}}>External systems</span>
              </div>
              <p style={{color: "var(--color-text-secondary)", fontSize: "0.85rem", lineHeight: 1.7, margin: "8px 0 0", paddingLeft: 126}}>
                Everything outside TreeOS that holds data. Discord servers, Telegram
                channels, browsers, mobile apps, external APIs, other services. The
                clouds gather data. They don't push it in. Something has to pull or
                the user has to act.
              </p>
            </div>

            {/* Rain */}
            <div style={{
              padding: "20px 24px", marginBottom: 2,
              background: "rgba(96, 165, 250, 0.04)",
              borderLeft: "2px solid rgba(96, 165, 250, 0.3)",
            }}>
              <div style={{display: "flex", gap: 16, alignItems: "baseline"}}>
                <span style={{color: "#60a5fa", fontSize: "0.8rem", fontWeight: 600, minWidth: 110, textTransform: "uppercase", letterSpacing: "0.5px"}}>Rain</span>
                <span style={{color: "var(--color-text-primary)", fontSize: "0.95rem", fontWeight: 500}}>Incoming data</span>
              </div>
              <p style={{color: "var(--color-text-secondary)", fontSize: "0.85rem", lineHeight: 1.7, margin: "8px 0 0", paddingLeft: 126}}>
                A user types <code>treeos chat "add a workout"</code>. That is rain.
                A Discord webhook delivers a message through the gateway extension.
                That is rain. An API call hits <code>POST /api/v1/node/:id/notes</code>.
                Rain. Anything entering the system from outside for the first time.
              </p>
            </div>

            {/* Land */}
            <div style={{
              padding: "20px 24px", marginBottom: 2,
              background: "rgba(255, 255, 255, 0.02)",
            }}>
              <div style={{display: "flex", gap: 16, alignItems: "baseline"}}>
                <span style={{color: "var(--color-text-secondary)", fontSize: "0.8rem", fontWeight: 600, minWidth: 110, textTransform: "uppercase", letterSpacing: "0.5px"}}>The land</span>
                <span style={{color: "var(--color-text-primary)", fontSize: "0.95rem", fontWeight: 500}}>Your server</span>
              </div>
              <p style={{color: "var(--color-text-secondary)", fontSize: "0.85rem", lineHeight: 1.7, margin: "8px 0 0", paddingLeft: 126}}>
                One machine. One MongoDB instance. One seed. The ground that receives
                the rain. Some rain falls directly onto a tree when a user chats at a
                specific node. Some hits the land and flows into .flow when an extension
                processes it as a cascade signal.
              </p>
            </div>

            {/* .flow */}
            <div style={{
              padding: "20px 24px", marginBottom: 2,
              background: "rgba(56, 138, 221, 0.06)",
              borderLeft: "2px solid rgba(56, 138, 221, 0.3)",
            }}>
              <div style={{display: "flex", gap: 16, alignItems: "baseline"}}>
                <span style={{color: "#378ADD", fontSize: "0.8rem", fontWeight: 600, minWidth: 110, textTransform: "uppercase", letterSpacing: "0.5px"}}>Water table</span>
                <span style={{color: "var(--color-text-primary)", fontSize: "0.95rem", fontWeight: 500}}>.flow system node</span>
              </div>
              <p style={{color: "var(--color-text-secondary)", fontSize: "0.85rem", lineHeight: 1.7, margin: "8px 0 0", paddingLeft: 126}}>
                Every cascade signal writes a result here. Daily partitions. Circular
                overwrite when full. Retention drains old partitions. The land feels its
                own hydration level through .flow. The AI reads it. Pulse monitors it.
                Every tree on this land shares the same water table but pulls different
                things through perspective filters.
              </p>
            </div>

            {/* Roots */}
            <div style={{
              padding: "20px 24px", marginBottom: 2,
              background: "rgba(74, 222, 128, 0.04)",
              borderLeft: "2px solid rgba(74, 222, 128, 0.2)",
            }}>
              <div style={{display: "flex", gap: 16, alignItems: "baseline"}}>
                <span style={{color: "#4ade80", fontSize: "0.8rem", fontWeight: 600, minWidth: 110, textTransform: "uppercase", letterSpacing: "0.5px"}}>Roots</span>
                <span style={{color: "var(--color-text-primary)", fontSize: "0.95rem", fontWeight: 500}}>Cascade propagation</span>
              </div>
              <p style={{color: "var(--color-text-secondary)", fontSize: "0.85rem", lineHeight: 1.7, margin: "8px 0 0", paddingLeft: 126}}>
                Extensions listen to <code>onCascade</code> and propagate signals to
                the nodes that need them. A fitness tree pulls fitness signals. A work
                tree ignores them. The perspective filter extension controls what each
                tree is thirsty for. Roots are selective. They don't drink everything
                in the water table.
              </p>
            </div>

            {/* Photosynthesis */}
            <div style={{
              padding: "20px 24px", marginBottom: 2,
              background: "rgba(74, 222, 128, 0.06)",
              borderLeft: "2px solid rgba(74, 222, 128, 0.35)",
            }}>
              <div style={{display: "flex", gap: 16, alignItems: "baseline"}}>
                <span style={{color: "#4ade80", fontSize: "0.8rem", fontWeight: 600, minWidth: 110, textTransform: "uppercase", letterSpacing: "0.5px"}}>Photosynthesis</span>
                <span style={{color: "var(--color-text-primary)", fontSize: "0.95rem", fontWeight: 500}}>The conversation loop</span>
              </div>
              <p style={{color: "var(--color-text-secondary)", fontSize: "0.85rem", lineHeight: 1.7, margin: "8px 0 0", paddingLeft: 126}}>
                The AI at each node takes raw input and produces structured output.
                A note becomes a node. A question becomes a plan. A cascade signal
                becomes new branches. This is the transformation step. A packet entering
                a router exits unchanged. A signal entering a tree node exits as something
                new. The AI is the difference between a network and an organism.
              </p>
            </div>

            {/* Transpiration */}
            <div style={{
              padding: "20px 24px", marginBottom: 2,
              background: "rgba(251, 191, 36, 0.04)",
              borderLeft: "2px solid rgba(251, 191, 36, 0.2)",
            }}>
              <div style={{display: "flex", gap: 16, alignItems: "baseline"}}>
                <span style={{color: "#fbbf24", fontSize: "0.8rem", fontWeight: 600, minWidth: 110, textTransform: "uppercase", letterSpacing: "0.5px"}}>Transpiration</span>
                <span style={{color: "var(--color-text-primary)", fontSize: "0.95rem", fontWeight: 500}}>Output to the outside world</span>
              </div>
              <p style={{color: "var(--color-text-secondary)", fontSize: "0.85rem", lineHeight: 1.7, margin: "8px 0 0", paddingLeft: 126}}>
                The tree produced something. Now it leaves. An API response goes back
                to the client. A gateway message posts to Discord. A webhook fires to
                an external service. The structured output evaporates back into the cloud
                layer. The outside world receives what the tree grew.
              </p>
            </div>

            {/* Canopy */}
            <div style={{
              padding: "20px 24px",
              background: "rgba(29, 158, 117, 0.04)",
              borderLeft: "2px solid rgba(29, 158, 117, 0.3)",
              borderBottom: "1px solid rgba(29, 158, 117, 0.1)",
            }}>
              <div style={{display: "flex", gap: 16, alignItems: "baseline"}}>
                <span style={{color: "#1D9E75", fontSize: "0.8rem", fontWeight: 600, minWidth: 110, textTransform: "uppercase", letterSpacing: "0.5px"}}>Canopy</span>
                <span style={{color: "var(--color-text-primary)", fontSize: "0.95rem", fontWeight: 500}}>Trees reaching out</span>
              </div>
              <p style={{color: "var(--color-text-secondary)", fontSize: "0.85rem", lineHeight: 1.7, margin: "8px 0 0", paddingLeft: 126}}>
                A real canopy is what happens when tree crowns grow tall enough to touch.
                In TreeOS, canopy is a land's tree extending outward until it reaches
                another land's tree. Signed requests. Direct peering. Land A reaches
                for Land B. Land B reaches back. The branches overlap. Data passes
                through the connection. Two forests connected at the crown, root
                systems still independent.
              </p>
            </div>

          </div>
        </div>
      </section>

      {/* ── TWO KINDS OF MOVEMENT ── */}
      <section className="lp-section lp-section-alt">
        <div className="lp-container">
          <h2 className="lp-section-title">Two Kinds of Movement</h2>
          <p className="lp-section-sub lp-section-sub-wide">
            Data moves through TreeOS in two fundamentally different ways.
            Confusing them breaks your mental model.
          </p>
          <div className="lp-cards-3" style={{gridTemplateColumns: "1fr 1fr"}}>
            <div className="lp-card">
              <h3 style={{color: "#1D9E75"}}>Canopy (trees reaching out)</h3>
              <p style={{fontSize: "0.85rem", color: "var(--color-text-secondary)", lineHeight: 1.7}}>
                Direct. Intentional. Land A's tree grows tall enough to reach Land B.
                They peer. Signed requests pass between them. Request, response, done.
                The caller knows who it's reaching for. The connection is deliberate.
                No .flow involved. Two trees touching at the crown, exchanging data
                through the overlap.
              </p>
            </div>
            <div className="lp-card">
              <h3 style={{color: "#378ADD"}}>.flow (the water table)</h3>
              <p style={{fontSize: "0.85rem", color: "var(--color-text-secondary)", lineHeight: 1.7}}>
                Ambient. Signal-based. A note is written. Cascade fires. The result
                enters .flow. Trees with matching filters pull it. The writer doesn't
                choose which trees receive it. The trees choose what they're thirsty
                for. Data moves through the system based on what nodes need, not what
                nodes send.
              </p>
            </div>
          </div>
          <p className="lp-section-sub" style={{marginTop: 16, color: "var(--color-text-tertiary)"}}>
            Canopy is trees reaching for each other at the crown.
            .flow is the water table that every root system on this land draws from.
            Both move data. Different mechanisms. Different purposes.
          </p>
        </div>
      </section>

      {/* ── THREE STATES ── */}
      <section className="lp-section">
        <div className="lp-container">
          <h2 className="lp-section-title">Three States</h2>
          <p className="lp-section-sub lp-section-sub-wide">
            .flow has three operating states. The kernel handles all of them without
            operator intervention.
          </p>
          <div className="lp-cards-3" style={{gridTemplateColumns: "1fr 1fr 1fr"}}>
            <div className="lp-card">
              <h3 style={{color: "#c084fc"}}>Pooling</h3>
              <p style={{fontSize: "0.85rem", color: "var(--color-text-secondary)"}}>
                Signals accumulate. Daily partitions fill toward <code>flowMaxResultsPerDay</code>.
                When a partition is full, oldest results get overwritten. Circular buffer.
                Retention drains old partitions by date. The water table stays bounded.
              </p>
            </div>
            <div className="lp-card">
              <h3 style={{color: "#f87171"}}>Flooding</h3>
              <p style={{fontSize: "0.85rem", color: "var(--color-text-secondary)"}}>
                Signals arrive faster than extensions can process. <code>cascadeMaxDepth</code> stops
                infinite chains. <code>cascadeRateLimit</code> caps signals per node per minute.
                Hook circuit breakers disable failing handlers. Tree circuit breaker trips the
                whole tree if the error rate spikes.
              </p>
            </div>
            <div className="lp-card">
              <h3 style={{color: "#94a3b8"}}>Drought</h3>
              <p style={{fontSize: "0.85rem", color: "var(--color-text-secondary)"}}>
                No signals. .flow empties. Trees go dormant. The structure holds. Metadata
                stays. Codebooks stay. When a signal arrives again, even years later, the
                kernel accepts it. <strong>Never block inbound.</strong> The roots pull again.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ── ONE CYCLE ── */}
      <section className="lp-section lp-section-alt">
        <div className="lp-container">
          <h2 className="lp-section-title">One Cycle</h2>
          <div style={{maxWidth: 640, margin: "0 auto"}}>
            {[
              ["A user types a message", "Rain hits the land"],
              ["The conversation loop resolves LLM, tools, mode at this position", "The ground absorbs it"],
              ["The AI processes the input and creates a note", "Photosynthesis"],
              ["The note is written at a cascade-enabled node", "Water enters the table"],
              ["onCascade fires. Extensions propagate to child nodes", "Roots pull to the branches that need it"],
              ["The AI at each receiving node transforms the signal into new structure", "More photosynthesis. More growth"],
              ["An API response goes back to the user", "Transpiration"],
              ["Canopy carries the signal to a peered land", "Branches touch between forests"],
              ["The next user types. The next signal arrives. The cycle continues", "The next drop falls"],
            ].map(([system, metaphor], i) => (
              <div key={i} style={{
                display: "flex", gap: 20, padding: "12px 0",
                borderBottom: i < 8 ? "1px solid rgba(255,255,255,0.04)" : "none",
                alignItems: "baseline",
              }}>
                <span style={{color: "var(--color-text-secondary)", fontSize: "0.85rem", flex: 1, lineHeight: 1.6}}>{system}</span>
                <span style={{color: "var(--color-text-tertiary)", fontSize: "0.8rem", fontStyle: "italic", minWidth: 180, textAlign: "right"}}>{metaphor}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── CLOSING ── */}
      <section className="lp-section">
        <div className="lp-container" style={{textAlign: "center"}}>
          <p className="lp-section-sub lp-section-sub-wide" style={{color: "var(--color-text-tertiary)"}}>
            The land is the ground. The seed is what grows. .flow is the water table.
            The AI is photosynthesis. Canopy is trees reaching for each other. The Horizon is the sky.
            The cycle runs itself. It just needs the first drop.
          </p>
          <div className="lp-cta-row">
            <a className="lp-btn lp-btn-primary" href="/">Get Started</a>
            <a className="lp-btn lp-btn-secondary" href="/cascade">Cascade</a>
            <a className="lp-btn lp-btn-secondary" href="/seed">The Seed</a>
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

export default FlowPage;