import { Link } from "react-router-dom";
import "./IbpPage.css";

/**
 * FactoryGraft. What moves between realities, and how. Two operations,
 * one distinction: a seed brings the SHAPE of a thing (fresh ids); a
 * graft brings the thing ITSELF (verbatim id and chain). Covers the four
 * partial graft shapes and the honest limit of identity recovery.
 *
 * Companion to FactoryRoots (the catalog and network) and FactoryIdentity
 * (why a key cannot be revoked). Roots carries content; graft carries
 * beings.
 *
 * Sources.
 *   /reality/philosophy/OS/GRAFT-AND-SEED.md           doctrine
 *   /reality/seed/materials/publish/graft.js           capture / apply / partials
 *   /reality/seed/materials/publish/seedTemplate.js    capture a seed (template)
 *   /reality/seed/materials/publish/seedPlant.js       plant a seed
 *   /reality/philosophy/OS/IDENTITY.md                 why a key cannot be revoked
 *   /reality/seed/present/roles/federation-manager/    the peer-to-peer move
 */
const FactoryGraft = () => {
  return (
    <article className="ns-doc">

      {/* ────────────────────────────────────────────────────────── */}
      {/* SECTION 1 . THE DISTINCTION                                 */}
      {/* ────────────────────────────────────────────────────────── */}
      <header className="ns-doc-header">
        <p className="ns-doc-eyebrow">Graft &amp; seed</p>
        <h1 className="ns-doc-title">Bring the thing, or bring the shape</h1>
        <p className="ns-doc-lede">
          Two realities can hand each other a piece of themselves. There
          are exactly two ways to do it, and the whole difference is
          identity. A seed brings the SHAPE of something, planted fresh
          with new ids. A graft brings the thing ITSELF, the same being
          with the same key and the same history, now living in two
          places at once. Everything else on this page is a detail of one
          of those two.
        </p>
      </header>

      {/* ────────────────────────────────────────────────────────── */}
      {/* SECTION 2 . TWO KINDS OF MOVEMENT                           */}
      {/* ────────────────────────────────────────────────────────── */}
      <section>
        <h2>Two kinds of movement</h2>
        <p>
          Two fundamentally different things move between realities, and
          they move in different ways.
        </p>
        <p>
          <strong>Content circulates.</strong> Code, models, assets,
          templates, behavioral patterns. Content is meant to be copied,
          used in many realities at once, found widely through the
          network. When a reality wants a new capability, it draws the
          content through{" "}
          <Link to="/factory/roots" className="ns-inline-link">Roots</Link>,
          the underground catalog. Content is public substance.
        </p>
        <p>
          <strong>Beings migrate.</strong> A being is an identity: a key
          bound to a history of acts. It is not copied; it continues. When
          a being moves, its actual identity travels and the chain of its
          history travels with it. Beings move directly between the two
          realities concerned, peer to peer, never through a catalog.
        </p>
        <aside className="ns-doc-aside">
          <p>
            Why the split is deliberate: a catalog holds things meant to be
            copied. Putting a being in a catalog would make the catalog a
            custodian of an identity, the exact custody this architecture
            refuses. Content is public substance; a being is sovereign
            identity. The transport differs because the things differ.
          </p>
        </aside>
      </section>

      {/* ────────────────────────────────────────────────────────── */}
      {/* SECTION 3 . SEED                                            */}
      {/* ────────────────────────────────────────────────────────── */}
      <section>
        <h2>A seed brings the shape</h2>
        <p>
          A seed is a template. Plant it and you create something NEW
          shaped like the template: fresh spaces, fresh beings, fresh
          structure, all native to your reality, with their own keys and a
          history that begins here. The seed is the pattern; the instance
          is yours.
        </p>
        <p>
          A template has an identity of its own, but a content kind: the
          hash of what it contains. Publish "the community template at hash
          X," verify you have the authentic one, version it explicitly. The
          author can sign the template to prove provenance, and every
          instance planted from it is sovereign, with its own ids, its own
          chain, its own authority. Author identity and instance
          sovereignty both hold.
        </p>
        <p>
          Placement is free. A seed can plant a whole new world at the
          reality root, or a subtree at an existing position inside a
          living reality, alongside everything already there.
        </p>
        <aside className="ns-doc-aside">
          <p>
            A seed never carries history or a key. No acts, no biography,
            no original ids. That loss is the point: shape without
            identity. If you want the history, you do not want a seed, you
            want a graft.
          </p>
        </aside>
      </section>

      {/* ────────────────────────────────────────────────────────── */}
      {/* SECTION 4 . GRAFT                                           */}
      {/* ────────────────────────────────────────────────────────── */}
      <section>
        <h2>A graft brings the thing itself</h2>
        <p>
          A graft moves a being WITH its identity intact: the same
          public-key id, the same signed act-chain, byte for byte as it was
          at home. No id remapping, no fresh keys. The being who arrives is
          the same being who left, and that is provable by the math, not by
          a record someone keeps.
        </p>
        <p>
          Imported history is foreign by construction, and this is what
          makes a graft safe. A fact's id folds in its branch and its home
          reality, so you cannot re-sign a fact or re-home it without it
          becoming a different fact with a different id. The chain lands
          verbatim or it does not land at all. Nobody can forge another
          being's past, and nobody can quietly alter a grafted one.
        </p>
        <aside className="ns-doc-aside">
          <p>
            Graft preserves; seed instantiates. This is also why a graft is
            migration and not a fresh start: grafting your old being brings
            your old key. If your key is the problem, a graft carries the
            problem with it. See the limit below.
          </p>
        </aside>
      </section>

      {/* ────────────────────────────────────────────────────────── */}
      {/* SECTION 5 . THE SHAPES OF A GRAFT                           */}
      {/* ────────────────────────────────────────────────────────── */}
      <section>
        <h2>The shapes of a graft</h2>
        <p>
          A graft can carry a being's whole life, or a coherent slice of
          it. What is partial is always the HISTORY, never the identity:
          the key is the same, the included acts verify, the being is
          unambiguously itself. There are five shapes.
        </p>
        <p>
          <strong>Full graft.</strong> The being's complete chain. Every
          act it ever took, every branch, all its matter and relationships,
          verbatim. This is migration with everything intact, the being now
          living in the new reality with its full biography.
        </p>
        <p>
          And four partials, for when you do not want the whole chain.
        </p>
        <div className="ns-grammar">
          <div className="ns-grammar-row">
            <code className="ns-grammar-form">genesis-prefix</code>
            <span className="ns-grammar-meaning">
              from birth up to a cutoff. It carries the being's birth, so it
              folds into a living being; a later graft merges the rest of
              the history onto it.
            </span>
          </div>
          <div className="ns-grammar-row">
            <code className="ns-grammar-form">checkpoint-segment</code>
            <span className="ns-grammar-meaning">
              a recent slice, anchored at a signed checkpoint. "Here is my
              last hundred acts, provably mine, without my whole life." A
              verifiable reference, not a full life.
            </span>
          </div>
          <div className="ns-grammar-row">
            <code className="ns-grammar-form">single-branch</code>
            <span className="ns-grammar-meaning">
              one fork's worth of activity, anchored at the fork point, with
              the branch lineage carried so the receiver can verify just
              that slice. "Bring one project's work."
            </span>
          </div>
          <div className="ns-grammar-row">
            <code className="ns-grammar-form">state-snapshot</code>
            <span className="ns-grammar-meaning">
              no history at all. A signed photo of the being's current
              state, trusted without replaying any chain. The lightest
              possible transfer: who I am now, attested.
            </span>
          </div>
        </div>
        <aside className="ns-doc-aside">
          <p>
            The first three are verified by walking the included facts and
            confirming they reproduce their own hashes, anchored where the
            slice begins. The state-snapshot is the one exception to "the
            place is folded from facts": it lands as an attested state with
            no backing chain, the state-level twin of an imported fact being
            foreign by construction. If the real chain arrives later, it
            supersedes the snapshot.
          </p>
        </aside>
      </section>

      {/* ────────────────────────────────────────────────────────── */}
      {/* SECTION 6 . BEINGS DO NOT USE ROOTS                         */}
      {/* ────────────────────────────────────────────────────────── */}
      <section>
        <h2>Why beings never go through a catalog</h2>
        <p>
          A being is singular. Copy it and you do not have two of someone;
          you have one being and a fork that is no longer them. You cannot
          mass-distribute an identity. So a graft is never a catalog entry.
          It runs over a direct, sealed connection between exactly the two
          realities concerned, and the move is recorded honestly in both
          chains: the source records that the being left, the destination
          records that it arrived.
        </p>
        <p>
          {" "}
          <Link to="/factory/roots" className="ns-inline-link">Roots</Link>{" "}
          catalogs content meant to be copied. Graft carries beings peer to
          peer. The two operations have different shapes because they carry
          different things, and the boundary between them is the boundary
          between public substance and sovereign identity.
        </p>
      </section>

      {/* ────────────────────────────────────────────────────────── */}
      {/* SECTION 7 . THE LIMIT                                       */}
      {/* ────────────────────────────────────────────────────────── */}
      <section>
        <h2>A lost key is not a graft</h2>
        <p>
          There is no key rotation and no recovering a being in place. The
          key IS the id, so you cannot swap the key underneath the id, and
          you cannot un-publish a public key. A reality can stop honoring a
          key on its own ground, but the holder keeps the key, and every
          other reality verifies that key self-certifyingly, with no
          authority to push a revocation to. A lost or stolen key is final
          for that being.
        </p>
        <p>
          The honest recovery is simple and needs no special primitive: you
          birth a NEW being, a fresh key, and bring forward whatever you
          choose by ordinary acts. That is birth plus a seed of what you
          want to carry, not a graft. Grafting your old self would only
          re-import the compromised key. A fresh start wants a fresh key, by
          definition.
        </p>
        <aside className="ns-doc-aside">
          <p>
            This boundary is the cost of the model's strength, not a gap in
            it. The same self-certifying identity that lets anyone verify
            you anywhere, with no gatekeeper, is the property that makes a
            leaked key impossible to revoke. You keep the strength and you
            accept the limit. See{" "}
            <Link to="/factory/identity" className="ns-inline-link">Identity</Link>{" "}
            for why the key and the id are one object.
          </p>
        </aside>
      </section>

      {/* ────────────────────────────────────────────────────────── */}
      {/* SECTION 8 . WHEN TO USE WHAT                                */}
      {/* ────────────────────────────────────────────────────────── */}
      <section>
        <h2>When to use what</h2>
        <p>
          The choice comes from knowing what you want to move and whether
          identity should survive the move.
        </p>
        <div className="ns-grammar">
          <div className="ns-grammar-row">
            <code className="ns-grammar-form">extension</code>
            <span className="ns-grammar-meaning">
              add a capability to your reality. A resource, drawn through Roots.
            </span>
          </div>
          <div className="ns-grammar-row">
            <code className="ns-grammar-form">seed</code>
            <span className="ns-grammar-meaning">
              start a world, or a subtree, shaped like a template. Fresh ids,
              history begins here. Publish one as a resource through Roots.
            </span>
          </div>
          <div className="ns-grammar-row">
            <code className="ns-grammar-form">full graft</code>
            <span className="ns-grammar-meaning">
              move your being to a new home with its whole life intact. Peer
              to peer.
            </span>
          </div>
          <div className="ns-grammar-row">
            <code className="ns-grammar-form">single-branch graft</code>
            <span className="ns-grammar-meaning">
              hand off one project's history, anchored at its fork.
            </span>
          </div>
          <div className="ns-grammar-row">
            <code className="ns-grammar-form">checkpoint-segment graft</code>
            <span className="ns-grammar-meaning">
              share recent history, provably yours, without your whole life.
            </span>
          </div>
          <div className="ns-grammar-row">
            <code className="ns-grammar-form">state-snapshot graft</code>
            <span className="ns-grammar-meaning">
              share just your current state, signed, with no chain.
            </span>
          </div>
          <div className="ns-grammar-row">
            <code className="ns-grammar-form">new being</code>
            <span className="ns-grammar-meaning">
              a lost or compromised key. There is no recovery; make a fresh
              one and carry forward what you choose.
            </span>
          </div>
        </div>
      </section>

      {/* ────────────────────────────────────────────────────────── */}
      {/* CLOSING NAV                                                 */}
      {/* ────────────────────────────────────────────────────────── */}
      <nav className="ns-doc-aside">
        <p>
          Previous.{" "}
          <Link to="/factory/roots" className="ns-inline-link">Roots</Link>.
          Where realities meet underground and content circulates.
          <br />
          Next.{" "}
          <Link to="/factory/intake" className="ns-inline-link">1. Intake</Link>.
          A summon arrives in the being's inbox and the cycle begins.
        </p>
      </nav>
    </article>
  );
};

export default FactoryGraft;
