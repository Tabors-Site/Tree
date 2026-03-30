
import "../Landing/LandingPage.css";
import Particles from "../Landing/Particles.jsx";

const CLIAbout = () => {
  return (
    <div className="lp">

      {/* ── HERO ── */}
      <section className="lp-hero" style={{minHeight: "50vh"}}>
        <Particles count={25} />
        <div className="lp-hero-inner">
          <h1 className="lp-title">The CLI</h1>
          <p className="lp-subtitle">Just type. It understands.</p>
          <p className="lp-tagline">
            Natural language in the shell. Say what you mean and the tree figures out
            what to do. Commands exist for when you want precision. But you never need them.
          </p>
          <div className="lp-hero-ctas">
            <a className="lp-btn lp-btn-secondary" href="/">Home</a>
            <a className="lp-btn lp-btn-secondary" href="/seed">The Seed</a>
            <a className="lp-btn lp-btn-secondary" href="/extensions">Extensions</a>
            <a className="lp-btn lp-btn-secondary" href="/build">Build</a>
          </div>
        </div>
      </section>

      {/* ── NATURAL LANGUAGE ── */}
      <section className="lp-section">
        <div className="lp-container" style={{maxWidth: 780}}>
          <h2 className="lp-section-title">Talk to It</h2>

          <div className="lp-terminal">
            <div className="lp-term-header">
              <span className="lp-term-dot red"></span>
              <span className="lp-term-dot yellow"></span>
              <span className="lp-term-dot green"></span>
              <span className="lp-term-title">treeos</span>
            </div>
            <div className="lp-term-body">
              <div className="lp-term-line"><span className="lp-term-prompt">tabor@treeos.ai</span><span className="lp-term-path">/Health</span> <span className="lp-term-caret">› </span>I had eggs and toast for breakfast</div>
              <div className="lp-term-line lp-term-output">  Logged. 310 cal, 18g protein, 24g carbs.</div>
              <div className="lp-term-line lp-term-output"></div>
              <div className="lp-term-line"><span className="lp-term-prompt">tabor@treeos.ai</span><span className="lp-term-path">/Health</span> <span className="lp-term-caret">› </span>how many calories am I at today</div>
              <div className="lp-term-line lp-term-output">  620 cal so far. 1,380 remaining for your 2,000 target.</div>
              <div className="lp-term-line lp-term-output"></div>
              <div className="lp-term-line"><span className="lp-term-prompt">tabor@treeos.ai</span><span className="lp-term-path">/Health</span> <span className="lp-term-caret">› </span>bench 135x10x10x8, OHP 95x8x8x6</div>
              <div className="lp-term-line lp-term-output">  Push day logged. Bench up from 130 last week. OHP holding steady.</div>
            </div>
          </div>

          <p style={{color: "rgba(255,255,255,0.5)", lineHeight: 1.8, fontSize: "0.9rem", marginTop: 20}}>
            If the first word isn't a command, the shell sends it straight to the AI. The tree
            reads your position, picks the right mode, and responds. No prefix. No quoting. Just type.
          </p>
        </div>
      </section>

      {/* ── YOU ALREADY KNOW THIS ── */}
      <section className="lp-section lp-section-alt">
        <div className="lp-container" style={{maxWidth: 780}}>
          <h2 className="lp-section-title">You Already Know This</h2>
          <p className="lp-section-sub">It works like a filesystem.</p>

          <div className="lp-terminal">
            <div className="lp-term-header">
              <span className="lp-term-dot red"></span>
              <span className="lp-term-dot yellow"></span>
              <span className="lp-term-dot green"></span>
              <span className="lp-term-title">treeos</span>
            </div>
            <div className="lp-term-body">
              <div className="lp-term-line"><span className="lp-term-prompt">tabor@treeos.ai</span><span className="lp-term-path">~</span> <span className="lp-term-caret">› </span>ls</div>
              <div className="lp-term-line lp-term-output lp-term-dim">  Health    Projects    Journal</div>
              <div className="lp-term-line lp-term-output"></div>
              <div className="lp-term-line"><span className="lp-term-prompt">tabor@treeos.ai</span><span className="lp-term-path">~</span> <span className="lp-term-caret">› </span>cd Health</div>
              <div className="lp-term-line lp-term-output"></div>
              <div className="lp-term-line"><span className="lp-term-prompt">tabor@treeos.ai</span><span className="lp-term-path">/Health</span> <span className="lp-term-caret">› </span>ls</div>
              <div className="lp-term-line lp-term-output lp-term-dim">  Fitness    Food    Recovery    Study</div>
              <div className="lp-term-line lp-term-output"></div>
              <div className="lp-term-line"><span className="lp-term-prompt">tabor@treeos.ai</span><span className="lp-term-path">/Health</span> <span className="lp-term-caret">› </span>cd Fitness</div>
              <div className="lp-term-line lp-term-output"></div>
              <div className="lp-term-line"><span className="lp-term-prompt">tabor@treeos.ai</span><span className="lp-term-path">/Health/Fitness</span> <span className="lp-term-caret">› </span>tree</div>
              <div className="lp-term-line lp-term-output lp-term-dim">  Fitness</div>
              <div className="lp-term-line lp-term-output lp-term-dim">  {"  "}Push</div>
              <div className="lp-term-line lp-term-output lp-term-dim">  {"    "}Bench Press</div>
              <div className="lp-term-line lp-term-output lp-term-dim">  {"    "}OHP</div>
              <div className="lp-term-line lp-term-output lp-term-dim">  {"  "}Pull</div>
              <div className="lp-term-line lp-term-output lp-term-dim">  {"    "}Pull-ups</div>
              <div className="lp-term-line lp-term-output lp-term-dim">  {"    "}Rows</div>
              <div className="lp-term-line lp-term-output lp-term-dim">  {"  "}Legs</div>
              <div className="lp-term-line lp-term-output"></div>
              <div className="lp-term-line"><span className="lp-term-prompt">tabor@treeos.ai</span><span className="lp-term-path">/Health/Fitness</span> <span className="lp-term-caret">› </span>mkdir Cardio</div>
              <div className="lp-term-line lp-term-output lp-term-dim">  Created Cardio</div>
              <div className="lp-term-line lp-term-output"></div>
              <div className="lp-term-line"><span className="lp-term-prompt">tabor@treeos.ai</span><span className="lp-term-path">/Health/Fitness</span> <span className="lp-term-caret">› </span>cd ..</div>
              <div className="lp-term-line lp-term-output"></div>
              <div className="lp-term-line"><span className="lp-term-prompt">tabor@treeos.ai</span><span className="lp-term-path">/Health</span> <span className="lp-term-caret">› </span>pwd</div>
              <div className="lp-term-line lp-term-output lp-term-dim">  /Health</div>
            </div>
          </div>

          <p style={{color: "rgba(255,255,255,0.5)", lineHeight: 1.8, fontSize: "0.9rem", marginTop: 20}}>
            <code>cd</code>, <code>ls</code>, <code>tree</code>, <code>mkdir</code>, <code>pwd</code>, <code>mv</code>, <code>rm</code>.
            If you have used a terminal, you can use TreeOS. The tree is a filesystem where AI lives at every node.
          </p>
        </div>
      </section>

      {/* ── THREE ZONES ── */}
      <section className="lp-section">
        <div className="lp-container" style={{maxWidth: 780}}>
          <h2 className="lp-section-title">Three Zones</h2>
          <p className="lp-section-sub">Where you are changes what the AI can do.</p>

          <div className="lp-terminal">
            <div className="lp-term-header">
              <span className="lp-term-dot red"></span>
              <span className="lp-term-dot yellow"></span>
              <span className="lp-term-dot green"></span>
              <span className="lp-term-title">treeos</span>
            </div>
            <div className="lp-term-body">
              <div className="lp-term-line"><span className="lp-term-prompt">tabor@treeos.ai</span><span className="lp-term-path">/</span> <span className="lp-term-caret">› </span>what extensions are loaded</div>
              <div className="lp-term-line lp-term-output lp-term-dim">  Land zone. 95 extensions loaded, all healthy.</div>
              <div className="lp-term-line lp-term-output"></div>
              <div className="lp-term-line"><span className="lp-term-prompt">tabor@treeos.ai</span><span className="lp-term-path">/</span> <span className="lp-term-caret">› </span>cd ~</div>
              <div className="lp-term-line lp-term-output"></div>
              <div className="lp-term-line"><span className="lp-term-prompt">tabor@treeos.ai</span><span className="lp-term-path">~</span> <span className="lp-term-caret">› </span>what have I been working on</div>
              <div className="lp-term-line lp-term-output lp-term-dim">  Home zone. Most active in Health and Projects this week.</div>
              <div className="lp-term-line lp-term-output"></div>
              <div className="lp-term-line"><span className="lp-term-prompt">tabor@treeos.ai</span><span className="lp-term-path">~</span> <span className="lp-term-caret">› </span>cd Health</div>
              <div className="lp-term-line lp-term-output"></div>
              <div className="lp-term-line"><span className="lp-term-prompt">tabor@treeos.ai</span><span className="lp-term-path">/Health</span> <span className="lp-term-caret">› </span>add a back routine to my pull days</div>
              <div className="lp-term-line lp-term-output lp-term-dim">  Tree zone. Created Back and Biceps under Pull. Pull-ups 4x8, Rows 3x10.</div>
            </div>
          </div>

          <div style={{maxWidth: 500, margin: "24px auto 0"}}>
            <Cmd name="cd /" desc="land zone. manage your server." />
            <Cmd name="cd ~" desc="home zone. your trees, your ideas." />
            <Cmd name="cd Health" desc="tree zone. AI works the branch." />
          </div>

          <p style={{color: "rgba(255,255,255,0.4)", fontSize: "0.85rem", marginTop: 16, textAlign: "center"}}>
            No mode picker. No settings. Just <code>cd</code>.
          </p>
        </div>
      </section>

      {/* ── FOUR INTENTS ── */}
      <section className="lp-section lp-section-alt">
        <div className="lp-container" style={{maxWidth: 780}}>
          <h2 className="lp-section-title">Four Ways to Talk</h2>
          <p className="lp-section-sub">Most of the time you just type. But when you want to be specific.</p>

          <div style={{maxWidth: 500, margin: "0 auto 24px"}}>
            <Cmd name="chat" desc="you steer, the AI responds" />
            <Cmd name="place" desc="the AI stores what you said" />
            <Cmd name="query" desc="the AI answers without changing anything" />
            <Cmd name="be" desc="the tree leads, you follow" />
          </div>

          <div className="lp-terminal">
            <div className="lp-term-header">
              <span className="lp-term-dot red"></span>
              <span className="lp-term-dot yellow"></span>
              <span className="lp-term-dot green"></span>
              <span className="lp-term-title">treeos</span>
            </div>
            <div className="lp-term-body">
              <div className="lp-term-line"><span className="lp-term-prompt">tabor@treeos.ai</span><span className="lp-term-path">/Health/Fitness</span> <span className="lp-term-caret">› </span>chat what should I work on today</div>
              <div className="lp-term-line lp-term-output lp-term-dim">  Pull day. You haven't hit back since Tuesday.</div>
              <div className="lp-term-line lp-term-output"></div>
              <div className="lp-term-line"><span className="lp-term-prompt">tabor@treeos.ai</span><span className="lp-term-path">/Health/Fitness</span> <span className="lp-term-caret">› </span>place deadlift 315x5x5x3</div>
              <div className="lp-term-line lp-term-output lp-term-dim">  Stored under Pull/Deadlift. 315x5/5/3. New PR on first set.</div>
              <div className="lp-term-line lp-term-output"></div>
              <div className="lp-term-line"><span className="lp-term-prompt">tabor@treeos.ai</span><span className="lp-term-path">/Health/Fitness</span> <span className="lp-term-caret">› </span>query what was my deadlift last month</div>
              <div className="lp-term-line lp-term-output lp-term-dim">  295x5x5x5 on March 3.</div>
              <div className="lp-term-line lp-term-output"></div>
              <div className="lp-term-line"><span className="lp-term-prompt">tabor@treeos.ai</span><span className="lp-term-path">/Health/Fitness</span> <span className="lp-term-caret">› </span>be</div>
              <div className="lp-term-line lp-term-output lp-term-dim">  Your pull volume is high but you haven't stretched in 6 days.</div>
              <div className="lp-term-line lp-term-output lp-term-dim">  Want to add a mobility block?</div>
            </div>
          </div>

          <p style={{color: "rgba(255,255,255,0.45)", lineHeight: 1.8, fontSize: "0.88rem", marginTop: 20}}>
            <code>chat</code>, <code>place</code>, and <code>query</code> are conversations where you steer.{" "}
            <code>be</code> is different. The tree reads everything, finds what needs doing, and guides you one step at a time.
            One word. The tree takes over.
          </p>

          <p style={{color: "rgba(255,255,255,0.35)", lineHeight: 1.8, fontSize: "0.85rem", marginTop: 12}}>
            These are optional. Typing naturally without a command prefix does the same thing.
            The tree classifies your intent automatically. Commands are for when you want to tell it
            exactly how to think.
          </p>
        </div>
      </section>

      {/* ── EXTENSION COMMANDS ── */}
      <section className="lp-section">
        <div className="lp-container" style={{maxWidth: 780}}>
          <h2 className="lp-section-title">Extensions Add Commands</h2>
          <p className="lp-section-sub">Every extension brings its own verbs. The help menu updates at every position.</p>

          <div className="lp-terminal">
            <div className="lp-term-header">
              <span className="lp-term-dot red"></span>
              <span className="lp-term-dot yellow"></span>
              <span className="lp-term-dot green"></span>
              <span className="lp-term-title">treeos</span>
            </div>
            <div className="lp-term-body">
              <div className="lp-term-line lp-term-dim"># proficiency extensions</div>
              <div className="lp-term-line"><span className="lp-term-prompt">tabor@treeos.ai</span><span className="lp-term-path">/Health</span> <span className="lp-term-caret">› </span>food eggs and coffee for breakfast</div>
              <div className="lp-term-line lp-term-output lp-term-dim">  Logged. 224 cal, 15g protein.</div>
              <div className="lp-term-line lp-term-output"></div>
              <div className="lp-term-line"><span className="lp-term-prompt">tabor@treeos.ai</span><span className="lp-term-path">/Health</span> <span className="lp-term-caret">› </span>fitness bench 135x10x10x8</div>
              <div className="lp-term-line lp-term-output lp-term-dim">  Push day logged. Bench up from 130 last session.</div>
              <div className="lp-term-line lp-term-output"></div>
              <div className="lp-term-line"><span className="lp-term-prompt">tabor@treeos.ai</span><span className="lp-term-path">/Health</span> <span className="lp-term-caret">› </span>recovery slept 7 hours, feeling good</div>
              <div className="lp-term-line lp-term-output lp-term-dim">  Checked in. Sleep trending up this week.</div>
              <div className="lp-term-line lp-term-output"></div>
              <div className="lp-term-line"><span className="lp-term-prompt">tabor@treeos.ai</span><span className="lp-term-path">/Health</span> <span className="lp-term-caret">› </span>study status</div>
              <div className="lp-term-line lp-term-output lp-term-dim">  Active: distributed systems (72% mastery)</div>
              <div className="lp-term-line lp-term-output lp-term-dim">  Queue: compilers, category theory</div>
              <div className="lp-term-line lp-term-output"></div>
              <div className="lp-term-line lp-term-dim"># intelligence extensions</div>
              <div className="lp-term-line"><span className="lp-term-prompt">tabor@treeos.ai</span><span className="lp-term-path">/Health</span> <span className="lp-term-caret">› </span>explore what do I know about protein</div>
              <div className="lp-term-line lp-term-output lp-term-dim">  Found 8 nodes across Food and Fitness. Triangulating...</div>
              <div className="lp-term-line lp-term-output"></div>
              <div className="lp-term-line"><span className="lp-term-prompt">tabor@treeos.ai</span><span className="lp-term-path">/Health</span> <span className="lp-term-caret">› </span>understand</div>
              <div className="lp-term-line lp-term-output lp-term-dim">  Compressing /Health into knowledge... 34 nodes processed.</div>
              <div className="lp-term-line lp-term-output"></div>
              <div className="lp-term-line lp-term-dim"># subcommands</div>
              <div className="lp-term-line"><span className="lp-term-prompt">tabor@treeos.ai</span><span className="lp-term-path">/Health</span> <span className="lp-term-caret">› </span>food-daily</div>
              <div className="lp-term-line lp-term-output lp-term-dim">  Today: 1,640 cal, 112g protein. On track.</div>
              <div className="lp-term-line lp-term-output"></div>
              <div className="lp-term-line"><span className="lp-term-prompt">tabor@treeos.ai</span><span className="lp-term-path">/Health</span> <span className="lp-term-caret">› </span>kb status</div>
              <div className="lp-term-line lp-term-output lp-term-dim">  84 entries. 3 stale. 1 unplaced.</div>
            </div>
          </div>

          <p style={{color: "rgba(255,255,255,0.45)", lineHeight: 1.8, fontSize: "0.88rem", marginTop: 20}}>
            Each command activates a different AI mode at your position. <code>food</code> is a nutritionist.
            {" "}<code>fitness</code> is a coach. <code>explore</code> is a researcher. <code>understand</code> compresses
            the branch into knowledge. Same tree. Different minds.
          </p>

          <p style={{color: "rgba(255,255,255,0.35)", lineHeight: 1.8, fontSize: "0.85rem", marginTop: 12}}>
            You can also just type naturally and the tree will route to the right extension.
            Extension commands are shortcuts for when you want to be explicit or when similar
            extensions overlap at the same position.
          </p>
        </div>
      </section>

      {/* ── SESSIONS ── */}
      <section className="lp-section lp-section-alt">
        <div className="lp-container" style={{maxWidth: 780}}>
          <h2 className="lp-section-title">Sessions</h2>
          <p className="lp-section-sub">
            Pin a conversation to a position. Talk to it from anywhere.
          </p>

          <div className="lp-terminal">
            <div className="lp-term-header">
              <span className="lp-term-dot red"></span>
              <span className="lp-term-dot yellow"></span>
              <span className="lp-term-dot green"></span>
              <span className="lp-term-title">treeos</span>
            </div>
            <div className="lp-term-body">
              <div className="lp-term-line"><span className="lp-term-prompt">tabor@treeos.ai</span><span className="lp-term-path">/Health</span> <span className="lp-term-caret">› </span>@fitness whats my bench PR</div>
              <div className="lp-term-line lp-term-output lp-term-dim">  135x10 on March 26.</div>
              <div className="lp-term-line lp-term-output"></div>
              <div className="lp-term-line"><span className="lp-term-prompt">tabor@treeos.ai</span><span className="lp-term-path">/Health</span> <span className="lp-term-caret lp-term-green">@fitness › </span>add a back day</div>
              <div className="lp-term-line lp-term-output lp-term-dim">  Created Back and Biceps. Pull-ups 4x8, Rows 3x12.</div>
              <div className="lp-term-line lp-term-output"></div>
              <div className="lp-term-line"><span className="lp-term-prompt">tabor@treeos.ai</span><span className="lp-term-path">/Health</span> <span className="lp-term-caret lp-term-green">@fitness › </span>@food how much protein today</div>
              <div className="lp-term-line lp-term-output lp-term-dim">  82g so far. You want 150. Need about 70g more.</div>
              <div className="lp-term-line lp-term-output"></div>
              <div className="lp-term-line"><span className="lp-term-prompt">tabor@treeos.ai</span><span className="lp-term-path">/Health</span> <span className="lp-term-caret lp-term-green">@food › </span>@fitness</div>
              <div className="lp-term-line lp-term-output lp-term-dim">  Back in fitness session. Last: added Back and Biceps.</div>
              <div className="lp-term-line lp-term-output"></div>
              <div className="lp-term-line"><span className="lp-term-prompt">tabor@treeos.ai</span><span className="lp-term-path">/Health</span> <span className="lp-term-caret lp-term-green">@fitness › </span>sessions</div>
              <div className="lp-term-line lp-term-output lp-term-dim">  @fitness  /Health/Fitness  (active)</div>
              <div className="lp-term-line lp-term-output lp-term-dim">  @food     /Health/Food</div>
              <div className="lp-term-line lp-term-output"></div>
              <div className="lp-term-line"><span className="lp-term-prompt">tabor@treeos.ai</span><span className="lp-term-path">/Health</span> <span className="lp-term-caret lp-term-green">@fitness › </span>@default</div>
              <div className="lp-term-line lp-term-output lp-term-dim">  Back to default session.</div>
              <div className="lp-term-line lp-term-output"></div>
              <div className="lp-term-line"><span className="lp-term-prompt">tabor@treeos.ai</span><span className="lp-term-path">/Health</span> <span className="lp-term-caret">› </span>_</div>
            </div>
          </div>

          <p style={{color: "rgba(255,255,255,0.5)", lineHeight: 1.8, fontSize: "0.88rem", marginTop: 20}}>
            <code>@fitness</code> creates a session pinned to /Health/Fitness. Navigate anywhere and the session
            stays put. Come back with <code>@fitness</code> from anywhere. Each session remembers its own conversation.
            Close the shell, come back tomorrow, pick up where you stopped.
          </p>

          <div style={{maxWidth: 500, margin: "20px auto 0"}}>
            <Cmd name="sessions" desc="list all active sessions" />
            <Cmd name="sessions kill fitness" desc="end a session" />
            <Cmd name="@default" desc="switch back to default session" />
          </div>
        </div>
      </section>

      {/* ── CONTEXT CARRIES ── */}
      <section className="lp-section">
        <div className="lp-container" style={{maxWidth: 780}}>
          <h2 className="lp-section-title">Context Carries</h2>

          <div className="lp-terminal">
            <div className="lp-term-header">
              <span className="lp-term-dot red"></span>
              <span className="lp-term-dot yellow"></span>
              <span className="lp-term-dot green"></span>
              <span className="lp-term-title">treeos</span>
            </div>
            <div className="lp-term-body">
              <div className="lp-term-line"><span className="lp-term-prompt">tabor@treeos.ai</span><span className="lp-term-path">/Health</span> <span className="lp-term-caret">› </span>food eggs and toast for breakfast</div>
              <div className="lp-term-line lp-term-output">  Logged. 224 cal, 15g protein.</div>
              <div className="lp-term-line lp-term-output"></div>
              <div className="lp-term-line"><span className="lp-term-prompt">tabor@treeos.ai</span><span className="lp-term-path">/Health</span> <span className="lp-term-caret">› </span>fitness what should I do today</div>
              <div className="lp-term-line lp-term-output">  224 cal in so far, keep it moderate. Push day: bench, OHP, lateral raises.</div>
            </div>
          </div>

          <p style={{color: "rgba(255,255,255,0.5)", lineHeight: 1.8, fontSize: "0.88rem", marginTop: 20}}>
            The fitness AI saw the food data. Not because the extensions talk to each other, but because
            both write to the same tree and <code>enrichContext</code> injects everything into every prompt.
            The tree is the shared memory.
          </p>
        </div>
      </section>

      {/* ── THE TREE WORKS ALONE ── */}
      <section className="lp-section lp-section-alt">
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
              <div className="lp-term-line lp-term-output">  Last 24h: 2 executed</div>
              <div className="lp-term-line lp-term-output lp-term-green">    Compressed dormant branches under /Projects/Old</div>
              <div className="lp-term-line lp-term-output lp-term-green">    Nudged: "You said 3x/week running. No runs logged."</div>
              <div className="lp-term-line lp-term-output"></div>
              <div className="lp-term-line"><span className="lp-term-prompt">tabor@treeos.ai</span><span className="lp-term-path">/Health</span> <span className="lp-term-caret">› </span>intent reject 2</div>
              <div className="lp-term-line lp-term-output lp-term-dim">  Got it. Won't nudge about running again.</div>
              <div className="lp-term-line lp-term-output"></div>
              <div className="lp-term-line"><span className="lp-term-prompt">tabor@treeos.ai</span><span className="lp-term-path">/Health</span> <span className="lp-term-caret">› </span>water</div>
              <div className="lp-term-line lp-term-output">  Hydration at /Health:</div>
              <div className="lp-term-line lp-term-output lp-term-dim">    Cascade: 12 signals today, all succeeded</div>
              <div className="lp-term-line lp-term-output lp-term-dim">    Codebook: 23 entries, compressed 2h ago</div>
              <div className="lp-term-line lp-term-output lp-term-dim">    Memory: 34 connections to /Health/Food</div>
              <div className="lp-term-line lp-term-output lp-term-dim">    Coherence: 0.91 against tree thesis</div>
              <div className="lp-term-line lp-term-output lp-term-dim">    Evolution: active, 47 notes this week</div>
              <div className="lp-term-line lp-term-output"></div>
              <div className="lp-term-line"><span className="lp-term-prompt">tabor@treeos.ai</span><span className="lp-term-path">/Health</span> <span className="lp-term-caret">› </span>digest</div>
              <div className="lp-term-line lp-term-output lp-term-dim">  This week: 12 workouts logged, protein averaging 134g,</div>
              <div className="lp-term-line lp-term-output lp-term-dim">  sleep improving. Study queue untouched since Monday.</div>
            </div>
          </div>

          <p style={{color: "rgba(255,255,255,0.5)", lineHeight: 1.8, fontSize: "0.88rem", marginTop: 20}}>
            <code>intent</code> shows what the tree did on its own. <code>water</code> shows the full picture
            at any position. <code>digest</code> summarizes the week. The tree compresses, detects contradictions,
            tracks gaps, and nudges you. Review it. Reject what you do not want. It learns.
          </p>
        </div>
      </section>

      {/* ── LIFE ── */}
      <section className="lp-section">
        <div className="lp-container" style={{maxWidth: 780}}>
          <h2 className="lp-section-title">One Command to Start</h2>

          <div className="lp-terminal">
            <div className="lp-term-header">
              <span className="lp-term-dot red"></span>
              <span className="lp-term-dot yellow"></span>
              <span className="lp-term-dot green"></span>
              <span className="lp-term-title">treeos</span>
            </div>
            <div className="lp-term-body">
              <div className="lp-term-line"><span className="lp-term-prompt">tabor@treeos.ai</span><span className="lp-term-path">~</span> <span className="lp-term-caret">› </span>life food fitness study recovery</div>
              <div className="lp-term-line lp-term-output lp-term-dim">  Creating your Life tree...</div>
              <div className="lp-term-line lp-term-output lp-term-dim">  Scaffolded: Food, Fitness, Study, Recovery</div>
              <div className="lp-term-line lp-term-output lp-term-dim">  Each domain has its own AI, its own commands, its own dashboard.</div>
              <div className="lp-term-line lp-term-output"></div>
              <div className="lp-term-line"><span className="lp-term-prompt">tabor@treeos.ai</span><span className="lp-term-path">/Life</span> <span className="lp-term-caret">› </span>ls</div>
              <div className="lp-term-line lp-term-output lp-term-dim">  Food    Fitness    Study    Recovery</div>
              <div className="lp-term-line lp-term-output"></div>
              <div className="lp-term-line"><span className="lp-term-prompt">tabor@treeos.ai</span><span className="lp-term-path">/Life</span> <span className="lp-term-caret">› </span>life add kb</div>
              <div className="lp-term-line lp-term-output lp-term-dim">  Added Knowledge Base to your Life tree.</div>
            </div>
          </div>

          <p style={{color: "rgba(255,255,255,0.45)", lineHeight: 1.8, fontSize: "0.88rem", marginTop: 20}}>
            <code>life</code> scaffolds a tree with the domains you want. Each domain sets up its own
            extension, modes, tools, and dashboards. Add more later with <code>life add</code>. The tree
            grows with you.
          </p>
        </div>
      </section>

      {/* ── INSTALL ── */}
      <section className="lp-section lp-section-alt">
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

export default CLIAbout;
