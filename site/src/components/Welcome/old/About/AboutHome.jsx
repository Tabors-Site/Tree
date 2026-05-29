
import "./AboutHome.css";

const AboutHome = () => {
  const sections = [
    {
      emoji: "🌱",
      title: "Getting Started",
      desc: "Your first tree, first node, first note. Up and running in two minutes.",
      to: "/about/gettingstarted",
      active: true,
    },
    {
      emoji: "🔌",
      title: "API Reference",
      desc: "Read and write to your trees programmatically. Build bots, scripts, and integrations.",
      to: "/about/api",
      active: true,
    },
    {
      emoji: "⚡",
      title: "Energy System",
      desc: "How energy works, what it costs, and how to bring your own LLM.",
      to: "/about/energy",
      active: true,
    },
    {
      emoji: "💡",
      title: "Raw Ideas",
      desc: "Capture thoughts and files. AI picks the right tree and places them automatically.",
      to: "/about/raw-ideas",
      active: true,
    },
    {
      emoji: "💤",
      title: "Tree Dreams",
      desc: "Daily background maintenance: cleanup, drain, and understanding, while you sleep.",
      to: "/about/dreams",
      active: true,
    },
    {
      emoji: "💻",
      title: "CLI",
      desc: "Navigate and manage your trees from the terminal. Install, configure, and use the TreeOS CLI.",
      to: "/about/cli",
      active: true,
    },
    {
      emoji: "🏷️",
      title: "Node Types",
      desc: "Semantic labels for nodes. Six core types, custom types, and how trees program their own agents.",
      to: "/about/node-types",
      active: true,
    },
    {
      emoji: "📡",
      title: "Gateway",
      desc: "Connect your trees to Telegram, Discord, and push notifications. Output channels, input modes, and more.",
      to: "/about/gateway",
      active: true,
    },
    {
      emoji: "🌍",
      title: "Land and Canopy",
      desc: "Self-host your own Land, connect to the network, and collaborate across servers.",
      to: "/about/land",
      active: true,
    },
    {
      emoji: "🧩",
      title: "Extensions",
      desc: "Modular packages for your land. Install, disable, publish, and build your own.",
      to: "/about/extensions",
      active: true,
    },
    {
      emoji: "📝",
      title: "Blog",
      desc: "Ideas, updates, and thoughts on where TreeOS is going.",
      to: "/blog",
      active: true,
    },
  ];

  return (
    <div className="about-home">
      <div className="about-home-card">

        {/* ── BACK ── */}
        <div className="al-page-back">
          <a className="al-back-link" href="/">←</a>
        </div>

        {/* ── HERO ── */}
        <div className="ah-hero">
          <div className="ah-logo">🌳</div>
          <h1>TreeOS Land</h1>
          <p className="ah-tagline">
            The first land on the TreeOS network.
          </p>
        </div>

        {/* ── INTRO ── */}
        <div className="ah-section">
          <div className="ah-section-text">
            This is the reference implementation of{" "}
            <a href="/" style={{color: "rgba(255,255,255,0.8)"}}>TreeOS</a>, built by{" "}
            <a href="https://tabors.site" style={{color: "rgba(255,255,255,0.8)"}}>Tabor Holly</a>.
            It runs every built-in extension: understanding runs, dream cycles, raw idea
            placement, Solana wallets, scripts, Stripe billing, energy metering,
            Telegram and Discord gateways. The testbed, the example, and the first
            node in the network.
          </div>
        </div>

        {/* ── ARCHITECTURE ── */}
        <div className="ah-section">
          <div className="ah-section-title">What This Land Runs</div>
          <div className="ah-section-text">
            114 extensions. Full AI orchestration. LLM failover. Per-node customization.
            Daily dream cycles. Federation with the Canopy network.
          </div>
        </div>

        <div className="ah-arch-grid">
          <div className="ah-arch-item">
            <div className="ah-arch-label">AI</div>
            <div className="ah-arch-desc">
              Chat with your trees. Place content. Query for answers. The tree-orchestrator
              classifies intent, navigates, executes, and responds. Per-node tools let you
              add shell access to a DevOps branch or block deletes on an archive.
            </div>
            <a href="/ai" className="ah-arch-link">How AI works</a>
          </div>

          <div className="ah-arch-item">
            <div className="ah-arch-label">Dreams</div>
            <div className="ah-arch-desc">
              Set a dream time and your trees maintain themselves overnight.
              Cleanup reorganizes structure. Short-term drain processes deferred items.
              Understanding runs compress branches into navigational context.
            </div>
            <a href="/about/dreams" className="ah-arch-link">Dream docs</a>
          </div>

          <div className="ah-arch-item">
            <div className="ah-arch-label">Network</div>
            <div className="ah-arch-desc">
              This land peers with others through Canopy. Browse public trees
              across the network. Invite users from other lands. The Horizon
              at horizon.treeos.ai indexes everything.
            </div>
            <a href="/network" className="ah-arch-link">The network</a>
          </div>

          <div className="ah-arch-item">
            <div className="ah-arch-label">Extensions</div>
            <div className="ah-arch-desc">
              Every feature on this land is an extension. Values, schedules, scripts,
              energy, billing, Solana, gateway, blog, prestige. Install what you need.
              Build your own. Publish to the registry.
            </div>
            <a href="/about/extensions" className="ah-arch-link">Extension docs</a>
          </div>
        </div>

        <div className="ah-section">
          <div className="ah-section-title">
            Why This Exists
          </div>
          <div className="ah-section-text">
         
            This is what I believe AI agents need: persistent memory in a navigable
            structure, where instructions and knowledge and history live together,
            readable by both humans and LLMs. A system where people build, share, and
            run LLM complexity on a federated network. Not locked behind someone else's
            API. <a href="/" style={{color: "rgba(255,255,255,0.8)"}}>Open at core.</a>
          </div>
        </div>
        {/* ── EXPLORE ── */}
        <div className="ah-section">
          <div className="ah-section-title">
            <span className="ah-section-icon">📚</span> Explore
          </div>
          <div className="ah-section-text" style={{ marginBottom: "20px" }}>
            Dive deeper into how TreeOS works and what you can build with it.
          </div>

          <div className="ah-nav-grid">
            {sections.map((s, i) =>
              s.active && s.to ? (
                <a key={i} className="ah-nav-item" href={s.to}>
                  <div className="ah-nav-emoji">{s.emoji}</div>
                  <div className="ah-nav-title">{s.title}</div>
                  <div className="ah-nav-desc">{s.desc}</div>
                </a>
              ) : (
                <div key={i} className="ah-nav-item disabled">
                  <div className="ah-nav-emoji">{s.emoji}</div>
                  <div className="ah-nav-title">{s.title}</div>
                  <div className="ah-nav-desc">{s.desc}</div>
                  <div className="ah-nav-badge">Coming soon</div>
                </div>
              )
            )}
          </div>
        </div>

        {/* ── CTA ── */}
        <div className="ah-cta">
          <a className="ah-cta-btn primary" href="/">Back To Home</a>
        </div>

      </div>
    </div>
  );
};

export default AboutHome;