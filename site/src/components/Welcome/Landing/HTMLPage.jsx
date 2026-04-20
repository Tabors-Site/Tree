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
            Install an extension and it adds tools the AI can call, commands the CLI shows,
            and pages the browser renders. All from one package. Uninstall it and all three
            vanish together. Block it at a branch and the AI loses the tool, the CLI loses
            the command, and the browser loses the page. At that position. Same tree. Same rules.
            Three interfaces that always agree.
          </p>
          <div className="lp-hero-ctas">
            <a className="lp-btn lp-btn-secondary" href="/seed">The Seed</a>
            <a className="lp-btn lp-btn-secondary" href="/extensions">Extensions</a>
            <a className="lp-btn lp-btn-secondary" href="/build">Build</a>
          </div>
        </div>
      </section>

      {/* ── WHY THIS MATTERS ── */}
      <section className="lp-section">
        <div className="lp-container" style={{maxWidth: 800}}>
          <h2 className="lp-section-title">Why This Matters</h2>
          <P>
            Most platforms have a frontend team and a backend team and they disagree about what the UI
            should show. The frontend checks permissions its own way. The backend checks a different way.
            They drift. Buttons appear that lead to 404s. Links show for features that aren't installed.
            Admin panels display options the user can't actually use.
          </P>
          <P>
            TreeOS doesn't have this problem. The same extension that registers an AI tool also registers
            the UI that displays it. The same spatial scoping that determines whether the AI can use a
            tool at a position determines whether the browser shows it. Install the solana extension and
            the wallet link appears on every node's values page. Block solana on a Journal tree and the
            wallet link vanishes there. Not because of a CSS rule. Because the kernel filtered it using
            the same resolution chain that filtered the AI's tools.
          </P>
          <P style={{color: "rgba(255,255,255,0.4)"}}>
            One extension. One init(). Backend logic, AI tools, CLI commands, and browser UI.
            All deployed together. All scoped together. All removed together.
            The frontend is not a separate app. It's a view into the same tree the AI sees.
          </P>
        </div>
      </section>

      {/* ── THE PATTERN ── */}
      <section className="lp-section lp-section-alt">
        <div className="lp-container" style={{maxWidth: 800}}>
          <h2 className="lp-section-title">?html</h2>
          <P>
            Every API endpoint returns JSON by default. Add <code>?html</code> to the query string
            and the same endpoint returns a rendered HTML page instead. Same data. Same auth.
            Same URL. Different format.
          </P>
          <Code>{`# JSON (for CLI, AI, extensions, integrations)
GET /api/v1/node/abc-123
-> { "status": "ok", "data": { "name": "Fitness", "type": "goal", "children": [...] } }

# HTML (for browsers)
GET /api/v1/node/abc-123?html
-> <html>... rendered page with the same node data ...</html>`}</Code>
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

      {/* ── UI SLOTS ── */}
      <section className="lp-section">
        <div className="lp-container" style={{maxWidth: 800}}>
          <h2 className="lp-section-title">UI Slots</h2>
          <P>
            Pages don't know which extensions are installed. They define named slots.
            Extensions register HTML fragments for those slots during init().
            The page resolves whatever's registered.
            Same pattern as hooks, modes, and tools. Extensions register. The resolver filters.
          </P>
          <Code>{`// Extension registers a fragment for the apps page grid
const treeos = getExtension("treeos-base");
treeos?.exports?.registerSlot?.("apps-grid", "fitness", (ctx) => {
  const roots = ctx.rootMap.get("Fitness") || [];
  return \`<div class="app-card">
    <div class="app-header">
      <span class="app-emoji">&#x1F4AA;</span>
      <span class="app-name">Fitness</span>
    </div>
    <div class="app-desc">Track workouts. Progressive overload.</div>
    \${roots.map(r => \`<a class="app-active" href="...">\${r.name}</a>\`).join("")}
  </div>\`;
}, { priority: 10 });

// The apps page resolves all registered cards:
const cards = resolveSlots("apps-grid", { userId, rootMap, tokenParam });
// -> fitness card + food card + kb card + whatever else is installed`}</Code>
          <P>
            Spatial scoping applies to slots. If an extension is blocked at the current node position,
            its slot fragments don't render. The page doesn't decide. The slot resolver uses the same
            spatial scoping that filters the AI's tools.
          </P>

          <h3 style={{color: "#fff", fontSize: "1rem", marginTop: 28, marginBottom: 12}}>Slot Names</h3>
          <div style={{maxWidth: 600, margin: "0 auto"}}>
            {[
              ["apps-grid", "App cards on the /apps page. Fitness, food, recovery, study, kb each register one."],
              ["user-quick-links", "Links on the user profile page. Notes, AI Chats, Contributions, Mail, Invites, etc."],
              ["user-profile-badge", "Tier badge or plan badge on the profile header."],
              ["user-profile-energy", "Energy meter on the profile header."],
              ["user-profile-sections", "Full sections below the profile header. Raw idea capture form, etc."],
              ["tree-quick-links", "Back-nav links on the tree overview page. AI Chats, etc."],
              ["tree-owner-sections", "Owner-only sections on the tree overview. Gateway config, etc."],
              ["tree-holdings", "Holdings section on tree overview. Deferred cascade items."],
              ["tree-dream", "Dream schedule section on tree overview."],
              ["tree-team", "Team/collaboration section on tree overview."],
              ["node-detail-sections", "Sections on the node detail page. Values, versions, etc."],
              ["node-detail-below", "Below the detail sections. Scripts, etc."],
              ["node-type-options", "Options inside the node type dropdown."],
              ["energy-payment", "Payment/billing UI on the energy page. Only renders if billing extension installed."],
              ["version-badge", "Badge on version detail page."],
              ["version-meta-cards", "Metadata cards on version detail."],
              ["version-detail-sections", "Full sections on version detail."],
            ].map(([name, desc]) => (
              <div key={name} style={{padding: "10px 0", borderBottom: "1px solid rgba(255,255,255,0.04)"}}>
                <code style={{color: "#6ee7b7", fontSize: "0.85rem"}}>{name}</code>
                <span style={{color: "#666", fontSize: "0.85rem", marginLeft: 12}}>{desc}</span>
              </div>
            ))}
          </div>

          <h3 style={{color: "#fff", fontSize: "1rem", marginTop: 28, marginBottom: 12}}>Raw Mode</h3>
          <P>
            By default, each slot fragment is wrapped in a <code>{"<div data-slot=\"...\" data-ext=\"...\">"}</code> for
            live WebSocket updates. When slots render inside elements that don't allow div children
            (like <code>{"<ul>"}</code> or <code>{"<select>"}</code>), pass <code>{`{ raw: true }`}</code> to skip the wrapper:
          </P>
          <Code>{`// Inside a <ul> - divs would break the HTML
<ul class="nav-links">
  \${resolveSlots("user-quick-links", { userId, queryString }, { raw: true })}
</ul>

// Inside a <select> - divs would completely break rendering
<select>
  \${resolveSlots("node-type-options", { node }, { raw: true })}
</select>`}</Code>
        </div>
      </section>

      {/* ── LIVE UPDATES ── */}
      <section className="lp-section lp-section-alt">
        <div className="lp-container" style={{maxWidth: 800}}>
          <h2 className="lp-section-title">Live Dashboard Updates</h2>
          <P>
            When extension data changes (a workout is logged, a meal is tracked, a note is added),
            the dashboard updates without a page refresh. Two mechanisms work together.
          </P>

          <h3 style={{color: "#fff", fontSize: "1rem", marginTop: 20, marginBottom: 12}}>After Chat Response</h3>
          <P>
            Every app dashboard includes a chat bar (via <code>chatBarJs</code>). After the AI responds,
            the built-in <code>refreshDashboardData()</code> function re-fetches the page HTML, parses it,
            and swaps the layout content. The dashboard updates in place. No full reload.
          </P>

          <h3 style={{color: "#fff", fontSize: "1rem", marginTop: 20, marginBottom: 12}}>Background Changes via WebSocket</h3>
          <P>
            When data changes from other sources (cascade signals, background jobs, another device),
            extensions emit a <code>dashboardUpdate</code> event via WebSocket. The client catches it
            and re-fetches the page.
          </P>
          <Code>{`// Server side: extension hooks emit updates when data changes
core.hooks.register("afterNote", async ({ nodeId }) => {
  const node = await core.models.Node.findById(nodeId).select("rootOwner metadata").lean();
  if (!node?.rootOwner) return;
  const fm = node.metadata instanceof Map ? node.metadata.get("fitness") : node.metadata?.fitness;
  if (!fm?.role) return;
  core.websocket?.emitToUser?.(
    String(node.rootOwner),
    "dashboardUpdate",
    { rootId: String(node.rootOwner) }
  );
}, "fitness");

// Client side: chatBarJs connects via socket.io and listens
socket.on("dashboardUpdate", function(msg) {
  if (msg.rootId !== currentRootId) return;
  if (document.body.classList.contains("thinking")) return;
  refreshDashboardData();
});`}</Code>

          <h3 style={{color: "#fff", fontSize: "1rem", marginTop: 20, marginBottom: 12}}>emitSlotUpdate</h3>
          <P>
            For more targeted updates, <code>emitSlotUpdate</code> re-renders a single slot fragment
            and pushes just that HTML to the client. The client swaps the matching <code>data-slot</code> container.
          </P>
          <Code>{`// Re-render one extension's fragment for one slot and push to the user
const treeos = getExtension("treeos-base");
treeos?.exports?.emitSlotUpdate?.(core, userId, "apps-grid", "fitness", { rootMap });`}</Code>
        </div>
      </section>

      {/* ── THE APP SHELL ── */}
      <section className="lp-section">
        <div className="lp-container" style={{maxWidth: 800}}>
          <h2 className="lp-section-title">The App Shell</h2>
          <P>
            The <code>/dashboard</code> route serves the app shell: a split-panel layout with a chat
            panel on the left and an iframe viewport on the right. The iframe loads HTML pages. The chat
            panel connects via WebSocket for real-time AI conversation.
          </P>
          <P>
            When the iframe navigates to an app dashboard (e.g. <code>/root/:id/fitness?html</code>),
            the app shell detects the URL change, extracts the rootId, and emits <code>urlChanged</code> so
            the server switches the chat session to that tree. The tree's mode overrides kick in
            automatically. You're on the fitness page, the AI thinks in fitness mode.
          </P>

          <h3 style={{color: "#fff", fontSize: "1rem", marginTop: 20, marginBottom: 12}}>inApp</h3>
          <P>
            The app shell adds <code>?inApp=1</code> to every iframe URL. Dashboard pages check this
            and skip rendering their own chat bar, because the app shell's chat panel handles conversation.
            Without this check, there would be two chat interfaces: the shell's panel and the iframe's bar.
          </P>
          <Code>{`// In your dashboard renderer
export function renderMyDashboard({ rootId, rootName, token, userId, inApp }) {
  return page({
    css: css + (!inApp ? chatBarCss() : ""),
    body: body + (!inApp ? chatBarHtml({ placeholder: "..." }) : ""),
    js: !inApp ? chatBarJs({ endpoint: \`/api/v1/root/\${rootId}/my-ext\`, token, rootId }) : "",
  });
}

// In your route handler, pass inApp through
res.send(renderMyDashboard({
  rootId, rootName, token: req.query.token,
  userId: req.userId, inApp: !!req.query.inApp,
}));`}</Code>
          <P>
            When loaded standalone (direct URL, no iframe), dashboards keep their embedded chat bar.
            When loaded inside the app shell, the shell owns the chat. One codebase, two contexts.
          </P>
        </div>
      </section>

      {/* ── BUILDING TREEOS APPS ── */}
      <section className="lp-section lp-section-alt">
        <div className="lp-container" style={{maxWidth: 800}}>
          <h2 className="lp-section-title">Building an App Extension</h2>
          <P>
            A TreeOS app is an extension that registers pages, tools, modes, slots, and hooks.
            The tree is the database. The AI is the backend logic. The HTML is the frontend.
            The CLI is the power user interface. All four access the same data through the same API.
          </P>
          <Code>{`// manifest.js
export default {
  name: "my-app",
  version: "1.0.0",
  description: "My custom app",
  needs: { services: ["hooks", "modes", "metadata"], models: ["Node"], extensions: [] },
  optional: { extensions: ["treeos-base", "html-rendering"] },
  provides: { routes: true, tools: true, cli: [
    { command: "my-app", scope: ["tree"], description: "Talk to my app", method: "POST",
      endpoint: "/root/:rootId/my-app", body: { message: "$message" } },
  ]},
};

// index.js
export async function init(core) {
  // Register AI modes
  core.modes.registerMode("tree:my-app-log", myLogMode, "my-app");
  core.modes.registerMode("tree:my-app-plan", myPlanMode, "my-app");

  // Register app card on the apps page
  const treeos = getExtension("treeos-base");
  treeos?.exports?.registerSlot?.("apps-grid", "my-app", (ctx) => {
    return \`<div class="app-card">...</div>\`;
  }, { priority: 60 });

  // Live dashboard updates when data changes
  core.hooks.register("afterNote", async ({ nodeId }) => {
    // ... emit dashboardUpdate for this tree
  }, "my-app");

  core.hooks.register("afterMetadataWrite", async ({ nodeId, extName }) => {
    if (extName !== "my-app" && extName !== "values") return;
    // ... emit dashboardUpdate for this tree
  }, "my-app");

  // Enrich AI context
  core.hooks.register("enrichContext", async ({ context, node, meta }) => {
    const myMeta = meta?.["my-app"];
    if (!myMeta?.role) return;
    context.myAppState = await getState(String(node._id));
  }, "my-app");

  // Routes + tools
  const router = (await import("./routes.js")).default;
  const tools = (await import("./tools.js")).default();

  return { router, tools, modeTools: [
    { modeKey: "tree:my-app-plan", toolNames: ["my-app-create", "my-app-update"] },
  ]};
}`}</Code>
        </div>
      </section>

      {/* ── RENDERING STACK ── */}
      <section className="lp-section">
        <div className="lp-container" style={{maxWidth: 800}}>
          <h2 className="lp-section-title">The Rendering Stack</h2>
          <P>
            No React. No build step. No client-side framework. Server-rendered HTML from template strings.
            The same Node.js process that runs the AI serves the pages. Fast, lightweight, works everywhere.
          </P>
          <div style={{maxWidth: 600, margin: "0 auto"}}>
            {[
              ["page()", "html-rendering/html/layout.js. The HTML document skeleton. Every page calls this with title, css, body, js."],
              ["baseStyles", "html-rendering/html/baseStyles.js. Shared CSS: glass cards, headers, forms, grids, animations. Import what you need."],
              ["chatBarJs()", "html-rendering/html/chatBar.js. Embeddable chat widget. Handles send, receive, thinking animation, history, auto-send, live dashboard refresh."],
              ["renderAppDashboard()", "html-rendering/html/appDashboard.js. Generic app dashboard. Pass hero, stats, bars, cards, commands. Gets chatbar, delete button, entry animations."],
              ["resolveSlots()", "treeos-base/slots.js. Resolve registered HTML fragments for a named slot. Filters by spatial scoping."],
              ["emitSlotUpdate()", "treeos-base/slots.js. Push a re-rendered slot fragment to the client via WebSocket."],
            ].map(([name, desc]) => (
              <div key={name} style={{padding: "12px 0", borderBottom: "1px solid rgba(255,255,255,0.04)"}}>
                <code style={{color: "#6ee7b7", fontSize: "0.85rem"}}>{name}</code>
                <div style={{color: "#666", fontSize: "0.85rem", marginTop: 4}}>{desc}</div>
              </div>
            ))}
          </div>
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
