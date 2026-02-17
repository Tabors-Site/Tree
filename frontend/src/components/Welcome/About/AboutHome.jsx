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
            <span className="ah-section-icon">💡</span> What is Tree?
          </div>
          <div className="ah-section-text">
            Tree is a workspace where you and AI share the same data. You build
            trees out of nodes, and each node can be whatever you need it to be.
            A project plan, a set of instructions, a knowledge base, a folder of
            notes, a tracked metric. You organize it, the AI reads it, and you
            both work from the same source of truth. The Tree can also grow on its own
            as the AI embodies the knowledge and processes with in.
            <br /><br />
            Invite collaborators to build together, use it solo to stay
            organized, or design systems that others can follow. Tree works
            however you need it to.
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
          <a className="ah-cta-btn primary" href="/login">Open Tree</a>
        </div>

      </div>
    </div>
  );
};

export default AboutHome;