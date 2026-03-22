
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
          <h1>TreeOS</h1>
          <p className="ah-tagline">
            An operating system for context.
          </p>
        </div>

        {/* ── INTRO ── */}
        <div className="ah-section">
          <div className="ah-section-text">
            TreeOS is a self-hosted, modular, federated system for building
            persistent knowledge structures. Lands host trees. Trees hold nodes.
            Nodes carry notes, values, and types. AI interacts through three
            strict modes. Extensions add capabilities. Lands connect into a network.
            The whole thing runs from a terminal.
          </div>
        </div>

        {/* ── ARCHITECTURE ── */}
        <div className="ah-section">
          <div className="ah-section-title">Architecture</div>
          <div className="ah-section-text">
            Four layers. Each one is independent and documented separately.
          </div>
        </div>

        <div className="ah-arch-grid">
          <div className="ah-arch-item">
            <div className="ah-arch-label">Land</div>
            <div className="ah-arch-desc">
              The server. A land stores trees, runs AI, serves the API, and manages users.
              Every land is self-hosted and fully independent. You own your data, your models,
              your rules. Lands connect to each other through federation but work fine standalone.
            </div>
            <a href="/about/land" className="ah-arch-link">Land and Canopy docs</a>
          </div>

          <div className="ah-arch-item">
            <div className="ah-arch-label">Tree</div>
            <div className="ah-arch-desc">
              The data structure. A tree is a hierarchy of nodes, each with notes, trackable values,
              and a semantic type (goal, plan, task, knowledge, resource, identity). Navigate with
              <code>cd</code> and <code>ls</code>. AI interacts through three strict modes:
              chat (read+write), place (write), query (read only).
            </div>
            <a href="/about/node-types" className="ah-arch-link">Node types docs</a>
          </div>

          <div className="ah-arch-item">
            <div className="ah-arch-label">Canopy</div>
            <div className="ah-arch-desc">
              The federation protocol. Lands peer with each other using signed requests.
              Users on one land can browse public trees on another, receive invites,
              and contribute remotely. The directory service at dir.treeos.ai handles
              discovery, public tree indexing, and the extension registry.
            </div>
            <a href="/about/land" className="ah-arch-link">Federation docs</a>
          </div>

          <div className="ah-arch-item">
            <div className="ah-arch-label">Extensions</div>
            <div className="ah-arch-desc">
              The module system. The core protocol handles nodes, notes, values, types,
              and AI modes. Everything else is a package: understanding, scripts, energy,
              billing, dreams, Solana wallets. Install what you need. Disable what you
              don't. Build your own and publish to the registry.
            </div>
            <a href="/about/extensions" className="ah-arch-link">Extension docs</a>
          </div>
        </div>

        <div className="ah-section">
          <div className="ah-section-title">
            Why This Project Exists
          </div>
          <div className="ah-section-text">
            This is a personal project by Tabor Holly.
            <br /><br />
            It's my attempt at building what I believe large language model technology
            will need going forward: persistent memory, a navigable structure driven by
            text input, and a unified system where instructions, knowledge, and history
            all live together, readable by both humans and LLMs.
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