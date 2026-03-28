
import "../Landing/LandingPage.css";

const CLIAbout = () => {
  return (
    <div className="lp">

      {/* ── HERO ── */}
      <section className="lp-hero" style={{minHeight: "50vh"}}>
        <div className="lp-hero-inner">
          <h1 className="lp-title">The CLI</h1>
          <p className="lp-subtitle">Talk to the tree.</p>
          <p className="lp-tagline">
            Navigate like a filesystem. Talk like a conversation. The AI changes
            based on where you are. Extensions add their own commands. The help menu
            updates at every position. Your view matches the AI's view.
          </p>
          <div className="lp-hero-ctas">
            <a className="lp-btn lp-btn-secondary" href="/seed">The Seed</a>
            <a className="lp-btn lp-btn-secondary" href="/extensions">Extensions</a>
            <a className="lp-btn lp-btn-secondary" href="/build">Build</a>
          </div>
        </div>
      </section>

      {/* ── THREE BASE COMMANDS ── */}
      <section className="lp-section">
        <div className="lp-container" style={{maxWidth: 780}}>
          <h2 className="lp-section-title">Three Commands</h2>
          <p className="lp-section-sub">Everything else builds on them.</p>

          <div style={{maxWidth: 500, margin: "0 auto 24px"}}>
            <Cmd name="chat" desc="the AI thinks and acts" />
            <Cmd name="place" desc="the AI stores what you said" />
            <Cmd name="query" desc="the AI answers without changing anything" />
          </div>

          <p style={{color: "rgba(255,255,255,0.5)", lineHeight: 1.8, fontSize: "0.9rem", marginBottom: 24}}>
            But these are just the floor. Extensions add their own AI commands that work the same
            way but think differently.
          </p>

          <div style={{maxWidth: 600, margin: "0 auto"}}>
            <CmdEx cmd='fitness "bench 135x10x10x8"' label="fitness coach mode" />
            <CmdEx cmd='food "eggs and toast for breakfast"' label="nutrition coach mode" />
            <CmdEx cmd='explore "where is the auth refactor"' label="searches your branch" />
            <CmdEx cmd='scout "what do I know about protein"' label="triangulates the whole tree" />
            <CmdEx cmd='understand' label="compresses the branch into knowledge" />
          </div>

          <p style={{color: "rgba(255,255,255,0.4)", lineHeight: 1.8, fontSize: "0.85rem", marginTop: 20}}>
            Every extension command activates a different AI mode at your position.
            Same tools. Different mind. <code>chat</code> is general. <code>fitness</code> is
            a coach. <code>explore</code> is a researcher. <code>scout</code> is a detective.
            Same node. Different mind.
          </p>
        </div>
      </section>

      {/* ── WHERE YOU ARE ── */}
      <section className="lp-section lp-section-alt">
        <div className="lp-container" style={{maxWidth: 780}}>
          <h2 className="lp-section-title">Where You Are Changes Everything</h2>

          <div style={{maxWidth: 500, margin: "0 auto 24px"}}>
            <Cmd name="cd /" desc="land zone: AI manages your server" />
            <Cmd name="cd ~" desc="home zone: AI helps you reflect" />
            <Cmd name="cd MyTree" desc="tree zone: AI works the branch" />
          </div>

          <p style={{color: "rgba(255,255,255,0.45)", fontSize: "0.85rem", marginBottom: 20}}>
            No settings menu. No mode picker. Just <code>cd</code>.
          </p>

          <div className="lp-terminal">
            <div className="lp-term-header">
              <span className="lp-term-dot red"></span>
              <span className="lp-term-dot yellow"></span>
              <span className="lp-term-dot green"></span>
              <span className="lp-term-title">treeos</span>
            </div>
            <div className="lp-term-body">
              <div className="lp-term-line"><span className="lp-term-prompt">tabor@treeos.ai</span><span className="lp-term-path">/</span> <span className="lp-term-caret">› </span>chat "what extensions are loaded"</div>
              <div className="lp-term-line lp-term-output lp-term-dim">  Land: 92 extensions loaded, all clear...</div>
              <div className="lp-term-line lp-term-output"></div>
              <div className="lp-term-line"><span className="lp-term-prompt">tabor@treeos.ai</span><span className="lp-term-path">~</span> <span className="lp-term-caret">› </span>chat "what have I been working on"</div>
              <div className="lp-term-line lp-term-output lp-term-dim">  Home: Most active in Health and Projects this week...</div>
              <div className="lp-term-line lp-term-output"></div>
              <div className="lp-term-line"><span className="lp-term-prompt">tabor@treeos.ai</span><span className="lp-term-path">/Health/Fitness</span> <span className="lp-term-caret">› </span>chat "add a back routine"</div>
              <div className="lp-term-line lp-term-output lp-term-dim">  Tree: Created Back and Biceps. Pull-ups 4x8, Rows 3x10...</div>
            </div>
          </div>

          <p style={{color: "rgba(255,255,255,0.4)", fontSize: "0.85rem", marginTop: 16, textAlign: "center"}}>
            Same command. Three completely different AIs. Position is everything.
          </p>
        </div>
      </section>

      {/* ── CHAT IS ALL YOU NEED ── */}
      <section className="lp-section">
        <div className="lp-container" style={{maxWidth: 780}}>
          <h2 className="lp-section-title">You Only Need Chat</h2>
          <p style={{color: "rgba(255,255,255,0.6)", lineHeight: 1.9, fontSize: "0.92rem", marginBottom: 20}}>
            A user can type <code>chat</code> for everything and never learn a single extension command.
            The tree routes to the right mode automatically. Extension commands are shortcuts for people
            who know them. <code>chat</code> is the universal entry point.
          </p>

          <div className="lp-terminal">
            <div className="lp-term-header">
              <span className="lp-term-dot red"></span>
              <span className="lp-term-dot yellow"></span>
              <span className="lp-term-dot green"></span>
              <span className="lp-term-title">treeos</span>
            </div>
            <div className="lp-term-body">
              <div className="lp-term-line"><span className="lp-term-prompt">tabor@treeos.ai</span><span className="lp-term-path">/Health/Fitness</span> <span className="lp-term-caret">› </span>chat "bench 135x10"</div>
              <div className="lp-term-line lp-term-output">  Got it. Bench: 135x10/10/8. Up from 130 last session.</div>
              <div className="lp-term-line lp-term-output"></div>
              <div className="lp-term-line"><span className="lp-term-prompt">tabor@treeos.ai</span><span className="lp-term-path">/Health/Food</span> <span className="lp-term-caret">› </span>chat "chicken and rice for lunch"</div>
              <div className="lp-term-line lp-term-output">  Logged. 422 cal, 42g protein.</div>
              <div className="lp-term-line lp-term-output"></div>
              <div className="lp-term-line"><span className="lp-term-prompt">tabor@treeos.ai</span><span className="lp-term-path">/Projects/Backend</span> <span className="lp-term-caret">› </span>chat "how's the auth refactor going"</div>
              <div className="lp-term-line lp-term-output">  The auth refactor has 3 open items...</div>
            </div>
          </div>

          <p style={{color: "rgba(255,255,255,0.45)", lineHeight: 1.8, fontSize: "0.88rem", marginTop: 20}}>
            Same command. Three positions. Three different modes fired. The user typed <code>chat</code> every
            time. The prompt never changes. No "switching to fitness mode." No mode indicators. Position
            tells you where. The mode is invisible.
          </p>

          <p style={{color: "rgba(255,255,255,0.45)", lineHeight: 1.8, fontSize: "0.88rem", marginTop: 12}}>
            Extension commands like <code>fitness "bench 135"</code> skip the classifier and go
            straight to the mode. On a local classifier with zero LLM calls, that saves microseconds.
            The result is identical. Use them when you want to be explicit, or when the classifier
            might be confused (at <code>/Health</code> where both fitness and food live).
          </p>

          <p style={{color: "rgba(255,255,255,0.35)", lineHeight: 1.8, fontSize: "0.85rem", marginTop: 12}}>
            Day 1: you only know <code>chat</code>. Week 2: you notice <code>fitness</code> in the help
            menu. Month 2: you use extension commands for speed and <code>chat</code> for everything else.
            No tutorial needed. The user learns by doing.
          </p>
        </div>
      </section>

      {/* ── SESSIONS ── */}
      <section className="lp-section lp-section-alt">
        <div className="lp-container" style={{maxWidth: 780}}>
          <h2 className="lp-section-title">Sessions</h2>
          <p className="lp-section-sub">
            A session is a conversation pinned to a position. You are always in one. You can run many.
          </p>

          <div className="lp-terminal">
            <div className="lp-term-header">
              <span className="lp-term-dot red"></span>
              <span className="lp-term-dot yellow"></span>
              <span className="lp-term-dot green"></span>
              <span className="lp-term-title">treeos</span>
            </div>
            <div className="lp-term-body">
              <div className="lp-term-line"><span className="lp-term-prompt">tabor@treeos.ai</span><span className="lp-term-path">/Health</span> <span className="lp-term-caret">› </span>chat "hey"</div>
              <div className="lp-term-line lp-term-output lp-term-dim">  # default session at /Health</div>
              <div className="lp-term-line lp-term-output"></div>
              <div className="lp-term-line"><span className="lp-term-prompt">tabor@treeos.ai</span><span className="lp-term-path">/Health</span> <span className="lp-term-caret">› </span>@fitness "whats my bench PR"</div>
              <div className="lp-term-line lp-term-output lp-term-dim">  # creates fitness session at /Health/Fitness</div>
              <div className="lp-term-line lp-term-output"></div>
              <div className="lp-term-line"><span className="lp-term-prompt">tabor@treeos.ai</span><span className="lp-term-path">/Health</span> <span className="lp-term-caret lp-term-green">@fitness › </span>add a back day</div>
              <div className="lp-term-line lp-term-output lp-term-dim">  # still in fitness session</div>
              <div className="lp-term-line lp-term-output"></div>
              <div className="lp-term-line"><span className="lp-term-prompt">tabor@treeos.ai</span><span className="lp-term-path">/Health</span> <span className="lp-term-caret lp-term-green">@fitness › </span>@work "status on the API refactor"</div>
              <div className="lp-term-line lp-term-output lp-term-dim">  # creates work session at /Projects/Backend</div>
              <div className="lp-term-line lp-term-output"></div>
              <div className="lp-term-line"><span className="lp-term-prompt">tabor@treeos.ai</span><span className="lp-term-path">/Health</span> <span className="lp-term-caret lp-term-green">@work › </span>looks good, mark auth complete</div>
              <div className="lp-term-line lp-term-output"></div>
              <div className="lp-term-line"><span className="lp-term-prompt">tabor@treeos.ai</span><span className="lp-term-path">/Health</span> <span className="lp-term-caret lp-term-green">@work › </span>@fitness</div>
              <div className="lp-term-line lp-term-output lp-term-dim">  # switch back (shows recent history)</div>
              <div className="lp-term-line lp-term-output"></div>
              <div className="lp-term-line"><span className="lp-term-prompt">tabor@treeos.ai</span><span className="lp-term-path">/Health</span> <span className="lp-term-caret lp-term-green">@fitness › </span>@default</div>
              <div className="lp-term-line lp-term-output lp-term-dim">  # back to default session</div>
              <div className="lp-term-line lp-term-output"></div>
              <div className="lp-term-line"><span className="lp-term-prompt">tabor@treeos.ai</span><span className="lp-term-path">/Health</span> <span className="lp-term-caret">› </span>_</div>
            </div>
          </div>

          <p style={{color: "rgba(255,255,255,0.5)", lineHeight: 1.8, fontSize: "0.88rem", marginTop: 20}}>
            Sessions stay pinned. <code>@fitness</code> always talks to /Health/Fitness even
            when you have navigated somewhere else. Navigate away and the session does not follow.
            It waits. Come back with <code>@fitness</code> from anywhere.
          </p>

          <div style={{maxWidth: 400, margin: "16px auto 0"}}>
            <Cmd name="sessions" desc="list all active sessions" />
            <Cmd name="sessions kill fitness" desc="end a session" />
          </div>
        </div>
      </section>

      {/* ── WAIT WHAT ── */}
      <section className="lp-section lp-section-alt">
        <div className="lp-container" style={{maxWidth: 700}}>
          <h2 className="lp-section-title" style={{fontSize: "1.3rem"}}>"Wait. First it was <code>fitness</code>, now it's <code>@fitness</code>?"</h2>

          <p style={{color: "rgba(255,255,255,0.6)", lineHeight: 1.9, fontSize: "0.92rem", marginBottom: 16}}>
            Both work. <code>fitness "bench 135"</code> is a direct extension command. It fires
            the fitness AI at your current position, one shot. <code>@fitness "bench 135"</code> opens
            a persistent session pinned to the fitness branch. The session remembers. The direct command
            does not.
          </p>
          <p style={{color: "rgba(255,255,255,0.6)", lineHeight: 1.9, fontSize: "0.92rem", marginBottom: 16}}>
            Inside the shell you just type <code>@fitness hello</code>. No <code>chat</code> prefix needed.
            The shell intercepts the <code>@</code> and routes it. The <code>chat @fitness hello</code> form
            exists for one-shot use outside the shell (<code>treeos chat @fitness hello</code> from a
            regular terminal).
          </p>
          <p style={{color: "rgba(255,255,255,0.5)", lineHeight: 1.9, fontSize: "0.88rem"}}>
            You can <code>cd</code> anywhere, start new chats in any mode, go back, and continue
            where you left off. Sessions persist. If you close the shell and come back tomorrow,
            <code> @fitness</code> picks up where it stopped.
          </p>
        </div>
      </section>

      {/* ── CONTINUING CONVERSATIONS ── */}
      <section className="lp-section">
        <div className="lp-container" style={{maxWidth: 780}}>
          <h2 className="lp-section-title">Context Carries</h2>
          <p className="lp-section-sub">
            The AI remembers within a session. Switch extensions, the context carries.
          </p>

          <div className="lp-terminal">
            <div className="lp-term-header">
              <span className="lp-term-dot red"></span>
              <span className="lp-term-dot yellow"></span>
              <span className="lp-term-dot green"></span>
              <span className="lp-term-title">treeos</span>
            </div>
            <div className="lp-term-body">
              <div className="lp-term-line"><span className="lp-term-prompt">tabor@treeos.ai</span><span className="lp-term-path">/Health</span> <span className="lp-term-caret">› </span>food "eggs and toast for breakfast"</div>
              <div className="lp-term-line lp-term-output">  Logged. 224 cal, 15g protein. You've got room.</div>
              <div className="lp-term-line lp-term-output"></div>
              <div className="lp-term-line"><span className="lp-term-prompt">tabor@treeos.ai</span><span className="lp-term-path">/Health</span> <span className="lp-term-caret">› </span>fitness "what should I do today"</div>
              <div className="lp-term-line lp-term-output">  Based on your 224 cal so far, let's keep it moderate.</div>
              <div className="lp-term-line lp-term-output">  Push day: bench, OHP, lateral raises.</div>
            </div>
          </div>

          <p style={{color: "rgba(255,255,255,0.5)", lineHeight: 1.8, fontSize: "0.88rem", marginTop: 20}}>
            The fitness AI saw your food data. Not because the extensions talk to each other. Because
            both write to the same node's metadata, and <code>enrichContext</code> injects both into every
            prompt. The node is the shared memory. Four messages carry across mode switches. The
            conversation flows.
          </p>
        </div>
      </section>

      {/* ── AUTONOMOUS ── */}
      <section className="lp-section">
        <div className="lp-container" style={{maxWidth: 780}}>
          <h2 className="lp-section-title">The Tree Works While You Are Away</h2>

          <div className="lp-terminal">
            <div className="lp-term-header">
              <span className="lp-term-dot red"></span>
              <span className="lp-term-dot yellow"></span>
              <span className="lp-term-dot green"></span>
              <span className="lp-term-title">treeos</span>
            </div>
            <div className="lp-term-body">
              <div className="lp-term-line"><span className="lp-term-prompt">tabor@treeos.ai</span><span className="lp-term-path">/Health</span> <span className="lp-term-caret">› </span>intent</div>
              <div className="lp-term-line lp-term-output">  Queue: empty</div>
              <div className="lp-term-line lp-term-output">  Last 24h: 2 executed</div>
              <div className="lp-term-line lp-term-output lp-term-green">    Compressed dormant branches under /Projects/Old</div>
              <div className="lp-term-line lp-term-output lp-term-green">    Nudged: "You said you'd start running 3x/week. No runs logged."</div>
              <div className="lp-term-line lp-term-output"></div>
              <div className="lp-term-line"><span className="lp-term-prompt">tabor@treeos.ai</span><span className="lp-term-path">/Health</span> <span className="lp-term-caret">› </span>intent reject 2</div>
              <div className="lp-term-line lp-term-output lp-term-dim">  Got it. Won't nudge about running again.</div>
            </div>
          </div>

          <p style={{color: "rgba(255,255,255,0.5)", lineHeight: 1.8, fontSize: "0.88rem", marginTop: 20}}>
            The intent extension reads pulse health, evolution metrics, contradictions, codebook compression
            status, and your stated goals. It generates actions the tree should take on its own. Review
            them. Reject what you do not want. The tree learns.
          </p>
        </div>
      </section>

      {/* ── WATER ── */}
      <section className="lp-section lp-section-alt">
        <div className="lp-container" style={{maxWidth: 780}}>
          <h2 className="lp-section-title">See Everything at Once</h2>

          <div className="lp-terminal">
            <div className="lp-term-header">
              <span className="lp-term-dot red"></span>
              <span className="lp-term-dot yellow"></span>
              <span className="lp-term-dot green"></span>
              <span className="lp-term-title">treeos</span>
            </div>
            <div className="lp-term-body">
              <div className="lp-term-line"><span className="lp-term-prompt">tabor@treeos.ai</span><span className="lp-term-path">/Health/Fitness</span> <span className="lp-term-caret">› </span>water</div>
              <div className="lp-term-line lp-term-output"></div>
              <div className="lp-term-line lp-term-output">  Hydration at /Health/Fitness:</div>
              <div className="lp-term-line lp-term-output lp-term-dim">    Cascade: enabled, 12 signals today</div>
              <div className="lp-term-line lp-term-output lp-term-dim">    Perspective: accepting fitness, health. Rejecting dreams.</div>
              <div className="lp-term-line lp-term-output lp-term-dim">    Codebook: 23 entries, last compressed 2h ago</div>
              <div className="lp-term-line lp-term-output lp-term-dim">    Memory: 34 connections to /Health/Food, 12 to /Health/Recovery</div>
              <div className="lp-term-line lp-term-output lp-term-dim">    Gaps: none</div>
              <div className="lp-term-line lp-term-output lp-term-dim">    Coherence: 0.91 against tree thesis</div>
              <div className="lp-term-line lp-term-output lp-term-dim">    Evolution: active, 47 notes this week, high revisit score</div>
              <div className="lp-term-line lp-term-output"></div>
              <div className="lp-term-line"><span className="lp-term-prompt">tabor@treeos.ai</span><span className="lp-term-path">/Health/Fitness</span> <span className="lp-term-caret">› </span>water land</div>
              <div className="lp-term-line lp-term-output"></div>
              <div className="lp-term-line lp-term-output">  Land health:</div>
              <div className="lp-term-line lp-term-output lp-term-dim">    Signals: 4,200 today, 98% succeeded</div>
              <div className="lp-term-line lp-term-output lp-term-dim">    Sessions: 5 human, 12 extension, 3 gateway</div>
              <div className="lp-term-line lp-term-output lp-term-dim">    Cache: 94% hit rate</div>
              <div className="lp-term-line lp-term-output lp-term-dim">    Trees: 8 active, 2 dormant</div>
              <div className="lp-term-line lp-term-output lp-term-dim">    Peers: 3 healthy, 1 degraded</div>
            </div>
          </div>

          <p style={{color: "rgba(255,255,255,0.5)", lineHeight: 1.8, fontSize: "0.88rem", marginTop: 20}}>
            <code>water</code> is the full picture at any position. Everything the extensions
            know, assembled in one view. The tree knows its own hydration.
          </p>
        </div>
      </section>

      {/* ── INSTALL ── */}
      <section className="lp-section">
        <div className="lp-container" style={{textAlign: "center"}}>
          <h2 className="lp-section-title">Get Started</h2>
          <div className="lp-terminal" style={{maxWidth: 480, margin: "0 auto", textAlign: "left"}}>
            <div className="lp-term-header">
              <span className="lp-term-dot red"></span>
              <span className="lp-term-dot yellow"></span>
              <span className="lp-term-dot green"></span>
              <span className="lp-term-title">terminal</span>
            </div>
            <div className="lp-term-body">
              <div className="lp-term-line lp-term-dim"># Install</div>
              <div className="lp-term-line">npm install -g treeos</div>
              <div className="lp-term-line lp-term-output"></div>
              <div className="lp-term-line lp-term-dim"># Connect to a land</div>
              <div className="lp-term-line">treeos connect https://treeos.ai</div>
              <div className="lp-term-line lp-term-output"></div>
              <div className="lp-term-line lp-term-dim"># Create your account</div>
              <div className="lp-term-line">treeos register</div>
              <div className="lp-term-line lp-term-output"></div>
              <div className="lp-term-line lp-term-dim"># Start the shell</div>
              <div className="lp-term-line">treeos start</div>
            </div>
          </div>
          <div className="lp-cta-row">
            <a className="lp-btn lp-btn-primary" href="/">Home</a>
            <a className="lp-btn lp-btn-secondary" href="/guide">Guide</a>
            <a className="lp-btn lp-btn-secondary" href="/extensions">Extensions</a>
            <a className="lp-btn lp-btn-secondary" href="https://horizon.treeos.ai">Horizon</a>
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

const Cmd = ({ name, desc }) => (
  <div style={{
    display: "flex", justifyContent: "space-between", padding: "8px 0",
    borderBottom: "1px solid rgba(255,255,255,0.04)",
  }}>
    <code style={{color: "#4ade80", fontSize: "0.9rem"}}>{name}</code>
    <span style={{color: "rgba(255,255,255,0.45)", fontSize: "0.85rem"}}>{desc}</span>
  </div>
);

const CmdEx = ({ cmd, label }) => (
  <div style={{
    display: "flex", justifyContent: "space-between", padding: "6px 0",
    borderBottom: "1px solid rgba(255,255,255,0.03)",
  }}>
    <code style={{color: "rgba(255,255,255,0.55)", fontSize: "0.82rem"}}>{cmd}</code>
    <span style={{color: "rgba(255,255,255,0.3)", fontSize: "0.8rem"}}>{label}</span>
  </div>
);

export default CLIAbout;
