import "./LandingPage.css";
import Particles from "./Particles.jsx";

const FoodPage = () => {
  return (
    <div className="lp">

      {/* ── HERO ── */}
      <section className="lp-hero" style={{minHeight: "80vh"}}>
        <Particles count={25} />
        <div className="lp-hero-inner">
          <div className="lp-tree-icon">🍎</div>
          <h1 className="lp-title">Food</h1>
          <p className="lp-subtitle">The tree that knows what you eat.</p>
          <p className="lp-tagline">
            Say what you ate. The AI parses it, tracks your macros, learns your
            patterns, and tells you what to eat next. One command. The tree does
            the rest.
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
            Just tell it what you ate.
          </h2>

          <div style={{display: "flex", flexDirection: "column", gap: 48}}>

            {/* Step 1 */}
            <div style={{display: "flex", gap: 24, alignItems: "flex-start"}}>
              <div style={{
                width: 48, height: 48, borderRadius: "50%",
                background: "rgba(72, 187, 120, 0.15)", border: "1px solid rgba(72, 187, 120, 0.3)",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: "1.2rem", fontWeight: 700, color: "#48bb78", flexShrink: 0,
              }}>1</div>
              <div>
                <h3 style={{color: "#fff", fontSize: "1.15rem", marginTop: 0, marginBottom: 8}}>
                  Log in natural language
                </h3>
                <div style={{
                  background: "rgba(255,255,255,0.04)", borderRadius: 8,
                  padding: "12px 16px", fontFamily: "monospace", fontSize: "0.9rem",
                  color: "rgba(255,255,255,0.7)", marginBottom: 8,
                }}>
                  <span style={{color: "rgba(255,255,255,0.35)"}}>~ {">"} </span>
                  food "chicken breast and rice for lunch"<br/><br/>
                  <span style={{color: "rgba(72,187,120,0.8)"}}>
                    Logged: chicken breast (165 cal, 31g protein), rice (206 cal, 45g carbs)<br/>
                    Today: protein 49/150g (33%), carbs 65/200g (33%), fats 12/65g (18%)
                  </span>
                </div>
                <p style={{color: "rgba(255,255,255,0.5)", fontSize: "0.9rem", lineHeight: 1.7, margin: 0}}>
                  One LLM call parses the food into macros. Cascade signals route protein,
                  carbs, and fats to their tracking nodes. The daily picture updates instantly.
                </p>
              </div>
            </div>

            {/* Step 2 */}
            <div style={{display: "flex", gap: 24, alignItems: "flex-start"}}>
              <div style={{
                width: 48, height: 48, borderRadius: "50%",
                background: "rgba(102, 126, 234, 0.15)", border: "1px solid rgba(102, 126, 234, 0.3)",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: "1.2rem", fontWeight: 700, color: "#667eea", flexShrink: 0,
              }}>2</div>
              <div>
                <h3 style={{color: "#fff", fontSize: "1.15rem", marginTop: 0, marginBottom: 8}}>
                  Ask what to eat next
                </h3>
                <div style={{
                  background: "rgba(255,255,255,0.04)", borderRadius: 8,
                  padding: "12px 16px", fontFamily: "monospace", fontSize: "0.9rem",
                  color: "rgba(255,255,255,0.7)", marginBottom: 8,
                }}>
                  <span style={{color: "rgba(255,255,255,0.35)"}}>~ {">"} </span>
                  food "what should I eat for dinner?"<br/><br/>
                  <span style={{color: "rgba(102,126,234,0.8)"}}>
                    You need 52g protein and 800 calories to hit your targets.<br/>
                    You trained chest today so recovery matters. You've had chicken<br/>
                    five times this week. Try salmon and sweet potato.
                  </span>
                </div>
                <p style={{color: "rgba(255,255,255,0.5)", fontSize: "0.9rem", lineHeight: 1.7, margin: 0}}>
                  The AI reads your remaining macros, your meal history for variety,
                  and your fitness data through channels. Specific recommendations, not generic advice.
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
                  See your patterns over time
                </h3>
                <div style={{
                  background: "rgba(255,255,255,0.04)", borderRadius: 8,
                  padding: "12px 16px", fontFamily: "monospace", fontSize: "0.9rem",
                  color: "rgba(255,255,255,0.7)", marginBottom: 8,
                }}>
                  <span style={{color: "rgba(255,255,255,0.35)"}}>~ {">"} </span>
                  food "how am I doing this week?"<br/><br/>
                  <span style={{color: "rgba(236,201,75,0.8)"}}>
                    This week: avg 1,850 cal/day against 2,000 goal.<br/>
                    Protein averaging 128g against 150g target. 15% under.<br/>
                    You skip breakfast 3 days out of 7. On days you eat<br/>
                    breakfast, your protein hits target. The pattern is clear.
                  </span>
                </div>
                <p style={{color: "rgba(255,255,255,0.5)", fontSize: "0.9rem", lineHeight: 1.7, margin: 0}}>
                  Weekly averages, hit rates, and meal slot patterns. The AI finds what's working
                  and what isn't. History node archives 90 days of daily summaries.
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
            The tree IS the nutritionist.
          </h2>
          <p style={{color: "rgba(255,255,255,0.5)", textAlign: "center", fontSize: "0.95rem", lineHeight: 1.8, maxWidth: 600, margin: "0 auto 32px"}}>
            No external database. No calorie counting app. The tree structure holds your macros,
            your meal patterns, your profile, and your history. The AI reads the structure to know everything.
          </p>
          <div style={{
            background: "rgba(255,255,255,0.04)", borderRadius: 10,
            padding: "20px 24px", fontFamily: "monospace", fontSize: "0.85rem",
            color: "rgba(255,255,255,0.6)", lineHeight: 1.9,
          }}>
            <div style={{color: "#fff"}}>Food</div>
            <div>├── Log{"              "}(where you talk)</div>
            <div>├── <span style={{color: "#48bb78"}}>Protein</span>{"          "}128/150g (85%) weekly avg: 128g</div>
            <div>├── <span style={{color: "#ecc94b"}}>Carbs</span>{"            "}195/200g (98%)</div>
            <div>├── <span style={{color: "#ecc94b"}}>Fats</span>{"             "}52/65g (80%)</div>
            <div>├── Daily{"            "}(assembles the picture)</div>
            <div>├── Meals</div>
            <div>│   ├── Breakfast{"    "}(eggs 4x, oatmeal 2x this week)</div>
            <div>│   ├── Lunch{"        "}(chicken 5x, salmon 1x)</div>
            <div>│   ├── Dinner</div>
            <div>│   └── Snacks</div>
            <div>├── Profile{"          "}(2000 cal, 150g protein, no restrictions)</div>
            <div>└── History{"          "}(daily summaries, 90 days rolling)</div>
          </div>
        </div>
      </section>

      {/* ── FITNESS CONNECTION ── */}
      <section className="lp-section" style={{paddingTop: 60, paddingBottom: 60}}>
        <div className="lp-container" style={{maxWidth: 760}}>
          <h2 style={{color: "#fff", fontSize: "1.5rem", marginBottom: 16, textAlign: "center"}}>
            It talks to your workout.
          </h2>
          <p style={{color: "rgba(255,255,255,0.5)", textAlign: "center", fontSize: "0.95rem", lineHeight: 1.8, maxWidth: 600, margin: "0 auto 32px"}}>
            A channel between Food and Fitness carries data both ways. Neither extension imports
            the other. The tree connected them through structure.
          </p>
          <div style={{display: "grid", gridTemplateColumns: "1fr auto 1fr", gap: 16, maxWidth: 500, margin: "0 auto", alignItems: "center"}}>
            <div style={{background: "rgba(72,187,120,0.1)", borderRadius: 10, padding: 16, textAlign: "center"}}>
              <div style={{fontSize: "1.2rem", marginBottom: 4}}>🍎</div>
              <div style={{color: "#fff", fontSize: "0.9rem", fontWeight: 600}}>Food</div>
              <div style={{color: "rgba(255,255,255,0.4)", fontSize: "0.8rem"}}>1,850 cal today</div>
            </div>
            <div style={{color: "rgba(255,255,255,0.3)", fontSize: "1.5rem"}}>{"<->"}</div>
            <div style={{background: "rgba(102,126,234,0.1)", borderRadius: 10, padding: 16, textAlign: "center"}}>
              <div style={{fontSize: "1.2rem", marginBottom: 4}}>💪</div>
              <div style={{color: "#fff", fontSize: "0.9rem", fontWeight: 600}}>Fitness</div>
              <div style={{color: "rgba(255,255,255,0.4)", fontSize: "0.8rem"}}>chest day, 48 min</div>
            </div>
          </div>
          <p style={{color: "rgba(255,255,255,0.35)", textAlign: "center", fontSize: "0.85rem", marginTop: 16}}>
            The fitness AI sees your calories. The food AI sees your workout. Both give better advice.
          </p>

          {/* Scheduler layer */}
          <div style={{maxWidth: 500, margin: "32px auto 0", textAlign: "center"}}>
            <div style={{color: "rgba(255,255,255,0.15)", fontSize: "0.8rem", marginBottom: 8}}>and below both of them...</div>
            <div style={{background: "rgba(236,201,75,0.08)", borderRadius: 10, padding: "12px 16px", display: "inline-block"}}>
              <div style={{fontSize: "0.95rem", marginBottom: 2}}>🕐</div>
              <div style={{color: "rgba(255,255,255,0.6)", fontSize: "0.85rem", fontWeight: 600}}>Scheduler</div>
              <div style={{color: "rgba(255,255,255,0.3)", fontSize: "0.75rem"}}>meal prep Sunday, weigh-in Friday</div>
            </div>
          </div>

          {/* Deeper layers, progressively smaller */}
          <div style={{maxWidth: 500, margin: "16px auto 0", textAlign: "center"}}>
            <div style={{color: "rgba(255,255,255,0.1)", fontSize: "0.7rem", marginBottom: 6}}>and below that...</div>
            <div style={{display: "flex", justifyContent: "center", gap: 12}}>
              <div style={{background: "rgba(159,122,234,0.06)", borderRadius: 8, padding: "8px 12px"}}>
                <div style={{color: "rgba(255,255,255,0.4)", fontSize: "0.75rem", fontWeight: 600}}>Breath</div>
                <div style={{color: "rgba(255,255,255,0.2)", fontSize: "0.65rem"}}>daily reset at midnight</div>
              </div>
              <div style={{background: "rgba(96,165,250,0.06)", borderRadius: 8, padding: "8px 12px"}}>
                <div style={{color: "rgba(255,255,255,0.4)", fontSize: "0.75rem", fontWeight: 600}}>Evolution</div>
                <div style={{color: "rgba(255,255,255,0.2)", fontSize: "0.65rem"}}>pattern detection</div>
              </div>
            </div>
          </div>

          {/* Intelligence layer */}
          <div style={{maxWidth: 500, margin: "12px auto 0", textAlign: "center"}}>
            <div style={{display: "flex", justifyContent: "center", gap: 10}}>
              <div style={{background: "rgba(255,255,255,0.02)", borderRadius: 6, padding: "6px 10px"}}>
                <div style={{color: "rgba(255,255,255,0.25)", fontSize: "0.65rem", fontWeight: 600}}>Codebook</div>
                <div style={{color: "rgba(255,255,255,0.12)", fontSize: "0.55rem"}}>compression</div>
              </div>
              <div style={{background: "rgba(255,255,255,0.02)", borderRadius: 6, padding: "6px 10px"}}>
                <div style={{color: "rgba(255,255,255,0.25)", fontSize: "0.65rem", fontWeight: 600}}>Rings</div>
                <div style={{color: "rgba(255,255,255,0.12)", fontSize: "0.55rem"}}>growth cycles</div>
              </div>
              <div style={{background: "rgba(255,255,255,0.02)", borderRadius: 6, padding: "6px 10px"}}>
                <div style={{color: "rgba(255,255,255,0.25)", fontSize: "0.65rem", fontWeight: 600}}>Pulse</div>
                <div style={{color: "rgba(255,255,255,0.12)", fontSize: "0.55rem"}}>health monitoring</div>
              </div>
            </div>
          </div>

          {/* Deeper intelligence */}
          <div style={{maxWidth: 500, margin: "10px auto 0", textAlign: "center"}}>
            <div style={{display: "flex", justifyContent: "center", gap: 8}}>
              <div style={{color: "rgba(255,255,255,0.08)", fontSize: "0.5rem"}}>contradiction</div>
              <div style={{color: "rgba(255,255,255,0.08)", fontSize: "0.5rem"}}>long-memory</div>
              <div style={{color: "rgba(255,255,255,0.08)", fontSize: "0.5rem"}}>gap-detection</div>
              <div style={{color: "rgba(255,255,255,0.08)", fontSize: "0.5rem"}}>intent</div>
              <div style={{color: "rgba(255,255,255,0.08)", fontSize: "0.5rem"}}>reflect</div>
            </div>
          </div>

          {/* Analysis + maintenance */}
          <div style={{maxWidth: 500, margin: "8px auto 0", textAlign: "center"}}>
            <div style={{display: "flex", justifyContent: "center", gap: 6}}>
              <div style={{color: "rgba(255,255,255,0.06)", fontSize: "0.45rem"}}>scout</div>
              <div style={{color: "rgba(255,255,255,0.06)", fontSize: "0.45rem"}}>explore</div>
              <div style={{color: "rgba(255,255,255,0.06)", fontSize: "0.45rem"}}>embed</div>
              <div style={{color: "rgba(255,255,255,0.06)", fontSize: "0.45rem"}}>trace</div>
              <div style={{color: "rgba(255,255,255,0.06)", fontSize: "0.45rem"}}>inverse-tree</div>
              <div style={{color: "rgba(255,255,255,0.06)", fontSize: "0.45rem"}}>competence</div>
              <div style={{color: "rgba(255,255,255,0.06)", fontSize: "0.45rem"}}>boundary</div>
            </div>
          </div>

          {/* Maintenance + lifecycle */}
          <div style={{maxWidth: 500, margin: "6px auto 0", textAlign: "center"}}>
            <div style={{display: "flex", justifyContent: "center", gap: 5}}>
              <div style={{color: "rgba(255,255,255,0.05)", fontSize: "0.42rem"}}>prune</div>
              <div style={{color: "rgba(255,255,255,0.05)", fontSize: "0.42rem"}}>digest</div>
              <div style={{color: "rgba(255,255,255,0.05)", fontSize: "0.42rem"}}>delegate</div>
              <div style={{color: "rgba(255,255,255,0.05)", fontSize: "0.42rem"}}>changelog</div>
              <div style={{color: "rgba(255,255,255,0.05)", fontSize: "0.42rem"}}>peer-review</div>
              <div style={{color: "rgba(255,255,255,0.05)", fontSize: "0.42rem"}}>approve</div>
              <div style={{color: "rgba(255,255,255,0.05)", fontSize: "0.42rem"}}>persona</div>
              <div style={{color: "rgba(255,255,255,0.05)", fontSize: "0.42rem"}}>purpose</div>
            </div>
          </div>

          {/* Cascade nervous system */}
          <div style={{maxWidth: 500, margin: "5px auto 0", textAlign: "center"}}>
            <div style={{display: "flex", justifyContent: "center", gap: 4}}>
              <div style={{color: "rgba(255,255,255,0.04)", fontSize: "0.38rem"}}>cascade</div>
              <div style={{color: "rgba(255,255,255,0.04)", fontSize: "0.38rem"}}>flow</div>
              <div style={{color: "rgba(255,255,255,0.04)", fontSize: "0.38rem"}}>propagation</div>
              <div style={{color: "rgba(255,255,255,0.04)", fontSize: "0.38rem"}}>perspective-filter</div>
              <div style={{color: "rgba(255,255,255,0.04)", fontSize: "0.38rem"}}>sealed-transport</div>
            </div>
          </div>

          {/* Federation */}
          <div style={{maxWidth: 500, margin: "4px auto 0", textAlign: "center"}}>
            <div style={{display: "flex", justifyContent: "center", gap: 3}}>
              <div style={{color: "rgba(255,255,255,0.03)", fontSize: "0.33rem"}}>canopy</div>
              <div style={{color: "rgba(255,255,255,0.03)", fontSize: "0.33rem"}}>mycelium</div>
              <div style={{color: "rgba(255,255,255,0.03)", fontSize: "0.33rem"}}>horizon</div>
              <div style={{color: "rgba(255,255,255,0.03)", fontSize: "0.33rem"}}>governance</div>
            </div>
          </div>

          {/* The deep */}
          <div style={{maxWidth: 500, margin: "3px auto 0", textAlign: "center"}}>
            <div style={{display: "flex", justifyContent: "center", gap: 3}}>
              <div style={{color: "rgba(255,255,255,0.02)", fontSize: "0.28rem"}}>teach</div>
              <div style={{color: "rgba(255,255,255,0.02)", fontSize: "0.28rem"}}>split</div>
              <div style={{color: "rgba(255,255,255,0.02)", fontSize: "0.28rem"}}>evolve</div>
              <div style={{color: "rgba(255,255,255,0.02)", fontSize: "0.28rem"}}>reroot</div>
              <div style={{color: "rgba(255,255,255,0.02)", fontSize: "0.28rem"}}>seed-export</div>
              <div style={{color: "rgba(255,255,255,0.02)", fontSize: "0.28rem"}}>remember</div>
              <div style={{color: "rgba(255,255,255,0.02)", fontSize: "0.28rem"}}>phase</div>
            </div>
          </div>

          <p style={{color: "rgba(255,255,255,0.12)", textAlign: "center", fontSize: "0.7rem", marginTop: 16}}>
            It goes deeper than you think.
          </p>
        </div>
      </section>

      {/* ── PROFICIENCY STACK ── */}
      <section className="lp-section" style={{paddingTop: 60, paddingBottom: 60, background: "rgba(255,255,255,0.02)"}}>
        <div className="lp-container" style={{maxWidth: 760}}>
          <h2 style={{color: "#fff", fontSize: "1.5rem", marginBottom: 32, textAlign: "center"}}>
            Part of something bigger.
          </h2>
          <div style={{display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 16, maxWidth: 500, margin: "0 auto"}}>
            {[
              {emoji: "🍎", name: "Food", desc: "Fuels the body", color: "rgba(72,187,120,0.15)", href: "/food"},
              {emoji: "💪", name: "Fitness", desc: "Builds the body", color: "rgba(102,126,234,0.15)", href: "/fitness"},
              {emoji: "🌿", name: "Recovery", desc: "Heals the body", color: "rgba(236,201,75,0.15)", href: "/recovery"},
              {emoji: "📚", name: "Study", desc: "Builds the mind", color: "rgba(159,122,234,0.15)", href: "/study"},
              {emoji: "📖", name: "KB", desc: "Builds the team", color: "rgba(96,165,250,0.15)", href: "/kb"},
            ].map(item => (
              <a key={item.name} href={item.href || "#"} style={{
                background: item.color, borderRadius: 10, padding: "16px 20px", textAlign: "center",
                textDecoration: "none", display: "block",
              }}>
                <div style={{fontSize: "1.5rem", marginBottom: 4}}>{item.emoji}</div>
                <div style={{color: "#fff", fontWeight: 600, fontSize: "0.95rem"}}>{item.name}</div>
                <div style={{color: "rgba(255,255,255,0.5)", fontSize: "0.8rem"}}>{item.desc}</div>
              </a>
            ))}
          </div>
        </div>
      </section>

      {/* ── UNDER THE HOOD ── */}
      <section className="lp-section" style={{paddingTop: 60, paddingBottom: 60}}>
        <div className="lp-container" style={{maxWidth: 760}}>
          <h2 style={{color: "#fff", fontSize: "1.5rem", marginBottom: 32, textAlign: "center"}}>
            Under the hood.
          </h2>
          <div style={{display: "flex", flexDirection: "column", gap: 32}}>
            <div>
              <h3 style={{color: "rgba(255,255,255,0.8)", fontSize: "1rem", marginTop: 0, marginBottom: 8}}>Three AI modes</h3>
              <p style={{color: "rgba(255,255,255,0.45)", fontSize: "0.9rem", lineHeight: 1.7, margin: 0}}>
                <strong style={{color: "rgba(255,255,255,0.65)"}}>Log</strong> parses natural language food input into structured macros. One LLM call.
                <strong style={{color: "rgba(255,255,255,0.65)"}}> Review</strong> analyzes patterns. Reads weekly averages, hit rates, meal slot history, and fitness data. Advises forward and backward.
                <strong style={{color: "rgba(255,255,255,0.65)"}}> Coach</strong> sets up goals. Asks about calorie targets, macro splits, and restrictions.
              </p>
            </div>
            <div>
              <h3 style={{color: "rgba(255,255,255,0.8)", fontSize: "1rem", marginTop: 0, marginBottom: 8}}>Cascade routing</h3>
              <p style={{color: "rgba(255,255,255,0.45)", fontSize: "0.9rem", lineHeight: 1.7, margin: 0}}>
                When you log food, channels carry the parsed macros to Protein, Carbs, and Fats nodes.
                Each node increments its daily total atomically. No read-modify-write. No race conditions.
                The Daily node reads all siblings through enrichContext. One structure, zero extra queries.
              </p>
            </div>
            <div>
              <h3 style={{color: "rgba(255,255,255,0.8)", fontSize: "1rem", marginTop: 0, marginBottom: 8}}>Daily reset with weekly averages</h3>
              <p style={{color: "rgba(255,255,255,0.45)", fontSize: "0.9rem", lineHeight: 1.7, margin: 0}}>
                At midnight (synced to the breath extension or a fallback timer), the day's totals
                archive to History as a note. Weekly averages and hit rates update on each macro node.
                The AI sees "protein hit rate: 43% this week" without reading 90 history notes.
              </p>
            </div>
            <div>
              <h3 style={{color: "rgba(255,255,255,0.8)", fontSize: "1rem", marginTop: 0, marginBottom: 8}}>Type "be" to start</h3>
              <p style={{color: "rgba(255,255,255,0.45)", fontSize: "0.9rem", lineHeight: 1.7, margin: 0}}>
                Navigate to your Food tree and type "be". The AI asks what you've eaten.
                You answer. It logs, routes, and tells you where you stand. No menus.
                No calorie lookups. Just a conversation with a tree that counts for you.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ── ADAPTIVE TREE ── */}
      <section className="lp-section" style={{paddingTop: 60, paddingBottom: 60, background: "rgba(255,255,255,0.02)"}}>
        <div className="lp-container" style={{maxWidth: 760}}>
          <h2 style={{color: "#fff", fontSize: "1.5rem", marginBottom: 16, textAlign: "center"}}>
            Your tree. Your metrics.
          </h2>
          <p style={{color: "rgba(255,255,255,0.5)", textAlign: "center", fontSize: "0.95rem", lineHeight: 1.8, maxWidth: 600, margin: "0 auto 32px"}}>
            Nothing is hardcoded. The scaffold creates Protein, Carbs, and Fats as defaults.
            After that, the system treats them the same as any node you create yourself.
          </p>

          <div style={{display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, marginBottom: 32}}>
            <div style={{background: "rgba(255,255,255,0.04)", borderRadius: 10, padding: "16px 20px"}}>
              <h3 style={{color: "rgba(255,255,255,0.8)", fontSize: "0.95rem", marginTop: 0, marginBottom: 8}}>Structural nodes</h3>
              <p style={{color: "rgba(255,255,255,0.4)", fontSize: "0.85rem", lineHeight: 1.7, margin: 0}}>
                Log, Daily, Meals, Profile, History. These define the shape. Only Log is required. Everything else is optional.
              </p>
            </div>
            <div style={{background: "rgba(255,255,255,0.04)", borderRadius: 10, padding: "16px 20px"}}>
              <h3 style={{color: "rgba(255,255,255,0.8)", fontSize: "0.95rem", marginTop: 0, marginBottom: 8}}>Metric nodes</h3>
              <p style={{color: "rgba(255,255,255,0.4)", fontSize: "0.85rem", lineHeight: 1.7, margin: 0}}>
                Everything else. Protein, Carbs, Fats, or whatever you add. Sugar, Fiber, Sodium, Water. The tree tracks whatever exists.
              </p>
            </div>
          </div>

          <div style={{
            background: "rgba(255,255,255,0.04)", borderRadius: 10,
            padding: "20px 24px", fontFamily: "monospace", fontSize: "0.85rem",
            color: "rgba(255,255,255,0.6)", lineHeight: 1.9, marginBottom: 24,
          }}>
            <div style={{color: "rgba(255,255,255,0.35)", marginBottom: 8}}>{"// default scaffold"}</div>
            <div style={{color: "#fff"}}>Food</div>
            <div>├── Log</div>
            <div>├── <span style={{color: "#48bb78"}}>Protein</span>{"     "}128/150g</div>
            <div>├── <span style={{color: "#ecc94b"}}>Carbs</span>{"       "}195/200g</div>
            <div>├── <span style={{color: "#ecc94b"}}>Fats</span>{"        "}52/65g</div>
            <div>├── Daily</div>
            <div>└── History</div>
            <div style={{color: "rgba(255,255,255,0.35)", marginTop: 16, marginBottom: 8}}>{"// after customization"}</div>
            <div style={{color: "#fff"}}>Food</div>
            <div>├── Log</div>
            <div>├── <span style={{color: "#a78bfa"}}>Fiber</span>{"       "}22/30g</div>
            <div>├── <span style={{color: "#a78bfa"}}>Sodium</span>{"      "}1,800/2,300mg</div>
            <div>├── <span style={{color: "#a78bfa"}}>Water</span>{"       "}6/8 glasses</div>
            <div>├── <span style={{color: "#ecc94b"}}>Fats</span>{"        "}52/65g</div>
            <div>├── Daily</div>
            <div>└── History</div>
          </div>

          <div style={{display: "flex", flexDirection: "column", gap: 24}}>
            <div>
              <h3 style={{color: "rgba(255,255,255,0.8)", fontSize: "1rem", marginTop: 0, marginBottom: 8}}>The whole pipeline adapts</h3>
              <p style={{color: "rgba(255,255,255,0.45)", fontSize: "0.9rem", lineHeight: 1.7, margin: 0}}>
                The LLM parser prompt is built at runtime from the tree. If your tree tracks protein, carbs, fats, sugar,
                and fiber, the prompt says exactly that. Delete protein and add sodium, the prompt changes. The parser outputs
                the right fields. Cascade signals route to the right nodes. Daily reset archives the right totals. The dashboard
                renders a progress bar for every metric node. No config file. No code change. Just tree structure.
              </p>
            </div>
            <div>
              <h3 style={{color: "rgba(255,255,255,0.8)", fontSize: "1rem", marginTop: 0, marginBottom: 8}}>Node adoption</h3>
              <p style={{color: "rgba(255,255,255,0.45)", fontSize: "0.9rem", lineHeight: 1.7, margin: 0}}>
                Create a plain node under your food tree called Sugar. Next time you log food, the AI notices
                it and asks: "Sugar isn't tracked yet. Want me to add it? What's your daily goal?" One conversation.
                The node gets its metadata, joins the pipeline, and starts tracking.
              </p>
            </div>
            <div>
              <h3 style={{color: "rgba(255,255,255,0.8)", fontSize: "1rem", marginTop: 0, marginBottom: 8}}>Delete protection</h3>
              <p style={{color: "rgba(255,255,255,0.45)", fontSize: "0.9rem", lineHeight: 1.7, margin: 0}}>
                Structural nodes are protected across every extension. Any node with a role in any extension's
                metadata namespace is guarded from deletion. The system names the extension and role. <code style={{color: "rgba(255,255,255,0.55)"}}>--force</code> bypasses
                it when you mean it.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ── CTA ── */}
      <section className="lp-section" style={{paddingTop: 80, paddingBottom: 100, textAlign: "center"}}>
        <div className="lp-container">
          <h2 style={{color: "#fff", fontSize: "1.8rem", marginBottom: 16}}>
            What did you eat today?
          </h2>
          <p style={{color: "rgba(255,255,255,0.5)", fontSize: "1rem", maxWidth: 500, margin: "0 auto 32px"}}>
            Plant a land. Create a Food tree. Say what you ate.
            The tree takes it from there.
          </p>
          <div className="lp-hero-ctas" style={{justifyContent: "center"}}>
            <a className="lp-btn lp-btn-primary" href="/land">Start a Land</a>
            <a className="lp-btn lp-btn-secondary" href="/extensions">All Extensions</a>
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
              <a href="/land">Start a Land</a>
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

export default FoodPage;
