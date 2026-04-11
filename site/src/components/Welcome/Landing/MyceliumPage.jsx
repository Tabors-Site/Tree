import "./LandingPage.css";
import Particles from "./Particles.jsx";

const MyceliumPage = () => {
  return (
    <div className="lp">

      {/* ── HERO ── */}
      <section className="lp-hero" style={{minHeight: "60vh"}}>
        <Particles count={25} />
        <div className="lp-hero-inner">
          <h1 className="lp-title">Mycelium</h1>
          <p className="lp-subtitle">The forest underground.</p>
          <p className="lp-tagline">
            .flow is the water table. Canopy is trees reaching out. Mycelium is the
            intelligent network that connects root systems across lands. It does not just
            pass signals. It understands what each connected land needs and routes accordingly.
          </p>
          <div className="lp-hero-ctas lp-hero-ctas-sub">
            <a className="lp-btn lp-btn-secondary" href="/flow">The Flow</a>
            <a className="lp-btn lp-btn-secondary" href="/cascade">Cascade</a>
            <a className="lp-btn lp-btn-secondary" href="/network">The Network</a>
          </div>
        </div>
      </section>

      {/* ── THREE LAYERS ── */}
      <section className="lp-section">
        <div className="lp-container">
          <h2 className="lp-section-title">Three Communication Layers</h2>
          <p className="lp-section-sub lp-section-sub-wide">
            Every real forest has all three. Now every TreeOS network does too.
          </p>

          <div style={{maxWidth: 760, margin: "0 auto"}}>
            <Layer
              name=".flow"
              label="Water Table"
              color="#38bdf8"
              desc="Local to one land. Ambient. Trees pull what they need. No intelligence. No routing. Signals pool and roots drink selectively. Already built. Already working."
            />
            <Layer
              name="Canopy"
              label="Crown Contact"
              color="#4ade80"
              desc="Direct land-to-land. Intentional. Two lands peer and exchange signed messages through their crowns touching. Ed25519 keypairs. Heartbeat every 5 minutes. Already built. Already working."
            />
            <Layer
              name="Mycelium"
              label="Underground Network"
              color="#c084fc"
              desc="Intelligent routing between lands. It reads signal metadata, evaluates what each connected land needs, and delivers where the signal would be useful. A sick tree on Land A needs nutrients. Mycelium knows Land B has those nutrients. It routes them."
            />
          </div>
        </div>
      </section>

      {/* ── NOT A SERVER ── */}
      <section className="lp-section lp-section-alt">
        <div className="lp-container">
          <h2 className="lp-section-title">Not a Server. An Extension.</h2>
          <p className="lp-section-sub lp-section-sub-wide">
            Any land can install it. When installed, that land becomes a routing node
            in the underground network. It accepts cascade signals from peered lands.
            Instead of just storing them in its own .flow, it reads them, evaluates them,
            and routes them to other peered lands where the signal would be useful.
          </p>
          <div style={{
            maxWidth: 500, margin: "24px auto 0", padding: "16px 24px",
            background: "rgba(192, 132, 252, 0.06)", border: "1px solid rgba(192, 132, 252, 0.12)",
            borderRadius: 8, fontFamily: "monospace", fontSize: "0.85rem", color: "rgba(255,255,255,0.6)",
          }}>
            treeos ext install mycelium
          </div>
          <p className="lp-section-sub" style={{marginTop: 16, color: "rgba(255,255,255,0.35)"}}>
            One extension. Standalone. The kernel has zero awareness of it.
          </p>
        </div>
      </section>

      {/* ── ROUTING ── */}
      <section className="lp-section">
        <div className="lp-container">
          <h2 className="lp-section-title">Intelligent Routing</h2>
          <p className="lp-section-sub lp-section-sub-wide">
            The routing intelligence comes from reading what every connected land publishes
            through heartbeat. Extension lists. Gap detection data. Evolution patterns. Pulse health.
          </p>

          <div className="lp-steps">
            <Step n="1" title="Signal Arrives" desc="A cascade signal arrives from a peered land. Metadata contains extension namespaces and topic tags." />
            <Step n="2" title="Profile Peers" desc="For each connected land, read their extension list from heartbeat cache. Zero network calls. The data is already here." />
            <Step n="3" title="Score Relevance" desc="Extension match: does the destination have extensions that process this data? Gap match: has the destination been asking for this data? Tag match: do the topics align?" />
            <Step n="4" title="Route or Skip" desc="Above threshold: deliver with CanopyToken auth. Below threshold: skip. The routing is selective. Based on observed need, not broadcast." />
            <Step n="5" title="Log Decision" desc="Every routing decision is logged with reasoning. The operator can review why mycelium sent something where it did." />
          </div>
        </div>
      </section>

      {/* ── SAFETY ── */}
      <section className="lp-section lp-section-alt">
        <div className="lp-container">
          <h2 className="lp-section-title">Safety</h2>
          <div className="lp-cards-3" style={{gridTemplateColumns: "1fr 1fr 1fr"}}>
            <Card title="Loop Prevention" desc="Each mycelium node appends its land ID to an array on the signal. Before routing, check if your ID is already there. Catches triangles: M1 to M2 to M3 back to M1." />
            <Card title="Hop Limit" desc="Hard cap at 3 hops. Even without loops, signals cannot relay indefinitely. The kernel's cascade depth limit still applies on the receiving end." />
            <Card title="Source Exclusion" desc="Never route a signal back to the land that sent it. Compare peer land ID against signal source. Echo prevention." />
            <Card title="Rate Limiting" desc="100 signals per routing cycle. 60-second intervals. The mycelium land controls its own throughput." />
            <Card title="Auth" desc="Every cross-land delivery uses a CanopyToken signed with Ed25519. The receiving land verifies the sender's public key." />
            <Card title="Confined Scope" desc="Mycelium is scope: confined. A land must explicitly allow it. Not every land should be routing other lands' signals by default." />
          </div>
        </div>
      </section>

      {/* ── HOW IT SCALES ── */}
      <section className="lp-section">
        <div className="lp-container" style={{maxWidth: 780}}>
          <h2 className="lp-section-title">How It Scales</h2>

          <div style={{marginBottom: 48}}>
            <h3 style={{color: "#c084fc", fontSize: "1.1rem", marginBottom: 12}}>You and your trees</h3>
            <p style={{color: "rgba(255,255,255,0.6)", lineHeight: 1.9, fontSize: "0.92rem"}}>
              You have five trees on your land. The fitness tree produces signals about workout completion.
              The food tree needs to know about it. Right now cascade handles this through .flow. Signals
              pool. Roots drink. It works. But mycelium adds a layer. It reads the fitness signal,
              reads the food tree's perspective filter, and delivers only what the food tree would actually
              use. Not everything. Just what matters. Smarter than ambient pull. More targeted than
              broad propagation. This costs you nothing extra. It runs on your existing land. One extension.
              Your own trees start talking to each other through something that understands what each
              one needs.
            </p>
          </div>

          <div style={{marginBottom: 48}}>
            <h3 style={{color: "#c084fc", fontSize: "1.1rem", marginBottom: 12}}>A team and their lands</h3>
            <p style={{color: "rgba(255,255,255,0.6)", lineHeight: 1.9, fontSize: "0.92rem"}}>
              A research lab. Ten researchers, ten lands. Each person runs their own. The lab admin
              runs one more land with mycelium installed. All ten peer with it. Now research signals
              flow through the mycelium. A discovery on one land routes to the three lands working
              on related problems. Not all ten. Three. Because mycelium reads their extension lists,
              reads their gap reports, scores relevance. The lab's gap detection cross-references
              across everyone. Evolution patterns reveal which research tree structures actually
              produce papers. The cost is one additional land. The value is the entire lab's signals
              flowing through intelligent routing. The mycelium land becomes the lab's collective
              intelligence without anyone giving up sovereignty over their own data.
            </p>
          </div>

          <div style={{marginBottom: 48}}>
            <h3 style={{color: "#c084fc", fontSize: "1.1rem", marginBottom: 12}}>The open network</h3>
            <p style={{color: "rgba(255,255,255,0.6)", lineHeight: 1.9, fontSize: "0.92rem"}}>
              Who runs a mycelium node for strangers? The same people who run public DNS servers,
              public Matrix instances, public Mastodon nodes. People who believe in the infrastructure.
              But the incentive is not charity. The mycelium land sees everything flowing through it.
              For a research institution, that is a window into every connected land's evolution
              patterns. For a university, it is structural intelligence about how knowledge organizes
              itself. For a company, it is signal about what extensions and tree shapes are emerging
              across the ecosystem. The most connected node in the network knows the most about
              the network. The router becomes the wisest node in the forest because it sees every
              forest's signals without owning any forest's trees.
            </p>
          </div>

          <div style={{
            padding: "24px 28px", background: "rgba(192, 132, 252, 0.04)",
            border: "1px solid rgba(192, 132, 252, 0.08)", borderRadius: 8,
          }}>
            <p style={{color: "rgba(255,255,255,0.5)", lineHeight: 1.8, fontSize: "0.88rem", margin: "0 0 12px"}}>
              What does mycelium add to the kernel? Nothing. Zero changes. It uses <code>deliverCascade</code> to
              route signals. It reads <code>.flow</code> to see what is moving. It reads heartbeat extension
              lists to know what each land can process. It reads gap detection to know what each land is
              missing. It reads perspective filters to know what each land wants. It reads evolution
              patterns to know what is working. Every piece already exists.
            </p>
            <p style={{color: "rgba(255,255,255,0.35)", fontSize: "0.85rem", margin: 0}}>
              The seed does not know mycelium exists. It does not need to.
            </p>
          </div>
        </div>
      </section>

      {/* ── ECONOMICS ── */}
      <section className="lp-section">
        <div className="lp-container">
          <h2 className="lp-section-title">Who Pays for What</h2>
          <div className="lp-cards-3" style={{gridTemplateColumns: "1fr 1fr 1fr"}}>
            <Card title="Source Land" desc="Pays for producing the signal. Their LLM writes the content. Their cascade fires the hook. Their propagation sends it." />
            <Card title="Mycelium Land" desc="Pays for routing intelligence. One AI call per batch to score ambiguous signals. Its LLM, its tokens, its cost." />
            <Card title="Destination Land" desc="Pays for processing. The signal arrives. Their AI reads it. Their extensions act on it. Their LLM, their cost." />
          </div>
          <p className="lp-section-sub" style={{marginTop: 16, color: "rgba(255,255,255,0.35)", textAlign: "center"}}>
            Everyone pays for their own thinking.
          </p>
        </div>
      </section>

      {/* ── CLOSING ── */}
      <section className="lp-section lp-section-alt">
        <div className="lp-container" style={{textAlign: "center"}}>
          <h2 className="lp-section-title">The Third Layer</h2>
          <p className="lp-section-sub lp-section-sub-wide">
            Water table for ambient local signals. Canopy for intentional direct peering.
            Mycelium for intelligent cross-land routing. Every real forest has all three.
            The person who runs the mycelium land is not running a charity. They are running
            the most informed node in the network.
          </p>
          <div className="lp-cta-row">
            <a className="lp-btn lp-btn-primary" href="/">Get Started</a>
            <a className="lp-btn lp-btn-secondary" href="/network">The Network</a>
            <a className="lp-btn lp-btn-secondary" href="/extensions">Extensions</a>
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
              <a href="https://github.com/taborgreat/TreeOS/blob/main/LICENSE">AGPL-3.0 License</a>
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

// ── Components ──

const Layer = ({ name, label, color, desc }) => (
  <div style={{
    display: "flex", gap: 20, padding: "20px 0",
    borderBottom: "1px solid rgba(255,255,255,0.04)",
    alignItems: "flex-start",
  }}>
    <div style={{minWidth: 100, textAlign: "right"}}>
      <div style={{color, fontSize: "1rem", fontWeight: 700}}>{name}</div>
      <div style={{color: "rgba(255,255,255,0.3)", fontSize: "0.75rem", marginTop: 2}}>{label}</div>
    </div>
    <p style={{color: "rgba(255,255,255,0.55)", lineHeight: 1.8, fontSize: "0.88rem", margin: 0}}>{desc}</p>
  </div>
);

const Step = ({ n, title, desc }) => (
  <div className="lp-step">
    <div className="lp-step-num">{n}</div>
    <div className="lp-step-content">
      <h4>{title}</h4>
      <p>{desc}</p>
    </div>
  </div>
);

const Card = ({ title, desc }) => (
  <div className="lp-card">
    <h3>{title}</h3>
    <p style={{fontSize: "0.85rem", color: "#888"}}>{desc}</p>
  </div>
);

export default MyceliumPage;
