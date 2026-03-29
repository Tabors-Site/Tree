import "./LandingPage.css";

const StudyPage = () => {
  return (
    <div className="lp">

      {/* ── HERO ── */}
      <section className="lp-hero" style={{minHeight: "80vh"}}>
        <div className="lp-hero-inner">
          <div className="lp-tree-icon">📚</div>
          <h1 className="lp-title">Study</h1>
          <p className="lp-subtitle">The tree that teaches you.</p>
          <p className="lp-tagline">
            Queue what you want to learn. The AI breaks it into a curriculum,
            teaches you through conversation, tracks what you've mastered,
            and detects the gaps you can't see. Study anything. The tree remembers
            where you left off.
          </p>
          <div className="lp-hero-ctas">
            <a className="lp-btn lp-btn-primary" href="/land">Start a Land</a>
            <a className="lp-btn lp-btn-secondary" href="/treeos">What is TreeOS?</a>
          </div>
        </div>
      </section>

      {/* ── HOW IT WORKS (simple, for regular people) ── */}
      <section className="lp-section" style={{paddingTop: 80, paddingBottom: 60}}>
        <div className="lp-container" style={{maxWidth: 760}}>
          <h2 style={{color: "#fff", fontSize: "1.8rem", marginBottom: 48, textAlign: "center"}}>
            Three commands. That's it.
          </h2>

          <div style={{display: "flex", flexDirection: "column", gap: 48}}>

            {/* Step 1 */}
            <div style={{display: "flex", gap: 24, alignItems: "flex-start"}}>
              <div style={{
                width: 48, height: 48, borderRadius: "50%",
                background: "rgba(102, 126, 234, 0.15)", border: "1px solid rgba(102, 126, 234, 0.3)",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: "1.2rem", fontWeight: 700, color: "#667eea", flexShrink: 0,
              }}>1</div>
              <div>
                <h3 style={{color: "#fff", fontSize: "1.15rem", marginTop: 0, marginBottom: 8}}>
                  Queue what you want to learn
                </h3>
                <div style={{
                  background: "rgba(255,255,255,0.04)", borderRadius: 8,
                  padding: "12px 16px", fontFamily: "monospace", fontSize: "0.9rem",
                  color: "rgba(255,255,255,0.7)", marginBottom: 8,
                }}>
                  <span style={{color: "rgba(255,255,255,0.35)"}}>~ {">"} </span>
                  needlearn "React hooks"<br/>
                  <span style={{color: "rgba(102,126,234,0.8)"}}>Queued: "React hooks". 3 items in queue.</span>
                </div>
                <p style={{color: "rgba(255,255,255,0.5)", fontSize: "0.9rem", lineHeight: 1.7, margin: 0}}>
                  URLs work too. Paste an article link and the AI fetches the content,
                  breaks it into sections, and has it ready when you start studying.
                </p>
              </div>
            </div>

            {/* Step 2 */}
            <div style={{display: "flex", gap: 24, alignItems: "flex-start"}}>
              <div style={{
                width: 48, height: 48, borderRadius: "50%",
                background: "rgba(72, 187, 120, 0.15)", border: "1px solid rgba(72, 187, 120, 0.3)",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: "1.2rem", fontWeight: 700, color: "#48bb78", flexShrink: 0,
              }}>2</div>
              <div>
                <h3 style={{color: "#fff", fontSize: "1.15rem", marginTop: 0, marginBottom: 8}}>
                  Study through conversation
                </h3>
                <div style={{
                  background: "rgba(255,255,255,0.04)", borderRadius: 8,
                  padding: "12px 16px", fontFamily: "monospace", fontSize: "0.9rem",
                  color: "rgba(255,255,255,0.7)", marginBottom: 8,
                }}>
                  <span style={{color: "rgba(255,255,255,0.35)"}}>~ {">"} </span>
                  study<br/><br/>
                  <span style={{color: "rgba(72,187,120,0.8)"}}>
                    useState. It lets you add state to functional components.<br/>
                    const [count, setCount] = useState(0);<br/><br/>
                    What happens when you call setCount(5)?
                  </span><br/><br/>
                  <span style={{color: "rgba(255,255,255,0.35)"}}>~ {">"} </span>
                  the component re-renders with count equal to 5<br/><br/>
                  <span style={{color: "rgba(72,187,120,0.8)"}}>
                    Right. React re-renders with the new state value.
                    Each render gets its own snapshot of state.<br/><br/>
                    What would happen if you called setCount(count + 1) twice
                    in the same event handler?
                  </span>
                </div>
                <p style={{color: "rgba(255,255,255,0.5)", fontSize: "0.9rem", lineHeight: 1.7, margin: 0}}>
                  The AI explains, asks questions, evaluates your answers.
                  Not a quiz. A conversation. It adapts to how you learn.
                </p>
              </div>
            </div>

            {/* Step 3 */}
            <div style={{display: "flex", gap: 24, alignItems: "flex-start"}}>
              <div style={{
                width: 48, height: 48, borderRadius: "50%",
                background: "rgba(236, 201, 75, 0.15)", border: "1px solid rgba(236, 201, 75, 0.3)",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: "1.2rem", fontWeight: 700, color: "#ecc94b", flexShrink: 0,
              }}>3</div>
              <div>
                <h3 style={{color: "#fff", fontSize: "1.15rem", marginTop: 0, marginBottom: 8}}>
                  Watch your mastery grow
                </h3>
                <div style={{
                  background: "rgba(255,255,255,0.04)", borderRadius: 8,
                  padding: "16px 20px", fontSize: "0.9rem", color: "rgba(255,255,255,0.7)",
                }}>
                  <div style={{marginBottom: 12, color: "#fff", fontWeight: 600}}>React Hooks</div>
                  {[
                    {name: "useState", pct: 80, color: "#48bb78"},
                    {name: "useEffect", pct: 45, color: "#ecc94b"},
                    {name: "useContext", pct: 10, color: "#718096"},
                    {name: "useRef", pct: 0, color: "#718096"},
                    {name: "Custom Hooks", pct: 0, color: "#718096"},
                  ].map(s => (
                    <div key={s.name} style={{display: "flex", alignItems: "center", gap: 12, marginBottom: 6}}>
                      <span style={{width: 110, fontSize: "0.85rem", color: "rgba(255,255,255,0.6)"}}>{s.name}</span>
                      <div style={{flex: 1, height: 6, background: "rgba(255,255,255,0.08)", borderRadius: 3, overflow: "hidden"}}>
                        <div style={{width: `${s.pct}%`, height: "100%", background: s.color, borderRadius: 3}} />
                      </div>
                      <span style={{width: 35, textAlign: "right", fontSize: "0.8rem", color: "rgba(255,255,255,0.4)"}}>{s.pct}%</span>
                    </div>
                  ))}
                </div>
                <p style={{color: "rgba(255,255,255,0.5)", fontSize: "0.9rem", lineHeight: 1.7, margin: "8px 0 0"}}>
                  Each concept gets a mastery score from 0 to 100.
                  When everything hits 80%, the topic completes.
                </p>
              </div>
            </div>

          </div>
        </div>
      </section>

      {/* ── GAP DETECTION ── */}
      <section className="lp-section" style={{paddingTop: 60, paddingBottom: 60, background: "rgba(255,255,255,0.02)"}}>
        <div className="lp-container" style={{maxWidth: 760}}>
          <h2 style={{color: "#fff", fontSize: "1.5rem", marginBottom: 16, textAlign: "center"}}>
            It notices what you're missing.
          </h2>
          <p style={{color: "rgba(255,255,255,0.5)", textAlign: "center", fontSize: "0.95rem", lineHeight: 1.8, maxWidth: 600, margin: "0 auto 32px"}}>
            You're studying useEffect. You can't explain the cleanup function because
            closures are fuzzy. The AI detects the gap and takes a 5 minute detour
            to teach you closures. Then comes back to useEffect. The gap gets tracked.
          </p>
          <div style={{
            background: "rgba(236, 201, 75, 0.06)", border: "1px solid rgba(236, 201, 75, 0.15)",
            borderRadius: 10, padding: "16px 20px", maxWidth: 500, margin: "0 auto",
          }}>
            <div style={{fontSize: "0.8rem", textTransform: "uppercase", letterSpacing: "0.1em", color: "rgba(236,201,75,0.6)", marginBottom: 8}}>Knowledge Gaps</div>
            <div style={{color: "#ecc94b", fontSize: "0.95rem", marginBottom: 4}}>Closures</div>
            <div style={{color: "rgba(255,255,255,0.35)", fontSize: "0.8rem"}}>found while studying useEffect cleanup</div>
          </div>
        </div>
      </section>

      {/* ── THE TREE STRUCTURE ── */}
      <section className="lp-section" style={{paddingTop: 60, paddingBottom: 60}}>
        <div className="lp-container" style={{maxWidth: 760}}>
          <h2 style={{color: "#fff", fontSize: "1.5rem", marginBottom: 16, textAlign: "center"}}>
            Your knowledge is a tree.
          </h2>
          <p style={{color: "rgba(255,255,255,0.5)", textAlign: "center", fontSize: "0.95rem", lineHeight: 1.8, maxWidth: 600, margin: "0 auto 32px"}}>
            Topics you want to learn go in the queue. When you start studying,
            the AI breaks the topic into concepts and builds a curriculum.
            Each concept tracks its own mastery. Completed topics archive themselves.
          </p>
          <div style={{
            background: "rgba(255,255,255,0.04)", borderRadius: 10,
            padding: "20px 24px", fontFamily: "monospace", fontSize: "0.85rem",
            color: "rgba(255,255,255,0.6)", lineHeight: 1.9,
          }}>
            <div style={{color: "#fff"}}>Study</div>
            <div>├── <span style={{color: "rgba(255,255,255,0.4)"}}>Queue</span>{"          "}(topics to learn)</div>
            <div>│   ├── Kubernetes networking</div>
            <div>│   └── System design patterns</div>
            <div>├── <span style={{color: "rgba(102,126,234,0.8)"}}>Active</span>{"         "}(currently studying)</div>
            <div>│   └── React Hooks</div>
            <div>│       ├── useState{"       "}████████░░ 80%</div>
            <div>│       ├── useEffect{"      "}████░░░░░░ 40%</div>
            <div>│       ├── useContext{"     "}░░░░░░░░░░  0%</div>
            <div>│       └── Resources{"      "}(URLs, bookmarks)</div>
            <div>├── <span style={{color: "#48bb78"}}>Completed</span>{"      "}(mastered)</div>
            <div>│   └── JavaScript Basics ✓</div>
            <div>├── <span style={{color: "#ecc94b"}}>Gaps</span>{"           "}(weak spots)</div>
            <div>├── Profile{"        "}(learning style, daily goal)</div>
            <div>└── History{"        "}(study sessions)</div>
          </div>
        </div>
      </section>

      {/* ── URL INTEGRATION ── */}
      <section className="lp-section" style={{paddingTop: 60, paddingBottom: 60, background: "rgba(255,255,255,0.02)"}}>
        <div className="lp-container" style={{maxWidth: 760}}>
          <h2 style={{color: "#fff", fontSize: "1.5rem", marginBottom: 16, textAlign: "center"}}>
            Paste a URL. The AI reads it for you.
          </h2>
          <p style={{color: "rgba(255,255,255,0.5)", textAlign: "center", fontSize: "0.95rem", lineHeight: 1.8, maxWidth: 600, margin: "0 auto 32px"}}>
            Queue an article, documentation page, or tutorial. The learn extension
            fetches the content, breaks it into sections, and stores it in the tree.
            When you study, the AI guides you through the actual source material.
          </p>
          <div style={{
            background: "rgba(255,255,255,0.04)", borderRadius: 8,
            padding: "12px 16px", fontFamily: "monospace", fontSize: "0.9rem",
            color: "rgba(255,255,255,0.7)", maxWidth: 580, margin: "0 auto",
          }}>
            <span style={{color: "rgba(255,255,255,0.35)"}}>~ {">"} </span>
            needlearn "https://react.dev/reference/react/useState"<br/>
            <span style={{color: "rgba(102,126,234,0.8)"}}>Queued: "https://react.dev/...". Content fetched.</span>
          </div>
        </div>
      </section>

      {/* ── PROFICIENCY STACK ── */}
      <section className="lp-section" style={{paddingTop: 60, paddingBottom: 60}}>
        <div className="lp-container" style={{maxWidth: 760}}>
          <h2 style={{color: "#fff", fontSize: "1.5rem", marginBottom: 16, textAlign: "center"}}>
            Part of something bigger.
          </h2>
          <p style={{color: "rgba(255,255,255,0.5)", textAlign: "center", fontSize: "0.95rem", lineHeight: 1.8, maxWidth: 600, margin: "0 auto 32px"}}>
            Study is one of four extensions that track the things that make you better.
            Each works alone. Each works better together.
          </p>
          <div style={{display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 16, maxWidth: 500, margin: "0 auto"}}>
            {[
              {emoji: "🍎", name: "Food", desc: "Fuels the body", color: "rgba(72,187,120,0.15)"},
              {emoji: "💪", name: "Fitness", desc: "Builds the body", color: "rgba(102,126,234,0.15)"},
              {emoji: "🌿", name: "Recovery", desc: "Heals the body", color: "rgba(236,201,75,0.15)"},
              {emoji: "📚", name: "Study", desc: "Builds the mind", color: "rgba(159,122,234,0.15)"},
            ].map(item => (
              <div key={item.name} style={{
                background: item.color, borderRadius: 10, padding: "16px 20px", textAlign: "center",
              }}>
                <div style={{fontSize: "1.5rem", marginBottom: 4}}>{item.emoji}</div>
                <div style={{color: "#fff", fontWeight: 600, fontSize: "0.95rem"}}>{item.name}</div>
                <div style={{color: "rgba(255,255,255,0.5)", fontSize: "0.8rem"}}>{item.desc}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── HOW IT WORKS (deeper, technical) ── */}
      <section className="lp-section" style={{paddingTop: 60, paddingBottom: 60, background: "rgba(255,255,255,0.02)"}}>
        <div className="lp-container" style={{maxWidth: 760}}>
          <h2 style={{color: "#fff", fontSize: "1.5rem", marginBottom: 32, textAlign: "center"}}>
            Under the hood.
          </h2>

          <div style={{display: "flex", flexDirection: "column", gap: 32}}>
            <div>
              <h3 style={{color: "rgba(255,255,255,0.8)", fontSize: "1rem", marginTop: 0, marginBottom: 8}}>Four AI modes</h3>
              <p style={{color: "rgba(255,255,255,0.45)", fontSize: "0.9rem", lineHeight: 1.7, margin: 0}}>
                <strong style={{color: "rgba(255,255,255,0.65)"}}>Log</strong> receives input. Detects if it's a queue add, URL, or question.
                <strong style={{color: "rgba(255,255,255,0.65)"}}> Session</strong> teaches through Socratic dialogue. Explains, asks, evaluates, updates mastery scores.
                <strong style={{color: "rgba(255,255,255,0.65)"}}> Review</strong> analyzes progress across all topics, finds patterns, suggests what to study next.
                <strong style={{color: "rgba(255,255,255,0.65)"}}> Plan</strong> builds curricula. Breaks topics into subtopics using AI knowledge of the domain.
              </p>
            </div>
            <div>
              <h3 style={{color: "rgba(255,255,255,0.8)", fontSize: "1rem", marginTop: 0, marginBottom: 8}}>Mastery scoring</h3>
              <p style={{color: "rgba(255,255,255,0.45)", fontSize: "0.9rem", lineHeight: 1.7, margin: 0}}>
                0 to 30%: introduced, can't explain it back.
                30 to 60%: understands basics, makes mistakes on edge cases.
                60 to 80%: solid understanding, can apply in context.
                80 to 100%: can teach it to someone else.
                When all subtopics in a topic hit 80%, the topic moves from Active to Completed.
              </p>
            </div>
            <div>
              <h3 style={{color: "rgba(255,255,255,0.8)", fontSize: "1rem", marginTop: 0, marginBottom: 8}}>The tree-as-app pattern</h3>
              <p style={{color: "rgba(255,255,255,0.45)", fontSize: "0.9rem", lineHeight: 1.7, margin: 0}}>
                Study is a TreeOS extension. The data model is the tree itself.
                Queue items are nodes. Topics are nodes. Subtopics are children.
                Mastery scores are values on nodes. The AI reads the tree structure
                to know what to teach. No separate database. No external service.
                The tree IS the curriculum.
              </p>
            </div>
            <div>
              <h3 style={{color: "rgba(255,255,255,0.8)", fontSize: "1rem", marginTop: 0, marginBottom: 8}}>Type "be" to start</h3>
              <p style={{color: "rgba(255,255,255,0.45)", fontSize: "0.9rem", lineHeight: 1.7, margin: 0}}>
                Navigate to your Study tree and type "be". The AI picks the next
                incomplete subtopic and starts teaching immediately. No menus, no setup.
                Just knowledge transfer. The same command that starts a guided workout
                in the fitness extension starts a guided study session here.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ── CTA ── */}
      <section className="lp-section" style={{paddingTop: 80, paddingBottom: 100, textAlign: "center"}}>
        <div className="lp-container">
          <h2 style={{color: "#fff", fontSize: "1.8rem", marginBottom: 16}}>
            What do you want to learn?
          </h2>
          <p style={{color: "rgba(255,255,255,0.5)", fontSize: "1rem", marginBottom: 32, maxWidth: 500, margin: "0 auto 32px"}}>
            Plant a land. Create a Study tree. Queue your first topic.
            The AI is ready when you are.
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

export default StudyPage;
