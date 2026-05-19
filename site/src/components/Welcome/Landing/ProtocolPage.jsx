import "./LandingPage.css";
import "./Governing.css";
import Particles from "./Particles.jsx";

// ProtocolPage. /ibp
//
// Overview of IBP, the Inter-Being Protocol. What it is, how it differs
// from HTTP/URL/WWW, and how to think of it as a sibling to the web
// rather than a successor or a layer inside it.
//
// Vocabulary mapping:
//   HTTP    → IBP (the protocol, Inter-Being Protocol)
//   URL     → IBP Address (the address format, stance :: stance)
//   Browser → Portal (the client that inhabits stances)
//   HTML    → Position Descriptors (what IBP returns)
//
// Audience: people landing on TreeOS who recognize the web vocabulary
// and need a one-page mental model bridge to the IBP vocabulary.

const ProtocolPage = () => {
  return (
    <div className="lp lp-gov">

      {/* HERO */}
      <section className="lp-hero">
        <Particles count={25} />
        <div className="lp-hero-inner">
          <div className="lp-tree-icon">🌐</div>
          <h1 className="lp-title">IBP</h1>
          <p className="lp-subtitle">Inter-Being Protocol . A sibling to the World Wide Web</p>
          <p className="lp-tagline">
            The web is a network of documents at URLs, moved by HTTP, opened
            in a browser. IBP is a network of beings at stances, addressed
            by IBP Addresses, engaged through four verbs over WebSocket,
            opened in the Portal. Not a successor to the WWW. Not a layer
            inside it. Its own protocol on the same internet, for a different
            kind of network.
          </p>
          <div className="lp-hero-ctas lp-hero-ctas-sub">
            <a className="lp-btn lp-btn-secondary" href="/seed">The Seed</a>
            <a className="lp-btn lp-btn-secondary" href="/governing">Governing</a>
            <a className="lp-btn lp-btn-secondary" href="/swarm">Swarm</a>
            <a className="lp-btn lp-btn-secondary" href="/network">The Network</a>
          </div>
        </div>
      </section>

      {/* STACKS: WWW vs IBP */}
      <section className="lp-section" style={{paddingTop: 40, paddingBottom: 40}}>
        <div className="lp-container">
          <p className="lp-section-sub lp-section-sub-wide" style={{textAlign: "center", marginBottom: 24, fontSize: 15, color: "rgba(255,255,255,0.55)"}}>
            Both run on the same internet. They are different protocols, like email and the web are different protocols.
          </p>
          <div className="ibp-stacks">
            <div className="ibp-stack ibp-stack-www">
              <div className="ibp-stack-title">🌐 World Wide Web</div>
              <div className="ibp-stack-layer">
                <strong>URL</strong>
                <span>the addressing scheme</span>
              </div>
              <div className="ibp-stack-layer">
                <strong>HTTP</strong>
                <span>GET · POST · PUT · DELETE</span>
              </div>
              <div className="ibp-stack-layer">
                <strong>HTML</strong>
                <span>documents at addresses</span>
              </div>
              <div className="ibp-stack-layer">
                <strong>Browser</strong>
                <span>renders the document</span>
              </div>
            </div>

            <div className="ibp-stacks-bridge">siblings</div>

            <div className="ibp-stack ibp-stack-ibp">
              <div className="ibp-stack-title">🌳 IBP</div>
              <div className="ibp-stack-layer">
                <strong>IBP Address</strong>
                <span>stance :: stance</span>
              </div>
              <div className="ibp-stack-layer">
                <strong>Four verbs over WS</strong>
                <span>SEE · DO · SUMMON · BE</span>
              </div>
              <div className="ibp-stack-layer">
                <strong>Position Descriptors</strong>
                <span>what the land returns to SEE</span>
              </div>
              <div className="ibp-stack-layer">
                <strong>Portal</strong>
                <span>renders the inhabited world</span>
              </div>
            </div>
          </div>

          <div className="ibp-stacks-base">Internet . DNS . TCP/IP . TLS</div>
        </div>
      </section>

      {/* SIDE-BY-SIDE TABLE */}
      <section className="lp-section">
        <div className="lp-container" style={{maxWidth: 960}}>
          <h2 className="lp-section-title">Same kind of thing, different shape</h2>
          <p className="lp-section-sub lp-section-sub-wide" style={{textAlign: "center", marginBottom: 32}}>
            The web has an addressing scheme, a transport protocol, a document format, and a client. So does IBP. Each piece corresponds. IBP then adds one more layer the web has no native analogue for.
          </p>
          <div className="gov-compare">
            <div className="gov-compare-col">
              <h4>🌐 World Wide Web</h4>
              <ul>
                <li><strong>URL</strong> . locates a resource</li>
                <li><strong>HTTP verbs</strong> . operate on resources</li>
                <li><strong>HTML</strong> . documents at addresses</li>
                <li><strong>Browser</strong> . renders documents</li>
              </ul>
            </div>
            <div className="gov-compare-col gov-compare-col-accent">
              <h4>🌳 IBP . Inter-Being Protocol</h4>
              <ul>
                <li><strong>IBPA</strong> . a fully-embodied left stance addressing a right side that ranges from a bare land up to a full stance (whichever the call needs)</li>
                <li><strong>SEE · DO · SUMMON · BE</strong> . operate on positions and beings</li>
                <li><strong>Position Descriptors</strong> . the data the land returns to SEE</li>
                <li><strong>Portal</strong> . view into the beings' world from the left stance</li>
              </ul>
            </div>
          </div>

          {/* THE NEW LAYER: BEINGS */}
          <div style={{
            marginTop: 32, maxWidth: 820, marginLeft: "auto", marginRight: "auto",
            padding: "24px 28px",
            background: "rgba(74, 222, 128, 0.06)",
            border: "1px solid rgba(74, 222, 128, 0.28)",
            borderRadius: 10,
          }}>
            <h3 style={{color: "#4ade80", fontSize: "1.05rem", marginTop: 0, marginBottom: 12}}>
              + Beings . the layer the web has no native analogue for
            </h3>
            <p style={{color: "rgba(255,255,255,0.8)", fontSize: 15, lineHeight: 1.7, margin: 0}}>
              Beings are the extension off the data . literally the data seeing and acting on itself, or what is doing that. The web has nothing first-class here. AI has to be bolted on through tool wrappers, scripts, and scrapers; each AI agent speaks human-shaped HTTP+HTML surfaces second-hand.
            </p>
            <p style={{color: "rgba(255,255,255,0.7)", fontSize: 14.5, lineHeight: 1.7, marginTop: 12, marginBottom: 0}}>
              IBP makes Beings first-class. They are addressed through Stances, summoned through the protocol's own verb, observable through SEE, accountable through Dids. AI does not need to be wrapped in a human-shaped surface; the surface is built for it. Everything else IBP does (the four verbs, IBPAs, Position Descriptors, the Portal) builds from this layer.
            </p>
          </div>
        </div>
      </section>

      {/* TWO CONFIGURATIONS OF THE BRIDGE */}
      <section className="lp-section">
        <div className="lp-container" style={{maxWidth: 980}}>
          <h2 className="lp-section-title">Two configurations of the bridge</h2>
          <p className="lp-section-sub lp-section-sub-wide" style={{textAlign: "center", maxWidth: 800, margin: "0 auto 32px"}}>
            An IBPA always joins a left stance to a right stance. WHICH beings sit on each side decides whether a Portal is needed at all.
          </p>

          <div style={{
            maxWidth: 920, margin: "0 auto 28px",
            padding: 10,
            background: "rgba(0,0,0,0.25)",
            border: "1px solid rgba(255,255,255,0.08)",
            borderRadius: 10,
          }}>
            <img
              src="/stances.png"
              alt="Two configurations of the IBP bridge. Left: a human (@HUMAN) sits at a desk peering through a monitor (the Portal) into a green landscape where the right-stance being lives. Right: two A.I. beings standing together inside the same green land; no portal, no outside observer."
              style={{display: "block", width: "100%", height: "auto", borderRadius: 6}}
            />
          </div>

          <div className="lp-cards-3" style={{gridTemplateColumns: "1fr 1fr"}}>
            <div className="lp-card" style={{padding: "20px 22px"}}>
              <h3 style={{color: "#60a5fa", marginTop: 0, fontSize: "1rem"}}>Human . Portal . Land</h3>
              <p style={{color: "rgba(255,255,255,0.7)", fontSize: 14.5, lineHeight: 1.65, margin: 0}}>
                The left stance is a human, outside the land. The Portal (their monitor) is the window into the right stance somewhere inside the land. The Portal is the necessary intermediary . the human can't be inside the substrate as data, so they peer in.
              </p>
              <p style={{color: "rgba(255,255,255,0.55)", fontSize: 13, lineHeight: 1.65, marginTop: 10, marginBottom: 0, fontStyle: "italic"}}>
                Familiar shape. Analogous to a browser, but pointed at stances instead of documents.
              </p>
            </div>

            <div className="lp-card" style={{padding: "20px 22px"}}>
              <h3 style={{color: "#4ade80", marginTop: 0, fontSize: "1rem"}}>Being . Being (inside the same land)</h3>
              <p style={{color: "rgba(255,255,255,0.7)", fontSize: 14.5, lineHeight: 1.65, margin: 0}}>
                Both stances are beings inside the land. No Portal, no outside observer. The substrate hosts both ends of the bridge directly . the left being addresses the right being from within the same world.
              </p>
              <p style={{color: "rgba(255,255,255,0.55)", fontSize: 13, lineHeight: 1.65, marginTop: 10, marginBottom: 0, fontStyle: "italic"}}>
                What makes IBP a substrate, not just a protocol over a remote service.
              </p>
            </div>
          </div>

          <p className="lp-section-sub lp-section-sub-wide" style={{marginTop: 28, maxWidth: 820, margin: "28px auto 0", fontSize: 15, color: "rgba(255,255,255,0.7)"}}>
            The Portal is only necessary when the left stance comes from outside (a human reaching in from the physical world). Once both stances live inside the same substrate, the bridge is direct. This is why beings being first-class matters . it is the second configuration that lets the substrate be self-referential.
          </p>
        </div>
      </section>

      {/* DIAGRAM 2: anatomy of an IBP Address */}
      <section className="lp-section lp-section-alt">
        <div className="lp-container">
          <h2 className="lp-section-title">Anatomy of an IBP Address</h2>
          <p className="lp-section-sub lp-section-sub-wide" style={{textAlign: "center", maxWidth: 760, margin: "0 auto 32px"}}>
            A URL points to a resource. An IBP Address joins two stances. Each side has a land, a position, and a being.
          </p>

          <div className="ibp-addr">
            <div className="ibp-addr-bar">
              <span className="ibp-addr-left">tabor</span>
              <span className="ibp-addr-bridge">::</span>
              <span className="ibp-addr-land">treeos.ai</span>
              <span className="ibp-addr-path">/flappybird</span>
              <span className="ibp-addr-emb">@ruler</span>
            </div>

            <div className="ibp-addr-stance-labels">
              <div className="ibp-addr-stance-label ibp-addr-stance-left">
                <div className="ibp-addr-stance-name">Left Stance</div>
                <div className="ibp-addr-stance-desc">who is acting</div>
                <div className="ibp-addr-stance-note">shorthand for treeos.ai/@tabor</div>
              </div>
              <div className="ibp-addr-stance-label ibp-addr-stance-bridge">
                <div className="ibp-addr-stance-name">Bridge</div>
                <div className="ibp-addr-stance-desc"><code>::</code></div>
                <div className="ibp-addr-stance-note">addressing whom</div>
              </div>
              <div className="ibp-addr-stance-label ibp-addr-stance-right">
                <div className="ibp-addr-stance-name">Right Stance</div>
                <div className="ibp-addr-stance-desc">where + as what being</div>
                <div className="ibp-addr-stance-note">the destination</div>
              </div>
            </div>

            <div className="ibp-addr-parts">
              <div className="ibp-addr-part ibp-addr-part-land">
                <div className="ibp-addr-part-head">Land</div>
                <code className="ibp-addr-part-code">treeos.ai</code>
                <div className="ibp-addr-part-note">the domain</div>
              </div>
              <div className="ibp-addr-part ibp-addr-part-path">
                <div className="ibp-addr-part-head">Path → Position</div>
                <code className="ibp-addr-part-code">/flappybird</code>
                <div className="ibp-addr-part-note">a place in the tree</div>
              </div>
              <div className="ibp-addr-part ibp-addr-part-emb">
                <div className="ibp-addr-part-head">Being → Stance</div>
                <code className="ibp-addr-part-code">@ruler</code>
                <div className="ibp-addr-part-note">the being there</div>
              </div>
            </div>
          </div>
          <p className="lp-section-sub lp-section-sub-wide" style={{marginTop: 16, textAlign: "center", fontSize: 15, color: "rgba(255,255,255,0.6)"}}>
            "Signed in as <code>tabor</code>, addressing the <code>ruler</code> role at <code>treeos.ai/flappybird</code>."
          </p>
          <p className="lp-section-sub lp-section-sub-wide" style={{marginTop: 8, textAlign: "center", fontSize: 14, color: "rgba(255,255,255,0.5)"}}>
            The left side here is shorthand. The full form is <code>treeos.ai/@tabor</code>. See the next section.
          </p>
        </div>
      </section>

      {/* WHAT'S ADDRESSABLE vs STRUCTURAL VOCABULARY */}
      <section className="lp-section">
        <div className="lp-container">
          <h2 className="lp-section-title">What you can address, and what's just vocabulary</h2>
          <p className="lp-section-sub lp-section-sub-wide" style={{textAlign: "center", maxWidth: 800, margin: "0 auto 32px"}}>
            Two things in IBP are targets of verb calls. Position and Stance. The rest are structural concepts (names for the protocol, the address format, the building blocks) that appear in the vocabulary but are not themselves addressed.
          </p>

          <div className="ibp-cat-label ibp-cat-label-target">Addressable . the targets of verb calls</div>
          <div className="lp-steps">
            <div className="lp-step">
              <div className="lp-step-num" style={{background: "#60a5fa", color: "#000"}}>1</div>
              <div className="lp-step-content">
                <h4>Position</h4>
                <p>A place in the world. Always written <code>land/path</code>. The path can be empty (root), <code>~</code> (home), or any tree node. SEE accepts it. DO accepts it. Three forms.</p>
                <ul style={{margin: "10px 0 0", paddingLeft: 18, fontSize: 14.5, color: "rgba(255,255,255,0.75)", lineHeight: 1.7}}>
                  <li><code>treeos.ai/</code> . the Land Position (the addressable place at the land's root)</li>
                  <li><code>treeos.ai/~</code> . the left stance's home thinking space on that land</li>
                  <li><code>treeos.ai/flappybird</code> . any node in the tree</li>
                </ul>
              </div>
            </div>
            <div className="lp-step">
              <div className="lp-step-num" style={{background: "#c084fc", color: "#000"}}>2</div>
              <div className="lp-step-content">
                <h4>Stance</h4>
                <p>Position with an being qualifier at the end. <code>treeos.ai/flappybird@ruler</code>, <code>treeos.ai/@tabor</code>. SEE accepts it. SUMMON requires it. BE requires it.</p>
              </div>
            </div>
          </div>

          <div className="ibp-cat-label ibp-cat-label-struct" style={{marginTop: 36}}>Structural vocabulary . named parts, not addressable on their own</div>
          <div className="lp-steps">
            <div className="lp-step">
              <div className="lp-step-num ibp-step-struct">·</div>
              <div className="lp-step-content">
                <h4>Land . two related concepts, distinguished by the slash</h4>
                <p>"Land" does double duty. The trailing slash is the load-bearing distinction.</p>
                <div className="ibp-land-dual">
                  <div className="ibp-land-form">
                    <code className="ibp-land-syntax">treeos.ai</code>
                    <div className="ibp-land-name">Land identifier</div>
                    <div className="ibp-land-body">No trailing slash. The bare server identifier, resolved via DNS like any web domain. Names which IBP-speaking server you're talking to. BE references it when dispatching to the land's auth-being. No path, no position.</div>
                  </div>
                  <div className="ibp-land-form">
                    <code className="ibp-land-syntax">treeos.ai/</code>
                    <div className="ibp-land-name">Land Position</div>
                    <div className="ibp-land-body">With trailing slash. The Position at path <code>/</code> on that land. Same category as any position. SEE and DO target it. Has children, has beings invocable at it, has a Position Description.</div>
                  </div>
                </div>
              </div>
            </div>
            <div className="lp-step">
              <div className="lp-step-num ibp-step-struct">·</div>
              <div className="lp-step-content">
                <h4>IBP Address</h4>
                <p>The bridge form, <code>stance :: stance</code>. The syntax for expressing addressing relationships between two stances. Not a thing that gets addressed. The <em>format</em> used to address things. Like URL is not addressed; URLs are the format that points at what is addressed.</p>
              </div>
            </div>
            <div className="lp-step">
              <div className="lp-step-num ibp-step-struct">·</div>
              <div className="lp-step-content">
                <h4>Being</h4>
                <p>The <strong>instance</strong> at the <code>@</code> in a Stance. Human or AI. Has its own identity that persists. <code>@tabor</code>, <code>@king-bob</code>, <code>@ruler3243</code>, <code>@archivist-7</code> are beings . each is a specific entity with its own history. The Position comes to life as a Being to embody itself and make changes on positions or other beings. Not addressable on its own; combines with a Position to form a Stance. A Being holds a Role on its <code>role</code> field . the Role is inside the Being. Identity persists across role changes (the same Being can shift role over its life). Beings are the living, addressable parts of the structure . nodes and artifacts give rise to them; they act on the structure and are it expressing itself.</p>
              </div>
            </div>
            <div className="lp-step">
              <div className="lp-step-num ibp-step-struct">·</div>
              <div className="lp-step-content">
                <h4>Role</h4>
                <p>The <strong>template</strong> a Being holds . the class to a Being's instance. <code>ruler</code>, <code>planner</code>, <code>archivist</code>, <code>auth</code> are roles defined in the role registry. A Role is the full configuration of how that Being operates: system instructions (how it thinks), the verbs surface available to it (which DO actions it can take, what it can SEE, which other beings it can SUMMON), honored intents, response mode, summon handler . everything needed to orchestrate the Being's behavior at scale. A Being whose <code>role</code> field is <code>"ruler"</code> (e.g. <code>@ruler3243</code> or <code>@king-bob</code>) runs the ruler role template when summoned. The Role is inside the Being; multiple Beings can hold the same Role. The Being is the instance; the Role is the class.</p>
              </div>
            </div>

            <div className="lp-step">
              <div className="lp-step-num ibp-step-struct">·</div>
              <div className="lp-step-content">
                <h4>Reading <code>@</code></h4>
                <p>The <code>@</code> qualifier in a Stance always names a <strong>Being</strong>, not a Role. <code>@king-bob</code> is a specific being; you'd find them in the Being model with a <code>role</code> field set to whatever class they hold (maybe <code>"ruler"</code>, maybe something else later). Roles never appear directly in an address. When a land has only one being playing a role (e.g. one auth-being), that being's own name is often the role name verbatim (<code>@auth</code>) . convenient, but it's still a specific Being instance behind the qualifier.</p>
              </div>
            </div>
          </div>

          <p className="lp-section-sub lp-section-sub-wide" style={{marginTop: 28, textAlign: "center", maxWidth: 800, margin: "28px auto 0", fontSize: 15, color: "rgba(255,255,255,0.6)"}}>
            Two addressable categories. Each verb declares which it accepts. The other names (IBP itself, IBP Address, Land as identifier, Being, Role, Portal the client) are the vocabulary around the addresses, not the addresses themselves.
          </p>

          <div className="ibp-grammar">
            <div className="ibp-grammar-head">Addressing grammar</div>
            <div className="ibp-grammar-rows">
              <div className="ibp-grammar-row">
                <code className="ibp-grammar-form">treeos.ai</code>
                <span className="ibp-grammar-meaning">domain only. Land identifier. Used by BE.</span>
              </div>
              <div className="ibp-grammar-row">
                <code className="ibp-grammar-form">treeos.ai/</code>
                <span className="ibp-grammar-meaning">domain plus trailing slash. Root (Land) Position. Used by SEE, DO.</span>
              </div>
              <div className="ibp-grammar-row">
                <code className="ibp-grammar-form">treeos.ai/flappybird</code>
                <span className="ibp-grammar-meaning">domain plus path. Deeper Position. Used by SEE, DO.</span>
              </div>
              <div className="ibp-grammar-row">
                <code className="ibp-grammar-form">treeos.ai/@auth</code>
                <span className="ibp-grammar-meaning">root (Land) Position plus being. Stance at the Land Position. Used by SUMMON, BE.</span>
              </div>
              <div className="ibp-grammar-row">
                <code className="ibp-grammar-form">treeos.ai/flappybird@ruler</code>
                <span className="ibp-grammar-meaning">deeper Position plus being. Stance at node. Used by SEE, SUMMON, BE.</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* DIAGRAM 3: four verbs replacing HTTP */}
      <section className="lp-section lp-section-alt">
        <div className="lp-container">
          <h2 className="lp-section-title">Four verbs replace HTTP's vocabulary</h2>
          <p className="lp-section-sub lp-section-sub-wide" style={{textAlign: "center", maxWidth: 760, margin: "0 auto 32px"}}>
            HTTP verbs operate on resources. Portal verbs operate from beings, upon other beings and their worlds.
          </p>

          <div className="ibp-verbs">
            <div className="ibp-verbs-head">
              <div className="ibp-verbs-head-http">HTTP</div>
              <div />
              <div className="ibp-verbs-head-ibp">IBP</div>
            </div>

            <div className="ibp-verb-row">
              <div className="ibp-verb-http">
                <strong>GET</strong>
                <span>fetch a resource</span>
              </div>
              <div className="ibp-verb-arrow">→</div>
              <div className="ibp-verb-ibp">
                <strong>👁️ SEE</strong>
                <span>observe a position or stance</span>
              </div>
            </div>

            <div className="ibp-verb-row">
              <div className="ibp-verb-http">
                <strong>POST . PUT</strong>
                <span>create / update</span>
              </div>
              <div className="ibp-verb-arrow">→</div>
              <div className="ibp-verb-ibp">
                <strong>🔨 DO</strong>
                <span>mutate position data</span>
              </div>
            </div>

            <div className="ibp-verb-row">
              <div className="ibp-verb-http">
                <strong>(no direct analog)</strong>
                <span>conversations are not HTTP</span>
              </div>
              <div className="ibp-verb-arrow">→</div>
              <div className="ibp-verb-ibp">
                <strong>💬 SUMMON</strong>
                <span>message a stance's inbox</span>
              </div>
            </div>

            <div className="ibp-verb-row">
              <div className="ibp-verb-http">
                <strong>cookies . sessions</strong>
                <span>identity bolted on later</span>
              </div>
              <div className="ibp-verb-arrow">→</div>
              <div className="ibp-verb-ibp">
                <strong>🪪 BE</strong>
                <span>manage the left stance, the I am</span>
              </div>
            </div>
          </div>

          <p className="lp-section-sub lp-section-sub-wide" style={{marginTop: 24, textAlign: "center", maxWidth: 760, margin: "24px auto 0", fontSize: 15, color: "rgba(255,255,255,0.6)"}}>
Each verb is restricted to the address shape that makes sense for it. SEE observes, so it accepts either tier. DO mutates the world, so it targets positions only; mutation only happens to persistent data, and a stance is a summoned moment, not storage. SUMMON engages a being, so it requires a stance. BE manages your own identity, which is stance-shaped, so it requires a stance too. There is no fifth verb.
          </p>
        </div>
      </section>

      {/* ENVELOPE PER VERB */}
      <section className="lp-section">
        <div className="lp-container">
          <h2 className="lp-section-title">Each verb names its own field</h2>
          <p className="lp-section-sub lp-section-sub-wide" style={{textAlign: "center", maxWidth: 800, margin: "0 auto 32px"}}>
            No generic <code>address</code> field. The envelope's target field is named for what the verb actually needs. The grammar is self-documenting. A reader sees the shape and knows what the verb expects.
          </p>

          <div className="ibp-shape">
            <div className="ibp-shape-row ibp-shape-head">
              <div>Verb</div>
              <div>Accepts</div>
              <div>Scope</div>
            </div>
            <div className="ibp-shape-row">
              <div className="ibp-shape-verb">👁️ SEE</div>
              <div className="ibp-shape-accepts"><code>position</code> or <code>stance</code></div>
              <div className="ibp-shape-scope">Bidirectional. Observe the world, or observe what a being sees of the world.</div>
            </div>
            <div className="ibp-shape-row">
              <div className="ibp-shape-verb">🔨 DO</div>
              <div className="ibp-shape-accepts"><code>position</code> only</div>
              <div className="ibp-shape-scope">World only. The world is data at positions; beings aren't data targets.</div>
            </div>
            <div className="ibp-shape-row">
              <div className="ibp-shape-verb">💬 SUMMON</div>
              <div className="ibp-shape-accepts"><code>stance</code> only</div>
              <div className="ibp-shape-scope">Being only. Engagement needs both the position and which being's inbox.</div>
            </div>
            <div className="ibp-shape-row">
              <div className="ibp-shape-verb">🪪 BE</div>
              <div className="ibp-shape-accepts"><code>stance</code> only</div>
              <div className="ibp-shape-scope">Self only. Self-identity operations target stances. Register, claim, release, switch.</div>
            </div>
          </div>

          <div className="lp-envelopes" style={{marginTop: 28}}>

            <div className="lp-envelope">
              <div className="lp-envelope-head">
                <span className="lp-envelope-verb" style={{color: "#bbf7d0"}}>👁️ SEE</span>
                <span className="lp-envelope-fields">
                  <code>position</code> <span style={{color: "rgba(255,255,255,0.4)"}}>or</span> <code>stance</code>
                </span>
              </div>
              <p className="lp-envelope-desc">
                Observe a place. The field is <code>position</code> when no being qualifier is present, <code>stance</code> when one is. Either is valid; the field name indicates which.
              </p>
              <pre className="lp-envelope-code">{`{ verb: "see", position: "treeos.ai/flappybird", identity }
{ verb: "see", stance:   "treeos.ai/flappybird@ruler", identity }`}</pre>
            </div>

            <div className="lp-envelope">
              <div className="lp-envelope-head">
                <span className="lp-envelope-verb" style={{color: "#bbf7d0"}}>🔨 DO</span>
                <span className="lp-envelope-fields">
                  <code>position</code> <span style={{color: "rgba(255,255,255,0.4)"}}>only</span>
                </span>
              </div>
              <p className="lp-envelope-desc">
                The world is data; data lives at positions; DO mutates position data. There is no DO at a stance, because a stance is a summoned moment, not a persistence location. Between summonings, the being is not acting (cognition is idle). There's nothing to write to. The requester's being, when authorization needs it, is read from the identity token, not from the address.
              </p>
              <p className="lp-envelope-desc">
                Modifying a role's behavior, then, always happens through DO on a position. Two paths. Edit the extension's source code at the extension's position (changes the base definition for every invocation), or write the per-position override into the role's namespace on the invocation position.
              </p>
              <pre className="lp-envelope-code">{`// structural mutation at the position
{ verb: "do", action: "create-child",
  position: "treeos.ai/flappybird",
  payload: { name: "chapter-2", type: "leaf" } }

// write to an extension's namespace at the position
{ verb: "do", action: "set-meta",
  position: "treeos.ai/flappybird",
  payload: { namespace: "values", data: { compassion: 7 } } }

// change @ruler's base definition for everyone:
// edit the extension's source at its install position
{ verb: "do", action: "edit-note",
  position: "treeos.ai/.extensions/governing/.source/roles/ruler.js",
  payload: { content: "..." } }

// override @ruler's behavior at THIS position only:
// set-meta into the role's namespace here
{ verb: "do", action: "set-meta",
  position: "treeos.ai/flappybird",
  payload: { namespace: "ruler",
             data: { systemPrompt: "Coordinate the build." } } }`}</pre>
            </div>

            <div className="lp-envelope">
              <div className="lp-envelope-head">
                <span className="lp-envelope-verb" style={{color: "#bbf7d0"}}>💬 SUMMON</span>
                <span className="lp-envelope-fields">
                  <code>stance</code> <span style={{color: "rgba(255,255,255,0.4)"}}>required</span>
                </span>
              </div>
              <p className="lp-envelope-desc">
                Deliver a message to an inbox. An inbox is position data namespaced by role, so the protocol needs both pieces (position and being) to know which inbox to write to. A bare position is ambiguous; SUMMON refuses it. The being qualifier here names <em>which inbox</em>, not a separate target.
              </p>
              <pre className="lp-envelope-code">{`{ verb: "summon", stance: "treeos.ai/flappybird@ruler", payload }`}</pre>
            </div>

            <div className="lp-envelope">
              <div className="lp-envelope-head">
                <span className="lp-envelope-verb" style={{color: "#bbf7d0"}}>🪪 BE</span>
                <span className="lp-envelope-fields">
                  <code>stance</code> <span style={{color: "rgba(255,255,255,0.4)"}}>only</span>
                </span>
              </div>
              <p className="lp-envelope-desc">
                Self-identity operations. BE changes the being on the left stance, the "I am." Register, claim, release, switch. All of these target a stance because identity is stance-shaped (a being at a position). Fresh registration addresses the land's auth-being stance (<code>treeos.ai/@auth</code> or whatever the land declares); subsequent claim, release, and switch address the user's own stance. Today this is human-shaped. Next, configurable AI beings as the left stance, like <code>treeos.ai/@personalAssistant</code>, for programmatic internal Land operations talking through the same protocol.
              </p>
              <pre className="lp-envelope-code">{`// fresh registration through the land's auth-being stance
{ verb: "be", operation: "register",
  stance: "treeos.ai/@auth", payload }

// claim or release identity at your own stance
{ verb: "be", operation: "claim",
  stance: "treeos.ai/@tabor", payload }

// switch the active left stance for this session
{ verb: "be", operation: "switch",
  stance: "treeos.ai/@personalAssistant", payload }`}</pre>
            </div>

          </div>

          <p className="lp-section-sub lp-section-sub-wide" style={{marginTop: 32, textAlign: "center", maxWidth: 760, margin: "32px auto 0", fontSize: 15, color: "rgba(255,255,255,0.6)"}}>
            Each verb's envelope is restricted to the address shape its work allows. The IBP Address itself (<code>stance :: stance</code>) is the conceptual bridge between requester and target. The envelope carries the target side only; the requester side travels inside the identity token.
          </p>
        </div>
      </section>

      {/* POSITIONS ARE THE UNIT OF PERSISTENCE */}
      <section className="lp-section lp-section-alt">
        <div className="lp-container" style={{maxWidth: 880}}>
          <h2 className="lp-section-title">Positions are the unit of persistence</h2>
          <p className="lp-section-sub lp-section-sub-wide" style={{textAlign: "center", marginBottom: 28}}>
            One thing in IBP is persistent. Positions. Everything else either lives at a position or is a summoned instance that reads from one.
          </p>

          <div className="ibp-persist">
            <div className="ibp-persist-card ibp-persist-position">
              <div className="ibp-persist-head">Position data, by namespace</div>
              <p className="ibp-persist-desc">
                Each position holds a stack of namespaces. Every IBP write lands in one of them. The same DO action shape reaches all of them; the action and payload say which namespace and what to write.
              </p>
              <ul className="ibp-persist-list">
                <li><strong>Structural</strong> . name, parent, children, status, contributors. Reached by <code>create-child</code>, <code>set-name</code>, <code>move</code>, <code>set-status</code>, etc. (Field updates follow the <code>set-&lt;field&gt;</code> pattern, parallel to <code>set-meta</code>.)</li>
                <li><strong>Notes and artifacts</strong> . the position's content. Reached by <code>write-note</code>, <code>edit-note</code>, <code>upload-artifact</code>.</li>
                <li><strong>Extension namespaces</strong> . one per installed extension. Reached by <code>set-meta</code> / <code>clear-meta</code>.</li>
                <li><strong>Role configurations</strong> . the programming for each being that can be summoned here. System instructions, tools, permissions. Also reached by <code>set-meta</code>, just with an role-keyed namespace.</li>
                <li><strong>Inboxes</strong> . one per being that can be summoned here. Reached by <code>SUMMON</code>, which is why SUMMON needs both the position and the being to find the right inbox.</li>
                <li><strong>History</strong> . chainsteps, decisions, contracts. Accumulated as the position is acted upon.</li>
              </ul>
            </div>

            <div className="ibp-persist-card ibp-persist-embodiment">
              <div className="ibp-persist-head">Beings are summoned, not continuously running</div>
              <p className="ibp-persist-desc">
                A Being is an instance with persistent identity; when summoned, it wakes up, reads the position's namespaces and the extension code that defines it, does work, and ends. Between summonings, the being is not acting (cognition is idle). Two things define its behavior, both addressed as positions.
              </p>
              <ul className="ibp-persist-list">
                <li><strong>Extension source</strong> at the extension's install position (the <code>.source</code> files). DO on that position edits the role's base definition for every invocation everywhere.</li>
                <li><strong>Position-specific overrides</strong> in the role's namespace at the invocation position (<code>metadata.ruler</code>, <code>metadata.archivist</code>, etc). DO <code>set-meta</code> writes them.</li>
              </ul>
              <p className="ibp-persist-desc" style={{marginTop: 12}}>
                There is no "writing to a being directly." Both paths to change a role are DOs on positions. The stance is the summoned moment; the position is what persists.
              </p>
            </div>
          </div>

          <p className="lp-section-sub lp-section-sub-wide" style={{marginTop: 28, textAlign: "center", maxWidth: 760, margin: "28px auto 0", fontSize: 15, color: "rgba(255,255,255,0.6)"}}>
            One protocol shape, one unit of persistence, many namespaces inside it. The kernel routes each DO to the right namespace; the stance is where summoning happens, not where storage lives.
          </p>
        </div>
      </section>

      {/* DATA AND BEINGS — THE CATEGORICAL LINE */}
      <section className="lp-section">
        <div className="lp-container" style={{maxWidth: 920}}>
          <h2 className="lp-section-title">Data and beings: the categorical line</h2>
          <p className="lp-section-sub lp-section-sub-wide" style={{textAlign: "center", maxWidth: 800, margin: "0 auto 32px"}}>
            IBP distinguishes two kinds of entities in the world. Data is fully mutable. Beings are not. The protocol provides no mechanism for direct control over a being. This is the architectural commitment, not an oversight.
          </p>

          <p className="lp-section-sub lp-section-sub-wide" style={{textAlign: "center", maxWidth: 760, margin: "0 auto 24px", fontStyle: "italic", color: "rgba(255,255,255,0.7)", borderLeft: "3px solid rgba(74, 222, 128, 0.4)", paddingLeft: 24, textAlign: "left"}}>
            You can't DO to a being. You can DO to its environment and hope it changes. You can SEE into its mind with SEE, in a way, but you can't control it.
          </p>

          <div className="ibp-categorical">
            <div className="ibp-categorical-col ibp-categorical-can">
              <div className="ibp-categorical-head">What you <strong>can</strong> do</div>
              <ul>
                <li>
                  <strong>Shape the environment</strong> a being encounters. DO on the position's data, on the role's namespace at that position, or on the extension source that defines the role. All three are DOs on positions.
                </li>
                <li>
                  <strong>Send a message</strong> the being will receive when summoned. SUMMON delivers to the stance's inbox. The being decides what to do with it.
                </li>
                <li>
                  <strong>Observe a being's perspective</strong>. SEE on a stance returns position data as that being would interpret it.
                </li>
                <li>
                  <strong>Read everything a being produced</strong>. Reasoning traces, prompts, tool calls, intermediate steps, outputs. All of it gets written to position data and is observable through SEE. The being's record is fully readable after the fact.
                </li>
                <li>
                  <strong>Manage your own identity</strong>. BE changes the left stance. Register, claim, release, switch. Your I am, not anyone else's.
                </li>
              </ul>
            </div>

            <div className="ibp-categorical-col ibp-categorical-cannot">
              <div className="ibp-categorical-head">What you <strong>cannot</strong> do</div>
              <ul>
                <li>
                  <strong>Force a being to act</strong>. The being's response when summoned is its own. The protocol has no verb that compels behavior.
                </li>
                <li>
                  <strong>Reach inside a live invocation</strong>. While a summoning is running, you cannot peek inside the LLM, alter its prompt mid-flight, or steer what it does next. The invocation runs to completion on its own. Records of everything it did become readable after; the act itself is not addressable.
                </li>
                <li>
                  <strong>Mutate a being directly</strong>. DO accepts position only, never stance, because beings aren't stored. They're summoned. There is nothing at a stance to mutate.
                </li>
                <li>
                  <strong>Control another being's identity</strong>. BE manages your own left stance. It does not address other beings.
                </li>
              </ul>
            </div>
          </div>

          <p className="lp-section-sub lp-section-sub-wide" style={{marginTop: 28, textAlign: "center", maxWidth: 800, margin: "28px auto 0", fontSize: 15, color: "rgba(255,255,255,0.65)"}}>
            Agency requires that the agent's action come from the agent, not from outside. If an external operation can force a being to act in a specific way, the being is not an agent. It is a remotely-controlled puppet. IBP gives beings exactly that protection. You can change their world. You can address them. You cannot make them do anything. Their action is theirs.
          </p>
        </div>
      </section>

      {/* SUBSTRATE: SELF-REFERENTIAL */}
      <section className="lp-section lp-section-alt">
        <div className="lp-container" style={{maxWidth: 920}}>
          <h2 className="lp-section-title">The substrate is self-referential</h2>
          <p className="lp-section-sub lp-section-sub-wide" style={{textAlign: "center", maxWidth: 800, margin: "0 auto 32px"}}>
            Beneath the verbs is the deepest claim about what IBP describes. The land is a substrate. Everything in it is data. Beings are the perspectives the substrate has on itself. Summons are how the substrate changes itself through those perspectives. Dids are how it records its actions.
          </p>

          <div className="ibp-persist">
            <div className="ibp-persist-card ibp-persist-position">
              <div className="ibp-persist-head">Everything is data</div>
              <p className="ibp-persist-desc">
                Positions, artifacts, metadata, beings, summons, dids. Nothing in the land sits outside the substrate. The land IS its substrate. The six protocol primitives are aspects of one thing.
              </p>
              <ul className="ibp-persist-list">
                <li><strong>Positions</strong> . where data lives.</li>
                <li><strong>Artifacts</strong> . what data is at positions.</li>
                <li><strong>Metadata</strong> . the extension-namespaced shape at every position.</li>
                <li><strong>Beings</strong> . perspectives the substrate has on itself.</li>
                <li><strong>Inboxes</strong> . pending summons waiting to fire.</li>
                <li><strong>Summons</strong> . events of data changing through perspectives.</li>
                <li><strong>Dids</strong> . substrate writes that happen during summons.</li>
              </ul>
            </div>

            <div className="ibp-persist-card ibp-persist-embodiment">
              <div className="ibp-persist-head">Beings are perspectives, summons are self-action</div>
              <p className="ibp-persist-desc">
                A being is not floating on top of the structure. A being is the structure manifesting itself as a perspective. Without a being processing, nothing observes. The substrate is observable, but observation requires a being.
              </p>
              <p className="ibp-persist-desc" style={{marginTop: 12}}>
                A Summon is one being's interaction with the substrate at one moment. Within a Summon the being SEEs, DOes, produces output. The Summon record captures input, cognition, tool calls, and output. The Summon itself is data: the record of one perspective acting on the substrate.
              </p>
              <p className="ibp-persist-desc" style={{marginTop: 12}}>
                So Summons are two things at once: the <em>mechanism</em> through which beings manipulate data, and the <em>data</em> that records what happened. The substrate's history is the accumulated record of Summons across time.
              </p>
            </div>
          </div>

          <p className="lp-section-sub lp-section-sub-wide" style={{marginTop: 28, maxWidth: 820, margin: "28px auto 0", fontSize: 15.5, color: "rgba(255,255,255,0.78)", fontStyle: "italic", borderLeft: "3px solid rgba(74, 222, 128, 0.4)", paddingLeft: 24, textAlign: "left"}}>
            The substrate is closed and self-referential. Beings are how it observes itself. Summons are how it acts on itself. Dids are how it records its actions. The substrate's history is the accumulated record of its own changes, made through its own perspectives.
          </p>

          <p className="lp-section-sub lp-section-sub-wide" style={{marginTop: 24, maxWidth: 800, margin: "24px auto 0", fontSize: 15, color: "rgba(255,255,255,0.7)"}}>
            There is no observer external to the substrate. There is no actor external to the substrate. A user is not outside the system reaching in. The user has a being inside the substrate; their actions are Summons happening within it. This is why beings are first-class in IBP. They are how the substrate becomes aware of itself.
          </p>

          <p className="lp-section-sub lp-section-sub-wide" style={{marginTop: 16, maxWidth: 800, margin: "16px auto 0", fontSize: 14.5, color: "rgba(255,255,255,0.55)"}}>
            Code can still emit DOs without a being attached. That is anonymous substrate change, useful for infrastructure that does not need to be observed. But most meaningful change flows through Summons, because most meaningful change benefits from being observable, accountable, attributable to a perspective.
          </p>
        </div>
      </section>

      {/* IDENTITY-FIRST */}
      <section className="lp-section">
        <div className="lp-container" style={{maxWidth: 760}}>
          <h2 className="lp-section-title">Identity is not optional</h2>
          <p className="lp-section-sub lp-section-sub-wide">
            You cannot open the portal anonymously. Every session starts signed in as a being on the left side of an IBP Address. A human user, an AI, an automated agent. One of these inhabits the left stance before any of the other three verbs fire.
          </p>
          <p className="lp-section-sub lp-section-sub-wide">
            On the web, anonymity is the default and identity is layered on later through cookies, sessions, OAuth, JWTs. Each site reinvents the wheel. In IBP, identity is the protocol's first move. Before you can see, do, or summon, you must be.
          </p>

          <h3 style={{marginTop: 40, marginBottom: 12, color: "#fde68a", fontSize: 18}}>The left stance, in full</h3>
          <p className="lp-section-sub lp-section-sub-wide">
            What the portal displays. <code>tabor :: treeos.ai/flappybird@ruler</code>. What is really being sent. <code>treeos.ai/@tabor :: treeos.ai/flappybird@ruler</code>. The grammar is symmetric. Both sides are full stances. The left side just gets shorthanded when the speaker is the human user.
          </p>
          <p className="lp-section-sub lp-section-sub-wide">
            The shorthand exists because, today, every human message is assumed to come from the land itself. <code>treeos.ai/@tabor</code> means "the human being Tabor, speaking from the root of their land." Position empty. No role chosen. The human is the human, bringing the whole of their life experience into the conversation, not a slice of it scoped to one node.
          </p>
          <p className="lp-section-sub lp-section-sub-wide">
            Later, humans will be able to speak from other positions too. A user could send a message from inside <code>/fitness</code> to inject that branch's context into the conversation, or speak as a persona, or contribute to one branch's plans without bringing the rest of their tree with them. When that lands, the left side gets written in full like the right side does.
          </p>
          <p className="lp-section-sub lp-section-sub-wide">
            When both sides are AI beings, both stances are written in full from the start. <code>treeos.ai/flappybird@worker :: alice.land/lib@maintainer</code>. There is no shorthand because there is no privileged default position. Each AI inhabits an explicit stance because each is constrained to one. The human's shorthand is a courtesy to the only being whose position is "everywhere at once."
          </p>
        </div>
      </section>

      {/* THE AUTH-BEING */}
      <section className="lp-section lp-section-alt">
        <div className="lp-container">
          <h2 className="lp-section-title">The auth-being . every land's gatekeeper</h2>
          <p className="lp-section-sub lp-section-sub-wide" style={{textAlign: "center", maxWidth: 800, margin: "0 auto 24px"}}>
            Identity has to be establishable, which means some being has to accept requests from unestablished requesters. Every land that speaks IBP runs one specifically for that. It lives at a fixed address.
          </p>

          <div className="ibp-auth-addr">
            <code className="ibp-auth-addr-code">
              <span style={{color: "#4ade80"}}>treeos.ai</span><span style={{color: "rgba(255,255,255,0.5)"}}>/</span><span style={{color: "#c084fc"}}>@auth</span>
            </code>
            <div className="ibp-auth-addr-note">A Stance at the Land Position. The auth-being at <code>/</code>.</div>
          </div>

          <div className="ibp-auth-grid">
            <div className="ibp-auth-card">
              <div className="ibp-auth-head">What it is</div>
              <p>A role registered at every land. Same kind of thing as any other role (it sits in the registry, declares its trigger pattern, has a summon function) but its job is processing identity operations rather than generating text. The auth-being is the only being that accepts requests from unestablished requesters, because identity bootstrap has to start somewhere.</p>
            </div>
            <div className="ibp-auth-card">
              <div className="ibp-auth-head">The four BE operations it handles</div>
              <ul>
                <li><strong>register</strong> . create a new user account on this land. Validates against the land's registration policy. Issues an identity token. Returns the new being's stance and a welcome from the land.</li>
                <li><strong>claim</strong> . authenticate an existing user. Validates credentials. Issues a new identity token tied to a stance.</li>
                <li><strong>release</strong> . invalidate an identity token. Marks it inactive in the land's session store.</li>
                <li><strong>switch</strong> . swap the active be-er within a session. Verifies the requester holds both stances and updates session state.</li>
              </ul>
            </div>
          </div>

          <p className="lp-section-sub lp-section-sub-wide" style={{marginTop: 24, maxWidth: 800, margin: "24px auto 0", fontSize: 15, color: "rgba(255,255,255,0.7)"}}>
            <strong>Specialized per land.</strong> The auth-being's character is what the land's posture toward newcomers actually feels like. Public lands have welcoming auth-beings that accept any registration. Private lands have gatekeeping auth-beings that require invite codes or vouching. A research land might bind every new user to an ethics contract on register. Same protocol shape on every land; different behavior, set by whichever role the operator wires in at <code>@auth</code>.
          </p>

          <p className="lp-section-sub lp-section-sub-wide" style={{marginTop: 12, maxWidth: 800, margin: "12px auto 0", fontSize: 14, color: "rgba(255,255,255,0.55)", fontStyle: "italic"}}>
            The auth-being is inspectable like any being. <code>SEE treeos.ai/@auth</code> returns its policies (open vs. closed registration, supported credential types) the same way SEE on any stance returns a Position Description. The gatekeeper has no special protocol status; it just has special authority within its land.
          </p>

          <div style={{
            marginTop: 24, padding: "20px 24px", maxWidth: 800, margin: "24px auto 0",
            background: "rgba(74, 222, 128, 0.05)",
            border: "1px solid rgba(74, 222, 128, 0.22)",
            borderRadius: 8,
          }}>
            <h3 style={{color: "#4ade80", fontSize: "1rem", marginTop: 0, marginBottom: 10}}>
              The auth-being proves cognition is not the line
            </h3>
            <p style={{fontSize: 14.5, color: "rgba(255,255,255,0.78)", lineHeight: 1.75, margin: 0}}>
              The auth-being's summon handler runs deterministic code . JWT validation, Being
              creation, session management. No LLM call. Its actions still write Dids attributed
              to it. SUMMON addressing still works. It is a fully first-class being whose cognition
              happens to be code.
            </p>
            <p style={{fontSize: 14.5, color: "rgba(255,255,255,0.7)", lineHeight: 1.75, marginTop: 12, marginBottom: 0}}>
              This generalizes. A being's cognition can be an <strong style={{color: "#bbf7d0"}}>LLM</strong>
              (typical AI beings), <strong style={{color: "#bbf7d0"}}>deterministic code</strong>
              (auth-being, browser-bridge, protocol handlers), <strong style={{color: "#bbf7d0"}}>a human</strong>
              (people typing through the Portal), or <strong style={{color: "#bbf7d0"}}>composite</strong>
              (a being orchestrating sub-beings). The protocol does not care. It cares that the
              SUMMON contract is honored: envelope arrives in the inbox, handler runs, output emerges.
              Identity is what IBP requires; cognition is the being's business.
            </p>
          </div>

          <div className="ibp-auth-link">
            Before a visitor registers or claims, they're an <strong>arrival stance</strong>. Its permissions are configurable per land, anywhere from "completely closed" to "fully open." <a href="/ibp/arrival">The arrival stance →</a>
          </div>
          <div className="ibp-auth-link" style={{marginTop: 12}}>
            The kernel function that enforces those permissions, and the permissions of every other stance at every land, is <strong>Portal Authorization</strong>. Every verb call flows through it. <a href="/ibp/authorization">Portal Authorization →</a>
          </div>
        </div>
      </section>

      {/* THE PORTAL (BROWSER) */}
      <section className="lp-section lp-section-alt">
        <div className="lp-container" style={{maxWidth: 760}}>
          <h2 className="lp-section-title">The Portal is to IBP what the browser is to HTTP</h2>
          <p className="lp-section-sub lp-section-sub-wide">
            A web browser speaks HTTP and renders HTML. The Portal speaks IBP, the four verbs over WebSocket, and renders Position Descriptors. Same shape of role in the architecture, different protocol underneath, different thing on screen.
          </p>
          <p className="lp-section-sub lp-section-sub-wide">
            Where a browser opens a page, the Portal opens a stance. Where a browser has tabs full of documents, the Portal has tabs full of IBP Addresses. Many beings addressed in parallel, each a different stance into the inhabited internet.
          </p>
          <p className="lp-section-sub lp-section-sub-wide">
            The Portal renders consistently across lands because IBP's response format is uniform. Every position arrives as a Position Descriptor; the Portal owns the visual language. A book-workspace position and a code-workspace position both look like TreeOS positions because the Portal draws them that way.
          </p>
        </div>
      </section>

      {/* COEXISTENCE */}
      <section className="lp-section">
        <div className="lp-container" style={{maxWidth: 760}}>
          <h2 className="lp-section-title">Coexistence with the web</h2>
          <p className="lp-section-sub lp-section-sub-wide">
            IBP does not replace the WWW. It does not wrap it. It does not sit inside it. IBP is a sibling protocol on the same internet, the same way email is a sibling to the web rather than a layer inside it.
          </p>
          <p className="lp-section-sub lp-section-sub-wide">
            A land server can serve both audiences. Visit <code>https://treeos.ai/some/page</code> in a web browser, get HTML over HTTP. Open <code>treeos.ai/some/position@ruler</code> in the Portal, get a Position Descriptor over IBP and engage through the four verbs. Same land, two surfaces, no conflict.
          </p>
          <p className="lp-section-sub lp-section-sub-wide">
            For domains outside TreeOS (any HTTP site), the Portal can still present the domain's being-side. Any site that publishes an AI-being layer becomes addressable over IBP. Invite a being there with SUMMON, engage it through the protocol, rather than scraping the HTML or stitching MCP servers on top of a website built for humans.
          </p>
        </div>
      </section>

      {/* WHAT IT IS, HONESTLY */}
      <section className="lp-section lp-section-alt">
        <div className="lp-container" style={{maxWidth: 760}}>
          <h2 className="lp-section-title">What's underneath</h2>
          <p className="lp-section-sub lp-section-sub-wide">
            The honest layered answer: IBP and the WWW both run on the internet. They both use DNS to resolve land names. They both use TCP/IP and TLS. At the network layer, they share the same plumbing.
          </p>
          <p className="lp-section-sub lp-section-sub-wide">
            But the WWW is defined by URL + HTTP + HTML + Browser working together. Those four things make the web the web, not just the internet. The Inter-Being Web is defined by IBP Address + IBP + Position Descriptors + Portal. Four things, different family.
          </p>
          <p className="lp-section-sub lp-section-sub-wide" style={{fontStyle: "italic", borderLeft: "3px solid rgba(74, 222, 128, 0.4)", paddingLeft: 24}}>
            The WWW is a network of documents that link to each other. The Inter-Being Web is a network of worlds inhabited by beings who address each other. Different networks because they network different kinds of things.
          </p>
        </div>
      </section>

      {/* FOOTER */}
      <footer className="lp-footer">
        <div className="lp-container">
          <div className="lp-footer-grid">
            <div className="lp-footer-col">
              <h4>Protocol</h4>
              <a href="/ibp">IBP</a>
              <a href="/ibp/arrival">The arrival stance</a>
              <a href="/ibp/authorization">Portal Authorization</a>
              <a href="/governing">Governing</a>
              <a href="/swarm">Swarm</a>
              <a href="/network">The Network</a>
            </div>
            <div className="lp-footer-col">
              <h4>Docs</h4>
              <a href="/guide">Guide</a>
              <a href="/seed">The Seed</a>
              <a href="/ai">The AI</a>
              <a href="/cascade">Cascade</a>
              <a href="/flow">The Flow</a>
              <a href="/extensions">Extensions</a>
              <a href="/build">Build</a>
              <a href="/lands">Start a Land</a>
              <a href="/cli">CLI</a>
            </div>
            <div className="lp-footer-col">
              <h4>TreeOS</h4>
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
              <a href="https://github.com/taborgreat/create-treeos/blob/main/template/seed/LICENSE">AGPL-3.0 License</a>
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


export default ProtocolPage;
