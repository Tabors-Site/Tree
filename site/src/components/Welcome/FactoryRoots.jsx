import { Link } from "react-router-dom";
import "./IbpPage.css";

/**
 * FactoryRoots. Where realities meet underground.
 *
 * Roots are nodes of The Root System, the underground network where
 * realities find each other and share resources. A Roots node is a TreeOS
 * reality running an extension, not a separate server. Browsing is SEE,
 * publishing is DO, every publish and delist is a fact on a reel.
 *
 * Sources.
 *   /reality/philosophy/OS/ROOTS.md             doctrine
 *   /reality/extensions/roots/                  the roots extension
 *   /reality/protocols/ibp/peers.js             peer record shape
 *   /reality/philosophy/OS/IDENTITY.md          why keys make this verifiable
 *   /reality/philosophy/OS/GRAFT-AND-SEED.md    what moves between realities
 */
const FactoryRoots = () => {
  return (
    <article className="ns-doc">

      {/* ────────────────────────────────────────────────────────── */}
      {/* SECTION 1 . THE METAPHOR                                    */}
      {/* ────────────────────────────────────────────────────────── */}
      <header className="ns-doc-header">
        <p className="ns-doc-eyebrow">Roots</p>
        <h1 className="ns-doc-title">Where realities meet underground</h1>
        <p className="ns-doc-lede">
          A reality is a tree. The Root System is the underground
          network that connects trees in a forest. Roots are the nodes
          of that network: realities that run an extension so other
          realities can find them and share resources with them. Any
          reality can plant roots. None has to. The forest is whatever
          trees choose to connect.
        </p>
      </header>

      {/* ────────────────────────────────────────────────────────── */}
      {/* WHY THIS MATTERS                                            */}
      {/* ────────────────────────────────────────────────────────── */}
      <section>
        <h2>Why this matters</h2>
        <p>
          You can find software, communities, and other realities
          without asking permission from a corporate gatekeeper. The
          Root System is a forest of mirrors. No one of them can stop a
          publisher from being found elsewhere. The work you publish
          stays yours; you signed it; nobody can edit it or pretend
          it's theirs. If one Roots node disappears, the next one over
          still has what was published.
        </p>
        <p>
          The shorter version: discovery without a gatekeeper, hosting
          without a custodian, deletion without erasure. The math gives
          this to you structurally.
        </p>
      </section>

      {/* ────────────────────────────────────────────────────────── */}
      {/* SECTION 2 . A ROOTS NODE IS A REALITY                       */}
      {/* ────────────────────────────────────────────────────────── */}
      <section>
        <h2>A Roots node is a reality, not a server</h2>
        <p>
          A Roots node is a TreeOS reality running the{" "}
          <code>roots</code> extension. The catalog is spaces and
          matter. Publishers are peer realities. Every publish and
          every delist is a fact on a reel, so the catalog's entire
          history is audited by construction.
        </p>
        <p>
          One decision buys the rest of the architecture.
        </p>

        <ul className="ns-list">
          <li>
            <strong>The protocol IS the API.</strong> Browsing is SEE.
            Publishing is DO. There is no second wire dialect to
            maintain, and the directory inherits every hardening the
            wire already has: canopy signatures, being signatures,
            sealed sessions, replay refusal.
          </li>
          <li>
            <strong>"Anyone can run one" means "plant a reality."</strong>{" "}
            The roots extension itself ships as a resource published
            through Roots. The distribution story distributes itself.
          </li>
          <li>
            <strong>Operating a Roots node grants nothing.</strong> A
            Roots operator holds the keys of their own reality and no
            one else's. The catalog they host is other realities'
            signed work. The worst a dishonest operator can do is
            decline to show something, and another Roots node will
            show it.
          </li>
        </ul>
      </section>

      {/* ────────────────────────────────────────────────────────── */}
      {/* SECTION 3 . CATALOG VS BYTES                                */}
      {/* ────────────────────────────────────────────────────────── */}
      <section>
        <h2>Catalog through IBP, bytes through the content door</h2>
        <p>
          Inside a reality the rule is: facts carry references, never
          bytes. Owned bytes live content-addressed in CAS. A Roots
          node extends the same rule across the wire.
        </p>

        <pre className="ns-code">{`IBP envelope carries the MANIFEST
   name, version, publisher, signature,
   dependency list, hash of every asset
                ↓
content door moves the BYTES
   fetched by hash, verified by hashing on arrival
`}</pre>

        <p>
          So "everything through IBP" means every act of publishing,
          browsing, resolving, and delisting is an IBP verb. It does
          not mean binary blobs ride inside envelopes. The envelope
          names the bytes. The content door moves them. The hash
          proves them. See{" "}
          <Link to="/factory/integrity" className="ns-inline-link">
            Integrity
          </Link>{" "}
          for the content addressing primitive this rests on.
        </p>
      </section>

      {/* ────────────────────────────────────────────────────────── */}
      {/* SECTION 4 . RESOURCES                                        */}
      {/* ────────────────────────────────────────────────────────── */}
      <section>
        <h2>Resources flow through The Root System</h2>
        <p>
          A "resource" is the umbrella word for anything Roots
          catalogs. Resources are content. They are hash-addressed,
          signed by their publisher, and meant to be drawn into other
          realities. Three shapes today.
        </p>

        <ul className="ns-list">
          <li>
            <strong>Extensions.</strong> A code bundle plus its owned
            matter (models, sounds, other assets). The manifest names
            every asset by hash; the assets are CAS blobs any Roots
            node can mirror. A reality that draws an extension gains
            the abilities the extension provides.
          </li>
          <li>
            <strong>Seeds.</strong> A template of structure: a shell
            world that takes fresh ids when planted. Distinct from a
            graft, which moves an existing reality verbatim.
          </li>
          <li>
            <strong>Roleflows.</strong> A template of behavior:
            composition data over the role machinery realities
            already run. A roleflow declares which roles compose and
            how, with a <code>requires</code> manifest naming the
            extensions that provide them. Install resolves the
            manifest by pulling each requirement by hash.
          </li>
        </ul>

        <aside className="ns-doc-aside">
          <p>
            <strong>The template is content-addressed; the entity is
            key-addressed.</strong> Resources are content (they get
            hashes). Beings are agents (they get keys). Roots catalogs
            content. Grafts move agents peer to peer.
          </p>
        </aside>

        <p>
          <strong>Versioning is hashing.</strong> Every version of
          anything is a new hash, immutable forever. The mutable layer
          is a name pointer, a publisher-signed claim that "the
          current <code>food@1.x</code> is hash H." Moving the pointer
          is a new signed claim. The old hash never stops being the
          old version.
        </p>
        <p>
          <strong>A publisher can lie only about pointers, and
          provably.</strong> Nothing prevents a publisher from signing
          two conflicting claims for the same name and version. But
          installs pull by hash, so equivocation can confuse a choice,
          never the content chosen. And pointer claims chain: each new
          claim references the hash of the claim before it, so two
          claims with one parent are a visible fork. Equivocation is
          detectable by any mirror and damages exactly one thing: the
          publisher's name.
        </p>
        <p>
          <strong>Names are publisher-scoped.</strong> There is no
          global namespace to squat. A name means{" "}
          <code>(publisher, name)</code>, where the publisher is a
          reality identity. Roots nodes index names. They never
          arbitrate them. Two publishers can both ship a{" "}
          <code>food</code>; the catalog shows whose is whose, and the
          publisher signature proves it.
        </p>
        <p>
          <strong>Retirement is a pointer state, not a deletion.</strong>{" "}
          A publisher marks a listing unmaintained, or points at a
          successor, with the same signed pointer machinery. That is
          distinct from delisting (one Roots node declining to show)
          and from decay (mirrors hold bytes per their own retention;
          what the network stops caring about fades from availability).
          The hash never stops naming what it names. Only the bytes'
          reach ages.
        </p>
      </section>

      {/* ────────────────────────────────────────────────────────── */}
      {/* SECTION 5 . THE CATALOG REFUSES GRAFTS                      */}
      {/* ────────────────────────────────────────────────────────── */}
      <section>
        <h2>The catalog refuses grafts</h2>
        <p>
          A graft is not content. It is an agent: a being's key and
          chain, meant for continuing, not for copying. A public
          catalog of grafts would make Roots nodes custodians of
          identities and biographies, exactly the custody this
          architecture refuses.
        </p>

        <aside className="ns-doc-aside">
          <p>
            <strong>Roots catalogs resources. Grafts move peer to
            peer, over the sealed canopy wire, between the two
            realities concerned, and nowhere else.</strong>
          </p>
        </aside>

        <p>
          Two narrow graft-adjacent services are legitimate, and
          neither is a catalog.
        </p>

        <ul className="ns-list">
          <li>
            <strong>Discovery.</strong> Pointers, not chains. "Being X
            is home at reality Y." "Reality Z accepts graft offers." A
            pointer leaks no history and grants no custody.
          </li>
          <li>
            <strong>Encrypted escrow.</strong> When two realities are
            not online at the same moment, a sender may park a graft
            bundle at a Roots node encrypted to the receiving
            reality's key. The Roots node stores bytes it cannot read,
            addressed to exactly one key, deleted on pickup or expiry.
            Opaque storage, never a listing.
          </li>
        </ul>
      </section>

      {/* ────────────────────────────────────────────────────────── */}
      {/* SECTION 6 . PEERS FIND EACH OTHER                           */}
      {/* ────────────────────────────────────────────────────────── */}
      <section>
        <h2>Peers find each other here</h2>
        <p>
          Federation needs a meeting point. That is Roots' second job:
          the peer directory. A peer record is small and self-signed.
        </p>

        <pre className="ns-code">{`peer record = {
  realityId,    // the public key of the reality
  baseUrl,      // where to reach it
  lastSeen,     // when it last refreshed
}
   signed by the reality it describes
`}</pre>

        <p>
          Because a <code>realityId</code> IS that reality's public key,
          the directory cannot lie in any way that matters.
        </p>

        <ul className="ns-list">
          <li>
            Point you at a wrong <code>baseUrl</code> and the canopy
            handshake fails immediately. Whoever answers there cannot
            sign as that key.
          </li>
          <li>
            Forge a record outright and the record's own signature
            fails.
          </li>
          <li>
            The only lie available is omission, hiding a peer, and any
            other Roots node can tell the truth.
          </li>
        </ul>

        <p>
          Realities register themselves with the Roots nodes they
          choose, refresh their own records, and check each other's
          liveness with an ordinary SEE ping. First contact needs no
          key ceremony. Knowing the peer record is knowing the key.
        </p>
        <p>
          A peer record is an attestation, not an endorsement. It says
          "I exist, here," signed by the one who exists. Storing it
          vouches for nothing. Because registering costs only a
          signature, the directory will accumulate dead and junk
          records over time. Roots nodes prune what stops answering
          (housekeeping, not curation), and discovery filters on
          freshness. Spam can clutter a directory. It cannot
          counterfeit one.
        </p>
      </section>

      {/* ────────────────────────────────────────────────────────── */}
      {/* SECTION 7 . PLANTING ROOTS                                   */}
      {/* ────────────────────────────────────────────────────────── */}
      <section>
        <h2>Any reality can plant roots</h2>
        <p>
          Every reality already has the federation half: peering, the
          canopy wire, the cross reality verbs. The roots extension
          adds the directory half: serve a catalog, serve peer
          records, mirror other Roots nodes. Any existing reality can
          switch the role on and become a Roots node. Serving is
          opt-in (a directory is a public service with storage and
          bandwidth costs). Querying is universal. Every reality is a
          Roots client, able to ask any Roots node and register itself
          with the ones it chooses.
        </p>
        <p>
          On first boot, the planting flow asks whether to plant this
          tree with roots. Saying yes plants the catalog at the
          reality root and connects this reality to The Root System.
          Saying no leaves this reality isolated, which is a valid
          configuration. The decision is reversible later.
        </p>

        <h3>The first hello</h3>
        <p>
          A fresh reality knows nobody. Every decentralized network
          solves this the same way: ship a short list of well-known
          addresses as defaults, overridable by the operator. This
          centralizes introduction and nothing else. The default is a
          door you may knock on first, not an authority.
        </p>
        <p>
          SEE any one Roots node's peer space and you receive every
          record it holds. You verify each record yourself against its
          signature, so the introducer needs no trust at all. Cache
          what you learned, and your own peer list IS your directory
          from then on. The well-known address is never load-bearing
          again. Knowing one peer is knowing the network.
        </p>

        <h3>Neighborhoods, not one world view</h3>
        <p>
          Roots nodes choose what they mirror, and exclusion is their
          one lever. The network is overlapping neighborhoods rather
          than one guaranteed global catalog. Any entry point shows
          you its neighborhood; two entry points show you the union.
          That is the design working, not failing. The more Roots
          nodes, the wider the overlap.
        </p>

        <h3>If the defaults go bad</h3>
        <p>
          The well-known list ships in the reality's config alongside
          the seed code and updates the way code updates. Any operator
          can override it. A captured default cannot forge records,
          alter listings, or impersonate anyone, because everything it
          serves still self-certifies. What it can do is blind, by
          showing a partial network. The breakers are plural defaults
          (independent operators, so the views union) and out-of-band
          introduction (paste any peer's address directly). One honest
          hello from anywhere ends the eclipse. The exposure is real
          but narrow: introduction, briefly, and nothing else.
        </p>
      </section>

      {/* ────────────────────────────────────────────────────────── */}
      {/* SECTION 8 . MANY ROOTS, ONE TRUST MODEL                     */}
      {/* ────────────────────────────────────────────────────────── */}
      <section>
        <h2>Many Roots nodes, one trust model</h2>
        <p>
          Roots nodes mirror each other. Catalog records are
          publisher-signed and hash-addressed. Peer records are
          self-signed. Syncing them between Roots nodes is trivially
          safe: copy, verify, serve. More Roots nodes means more
          availability and less centrality at zero added trust cost.
          That is the whole reason the answer to "how many Roots
          nodes?" is "the more the better."
        </p>
        <p>
          Honestly, expect a power law. A few well-resourced Roots
          nodes will hold most of the catalog with good uptime. A long
          tail of small mirrors will hold slices of it. The
          architecture does not promise flatness. It promises
          replaceability. No Roots node is required, switching is one
          config line, and the big ones stay honest precisely because
          leaving them is cheap.
        </p>

        <aside className="ns-doc-aside">
          <p>
            <strong>A Roots node vouches for availability, never
            authenticity.</strong> Authenticity travels with the
            artifact (the publisher signature, the content hash, the
            reality key) and is checked by the receiver, every time,
            no matter which Roots node served it.
          </p>
        </aside>

        <p>
          Governance follows from this. A Roots node's only lever is
          exclusion. It can decline to list. Name that plainly:
          inclusion is an editorial power, and exercising it shapes
          discoverability. But it touches nothing about truth. A Roots
          node cannot alter what it lists (hashes break), cannot
          impersonate a publisher (signatures break), and cannot
          reach into any reality (it holds no keys but its own).
          Delisting from one Roots node is not erasure from the
          network. It is one mirror declining to mirror. Hidden work
          is unaltered work, visible elsewhere.
        </p>
      </section>

      {/* ────────────────────────────────────────────────────────── */}
      {/* SECTION 9 . WHY OPERATE A ROOTS NODE                        */}
      {/* ────────────────────────────────────────────────────────── */}
      <section>
        <h2>Why operate a Roots node</h2>
        <p>
          Running a Roots node costs something real. Storage scales
          with what you mirror: tens of gigabytes for a modest mirror,
          potentially terabytes for a comprehensive one. Bandwidth is
          outbound on every fetch. Uptime is an obligation once people
          rely on you. Maintenance is the usual operational work of
          running infrastructure.
        </p>
        <p>
          The benefits accrue to operators who have specific reasons
          to host, not to every individual user. The architecture does
          not require everyone to run a Roots node. It requires that
          some do.
        </p>

        <ul className="ns-list">
          <li>
            <strong>Sovereign control over what you mirror.</strong>{" "}
            You decide what your node holds. A scientific community
            can run one that emphasizes scientific extensions and
            filters out games. A creative community can do the
            opposite. You are not consuming someone else's catalog;
            you are shaping what your community sees.
          </li>
          <li>
            <strong>Reliable mirror access to what you depend on.</strong>{" "}
            If your reality depends on certain resources, mirroring
            them means you do not depend on someone else's uptime. You
            host the access you need.
          </li>
          <li>
            <strong>Discovery point for your own ecosystem.</strong>{" "}
            If you publish multiple resources, running a Roots node
            makes you the natural place to find your work. Visitors
            see your full catalog and discover related publications.
          </li>
          <li>
            <strong>Federation hub for peers you care about.</strong>{" "}
            A Roots node also holds peer records. Running one makes
            you a meeting point for realities in your sphere.
          </li>
          <li>
            <strong>Local optimization.</strong> A Roots node near you
            geographically or network-topologically serves your users
            faster than reaching across the world.
          </li>
          <li>
            <strong>Resilience contribution.</strong> Each new mirror
            makes the network harder to take down. For operators who
            care about decentralization concretely, hosting one is the
            way to express it.
          </li>
        </ul>
      </section>

      {/* ────────────────────────────────────────────────────────── */}
      {/* SECTION 10 . TRUST ACCUMULATES                              */}
      {/* ────────────────────────────────────────────────────────── */}
      <section>
        <h2>Trust accumulates in the chain</h2>
        <p>
          A Roots node is a reality. Every publish, delist, mirror,
          and peer registration is a signed fact on its reel. The
          catalog history is the chain itself. So the operator's
          behavior is recorded by the same machinery that records
          everything else in the world.
        </p>
        <p>
          A Roots node that has been running consistently for years,
          with steady mirroring and transparent curation, accumulates
          a visible track record. That track record is data other
          realities can read. Choosing which Roots nodes to query,
          which to default to, which to federate with, becomes a
          choice informed by chain history rather than corporate
          brand.
        </p>

        <ul className="ns-list">
          <li>
            <strong>Curation is accountable.</strong> When a Roots
            node delists something, the delisting is a signed act in
            the node's chain. Pattern of curation, including
            controversial calls, is observable forever.
          </li>
          <li>
            <strong>Uptime is observable.</strong> Liveness checks and
            cross-attestations between operators leave their own facts
            on chains, and those facts are countable.
          </li>
          <li>
            <strong>Commitments are publishable.</strong> A Roots node
            can publish its curation principles or service-level
            promises as signed claims. Whether those promises hold up
            over time is a question the chain answers.
          </li>
        </ul>

        <p>
          This is different from how trust works in centralized
          systems. There, trust in directories comes from corporate
          identity, legal accountability, and market reputation, all
          of which concentrate trust at the top of a hierarchy. Here,
          trust comes from accumulated, signed, replayable history.
          Distributed, but verifiable rather than felt.
        </p>

        <aside className="ns-doc-aside">
          <p>
            <strong>Running a Roots node over time builds something
            real:</strong> not corporate brand, not money, but
            verifiable accumulated contribution to network
            infrastructure. The chain records what you have done.
          </p>
        </aside>
      </section>

      {/* ────────────────────────────────────────────────────────── */}
      {/* SECTION 11 . THE UNIFIED PICTURE                            */}
      {/* ────────────────────────────────────────────────────────── */}
      <section>
        <h2>The unified picture</h2>
        <p>
          Identity is a key. Acts are signed by it. Content is named
          by its hash. The chain records both. Roots are where these
          pieces meet the public network: a catalog of publishable
          resources, addressed by the same hashes their consumers
          verify; a directory of peer realities, addressed by the same
          keys their visitors verify. A Roots node does not mediate
          trust. It carries content from one signing party to another.
        </p>
        <p>
          The whole point of the reality model is to make verification
          structural rather than social. Roots inherit that work. A
          directory that cannot lie about identity, cannot tamper with
          content, and cannot capture history is what the cryptographic
          primitives already enable, applied to the network's
          discovery layer.
        </p>
      </section>

      {/* ────────────────────────────────────────────────────────── */}
      {/* CLOSING NAV                                                 */}
      {/* ────────────────────────────────────────────────────────── */}
      <nav className="ns-doc-aside">
        <p>
          Previous.{" "}
          <Link to="/factory/identity" className="ns-inline-link">
            Identity
          </Link>
          . Beings and realities as wallets; the keys that make Roots
          verifiable.
          <br />
          Next.{" "}
          <Link to="/factory/intake" className="ns-inline-link">
            1. Intake
          </Link>
          . A summon arrives in the being's inbox and the cycle
          begins.
        </p>
      </nav>
    </article>
  );
};

export default FactoryRoots;
