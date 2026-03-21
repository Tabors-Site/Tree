
import "./LandAbout.css";

const LandAbout = () => {
  return (
    <div className="about-land">
      <div className="lnd-card">

        {/* BACK */}
        <div className="al-page-back">
          <a className="al-back-link" href="/about">&#8592;</a>
        </div>

        {/* HEADER */}
        <div className="lnd-header">
          <h2 className="lnd-title">🌍 Land and Canopy</h2>
          <p className="lnd-subtitle">
            TreeOS is a decentralized network. Each server is a Land. Lands
            connect through the Canopy protocol. Anyone can run their own Land
            and join the network.
          </p>
        </div>

        {/* WHAT IS A LAND */}
        <div className="lnd-section">
          <div className="lnd-section-title">
            <span className="lnd-section-icon">🏔️</span> What is a Land?
          </div>
          <div className="lnd-section-text">
            A Land is a single instance of the TreeOS application. Your own
            server, your own database, your own users, your own trees. It contains it own
            LLM connections, its own background jobs, its own orchestration processes, its own Skills/Tools, and manages its own
            energy limits.
            <br /><br />
            Think of it like email. Your Land is your mail server. You can
            communicate with anyone on any other Land, but your data stays on
            yours. No central authority owns the network.
          </div>
        </div>

        {/* NAMING */}
        <div className="lnd-section">
          <div className="lnd-section-title">
            <span className="lnd-section-icon">🏷️</span> Naming
          </div>
          <div className="lnd-name-grid">
            <div className="lnd-name-item">
              <div className="lnd-name-label">Tree</div>
              <div className="lnd-name-desc">A single knowledge structure</div>
            </div>
            <div className="lnd-name-item">
              <div className="lnd-name-label">Land</div>
              <div className="lnd-name-desc">The server where trees grow</div>
            </div>
            <div className="lnd-name-item">
              <div className="lnd-name-label">Canopy</div>
              <div className="lnd-name-desc">The protocol connecting lands</div>
            </div>
            <div className="lnd-name-item">
              <div className="lnd-name-label">Directory</div>
              <div className="lnd-name-desc">A phonebook for land discovery</div>
            </div>
          </div>
        </div>

        {/* HOW CANOPY WORKS */}
        <div className="lnd-section">
          <div className="lnd-section-title">
            <span className="lnd-section-icon">🌿</span> How Canopy Works
          </div>
          <div className="lnd-section-text">
            Each Land generates a unique cryptographic identity on first boot
            (an Ed25519 keypair). When two Lands connect, they exchange public
            keys. After that, all requests between them are signed and verified.
            No one can impersonate your Land.
          </div>
          <div className="lnd-flow">
            <div className="lnd-flow-step">
              <div className="lnd-flow-num">1</div>
              <div className="lnd-flow-text">Land A adds Land B as a peer</div>
            </div>
            <div className="lnd-flow-step">
              <div className="lnd-flow-num">2</div>
              <div className="lnd-flow-text">Both exchange public keys</div>
            </div>
            <div className="lnd-flow-step">
              <div className="lnd-flow-num">3</div>
              <div className="lnd-flow-text">Users can now invite each other to trees</div>
            </div>
            <div className="lnd-flow-step">
              <div className="lnd-flow-num">4</div>
              <div className="lnd-flow-text">All interaction uses the same API, proxied between lands</div>
            </div>
          </div>
        </div>

        {/* CROSS LAND COLLAB */}
        <div className="lnd-section">
          <div className="lnd-section-title">
            <span className="lnd-section-icon">🤝</span> Cross-Land Collaboration
          </div>
          <div className="lnd-section-text">
            Inviting someone from another Land works like inviting a local user.
            Type <code>username@domain</code> in the invite field. That's it.
            Your Land handles the rest: peering with the remote Land if needed,
            resolving the user, sending the invite through the Canopy protocol.
            <br /><br />
            When the remote user accepts, a "ghost user" is created on your
            Land. This is a lightweight record (just their ID and <code>isRemote: true</code>)
            that gets added to the tree's contributor list. The existing
            permission system works unchanged. No special cases.
            <br /><br />
            The remote user interacts with your tree through their own Land's
            API. Their Land proxies the request to yours with a signed token.
            They never create an account on your server. They never see your
            frontend. They just use their own tools, their own Land, and the
            tree shows up in their list alongside their local trees.
          </div>
        </div>

        {/* THE PROXY CHAIN */}
        <div className="lnd-section">
          <div className="lnd-section-title">
            <span className="lnd-section-icon">🔗</span> How the Proxy Works
          </div>
          <div className="lnd-section-text">
            When a user interacts with a remote tree, the request chain is:
          </div>
          <div className="lnd-flow">
            <div className="lnd-flow-step">
              <div className="lnd-flow-num">1</div>
              <div className="lnd-flow-text">User's client sends request to their home Land (normal auth)</div>
            </div>
            <div className="lnd-flow-step">
              <div className="lnd-flow-num">2</div>
              <div className="lnd-flow-text">Home Land signs a CanopyToken on behalf of the user</div>
            </div>
            <div className="lnd-flow-step">
              <div className="lnd-flow-num">3</div>
              <div className="lnd-flow-text">Home Land forwards the request to the tree's Land</div>
            </div>
            <div className="lnd-flow-step">
              <div className="lnd-flow-num">4</div>
              <div className="lnd-flow-text">Tree's Land verifies the token, finds the ghost user, runs the route normally</div>
            </div>
          </div>
          <div className="lnd-section-text" style={{ marginTop: 12 }}>
            The user's client (browser, CLI, mobile app, script) never needs
            to know about Canopy. It talks to one URL. The proxy is invisible.
            This works with any client that speaks the API.
          </div>
        </div>

        {/* GHOST USERS */}
        <div className="lnd-section">
          <div className="lnd-section-title">
            <span className="lnd-section-icon">👻</span> Ghost Users
          </div>
          <div className="lnd-section-text">
            A ghost user is a User record with <code>isRemote: true</code> and
            a <code>homeLand</code> field pointing to their home domain. It has
            the same UUID as the real user on their home Land. No password, no
            email, no settings.
            <br /><br />
            Ghost users exist so the API doesn't need special cases. Every route
            checks <code>req.userId</code> against the tree's owner and contributor
            list. Ghost users are in that list. The permission check is identical
            for local and remote users.
            <br /><br />
            If you remove a remote user from your tree's contributors, they lose
            all access instantly. If you block their entire Land, all ghost users
            from that Land are locked out because CanopyToken verification fails.
          </div>
        </div>

        {/* THE API IS THE NETWORK */}
        <div className="lnd-section">
          <div className="lnd-section-title">
            <span className="lnd-section-icon">🌐</span> The API is the Network
          </div>
          <div className="lnd-section-text">
            The REST API under <code>/api/v1/</code> and the Canopy protocol
            under <code>/canopy/</code> are the contract. Every Land that
            speaks this contract is compatible. The nodes, trees, values,
            contributions, notes, all of the context structure stays the same
            across every Land.
            <br /><br />
            Everything deeper (how AI places nodes, how dreams work, how
            orchestrators run, what frontend you build) is yours. You can
            build completely custom AI systems, custom UIs, custom pipelines.
            As long as the context structure and API stay consistent, it all
            connects. This is a network for context, and the API is the glue.
          </div>
        </div>

        {/* NETWORK GROWTH */}
        <div className="lnd-section">
          <div className="lnd-section-title">
            <span className="lnd-section-icon">🌱</span> How the Network Grows
          </div>
          <div className="lnd-section-text">
            Lands don't need to be pre-connected. The network grows organically
            from collaboration. The first time a user invites someone from
            another Land, the two Lands peer automatically (via the directory
            or direct URL). After that, they stay connected and monitor each
            other's health.
            <br /><br />
            The directory service is optional. It's a phonebook that makes
            discovery easier. If it goes down, peered Lands keep working.
            Eventually, Lands could discover each other peer to peer without
            any central service at all.
          </div>
        </div>

        {/* WHAT YOU CONTROL */}
        <div className="lnd-section">
          <div className="lnd-section-title">
            <span className="lnd-section-icon">🎛️</span> What You Control
          </div>
          <div className="lnd-section-text">
            Everything behind the API is yours. Lands in the network can run
            completely different code internally. The API shape and the Canopy
            protocol are the contract that holds the network together.
            Everything else is customizable.
          </div>
          <div className="lnd-control-grid">
            <div className="lnd-control-item lnd-control-yours">
              <div className="lnd-control-label">Yours to change</div>
              <ul>
                <li>Prompts</li>
                <li>Orchestrators</li>
                <li>Frontend and UI</li>
                <li>Background job behavior</li>
                <li>Energy limits and pricing</li>
                <li>Billing and payments</li>
                <li>Gateway integrations</li>
              </ul>
            </div>
            <div className="lnd-control-item lnd-control-locked">
              <div className="lnd-control-label">Stays the same</div>
              <ul>
                <li>REST API shape</li>
                <li>Canopy protocol endpoints</li>
                <li>Data model structure</li>
                <li>Authentication format</li>
              </ul>
            </div>
          </div>
        </div>

        {/* SECURITY */}
        <div className="lnd-section">
          <div className="lnd-section-title">
            <span className="lnd-section-icon">🔒</span> Security
          </div>
          <div className="lnd-section-text">
            All cross-land requests are signed with Ed25519 keypairs. The tree's
            Land is always authoritative: it controls permissions and validates
            access. A remote Land can prove its users' identity but cannot grant
            itself permissions. Tokens expire after 5 minutes. Lands can block
            peers and remove remote contributors at any time.
          </div>
        </div>

        {/* START YOUR OWN */}
        <div className="lnd-section">
          <div className="lnd-section-title">
            <span className="lnd-section-icon">🚀</span> Start Your Own Land
          </div>
          <div className="lnd-section-text">
            Clone the repo, set your domain and MongoDB connection, and run
            <code>node server.js</code>. Your Land generates its identity
            on first boot and is ready to go. Connect to the directory to be
            discoverable, or peer manually with other lands you know.
          </div>
          <div className="lnd-code-block">
            <code>
              git clone &lt;repo-url&gt; treeos<br />
              cd treeos/land<br />
              cp ../.env.example ../.env<br />
              npm install<br />
              node server.js
            </code>
          </div>
          <div className="lnd-section-text lnd-note" style={{ marginTop: 16 }}>
            Self-hosted lands default to unlimited energy. Users bring their own LLM connections.
            No dependencies on any central service.
          </div>
        </div>

        {/* CTA */}
        <div className="lnd-cta">
          <a className="lnd-cta-btn" href="/about">Back to About</a>
        </div>

      </div>
    </div>
  );
};

export default LandAbout;
