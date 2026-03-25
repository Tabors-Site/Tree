import "./LandingPage.css";

const CascadePage = () => {
  return (
    <div className="lp">

      {/* ── HERO ── */}
      <section className="lp-hero">
        <div className="lp-hero-inner">
          <div className="lp-tree-icon">💧</div>
          <h1 className="lp-title">Cascade</h1>
          <p className="lp-subtitle">How the Tree Communicates</p>
          <p className="lp-tagline">
            Structure without communication is a filing cabinet. Intelligence without
            communication is a chatbot. Cascade is the fourth primitive. It makes
            signals visible, results permanent, and the tree alive.
          </p>
          <div className="lp-hero-ctas">
            <a className="lp-btn lp-btn-secondary" href="/seed">The Seed</a>
            <a className="lp-btn lp-btn-secondary" href="/ai">The AI</a>
            <a className="lp-btn lp-btn-secondary" href="/extensions">Extensions</a>
            <a className="lp-btn lp-btn-secondary" href="/network">The Network</a>
          </div>
        </div>
      </section>

      {/* ── WHY COMMUNICATION ── */}
      <section className="lp-section">
        <div className="lp-container">
          <h2 className="lp-section-title">The Fourth Primitive</h2>
          <p className="lp-section-sub lp-section-sub-wide">
            The seed has four primitives. Structure (two schemas). Intelligence (the conversation
            loop). Extensibility (hooks, registries, loader). And communication.
          </p>
          <p className="lp-section-sub lp-section-sub-wide">
            The first three existed for months before cascade. Trees could hold data, AI could
            think at any position, extensions could add capabilities. But nothing could move
            between nodes. A note written at one position was invisible to every other position.
            The tree was a collection of isolated conversations.
          </p>
          <p className="lp-section-sub lp-section-sub-wide">
            Cascade adds communication. When content is written at a node marked for cascade,
            the kernel announces it. Extensions propagate the signal to children, siblings,
            parents, or across lands. Every signal produces a visible result written to .flow.
            The tree becomes a nervous system.
          </p>
        </div>
      </section>

      {/* ── SEVEN ADDITIONS ── */}
      <section className="lp-section lp-section-alt">
        <div className="lp-container">
          <h2 className="lp-section-title">Seven Kernel Additions</h2>
          <p className="lp-section-sub lp-section-sub-wide">
            Cascade adds seven things to the kernel. The Node and User schemas stay unchanged.
            The metadata Map handles everything.
          </p>
          <div className="lp-steps">
            <div className="lp-step">
              <div className="lp-step-num" style={{background: "#4ade80", color: "#000"}}>1</div>
              <div className="lp-step-content">
                <h4>checkCascade</h4>
                <p>
                  Kernel-internal. Called automatically on note creates, edits, deletes, and status
                  changes. Checks two booleans: does this node have <code>metadata.cascade.enabled</code>?
                  Is <code>cascadeEnabled</code> true in .config? If both yes, fires <code>onCascade</code>.
                  The seed originates signals.
                </p>
              </div>
            </div>
            <div className="lp-step">
              <div className="lp-step-num" style={{background: "#60a5fa", color: "#000"}}>2</div>
              <div className="lp-step-content">
                <h4>deliverCascade</h4>
                <p>
                  Extension-external. Called by extensions that propagate signals to other nodes,
                  children, siblings, or remote lands via Canopy. The kernel never blocks inbound.
                  Always accepts. Always writes a result. Extensions deliver signals. The seed
                  guarantees arrival.
                </p>
              </div>
            </div>
            <div className="lp-step">
              <div className="lp-step-num" style={{background: "#a78bfa", color: "#000"}}>3</div>
              <div className="lp-step-content">
                <h4>onCascade hook</h4>
                <p>
                  A sequential hook. Extensions register handlers. When a cascade event fires,
                  each handler runs in order. The return value becomes the result written to .flow.
                  Multiple extensions can react to the same signal. Each gets its own result entry.
                </p>
              </div>
            </div>
            <div className="lp-step">
              <div className="lp-step-num" style={{background: "#f97316", color: "#000"}}>4</div>
              <div className="lp-step-content">
                <h4>.flow system node</h4>
                <p>
                  Results stored in daily partition nodes under .flow. Each day gets its own
                  child node (YYYY-MM-DD). <code>flowMaxResultsPerDay</code> caps growth per partition
                  with circular overwrite. Retention deletes entire partitions older than{" "}
                  <code>resultTTL</code> (default 7 days). The land's short-term memory.
                </p>
              </div>
            </div>
            <div className="lp-step">
              <div className="lp-step-num" style={{background: "#f87171", color: "#000"}}>5</div>
              <div className="lp-step-content">
                <h4>metadata.cascade</h4>
                <p>
                  Per-node configuration. <code>enabled: true</code> marks the node for cascade.
                  <code> propagate: "children" | "subtree" | "none"</code> controls direction.
                  Set once per node, not per note. Same pattern as metadata.tools and metadata.modes.
                </p>
              </div>
            </div>
            <div className="lp-step">
              <div className="lp-step-num" style={{background: "#fbbf24", color: "#000"}}>6</div>
              <div className="lp-step-content">
                <h4>Result shape</h4>
                <p>
                  Every signal produces a result: <code>{"{ status, source, payload, timestamp, signalId, extName }"}</code>.
                  Six statuses. None terminal. They are labels on what happened, not permissions
                  for what can happen next.
                </p>
              </div>
            </div>
            <div className="lp-step">
              <div className="lp-step-num" style={{background: "#94a3b8", color: "#000"}}>7</div>
              <div className="lp-step-content">
                <h4>Never block inbound</h4>
                <p>
                  The guarantee. When a signal arrives at a node, the kernel always accepts it.
                  Always writes a result. No configuration can prevent arrival. This is a right,
                  not a setting. It cannot be turned off.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── TWO ENTRY POINTS ── */}
      <section className="lp-section">
        <div className="lp-container">
          <h2 className="lp-section-title">Two Entry Points</h2>
          <p className="lp-section-sub lp-section-sub-wide">
            The kernel only calls <code>checkCascade</code>. Extensions call <code>deliverCascade</code>.
            The first is automatic on content writes. The second is explicit propagation.
            The seed originates. Extensions deliver.
          </p>
          <div className="lp-cards-3" style={{gridTemplateColumns: "1fr 1fr"}}>
            <div className="lp-card">
              <h3 style={{color: "#4ade80"}}>checkCascade (kernel)</h3>
              <div style={{background: "rgba(0,0,0,0.3)", borderRadius: 8, padding: "12px 16px", marginTop: 12, fontSize: "0.8rem", color: "#999", fontFamily: "monospace", lineHeight: 1.7}}>
                User writes a note at a node<br/>
                Kernel checks: cascade enabled here?<br/>
                Kernel checks: cascadeEnabled in .config?<br/>
                Both true: fire onCascade hook<br/>
                <span style={{color: "#4ade80"}}>Signal originates locally</span>
              </div>
            </div>
            <div className="lp-card">
              <h3 style={{color: "#60a5fa"}}>deliverCascade (extension)</h3>
              <div style={{background: "rgba(0,0,0,0.3)", borderRadius: 8, padding: "12px 16px", marginTop: 12, fontSize: "0.8rem", color: "#999", fontFamily: "monospace", lineHeight: 1.7}}>
                Extension receives onCascade result<br/>
                Decides to propagate to children<br/>
                Calls core.cascade.deliverCascade()<br/>
                Kernel accepts, writes to .flow<br/>
                <span style={{color: "#60a5fa"}}>Signal arrives at destination</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── SIX STATUSES ── */}
      <section className="lp-section lp-section-alt">
        <div className="lp-container">
          <h2 className="lp-section-title">Six Statuses</h2>
          <p className="lp-section-sub lp-section-sub-wide">
            None terminal. None lock the channel. Failed can be retried. Awaiting means a
            response is expected. The system never declares something permanently dead.
          </p>
          <div style={{maxWidth: 500, margin: "0 auto"}}>
            {[
              ["succeeded", "#4ade80", "The handler processed the signal successfully."],
              ["failed", "#f87171", "The handler encountered an error. Can be retried."],
              ["rejected", "#fbbf24", "The handler intentionally declined the signal."],
              ["queued", "#60a5fa", "The signal is accepted but processing is deferred."],
              ["partial", "#c084fc", "Some handlers succeeded, others did not."],
              ["awaiting", "#94a3b8", "A response is expected. Timeout transitions to failed."],
            ].map(([status, color, desc]) => (
              <div key={status} style={{
                display: "flex", alignItems: "center", gap: 16,
                padding: "12px 0", borderBottom: "1px solid rgba(255,255,255,0.05)",
              }}>
                <code style={{color, fontSize: "0.9rem", minWidth: 100, fontWeight: 600}}>{status}</code>
                <span style={{color: "#888", fontSize: "0.85rem"}}>{desc}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── THE WATER CYCLE ── */}
      <section className="lp-section">
        <div className="lp-container">
          <h2 className="lp-section-title">The Water Cycle</h2>
          <p className="lp-section-sub lp-section-sub-wide">
            The land is the ground. One server, one database, one .flow. All signals on
            that land pass through the same water table. Every signal that moves writes a
            result there. The land can feel its own hydration.
          </p>

          {/* ── DIAGRAM ── */}
          <div style={{maxWidth: 700, margin: "0 auto 48px"}}>
            <img src="/diagram-flow.svg" alt="Two lands with trees growing from them, connected by canopy above and .flow below. The sky is the directory. Roots pull from the water table. The AI at each node is photosynthesis." style={{width: "100%", height: "auto"}} />
          </div>

          <div className="lp-cards-3" style={{gridTemplateColumns: "1fr 1fr"}}>
            <div className="lp-card">
              <h3 style={{color: "#4ade80"}}>Trees are root systems</h3>
              <p>
                Each tree grows from the land root into its own hierarchy of branches and
                leaves. Different trees pull from the same water table but they pull different
                things because their filters say what they are thirsty for. A music tree
                does not drink fitness data. A work tree does not drink dream cycles.
                Same water table, selective roots.
              </p>
            </div>
            <div className="lp-card">
              <h3 style={{color: "#60a5fa"}}>Nodes are positions</h3>
              <p>
                A leaf node deep in a branch only receives what flows to its position.
                A node near the trunk sees more. The root of the tree sees everything that
                tree pulled in. Each position has its own thirst, its own filters, its own
                cascade configuration saying what it wants and what it ignores.
              </p>
            </div>
          </div>

          <div style={{maxWidth: 700, margin: "32px auto 0"}}>
            <h3 style={{color: "#fbbf24", textAlign: "center", marginBottom: 16}}>Photosynthesis</h3>
            <p className="lp-section-sub lp-section-sub-wide">
              Water is raw data. Sunlight is context arriving from the network through Canopy.
              Photosynthesis is the conversation loop. The AI at each node takes raw signal
              in and converts it into structure: notes, nodes, understanding, codebooks. New growth.
            </p>
            <p className="lp-section-sub lp-section-sub-wide" style={{color: "#888"}}>
              This is what makes it more than a network. A packet that enters a router exits
              the same packet. A signal that enters a tree node exits as something new. The AI
              transforms it. The tree grows from it.
            </p>
          </div>

          <div className="lp-cards-3" style={{gridTemplateColumns: "1fr 1fr 1fr", marginTop: 32}}>
            <div className="lp-card lp-card-sm">
              <h4 style={{color: "#c084fc"}}>Pooling</h4>
              <p>
                Too many signals arrive and .flow fills up. Daily partitions cap at{" "}
                <code>flowMaxResultsPerDay</code>. Oldest results cycle out. <code>resultTTL</code> drains
                expired partitions entirely. The water table stays manageable.
              </p>
            </div>
            <div className="lp-card lp-card-sm">
              <h4 style={{color: "#f87171"}}>Flooding</h4>
              <p>
                Signals arrive faster than extensions can process them. Safety limits kick in.
                <code> cascadeMaxDepth</code> stops infinite chains. Hook timeout kills hanging
                handlers. Circuit breaker disables failing extensions. The tree survives
                the flood because the kernel protects the ground.
              </p>
            </div>
            <div className="lp-card lp-card-sm">
              <h4 style={{color: "#94a3b8"}}>Drought</h4>
              <p>
                A land goes quiet. No signals come in. .flow empties. The trees go dormant.
                Nothing dies. The structure holds. The nodes still have their metadata. The
                codebooks still sit in the Map. And when a signal arrives again, even years
                later, the kernel accepts it. Never block inbound. The roots pull again.
              </p>
            </div>
          </div>

          <div style={{maxWidth: 700, margin: "32px auto 0"}}>
            <h3 style={{color: "#4ade80", textAlign: "center", marginBottom: 16}}>The Full Cycle</h3>
            <p className="lp-section-sub lp-section-sub-wide">
              A tree produces output. The output cascades up to root. Root connects to Canopy.
              Canopy carries it to another land. That land's .flow receives it. That land's trees
              pull what their filters accept. The signal flows down to the nodes that are thirsty
              for it. The AI at those nodes wakes up, photosynthesizes, produces new structure.
              And that new structure might cascade back up, out through Canopy, to another land.
              The water cycle.
            </p>
          </div>
        </div>
      </section>

      {/* ── WHAT CASCADE ENABLES ── */}
      <section className="lp-section lp-section-alt">
        <div className="lp-container">
          <h2 className="lp-section-title">What Cascade Enables</h2>
          <p className="lp-section-sub lp-section-sub-wide">
            The kernel adds seven things. Extensions build everything else.
            Every feature below is an extension built on <code>onCascade</code> and{" "}
            <code>deliverCascade</code>. Remove the extension and the feature disappears.
            The kernel doesn't care.
          </p>
          <div className="lp-cards-3" style={{gridTemplateColumns: "1fr 1fr 1fr"}}>
            <div className="lp-card lp-card-sm">
              <h4>Propagation</h4>
              <p>Cascade signals flow from parent to children, across branches, through subtrees. The topology determines the path. The extension walks the tree and delivers.</p>
            </div>
            <div className="lp-card lp-card-sm">
              <h4>Perspective Filter</h4>
              <p>Not all signals are relevant everywhere. A filter extension decides which signals pass based on node type, depth, content relevance, or custom rules. Scoping without blocking.</p>
            </div>
            <div className="lp-card lp-card-sm">
              <h4>Codebook</h4>
              <p>Two nodes that communicate repeatedly build a shared language. A codebook extension tracks recurring patterns and distills them into a compression map. Each exchange gets faster because the symbols carry more meaning.</p>
            </div>
            <div className="lp-card lp-card-sm">
              <h4>Channels</h4>
              <p>Named signal paths between nodes. Instead of broadcasting to all children, a channel extension routes signals to specific destinations. Pub/sub within the tree.</p>
            </div>
            <div className="lp-card lp-card-sm">
              <h4>Bridge Lands</h4>
              <p>Cascade across the network. A bridge extension delivers signals from one land to another through Canopy. Two lands share knowledge through their trees without merging.</p>
            </div>
            <div className="lp-card lp-card-sm">
              <h4>Brain Lands</h4>
              <p>A land that exists to think. It receives cascade signals from other lands, processes them through its own AI, and sends results back. Distributed intelligence as a service.</p>
            </div>
            <div className="lp-card lp-card-sm">
              <h4>Gap Detection</h4>
              <p>When cascade signals reveal missing knowledge, a gap detection extension identifies what the tree doesn't know. It creates tasks, flags areas for research, surfaces blind spots.</p>
            </div>
            <div className="lp-card lp-card-sm">
              <h4>Pulse</h4>
              <p>Real-time health monitoring through cascade. A pulse extension reads signal flow rates, result statuses, and propagation depths. The tree's vital signs, visible in .flow.</p>
            </div>
            <div className="lp-card lp-card-sm">
              <h4>Seed Export</h4>
              <p>Package a tree's cascade history and structure for transplanting. Another land imports the seed and grows a replica. Knowledge transfer through signal replay.</p>
            </div>
          </div>
        </div>
      </section>

      {/* ── PHILOSOPHY ── */}
      <section className="lp-section" style={{paddingBottom: 60}}>
        <div className="lp-container" style={{textAlign: "center"}}>
          <h2 className="lp-section-title">Why Communication Was Last</h2>
          <p className="lp-section-sub lp-section-sub-wide">
            Structure came first because without nodes, there is nothing to connect.
            Intelligence came second because without the AI loop, nothing thinks.
            Extensibility came third because without hooks and registries, nothing grows.
            Communication came last because it needs all three to exist before it makes sense.
          </p>
          <p className="lp-section-sub lp-section-sub-wide" style={{color: "#666"}}>
            You can't route signals through a tree that doesn't exist.
            You can't process signals without intelligence at each node.
            You can't build propagation without an extension system.
            Cascade is the capstone. It turns a structured, intelligent, extensible tree
            into something that breathes.
          </p>
          <div style={{marginTop: 32}}>
            <a className="lp-btn lp-btn-secondary" href="/seed">Back to the Seed</a>
          </div>
        </div>
      </section>
    </div>
  );
};

export default CascadePage;
