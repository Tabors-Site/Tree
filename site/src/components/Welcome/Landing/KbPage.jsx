import "./LandingPage.css";

const KbPage = () => {
  return (
    <div className="lp">

      {/* ── HERO ── */}
      <section className="lp-hero" style={{minHeight: "80vh"}}>
        <div className="lp-hero-inner">
          <div className="lp-tree-icon">📖</div>
          <h1 className="lp-title">KB</h1>
          <p className="lp-subtitle">The tree that remembers everything you tell it.</p>
          <p className="lp-tagline">
            Tell it things. Ask it things. One person maintains,
            everyone benefits. The tree organizes knowledge into a hierarchy.
            The AI answers from stored notes with citations. The coworker
            who never forgets and never gets interrupted.
          </p>
          <div className="lp-hero-ctas">
            <a className="lp-btn lp-btn-primary" href="/land">Start a Land</a>
            <a className="lp-btn lp-btn-secondary" href="/treeos">What is TreeOS?</a>
          </div>
        </div>
      </section>

      {/* ── HOW IT WORKS ── */}
      <section className="lp-section" style={{paddingTop: 80, paddingBottom: 60}}>
        <div className="lp-container" style={{maxWidth: 760}}>
          <h2 style={{color: "#fff", fontSize: "1.8rem", marginBottom: 48, textAlign: "center"}}>
            Two actions. Tell and ask.
          </h2>

          <div style={{display: "flex", flexDirection: "column", gap: 48}}>

            {/* Tell */}
            <div style={{display: "flex", gap: 24, alignItems: "flex-start"}}>
              <div style={{
                width: 48, height: 48, borderRadius: "50%",
                background: "rgba(72, 187, 120, 0.15)", border: "1px solid rgba(72, 187, 120, 0.3)",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: "1.2rem", fontWeight: 700, color: "#48bb78", flexShrink: 0,
              }}>1</div>
              <div>
                <h3 style={{color: "#fff", fontSize: "1.15rem", marginTop: 0, marginBottom: 8}}>
                  Tell it what you know
                </h3>
                <div style={{
                  background: "rgba(255,255,255,0.04)", borderRadius: 8,
                  padding: "12px 16px", fontFamily: "monospace", fontSize: "0.9rem",
                  color: "rgba(255,255,255,0.7)", marginBottom: 8,
                }}>
                  <span style={{color: "rgba(255,255,255,0.35)"}}>~ {">"} </span>
                  kb "Row A has servers 1-12. Servers 1-6 are Dell R740.<br/>
                  Servers 7-12 are R760. All on circuit breaker panel 3A."<br/><br/>
                  <span style={{color: "rgba(72,187,120,0.8)"}}>
                    Filed under Server Rack Layout / Row A.<br/>
                    Created note with hardware specs and power info.
                  </span>
                </div>
                <p style={{color: "rgba(255,255,255,0.5)", fontSize: "0.9rem", lineHeight: 1.7, margin: 0}}>
                  The AI parsed the input. Detected it's about server racks. Found or created the right
                  branch. Wrote a note. One LLM call. If it can't categorize, it files to Unplaced.
                </p>
              </div>
            </div>

            {/* Ask */}
            <div style={{display: "flex", gap: 24, alignItems: "flex-start"}}>
              <div style={{
                width: 48, height: 48, borderRadius: "50%",
                background: "rgba(102, 126, 234, 0.15)", border: "1px solid rgba(102, 126, 234, 0.3)",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: "1.2rem", fontWeight: 700, color: "#667eea", flexShrink: 0,
              }}>2</div>
              <div>
                <h3 style={{color: "#fff", fontSize: "1.15rem", marginTop: 0, marginBottom: 8}}>
                  Ask it anything
                </h3>
                <div style={{
                  background: "rgba(255,255,255,0.04)", borderRadius: 8,
                  padding: "12px 16px", fontFamily: "monospace", fontSize: "0.9rem",
                  color: "rgba(255,255,255,0.7)", marginBottom: 8,
                }}>
                  <span style={{color: "rgba(255,255,255,0.35)"}}>~ {">"} </span>
                  kb "what do I do if the temperature alarm goes off?"<br/><br/>
                  <span style={{color: "rgba(102,126,234,0.8)"}}>
                    Check the HVAC panel on the east wall. If ambient is above<br/>
                    85F, call facilities at ext 4401. If above 95F, begin<br/>
                    emergency shutdown starting with non-critical servers in Row D.<br/><br/>
                    <span style={{color: "rgba(255,255,255,0.35)"}}>[Source: "Temperature Thresholds" on Alert Procedures/Temperature, updated 3 weeks ago]</span>
                  </span>
                </div>
                <p style={{color: "rgba(255,255,255,0.5)", fontSize: "0.9rem", lineHeight: 1.7, margin: 0}}>
                  The AI answers from the notes in the tree. It cites which note and which branch
                  the answer came from. The source is always visible. The knowledge is always auditable.
                </p>
              </div>
            </div>

            {/* Update */}
            <div style={{display: "flex", gap: 24, alignItems: "flex-start"}}>
              <div style={{
                width: 48, height: 48, borderRadius: "50%",
                background: "rgba(236, 201, 75, 0.15)", border: "1px solid rgba(236, 201, 75, 0.3)",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: "1.2rem", fontWeight: 700, color: "#ecc94b", flexShrink: 0,
              }}>3</div>
              <div>
                <h3 style={{color: "#fff", fontSize: "1.15rem", marginTop: 0, marginBottom: 8}}>
                  Correct and update naturally
                </h3>
                <div style={{
                  background: "rgba(255,255,255,0.04)", borderRadius: 8,
                  padding: "12px 16px", fontFamily: "monospace", fontSize: "0.9rem",
                  color: "rgba(255,255,255,0.7)", marginBottom: 8,
                }}>
                  <span style={{color: "rgba(255,255,255,0.35)"}}>~ {">"} </span>
                  kb "actually servers 7-12 in Row A are R760 not R750"<br/><br/>
                  <span style={{color: "rgba(236,201,75,0.8)"}}>
                    Found existing note on Server Rack Layout / Row A.<br/>
                    Updated: R750 to R760 for servers 7-12.
                  </span>
                </div>
                <p style={{color: "rgba(255,255,255,0.5)", fontSize: "0.9rem", lineHeight: 1.7, margin: 0}}>
                  The AI reads existing notes before writing. If the new info contradicts or updates
                  something, it modifies rather than duplicates. The old version stays in history.
                </p>
              </div>
            </div>

          </div>
        </div>
      </section>

      {/* ── THE TREE STRUCTURE ── */}
      <section className="lp-section" style={{paddingTop: 60, paddingBottom: 60, background: "rgba(255,255,255,0.02)"}}>
        <div className="lp-container" style={{maxWidth: 760}}>
          <h2 style={{color: "#fff", fontSize: "1.5rem", marginBottom: 16, textAlign: "center"}}>
            The tree grows from what you tell it.
          </h2>
          <p style={{color: "rgba(255,255,255,0.5)", textAlign: "center", fontSize: "0.95rem", lineHeight: 1.8, maxWidth: 600, margin: "0 auto 32px"}}>
            Not from a template. Not from a schema. You say things. The AI organizes them.
            The notes are human-editable. The structure is human-navigable. The AI answers from both.
          </p>
          <div style={{
            background: "rgba(255,255,255,0.04)", borderRadius: 10,
            padding: "20px 24px", fontFamily: "monospace", fontSize: "0.85rem",
            color: "rgba(255,255,255,0.6)", lineHeight: 1.9,
          }}>
            <div style={{color: "#fff"}}>Datacenter Ops</div>
            <div>{"├── "}Log{"              "}(where you talk)</div>
            <div>{"├── "}<span style={{color: "#4ade80"}}>Topics</span></div>
            <div>{"│   ├── "}Server Rack Layout</div>
            <div>{"│   │   ├── "}Row A{"          "}(Dell R740/R760, panel 3A)</div>
            <div>{"│   │   ├── "}Row B</div>
            <div>{"│   │   └── "}Cable Management</div>
            <div>{"│   ├── "}Alert Procedures</div>
            <div>{"│   │   ├── "}Temperature{"   "}(thresholds, escalation)</div>
            <div>{"│   │   ├── "}Power Failure{"  "}(UPS sequence, generator)</div>
            <div>{"│   │   └── "}Network Down</div>
            <div>{"│   ├── "}Vendor Contacts</div>
            <div>{"│   └── "}Onboarding</div>
            <div>{"│       ├── "}First Week{"    "}(badge, access, parking)</div>
            <div>{"│       └── "}Safety</div>
            <div>{"├── "}<span style={{color: "#a78bfa"}}>Unplaced</span>{"         "}(can't categorize yet)</div>
            <div>{"├── "}Profile{"          "}(maintainers, access)</div>
            <div>{"└── "}History{"          "}(changes log)</div>
          </div>
        </div>
      </section>

      {/* ── STALENESS ── */}
      <section className="lp-section" style={{paddingTop: 60, paddingBottom: 60}}>
        <div className="lp-container" style={{maxWidth: 760}}>
          <h2 style={{color: "#fff", fontSize: "1.5rem", marginBottom: 16, textAlign: "center"}}>
            It knows what's getting old.
          </h2>
          <p style={{color: "rgba(255,255,255,0.5)", textAlign: "center", fontSize: "0.95rem", lineHeight: 1.8, maxWidth: 600, margin: "0 auto 24px"}}>
            Notes track when they were last updated. The AI flags anything over 90 days.
            Type <code>be</code> at the kb and it walks you through stale notes one by one.
            "Vendor Contacts / Cisco hasn't been touched in 6 months. Still current?"
          </p>
          <div style={{
            background: "rgba(236, 201, 75, 0.06)", border: "1px solid rgba(236, 201, 75, 0.15)",
            borderRadius: 10, padding: "16px 20px", maxWidth: 500, margin: "0 auto",
          }}>
            <div style={{fontSize: "0.8rem", textTransform: "uppercase", letterSpacing: "0.1em", color: "rgba(236,201,75,0.6)", marginBottom: 8}}>Stale Notes</div>
            <div style={{color: "#ecc94b", fontSize: "0.95rem", marginBottom: 4}}>Vendor Contacts / Cisco</div>
            <div style={{color: "rgba(255,255,255,0.35)", fontSize: "0.8rem"}}>180 days since last update</div>
            <div style={{color: "#ecc94b", fontSize: "0.95rem", marginBottom: 4, marginTop: 8}}>Onboarding / Systems Access</div>
            <div style={{color: "rgba(255,255,255,0.35)", fontSize: "0.8rem"}}>95 days since last update</div>
          </div>
        </div>
      </section>

      {/* ── TEAMS ── */}
      <section className="lp-section" style={{paddingTop: 60, paddingBottom: 60, background: "rgba(255,255,255,0.02)"}}>
        <div className="lp-container" style={{maxWidth: 760}}>
          <h2 style={{color: "#fff", fontSize: "1.5rem", marginBottom: 16, textAlign: "center"}}>
            One maintainer. Everyone benefits.
          </h2>
          <p style={{color: "rgba(255,255,255,0.5)", textAlign: "center", fontSize: "0.95rem", lineHeight: 1.8, maxWidth: 600, margin: "0 auto 24px"}}>
            Maintainers tell the kb things. Everyone else asks. A new employee joins the land,
            gets contributor access, types "what do I do on my first day?" The AI reads
            Onboarding/First Week. Answers with badge pickup, access requests, parking info.
            The employee never bothered a coworker.
          </p>
        </div>
      </section>

      {/* ── PROFICIENCY STACK ── */}
      <section className="lp-section" style={{paddingTop: 60, paddingBottom: 60}}>
        <div className="lp-container" style={{maxWidth: 760}}>
          <h2 style={{color: "#fff", fontSize: "1.5rem", marginBottom: 32, textAlign: "center"}}>
            Part of something bigger.
          </h2>
          <p style={{color: "rgba(255,255,255,0.45)", textAlign: "center", fontSize: "0.9rem", marginBottom: 24}}>
            The first four are personal. KB is the first one that scales to teams.
          </p>
          <div style={{display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, maxWidth: 600, margin: "0 auto"}}>
            {[
              {emoji: "🍎", name: "Food", desc: "Fuels the body", color: "rgba(72,187,120,0.15)", href: "/food"},
              {emoji: "💪", name: "Fitness", desc: "Builds the body", color: "rgba(102,126,234,0.15)", href: "/fitness"},
              {emoji: "🌿", name: "Recovery", desc: "Heals the body", color: "rgba(236,201,75,0.15)", href: "/recovery"},
              {emoji: "📚", name: "Study", desc: "Builds the mind", color: "rgba(159,122,234,0.15)", href: "/study"},
              {emoji: "📖", name: "KB", desc: "Builds the team", color: "rgba(96,165,250,0.15)", href: "/kb"},
            ].map(item => (
              <a key={item.name} href={item.href} style={{
                background: item.color, borderRadius: 10, padding: "14px 16px", textAlign: "center",
                textDecoration: "none", display: "block",
              }}>
                <div style={{fontSize: "1.3rem", marginBottom: 4}}>{item.emoji}</div>
                <div style={{color: "#fff", fontWeight: 600, fontSize: "0.9rem"}}>{item.name}</div>
                <div style={{color: "rgba(255,255,255,0.5)", fontSize: "0.75rem"}}>{item.desc}</div>
              </a>
            ))}
          </div>
        </div>
      </section>

      {/* ── UNDER THE HOOD ── */}
      <section className="lp-section" style={{paddingTop: 60, paddingBottom: 60, background: "rgba(255,255,255,0.02)"}}>
        <div className="lp-container" style={{maxWidth: 760}}>
          <h2 style={{color: "#fff", fontSize: "1.5rem", marginBottom: 32, textAlign: "center"}}>
            Under the hood.
          </h2>
          <div style={{display: "flex", flexDirection: "column", gap: 32}}>
            <div>
              <h3 style={{color: "rgba(255,255,255,0.8)", fontSize: "1rem", marginTop: 0, marginBottom: 8}}>Three AI modes</h3>
              <p style={{color: "rgba(255,255,255,0.45)", fontSize: "0.9rem", lineHeight: 1.7, margin: 0}}>
                <strong style={{color: "rgba(255,255,255,0.65)"}}>Tell</strong> parses statements into knowledge. Finds or creates the right topic branch. Updates existing notes when corrections arrive.
                <strong style={{color: "rgba(255,255,255,0.65)"}}> Ask</strong> searches the tree, reads matching notes, assembles answers with citations. Uses scout and embed if available.
                <strong style={{color: "rgba(255,255,255,0.65)"}}> Review</strong> the guidedMode for be. Walks stale notes. Presents each one. Asks if it's current.
              </p>
            </div>
            <div>
              <h3 style={{color: "rgba(255,255,255,0.8)", fontSize: "1rem", marginTop: 0, marginBottom: 8}}>Intelligence integration</h3>
              <p style={{color: "rgba(255,255,255,0.45)", fontSize: "0.9rem", lineHeight: 1.7, margin: 0}}>
                Understanding compresses branches bottom-up. The AI reads encodings to know what's in each
                branch without reading every note. Tree-compress consolidates when branches get too dense.
                Contradiction detects conflicting notes. Purpose checks coherence against the kb's topic.
                The kb extension doesn't implement any of this. It installs alongside the intelligence
                bundle and gets it for free.
              </p>
            </div>
            <div>
              <h3 style={{color: "rgba(255,255,255,0.8)", fontSize: "1rem", marginTop: 0, marginBottom: 8}}>Scales through the tree</h3>
              <p style={{color: "rgba(255,255,255,0.45)", fontSize: "0.9rem", lineHeight: 1.7, margin: 0}}>
                500 notes across 200 nodes. 5,000 notes across 2,000. The tree handles its own scale.
                Understanding creates one-sentence encodings per branch. The AI reads the encoding to know
                what's there, then dives into the specific branch that matches the question. No vector
                database needed. The tree IS the index.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ── CTA ── */}
      <section className="lp-section" style={{paddingTop: 80, paddingBottom: 100, textAlign: "center"}}>
        <div className="lp-container">
          <h2 style={{color: "#fff", fontSize: "1.8rem", marginBottom: 16}}>
            What does your team need to know?
          </h2>
          <p style={{color: "rgba(255,255,255,0.5)", fontSize: "1rem", maxWidth: 500, margin: "0 auto 32px"}}>
            Plant a land. Create a KB tree. Start telling it things.
            Everyone else just asks.
          </p>
          <div className="lp-hero-ctas" style={{justifyContent: "center"}}>
            <a className="lp-btn lp-btn-primary" href="/land">Start a Land</a>
            <a className="lp-btn lp-btn-secondary" href="/extensions">All Extensions</a>
          </div>
        </div>
      </section>

    </div>
  );
};

export default KbPage;
