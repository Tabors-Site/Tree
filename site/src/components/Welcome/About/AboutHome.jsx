
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
            A living structure for everything you're building, thinking, and tracking.
          </p>
        </div>

        {/* ── INTRO ── */}
        <div className="ah-section">
          <div className="ah-section-title">
            What is TreeOS?
          </div>
          <div className="ah-section-text">
            TreeOS is persistent, structured memory for the AI. Instead of
            dumping everything into one flat conversation that gets forgotten,
            a tree organizes knowledge into branches so the AI only pulls in
            what it needs for each interaction. No wasted tokens, no lost context.
            <br /><br />
            It works like a real brain. Information lives in a hierarchy, gets
            compressed and summarized over time, and the AI navigates to the
            relevant parts when you talk to it. Both you and the AI can read
            from and write to the tree, so the context evolves as work progresses.
            <br /><br />
            You can have as many trees as you want, each one for a different
            project, topic, or area of your life. Invite collaborators to build
            together, use it solo to stay organized, or design systems that
            others can follow. TreeOS works however you need it to.
          </div>
        </div>

        <div className="ah-section">
          <div className="ah-section-title">
            Why This Project Exists
          </div>
          <div className="ah-section-text">
            This is a personal project by Tabor Holly.
            <br /><br />
            It's my attempt at building what I believe large language model technology will need going forward: persistent memory, a navigable and fluid GUI driven by text input, and a unified structure where instructions, knowledge, and history all live together — readable by both humans and LLMs.
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