import "./LandingPage.css";
import Particles from "./Particles.jsx";

// ─────────────────────────────────────────────────────────────────────────
// CodePage — the coding story
//
// The tree writes JavaScript projects. The tree reads its own source. The
// tree edits its own extensions. One sentence becomes a full app. A small
// local model produces shipping code because position, grammar, and the
// self-source tree all contribute to the context the AI sees.
//
// This page tells that story, shows a real example produced by a 27B
// local model (the Tinder clone built in one prompt), and explains why
// it works differently from Claude Code / Cursor / etc.
// ─────────────────────────────────────────────────────────────────────────

const CodePage = () => {
  return (
    <div className="lp">

      {/* ── HERO ── */}
      <section className="lp-hero">
        <Particles count={25} />
        <div className="lp-hero-inner">
          <div className="lp-tree-icon">🐍</div>
          <h1 className="lp-title">The tree writes code.</h1>
          <p className="lp-subtitle">A snake eating its own tail.</p>
          <p className="lp-tagline">
            TreeOS authors JavaScript projects inside itself. It reads its own source as
            a tree. It edits its own extensions. One sentence becomes a full app. It works
            on small local models because the structure carries the context, not the prompt.
          </p>
          <p className="lp-tagline" style={{fontSize: "0.9rem", color: "rgba(255,255,255,0.35)", maxWidth: 560}}>
            The tree IS the workspace. A file is a node. A directory is a node. Content lives
            in a note. Disk is a projection that happens automatically. The AI never thinks
            about paths — it navigates, it writes, the tree compiles itself to real files.
          </p>
          <div className="lp-hero-ctas lp-hero-ctas-sub">
            <a className="lp-btn lp-btn-secondary" href="/ai">The Grammar</a>
            <a className="lp-btn lp-btn-secondary" href="/kernel">The Seed</a>
            <a className="lp-btn lp-btn-secondary" href="/swarm">Swarm</a>
            <a className="lp-btn lp-btn-secondary" href="/extensions">Extensions</a>
            <a className="lp-btn lp-btn-secondary" href="/build">Build</a>
          </div>
        </div>
      </section>

      {/* ── THE INVERSION ── */}
      <section className="lp-section">
        <div className="lp-container" style={{maxWidth: 720}}>
          <div style={{
            padding: "24px 28px", borderLeft: "3px solid rgba(249, 115, 22, 0.4)",
            background: "rgba(249, 115, 22, 0.03)", borderRadius: "0 12px 12px 0",
            marginBottom: 8,
          }}>
            <p style={{color: "#e5e5e5", fontSize: "1.05rem", lineHeight: 1.7, fontStyle: "italic"}}>
              Most coding assistants pretend the AI is a smart developer with a file tree.
              TreeOS inverts that: the file tree IS the developer's thought, the AI just reads
              the position it's at. Every node the cursor lands on changes what the AI can see,
              what tools it can call, and what shape its output has to take.
            </p>
          </div>
          <p style={{color: "#999", fontSize: "0.9rem", lineHeight: 1.7, textAlign: "center", padding: "0 20px"}}>
            You don't give the AI a thousand-line prompt that describes your codebase. You
            let the codebase become the prompt. Navigation is context. "cd into a function"
            is a real action the AI can take.
          </p>
        </div>
      </section>

      {/* ── ONE SENTENCE → FULL APP ── */}
      <section className="lp-section" style={{paddingTop: 40}}>
        <div className="lp-container">
          <h2 className="lp-section-title" style={{textAlign: "center"}}>One sentence. Full app.</h2>
          <p className="lp-section-desc" style={{textAlign: "center", maxWidth: 680, margin: "0 auto 32px"}}>
            Real run, local Qwen 3.5 27B. No prompt engineering. No pasted examples.
            One message in the <code>tiner</code> tree, three files out, app serves from port 3000.
          </p>

          <div style={{
            maxWidth: 780, margin: "0 auto",
            background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.08)",
            borderRadius: 12, padding: 24, fontFamily: "ui-monospace, Menlo, monospace", fontSize: "0.85rem",
          }}>
            <div style={{color: "#f97316", marginBottom: 6}}>tabor@treeos.ai/tiner ›</div>
            <div style={{color: "#e5e5e5", marginBottom: 18, lineHeight: 1.5}}>
              make a rough tinder app with frontend and backend in nodejs and frontend html
            </div>
            <div style={{color: "rgba(255,255,255,0.3)", marginBottom: 6}}>Thinking…</div>
            <div style={{color: "#22d3ee"}}>Tree: Done.</div>

            <div style={{borderTop: "1px solid rgba(255,255,255,0.08)", marginTop: 18, paddingTop: 14, color: "rgba(255,255,255,0.5)", fontSize: "0.78rem"}}>
              tree after one message:
            </div>
            <pre style={{color: "#a3a3a3", margin: "8px 0 0", lineHeight: 1.55}}>{`tiner
  package.json
  server.js
  public/
    index.html`}</pre>
          </div>

          <p style={{color: "#999", fontSize: "0.88rem", textAlign: "center", maxWidth: 620, margin: "24px auto 0", lineHeight: 1.7}}>
            <strong style={{color: "#e5e5e5"}}>What it produced:</strong> Express backend with five seeded
            profiles, REST endpoints for <code>/api/profiles</code> / <code>/api/swipe</code> / <code>/api/matches</code>,
            a full HTML+CSS+JS frontend with draggable card stack, swipe animations, nope/like overlays,
            match popup, mobile touch support, and a responsive purple gradient theme. Real working code.
            Not a stub.
          </p>
        </div>
      </section>

      {/* ── THE SNAKE EATING ITS OWN TAIL ── */}
      <section className="lp-section" style={{background: "rgba(255,255,255,0.02)"}}>
        <div className="lp-container">
          <h2 className="lp-section-title" style={{textAlign: "center"}}>
            The tree reads its own source.
          </h2>
          <p className="lp-section-desc" style={{textAlign: "center", maxWidth: 680, margin: "0 auto 32px"}}>
            At boot, TreeOS ingests its own codebase into a system tree called <code>.source</code>.
            Every extension, every kernel file, every test — live tree nodes with the source as notes.
          </p>

          <div style={{
            display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
            gap: 20, maxWidth: 960, margin: "0 auto",
          }}>
            <div style={{padding: 20, background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 10}}>
              <div style={{fontSize: "1.5rem", marginBottom: 8}}>🌱</div>
              <h3 style={{color: "#e5e5e5", fontSize: "1rem", marginBottom: 8}}>Boot ingest</h3>
              <p style={{color: "#999", fontSize: "0.85rem", lineHeight: 1.6}}>
                <code>land/extensions/</code> and <code>land/seed/</code> walk into <code>.source</code> on
                first boot. Subsequent boots do mtime-based incremental refresh. Unchanged files skip.
              </p>
            </div>

            <div style={{padding: 20, background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 10}}>
              <div style={{fontSize: "1.5rem", marginBottom: 8}}>📖</div>
              <h3 style={{color: "#e5e5e5", fontSize: "1rem", marginBottom: 8}}>Navigate it</h3>
              <p style={{color: "#999", fontSize: "0.85rem", lineHeight: 1.6}}>
                <code>cd /.source/extensions/fitness/modes</code> and the AI at that position is reading
                fitness's plan mode source out of a real tree note. Same mechanism as any user project.
              </p>
            </div>

            <div style={{padding: 20, background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 10}}>
              <div style={{fontSize: "1.5rem", marginBottom: 8}}>🧠</div>
              <h3 style={{color: "#e5e5e5", fontSize: "1rem", marginBottom: 8}}>Reference by example</h3>
              <p style={{color: "#999", fontSize: "0.85rem", lineHeight: 1.6}}>
                When the AI writes a new extension, its mode prompt tells it to
                <code> source-read extensions/fitness/manifest.js</code> first. It copies the real shape
                from real code, not from training memory.
              </p>
            </div>

            <div style={{padding: 20, background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 10}}>
              <div style={{fontSize: "1.5rem", marginBottom: 8}}>🔁</div>
              <h3 style={{color: "#e5e5e5", fontSize: "1rem", marginBottom: 8}}>Self-edit</h3>
              <p style={{color: "#999", fontSize: "0.85rem", lineHeight: 1.6}}>
                Writes back to <code>land/extensions/</code> are gated (<code>disabled / approve / free</code>).
                Flip the mode and the AI can patch TreeOS itself through the same sync walker.
                Seed stays read-only.
              </p>
            </div>
          </div>

          <p style={{color: "rgba(255,255,255,0.5)", fontSize: "0.85rem", textAlign: "center", marginTop: 32, maxWidth: 600, margin: "32px auto 0", lineHeight: 1.7}}>
            Claude Code reads your files. TreeOS reads itself and everything installed next to it.
            When you ask for a "new extension like fitness but for finance," it literally opens
            fitness and uses it as the template. The library is the codebase.
          </p>
        </div>
      </section>

      {/* ── HOW IT WORKS: THE FOUR MOVING PARTS ── */}
      <section className="lp-section">
        <div className="lp-container">
          <h2 className="lp-section-title" style={{textAlign: "center"}}>
            Four moving parts. Everything else composes from them.
          </h2>

          <div style={{maxWidth: 780, margin: "32px auto 0"}}>

            {/* Grammar */}
            <div style={{display: "flex", gap: 20, marginBottom: 28, alignItems: "flex-start"}}>
              <div style={{fontSize: "1.8rem", flexShrink: 0}}>🔤</div>
              <div>
                <h3 style={{color: "#e5e5e5", fontSize: "1.1rem", marginBottom: 8}}>
                  Grammar pipeline — routing by language, not keywords
                </h3>
                <p style={{color: "#999", fontSize: "0.9rem", lineHeight: 1.7}}>
                  Every message parses into five axes: domain (which extension), scope (how much),
                  intent (which mode), interpretation (how), execution (dispatch / sequence / fork / fanout).
                  Nouns are nodes, verbs are extensions, tense is mode. "Write me a function" routes to
                  <code> code-log</code>. "Refactor this" routes to <code> code-plan</code>. "Review this
                  code" routes to <code> code-review</code>. The grammar knows the difference and the
                  mode matches.
                </p>
              </div>
            </div>

            {/* Workspace */}
            <div style={{display: "flex", gap: 20, marginBottom: 28, alignItems: "flex-start"}}>
              <div style={{fontSize: "1.8rem", flexShrink: 0}}>🗂️</div>
              <div>
                <h3 style={{color: "#e5e5e5", fontSize: "1.1rem", marginBottom: 8}}>
                  code-workspace — tree as filesystem
                </h3>
                <p style={{color: "#999", fontSize: "0.9rem", lineHeight: 1.7}}>
                  Every file is a node. Every directory is a node. Content lives in a note on the file
                  node. When the AI writes, it writes a note — which auto-compiles to disk via a
                  depth-first walker (same pattern as the existing <code>book</code> extension). No manual
                  sync. No path juggling. <code>cd lib.js</code> works; the AI at that position reads the
                  file content as position context.
                </p>
              </div>
            </div>

            {/* Source tree */}
            <div style={{display: "flex", gap: 20, marginBottom: 28, alignItems: "flex-start"}}>
              <div style={{fontSize: "1.8rem", flexShrink: 0}}>🔍</div>
              <div>
                <h3 style={{color: "#e5e5e5", fontSize: "1.1rem", marginBottom: 8}}>
                  .source self-tree — self-awareness
                </h3>
                <p style={{color: "#999", fontSize: "0.9rem", lineHeight: 1.7}}>
                  The AI isn't blind to the system it runs on. Every installed extension sits under
                  <code> /.source/extensions/</code> as navigable nodes. The kernel sits under
                  <code> /.source/seed/</code>. When the review mode critiques your code, it measures
                  against real working extensions in the same tree, not against training-set memory
                  of what "good code" looks like. The AI can cite specific files.
                </p>
              </div>
            </div>

            {/* Forge */}
            <div style={{display: "flex", gap: 20, marginBottom: 0, alignItems: "flex-start"}}>
              <div style={{fontSize: "1.8rem", flexShrink: 0}}>🛠️</div>
              <div>
                <h3 style={{color: "#e5e5e5", fontSize: "1.1rem", marginBottom: 8}}>
                  code-forge — ship it as an extension
                </h3>
                <p style={{color: "#999", fontSize: "0.9rem", lineHeight: 1.7}}>
                  Any project the tree builds can become a real TreeOS extension. <code>forge-init</code>
                  <em> adopts</em> an existing workspace project and repoints its output at
                  <code> land/extensions/&lt;name&gt;/</code>. Validate, test, install-local (restart-required),
                  and dry-run publish to Horizon. The same tree nodes you just built are the extension
                  shipped. Nothing gets copied.
                </p>
              </div>
            </div>

          </div>
        </div>
      </section>

      {/* ── THE SELF-REVIEW LOOP ── */}
      <section className="lp-section" style={{background: "rgba(255,255,255,0.02)"}}>
        <div className="lp-container" style={{maxWidth: 780}}>
          <h2 className="lp-section-title" style={{textAlign: "center"}}>
            The AI reviews its own work.
          </h2>
          <p className="lp-section-desc" style={{textAlign: "center", margin: "0 auto 32px"}}>
            After building the Tinder clone on a 27B local model, the same tree, same session.
          </p>

          <div style={{
            background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.08)",
            borderRadius: 12, padding: 24, fontFamily: "ui-monospace, Menlo, monospace", fontSize: "0.82rem",
          }}>
            <div style={{color: "#f97316", marginBottom: 6}}>tabor@treeos.ai/tiner ›</div>
            <div style={{color: "#e5e5e5", marginBottom: 18, lineHeight: 1.5}}>
              do you want to improve anything and add more detail?
            </div>

            <div style={{color: "#22d3ee", marginBottom: 12, lineHeight: 1.6}}>
              Tree: Looking at your code now, I see some things worth fixing and a few
              nice-to-haves worth adding:
            </div>

            <div style={{color: "#e5e5e5", marginBottom: 10, fontSize: "0.78rem"}}>
              <strong style={{color: "#f97316"}}>Key Issues:</strong>
            </div>
            <div style={{color: "#a3a3a3", fontSize: "0.78rem", lineHeight: 1.7, paddingLeft: 12}}>
              1. Match logic is broken — every right swipe shows a match. Real Tinder only
              matches if both people swipe right.<br/>
              2. No persistence — restart the server and you lose all swipes/matches.<br/>
              3. Match section doesn't work — there's a counter but nowhere to view them.<br/>
              4. Photos from pravatar.cc — random placeholder faces, could break.
            </div>

            <div style={{color: "#e5e5e5", marginTop: 16, marginBottom: 10, fontSize: "0.78rem"}}>
              <strong style={{color: "#f97316"}}>Specific fixes I can do now:</strong>
            </div>
            <div style={{color: "#a3a3a3", fontSize: "0.78rem", lineHeight: 1.7, paddingLeft: 12}}>
              1. Fix match logic — simulate mutual attraction (~30% match rate)<br/>
              2. Add matches view — click header to see/list your matches<br/>
              3. Add basic messaging — simple chat interface for matches<br/>
              4. Persist in JSON file — survive server restarts
            </div>
          </div>

          <p style={{color: "rgba(255,255,255,0.5)", fontSize: "0.85rem", textAlign: "center", marginTop: 24, lineHeight: 1.7}}>
            Nobody told it to review. The grammar parsed past-tense framing and routed to
            <code> tree:code-review</code>. The review mode's prompt said "read the files,
            compare to patterns, report issues with specific fix suggestions." That's what
            it did. This is the loop closing — the tree builds, reads, critiques, fixes.
          </p>
        </div>
      </section>

      {/* ── COMPARISON ── */}
      <section className="lp-section">
        <div className="lp-container" style={{maxWidth: 860}}>
          <h2 className="lp-section-title" style={{textAlign: "center"}}>
            Versus Claude Code, Cursor, Copilot.
          </h2>
          <p className="lp-section-desc" style={{textAlign: "center", margin: "0 auto 32px"}}>
            Honest side-by-side. TreeOS isn't better at every dimension — it's a different shape.
          </p>

          <div style={{overflowX: "auto"}}>
            <table style={{
              width: "100%", borderCollapse: "collapse",
              fontSize: "0.85rem", color: "#c5c5c5",
              background: "rgba(255,255,255,0.02)",
              border: "1px solid rgba(255,255,255,0.08)",
              borderRadius: 10, overflow: "hidden",
            }}>
              <thead>
                <tr style={{background: "rgba(255,255,255,0.03)"}}>
                  <th style={{padding: 14, textAlign: "left", color: "#e5e5e5", fontWeight: 600, width: "28%"}}></th>
                  <th style={{padding: 14, textAlign: "left", color: "#e5e5e5", fontWeight: 600}}>Claude Code / Cursor</th>
                  <th style={{padding: 14, textAlign: "left", color: "#f97316", fontWeight: 600}}>TreeOS</th>
                </tr>
              </thead>
              <tbody>
                <tr style={{borderTop: "1px solid rgba(255,255,255,0.06)"}}>
                  <td style={{padding: 14, color: "#999"}}>Context unit</td>
                  <td style={{padding: 14}}>Open files + prompt</td>
                  <td style={{padding: 14}}>Position in the tree</td>
                </tr>
                <tr style={{borderTop: "1px solid rgba(255,255,255,0.06)"}}>
                  <td style={{padding: 14, color: "#999"}}>Reference library</td>
                  <td style={{padding: 14}}>Training data memory</td>
                  <td style={{padding: 14}}>.source tree of installed extensions</td>
                </tr>
                <tr style={{borderTop: "1px solid rgba(255,255,255,0.06)"}}>
                  <td style={{padding: 14, color: "#999"}}>Routing</td>
                  <td style={{padding: 14}}>One prompt, one mode</td>
                  <td style={{padding: 14}}>Grammar pipeline picks mode per tense</td>
                </tr>
                <tr style={{borderTop: "1px solid rgba(255,255,255,0.06)"}}>
                  <td style={{padding: 14, color: "#999"}}>File operations</td>
                  <td style={{padding: 14}}>Read/write filesystem</td>
                  <td style={{padding: 14}}>Read/write tree nodes, disk auto-syncs</td>
                </tr>
                <tr style={{borderTop: "1px solid rgba(255,255,255,0.06)"}}>
                  <td style={{padding: 14, color: "#999"}}>Model requirement</td>
                  <td style={{padding: 14}}>Large frontier models</td>
                  <td style={{padding: 14}}>Local 27B produces shipping code</td>
                </tr>
                <tr style={{borderTop: "1px solid rgba(255,255,255,0.06)"}}>
                  <td style={{padding: 14, color: "#999"}}>Multi-file awareness</td>
                  <td style={{padding: 14}}>Context window + RAG</td>
                  <td style={{padding: 14}}>Tree walker + cascade signals</td>
                </tr>
                <tr style={{borderTop: "1px solid rgba(255,255,255,0.06)"}}>
                  <td style={{padding: 14, color: "#999"}}>Ship as extension</td>
                  <td style={{padding: 14}}>Manual packaging</td>
                  <td style={{padding: 14}}>forge-ship: validate, install, publish</td>
                </tr>
                <tr style={{borderTop: "1px solid rgba(255,255,255,0.06)"}}>
                  <td style={{padding: 14, color: "#999"}}>Self-modification</td>
                  <td style={{padding: 14}}>Read-only on its own source</td>
                  <td style={{padding: 14}}>Gated write-back to TreeOS itself</td>
                </tr>
              </tbody>
            </table>
          </div>

          <p style={{color: "rgba(255,255,255,0.5)", fontSize: "0.82rem", textAlign: "center", marginTop: 20, maxWidth: 620, margin: "20px auto 0", lineHeight: 1.7}}>
            The big one: <strong style={{color: "#e5e5e5"}}>small local models can drive this</strong>.
            Because position carries context and the grammar pipeline does deterministic routing, the
            LLM only has to decide one thing at a time — generate the content of one file, one tool at
            a time. A 27B model does it well. A 7B model does most of it. Frontier models don't have
            much advantage when the prompt itself is mostly deterministic.
          </p>
        </div>
      </section>

      {/* ── COMPOSES WITH THE REST ── */}
      <section className="lp-section" style={{background: "rgba(255,255,255,0.02)"}}>
        <div className="lp-container" style={{maxWidth: 780}}>
          <h2 className="lp-section-title" style={{textAlign: "center"}}>
            And it composes with everything else.
          </h2>
          <p className="lp-section-desc" style={{textAlign: "center", margin: "0 auto 32px"}}>
            This isn't a separate coding IDE bolted on. It's an extension in the same TreeOS you
            use for fitness, food, recovery, journals. The same grammar. The same tree. The same
            AI knows all of it.
          </p>

          <div style={{display: "grid", gap: 14, maxWidth: 680, margin: "0 auto"}}>
            <div style={{padding: "14px 18px", background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 8}}>
              <strong style={{color: "#f97316", fontSize: "0.9rem"}}>cascade</strong>
              <span style={{color: "#999", fontSize: "0.85rem", marginLeft: 12}}>
                — edit a file, downstream dependents get an awareness signal
              </span>
            </div>
            <div style={{padding: "14px 18px", background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 8}}>
              <strong style={{color: "#f97316", fontSize: "0.9rem"}}>book</strong>
              <span style={{color: "#999", fontSize: "0.85rem", marginLeft: 12}}>
                — compile a subtree into one document, the same walker that syncs code to disk
              </span>
            </div>
            <div style={{padding: "14px 18px", background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 8}}>
              <strong style={{color: "#f97316", fontSize: "0.9rem"}}>approve</strong>
              <span style={{color: "#999", fontSize: "0.85rem", marginLeft: 12}}>
                — gate source edits so the operator sees every proposed change
              </span>
            </div>
            <div style={{padding: "14px 18px", background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 8}}>
              <strong style={{color: "#f97316", fontSize: "0.9rem"}}>gap-detection / evolve</strong>
              <span style={{color: "#999", fontSize: "0.85rem", marginLeft: 12}}>
                — notice patterns in how you use the system, propose new extensions to fill them
              </span>
            </div>
            <div style={{padding: "14px 18px", background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 8}}>
              <strong style={{color: "#f97316", fontSize: "0.9rem"}}>horizon</strong>
              <span style={{color: "#999", fontSize: "0.85rem", marginLeft: 12}}>
                — publish what the tree built to the federated extension registry
              </span>
            </div>
            <div style={{padding: "14px 18px", background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 8}}>
              <strong style={{color: "#f97316", fontSize: "0.9rem"}}>mycelium</strong>
              <span style={{color: "#999", fontSize: "0.85rem", marginLeft: 12}}>
                — route "write me a finance tool" to a land that already has one
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* ── THE TOOLS ── */}
      <section className="lp-section">
        <div className="lp-container" style={{maxWidth: 780}}>
          <h2 className="lp-section-title" style={{textAlign: "center"}}>
            The whole surface, in order.
          </h2>
          <p className="lp-section-desc" style={{textAlign: "center", margin: "0 auto 32px"}}>
            What the AI can call, grouped by what it does. Everything else follows from these.
          </p>

          <pre style={{
            background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.08)",
            borderRadius: 10, padding: 24, color: "#c5c5c5", fontSize: "0.82rem",
            fontFamily: "ui-monospace, Menlo, monospace", lineHeight: 1.7, overflowX: "auto",
          }}>{`# writing code in a project
workspace-add-file      create or overwrite a file (content as a note)
workspace-read-file     read current content
workspace-list          list files in the active project
workspace-delete-file   remove a file
workspace-sync          force tree → disk compile (auto-fires on writes)
workspace-run           run npm / npx / node / git in the workspace
workspace-test          node --test with runner detection

# reading TreeOS itself
source-read             read a file from /.source (real installed code)
source-list             list files in a .source subdirectory
source-mode             flip write policy: disabled | approve | free

# shipping as an extension
forge-init              create or adopt a project as a forge extension
forge-write-file        write into a forge workspace
forge-validate          local mirror of the Horizon validator
forge-test              run the extension's tests
forge-install-local     stage into land/extensions/ (restart required)
forge-publish-horizon   dry-run or live publish to the registry

# modes (picked by grammar, not by you)
tree:code-plan          imperative: build, refactor, create
tree:code-log           present: small adds, one-off edits
tree:code-coach         future: guidance, diagnosis, debugging
tree:code-ask           query: read-only exploration
tree:code-review        past: audit + refine loop with .source references`}</pre>
        </div>
      </section>

      {/* ── THE LOOP IN THREE DIRECTIONS ── */}
      <section className="lp-section" style={{background: "rgba(255,255,255,0.02)"}}>
        <div className="lp-container" style={{maxWidth: 860}}>
          <h2 className="lp-section-title" style={{textAlign: "center"}}>
            The loop closes in three directions.
          </h2>
          <p className="lp-section-desc" style={{textAlign: "center", margin: "0 auto 32px"}}>
            This isn't a coding assistant. It's the mechanism TreeOS uses to grow itself
            and share growth across a network of federated lands.
          </p>

          <div style={{display: "grid", gap: 24, maxWidth: 780, margin: "0 auto"}}>

            {/* Inside out */}
            <div style={{display: "flex", gap: 22, alignItems: "flex-start"}}>
              <div style={{
                flexShrink: 0, width: 48, height: 48, borderRadius: "50%",
                background: "rgba(249, 115, 22, 0.1)", border: "1px solid rgba(249, 115, 22, 0.3)",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: "1.3rem",
              }}>↗</div>
              <div>
                <h3 style={{color: "#e5e5e5", fontSize: "1.05rem", marginBottom: 6}}>
                  Inside out — users build apps from inside the tree
                </h3>
                <p style={{color: "#999", fontSize: "0.88rem", lineHeight: 1.7}}>
                  You say "build me a Tinder app" and the tree writes it. You say "review it"
                  and the tree reads its own files and compares against real working extensions.
                  You say "ship it" and forge stages the output as a real TreeOS extension on the
                  land you're standing on. No IDE. No deploy pipeline. The tree is the environment
                  and the environment is the deploy.
                </p>
              </div>
            </div>

            {/* Outside in */}
            <div style={{display: "flex", gap: 22, alignItems: "flex-start"}}>
              <div style={{
                flexShrink: 0, width: 48, height: 48, borderRadius: "50%",
                background: "rgba(34, 211, 238, 0.1)", border: "1px solid rgba(34, 211, 238, 0.3)",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: "1.3rem",
              }}>↙</div>
              <div>
                <h3 style={{color: "#e5e5e5", fontSize: "1.05rem", marginBottom: 6}}>
                  Outside in — TreeOS builds itself
                </h3>
                <p style={{color: "#999", fontSize: "0.88rem", lineHeight: 1.7}}>
                  The same mechanism that writes user projects writes TreeOS itself. gap-detection
                  hooks notice missing capabilities from how people use the system. evolve proposes
                  specs. The AI reads <code>.source</code> to understand existing patterns, writes a new
                  extension that fits those patterns, and proposes the change through the
                  <code> approve</code> extension so an operator green-lights each edit. TreeOS grows
                  through conversation, gated by humans, measured against its own codebase.
                </p>
              </div>
            </div>

            {/* Across lands */}
            <div style={{display: "flex", gap: 22, alignItems: "flex-start"}}>
              <div style={{
                flexShrink: 0, width: 48, height: 48, borderRadius: "50%",
                background: "rgba(167, 139, 250, 0.1)", border: "1px solid rgba(167, 139, 250, 0.3)",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: "1.3rem",
              }}>⇄</div>
              <div>
                <h3 style={{color: "#e5e5e5", fontSize: "1.05rem", marginBottom: 6}}>
                  Across lands — shared evolution over the federation
                </h3>
                <p style={{color: "#999", fontSize: "0.88rem", lineHeight: 1.7}}>
                  When a land builds something useful, it publishes to Horizon. Other lands install
                  it. When you ask for "a finance tool" and your land doesn't have one, mycelium
                  routes the request to a peer land that does. Every land runs its own AI on its
                  own hardware with its own data, but the extensions that shape the AI's behavior
                  flow over the network. A hundred lands sharing evolutionary pressure on the same
                  open-source kernel. The forest grows in all directions at once.
                </p>
              </div>
            </div>

          </div>

          <p style={{color: "rgba(255,255,255,0.5)", fontSize: "0.85rem", textAlign: "center", marginTop: 32, maxWidth: 640, margin: "32px auto 0", lineHeight: 1.7}}>
            A snake eating its own tail, with the tail connected to every other snake in the network.
            Each land is sovereign; each land is connected; each land helps the others learn to code.
          </p>
        </div>
      </section>

      {/* ── CLOSING ── */}
      <section className="lp-section">
        <div className="lp-container" style={{maxWidth: 640, textAlign: "center"}}>
          <h2 className="lp-section-title">The system writes itself.</h2>
          <p style={{color: "#999", fontSize: "0.95rem", lineHeight: 1.8, marginBottom: 28}}>
            You ask for a todo app, it builds a todo app. You ask for a TreeOS extension, it reads
            fitness as a template and writes one that actually loads. You ask for a review, it opens
            your files and real working extensions side by side and tells you which of your
            assumptions don't match the codebase next door. You ask it to ship, and forge installs
            what you built into the land you're standing on.
          </p>
          <p style={{color: "#999", fontSize: "0.95rem", lineHeight: 1.8, marginBottom: 36}}>
            This is what a self-hosted AI development environment looks like when the environment
            is built as a tree, the AI is navigating that tree, and the tree is reading its own source.
          </p>
          <div className="lp-hero-ctas">
            <a className="lp-btn lp-btn-primary" href="/lands">Start a land</a>
            <a className="lp-btn lp-btn-secondary" href="/ai">How the grammar works</a>
            <a className="lp-btn lp-btn-secondary" href="/kernel">Inside the seed</a>
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
              <a href="/code">Code</a>
              <a href="/governing">Governing</a>
              <a href="/extensions">Extensions</a>
              <a href="/build">Build</a>
            </div>
            <div className="lp-footer-col">
              <h4>TreeOS</h4>
              <a href="/treeos">Overview</a>
              <a href="/lands">Start a Land</a>
              <a href="/cli">CLI</a>
            </div>
            <div className="lp-footer-col">
              <h4>Community</h4>
              <a href="https://horizon.treeos.ai">Horizon</a>
              <a href="/blog">Blog</a>
            </div>
          </div>
          <div style={{textAlign: "center", color: "rgba(255,255,255,0.3)", fontSize: "0.75rem", marginTop: 32}}>
            TreeOS · AGPL-3.0 · treeos.ai
          </div>
        </div>
      </footer>

    </div>
  );
};

export default CodePage;
