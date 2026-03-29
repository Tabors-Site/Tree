import "./LandingPage.css";

const RecoveryPage = () => {
  return (
    <div className="lp">

      {/* ── HERO ── */}
      <section className="lp-hero" style={{minHeight: "80vh"}}>
        <div className="lp-hero-inner">
          <div className="lp-tree-icon">🌿</div>
          <h1 className="lp-title">Recovery</h1>
          <p className="lp-subtitle">The tree that grows toward health.</p>
          <p className="lp-tagline">
            Track substances, feelings, cravings, and patterns.
            Taper schedules that bend around you. Pattern detection that finds
            what you can't see. A mirror, not a judge. The person is always the agent.
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
            Just say how you're doing.
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
                  Check in naturally
                </h3>
                <div style={{
                  background: "rgba(255,255,255,0.04)", borderRadius: 8,
                  padding: "12px 16px", fontFamily: "monospace", fontSize: "0.9rem",
                  color: "rgba(255,255,255,0.7)", marginBottom: 8,
                }}>
                  <span style={{color: "rgba(255,255,255,0.35)"}}>~ {">"} </span>
                  recovery "had 2 coffees today, was craving a third but didn't"<br/><br/>
                  <span style={{color: "rgba(72,187,120,0.8)"}}>
                    Two coffees, right on target. You resisted the third one.<br/>
                    That's three days in a row hitting your target. The afternoon<br/>
                    is your hard window. You've noted that before.
                  </span>
                </div>
                <p style={{color: "rgba(255,255,255,0.5)", fontSize: "0.9rem", lineHeight: 1.7, margin: 0}}>
                  The AI parses substances, cravings, mood, and energy from natural language.
                  No forms. No dropdowns. Just talk.
                </p>
              </div>
            </div>

            {/* Step 2 */}
            <div style={{display: "flex", gap: 24, alignItems: "flex-start"}}>
              <div style={{
                width: 48, height: 48, borderRadius: "50%",
                background: "rgba(236, 201, 75, 0.15)", border: "1px solid rgba(236, 201, 75, 0.3)",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: "1.2rem", fontWeight: 700, color: "#ecc94b", flexShrink: 0,
              }}>2</div>
              <div>
                <h3 style={{color: "#fff", fontSize: "1.15rem", marginTop: 0, marginBottom: 8}}>
                  See the patterns you can't
                </h3>
                <div style={{
                  background: "rgba(255,255,255,0.04)", borderRadius: 8,
                  padding: "12px 16px", fontFamily: "monospace", fontSize: "0.9rem",
                  color: "rgba(255,255,255,0.7)", marginBottom: 8,
                }}>
                  <span style={{color: "rgba(255,255,255,0.35)"}}>~ {">"} </span>
                  recovery "how am I doing this month?"<br/><br/>
                  <span style={{color: "rgba(236,201,75,0.8)"}}>
                    26 of 30 days on target. Two slips, both on weekends,<br/>
                    both after social events. Cravings peak Fridays 5-8pm.<br/>
                    Lowest after morning workouts.<br/><br/>
                    The pattern: when you exercise in the morning, craving<br/>
                    intensity drops by 40% that day. 7 of 8 instances.
                  </span>
                </div>
                <p style={{color: "rgba(255,255,255,0.5)", fontSize: "0.9rem", lineHeight: 1.7, margin: 0}}>
                  The AI reads across substances, feelings, and history. Finds correlations.
                  Exercise and cravings. Sleep and mood. Time of day and intensity.
                  Presents them as observations, not prescriptions.
                </p>
              </div>
            </div>

            {/* Step 3 */}
            <div style={{display: "flex", gap: 24, alignItems: "flex-start"}}>
              <div style={{
                width: 48, height: 48, borderRadius: "50%",
                background: "rgba(102, 126, 234, 0.15)", border: "1px solid rgba(102, 126, 234, 0.3)",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: "1.2rem", fontWeight: 700, color: "#667eea", flexShrink: 0,
              }}>3</div>
              <div>
                <h3 style={{color: "#fff", fontSize: "1.15rem", marginTop: 0, marginBottom: 8}}>
                  Taper at your pace
                </h3>
                <div style={{
                  background: "rgba(255,255,255,0.04)", borderRadius: 8,
                  padding: "12px 16px", fontFamily: "monospace", fontSize: "0.9rem",
                  color: "rgba(255,255,255,0.7)", marginBottom: 8,
                }}>
                  <span style={{color: "rgba(255,255,255,0.35)"}}>~ {">"} </span>
                  recovery "I want to cut from 6 coffees to 2 over the next month"<br/><br/>
                  <span style={{color: "rgba(102,126,234,0.8)"}}>
                    Plan set. Starting at 5, stepping down one per week.<br/>
                    You'll hit 2 by April 26. I'll adjust if it's too fast<br/>
                    or too slow. The first step is usually the easiest.
                  </span>
                </div>
                <p style={{color: "rgba(255,255,255,0.5)", fontSize: "0.9rem", lineHeight: 1.7, margin: 0}}>
                  Ask to slow down and the plan extends. No judgment. The schedule bends around you.
                  Each step is a note on the tree. The AI tracks where you are.
                </p>
              </div>
            </div>

          </div>
        </div>
      </section>

      {/* ── SLIPS ── */}
      <section className="lp-section" style={{paddingTop: 60, paddingBottom: 60, background: "rgba(255,255,255,0.02)"}}>
        <div className="lp-container" style={{maxWidth: 760}}>
          <h2 style={{color: "#fff", fontSize: "1.5rem", marginBottom: 16, textAlign: "center"}}>
            A slip is data, not failure.
          </h2>
          <div style={{
            background: "rgba(255,255,255,0.04)", borderRadius: 8,
            padding: "12px 16px", fontFamily: "monospace", fontSize: "0.9rem",
            color: "rgba(255,255,255,0.7)", maxWidth: 580, margin: "0 auto",
          }}>
            <span style={{color: "rgba(255,255,255,0.35)"}}>~ {">"} </span>
            recovery "I slipped. had 4 drinks last night"<br/><br/>
            <span style={{color: "rgba(255,255,255,0.6)"}}>
              Logged. Four drinks last night. Your streak was 12 days.<br/>
              That's still 12 days you didn't have before.<br/>
              What was happening yesterday?
            </span>
          </div>
          <p style={{color: "rgba(255,255,255,0.4)", textAlign: "center", fontSize: "0.9rem", lineHeight: 1.8, marginTop: 16, maxWidth: 550, margin: "16px auto 0"}}>
            No shame. No disappointment. The AI asks what happened because context matters
            for pattern detection. Next time a similar situation appears, the tree remembers.
          </p>
        </div>
      </section>

      {/* ── THE JOURNAL ── */}
      <section className="lp-section" style={{paddingTop: 60, paddingBottom: 60}}>
        <div className="lp-container" style={{maxWidth: 760}}>
          <h2 style={{color: "#fff", fontSize: "1.5rem", marginBottom: 16, textAlign: "center"}}>
            The journal doesn't analyze.
          </h2>
          <p style={{color: "rgba(255,255,255,0.5)", textAlign: "center", fontSize: "0.95rem", lineHeight: 1.8, maxWidth: 600, margin: "0 auto 24px"}}>
            Everything else in the tree works. The journal just holds.
            Write whatever you need to write. The AI doesn't parse it, doesn't extract values,
            doesn't connect it to your substance use. It says "Written." and moves on.
          </p>
          <p style={{color: "rgba(255,255,255,0.35)", textAlign: "center", fontSize: "0.9rem", fontStyle: "italic"}}>
            But if you ask "show me my journal entries from the hardest days," the AI can read them.
            The entries are in the tree. They're searchable. They just don't get automatically processed.
          </p>
        </div>
      </section>

      {/* ── THE TREE STRUCTURE ── */}
      <section className="lp-section" style={{paddingTop: 60, paddingBottom: 60, background: "rgba(255,255,255,0.02)"}}>
        <div className="lp-container" style={{maxWidth: 760}}>
          <h2 style={{color: "#fff", fontSize: "1.5rem", marginBottom: 32, textAlign: "center"}}>
            The tree is the mirror.
          </h2>
          <div style={{
            background: "rgba(255,255,255,0.04)", borderRadius: 10,
            padding: "20px 24px", fontFamily: "monospace", fontSize: "0.85rem",
            color: "rgba(255,255,255,0.6)", lineHeight: 1.9,
          }}>
            <div style={{color: "#fff"}}>Recovery</div>
            <div>├── Log{"              "}(daily check-ins)</div>
            <div>├── Substance</div>
            <div>│   └── <span style={{color: "#48bb78"}}>Caffeine</span></div>
            <div>│       ├── Schedule{"  "}(Week 2: 4/day)</div>
            <div>│       └── Doses{"     "}today: 2 | target: 4 | streak: 12</div>
            <div>├── Feelings</div>
            <div>│   ├── Cravings{"     "}intensity: 6/10 | resist rate: 85%</div>
            <div>│   ├── Mood{"         "}6.1/10 | trending up</div>
            <div>│   └── Energy{"       "}5/10</div>
            <div>├── <span style={{color: "#ecc94b"}}>Patterns</span>{"        "}(AI-detected correlations)</div>
            <div>├── <span style={{color: "#a78bfa"}}>Journal</span>{"         "}(safe space, no analysis)</div>
            <div>├── Milestones{"      "}(Day 1, Day 7, Day 30...)</div>
            <div>├── Profile{"         "}(goals, substances, config)</div>
            <div>└── History{"         "}(daily summaries)</div>
          </div>
        </div>
      </section>

      {/* ── SAFETY ── */}
      <section className="lp-section" style={{paddingTop: 60, paddingBottom: 60}}>
        <div className="lp-container" style={{maxWidth: 760}}>
          <h2 style={{color: "#fff", fontSize: "1.5rem", marginBottom: 16, textAlign: "center"}}>
            Safety boundaries are not optional.
          </h2>
          <div style={{maxWidth: 550, margin: "0 auto"}}>
            {[
              "Never provides medical advice about withdrawal symptoms",
              "For alcohol and benzodiazepine tapering: always recommends medical supervision",
              "If someone expresses hopelessness or mentions self-harm: 988 Suicide and Crisis Lifeline",
              "Never uses shame, guilt, or disappointment language",
              "The person is always the agent. Never says 'you should' or 'you must'",
              "Tracks honestly. Never minimizes or inflates numbers",
            ].map((rule, i) => (
              <div key={i} style={{
                padding: "10px 0", borderBottom: "1px solid rgba(255,255,255,0.05)",
                color: "rgba(255,255,255,0.55)", fontSize: "0.9rem", lineHeight: 1.6,
              }}>
                {rule}
              </div>
            ))}
          </div>
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
          <p style={{color: "rgba(255,255,255,0.35)", textAlign: "center", fontSize: "0.85rem", marginTop: 16}}>
            Fitness data flows to Recovery through channels. Low calorie days correlate with high cravings.
            The tree connects them. Not the code. The structure.
          </p>
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
              <h3 style={{color: "rgba(255,255,255,0.8)", fontSize: "1rem", marginTop: 0, marginBottom: 8}}>Four AI modes</h3>
              <p style={{color: "rgba(255,255,255,0.45)", fontSize: "0.9rem", lineHeight: 1.7, margin: 0}}>
                <strong style={{color: "rgba(255,255,255,0.65)"}}>Log</strong> parses check-ins into structured data. Substances, cravings, mood, energy.
                <strong style={{color: "rgba(255,255,255,0.65)"}}> Reflect</strong> finds patterns across time. Correlations the person can't see.
                <strong style={{color: "rgba(255,255,255,0.65)"}}> Plan</strong> creates and adjusts taper schedules.
                <strong style={{color: "rgba(255,255,255,0.65)"}}> Journal</strong> holds unstructured writing without processing it.
              </p>
            </div>
            <div>
              <h3 style={{color: "rgba(255,255,255,0.8)", fontSize: "1rem", marginTop: 0, marginBottom: 8}}>Milestones and streaks</h3>
              <p style={{color: "rgba(255,255,255,0.45)", fontSize: "0.9rem", lineHeight: 1.7, margin: 0}}>
                Automatic detection at Day 1, 3, 7, 14, 21, 30, 60, 90, 100, 180, 365.
                Written as notes to the Milestones node. The AI mentions them when they arrive.
                Not as celebration theater. As acknowledgment. "Day 30. You're here."
              </p>
            </div>
            <div>
              <h3 style={{color: "rgba(255,255,255,0.8)", fontSize: "1rem", marginTop: 0, marginBottom: 8}}>Pattern detection</h3>
              <p style={{color: "rgba(255,255,255,0.45)", fontSize: "0.9rem", lineHeight: 1.7, margin: 0}}>
                The AI reads across Feelings, Substance, and History to find correlations.
                "Morning exercise reduces craving intensity by 40% (87% confidence, 7 of 8 instances)."
                "4 of your 5 highest craving days had below 1200 calories by 3pm."
                Patterns write to the tree. Future conversations reference them naturally.
              </p>
            </div>
            <div>
              <h3 style={{color: "rgba(255,255,255,0.8)", fontSize: "1rem", marginTop: 0, marginBottom: 8}}>Type "be" to check in</h3>
              <p style={{color: "rgba(255,255,255,0.45)", fontSize: "0.9rem", lineHeight: 1.7, margin: 0}}>
                Navigate to your Recovery tree and type "be". The AI asks how you're doing today.
                Low friction. No forms. It knows your streaks, your hard windows, your patterns.
                It meets you where you are.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ── CTA ── */}
      <section className="lp-section" style={{paddingTop: 80, paddingBottom: 100, textAlign: "center"}}>
        <div className="lp-container">
          <h2 style={{color: "#fff", fontSize: "1.8rem", marginBottom: 16}}>
            The tree grows toward health.
          </h2>
          <p style={{color: "rgba(255,255,255,0.5)", fontSize: "1rem", maxWidth: 500, margin: "0 auto 32px"}}>
            Plant a land. Create a Recovery tree. Check in when you're ready.
            The tree is patient.
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

export default RecoveryPage;
