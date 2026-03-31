import "./LandingPage.css";

const StartPage = () => {
  return (
    <div className="lp">

      {/* ── HERO ── */}
      <section className="lp-hero" style={{minHeight: "45vh"}}>
        <div className="lp-hero-inner">
          <h1 className="lp-title">Get Started</h1>
          <p className="lp-subtitle">Your own AI. Your own system. Free.</p>
          <p className="lp-tagline">
            TreeOS is not a product. It is not for sale. It is already yours. Download a land,
            connect an LLM, and start building. The only cost is the hardware you run it on
            and whatever LLM provider you choose.
          </p>
        </div>
      </section>

      {/* ── JOIN OR HOST ── */}
      <section className="lp-section">
        <div className="lp-container" style={{maxWidth: 800}}>
          <h2 className="lp-section-title">Join a Land or Make Your Own</h2>
          <P>
            You have two options. Join someone else's land, or run your own.
          </P>
          <div className="lp-cards-3" style={{gridTemplateColumns: "1fr 1fr"}}>
            <div className="lp-card">
              <h3>Join a Land</h3>
              <p style={{fontSize: "0.85rem", color: "#888", lineHeight: 1.7}}>
                Someone you know is already running a land. They give you the URL.
                You register, connect your LLM, and start. Their server, their extensions,
                your trees. Your data lives on their land. Good for teams, families, small groups.
              </p>
              <div style={{background: "rgba(0,0,0,0.3)", borderRadius: 6, padding: "10px 14px", marginTop: 12, fontFamily: "monospace", fontSize: "0.8rem", color: "#888", lineHeight: 1.7}}>
                treeos connect https://their-land.com<br/>
                treeos register<br/>
                treeos start
              </div>
            </div>
            <div className="lp-card">
              <h3>Run Your Own</h3>
              <p style={{fontSize: "0.85rem", color: "#888", lineHeight: 1.7}}>
                Download the land server. Run it on your laptop, a VPS, a Raspberry Pi, anywhere
                Node.js and MongoDB run. You control everything. Your data never leaves your machine.
              </p>
              <div style={{background: "rgba(0,0,0,0.3)", borderRadius: 6, padding: "10px 14px", marginTop: 12, fontFamily: "monospace", fontSize: "0.8rem", color: "#888", lineHeight: 1.7}}>
                npx create-treeos my-land<br/>
                cd my-land<br/>
                npm start
              </div>
              <a href="/land" style={{display: "inline-block", marginTop: 14, fontSize: "0.85rem", color: "#6ee7b7"}}>
                Full setup guide
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* ── CLI OR BROWSER ── */}
      <section className="lp-section lp-section-alt">
        <div className="lp-container" style={{maxWidth: 800}}>
          <h2 className="lp-section-title">CLI or Browser</h2>
          <P>
            Every land comes with two interfaces. The CLI is a terminal shell. The browser
            is server-rendered HTML pages. Use whichever you prefer. Both talk to the same tree.
          </P>
          <div className="lp-cards-3" style={{gridTemplateColumns: "1fr 1fr"}}>
            <div className="lp-card">
              <h3>CLI</h3>
              <p style={{fontSize: "0.85rem", color: "#888", lineHeight: 1.7}}>
                <code>npm install -g treeos</code><br/><br/>
                Navigate like a filesystem. <code>cd</code>, <code>ls</code>, <code>chat</code>, <code>note</code>.
                Named sessions let you hold parallel conversations at different positions.
                Extension commands appear automatically.
              </p>
            </div>
            <div className="lp-card">
              <h3>Browser</h3>
              <p style={{fontSize: "0.85rem", color: "#888", lineHeight: 1.7}}>
                Open your land URL in a browser. The app shell gives you a chat panel
                and a viewport. Navigate trees, view dashboards, manage extensions.
                Some lands may not have HTML pages enabled. That's the operator's choice.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ── EXTENSIONS ── */}
      <section className="lp-section">
        <div className="lp-container" style={{maxWidth: 800}}>
          <h2 className="lp-section-title">Choosing Extensions</h2>
          <P>
            When you first boot, the setup wizard asks which extension profile you want.
          </P>
          <div style={{maxWidth: 500, margin: "0 auto 20px"}}>
            {[
              ["Minimal", "8 extensions. The kernel and navigation. Zero LLM usage when idle. For builders and testing."],
              ["Standard", "50+ extensions. Personal use. Cascade, intelligence, apps. Moderate LLM usage."],
              ["Full", "Everything. All 95 extensions. All gateways. All bundles. Recommended."],
            ].map(([name, desc]) => (
              <div key={name} style={{padding: "12px 0", borderBottom: "1px solid rgba(255,255,255,0.04)"}}>
                <strong style={{color: "#fff"}}>{name}</strong>
                <span style={{color: "rgba(255,255,255,0.5)", fontSize: "0.9rem", marginLeft: 12}}>{desc}</span>
              </div>
            ))}
          </div>
          <P>
            We recommend Full. You can always disable what you don't need later. Extensions that aren't
            relevant stay quiet. The system is designed for everything to be installed. You can also
            install individual extensions or bundles from the Horizon registry at any time.
          </P>
        </div>
      </section>

      {/* ── TALKING TO YOUR TREE ── */}
      <section className="lp-section lp-section-alt">
        <div className="lp-container" style={{maxWidth: 800}}>
          <h2 className="lp-section-title">Talking to Your Tree</h2>
          <P>
            The AI understands where you are. Navigate to a position and talk naturally.
            You don't need special syntax. Just say what you mean.
          </P>
          <Code>{`cd Fitness/Workouts
chat "add a back day with deadlifts and rows"
chat "I did 225x5 on deadlift today"
chat "how's my progress this week"`}</Code>
          <P>
            The AI reads the branch you're in, its notes, its children, its metadata.
            It responds from that position's perspective. Move somewhere else and the context changes.
          </P>

          <h3 style={{color: "#fff", fontSize: "1rem", marginTop: 24, marginBottom: 12}}>Three Modes</h3>
          <P>
            Every message has an intent. The tree routes it to the right mode.
          </P>
          <div style={{maxWidth: 500, margin: "0 auto"}}>
            {[
              ["chat", "Conversation. Ask questions, discuss, think out loud. The AI reads and responds but doesn't write."],
              ["place", "Write. The AI creates nodes, posts notes, updates values. It changes the tree."],
              ["query", "Read-only question. The AI searches the branch and answers. No writes. No side effects."],
            ].map(([name, desc]) => (
              <div key={name} style={{padding: "10px 0", borderBottom: "1px solid rgba(255,255,255,0.04)"}}>
                <code style={{color: "#6ee7b7", fontSize: "0.9rem"}}>{name}</code>
                <span style={{color: "rgba(255,255,255,0.5)", fontSize: "0.85rem", marginLeft: 12}}>{desc}</span>
              </div>
            ))}
          </div>
          <P style={{marginTop: 16}}>
            In the CLI, these are commands: <code>chat</code>, <code>place</code>, <code>query</code>.
            In the browser, the chat bar sends as chat by default. Extensions add their own modes
            on top of these three.
          </P>
        </div>
      </section>

      {/* ── MAKING EXTENSIONS ── */}
      <section className="lp-section">
        <div className="lp-container" style={{maxWidth: 800}}>
          <h2 className="lp-section-title">Making Extensions</h2>
          <Code>{`cp -r extensions/_template extensions/my-extension`}</Code>
          <P>
            Edit <code>manifest.js</code> to declare what you need and provide.
            Edit <code>index.js</code> to register hooks, modes, tools, routes, and slots.
            The loader handles the rest. Full reference
            at <a href="/build" style={{color: "#6ee7b7"}}>/build</a> and <a href="/html" style={{color: "#6ee7b7"}}>/html</a>.
          </P>
          <P>
            Publish to the Horizon with <code>treeos ext publish my-extension</code>.
            Anyone on the network can install it with <code>treeos ext install my-extension</code>.
          </P>
        </div>
      </section>

      {/* ── THIS IS YOURS ── */}
      <section className="lp-section lp-section-alt">
        <div className="lp-container" style={{maxWidth: 800}}>
          <h2 className="lp-section-title">This is Yours</h2>
          <P>
            TreeOS is completely free. It is not a product. It is not a startup. It is a system
            for people to have their own AI, on their own terms, running on their own hardware.
          </P>
          <P>
            The network compounds. Every extension someone publishes is available to everyone.
            Every improvement to a base extension benefits every land that uses it. The more
            people build, the more we all have. That's the point.
          </P>
          <P>
            If someone wants to use a land to build a commercial product, they can. The base
            is there. But anyone, anywhere, can always download their own land and get started
            for free. No permission needed. No account required. No paywall.
          </P>
          <P>
            The only things that stay private are custom extensions people choose not to share.
            That is their right. But we share all of ours to the world. They are a base and
            an example for people to build on and understand Tree. We are always looking for
            community improvements, even in our base extensions.
          </P>
          <P style={{color: "rgba(255,255,255,0.4)"}}>
            You don't need TreeOS at all. TreeOS is just the first operating system wrapped
            around the seed. The seed is the kernel: two schemas, a conversation loop, hooks,
            and a loader. You can build whatever you want on top of it. New shapes beyond a tree.
            New interfaces beyond CLI and HTML. The seed is the contract. Everything above it
            is a choice.
          </P>
        </div>
      </section>

      {/* ── GO ── */}
      <section className="lp-section">
        <div className="lp-container" style={{textAlign: "center", maxWidth: 600}}>
          <div style={{display: "flex", flexWrap: "wrap", gap: 12, justifyContent: "center"}}>
            <a className="lp-btn lp-btn-primary" href="/seed">The Seed</a>
            <a className="lp-btn lp-btn-secondary" href="/build">Build</a>
            <a className="lp-btn lp-btn-secondary" href="/html">HTML System</a>
            <a className="lp-btn lp-btn-secondary" href="/extensions">Extensions</a>
            <a className="lp-btn lp-btn-secondary" href="/guide">Full Guide</a>
          </div>
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

const P = ({ children, style }) => (
  <p style={{color: "rgba(255,255,255,0.6)", lineHeight: 1.8, marginBottom: 16, fontSize: "1rem", ...style}}>
    {children}
  </p>
);

const Code = ({ children }) => (
  <pre style={{
    background: "rgba(0,0,0,0.4)",
    border: "1px solid rgba(255,255,255,0.08)",
    borderRadius: 8,
    padding: "16px 20px",
    color: "rgba(255,255,255,0.65)",
    fontSize: "0.85rem",
    lineHeight: 1.6,
    overflowX: "auto",
    marginBottom: 16,
  }}>{children}</pre>
);

export default StartPage;
