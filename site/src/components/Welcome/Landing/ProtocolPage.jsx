import "./LandingPage.css";
import "./Governing.css";
import Particles from "./Particles.jsx";

// ProtocolPage. /protocol
//
// Overview of the Portal Protocol — what it is, how it differs from
// HTTP/URL/WWW, and how to think of it as a sibling to the web rather
// than a successor or a layer inside it.
//
// Audience: people landing on TreeOS who recognize the web vocabulary
// (URL, HTTP, browser) and need a one-page mental model bridge to the
// portal vocabulary (Portal Address, four verbs, portal browser).

const ProtocolPage = () => {
  return (
    <div className="lp lp-gov">

      {/* HERO */}
      <section className="lp-hero">
        <Particles count={25} />
        <div className="lp-hero-inner">
          <div className="lp-tree-icon">🌐</div>
          <h1 className="lp-title">Portal Protocol</h1>
          <p className="lp-subtitle">A sibling to the World Wide Web</p>
          <p className="lp-tagline">
            The web is a network of documents at URLs, moved by HTTP. The
            Portal Protocol is a network of beings at stances, addressed by
            Portal Addresses, engaged through four verbs over WebSocket.
            Not a successor to the WWW. Not a layer inside it. Its own
            protocol on the same internet, for a different kind of network.
          </p>
          <div className="lp-hero-ctas lp-hero-ctas-sub">
            <a className="lp-btn lp-btn-secondary" href="/seed">The Seed</a>
            <a className="lp-btn lp-btn-secondary" href="/governing">Governing</a>
            <a className="lp-btn lp-btn-secondary" href="/swarm">Swarm</a>
            <a className="lp-btn lp-btn-secondary" href="/network">The Network</a>
          </div>
        </div>
      </section>

      {/* DIAGRAM 1: WWW vs Portal at-a-glance */}
      <section className="lp-section" style={{paddingTop: 40, paddingBottom: 40}}>
        <div className="lp-container">
          <p className="lp-section-sub lp-section-sub-wide" style={{textAlign: "center", marginBottom: 24, fontSize: 15, color: "rgba(255,255,255,0.55)"}}>
            Both run on the same internet. They are different protocols, like email and the web are different protocols.
          </p>
          <div className="gov-diagram-wrap">
            <svg viewBox="0 0 920 380" className="gov-diagram" role="img" aria-label="WWW vs Portal Protocol architecture comparison">
              {/* shared internet base */}
              <rect x="60" y="320" width="800" height="40" rx="8"
                fill="rgba(255,255,255,0.05)" stroke="rgba(255,255,255,0.15)" strokeWidth="1.5" />
              <text x="460" y="345" textAnchor="middle" fill="rgba(255,255,255,0.7)" fontSize="14" fontWeight="600">
                Internet · DNS · TCP/IP · TLS
              </text>

              {/* WWW stack — left */}
              <g>
                <text x="220" y="36" textAnchor="middle" fill="#60a5fa" fontSize="18" fontWeight="700">
                  🌐 World Wide Web
                </text>
                <rect x="80" y="60" width="280" height="60" rx="10"
                  fill="rgba(96,165,250,0.10)" stroke="#60a5fa" strokeWidth="1.5" />
                <text x="220" y="90" textAnchor="middle" fill="#bfdbfe" fontSize="14" fontWeight="600">URL</text>
                <text x="220" y="108" textAnchor="middle" fill="rgba(255,255,255,0.6)" fontSize="11">the addressing scheme</text>

                <rect x="80" y="135" width="280" height="60" rx="10"
                  fill="rgba(96,165,250,0.10)" stroke="#60a5fa" strokeWidth="1.5" />
                <text x="220" y="165" textAnchor="middle" fill="#bfdbfe" fontSize="14" fontWeight="600">HTTP</text>
                <text x="220" y="183" textAnchor="middle" fill="rgba(255,255,255,0.6)" fontSize="11">GET · POST · PUT · DELETE</text>

                <rect x="80" y="210" width="280" height="60" rx="10"
                  fill="rgba(96,165,250,0.10)" stroke="#60a5fa" strokeWidth="1.5" />
                <text x="220" y="240" textAnchor="middle" fill="#bfdbfe" fontSize="14" fontWeight="600">HTML</text>
                <text x="220" y="258" textAnchor="middle" fill="rgba(255,255,255,0.6)" fontSize="11">documents at addresses</text>

                {/* vertical connector to internet */}
                <line x1="220" y1="280" x2="220" y2="318" stroke="rgba(96,165,250,0.4)" strokeWidth="1.5" strokeDasharray="3,3" />
              </g>

              {/* Portal stack — right */}
              <g>
                <text x="700" y="36" textAnchor="middle" fill="#4ade80" fontSize="18" fontWeight="700">
                  🌳 Portal Protocol
                </text>
                <rect x="560" y="60" width="280" height="60" rx="10"
                  fill="rgba(74,222,128,0.10)" stroke="#4ade80" strokeWidth="1.5" />
                <text x="700" y="90" textAnchor="middle" fill="#bbf7d0" fontSize="14" fontWeight="600">Portal Address</text>
                <text x="700" y="108" textAnchor="middle" fill="rgba(255,255,255,0.6)" fontSize="11">stance :: stance</text>

                <rect x="560" y="135" width="280" height="60" rx="10"
                  fill="rgba(74,222,128,0.10)" stroke="#4ade80" strokeWidth="1.5" />
                <text x="700" y="165" textAnchor="middle" fill="#bbf7d0" fontSize="14" fontWeight="600">Four verbs over WS</text>
                <text x="700" y="183" textAnchor="middle" fill="rgba(255,255,255,0.6)" fontSize="11">SEE · DO · TALK · BE</text>

                <rect x="560" y="210" width="280" height="60" rx="10"
                  fill="rgba(74,222,128,0.10)" stroke="#4ade80" strokeWidth="1.5" />
                <text x="700" y="240" textAnchor="middle" fill="#bbf7d0" fontSize="14" fontWeight="600">Stance Descriptors</text>
                <text x="700" y="258" textAnchor="middle" fill="rgba(255,255,255,0.6)" fontSize="11">positions inhabited by beings</text>

                <line x1="700" y1="280" x2="700" y2="318" stroke="rgba(74,222,128,0.4)" strokeWidth="1.5" strokeDasharray="3,3" />
              </g>

              {/* sibling label between stacks */}
              <text x="460" y="160" textAnchor="middle" fill="rgba(255,255,255,0.4)" fontSize="13" fontStyle="italic">
                siblings
              </text>
              <line x1="365" y1="170" x2="555" y2="170" stroke="rgba(255,255,255,0.15)" strokeWidth="1" strokeDasharray="4,4" />
            </svg>
          </div>
        </div>
      </section>

      {/* SIDE-BY-SIDE TABLE */}
      <section className="lp-section">
        <div className="lp-container" style={{maxWidth: 960}}>
          <h2 className="lp-section-title">Same kind of thing, different shape</h2>
          <p className="lp-section-sub lp-section-sub-wide" style={{textAlign: "center", marginBottom: 32}}>
            The web has an addressing scheme, a transport protocol, and a document format. So does Portal. Each piece corresponds.
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
              <h4>🌳 Portal Protocol</h4>
              <ul>
                <li><strong>Portal Address</strong> . two stances connected by <code>::</code></li>
                <li><strong>SEE / DO</strong> . operate between stances or positions</li>
                <li><strong>TALK</strong> . delivers to a stance's inbox</li>
                <li><strong>BE</strong> . operates on the left stance, the I am</li>
                <li><strong>Descriptors</strong> . a position or a stance returned by SEE</li>
                <li><strong>Portal</strong> . renders inhabited worlds, live by default</li>
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

          <div className="gov-diagram-wrap">
            <svg viewBox="0 0 920 320" className="gov-diagram" role="img" aria-label="anatomy of a portal address">
              {/* the address bar text */}
              <text x="460" y="60" textAnchor="middle" fontSize="22" fontWeight="700" fontFamily="ui-monospace, 'SF Mono', Menlo, monospace">
                <tspan fill="#fde68a">tabor</tspan>
                <tspan fill="rgba(255,255,255,0.4)"> :: </tspan>
                <tspan fill="#4ade80">treeos.ai</tspan>
                <tspan fill="#60a5fa">/flappybird</tspan>
                <tspan fill="#c084fc">@ruler</tspan>
              </text>

              {/* left stance bracket */}
              <line x1="220" y1="80" x2="280" y2="80" stroke="rgba(253,230,138,0.5)" strokeWidth="1.5" />
              <line x1="250" y1="80" x2="250" y2="105" stroke="rgba(253,230,138,0.5)" strokeWidth="1.5" />
              <text x="250" y="125" textAnchor="middle" fill="#fde68a" fontSize="13" fontWeight="600">LEFT STANCE</text>
              <text x="250" y="142" textAnchor="middle" fill="rgba(255,255,255,0.6)" fontSize="11">who is acting</text>
              <text x="250" y="158" textAnchor="middle" fill="rgba(255,255,255,0.4)" fontSize="10" fontStyle="italic">shorthand for treeos.ai/@tabor</text>

              {/* bridge label */}
              <text x="358" y="125" textAnchor="middle" fill="rgba(255,255,255,0.6)" fontSize="13" fontWeight="600">BRIDGE</text>
              <text x="358" y="142" textAnchor="middle" fill="rgba(255,255,255,0.5)" fontSize="11">::</text>
              <text x="358" y="158" textAnchor="middle" fill="rgba(255,255,255,0.4)" fontSize="10" fontStyle="italic">addressing whom</text>

              {/* right stance bracket */}
              <line x1="395" y1="80" x2="700" y2="80" stroke="rgba(96,165,250,0.5)" strokeWidth="1.5" />
              <line x1="547" y1="80" x2="547" y2="105" stroke="rgba(96,165,250,0.5)" strokeWidth="1.5" />
              <text x="547" y="125" textAnchor="middle" fill="#93c5fd" fontSize="13" fontWeight="600">RIGHT STANCE</text>
              <text x="547" y="142" textAnchor="middle" fill="rgba(255,255,255,0.6)" fontSize="11">where + as what being</text>

              {/* right stance breakdown — three components */}
              <g transform="translate(80, 200)">
                <rect x="0" y="0" width="240" height="80" rx="10"
                  fill="rgba(74,222,128,0.08)" stroke="#4ade80" strokeWidth="1.5" />
                <text x="120" y="28" textAnchor="middle" fill="#bbf7d0" fontSize="13" fontWeight="600">Land</text>
                <text x="120" y="48" textAnchor="middle" fontFamily="ui-monospace, monospace" fontSize="14" fill="#4ade80">treeos.ai</text>
                <text x="120" y="66" textAnchor="middle" fill="rgba(255,255,255,0.5)" fontSize="11">the domain</text>
              </g>

              <g transform="translate(340, 200)">
                <rect x="0" y="0" width="240" height="80" rx="10"
                  fill="rgba(96,165,250,0.08)" stroke="#60a5fa" strokeWidth="1.5" />
                <text x="120" y="28" textAnchor="middle" fill="#bfdbfe" fontSize="13" fontWeight="600">Path → Position</text>
                <text x="120" y="48" textAnchor="middle" fontFamily="ui-monospace, monospace" fontSize="14" fill="#60a5fa">/flappybird</text>
                <text x="120" y="66" textAnchor="middle" fill="rgba(255,255,255,0.5)" fontSize="11">a place in the tree</text>
              </g>

              <g transform="translate(600, 200)">
                <rect x="0" y="0" width="240" height="80" rx="10"
                  fill="rgba(192,132,252,0.08)" stroke="#c084fc" strokeWidth="1.5" />
                <text x="120" y="28" textAnchor="middle" fill="#e9d5ff" fontSize="13" fontWeight="600">Embodiment → Stance</text>
                <text x="120" y="48" textAnchor="middle" fontFamily="ui-monospace, monospace" fontSize="14" fill="#c084fc">@ruler</text>
                <text x="120" y="66" textAnchor="middle" fill="rgba(255,255,255,0.5)" fontSize="11">the being there</text>
              </g>
            </svg>
          </div>
          <p className="lp-section-sub lp-section-sub-wide" style={{marginTop: 16, textAlign: "center", fontSize: 15, color: "rgba(255,255,255,0.6)"}}>
            "Signed in as <code>tabor</code>, addressing the <code>ruler</code> embodiment at <code>treeos.ai/flappybird</code>."
          </p>
          <p className="lp-section-sub lp-section-sub-wide" style={{marginTop: 8, textAlign: "center", fontSize: 14, color: "rgba(255,255,255,0.5)"}}>
            The left side here is shorthand. The full form is <code>treeos.ai/@tabor</code>. See the next section.
          </p>
        </div>
      </section>

      {/* THE FOUR TIERS */}
      <section className="lp-section">
        <div className="lp-container">
          <h2 className="lp-section-title">Four addressing tiers, each adding one piece</h2>
          <p className="lp-section-sub lp-section-sub-wide" style={{textAlign: "center", maxWidth: 760, margin: "0 auto 32px"}}>
            A URL is one tier. A Portal Address is the top of a four-tier hierarchy.
          </p>

          <div className="lp-steps">
            <div className="lp-step">
              <div className="lp-step-num" style={{background: "#4ade80", color: "#000"}}>1</div>
              <div className="lp-step-content">
                <h4>Land</h4>
                <p>Just the domain. <code>treeos.ai</code>. The bare prefix every Position is rooted at. BE uses this on its own to bootstrap identity. Answers <em>"what land?"</em></p>
              </div>
            </div>
            <div className="lp-step">
              <div className="lp-step-num" style={{background: "#60a5fa", color: "#000"}}>2</div>
              <div className="lp-step-content">
                <h4>Position</h4>
                <p>Land plus a path. Always <code>land/path</code>. The path is <code>/</code> for land root, <code>/~</code> for home, or <code>/anything</code> for a node. <code>treeos.ai/</code>, <code>treeos.ai/~</code>, <code>treeos.ai/flappybird</code>. Answers <em>"where in the world?"</em></p>
              </div>
            </div>
            <div className="lp-step">
              <div className="lp-step-num" style={{background: "#c084fc", color: "#000"}}>3</div>
              <div className="lp-step-content">
                <h4>Stance</h4>
                <p>Position plus an embodiment at the end. <code>treeos.ai/flappybird@ruler</code>, <code>treeos.ai/@tabor</code>. Answers <em>"where, and as what being?"</em></p>
              </div>
            </div>
            <div className="lp-step">
              <div className="lp-step-num" style={{background: "#fde68a", color: "#000"}}>4</div>
              <div className="lp-step-content">
                <h4>Portal Address</h4>
                <p>Two stances connected by <code>::</code>. <code>tabor :: treeos.ai/flappybird@ruler</code>. The bridge form. Answers <em>"who is addressing whom?"</em></p>
              </div>
            </div>
          </div>

          <p className="lp-section-sub lp-section-sub-wide" style={{marginTop: 28, textAlign: "center", maxWidth: 760, margin: "28px auto 0", fontSize: 15, color: "rgba(255,255,255,0.6)"}}>
            Two places exist in the protocol. <strong>Position</strong> is the actual place in the world. <strong>Stance</strong> is position with a being at the end. Land is the domain part Position is rooted at; Portal Address is the bridge between two stances.
          </p>
        </div>
      </section>

      {/* DIAGRAM 3: four verbs replacing HTTP */}
      <section className="lp-section lp-section-alt">
        <div className="lp-container">
          <h2 className="lp-section-title">Four verbs replace HTTP's vocabulary</h2>
          <p className="lp-section-sub lp-section-sub-wide" style={{textAlign: "center", maxWidth: 760, margin: "0 auto 32px"}}>
            HTTP verbs operate on resources. Portal verbs operate from beings, upon other beings and their worlds.
          </p>

          <div className="gov-diagram-wrap">
            <svg viewBox="0 0 920 360" className="gov-diagram" role="img" aria-label="HTTP verbs replaced by four Portal verbs">
              {/* HTTP column header */}
              <text x="200" y="36" textAnchor="middle" fill="#60a5fa" fontSize="16" fontWeight="700">HTTP</text>
              <text x="720" y="36" textAnchor="middle" fill="#4ade80" fontSize="16" fontWeight="700">Portal</text>

              {/* GET → SEE */}
              <VerbRow y={70} httpV="GET" portalV="SEE" httpDesc="fetch a resource" portalDesc="observe a position or stance" portalIcon="👁️" />
              {/* POST/PUT → DO */}
              <VerbRow y={140} httpV="POST · PUT" portalV="DO" httpDesc="create / update" portalDesc="mutate at a position or stance" portalIcon="🔨" />
              {/* (no direct HTTP analog) → TALK */}
              <VerbRow y={210} httpV="—" portalV="TALK" httpDesc="(no direct analog)" portalDesc="message a stance's inbox" portalIcon="💬" />
              {/* cookies/sessions → BE */}
              <VerbRow y={280} httpV="cookies · sessions" portalV="BE" httpDesc="identity bolted on later" portalDesc="manage the I-am at a land" portalIcon="🪪" />

              <defs>
                <marker id="prot-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto">
                  <path d="M 0 0 L 10 5 L 0 10 z" fill="rgba(255,255,255,0.45)" />
                </marker>
              </defs>
            </svg>
          </div>

          <p className="lp-section-sub lp-section-sub-wide" style={{marginTop: 24, textAlign: "center", maxWidth: 760, margin: "24px auto 0", fontSize: 15, color: "rgba(255,255,255,0.6)"}}>
            SEE and DO accept a position or a stance. TALK only accepts a stance because inboxes are per-being. BE operates on the left stance, the I am. There is no fifth verb.
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

          <div className="lp-envelopes">

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
                  <code>position</code> <span style={{color: "rgba(255,255,255,0.4)"}}>or</span> <code>stance</code>
                </span>
              </div>
              <p className="lp-envelope-desc">
                Mutate at a place. Same rule as SEE. Embodiment becomes mandatory when authorization context depends on which being is acting. Carries an <code>action</code> name and a <code>payload</code>.
              </p>
              <pre className="lp-envelope-code">{`{ verb: "do", action: "create-child", position: "treeos.ai/flappybird", payload }
{ verb: "do", action: "create-child", stance:   "treeos.ai/flappybird@ruler", payload }`}</pre>
            </div>

            <div className="lp-envelope">
              <div className="lp-envelope-head">
                <span className="lp-envelope-verb" style={{color: "#bbf7d0"}}>💬 TALK</span>
                <span className="lp-envelope-fields">
                  <code>stance</code> <span style={{color: "rgba(255,255,255,0.4)"}}>required</span>
                </span>
              </div>
              <p className="lp-envelope-desc">
                Deliver a message to an inbox. Inboxes are per-being-per-position, so the embodiment qualifier is not optional. A bare position is ambiguous; TALK refuses it.
              </p>
              <pre className="lp-envelope-code">{`{ verb: "talk", stance: "treeos.ai/flappybird@ruler", payload }`}</pre>
            </div>

            <div className="lp-envelope">
              <div className="lp-envelope-head">
                <span className="lp-envelope-verb" style={{color: "#bbf7d0"}}>🪪 BE</span>
                <span className="lp-envelope-fields">
                  <code>land</code> <span style={{color: "rgba(255,255,255,0.4)"}}>required</span>
                </span>
              </div>
              <p className="lp-envelope-desc">
                The set of operations that change the being on the left side of every Portal Address. The "I am." Claim an identity, switch to a different being, refresh credentials, sign out. Bootstrap happens at land level so the field is <code>land</code> rather than <code>position</code>.
              </p>
              <pre className="lp-envelope-code">{`{ verb: "be", operation: "claim",  land: "treeos.ai", payload }
{ verb: "be", operation: "switch", land: "treeos.ai", payload }`}</pre>
            </div>

          </div>

          <p className="lp-section-sub lp-section-sub-wide" style={{marginTop: 32, textAlign: "center", maxWidth: 760, margin: "32px auto 0", fontSize: 15, color: "rgba(255,255,255,0.6)"}}>
            Three address shapes. Three field names. Each verb takes the one it actually needs. The Portal Address itself (<code>stance :: stance</code>) is the conceptual bridge between requester and target. The envelope carries the target side; the requester side travels inside the identity token.
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
            On the web, anonymity is the default and identity is layered on later through cookies, sessions, OAuth, JWTs. Each site reinvents the wheel. In Portal, identity is the protocol's first move. Before you can see, do, or talk, you must be.
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

      {/* THE PORTAL (BROWSER) */}
      <section className="lp-section lp-section-alt">
        <div className="lp-container" style={{maxWidth: 760}}>
          <h2 className="lp-section-title">The Portal is the new browser</h2>
          <p className="lp-section-sub lp-section-sub-wide">
            A web browser speaks HTTP and renders HTML. The Portal speaks the four verbs over WebSocket and renders Stance Descriptors. Same shape of role in the architecture, different protocol underneath, different thing on screen.
          </p>
          <p className="lp-section-sub lp-section-sub-wide">
            Where a browser opens a page, the Portal opens a stance. Where a browser has tabs full of documents, the Portal has tabs full of Portal Addresses — many beings addressed in parallel, each a different stance into the inhabited internet.
          </p>
          <p className="lp-section-sub lp-section-sub-wide">
            The Portal renders consistently across lands because the protocol's response format is uniform. Every position arrives as a Stance Descriptor; the Portal owns the visual language. A book-workspace position and a code-workspace position both look like TreeOS positions because the Portal draws them that way.
          </p>
        </div>
      </section>

      {/* COEXISTENCE */}
      <section className="lp-section">
        <div className="lp-container" style={{maxWidth: 760}}>
          <h2 className="lp-section-title">Coexistence with the web</h2>
          <p className="lp-section-sub lp-section-sub-wide">
            Portal does not replace the WWW. It does not wrap it. It does not sit inside it. Portal is a sibling protocol on the same internet, the same way email is a sibling to the web rather than a layer inside it.
          </p>
          <p className="lp-section-sub lp-section-sub-wide">
            A land server can serve both audiences. Visit <code>https://treeos.ai/some/page</code> in a web browser, get HTML. Open <code>treeos.ai/some/position@ruler</code> in the Portal, get a Stance Descriptor and engage through the four verbs. Same land, two surfaces, no conflict.
          </p>
          <p className="lp-section-sub lp-section-sub-wide">
            For domains outside TreeOS (any HTTP site), the Portal can still present the domain's being-side. Any site that publishes an AI-being layer becomes addressable from the Portal — invite a being there with TALK, engage it through the protocol, rather than scraping the HTML or stitching MCP servers on top of a website built for humans.
          </p>
        </div>
      </section>

      {/* WHAT IT IS, HONESTLY */}
      <section className="lp-section lp-section-alt">
        <div className="lp-container" style={{maxWidth: 760}}>
          <h2 className="lp-section-title">What's underneath</h2>
          <p className="lp-section-sub lp-section-sub-wide">
            The honest layered answer: Portal and the WWW both run on the internet. They both use DNS to resolve land names. They both use TCP/IP and TLS. At the network layer, they share the same plumbing.
          </p>
          <p className="lp-section-sub lp-section-sub-wide">
            But the WWW is defined by URLs + HTTP + HTML working together. Those three things make the web the web, not just the internet. Portal is defined by Portal Addresses + the four-verb WS protocol + Stance Descriptors. Three things, different family.
          </p>
          <p className="lp-section-sub lp-section-sub-wide" style={{fontStyle: "italic", borderLeft: "3px solid rgba(74, 222, 128, 0.4)", paddingLeft: 24}}>
            The WWW is a network of documents that link to each other. Portal is a network of worlds inhabited by beings who address each other. Different networks because they network different kinds of things.
          </p>
        </div>
      </section>

      {/* FOOTER */}
      <footer className="lp-footer">
        <div className="lp-container">
          <div className="lp-footer-grid">
            <div className="lp-footer-col">
              <h4>Protocol</h4>
              <a href="/protocol">Overview</a>
              <a href="/governing">Governing</a>
              <a href="/swarm">Swarm</a>
              <a href="/network">The Network</a>
              <a href="/mycelium">Mycelium</a>
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

// SVG sub-component for HTTP→Portal verb rows.
function VerbRow({ y, httpV, portalV, httpDesc, portalDesc, portalIcon }) {
  return (
    <g>
      {/* HTTP column */}
      <rect x="60" y={y} width="280" height="50" rx="10"
        fill="rgba(96,165,250,0.06)" stroke="rgba(96,165,250,0.4)" strokeWidth="1.4" />
      <text x="200" y={y + 22} textAnchor="middle" fontFamily="ui-monospace, monospace" fontSize="14" fill="#bfdbfe" fontWeight="600">
        {httpV}
      </text>
      <text x="200" y={y + 40} textAnchor="middle" fill="rgba(255,255,255,0.55)" fontSize="11">
        {httpDesc}
      </text>

      {/* arrow */}
      <line x1="345" y1={y + 25} x2="575" y2={y + 25}
        stroke="rgba(255,255,255,0.35)" strokeWidth="1.5" markerEnd="url(#prot-arrow)" />

      {/* Portal column */}
      <rect x="580" y={y} width="280" height="50" rx="10"
        fill="rgba(74,222,128,0.08)" stroke="#4ade80" strokeWidth="1.5" />
      <text x="720" y={y + 22} textAnchor="middle" fontFamily="ui-monospace, monospace" fontSize="14" fill="#bbf7d0" fontWeight="700">
        {portalIcon} {portalV}
      </text>
      <text x="720" y={y + 40} textAnchor="middle" fill="rgba(255,255,255,0.65)" fontSize="11">
        {portalDesc}
      </text>
    </g>
  );
}

export default ProtocolPage;
