import "./LandingPage.css";

const HTMLPage = () => {
  return (
    <div className="lp">

      {/* ── HERO ── */}
      <section className="lp-hero" style={{minHeight: "50vh"}}>
        <div className="lp-hero-inner">
          <h1 className="lp-title">One Tree, Three Interfaces</h1>
          <p className="lp-subtitle">CLI. AI. Browser. Same data.</p>
          <p className="lp-tagline">
            Every node, note, and value in the tree is accessible three ways.
            The CLI reads and writes it. The AI reads and writes it. The browser
            renders it as HTML. All three see the same tree. All three use the same API.
            The data never diverges.
          </p>
          <div className="lp-hero-ctas">
            <a className="lp-btn lp-btn-secondary" href="/seed">The Seed</a>
            <a className="lp-btn lp-btn-secondary" href="/extensions">Extensions</a>
            <a className="lp-btn lp-btn-secondary" href="/build">Build</a>
          </div>
        </div>
      </section>

      {/* ── THE PATTERN ── */}
      <section className="lp-section">
        <div className="lp-container" style={{maxWidth: 800}}>
          <h2 className="lp-section-title">?html</h2>
          <P>
            Every API endpoint returns JSON by default. Add <code>?html</code> to the query string
            and the same endpoint returns a rendered HTML page instead. Same data. Same auth.
            Same URL. Different format.
          </P>
          <Code>{`# JSON (for CLI, AI, extensions, integrations)
GET /api/v1/node/abc-123
→ { "status": "ok", "data": { "name": "Fitness", "type": "goal", "children": [...] } }

# HTML (for browsers)
GET /api/v1/node/abc-123?html
→ <html>... rendered page with the same node data ...</html>`}</Code>
          <P>
            The kernel serves JSON. The html-rendering extension intercepts <code>?html</code> requests
            and wraps the same data in a visual interface. Remove html-rendering and the API still works.
            The HTML layer is optional. The data layer is the truth.
          </P>
        </div>
      </section>

      {/* ── THREE INTERFACES ── */}
      <section className="lp-section lp-section-alt">
        <div className="lp-container">
          <h2 className="lp-section-title">Three Ways In</h2>
          <div className="lp-cards-3">
            <div className="lp-card">
              <h3><a href="/cli" style={{color: "#fff", textDecoration: "none"}}>CLI</a></h3>
              <p style={{fontSize: "0.85rem", color: "#888"}}>
                Terminal native. <code>cd</code>, <code>ls</code>, <code>chat</code>,
                <code> note</code>, <code>tree</code>. The fastest way to navigate and build.
                Extension commands appear automatically. Power users live here.
              </p>
              <div style={{background: "rgba(0,0,0,0.3)", borderRadius: 6, padding: "10px 14px", marginTop: 12, fontFamily: "monospace", fontSize: "0.8rem", color: "#888", lineHeight: 1.7}}>
                treeos cd Fitness<br/>
                treeos chat "add back day"<br/>
                treeos tree
              </div>
            </div>
            <div className="lp-card">
              <h3>AI</h3>
              <p style={{fontSize: "0.85rem", color: "#888"}}>
                The AI sees the same tree you see. It reads nodes, notes, metadata.
                It calls tools via MCP. It writes notes, creates nodes, changes statuses.
                When you chat, the AI is reading and writing the same data the CLI and browser show.
              </p>
              <div style={{background: "rgba(0,0,0,0.3)", borderRadius: 6, padding: "10px 14px", marginTop: 12, fontFamily: "monospace", fontSize: "0.8rem", color: "#888", lineHeight: 1.7}}>
                [Position]<br/>
                User: tabor<br/>
                Tree: Fitness (abc-123)<br/>
                Current node: Push Day
              </div>
            </div>
            <div className="lp-card">
              <h3>Browser</h3>
              <p style={{fontSize: "0.85rem", color: "#888"}}>
                The HTML rendering extension wraps API data in a visual interface.
                Navigate trees, read notes, view values, manage extensions.
                Every page is the same API call with <code>?html</code> appended.
                What the browser shows is what the CLI returns is what the AI reads.
              </p>
              <div style={{background: "rgba(0,0,0,0.3)", borderRadius: 6, padding: "10px 14px", marginTop: 12, fontFamily: "monospace", fontSize: "0.8rem", color: "#888", lineHeight: 1.7}}>
                /api/v1/node/abc-123?html<br/>
                /api/v1/root/abc-123?html<br/>
                /dashboard
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── DYNAMIC HTML ── */}
      <section className="lp-section">
        <div className="lp-container" style={{maxWidth: 800}}>
          <h2 className="lp-section-title">Dynamic HTML</h2>
          <P>
            The HTML pages are server-rendered. No React. No build step. No client-side framework.
            Template strings that read from the database and return HTML. Fast, lightweight,
            works everywhere. The same Node.js process that runs the AI serves the pages.
          </P>
          <P>
            Pages are assembled from render functions. Each function takes data and returns HTML.
            Extensions register their own render functions. The html-rendering extension provides
            the layout. TreeOS extensions provide the pages. Third-party extensions add their own.
          </P>
          <Code>{`// Extension registers a page
const treeos = getExtension("treeos-base");
treeos?.exports?.registerSlot("node-detail", "my-ext", (ctx) => {
  const data = getExtMeta(ctx.node, "my-ext");
  return \`<div class="my-ext-panel">\${data.summary}</div>\`;
});

// The node detail page resolves all registered slots:
const extraHtml = resolveSlots("node-detail", { node, user });
// → includes my-ext's panel if my-ext is installed
// → excludes it if my-ext is blocked at this position`}</Code>
        </div>
      </section>

      {/* ── SLOTS ── */}
      <section className="lp-section lp-section-alt">
        <div className="lp-container" style={{maxWidth: 800}}>
          <h2 className="lp-section-title">UI Slots</h2>
          <P>
            Pages don't know which extensions are installed. They define slots.
            Extensions register fragments for those slots. The page resolves whatever's registered.
            Same pattern as hooks, modes, and tools. Extensions register. The resolver filters.
          </P>
          <div style={{maxWidth: 600, margin: "0 auto"}}>
            {[
              ["user-profile", "The user profile page. Extensions add energy badges, tier labels, wallet links."],
              ["node-detail", "The node detail view. Extensions add values panels, schedule widgets, script editors."],
              ["tree-overview", "The tree root page. Extensions add understanding summaries, cascade status, health indicators."],
              ["welcome-stats", "The landing page stats row. Extensions add custom metrics."],
              ["land-admin", "The /land admin page. Extensions add their own management sections."],
              ["nav-sidebar", "The navigation sidebar. Extensions add quick links, recent items, bookmarks."],
            ].map(([name, desc]) => (
              <div key={name} style={{padding: "10px 0", borderBottom: "1px solid rgba(255,255,255,0.04)"}}>
                <code style={{color: "#4ade80", fontSize: "0.85rem"}}>{name}</code>
                <span style={{color: "#666", fontSize: "0.85rem", marginLeft: 12}}>{desc}</span>
              </div>
            ))}
          </div>
          <P style={{marginTop: 20, color: "rgba(255,255,255,0.4)", fontSize: "0.85rem"}}>
            Spatial scoping applies to slots. If an extension is blocked at a node position,
            its UI fragments don't render at that position. The page doesn't decide. The slot
            resolver filters. Consistent with tools, hooks, and modes.
          </P>
        </div>
      </section>

      {/* ── BUILDING TREEOS APPS ── */}
      <section className="lp-section">
        <div className="lp-container" style={{maxWidth: 800}}>
          <h2 className="lp-section-title">Building TreeOS Apps</h2>
          <P>
            A TreeOS app is just an extension that registers pages, tools, modes, and slots.
            The tree is the database. The AI is the backend logic. The HTML is the frontend.
            The CLI is the power user interface. All four access the same data through the same API.
          </P>
          <div className="lp-cards-3" style={{gridTemplateColumns: "1fr 1fr"}}>
            <div className="lp-card">
              <h3>Fitness App</h3>
              <p style={{fontSize: "0.85rem", color: "#888"}}>
                The fitness extension registers: two AI modes (coach and log), one route
                (<code>/root/:rootId/fitness</code>), one CLI command (<code>fitness</code>),
                and HTML slots for the node detail page (workout values, set tracking).
                Users interact through chat, CLI, or browser. Same tree.
              </p>
            </div>
            <div className="lp-card">
              <h3>Your App</h3>
              <p style={{fontSize: "0.85rem", color: "#888"}}>
                Create an extension. Register modes for how the AI thinks about your domain.
                Register tools for what the AI can do. Register routes for your API.
                Register slots for your UI fragments. Register CLI commands for power users.
                The tree holds the data. Everything else is a view into it.
              </p>
            </div>
          </div>
          <P style={{marginTop: 20}}>
            <a href="/build" style={{color: "#4ade80"}}>Developer reference</a> covers
            everything: manifest, init, hooks, modes, tools, routes, slots, CLI commands.
          </P>
        </div>
      </section>

      {/* ── THE TRUTH ── */}
      <section className="lp-section lp-section-alt">
        <div className="lp-container" style={{textAlign: "center", maxWidth: 700}}>
          <P style={{fontSize: "1.1rem", color: "rgba(255,255,255,0.6)"}}>
            The tree is the single source of truth. The CLI reads it. The AI reads it.
            The browser renders it. None of them own the data. The tree does.
            When you type <code>treeos note "bench 135x10"</code>, the AI sees it.
            When the AI creates a node, the browser shows it. When you edit in the browser,
            the CLI reflects it. One tree. Three interfaces. Zero divergence.
          </P>
          <div style={{marginTop: 24}}>
            <a className="lp-btn lp-btn-primary" href="/build">Start Building</a>
            <a className="lp-btn lp-btn-secondary" href="/extensions" style={{marginLeft: 12}}>Extensions</a>
            <a className="lp-btn lp-btn-secondary" href="/guide" style={{marginLeft: 12}}>Guide</a>
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

export default HTMLPage;
