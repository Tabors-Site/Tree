import { Link } from "react-router-dom";
import "./IbpPage.css";

/**
 * FactoryRoots. Where realities meet underground.
 *
 * Roots are nodes of The Root System, the underground network where
 * realities find each other and share resources. A Roots node is a TreeOS
 * reality running the store + peering packs (post-split), not a separate
 * server. Browsing is SEE, publishing is DO, every publish and delist is
 * a fact on a reel.
 *
 * Sources.
 *   /reality/philosophy/OS/ROOTS.md             umbrella doctrine
 *   /reality/philosophy/OS/STORE.md             catalog doctrine
 *   /reality/philosophy/OS/PEERING.md           directory doctrine
 *   /reality/resources/store/                   the store resource pack
 *   /reality/resources/peering/                 the peering resource pack (scaffold)
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
          network that connects trees in a forest. Every reality has
          two things built in: a <strong>localStore</strong> (the CAS of
          its owned bytes) and the substrate wire that lets it talk to
          anyone whose address it knows. On top of those, a reality
          chooses two optional packs: <strong>peering</strong> (be
          discoverable in a peer directory) and <strong>store</strong>
          {" "}(host a publishable catalog). Plant either, both, or
          neither. The forest is whatever trees choose to connect.
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
          A "Roots node" is shorthand for a reality running both opt-in
          packs: the <strong>store</strong> pack (hosts a publishable
          catalog) and the <strong>peering</strong> pack (registers in a
          peer directory). They were one bundle until split — now you
          can plant either independently:
        </p>
        <ul className="ns-list">
          <li>
            <strong>Store only.</strong> Hosts a catalog reachable by
            anyone with the address, but not in any directory. Useful
            for private/internal stores, family realities, internal
            company hosting.
          </li>
          <li>
            <strong>Peering only.</strong> Findable in directories;
            offers no catalog. A discoverable participant.
          </li>
          <li>
            <strong>Both.</strong> The full Roots-node shape:
            discoverable AND publishes a catalog.
          </li>
          <li>
            <strong>Neither.</strong> A private reality. Substrate
            federation still works — anyone with your address can
            reach you — but you're not in directories and you publish
            nothing. The default after first boot.
          </li>
        </ul>
        <p>
          Whichever packs you plant, the substrate guarantees apply:
        </p>

        <ul className="ns-list">
          <li>
            <strong>The protocol IS the API.</strong> Browsing is SEE.
            Publishing is DO. There is no second wire dialect to
            maintain; both packs inherit every hardening the wire
            already has: canopy signatures, being signatures, sealed
            sessions, replay refusal.
          </li>
          <li>
            <strong>"Anyone can run one" means "plant a reality."</strong>{" "}
            Both packs ship as resources published through Roots. The
            distribution story distributes itself.
          </li>
          <li>
            <strong>Operating a Roots node grants nothing.</strong> A
            Roots operator holds the keys of their own reality and no
            one else's. The catalog they host is other realities'
            signed work. The worst a dishonest operator can do is
            decline to show something, and another node will show it.
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
   name, version, kind, publisher, signature,
   requires (dependency edges), hash of every asset
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
          A resource is anything that flows through Roots from tree to
          tree for new abilities. The substrate exposes one primitive,{" "}
          <code>resource</code>, with typed KINDS. Each kind ships its own
          manifest shape and registers with a kind-specific registry when
          it installs. The kind registry is open: new kinds are added
          without changing the catalog or the wire. Six kinds today.
        </p>

        <ul className="ns-list">
          <li>
            <strong><code>code</code>.</strong> Substrate code that gives a
            reality new abilities: DO ops, cognition handlers for roles,
            hooks, routes, jobs. This is what used to be called an
            "extension."
          </li>
          <li>
            <strong><code>role</code>.</strong> A standalone role spec
            (canSee, canDo, canSummon, canBe, prompt), pure data. It runs on
            the default LLM cognition unless a <code>code</code> resource
            registers a handler for it by name.
          </li>
          <li>
            <strong><code>roleflow</code>.</strong> Composition data: an
            ordered set of clauses that compose roles per moment from world
            state. It references the roles it composes by name.
          </li>
          <li>
            <strong><code>seed</code>.</strong> A structural template, a
            shell world of spaces, matter, and beings that gets planted at a
            chosen position with fresh ids. (Distinct from a graft, which
            moves an existing being verbatim. See{" "}
            <Link to="/factory/graft" className="ns-inline-link">Graft &amp; seed</Link>.)
          </li>
          <li>
            <strong><code>asset</code>.</strong> Standalone owned bytes:
            models, sounds, large data. Hash-addressed; other resources
            reference them by hash through the content door.
          </li>
          <li>
            <strong><code>pack</code>.</strong> The meta-kind. A group of
            resources that travel together as one unit, like an npm package.
            A pack has no content of its own beyond a manifest that names its
            pieces. What used to be one "extension" (roots, harmony) is now a
            pack of pieces: code plus the roles it hosts plus the seeds it
            plants. Drawing a pack pulls every member of its closure.
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
      {/* SECTION 4a . WHY THIS SHAPE                                 */}
      {/* ────────────────────────────────────────────────────────── */}
      <section>
        <h2>The kernel is fixed; abilities arrive as resources</h2>
        <p>
          The whole shape follows from one decision: the kernel stays
          small and sovereign and never grows. The four verbs, the fold,
          the chain, and identity are fixed. What grows is the set of open
          registries behind them, and every registry is a seam a resource
          can register into.
        </p>

        <div className="ns-grammar">
          <div className="ns-grammar-row">
            <code className="ns-grammar-form">registerOperation</code>
            <span className="ns-grammar-meaning">new DO verbs of meaning</span>
          </div>
          <div className="ns-grammar-row">
            <code className="ns-grammar-form">registerMatterType</code>
            <span className="ns-grammar-meaning">new nouns, new kinds of matter</span>
          </div>
          <div className="ns-grammar-row">
            <code className="ns-grammar-form">registerRole</code>
            <span className="ns-grammar-meaning">new actors</span>
          </div>
          <div className="ns-grammar-row">
            <code className="ns-grammar-form">registerSeeOperation</code>
            <span className="ns-grammar-meaning">new perceptions</span>
          </div>
          <div className="ns-grammar-row">
            <code className="ns-grammar-form">hooks</code>
            <span className="ns-grammar-meaning">new reactions at lifecycle points</span>
          </div>
          <div className="ns-grammar-row">
            <code className="ns-grammar-form">cognition handlers</code>
            <span className="ns-grammar-meaning">new minds behind a role</span>
          </div>
        </div>

        <p>
          A <code>code</code> resource is just "something that registers
          into those seams." A role, roleflow, seed, or asset is "something
          the seams already know how to plant or store." So you never fork
          the kernel to add an ability. You draw a resource, and Roots makes
          that ability portable tree to tree. The kind registry being open
          means even a seam nobody has imagined yet gets a kind.
        </p>

        <p>
          Two edges keep "anything" precise rather than hand-wavy.
        </p>

        <h3>New abilities, not new physics</h3>
        <p>
          You can bring anything that composes from the primitives: a new
          op, a new matter type, a new role, new structure, new bytes. You
          cannot bring anything that breaks them. There is no seam to make
          facts mutable, skip signing, add a fifth verb, or change the hash
          rule. Those are invariants, not extension points. "Anything" means
          anything expressible in the four verbs and the fold, which is
          enormous, but it has a floor, and that floor is what keeps every
          drawn-in ability safe to run.
        </p>

        <h3>The power gradient is the trust gradient</h3>
        <p>
          Code actually executes: its <code>init(reality)</code> runs in
          your process, so it is the powerful and the dangerous kind, which
          is exactly why it is publisher-signed, hash-verified, and only
          runs because the operator chose to draw it. The other kinds are
          pure data. A role, a seed, a roleflow, an asset can only ever do
          what the registries already permit, so they are safe by
          construction no matter who authored them. Power scales with trust,
          and the resource model makes that gradient explicit instead of
          hiding it.
        </p>

        <aside className="ns-doc-aside">
          <p>
            <strong>The tree is the kernel; the resources are everything it
            has learned to do.</strong> The core stays sovereign and small,
            every ability lives outside it as a signed, verifiable resource,
            and a reality becomes whatever set of resources it has drawn.
          </p>
        </aside>
      </section>

      {/* ────────────────────────────────────────────────────────── */}
      {/* SECTION 4b . THE DEPENDENCY GRAPH                           */}
      {/* ────────────────────────────────────────────────────────── */}
      <section>
        <h2>Resources form a verified dependency graph</h2>
        <p>
          Resources reference each other through a <code>requires</code>{" "}
          manifest, and those edges form a graph. Draw a roleflow and you
          pull the roles it composes, which pull the code that hosts them,
          which pull the assets they use. A pack is just a named root whose
          closure is the whole pack. Grouping is not a folder layout; it is
          the transitive closure of the graph.
        </p>
        <p>
          Each edge names a kind and a ref, and a ref is one of two things,
          the same pointer-or-hash split that versions use, now as
          dependency edges.
        </p>

        <div className="ns-grammar">
          <div className="ns-grammar-row">
            <code className="ns-grammar-form">sha256:&lt;hash&gt;</code>
            <span className="ns-grammar-meaning">
              an exact, reproducible-forever reference. A dependency named by
              hash can never be tampered or swapped, so the supply-chain
              attack by dependency substitution is structurally impossible.
            </span>
          </div>
          <div className="ns-grammar-row">
            <code className="ns-grammar-form">publisher/name@range</code>
            <span className="ns-grammar-meaning">
              a flexible pointer that follows the publisher's claims, so
              fixes flow. Authors write against pointers; install resolves
              the closure and freezes it to a hash-locked set.
            </span>
          </div>
        </div>

        <p>
          The frozen set is the lockfile. Re-resolving a reality's resources
          is an explicit, auditable act that stamps a fact on the reality's
          reel, never silent drift, so the chain records "this reality moved
          from hash set A to hash set B at time T."
        </p>
        <p>
          Two integrity questions stay separate, so a broken dependency
          always resolves to exactly one of them.
        </p>

        <ul className="ns-list">
          <li>
            <strong>Resolvable</strong> is the cryptographic question: does
            every hash in the closure name content that verifies? Always
            answerable locally, by hashing the bytes.
          </li>
          <li>
            <strong>Available</strong> is the network question: will some
            Roots node actually serve those bytes? This can genuinely fail
            (a dependency delisted everywhere, no mirror left), and more
            Roots nodes are the only mitigation. It is the same availability
            concern the Roots trust model already carries.
          </li>
        </ul>

        <p>
          Install is atomic per closure. A reality draws a resource,
          resolves the full closure, fetches every member by hash, verifies
          each, and installs in dependency order: assets first, then code,
          then roles, then the roleflows that compose them. Any missing or
          failing dependency refuses the entire install. There is no
          half-installed state.
        </p>

        <p>
          A catalog listing carries the resource's <code>kind</code> and its{" "}
          <code>requires</code>, plus a status the registrar computes by
          walking those dependencies against its own catalog:{" "}
          <code>complete</code> when every dependency is reachable through
          this Roots node, <code>incomplete</code> when the listing is real
          but installs will fail until the missing pieces land, or{" "}
          <code>delisted</code>. Lying about dependencies is detectable at
          publish time, before any reality draws the resource.
        </p>
      </section>

      {/* ────────────────────────────────────────────────────────── */}
      {/* SECTION 4c . WHAT THIS UNLOCKS                              */}
      {/* ────────────────────────────────────────────────────────── */}
      <section>
        <h2>Borrow freely, and the part that stays hard</h2>
        <p>
          Because a dependency is a hash, signed, and verified the moment it
          lands, borrowing is safe by construction, and that is the quiet
          win. In an npm or a plugin store, pulling in someone's code is a
          supply-chain gamble: you are trusting a mutable version that can
          change under you. Here the version you depend on cannot change,
          cannot be swapped, and is checked on arrival. "Borrow freely" is
          honest instead of a risk, which removes the tax that normally makes
          people reluctant to compose at all.
        </p>

        <p>Three real unlocks follow.</p>
        <ul className="ns-list">
          <li>
            <strong>Assembly over authoring.</strong> Most building becomes
            wiring verified pieces together: a roleflow naming the roles it
            composes, a seed naming the code it needs, instead of writing
            from scratch.
          </li>
          <li>
            <strong>Redefine without forking.</strong> Take someone's role,
            change it, republish under your own key, and your version is its
            own sovereign resource, not a fork drifting from an upstream you
            have to chase. Each redefinition is just another keyed thing in
            the catalog.
          </li>
          <li>
            <strong>No kernel fork, ever.</strong> You never hit the wall of
            "to do X I have to patch the core." Every ability is a resource,
            so the frontier stays open without touching anything
            load-bearing.
          </li>
        </ul>

        <p>
          But the protocol does not make composition automatically easy. It
          makes it possible and safe. Three things decide whether it feels
          like building blocks or a junk drawer, and none of them are the
          protocol.
        </p>
        <ul className="ns-list">
          <li>
            <strong>Semantic fit.</strong> A hash guarantees you got the
            exact bytes you asked for. It does not guarantee the role
            actually does what the roleflow expects. Versions pin bytes, not
            behavior. Mechanical composition gets easier; judging whether
            pieces truly fit stays human, and it leans entirely on clean,
            documented interfaces: what a role expects, what an op's params
            are.
          </li>
          <li>
            <strong>Granularity.</strong> More small pieces means more edges.
            For someone who knows the landscape that is leverage; for a
            newcomer, fifty tiny resources to assemble can be harder than one
            monolith that just works. Composability rewards the person who
            already knows the pieces.
          </li>
          <li>
            <strong>Discovery and curation.</strong> "Borrow anything" only
            helps if you can find the right one. Ten thousand listings need
            search, examples, reputation, and good default packs, or
            abundance becomes paralysis. That is portal and convention work,
            not protocol work.
          </li>
        </ul>

        <aside className="ns-doc-aside">
          <p>
            <strong>The honest split is by who.</strong> For people
            assembling from known-good pieces, especially behind solid packs
            and templates, this is much easier, and safe borrowing is a
            genuine and underrated win. For people at the frontier writing
            new code resources, it makes distributing and composing their
            work far easier, but the creative work itself is unchanged. The
            architecture made the pieces verifiable, portable, and sovereign;
            whether mix-and-match feels effortless is then decided by
            interface discipline and curation, the conventions grown on top.
          </p>
        </aside>
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
          canopy wire, the cross reality verbs. The roots resource
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
            can run one that emphasizes scientific resources and
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
          <Link to="/factory/graft" className="ns-inline-link">
            Graft &amp; seed
          </Link>
          . What moves between realities: bring the thing, or bring
          the shape.
        </p>
      </nav>
    </article>
  );
};

export default FactoryRoots;
