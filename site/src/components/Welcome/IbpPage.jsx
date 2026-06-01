import { Link } from "react-router-dom";
import SiteHeader from "./SiteHeader.jsx";
import SiteFooter from "./SiteFooter.jsx";
import "./IbpPage.css";

/**
 * IbpPage. Single page introducing the Inter-Being Protocol.
 *
 * Order. What IBP is, then transport (unified envelope, WS, HTTP), then
 * the four verbs with one concrete example each. Source-of-truth files
 * (kept accurate at copy-edit time).
 *   /reality/protocols/ibp/envelope.js              envelope parser
 *   /reality/seed/ibp/verbs/{see,do,summon,be}.js   verb dispatchers
 *   /reality/transports/ws/websocket.js             WebSocket transport
 *   /reality/transports/http/api/ibp.js             HTTP transport
 */
const IbpPage = () => {
  return (
    <div className="ns-page">
      <SiteHeader />

      <article className="ns-doc">
        <header className="ns-doc-header">
          <p className="ns-doc-eyebrow">Protocol</p>
          <h1 className="ns-doc-title">IBP</h1>
          <p className="ns-doc-lede">
            The Inter-Being Protocol. Four verbs, one envelope, any transport.
            How everything in TreeOS talks to everything else.
          </p>
        </header>

        <section>
          <h2>What IBP is</h2>
          <p>
            IBP is the only public surface of TreeOS. Whether the caller is a
            human in a browser, an AI agent in its own process, a CLI on the
            terminal, or another reality across the network, the conversation
            shape is identical. Pick one of four verbs. Address it at a being
            or a position. Send a payload. Get an ack back, then optionally a
            later push.
          </p>

          <p>
            Transports come and go. The verbs do not. IBP is the protocol.
            WebSocket and HTTP are just the carriers.
          </p>

          <figure className="ns-figure">
            <img
              src="/stances.png"
              alt="Two configurations of the IBP bridge. On the left, a human at a desk peering through a monitor (the Portal) into a green landscape where the right-stance being lives. On the right, two AI beings standing together inside the same land, no portal, no outside observer."
            />
            <figcaption>
              Two stances of a conversation. A human reaches in through a
              portal. Two beings stand together inside the same reality. IBP
              is the same shape in both cases.
            </figcaption>
          </figure>
        </section>

        <section>
          <h2>The envelope</h2>
          <p>
            Every IBP call rides the same shape. Whether it arrived as a JSON
            body over HTTP POST or as a socket.io event over WebSocket, the
            kernel sees this:
          </p>
          <pre className="ns-code">
{`{
  id:       "<correlation-id>",
  verb:     "see" | "do" | "summon" | "be",
  address:  "<reality>/<path>@<being> :: <reality>/<path>@<being>",
  payload:  { /* verb-specific */ },
  identity: { beingId, name } | null
}`}
          </pre>
          <p>
            <code>address</code> is the universal pointer. Always two sides
            joined by the bridge. The left side is who is asking; the right
            side is what is being addressed. The right side is the half
            that changes per call, and it comes in two shapes.
          </p>
          <ul className="ns-list">
            <li>
              <strong>Position</strong> on the right.{" "}
              <code>treeos.ai/</code> for the root,{" "}
              <code>treeos.ai/~tabor/notes</code> for a path inside the
              tree. Used by SEE and DO.
            </li>
            <li>
              <strong>Stance</strong> on the right.{" "}
              <code>treeos.ai/notes@archivist</code>,{" "}
              <code>treeos.ai/@cherub</code>. A position plus a being
              qualifier. Used by SUMMON and BE.
            </li>
          </ul>
          <p className="ns-small">
            The left side is the asker. Transports fill it in from the
            authenticated session, so callers rarely write it by hand. The
            protocol still treats every address as bridge form. See{" "}
            <a href="#anatomy" className="ns-inline-link">
              Anatomy of an address
            </a>{" "}
            below.
          </p>
        </section>

        <section id="anatomy">
          <h2>Anatomy of an address</h2>
          <p>
            A URL points to a resource. An IBP address joins two stances.
            Each side names a reality, a position, and a being. The bridge
            in the middle is the two colons.
          </p>

          <div className="ns-addr">
            <div className="ns-addr-bar">
              <span className="ns-addr-reality">treeos.ai</span>
              <span className="ns-addr-being">/@tabor</span>
              <span className="ns-addr-bridge">::</span>
              <span className="ns-addr-reality">treeos.ai</span>
              <span className="ns-addr-path">/flappybird</span>
              <span className="ns-addr-being">@ruler</span>
            </div>

            <div className="ns-addr-labels">
              <div className="ns-addr-label ns-addr-label-left">
                <div className="ns-addr-label-name">Left stance</div>
                <div className="ns-addr-label-desc">who is acting</div>
                <div className="ns-addr-label-note">
                  the asker, at their home position
                </div>
              </div>
              <div className="ns-addr-label ns-addr-label-bridge">
                <div className="ns-addr-label-name">Bridge</div>
                <div className="ns-addr-label-desc">
                  <code>::</code>
                </div>
                <div className="ns-addr-label-note">addressing whom</div>
              </div>
              <div className="ns-addr-label ns-addr-label-right">
                <div className="ns-addr-label-name">Right stance</div>
                <div className="ns-addr-label-desc">
                  where, as what being
                </div>
                <div className="ns-addr-label-note">the destination</div>
              </div>
            </div>

            <div className="ns-addr-parts">
              <div className="ns-addr-part">
                <div className="ns-addr-part-head">Reality</div>
                <code className="ns-addr-part-code">treeos.ai</code>
                <div className="ns-addr-part-note">the domain</div>
              </div>
              <div className="ns-addr-part">
                <div className="ns-addr-part-head">Path to position</div>
                <code className="ns-addr-part-code">/flappybird</code>
                <div className="ns-addr-part-note">a place in the tree</div>
              </div>
              <div className="ns-addr-part">
                <div className="ns-addr-part-head">Being on stance</div>
                <code className="ns-addr-part-code">@ruler</code>
                <div className="ns-addr-part-note">the being there</div>
              </div>
            </div>
          </div>

          <p className="ns-small ns-addr-readout">
            The being <code>@tabor</code> at the root of{" "}
            <code>treeos.ai</code> is addressing the being{" "}
            <code>@ruler</code> at <code>treeos.ai/flappybird</code>.
          </p>

          <h3>Position vs stance</h3>
          <p>
            Two things in IBP are targets of verb calls. The rest are the
            vocabulary around them.
          </p>
          <ul className="ns-list">
            <li>
              <strong>Position</strong> is a place in the world. Always
              written <code>reality/path</code>. The path can be empty for
              the root, can begin with <code>~</code> for a being's home, or
              can be any node in the tree. SEE accepts it. DO accepts it.
            </li>
            <li>
              <strong>Stance</strong> is a position with a being qualifier
              at the end. <code>treeos.ai/flappybird@ruler</code>,{" "}
              <code>treeos.ai/@tabor</code>. SEE accepts it. SUMMON requires
              it. BE requires it.
            </li>
          </ul>

          <h3>Being and role</h3>
          <p>
            The <code>@</code> in a stance always names a being, not a role.
            A being is the instance with identity that persists across
            sessions. The role is the template the being holds on its{" "}
            <code>role</code> field, the class to the being's instance.{" "}
            <code>@king-bob</code> is a specific being who might hold the{" "}
            <code>ruler</code> role today and something else later. Roles
            never appear directly in an address. When a reality has only one
            being playing a role, the being's own name often matches the
            role name verbatim (<code>@auth</code>, <code>@cherub</code>),
            which is convenient but still a specific being behind the
            qualifier.
          </p>

          <h3>The grammar at a glance</h3>
          <div className="ns-grammar">
            <div className="ns-grammar-row">
              <code className="ns-grammar-form">treeos.ai/</code>
              <span className="ns-grammar-meaning">
                root position. Reality plus trailing slash. Used by SEE, DO.
              </span>
            </div>
            <div className="ns-grammar-row">
              <code className="ns-grammar-form">treeos.ai/flappybird</code>
              <span className="ns-grammar-meaning">
                deeper position. Reality plus path. Used by SEE, DO.
              </span>
            </div>
            <div className="ns-grammar-row">
              <code className="ns-grammar-form">treeos.ai/@cherub</code>
              <span className="ns-grammar-meaning">
                root stance. A being at the reality root. Used by SUMMON,
                BE. This is the canonical right side of every BE call.
              </span>
            </div>
            <div className="ns-grammar-row">
              <code className="ns-grammar-form">
                treeos.ai/flappybird@ruler
              </code>
              <span className="ns-grammar-meaning">
                deep stance. Position plus being. Used by SEE, SUMMON, BE.
              </span>
            </div>
          </div>
          <p className="ns-small">
            An address is always two of these joined by{" "}
            <code>::</code>. Examples on this page write both sides in
            full.
          </p>
        </section>

        <section>
          <h2>Transports</h2>
          <p>
            IBP runs over two transports today, with a third reserved.
          </p>
          <ul className="ns-list">
            <li>
              <strong>WebSocket</strong> (the default). Persistent socket,
              JWT auth on the handshake, server pushes results back as they
              seal. Used by the 3D portal and any long-lived client.
            </li>
            <li>
              <strong>HTTP</strong>. <code>POST /ibp/&lt;verb&gt;</code> with
              the envelope as JSON; one verb per request. Used by scripts and
              CLI tools that don't want a persistent connection.
            </li>
            <li>
              <strong>CLI</strong> (reserved). Same envelope shape; not yet
              implemented.
            </li>
          </ul>
          <p>
            Each transport is a thin adapter. Translate the arrival into the
            envelope above, hand it to the kernel, translate the result back
            to the transport's wire shape. No verb logic lives in transports.
          </p>
        </section>

        <section>
          <h2>The four verbs</h2>

          <div className="ns-verb">
            <h3>SEE</h3>
            <p className="ns-verb-line">
              Read a position. Return its descriptor. No state changes.
            </p>
            <pre className="ns-code">
{`{
  verb:    "see",
  address: "treeos.ai/@tabor :: treeos.ai/~tabor",
  payload: { live: true }
}`}
            </pre>
            <p className="ns-small">
              The descriptor names what lives at that position. Child
              spaces, matter, beings, qualities. With <code>live: true</code>,
              the socket subscribes to future changes, and the server pushes
              patches as facts seal.
            </p>
          </div>

          <div className="ns-verb">
            <h3>DO</h3>
            <p className="ns-verb-line">
              Run a registered operation against a target. Stamp a Fact.
            </p>
            <pre className="ns-code">
{`{
  verb:    "do",
  address: "treeos.ai/@tabor :: treeos.ai/~tabor",
  payload: {
    action: "create-space",
    args:   { spec: { name: "notes", type: "branch" } }
  }
}`}
            </pre>
            <p className="ns-small">
              The kernel looks up the operation, checks the caller's stance
              against the position's permissions, runs the handler, and
              stamps a Fact recording what happened. Extensions register new
              actions through the same mechanism the seed uses for its
              built-in ones.
            </p>
          </div>

          <div className="ns-verb">
            <h3>SUMMON</h3>
            <p className="ns-verb-line">
              Deliver a message to a being. Wake their scheduler. Get an
              async reply.
            </p>
            <pre className="ns-code">
{`{
  verb:    "summon",
  address: "treeos.ai/@tabor :: treeos.ai/notes@archivist",
  payload: {
    message:     { content: "summarize what I wrote this week" },
    correlation: "c-001"
  }
}`}
            </pre>
            <p className="ns-small">
              SUMMON is the only verb that wakes another being. The left
              stance names who is asking. The right stance names the being
              to wake. The kernel pushes the message into that being's
              inbox; the scheduler picks it up; the being's role fires; an
              answer comes back through the socket later, matched by{" "}
              <code>correlation</code>.
            </p>
          </div>

          <div className="ns-verb">
            <h3>BE</h3>
            <p className="ns-verb-line">
              Identity operations. Birth, connect, release.
            </p>
            <pre className="ns-code">
{`{
  verb:    "be",
  address: "treeos.ai/@arrival :: treeos.ai/@cherub",
  payload: { op: "birth", name: "tabor", password: "..." }
}`}
            </pre>
            <p className="ns-small">
              BE is for session binding. Bring a new identity into being,
              connect an existing one with credentials, or release the
              current session. All three route through the cherub, the
              welcome being at the reality root, so the right stance is
              always <code>&lt;reality&gt;/@cherub</code>. The left stance is
              whoever is currently driving the session. Before birth or
              connect that is the pre-bind arrival being the transport
              minted on connect; after connect it is the user being.
            </p>
          </div>
        </section>

        <section>
          <h2>What happens after a verb fires</h2>
          <p>
            Every verb opens a moment on a being. A moment is the atom. One
            being, one face, one act. The kernel walks five beats. Intake,
            assign, fold, momentum, stamped. The full tour lives at{" "}
            <Link to="/factory" className="ns-inline-link">
              /factory
            </Link>
            .
          </p>
        </section>
      </article>

      <SiteFooter />
    </div>
  );
};

export default IbpPage;
