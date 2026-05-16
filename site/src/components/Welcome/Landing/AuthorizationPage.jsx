import "./LandingPage.css";
import "./Governing.css";
import Particles from "./Particles.jsx";

// AuthorizationPage. /ibp/authorization
//
// Portal Authorization is the kernel function that decides what one
// stance can do toward another stance through a portal connection.
// Arrival is one stance the system handles; this page covers the
// general layer.

const AuthorizationPage = () => {
  return (
    <div className="lp lp-gov">

      {/* HERO */}
      <section className="lp-hero">
        <Particles count={20} />
        <div className="lp-hero-inner">
          <div className="lp-tree-icon">🔐</div>
          <h1 className="lp-title">Portal Authorization</h1>
          <p className="lp-subtitle">The kernel's stance permission layer</p>
          <p className="lp-tagline">
            The system that determines what one stance can do toward another
            stance through a portal connection. One function, four inputs,
            allow-or-deny output. Every verb call from every stance at every
            position flows through it. It is what makes the protocol's
            stance commitment real at the kernel level.
          </p>
          <div className="lp-hero-ctas lp-hero-ctas-sub">
            <a className="lp-btn lp-btn-secondary" href="/ibp">Back to IBP</a>
            <a className="lp-btn lp-btn-secondary" href="/ibp/arrival">The arrival stance</a>
            <a className="lp-btn lp-btn-secondary" href="/network">The Network</a>
          </div>
        </div>
      </section>

      {/* WHAT IT IS */}
      <section className="lp-section">
        <div className="lp-container" style={{maxWidth: 880}}>
          <h2 className="lp-section-title">What it is</h2>
          <p className="lp-section-sub lp-section-sub-wide" style={{textAlign: "center", maxWidth: 760, margin: "0 auto 28px"}}>
            A single kernel function. Every verb call passes through it before the verb's own handler runs. Reads per-stance permissions from land metadata, applies the configuration, returns allow or deny.
          </p>

          <pre className="lp-envelope-code" style={{maxWidth: 760, margin: "0 auto"}}>{`authorize(
  actingStance,   // who is making the request
  target,         // a Position or a Stance
  verb,           // "see" | "do" | "talk" | "be"
  details         // { action?, payload?, operation?, message? }
) → "allow" | "deny"`}</pre>

          <p className="lp-section-sub lp-section-sub-wide" style={{marginTop: 24, textAlign: "center", maxWidth: 760, margin: "24px auto 0", fontSize: 15, color: "rgba(255,255,255,0.65)"}}>
            Same function for human stances and AI stances. Same function for within-land requests and cross-land requests. The protocol does not split authorization into separate cases — it splits stances and assigns them permissions per land.
          </p>
        </div>
      </section>

      {/* INPUTS BREAKDOWN */}
      <section className="lp-section lp-section-alt">
        <div className="lp-container">
          <h2 className="lp-section-title">The four inputs</h2>
          <p className="lp-section-sub lp-section-sub-wide" style={{textAlign: "center", maxWidth: 800, margin: "0 auto 28px"}}>
            Each verb call carries the four pieces the authorization function needs. They come from different parts of the request.
          </p>

          <div className="ibp-auth-inputs">
            <div className="ibp-auth-input">
              <div className="ibp-auth-input-num">1</div>
              <div className="ibp-auth-input-body">
                <div className="ibp-auth-input-head">Acting stance</div>
                <div className="ibp-auth-input-source">From the identity token</div>
                <p>The left side of the portal connection. Who is making the request. The kernel reads it from the identity token established by BE, or treats the requester as the land's arrival stance if no identity is present.</p>
              </div>
            </div>
            <div className="ibp-auth-input">
              <div className="ibp-auth-input-num">2</div>
              <div className="ibp-auth-input-body">
                <div className="ibp-auth-input-head">Target</div>
                <div className="ibp-auth-input-source">From the envelope's address field</div>
                <p>The right side of the portal connection. A Position (for SEE, DO) or a Stance (for SEE, TALK, BE). What is being addressed.</p>
              </div>
            </div>
            <div className="ibp-auth-input">
              <div className="ibp-auth-input-num">3</div>
              <div className="ibp-auth-input-body">
                <div className="ibp-auth-input-head">Verb and details</div>
                <div className="ibp-auth-input-source">From the envelope</div>
                <p>SEE, DO, TALK, or BE, plus the verb-specific specifics. The action name and payload namespace for DO. The message and intent for TALK. The operation for BE. Different details for different verbs.</p>
              </div>
            </div>
            <div className="ibp-auth-input">
              <div className="ibp-auth-input-num">4</div>
              <div className="ibp-auth-input-body">
                <div className="ibp-auth-input-head">Receiving land's configuration</div>
                <div className="ibp-auth-input-source">From the receiving land's metadata</div>
                <p>The permission rules the receiving land has configured for the acting stance. Read from <code>metadata.{`<stance>`}.permissions</code> at the Land Position. This is what gives the land sovereignty over access.</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* WHAT IT MAKES REAL */}
      <section className="lp-section">
        <div className="lp-container">
          <h2 className="lp-section-title">What it makes real</h2>
          <p className="lp-section-sub lp-section-sub-wide" style={{textAlign: "center", maxWidth: 800, margin: "0 auto 28px"}}>
            Before this layer exists, the protocol's claims about stances and lands are conceptual. With this layer in the kernel, the claims become operational behavior.
          </p>

          <div className="ibp-real-grid">
            <div className="ibp-real-card">
              <div className="ibp-real-head">Stances become first-class</div>
              <p>A stance is no longer just a label. It has enforced permissions. Whatever the land says a stance can do, the kernel makes true. The protocol's stance commitment is structural, not aspirational.</p>
            </div>
            <div className="ibp-real-card">
              <div className="ibp-real-head">Lands gain real sovereignty</div>
              <p>Each land's permission configuration defines its access policy. Different lands can be radically different in openness while running the same protocol. The protocol does not enforce a posture; it enforces whatever the land has set.</p>
            </div>
            <div className="ibp-real-card">
              <div className="ibp-real-head">Beings are checked too</div>
              <p>Beings invoking other beings through TALK flow through the same function. The protocol does not split "user requests" from "being requests" at the authorization layer; both are stance-bearing entities making verb calls.</p>
            </div>
            <div className="ibp-real-card">
              <div className="ibp-real-head">Federation has a substrate</div>
              <p>Cross-land authorization is just "the receiving land's authorization function checking the visitor's stance against its configuration." The infrastructure for federation already works; only the question of how stances get assigned across lands remains open.</p>
            </div>
          </div>
        </div>
      </section>

      {/* SAME SHAPE EVERY STANCE */}
      <section className="lp-section lp-section-alt">
        <div className="lp-container" style={{maxWidth: 900}}>
          <h2 className="lp-section-title">One shape for every stance</h2>
          <p className="lp-section-sub lp-section-sub-wide" style={{textAlign: "center", maxWidth: 760, margin: "0 auto 28px"}}>
            Arrival is the first stance every land has. It is not a special case. The same permission configuration shape works for any stance a land defines. Phase 5 ships arrival and owner as concrete protocol categories; additional vocabularies (guest, member, moderator, contributor) extend in Phase 7 against the same shape.
          </p>

          <pre className="lp-envelope-code" style={{maxWidth: 760, margin: "0 auto"}}>{`// at the Land Position
metadata.embodiments.arrival.permissions = { see, do, talk, be }
metadata.embodiments.owner.permissions   = { see, do, talk, be }

// Phase 7 extends with whatever the land defines:
//   metadata.embodiments.guest.permissions
//   metadata.embodiments.member.permissions
//   metadata.embodiments.moderator.permissions
//   ...

// Phase 5 verb shape (simple allow-lists per verb):
metadata.embodiments.<stance>.permissions = {
  see:  { allowed_visibility: ["public"] | [] },
  do:   { allowed_actions:    [] | ["action", ...] | "*" },
  talk: { allowed_targets:    [] | ["@embodiment", ...] | "*" },
  be:   { allowed_operations: ["register", "claim", "release", "switch"] }
}`}</pre>

          <p className="lp-section-sub lp-section-sub-wide" style={{marginTop: 24, maxWidth: 760, margin: "24px auto 0", fontSize: 15, color: "rgba(255,255,255,0.65)"}}>
            Same per-verb shape across every stance. Same authorize function reads each. Land owners shape the stance taxonomy that fits their land's character. The protocol stays uniform underneath.
          </p>

          <p className="lp-section-sub lp-section-sub-wide" style={{marginTop: 12, maxWidth: 760, margin: "12px auto 0", fontSize: 14, color: "rgba(255,255,255,0.55)"}}>
            For the arrival stance's permissions in concrete detail with phase markers and roadmap: see <a href="/ibp/arrival" style={{color: "#4ade80", borderBottom: "1px solid rgba(74, 222, 128, 0.35)", textDecoration: "none"}}>the arrival stance page</a>.
          </p>
        </div>
      </section>

      {/* TWO CASES THE AUTH FUNCTION HANDLES */}
      <section className="lp-section">
        <div className="lp-container" style={{maxWidth: 920}}>
          <h2 className="lp-section-title">Two cases the auth function handles</h2>
          <p className="lp-section-sub lp-section-sub-wide" style={{textAlign: "center", maxWidth: 800, margin: "0 auto 28px"}}>
            The acting-stance input to the auth function comes from one of two places, and that distinction is what arrival is actually for.
          </p>

          <div className="ibp-cases">
            <div className="ibp-case ibp-case-arrival">
              <div className="ibp-case-head">No identity token on the request</div>
              <p>The requester is a stranger to the protocol — no signed-in identity anywhere. The land treats them as <strong>arrival stance</strong> and looks up <code>metadata.embodiments.arrival.permissions</code> on its own configuration. This is what arrival is for: visitors with no identity at all.</p>
            </div>
            <div className="ibp-case ibp-case-identified">
              <div className="ibp-case-head">Identity token present on the request</div>
              <p>The requester is identified somewhere. The receiving land reads the identity and looks up its own policy for that identity. <strong>The visitor stays themselves</strong>. They don't get reset to arrival just because they crossed a land boundary. The land's policy decides what stance they hold here (member, contributor, default-guest, or whatever the land has configured).</p>
            </div>
          </div>

          <p className="lp-section-sub lp-section-sub-wide" style={{marginTop: 24, textAlign: "center", maxWidth: 800, margin: "24px auto 0", fontSize: 15, color: "rgba(255,255,255,0.65)"}}>
            Same function in both cases. Same configuration shape. The only thing that differs is which stance the function looks up.
          </p>
        </div>
      </section>

      {/* CROSS-LAND AND FEDERATION */}
      <section className="lp-section lp-section-alt">
        <div className="lp-container" style={{maxWidth: 880}}>
          <h2 className="lp-section-title">Authorization is local. Federation is separate.</h2>
          <p className="lp-section-sub lp-section-sub-wide">
            Two distinct design problems. The auth function answers "given this stance at this land, what's permitted?" Federation answers "given this identified visitor coming from elsewhere, what stance should this land assign?" Phase 5 commits to the first one. The second is Phase 8+ work that arrives when cross-land trust infrastructure is in place.
          </p>
          <p className="lp-section-sub lp-section-sub-wide">
            Phase 5 within-land. Each land authorizes its own people fully. Owner has full permissions at their land. Arrivals have whatever the arrival stance is configured for. Identified members of a land have the stance that land granted them. The kernel function works end-to-end for any request that arrives carrying an identity the land recognizes (or no identity, which routes to arrival).
          </p>
          <p className="lp-section-sub lp-section-sub-wide">
            Phase 8+ cross-land. When an identity carrying provenance from another land reaches this one, the receiving land needs a policy for how to recognize that identity and what stance to assign. This is identity portability, trust roots between lands, and stance-assignment policy. Those are real design problems and they don't change the auth function. They feed it.
          </p>
          <p className="lp-section-sub lp-section-sub-wide" style={{fontStyle: "italic", borderLeft: "3px solid rgba(74, 222, 128, 0.4)", paddingLeft: 24, color: "rgba(255,255,255,0.7)"}}>
            The auth layer asks: given this stance, what's permitted? It does not ask how the stance was assigned. That separation is what keeps federation work from forcing rewrites of the kernel authorization layer.
          </p>
        </div>
      </section>

      {/* WHY IT MATTERS */}
      <section className="lp-section">
        <div className="lp-container" style={{maxWidth: 800}}>
          <h2 className="lp-section-title">Why this is load-bearing</h2>
          <p className="lp-section-sub lp-section-sub-wide">
            Every verb call in the protocol flows through this function. Every visit to a position. Every mutation. Every message delivered to an inbox. Every identity operation. There is no path around it. It is the single point where the protocol's access policy is enforced.
          </p>
          <p className="lp-section-sub lp-section-sub-wide">
            This means three things matter especially. The semantics of the permission configuration language must be specified before any code, because every land writes against them. The function itself needs to be fast and well-tested, because it is on every request's hot path. The configurations land owners write are security policy, so tooling for "what can this stance actually do here" matters as much as the function itself.
          </p>
          <p className="lp-section-sub lp-section-sub-wide" style={{fontStyle: "italic", borderLeft: "3px solid rgba(74, 222, 128, 0.4)", paddingLeft: 24, color: "rgba(255,255,255,0.7)"}}>
            Different lands feel different because they configure differently. Portal Authorization is the layer that makes "configure differently" actually mean different behavior, not just different documentation.
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

export default AuthorizationPage;
