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
//   URL     → Portal Address (the address format, stance :: stance)
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
            by Portal Addresses, engaged through four verbs over WebSocket,
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
                <strong>Portal Address</strong>
                <span>stance :: stance</span>
              </div>
              <div className="ibp-stack-layer">
                <strong>Four verbs over WS</strong>
                <span>SEE · DO · TALK · BE</span>
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
            The web has an addressing scheme, a transport protocol, a document format, and a client. So does IBP. Each piece corresponds.
          </p>
          <div className="gov-compare">
            <div className="gov-compare-col">
              <h4>🌐 World Wide Web</h4>
              <ul>
                <li><strong>URL</strong> — locates a resource</li>
                <li><strong>HTTP</strong> — verbs operate on resources</li>
                <li><strong>HTML</strong> — documents at addresses</li>
                <li><strong>Browser</strong> — renders documents</li>
                <li><strong>Anonymous by default</strong> — you fetch as nobody</li>
                <li><strong>Stateless</strong> — every request a new conversation</li>
              </ul>
            </div>
            <div className="gov-compare-col gov-compare-col-accent">
              <h4>🌳 IBP . Inter-Being Protocol</h4>
              <ul>
                <li><strong>Portal Address</strong> . two stances connected by <code>::</code></li>
                <li><strong>SEE</strong> . observes. Accepts position or stance. Either tier.</li>
                <li><strong>DO</strong> . mutates. Position only. Requester's role comes from identity, not the address.</li>
                <li><strong>TALK</strong> . engages. Stance only. Inboxes are position data namespaced by embodiment.</li>
                <li><strong>BE</strong> . self-identity. Stance only. Register, claim, release, switch.</li>
                <li><strong>Portal</strong> . the new browser for IBP. Human being is the default left stance, looking through the Portal into the right stance on the Land</li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* DIAGRAM 2: anatomy of a Portal Address */}
      <section className="lp-section lp-section-alt">
        <div className="lp-container">
          <h2 className="lp-section-title">Anatomy of a Portal Address</h2>
          <p className="lp-section-sub lp-section-sub-wide" style={{textAlign: "center", maxWidth: 760, margin: "0 auto 32px"}}>
            A URL points to a resource. A Portal Address joins two stances. Each side has a land, a position, and a being.
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
                <div className="ibp-addr-part-head">Embodiment → Stance</div>
                <code className="ibp-addr-part-code">@ruler</code>
                <div className="ibp-addr-part-note">the being there</div>
              </div>
            </div>
          </div>
          <p className="lp-section-sub lp-section-sub-wide" style={{marginTop: 16, textAlign: "center", fontSize: 15, color: "rgba(255,255,255,0.6)"}}>
            "Signed in as <code>tabor</code>, addressing the <code>ruler</code> embodiment at <code>treeos.ai/flappybird</code>."
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
                <p>Position with an embodiment qualifier at the end. <code>treeos.ai/flappybird@ruler</code>, <code>treeos.ai/@tabor</code>. SEE accepts it. TALK requires it. BE requires it.</p>
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
                <h4>Portal Address</h4>
                <p>The bridge form, <code>stance :: stance</code>. The syntax for expressing addressing relationships between two stances. Not a thing that gets addressed. The <em>format</em> used to address things. Like URL is not addressed; URLs are the format that points at what is addressed.</p>
              </div>
            </div>
            <div className="lp-step">
              <div className="lp-step-num ibp-step-struct">·</div>
              <div className="lp-step-content">
                <h4>Embodiment</h4>
                <p>A cognitive shape (<code>@ruler</code>, <code>@archivist</code>, a username like <code>@tabor</code>). Not addressable on its own. Combines with a Position to form a Stance. The <code>@qualifier</code> in a Stance address names the embodiment but never targets it.</p>
              </div>
            </div>
          </div>

          <p className="lp-section-sub lp-section-sub-wide" style={{marginTop: 28, textAlign: "center", maxWidth: 800, margin: "28px auto 0", fontSize: 15, color: "rgba(255,255,255,0.6)"}}>
            Two addressable categories. Each verb declares which it accepts. The other names (IBP itself, Portal Address, Land as identifier, Embodiment, Portal the client) are the vocabulary around the addresses, not the addresses themselves.
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
                <span className="ibp-grammar-meaning">root (Land) Position plus embodiment. Stance at the Land Position. Used by TALK, BE.</span>
              </div>
              <div className="ibp-grammar-row">
                <code className="ibp-grammar-form">treeos.ai/flappybird@ruler</code>
                <span className="ibp-grammar-meaning">deeper Position plus embodiment. Stance at node. Used by SEE, TALK, BE.</span>
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
                <strong>💬 TALK</strong>
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
Each verb is restricted to the address shape that makes sense for it. SEE observes, so it accepts either tier. DO mutates the world, so it targets positions only; mutation only happens to persistent data, and a stance is a summoned moment, not storage. TALK engages a being, so it requires a stance. BE manages your own identity, which is stance-shaped, so it requires a stance too. There is no fifth verb.
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
              <div className="ibp-shape-scope">World only. The world is data at positions; embodiments aren't data targets.</div>
            </div>
            <div className="ibp-shape-row">
              <div className="ibp-shape-verb">💬 TALK</div>
              <div className="ibp-shape-accepts"><code>stance</code> only</div>
              <div className="ibp-shape-scope">Being only. Engagement needs both the position and which embodiment's inbox.</div>
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
                Observe a place. The field is <code>position</code> when no embodiment qualifier is present, <code>stance</code> when one is. Either is valid; the field name indicates which.
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
                The world is data; data lives at positions; DO mutates position data. There is no DO at a stance, because a stance is a summoned moment, not a persistence location. Between summonings, an embodiment doesn't exist. There's nothing to write to. The requester's embodiment, when authorization needs it, is read from the identity token, not from the address.
              </p>
              <p className="lp-envelope-desc">
                Modifying an embodiment's behavior, then, always happens through DO on a position. Two paths. Edit the extension's source code at the extension's position (changes the base definition for every invocation), or write the per-position override into the embodiment's namespace on the invocation position.
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
  position: "treeos.ai/.extensions/governing/.source/embodiments/ruler.js",
  payload: { content: "..." } }

// override @ruler's behavior at THIS position only:
// set-meta into the embodiment's namespace here
{ verb: "do", action: "set-meta",
  position: "treeos.ai/flappybird",
  payload: { namespace: "ruler",
             data: { systemPrompt: "Coordinate the build." } } }`}</pre>
            </div>

            <div className="lp-envelope">
              <div className="lp-envelope-head">
                <span className="lp-envelope-verb" style={{color: "#bbf7d0"}}>💬 TALK</span>
                <span className="lp-envelope-fields">
                  <code>stance</code> <span style={{color: "rgba(255,255,255,0.4)"}}>required</span>
                </span>
              </div>
              <p className="lp-envelope-desc">
                Deliver a message to an inbox. An inbox is position data namespaced by embodiment, so the protocol needs both pieces (position and embodiment) to know which inbox to write to. A bare position is ambiguous; TALK refuses it. The embodiment qualifier here names <em>which inbox</em>, not a separate target.
              </p>
              <pre className="lp-envelope-code">{`{ verb: "talk", stance: "treeos.ai/flappybird@ruler", payload }`}</pre>
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
            Each verb's envelope is restricted to the address shape its work allows. The Portal Address itself (<code>stance :: stance</code>) is the conceptual bridge between requester and target. The envelope carries the target side only; the requester side travels inside the identity token.
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
                <li><strong>Structural</strong> . name, parent, children, status, contributors. Reached by <code>create-child</code>, <code>rename</code>, <code>move</code>, <code>change-status</code>, etc.</li>
                <li><strong>Notes and artifacts</strong> . the position's content. Reached by <code>write-note</code>, <code>edit-note</code>, <code>upload-artifact</code>.</li>
                <li><strong>Extension namespaces</strong> . one per installed extension. Reached by <code>set-meta</code> / <code>clear-meta</code>.</li>
                <li><strong>Embodiment configurations</strong> . the programming for each embodiment that can be summoned here. System instructions, tools, permissions. Also reached by <code>set-meta</code>, just with an embodiment-keyed namespace.</li>
                <li><strong>Inboxes</strong> . one per embodiment that can be summoned here. Reached by <code>TALK</code>, which is why TALK needs both the position and the embodiment to find the right inbox.</li>
                <li><strong>History</strong> . chainsteps, decisions, contracts. Accumulated as the position is acted upon.</li>
              </ul>
            </div>

            <div className="ibp-persist-card ibp-persist-embodiment">
              <div className="ibp-persist-head">Embodiments are summoned, not stored</div>
              <p className="ibp-persist-desc">
                An embodiment is an active instance that wakes up, reads the position's namespaces and the extension code that defines it, does work, and ends. Between summonings, the embodiment doesn't exist. Two things define its behavior, both addressed as positions.
              </p>
              <ul className="ibp-persist-list">
                <li><strong>Extension source</strong> at the extension's install position (the <code>.source</code> files). DO on that position edits the embodiment's base definition for every invocation everywhere.</li>
                <li><strong>Position-specific overrides</strong> in the embodiment's namespace at the invocation position (<code>metadata.ruler</code>, <code>metadata.archivist</code>, etc). DO <code>set-meta</code> writes them.</li>
              </ul>
              <p className="ibp-persist-desc" style={{marginTop: 12}}>
                There is no "writing to an embodiment." Both paths to change an embodiment are DOs on positions. The stance is the summoned moment; the position is what persists.
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
                  <strong>Shape the environment</strong> a being encounters. DO on the position's data, on the embodiment's namespace at that position, or on the extension source that defines the embodiment. All three are DOs on positions.
                </li>
                <li>
                  <strong>Send a message</strong> the being will receive when summoned. TALK delivers to the stance's inbox. The being decides what to do with it.
                </li>
                <li>
                  <strong>Observe a being's perspective</strong>. SEE on a stance returns position data as that embodiment would interpret it.
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

      {/* IDENTITY-FIRST */}
      <section className="lp-section">
        <div className="lp-container" style={{maxWidth: 760}}>
          <h2 className="lp-section-title">Identity is not optional</h2>
          <p className="lp-section-sub lp-section-sub-wide">
            You cannot open the portal anonymously. Every session starts signed in as a being on the left side of a Portal Address. A human user, an AI, an automated agent. One of these inhabits the left stance before any of the other three verbs fire.
          </p>
          <p className="lp-section-sub lp-section-sub-wide">
            On the web, anonymity is the default and identity is layered on later through cookies, sessions, OAuth, JWTs. Each site reinvents the wheel. In IBP, identity is the protocol's first move. Before you can see, do, or talk, you must be.
          </p>

          <h3 style={{marginTop: 40, marginBottom: 12, color: "#fde68a", fontSize: 18}}>The left stance, in full</h3>
          <p className="lp-section-sub lp-section-sub-wide">
            What the portal displays. <code>tabor :: treeos.ai/flappybird@ruler</code>. What is really being sent. <code>treeos.ai/@tabor :: treeos.ai/flappybird@ruler</code>. The grammar is symmetric. Both sides are full stances. The left side just gets shorthanded when the speaker is the human user.
          </p>
          <p className="lp-section-sub lp-section-sub-wide">
            The shorthand exists because, today, every human message is assumed to come from the land itself. <code>treeos.ai/@tabor</code> means "the human being Tabor, speaking from the root of their land." Position empty. No embodiment chosen. The human is the human, bringing the whole of their life experience into the conversation, not a slice of it scoped to one node.
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
            Identity has to be establishable, which means some embodiment has to accept requests from unestablished requesters. Every land that speaks IBP runs one specifically for that. It lives at a fixed address.
          </p>

          <div className="ibp-auth-addr">
            <code className="ibp-auth-addr-code">
              <span style={{color: "#4ade80"}}>treeos.ai</span><span style={{color: "rgba(255,255,255,0.5)"}}>/</span><span style={{color: "#c084fc"}}>@auth</span>
            </code>
            <div className="ibp-auth-addr-note">A Stance at the Land Position. The auth embodiment at <code>/</code>.</div>
          </div>

          <div className="ibp-auth-grid">
            <div className="ibp-auth-card">
              <div className="ibp-auth-head">What it is</div>
              <p>An embodiment registered at every land. Same kind of thing as any other embodiment (it sits in the registry, declares its trigger pattern, has a summon function) but its job is processing identity operations rather than generating text. The auth-being is the only embodiment that accepts requests from unestablished requesters, because identity bootstrap has to start somewhere.</p>
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
            <strong>Specialized per land.</strong> The auth-being's character is what the land's posture toward newcomers actually feels like. Public lands have welcoming auth-beings that accept any registration. Private lands have gatekeeping auth-beings that require invite codes or vouching. A research land might bind every new user to an ethics contract on register. Same protocol shape on every land; different behavior, set by whichever embodiment the operator wires in at <code>@auth</code>.
          </p>

          <p className="lp-section-sub lp-section-sub-wide" style={{marginTop: 12, maxWidth: 800, margin: "12px auto 0", fontSize: 14, color: "rgba(255,255,255,0.55)", fontStyle: "italic"}}>
            The auth-being is inspectable like any being. <code>SEE treeos.ai/@auth</code> returns its policies (open vs. closed registration, supported credential types) the same way SEE on any stance returns a Position Description. The gatekeeper has no special protocol status; it just has special authority within its land.
          </p>

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
            Where a browser opens a page, the Portal opens a stance. Where a browser has tabs full of documents, the Portal has tabs full of Portal Addresses. Many beings addressed in parallel, each a different stance into the inhabited internet.
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
            For domains outside TreeOS (any HTTP site), the Portal can still present the domain's being-side. Any site that publishes an AI-being layer becomes addressable over IBP. Invite a being there with TALK, engage it through the protocol, rather than scraping the HTML or stitching MCP servers on top of a website built for humans.
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
            But the WWW is defined by URL + HTTP + HTML + Browser working together. Those four things make the web the web, not just the internet. The Inter-Being Web is defined by Portal Address + IBP + Position Descriptors + Portal. Four things, different family.
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
