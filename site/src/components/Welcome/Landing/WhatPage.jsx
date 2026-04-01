import "./LandingPage.css";

const WhatPage = () => {
  return (
    <div className="lp">

      {/* ── HERO ── */}
      <section className="lp-hero" style={{minHeight: "50vh"}}>
        <div className="lp-hero-inner">
          <h1 className="lp-title">What Is TreeOS?</h1>
          <p className="lp-subtitle">Apps and a filesystem. You need both.</p>
          <p className="lp-tagline">
            Nobody buys a computer to use a filesystem. They buy it to run apps.
            But the filesystem is why the apps can exist, share data, and be replaced.
            TreeOS is both. The structured extensions are applications.
            The free-form tree is the operating system.
          </p>
          <div className="lp-hero-ctas">
            <a className="lp-btn lp-btn-primary" href="/start">Start</a>
            <a className="lp-btn lp-btn-secondary" href="/seed">The Seed</a>
            <a className="lp-btn lp-btn-secondary" href="/extensions">Extensions</a>
          </div>
        </div>
      </section>

      {/* ── THREE LAYERS ── */}
      <section className="lp-section">
        <div className="lp-container" style={{maxWidth: 900}}>
          <h2 className="lp-section-title">Three Layers</h2>
          <p className="lp-section-sub">
            The kernel provides structure. Extensions provide applications.
            The user provides shape.
          </p>
          <div className="lp-cards-3">
            <div className="lp-card">
              <h3><a href="/seed" style={{color: "#fff", textDecoration: "none"}}>The Kernel</a></h3>
              <p>
                Twelve fields on a node. Seven fields on a user. A metadata Map that grows anything.
                A conversation loop. 29 hooks. A cascade engine. This is the filesystem.
                It doesn't know what a workout is. It knows what a node is.
              </p>
            </div>
            <div className="lp-card">
              <h3><a href="/extensions" style={{color: "#fff", textDecoration: "none"}}>Extensions</a></h3>
              <p>
                Food, fitness, study, recovery, kb. These are the applications.
                They give the tree modes, tools, and structure. They parse domain-specific input.
                They track domain-specific values. They make the tree useful for a specific thing.
              </p>
            </div>
            <div className="lp-card">
              <h3>Your Tree</h3>
              <p>
                Free-form. You create nodes the extensions don't know about.
                A Supplements node under Food. A Swimming node under Fitness.
                A personal journal branch with no extension at all. Just notes on nodes.
                The AI reads them without any extension owning them.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ── STRUCTURED VS FREE-FORM ── */}
      <section className="lp-section lp-section-alt">
        <div className="lp-container" style={{maxWidth: 800}}>
          <h2 className="lp-section-title">Structured vs Free-Form</h2>
          <P>
            The structured extensions work better because they have specific prompts, specific tools,
            specific parsing. The free-form path works because the kernel handles any node.
            Both live in the same tree. Both are nodes with notes and metadata.
          </P>
          <div className="lp-cards-3" style={{gridTemplateColumns: "1fr 1fr"}}>
            <div className="lp-card">
              <h3 style={{color: "#6ee7b7"}}>Structured</h3>
              <p style={{fontSize: "0.85rem", color: "#888", marginBottom: 12}}>
                Extension installed. Mode override set. Tools available. Parser active.
              </p>
              <Code>{`"bench 135x10"

→ parsed by fitness extension
→ routed to exercise node
→ values tracked (weight, sets, reps)
→ progressive overload calculated
→ coach responds with context`}</Code>
            </div>
            <div className="lp-card">
              <h3>Free-Form</h3>
              <p style={{fontSize: "0.85rem", color: "#888", marginBottom: 12}}>
                No extension claims this position. Default mode. AI reads context and talks.
              </p>
              <Code>{`"bench 135x10"

→ stored as a note
→ AI can read it
→ no special tracking
→ no routing
→ no overload logic`}</Code>
            </div>
          </div>
          <P style={{marginTop: 24}}>
            Most people will use extensions 90% of the time and free-form 10% for the things
            no extension covers yet. That 10% is where
            the <a href="/extensions" style={{color: "#6ee7b7"}}>evolve extension</a> watches
            and proposes new ones.
          </P>
        </div>
      </section>

      {/* ── POSITION DETERMINES REALITY ── */}
      <section className="lp-section">
        <div className="lp-container" style={{maxWidth: 800}}>
          <h2 className="lp-section-title">Position Determines Reality</h2>
          <P>
            The routing problem feels complex if you think from the message. "What does the user mean?"
            That's infinite. You can't classify every possible human utterance.
          </P>
          <P>
            Flip it. Think from the position. The user is standing somewhere. That somewhere has a mode.
            The mode has a prompt. The prompt knows how to handle messages at this position.
            The message doesn't need to be classified. The position already classified it.
          </P>
          <Code>{`User at /Health/Fitness:
  "bench 135x10"     → fitness knows what this means
  "how am I doing"   → fitness knows what this means
  "I feel tired"     → fitness knows what this means
  "what's for dinner"→ doesn't belong here. route out.

User at /Life (root):
  "bench 135x10"     → routing index finds fitness
  "how am I doing"   → ambiguous. librarian reads tree.
  "what's for dinner"→ routing index finds food`}</Code>
          <P>
            At a specific position, 90% of messages make sense there. The mode handles them.
            The 10% that don't belong get routed out. At a general position like the root,
            most messages are ambiguous. That's where the routing index and librarian earn their keep.
          </P>

          <h3 style={{color: "#fff", fontSize: "1rem", marginTop: 28, marginBottom: 12}}>Four-Step Fallback</h3>
          <div style={{maxWidth: 600, margin: "0 auto"}}>
            {[
              ["1. Mode override", "Am I at a node with a mode override? That mode handles everything. Done."],
              ["2. Routing index", "No mode override. Does the routing index match an extension? Route there. Done."],
              ["3. Command pattern", "Is this a known pattern? Question goes to query. Destructive goes to translator."],
              ["4. Librarian", "Nothing matches. Librarian reads the tree and figures it out. Or default mode just talks."],
            ].map(([step, desc]) => (
              <div key={step} style={{padding: "12px 0", borderBottom: "1px solid rgba(255,255,255,0.04)"}}>
                <strong style={{color: "#fff", fontSize: "0.9rem"}}>{step}</strong>
                <div style={{color: "rgba(255,255,255,0.5)", fontSize: "0.85rem", marginTop: 4}}>{desc}</div>
              </div>
            ))}
          </div>
          <P style={{marginTop: 20, color: "rgba(255,255,255,0.4)"}}>
            Most messages resolve at step 1 because the user is at a position with an extension.
            The rest cascade through the steps. The system doesn't need to understand every possible
            human utterance. It needs to know where the user is standing.
          </P>
        </div>
      </section>

      {/* ── FIVE MODES OF BEING ── */}
      <section className="lp-section lp-section-alt">
        <div className="lp-container" style={{maxWidth: 800}}>
          <h2 className="lp-section-title">Five Modes of Being</h2>
          <P>
            The user doesn't choose between these explicitly. Position and command determine
            which one fires.
          </P>
          <div style={{maxWidth: 600, margin: "0 auto"}}>
            {[
              ["Structured", "Extension installed, mode override set, tools available, parser active. \"bench 135x10\" gets parsed, tracked, coached."],
              ["Conversational", "No extension claims this position. Default respond mode. AI reads context and talks. \"I'm stressed\" gets a response, note stored."],
              ["Guided", "Extension has a coach mode. AI leads. Type \"be\" and the coach walks you through your workout set by set."],
              ["Query", "Read-only, any position. \"query how am I doing\" reads the branch and answers. No writes. No side effects."],
              ["Navigation", "Routing index or go command. \"go workout\" finds fitness, navigates there. The tree is the map."],
            ].map(([name, desc]) => (
              <div key={name} style={{padding: "14px 0", borderBottom: "1px solid rgba(255,255,255,0.04)"}}>
                <strong style={{color: "#6ee7b7", fontSize: "0.95rem"}}>{name}</strong>
                <div style={{color: "rgba(255,255,255,0.5)", fontSize: "0.9rem", marginTop: 4, lineHeight: 1.7}}>{desc}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── THE SPIRIT ── */}
      <section className="lp-section">
        <div className="lp-container" style={{maxWidth: 700, textAlign: "center"}}>
          <h2 className="lp-section-title">The Spirit</h2>
          <P style={{fontSize: "1.05rem"}}>
            The apps get people in the door. The free-form tree lets them go beyond what
            the apps imagined. The kernel ensures both work through the same twelve fields
            and the same resolution chains.
          </P>
          <P style={{fontSize: "1.05rem"}}>
            Don't choose between structured and free-form.
            The structured extensions are what people use.
            The free-form tree is why they can reshape it.
            The kernel is why both work.
            All three layers. That's TreeOS.
          </P>
          <P style={{color: "rgba(255,255,255,0.35)", marginTop: 24}}>
            Stop trying to design for every mode of being.
            Design for position. The modes of being emerge from where people stand in their tree.
          </P>
          <div style={{marginTop: 32, display: "flex", flexWrap: "wrap", gap: 12, justifyContent: "center"}}>
            <a className="lp-btn lp-btn-primary" href="/start">Get Started</a>
            <a className="lp-btn lp-btn-secondary" href="/ai">AI Architecture</a>
            <a className="lp-btn lp-btn-secondary" href="/build">Build</a>
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

export default WhatPage;
