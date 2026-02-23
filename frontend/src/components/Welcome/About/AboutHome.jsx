import { Link } from "react-router-dom";
import "./AboutHome.css";

const AboutHome = () => {
  const sections = [
    {
      emoji: "🌱",
      title: "Getting Started",
      desc: "Your first tree, first node, first note. Up and running in two minutes.",
      to: "/about/gettingstarted",
      active: false,
    },
    {
      emoji: "🧠",
      title: "How AI Fits In",
      desc: "Understandings, chat, and how Tree uses AI to surface what matters.",
      to: "/about/ai",
      active: false,
    },
    {
      emoji: "🔌",
      title: "API Reference",
      desc: "Read and write to your trees programmatically. Build bots, scripts, and integrations.",
      to: "/about/api/#overview",
      active: true,
    },
    {
      emoji: "⚡",
      title: "Energy System",
      desc: "How energy works, what it costs, and how to bring your own LLM.",
      to: "/about/energy",
      active: true,
    },
  ];

  return (
    <div className="about-home">
      <div className="about-home-card">

        {/* ── HERO ── */}
        <div className="ah-hero">
          <div className="ah-logo">🌳</div>
          <h1>Tree</h1>
          <p className="ah-tagline">
            A living structure for everything you're building, thinking, and tracking.
          </p>
        </div>

        {/* ── INTRO ── */}
        <div className="ah-section">
          <div className="ah-section-title">
             What is Tree?
          </div>
          <div className="ah-section-text">
        Tree is a shared workspace where you and the AI operate in the same context.
It is structured as a tree of nodes, which can represent things like plans, instructions, knowledge, code, or tracked metrics.
Both you and the AI can read from and write to the Tree, allowing the context to evolve over time as work progresses.
            <br /><br />
            Invite collaborators to build together, use it solo to stay
            organized, or design systems that others can follow. Tree works
            however you need it to.
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
            Dive deeper into how Tree works and what you can build with it.
          </div>

          <div className="ah-nav-grid">
            {sections.map((s, i) =>
              s.active && s.to ? (
                <Link key={i} className="ah-nav-item" to={s.to}>
                  <div className="ah-nav-emoji">{s.emoji}</div>
                  <div className="ah-nav-title">{s.title}</div>
                  <div className="ah-nav-desc">{s.desc}</div>
                </Link>
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