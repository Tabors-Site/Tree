
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
            When someone on another Land invites you to their tree, a
            "ghost user" is created on their Land for you. This is a
            lightweight record that lets the existing permission system work
            unchanged. You interact with their tree through your own Land's
            API. Your Land proxies the request. You never need to create an
            account on their server.
            <br /><br />
            Your identity across the network is <code>username@domain</code>,
            like email. Your data always stays on your Land. Remote users
            access your trees through the API, they don't get copies.
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
