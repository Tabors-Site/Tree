import "./LandingPage.css";
import "./Governing.css";
import Particles from "./Particles.jsx";

// ArrivalPage. /ibp/arrival
//
// Deep-dive on the arrival stance: the per-land configurable stance that
// every unestablished visitor inhabits before they BE-register or BE-claim.
// Linked from the main /ibp page so the main page stays scannable.

const ArrivalPage = () => {
  return (
    <div className="lp lp-gov">

      {/* HERO */}
      <section className="lp-hero">
        <Particles count={20} />
        <div className="lp-hero-inner">
          <div className="lp-tree-icon">🚪</div>
          <h1 className="lp-title">The arrival stance</h1>
          <p className="lp-subtitle">Every visitor, before they identify</p>
          <p className="lp-tagline">
            For visitors who are strangers to the protocol. No signed-in
            identity anywhere. A regular stance, not a protocol special case.
            Every land that speaks IBP runs one, with permissions configured
            per land. That single configuration surface covers the full
            spectrum from a fully closed personal land to a fully open public
            space.
          </p>
          <p className="lp-tagline" style={{marginTop: 14, fontSize: 14.5, color: "rgba(255,255,255,0.6)"}}>
            Note. Arrival is <em>not</em> what happens when an identified
            visitor reaches a different land. Identities carry across lands;
            the receiving land's policy assigns the visitor a stance other
            than arrival. <a href="/ibp/authorization" style={{color: "#4ade80", textDecoration: "none", borderBottom: "1px solid rgba(74, 222, 128, 0.35)"}}>How the layer handles that →</a>
          </p>
          <div className="lp-hero-ctas lp-hero-ctas-sub">
            <a className="lp-btn lp-btn-secondary" href="/ibp">Back to IBP</a>
            <a className="lp-btn lp-btn-secondary" href="/seed">The Seed</a>
            <a className="lp-btn lp-btn-secondary" href="/governing">Governing</a>
          </div>
        </div>
      </section>

      {/* THE BOOTSTRAP RULE */}
      <section className="lp-section">
        <div className="lp-container" style={{maxWidth: 880}}>
          <h2 className="lp-section-title">One protocol rule, then everything is land config</h2>
          <p className="lp-section-sub lp-section-sub-wide" style={{textAlign: "center", maxWidth: 760, margin: "0 auto 28px"}}>
            IBP makes exactly two structural commitments about arrival. Beyond these, every land decides for itself what an arrival can see, do, or say.
          </p>

          <div className="ibp-arrival-rules">
            <div className="ibp-arrival-rule">
              <div className="ibp-arrival-rule-num">1</div>
              <div className="ibp-arrival-rule-body">
                <strong>Every land has an arrival stance.</strong> Required so unestablished visitors have something to be. Without it, an anonymous request would have no stance to attach to and no permissions to check against.
              </div>
            </div>
            <div className="ibp-arrival-rule">
              <div className="ibp-arrival-rule-num">2</div>
              <div className="ibp-arrival-rule-body">
                <strong>BE addressed at the auth-being is always permitted from an arrival.</strong> The bootstrap rule. Without this, an arrival could never register or claim, and could never become anything other than an arrival.
              </div>
            </div>
          </div>

          <p className="lp-section-sub lp-section-sub-wide" style={{marginTop: 24, textAlign: "center", maxWidth: 760, margin: "24px auto 0", fontSize: 15, color: "rgba(255,255,255,0.65)"}}>
            That's it. SEE, DO, TALK, and every other BE operation are <strong>land-configured</strong>. Permission for an arrival to do any of them is whatever metadata the land has set for the arrival stance.
          </p>
        </div>
      </section>

      {/* THE PERMISSION SPECTRUM */}
      <section className="lp-section lp-section-alt">
        <div className="lp-container">
          <h2 className="lp-section-title">The configuration spectrum</h2>
          <p className="lp-section-sub lp-section-sub-wide" style={{textAlign: "center", maxWidth: 800, margin: "0 auto 28px"}}>
            One configuration surface (the arrival stance's permissions per verb) covers the full range from "completely closed" to "fully open." Land owners pick where on the spectrum their land sits.
          </p>

          <div className="ibp-spectrum">
            <div className="ibp-spectrum-row">
              <div className="ibp-spectrum-label ibp-spectrum-label-closed">Closed</div>
              <div className="ibp-spectrum-name">Private personal land</div>
              <div className="ibp-spectrum-desc">BE-claim only (login by the owner). BE-register disabled. SEE, DO, TALK all denied. Nothing is visible to arrivals. Useful for personal installations or private workspaces.</div>
            </div>
            <div className="ibp-spectrum-row">
              <div className="ibp-spectrum-label ibp-spectrum-label-closed">Closed</div>
              <div className="ibp-spectrum-name">Invite-only community</div>
              <div className="ibp-spectrum-desc">BE-register requires an invite code (or is disabled). BE-claim available for existing members. SEE limited to a public "about" surface, or nothing. Private communities, research environments, internal lands.</div>
            </div>
            <div className="ibp-spectrum-row">
              <div className="ibp-spectrum-label ibp-spectrum-label-mid">Middle</div>
              <div className="ibp-spectrum-name">Public profiles, sign-in for participation</div>
              <div className="ibp-spectrum-desc">Arrival can SEE positions with <code>visibility: public</code> (introduction, what kind of place it is, what beings live here, public artifacts). To do anything beyond viewing requires BE-register or BE-claim. Common pattern for community sites that want discoverability without anonymous interaction.</div>
            </div>
            <div className="ibp-spectrum-row">
              <div className="ibp-spectrum-label ibp-spectrum-label-mid">Middle</div>
              <div className="ibp-spectrum-name">Open browsing, sign-in for engagement</div>
              <div className="ibp-spectrum-desc">Broader SEE: arrivals can browse everything marked public. Still can't TALK or DO until they sign in. Useful for content-oriented lands like a publication, a research archive, a public garden.</div>
            </div>
            <div className="ibp-spectrum-row">
              <div className="ibp-spectrum-label ibp-spectrum-label-mid">Middle</div>
              <div className="ibp-spectrum-name">Limited interaction without sign-in</div>
              <div className="ibp-spectrum-desc">Arrival gets specific DO permissions at specific scopes. Leave a guestbook entry, submit an inquiry, fill out a contact form. The land lets visitors interact in bounded ways without requiring registration.</div>
            </div>
            <div className="ibp-spectrum-row">
              <div className="ibp-spectrum-label ibp-spectrum-label-open">Open</div>
              <div className="ibp-spectrum-name">Public-facing beings reachable</div>
              <div className="ibp-spectrum-desc">Arrival can TALK to specific public-facing beings named in <code>allowed_targets</code> (a greeter, help desk, guide). Still can't reach private beings. The land has public beings as part of its surface for unauthenticated visitors.</div>
            </div>
            <div className="ibp-spectrum-row">
              <div className="ibp-spectrum-label ibp-spectrum-label-open">Open</div>
              <div className="ibp-spectrum-name">Fully open community</div>
              <div className="ibp-spectrum-desc">Arrival has near-full permissions: SEE public, DO with <code>allowed_actions: "*"</code>, TALK with <code>allowed_targets: "*"</code>. Sign-in is optional and just for persistence and identity. Useful for very open community spaces.</div>
            </div>
          </div>
        </div>
      </section>

      {/* CONFIGURATION SHAPE */}
      <section className="lp-section">
        <div className="lp-container" style={{maxWidth: 900}}>
          <h2 className="lp-section-title">Configuration shape</h2>
          <p className="lp-section-sub lp-section-sub-wide" style={{textAlign: "center", maxWidth: 760, margin: "0 auto 28px"}}>
            The arrival stance's permissions live in the land's metadata under the embodiment namespace. Each verb gets its own simple allow rule. The kernel checks them on every request from an arrival.
          </p>

          <pre className="lp-envelope-code" style={{maxWidth: 760, margin: "0 auto"}}>{`// at the Land Position
metadata.embodiments.arrival.permissions = {
  see:  { allowed_visibility: ["public"] },
  do:   { allowed_actions: [] },
  talk: { allowed_targets: [] },
  be:   { allowed_operations: ["register", "claim"] }
}

// land-level BE flags read by the auth-being
metadata.auth.register_enabled = true
metadata.auth.claim_enabled    = true`}</pre>

          <p className="lp-section-sub lp-section-sub-wide" style={{marginTop: 20, maxWidth: 760, margin: "20px auto 0", fontSize: 14.5, color: "rgba(255,255,255,0.7)"}}>
            <strong>What this shape supports.</strong> SEE on positions whose <code>visibility</code> field is in the allow list (the Node schema already carries <code>visibility</code>). DO actions restricted to a named list, or <code>"*"</code> for all, or <code>[]</code> for none. TALK targeted at a named embodiment list (<code>"@auth"</code>, <code>"@guide"</code>), or <code>"*"</code>, or <code>[]</code>. BE operations restricted to a subset of <code>register / claim / release / switch</code>.
          </p>

          <p className="lp-section-sub lp-section-sub-wide" style={{marginTop: 12, maxWidth: 760, margin: "12px auto 0", fontSize: 14, color: "rgba(255,255,255,0.55)"}}>
            The shape extends in place as lands surface needs for richer rule semantics: glob path matching, conflict resolution between overlapping rules, per-action scope-and-namespace constraints. Same metadata namespace, richer rule shape.
          </p>

          <div className="ibp-auth-link" style={{maxWidth: 760, margin: "20px auto 0"}}>
            The same configuration shape works for every stance a land defines. The kernel function that reads it and enforces it is <strong>Portal Authorization</strong>. <a href="/ibp/authorization">See how the layer works →</a>
          </div>
        </div>
      </section>

      {/* TEMPLATES */}
      <section className="lp-section lp-section-alt">
        <div className="lp-container" style={{maxWidth: 920}}>
          <h2 className="lp-section-title">Deployment templates</h2>
          <p className="lp-section-sub lp-section-sub-wide" style={{textAlign: "center", maxWidth: 760, margin: "0 auto 28px"}}>
            Most lands fall into a small number of recognizable patterns. The TreeOS reference implementation ships templates so installers don't have to author arrival permissions from scratch. The defaults are conservative; pick a template to open up.
          </p>

          <div className="ibp-templates">
            <div className="ibp-template ibp-template-closed">
              <div className="ibp-template-head">Personal home</div>
              <div className="ibp-template-line">SEE: denied</div>
              <div className="ibp-template-line">DO: denied</div>
              <div className="ibp-template-line">TALK: denied</div>
              <div className="ibp-template-line">BE: claim only (register disabled)</div>
              <div className="ibp-template-desc">Your own land for personal use. Nothing visible to arrivals. Only you log in.</div>
            </div>
            <div className="ibp-template ibp-template-mid">
              <div className="ibp-template-head">Community</div>
              <div className="ibp-template-line">SEE: public surfaces</div>
              <div className="ibp-template-line">DO: denied</div>
              <div className="ibp-template-line">TALK: @auth, @host</div>
              <div className="ibp-template-line">BE: register, claim</div>
              <div className="ibp-template-desc">Multi-user land. Public profile content visible. Anyone can register or claim. Participation requires sign-in.</div>
            </div>
            <div className="ibp-template ibp-template-open">
              <div className="ibp-template-head">Public service</div>
              <div className="ibp-template-line">SEE: public surfaces</div>
              <div className="ibp-template-line">DO: bounded (forms, guestbook)</div>
              <div className="ibp-template-line">TALK: public beings (greeter, support)</div>
              <div className="ibp-template-line">BE: register, claim</div>
              <div className="ibp-template-desc">Service-oriented land. Visitors can interact in bounded ways without signing in. Sign-in optional for richer access.</div>
            </div>
          </div>
        </div>
      </section>

      {/* GENERALIZES */}
      <section className="lp-section">
        <div className="lp-container" style={{maxWidth: 800}}>
          <h2 className="lp-section-title">The architectural pattern this expresses</h2>
          <p className="lp-section-sub lp-section-sub-wide">
            The arrival stance is not a special protocol concept. It is just a stance whose permissions a land happens to configure for "someone who has arrived but hasn't been welcomed." The same authorization layer that checks any other stance's permissions checks the arrival stance.
          </p>
          <p className="lp-section-sub lp-section-sub-wide">
            This means the protocol commits to almost nothing about arrivals (two rules, see above) and pushes all the variation to the land's configuration. The web's flexibility comes partly from HTTP being minimal and HTML/CSS/JS handling all the expressiveness above. IBP follows the same pattern. The substrate stays small; the lands handle their own character.
          </p>
          <p className="lp-section-sub lp-section-sub-wide">
            The same architectural move applies to other stances a land might define. A "guest" stance for recognized visitors with ongoing presence. A "member" stance for full participants. A "moderator," "contributor," "owner." Each is an embodiment with permissions. Land owners shape the taxonomy that fits their land's character. The protocol stays uniform underneath.
          </p>
          <p className="lp-section-sub lp-section-sub-wide" style={{fontStyle: "italic", borderLeft: "3px solid rgba(74, 222, 128, 0.4)", paddingLeft: 24, color: "rgba(255,255,255,0.7)"}}>
            Different lands feel different because they configure differently, not because the protocol has different modes.
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

export default ArrivalPage;
