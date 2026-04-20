import "./LandingPage.css";

const UsePage = () => {
  return (
    <div className="lp">

      {/* ── NAV BAR ── */}
      <div style={{
        display: "flex", gap: 12, justifyContent: "center", padding: "16px 20px",
        flexWrap: "wrap", position: "relative", zIndex: 2,
      }}>
        {[
          { href: "/", label: "Home" },
          { href: "/treeos", label: "TreeOS" },
          { href: "/seed", label: "Seed" },
          { href: "/ai", label: "AI" },
          { href: "/guide", label: "Guide" },
          { href: "/cascade", label: "Cascade" },
          { href: "/extensions", label: "Extensions" },
          { href: "/network", label: "Network" },
          { href: "/lands", label: "Start a Land" },
          { href: "/cli", label: "CLI" },
        ].map(l => (
          <a key={l.href} href={l.href} style={{
            padding: "6px 14px", borderRadius: 6, fontSize: "0.8rem", fontWeight: 500,
            color: "rgba(255,255,255,0.5)", textDecoration: "none",
            background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)",
            transition: "all 0.15s",
          }}>{l.label}</a>
        ))}
      </div>

      {/* ── HERO ── */}
      <section className="lp-hero" style={{minHeight: "60vh"}}>
        <div style={{position: "relative", zIndex: 1}}>
          <h1 className="lp-title" style={{fontSize: "clamp(36px, 6vw, 72px)"}}>You don't use five apps to live one life.</h1>
          <p className="lp-tagline" style={{maxWidth: 520, fontSize: "1.05rem", color: "rgba(255,255,255,0.5)"}}>
            Your fitness app doesn't know what you ate. Your food tracker doesn't know you slept
            four hours. Your journal doesn't know any of it. You live one connected life across
            ten disconnected tools and you're the only thread holding it all together.
          </p>
          <p className="lp-tagline" style={{maxWidth: 520, color: "rgba(255,255,255,0.35)"}}>
            What if you didn't have to be?
          </p>
        </div>
      </section>

      {/* ── TALK ── */}
      <section className="lp-section">
        <div className="lp-container" style={{maxWidth: 700}}>
          <h2 className="lp-section-title">Talk. It knows where you are.</h2>
          <P>
            You don't pick a menu. You don't open a different app. You just say what's on your mind.
          </P>
          <Quote>"Slept terribly."</Quote>
          <P>
            The system knows that's about rest. It remembers you trained heavy yesterday.
            It adjusts what it expects from you today. You didn't navigate anywhere.
            You didn't select a category. You just said what was true and the tree understood.
          </P>
          <Quote>"Made eggs and toast."</Quote>
          <P>
            Now it knows what you ate. It knows your recovery day just started with protein.
            It connects that to everything else without you thinking about it.
          </P>
          <P style={{color: "rgba(255,255,255,0.35)", marginTop: 28}}>
            This is one conversation with something that holds your whole picture.
          </P>
        </div>
      </section>

      {/* ── CONNECTED ── */}
      <section className="lp-section lp-section-alt">
        <div className="lp-container" style={{maxWidth: 700}}>
          <h2 className="lp-section-title">Everything is connected because everything is one tree.</h2>
          <P>
            Most apps are boxes. You put fitness stuff in the fitness box. Food stuff in the food box.
            The boxes don't talk to each other.
          </P>
          <P>
            TreeOS is a tree. Your fitness, your food, your rest, what you're learning, what you know.
            They're all branches of the same thing. They share roots. When one branch changes,
            the others feel it.
          </P>
          <P style={{color: "rgba(255,255,255,0.4)"}}>
            Your rest branch knows what your body branch did. Your food branch knows what your
            rest branch reported. Nothing lives in isolation because you don't live in isolation.
          </P>
        </div>
      </section>

      {/* ── BRANCHES ── */}
      <section className="lp-section">
        <div className="lp-container" style={{maxWidth: 900}}>
          <h2 className="lp-section-title">Five branches. One tree.</h2>
          <p className="lp-section-sub">
            Not five apps. Five parts of the same thing. They're aware of each other.
          </p>
          <div className="lp-cards-3" style={{gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))"}}>
            {[
              { href: "/fitness", name: "Fitness", desc: "Log any workout in natural language. Progressive overload tracked. The coach knows what you ate and how you slept." },
              { href: "/food", name: "Food", desc: "Say what you ate. Macros parsed. Daily totals tracked. It knows when you trained heavy and adjusts what it expects." },
              { href: "/recovery", name: "Recovery", desc: "Track what you're healing from. Patterns surface over time. It sees connections across your whole tree." },
              { href: "/study", name: "Study", desc: "Queue what you want to learn. The AI teaches through conversation, tracks mastery, detects gaps." },
              { href: "/kb", name: "Knowledge", desc: "Tell it things. Ask it things. A knowledge base that remembers everything and knows when information gets stale." },
            ].map(b => (
              <a key={b.name} href={b.href} className="lp-card" style={{textDecoration: "none"}}>
                <h3>{b.name}</h3>
                <p>{b.desc}</p>
              </a>
            ))}
          </div>
        </div>
      </section>

      {/* ── YOURS ── */}
      <section className="lp-section lp-section-alt">
        <div className="lp-container" style={{maxWidth: 700}}>
          <h2 className="lp-section-title">It starts structured. It becomes yours.</h2>
          <P>
            The built-in branches give you real tools from day one. They track, they coach,
            they respond with awareness of your full tree.
          </P>
          <P>
            But you're not locked into what someone else designed. You can grow branches nobody
            imagined. A supplements branch under food. A side project branch. A personal philosophy
            branch with no tools at all. Just a space to think, and an AI that reads everything
            above and below it.
          </P>
          <P style={{color: "rgba(255,255,255,0.4)"}}>
            Start with what's built. Grow into what's yours. The tree doesn't care.
            It holds both the same way.
          </P>
        </div>
      </section>

      {/* ── LEARNS ── */}
      <section className="lp-section">
        <div className="lp-container" style={{maxWidth: 700}}>
          <h2 className="lp-section-title">You shape it. It learns you.</h2>
          <P>
            The more you use it, the more it understands your rhythm. Not because someone
            programmed your routine into it. Because it watched how you actually live.
          </P>
          <P>
            It notices you always think about food after training. It notices your study sessions
            happen on rest days. It notices patterns you haven't even named yet.
          </P>
          <P style={{color: "rgba(255,255,255,0.4)"}}>
            It doesn't force structure on you. It learns the structure you already have
            and makes it visible.
          </P>
        </div>
      </section>

      {/* ── CLOSE ── */}
      <section className="lp-section lp-section-alt">
        <div className="lp-container" style={{maxWidth: 600, textAlign: "center"}}>
          <h2 className="lp-section-title">One life. One tree.</h2>
          <P style={{fontSize: "1.05rem"}}>
            You shouldn't have to be the integration layer between ten apps that don't know
            you exist. Your life is one thing. The tool that holds it should be one thing too.
          </P>
          <P style={{fontSize: "1.05rem"}}>
            TreeOS is a tree that grows with you. The branches are as structured or as freeform
            as you need. The AI meets you wherever you're standing. And everything is connected.
          </P>
          <div style={{marginTop: 32}}>
            <a className="lp-btn lp-btn-primary" href="/start">Start growing</a>
          </div>
        </div>
      </section>

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
              <a href="/lands">Start a Land</a>
              <a href="/cli">CLI</a>
            </div>
            <div className="lp-footer-col">
              <h4>TreeOS</h4>
              <a href="/treeos">Overview</a>
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

const P = ({ children, style }) => (
  <p style={{color: "rgba(255,255,255,0.6)", lineHeight: 1.8, marginBottom: 16, fontSize: "1rem", ...style}}>
    {children}
  </p>
);

const Quote = ({ children }) => (
  <div style={{
    padding: "16px 24px",
    margin: "20px 0",
    borderLeft: "3px solid rgba(255,255,255,0.15)",
    fontSize: "1.1rem",
    color: "rgba(255,255,255,0.8)",
    fontStyle: "italic",
    background: "rgba(255,255,255,0.02)",
    borderRadius: "0 8px 8px 0",
  }}>{children}</div>
);

export default UsePage;
