import "./LandingPage.css";
import Particles from "./Particles.jsx";

const FitnessPage = () => {
  return (
    <div className="lp">

      {/* ── HERO ── */}
      <section className="lp-hero" style={{minHeight: "80vh"}}>
        <Particles count={25} />
        <div className="lp-hero-inner">
          <div className="lp-tree-icon">💪</div>
          <h1 className="lp-title">Fitness</h1>
          <p className="lp-subtitle">Three languages. One command.</p>
          <p className="lp-tagline">
            Gym, running, and bodyweight. Log any workout in natural language.
            The AI detects what you did, routes it to the right place, and tracks
            progressive overload automatically. Type "be" and the coach walks you
            through today's session set by set.
          </p>
          <div className="lp-hero-ctas">
            <a className="lp-btn lp-btn-primary" href="/lands">Start a Land</a>
            <a className="lp-btn lp-btn-secondary" href="/treeos">What is TreeOS?</a>
          </div>
        </div>
      </section>

      {/* ── THREE LANGUAGES ── */}
      <section className="lp-section" style={{paddingTop: 80, paddingBottom: 60}}>
        <div className="lp-container" style={{maxWidth: 760}}>
          <h2 style={{color: "#fff", fontSize: "1.8rem", marginBottom: 48, textAlign: "center"}}>
            Say what you did. It understands.
          </h2>

          <div style={{display: "flex", flexDirection: "column", gap: 40}}>

            {/* Gym */}
            <div style={{display: "flex", gap: 24, alignItems: "flex-start"}}>
              <div style={{
                width: 48, height: 48, borderRadius: "50%",
                background: "rgba(102, 126, 234, 0.15)", border: "1px solid rgba(102, 126, 234, 0.3)",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: "1.4rem", flexShrink: 0,
              }}>🏋️</div>
              <div>
                <h3 style={{color: "#fff", fontSize: "1.15rem", marginTop: 0, marginBottom: 8}}>
                  Gym
                </h3>
                <div style={{
                  background: "rgba(255,255,255,0.04)", borderRadius: 8,
                  padding: "12px 16px", fontFamily: "monospace", fontSize: "0.9rem",
                  color: "rgba(255,255,255,0.7)", marginBottom: 8,
                }}>
                  <span style={{color: "rgba(255,255,255,0.35)"}}>~ {">"} </span>
                  fitness "bench 135x10,10,8 then squat 225 5x5"<br/>
                  <span style={{color: "rgba(102,126,234,0.8)"}}>
                    Bench Press: 135x10/10/8 (vol: 3,780)<br/>
                    Squats: 225x5/5/5/5/5 (vol: 5,625)<br/>
                    Total volume: 9,405lb
                  </span>
                </div>
                <p style={{color: "rgba(255,255,255,0.5)", fontSize: "0.9rem", lineHeight: 1.7, margin: 0}}>
                  Weight times reps times sets. The currency is volume.
                  When all sets hit their rep goals, the AI suggests adding weight.
                </p>
              </div>
            </div>

            {/* Running */}
            <div style={{display: "flex", gap: 24, alignItems: "flex-start"}}>
              <div style={{
                width: 48, height: 48, borderRadius: "50%",
                background: "rgba(72, 187, 120, 0.15)", border: "1px solid rgba(72, 187, 120, 0.3)",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: "1.4rem", flexShrink: 0,
              }}>🏃</div>
              <div>
                <h3 style={{color: "#fff", fontSize: "1.15rem", marginTop: 0, marginBottom: 8}}>
                  Running
                </h3>
                <div style={{
                  background: "rgba(255,255,255,0.04)", borderRadius: 8,
                  padding: "12px 16px", fontFamily: "monospace", fontSize: "0.9rem",
                  color: "rgba(255,255,255,0.7)", marginBottom: 8,
                }}>
                  <span style={{color: "rgba(255,255,255,0.35)"}}>~ {">"} </span>
                  fitness "ran 3 miles in 24 min"<br/>
                  <span style={{color: "rgba(72,187,120,0.8)"}}>
                    Run: 3.0mi in 24:00 (8:00/mi)<br/>
                    Weekly: 15.5/20 miles
                  </span>
                </div>
                <p style={{color: "rgba(255,255,255,0.5)", fontSize: "0.9rem", lineHeight: 1.7, margin: 0}}>
                  Distance times time times pace. The AI tracks weekly mileage,
                  PRs for every race distance, and suggests 10% weekly increases
                  when you consistently hit your target.
                </p>
              </div>
            </div>

            {/* Bodyweight */}
            <div style={{display: "flex", gap: 24, alignItems: "flex-start"}}>
              <div style={{
                width: 48, height: 48, borderRadius: "50%",
                background: "rgba(236, 201, 75, 0.15)", border: "1px solid rgba(236, 201, 75, 0.3)",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: "1.4rem", flexShrink: 0,
              }}>🤸</div>
              <div>
                <h3 style={{color: "#fff", fontSize: "1.15rem", marginTop: 0, marginBottom: 8}}>
                  Bodyweight
                </h3>
                <div style={{
                  background: "rgba(255,255,255,0.04)", borderRadius: 8,
                  padding: "12px 16px", fontFamily: "monospace", fontSize: "0.9rem",
                  color: "rgba(255,255,255,0.7)", marginBottom: 8,
                }}>
                  <span style={{color: "rgba(255,255,255,0.35)"}}>~ {">"} </span>
                  fitness "50 pushups and 20 pullups"<br/>
                  <span style={{color: "rgba(236,201,75,0.8)"}}>
                    Push-ups: 50 total<br/>
                    Pull-ups: 20 total
                  </span>
                </div>
                <p style={{color: "rgba(255,255,255,0.5)", fontSize: "0.9rem", lineHeight: 1.7, margin: 0}}>
                  Reps and duration. When all goals are met, the AI suggests
                  harder variations: standard to diamond to archer to one-arm.
                  The progression path is stored on each exercise.
                </p>
              </div>
            </div>

            {/* Mixed */}
            <div style={{
              background: "rgba(255,255,255,0.03)", borderRadius: 10,
              padding: "16px 20px", border: "1px solid rgba(255,255,255,0.06)",
            }}>
              <div style={{fontSize: "0.8rem", textTransform: "uppercase", letterSpacing: "0.1em", color: "rgba(255,255,255,0.4)", marginBottom: 8}}>Mixed workouts work too</div>
              <div style={{fontFamily: "monospace", fontSize: "0.9rem", color: "rgba(255,255,255,0.6)"}}>
                <span style={{color: "rgba(255,255,255,0.35)"}}>~ {">"} </span>
                fitness "did chest then ran 2 miles"<br/>
                <span style={{color: "rgba(255,255,255,0.45)"}}>
                  Gym data routes to Chest exercises. Running data routes to Runs node. One command.
                </span>
              </div>
            </div>

          </div>
        </div>
      </section>

      {/* ── THE COACH ── */}
      <section className="lp-section" style={{paddingTop: 60, paddingBottom: 60, background: "rgba(255,255,255,0.02)"}}>
        <div className="lp-container" style={{maxWidth: 760}}>
          <h2 style={{color: "#fff", fontSize: "1.5rem", marginBottom: 16, textAlign: "center"}}>
            Type "be" and the coach takes over.
          </h2>
          <p style={{color: "rgba(255,255,255,0.5)", textAlign: "center", fontSize: "0.95rem", lineHeight: 1.8, maxWidth: 600, margin: "0 auto 32px"}}>
            The AI reads your program, knows your numbers, and walks you through
            every exercise. Different coaching style for each modality.
          </p>
          <div style={{
            background: "rgba(255,255,255,0.04)", borderRadius: 10,
            padding: "20px 24px", fontFamily: "monospace", fontSize: "0.9rem",
            color: "rgba(255,255,255,0.6)", lineHeight: 2,
          }}>
            <div style={{color: "rgba(102,126,234,0.8)"}}>Bench Press. 135lb. Set 1 of 3. Goal: 12 reps.</div>
            <div><span style={{color: "rgba(255,255,255,0.35)"}}>~ {">"} </span>10</div>
            <div style={{color: "rgba(102,126,234,0.8)"}}>10 reps. Rest up. Set 2.</div>
            <div><span style={{color: "rgba(255,255,255,0.35)"}}>~ {">"} </span>11</div>
            <div style={{color: "rgba(102,126,234,0.8)"}}>11. One more set.</div>
            <div><span style={{color: "rgba(255,255,255,0.35)"}}>~ {">"} </span>12</div>
            <div style={{color: "rgba(72,187,120,0.8)"}}>135x10/11/12. All goals met. Go 140 next time.</div>
            <div style={{color: "rgba(102,126,234,0.8)"}}>Moving on. Squats. 225lb. Set 1.</div>
          </div>
        </div>
      </section>

      {/* ── THE TREE STRUCTURE ── */}
      <section className="lp-section" style={{paddingTop: 60, paddingBottom: 60}}>
        <div className="lp-container" style={{maxWidth: 760}}>
          <h2 style={{color: "#fff", fontSize: "1.5rem", marginBottom: 16, textAlign: "center"}}>
            Your training is a tree.
          </h2>
          <p style={{color: "rgba(255,255,255,0.5)", textAlign: "center", fontSize: "0.95rem", lineHeight: 1.8, maxWidth: 600, margin: "0 auto 32px"}}>
            You choose what to train. The AI builds the structure. Every exercise tracks
            its own values, goals, and history. The program spans all modalities.
          </p>
          <div style={{
            background: "rgba(255,255,255,0.04)", borderRadius: 10,
            padding: "20px 24px", fontFamily: "monospace", fontSize: "0.85rem",
            color: "rgba(255,255,255,0.6)", lineHeight: 1.9,
          }}>
            <div style={{color: "#fff"}}>Fitness</div>
            <div>├── <span style={{color: "rgba(102,126,234,0.8)"}}>Gym</span></div>
            <div>│   ├── Chest{"          "}(Bench Press, Incline DB)</div>
            <div>│   ├── Back{"           "}(Pull-ups, Barbell Rows)</div>
            <div>│   ├── Legs{"           "}(Squats, RDL)</div>
            <div>│   └── Shoulders{"      "}(OHP, Lateral Raises)</div>
            <div>├── <span style={{color: "rgba(72,187,120,0.8)"}}>Running</span></div>
            <div>│   ├── Runs{"           "}(each run as structured data)</div>
            <div>│   ├── PRs{"            "}(mile, 5k, 10k, half, marathon)</div>
            <div>│   └── Plan{"           "}(weekly mileage target)</div>
            <div>├── <span style={{color: "rgba(236,201,75,0.8)"}}>Home</span></div>
            <div>│   ├── Push-ups{"       "}(sets, reps, variation)</div>
            <div>│   ├── Pull-ups{"       "}(sets, reps, added weight)</div>
            <div>│   └── Routine</div>
            <div>├── Log{"               "}(where you talk)</div>
            <div>├── Program{"           "}(master plan across modalities)</div>
            <div>└── History{"            "}(daily session records)</div>
          </div>
        </div>
      </section>

      {/* ── PROGRESSIVE OVERLOAD ── */}
      <section className="lp-section" style={{paddingTop: 60, paddingBottom: 60, background: "rgba(255,255,255,0.02)"}}>
        <div className="lp-container" style={{maxWidth: 760}}>
          <h2 style={{color: "#fff", fontSize: "1.5rem", marginBottom: 16, textAlign: "center"}}>
            It knows when you're ready.
          </h2>
          <p style={{color: "rgba(255,255,255,0.5)", textAlign: "center", fontSize: "0.95rem", lineHeight: 1.8, maxWidth: 600, margin: "0 auto 32px"}}>
            Every exercise has values and goals stored on the tree. When all goals are met,
            the AI triggers progression. Different for each modality.
          </p>
          <div style={{display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16, maxWidth: 600, margin: "0 auto"}}>
            {[
              {label: "Gym", rule: "All sets hit rep goals at current weight. Suggest +5lb.", color: "rgba(102,126,234,0.15)"},
              {label: "Running", rule: "Weekly mileage target hit 3 weeks in a row. Suggest +10%.", color: "rgba(72,187,120,0.15)"},
              {label: "Bodyweight", rule: "All sets hit rep goals. Suggest harder variation.", color: "rgba(236,201,75,0.15)"},
            ].map(item => (
              <div key={item.label} style={{
                background: item.color, borderRadius: 10, padding: "16px",
              }}>
                <div style={{color: "#fff", fontWeight: 600, fontSize: "0.9rem", marginBottom: 6}}>{item.label}</div>
                <div style={{color: "rgba(255,255,255,0.5)", fontSize: "0.8rem", lineHeight: 1.6}}>{item.rule}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── FOOD CHANNEL ── */}
      <section className="lp-section" style={{paddingTop: 60, paddingBottom: 60}}>
        <div className="lp-container" style={{maxWidth: 760}}>
          <h2 style={{color: "#fff", fontSize: "1.5rem", marginBottom: 16, textAlign: "center"}}>
            It talks to your food tree.
          </h2>
          <p style={{color: "rgba(255,255,255,0.5)", textAlign: "center", fontSize: "0.95rem", lineHeight: 1.8, maxWidth: 600, margin: "0 auto 32px"}}>
            If the food extension is installed, a bidirectional channel connects them.
            After a workout, the food AI knows you need recovery protein.
            After a meal, the fitness AI knows if you're fueled for training.
            No imports between them. Just signals through the tree.
          </p>
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
              <h3 style={{color: "rgba(255,255,255,0.8)", fontSize: "1rem", marginTop: 0, marginBottom: 8}}>One LLM call, all modalities</h3>
              <p style={{color: "rgba(255,255,255,0.45)", fontSize: "0.9rem", lineHeight: 1.7, margin: 0}}>
                The log mode's prompt is built dynamically from the tree. It reads your exercise names,
                groups, and modalities. One LLM call detects gym, running, or bodyweight from the input
                and parses it into structured data. Mixed workouts produce multiple outputs routed to
                different branches. No second call needed.
              </p>
            </div>
            <div>
              <h3 style={{color: "rgba(255,255,255,0.8)", fontSize: "1rem", marginTop: 0, marginBottom: 8}}>Four AI modes</h3>
              <p style={{color: "rgba(255,255,255,0.45)", fontSize: "0.9rem", lineHeight: 1.7, margin: 0}}>
                <strong style={{color: "rgba(255,255,255,0.65)"}}>Log</strong> parses any workout input.
                <strong style={{color: "rgba(255,255,255,0.65)"}}> Coach</strong> guides sessions set by set, adapting per modality.
                <strong style={{color: "rgba(255,255,255,0.65)"}}> Review</strong> analyzes progress across all modalities: volume trends, PRs, consistency, overdue exercises.
                <strong style={{color: "rgba(255,255,255,0.65)"}}> Plan</strong> builds programs using tools to create the tree structure conversationally.
              </p>
            </div>
            <div>
              <h3 style={{color: "rgba(255,255,255,0.8)", fontSize: "1rem", marginTop: 0, marginBottom: 8}}>The tree-as-app pattern</h3>
              <p style={{color: "rgba(255,255,255,0.45)", fontSize: "0.9rem", lineHeight: 1.7, margin: 0}}>
                Fitness is a TreeOS extension. No separate database. No external service.
                Exercise nodes hold values (weight, reps, distance, pace) and goals in their metadata.
                Cascade channels route logged data from the Log node to exercise nodes.
                The AI reads the tree to know what exercises exist and what to coach.
                Change the tree, change the training.
              </p>
            </div>
            <div>
              <h3 style={{color: "rgba(255,255,255,0.8)", fontSize: "1rem", marginTop: 0, marginBottom: 8}}>No hardcoded programs</h3>
              <p style={{color: "rgba(255,255,255,0.45)", fontSize: "0.9rem", lineHeight: 1.7, margin: 0}}>
                When you start, the AI asks what you train and builds the tree from the conversation.
                Gym bro gets muscle groups and barbell exercises. Runner gets Runs, PRs, and a mileage plan.
                Someone doing pushups gets bodyweight exercises with variation progression paths.
                Same extension. The tree defines the shape. The code is generic.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ── PROFICIENCY STACK ── */}
      <section className="lp-section" style={{paddingTop: 60, paddingBottom: 60}}>
        <div className="lp-container" style={{maxWidth: 760}}>
          <h2 style={{color: "#fff", fontSize: "1.5rem", marginBottom: 16, textAlign: "center"}}>
            Part of the proficiency stack.
          </h2>
          <p style={{color: "rgba(255,255,255,0.5)", textAlign: "center", fontSize: "0.95rem", lineHeight: 1.8, maxWidth: 600, margin: "0 auto 32px"}}>
            Four extensions that track the things that make you better.
          </p>
          <div style={{display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 16, maxWidth: 500, margin: "0 auto"}}>
            {[
              {emoji: "🍎", name: "Food", desc: "Fuels the body", href: "/food", color: "rgba(72,187,120,0.15)"},
              {emoji: "💪", name: "Fitness", desc: "Builds the body", href: null, color: "rgba(102,126,234,0.25)"},
              {emoji: "🌿", name: "Recovery", desc: "Heals the body", href: "/recovery", color: "rgba(236,201,75,0.15)"},
              {emoji: "📚", name: "Study", desc: "Builds the mind", href: "/study", color: "rgba(159,122,234,0.15)"},
              {emoji: "📖", name: "KB", desc: "Builds the team", href: "/kb", color: "rgba(96,165,250,0.15)"},
            ].map(item => (
              <a key={item.name} href={item.href || "#"} style={{
                background: item.color, borderRadius: 10, padding: "16px 20px", textAlign: "center",
                textDecoration: "none", border: item.href === null ? "1px solid rgba(102,126,234,0.3)" : "none",
              }}>
                <div style={{fontSize: "1.5rem", marginBottom: 4}}>{item.emoji}</div>
                <div style={{color: "#fff", fontWeight: 600, fontSize: "0.95rem"}}>{item.name}</div>
                <div style={{color: "rgba(255,255,255,0.5)", fontSize: "0.8rem"}}>{item.desc}</div>
              </a>
            ))}
          </div>
        </div>
      </section>

      {/* ── CTA ── */}
      <section className="lp-section" style={{paddingTop: 80, paddingBottom: 100, textAlign: "center"}}>
        <div className="lp-container">
          <h2 style={{color: "#fff", fontSize: "1.8rem", marginBottom: 16}}>
            What do you train?
          </h2>
          <p style={{color: "rgba(255,255,255,0.5)", fontSize: "1rem", marginBottom: 32, maxWidth: 500, margin: "0 auto 32px"}}>
            Plant a land. Create a Fitness tree. Tell it what you do.
            The AI builds the rest.
          </p>
          <div className="lp-hero-ctas" style={{justifyContent: "center"}}>
            <a className="lp-btn lp-btn-primary" href="/lands">Start a Land</a>
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

export default FitnessPage;
