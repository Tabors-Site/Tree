import { Link } from "react-router-dom";
import SiteHeader from "./SiteHeader.jsx";
import SiteFooter from "./SiteFooter.jsx";
import "./IbpPage.css";
import "./CrossWorldPage.css";

/**
 * CrossWorldPage. Single page introducing cross-world action: one being
 * acting at a position whose branch or reality differs from its home.
 *
 * Reuses the shared .ns-doc prose system from IbpPage.css, plus a few
 * .ns-cw-* pieces in CrossWorldPage.css for the sovereignty diagram,
 * invariant cards, and the status / verb tables.
 *
 * Source of truth (kept accurate at copy-edit time):
 *   /reality/seed/CROSS-WORLD.md   the doctrine this page renders
 */
const CrossWorldPage = () => {
  return (
    <div className="ns-page">
      <SiteHeader />

      <article className="ns-doc">
        <header className="ns-doc-header">
          <p className="ns-doc-eyebrow">Protocol</p>
          <h1 className="ns-doc-title">Cross-World</h1>
          <p className="ns-doc-lede">
            One being has one position. That position can name any reality and
            any branch. Acting across the gap is detected from the address, not
            declared. One actor, one act, facts where they land.
          </p>
        </header>

        <section>
          <h2>What this is</h2>
          <p>
            A being lives in one home world, but the world is not the only one.
            Other branches diverge from it. Other realities sit across the
            network. Cross-world is what happens when a being reaches a position
            whose branch or reality differs from its own home world.
          </p>
          <p>
            Nothing new is added to the protocol to make this work. The same
            four verbs (<Link to="/ibp" className="ns-inline-link">SEE, DO,
            SUMMON, BE</Link>) carry an address, and an address always has two
            sides. When the two sides disagree on branch or reality, the call is
            a cross-world call. The resolver notices; the dispatcher routes it.
            The being never asks to "go cross-world." It just acts, and the gap
            is handled underneath.
          </p>
          <ul className="ns-list">
            <li>
              <strong>Cross-branch.</strong> Both sides name the same reality,
              but different branches (<code>#0</code> vs <code>#4</code>).
              Branches are divergent worlds inside one server, so the hop stays
              in-process. This is the canonical first case. See{" "}
              <Link to="/factory/branches" className="ns-inline-link">
                /factory/branches
              </Link>
              .
            </li>
            <li>
              <strong>Cross-reality.</strong> The two sides name different
              domains (<code>tabors.site</code> vs <code>bing.com</code>). The
              call crosses the federation boundary through canopy, the
              place-to-place transport. Same shape, longer round trip.
            </li>
          </ul>
        </section>

        <section>
          <h2>Detection from the address</h2>
          <p>
            The resolver compares the left and right stance of the address. No
            flag is set by hand.
          </p>

          <div className="ns-addr">
            <div className="ns-addr-bar">
              <span className="ns-addr-reality">tabors.site</span>
              <span className="ns-addr-path">#0</span>
              <span className="ns-addr-being">/home@tabor</span>
              <span className="ns-addr-bridge">::</span>
              <span className="ns-addr-reality">tabors.site</span>
              <span className="ns-addr-path">#4</span>
              <span className="ns-addr-being">/factory</span>
            </div>

            <div className="ns-addr-labels">
              <div className="ns-addr-label ns-addr-label-left">
                <div className="ns-addr-label-name">Left stance</div>
                <div className="ns-addr-label-desc">the actor</div>
                <div className="ns-addr-label-note">
                  who is acting, at their home world
                </div>
              </div>
              <div className="ns-addr-label ns-addr-label-bridge">
                <div className="ns-addr-label-name">Bridge</div>
                <div className="ns-addr-label-desc">
                  <code>::</code>
                </div>
                <div className="ns-addr-label-note">reaching across</div>
              </div>
              <div className="ns-addr-label ns-addr-label-right">
                <div className="ns-addr-label-name">Right stance</div>
                <div className="ns-addr-label-desc">the receiver</div>
                <div className="ns-addr-label-note">
                  the foreign world being reached
                </div>
              </div>
            </div>
          </div>

          <div className="ns-grammar">
            <div className="ns-grammar-row">
              <code className="ns-grammar-form">left.reality !== right.reality</code>
              <span className="ns-grammar-meaning">
                cross-reality. Crosses the federation boundary via canopy.
              </span>
            </div>
            <div className="ns-grammar-row">
              <code className="ns-grammar-form">left.branch !== right.branch</code>
              <span className="ns-grammar-meaning">
                cross-branch. Same server, divergent worlds, stays in-process.
              </span>
            </div>
            <div className="ns-grammar-row">
              <code className="ns-grammar-form">either or both differ</code>
              <span className="ns-grammar-meaning">
                cross-world. The dispatcher routes accordingly.
              </span>
            </div>
          </div>
        </section>

        <section>
          <h2>A window and a portal are the same thing</h2>
          <p>
            Picture an opening hung on a wall that looks into another world.
            That opening is one single thing. Nobody decides, when they hang it,
            whether it is a window you peer through or a door you walk through.
            That part is not set in advance. It is decided by whoever is
            standing in front of it, and by what the other world is willing to
            let that person do.
          </p>
          <p>
            The opening itself is identical for everyone. It simply points at a
            place in another world. Everything else, what you actually get when
            you look at it, comes from the other side deciding, for you
            personally, how far in you are allowed to come.
          </p>
          <ul className="ns-list">
            <li>
              <strong>If it lets you look,</strong> you see straight through it,
              live, the way a window opens onto the world outside.
            </li>
            <li>
              <strong>If it lets you reach in,</strong> you can pick things up
              and change them over there without ever leaving the spot you are
              standing on.
            </li>
            <li>
              <strong>If it lets you step through,</strong> you walk in, and now
              you are simply there, on the other side.
            </li>
            <li>
              <strong>If it does not know you, or will not let you in,</strong>{" "}
              the window is just black. You can tell something is there, but you
              cannot see inside.
            </li>
          </ul>
          <div className="ns-doc-aside">
            <p>
              Here is the part that surprises people. The very same opening can
              be a black pane for one being and a wide-open doorway for another,
              the two of them standing side by side looking at it. The wall never
              changed. Their permissions did. The being who hung it might walk
              right through, while the being next to them cannot even see inside.
            </p>
          </div>
          <p>
            So there is no switch that makes something "a window" or "a portal."
            There is one opening, and a world on the other side that decides, for
            each being who looks, how far in they get. A window, a doorway, and a
            locked black pane are not three different things you build. They are
            the same opening, seen by three different beings.
          </p>
        </section>

        <section>
          <h2>Two worlds, two chains, both sovereign</h2>
          <p>
            This is the heart of it. When a being acts across the gap, the act
            is recorded in two different worlds, on two different chains, and
            neither world can rewrite the other's record.
          </p>

          <div className="ns-cw-sovereign">
            <div className="ns-cw-world">
              <div className="ns-cw-world-head">Actor's home world</div>
              <p className="ns-cw-world-line">
                The actor opens a <strong>Stamp</strong> on its own act-chain.
                "I attempted X at the foreign address, and got this outcome." It
                records the verb, the address, the inner face that came back,
                and the result.
              </p>
              <p className="ns-cw-world-line ns-cw-world-foot">
                This is the actor's biography. It survives even if the foreign
                world disappears.
              </p>
            </div>
            <div className="ns-cw-bridge-col">::</div>
            <div className="ns-cw-world">
              <div className="ns-cw-world-head">Receiving world</div>
              <p className="ns-cw-world-line">
                The receiver's <strong>Stamper</strong> writes the actual facts
                (the consequences) on <em>its own</em> reels, each carrying a{" "}
                <code>crossOrigin</code> block naming where it came from.
              </p>
              <p className="ns-cw-world-line ns-cw-world-foot">
                No second moment opens here. The receiver is the place the
                consequence lands, not the originator of the act.
              </p>
            </div>
          </div>

          <h3>One actor, one act</h3>
          <p>
            Only the actor on the left stance opens a moment. The receiving
            world stamps facts in response, but it never opens its own act in
            reply. There is exactly one originator per act, and it is always the
            left stance.
          </p>

          <h3>Each world writes only its own reels</h3>
          <p>
            No foreign world ever reaches into another world's reels directly.
            The actor's home writes the actor's chain; the receiver's Stamper
            writes the receiver's reels. Cross-world facts are written by the
            receiving Stamper, on the receiving world's chain, with provenance.
          </p>

          <h3>The crossOrigin provenance block</h3>
          <p>
            Every fact stamped because of a cross-world act carries a stamp of
            where it came from:
          </p>
          <pre className="ns-code">
{`crossOrigin: {
  reality: <home-domain-or-null>,   // null when cross-branch
  branch:  <home-branch>,
  beingId: <actor-being-id>,
  actId:   <home-act-id>,
}`}
          </pre>
          <p className="ns-small">
            The receiving Stamper refuses any foreign-origin fact that arrives
            without a complete <code>crossOrigin</code>. Stamps are immutable, so
            provenance can never be edited later. The receiver also deduplicates
            on <code>actId</code>, so a replayed act produces the same outcome,
            never a double stamp.
          </p>

          <h3>Identity is sovereign</h3>
          <p>
            A foreign world cannot rewrite the actor's identity, history, or
            memory. If the foreign world vanishes, the actor's act on home
            survives intact. A being's continuity never depends on another world
            staying available.
          </p>
        </section>

        <section>
          <h2>The four invariants</h2>
          <div className="ns-cw-cards">
            <div className="ns-cw-card">
              <div className="ns-cw-card-num">1</div>
              <div className="ns-cw-card-title">One actor, one act</div>
              <p className="ns-cw-card-body">
                Only the left-stance actor opens a Stamp. The receiver stamps
                consequences but is not the originator.
              </p>
            </div>
            <div className="ns-cw-card">
              <div className="ns-cw-card-num">2</div>
              <div className="ns-cw-card-title">Each stamper, its own reels</div>
              <p className="ns-cw-card-body">
                No world reaches into another's reels. Cross-world facts are
                written by the receiving Stamper on its own chain.
              </p>
            </div>
            <div className="ns-cw-card">
              <div className="ns-cw-card-num">3</div>
              <div className="ns-cw-card-title">One position at a time</div>
              <p className="ns-cw-card-body">
                A being is never in two places. A position move leaves home and
                arrives foreign as one transition. No ghost beings.
              </p>
            </div>
            <div className="ns-cw-card">
              <div className="ns-cw-card-num">4</div>
              <div className="ns-cw-card-title">Identity is sovereign</div>
              <p className="ns-cw-card-body">
                A foreign world cannot rewrite the actor's identity or memory.
                If it disappears, the actor's act on home survives.
              </p>
            </div>
          </div>
        </section>

        <section>
          <h2>Per-verb behavior</h2>
          <p>
            Each verb honors the three facts of a being: identity stays home,
            position determines the target, memory rides the act.
          </p>
          <div className="ns-cw-table" role="table" aria-label="Per-verb cross-world behavior">
            <div className="ns-cw-trow ns-cw-thead" role="row">
              <span role="columnheader">Verb</span>
              <span role="columnheader">Position</span>
              <span role="columnheader">Where facts land</span>
            </div>
            <div className="ns-cw-trow" role="row">
              <span role="cell"><code>SEE</code></span>
              <span role="cell">unchanged. Observation only.</span>
              <span role="cell">none. The inner face returns to the actor's act.</span>
            </div>
            <div className="ns-cw-trow" role="row">
              <span role="cell"><code>DO</code></span>
              <span role="cell">unchanged. Acts from the current position.</span>
              <span role="cell">the consequence, on the foreign reels, with crossOrigin.</span>
            </div>
            <div className="ns-cw-trow" role="row">
              <span role="cell"><code>SUMMON</code></span>
              <span role="cell">unchanged. Calls from the current position.</span>
              <span role="cell">a summon on the foreign being's inbox-reel, with crossOrigin.</span>
            </div>
            <div className="ns-cw-trow" role="row">
              <span role="cell"><code>BE</code></span>
              <span role="cell">moves. The only verb that changes position.</span>
              <span role="cell">a depart fact at home, an arrive fact on the foreign reel.</span>
            </div>
          </div>
        </section>

        <section>
          <h2>The act always records what was attempted</h2>
          <p>
            The actor's act seals on its home chain no matter what the foreign
            side does. It starts at <code>attempted</code> and transitions
            exactly once to a terminal state when the foreign side reports back.
            This is the single field on an act that may change after seal, and it
            is a correlation, not a rewrite of the past.
          </p>
          <div className="ns-cw-table" role="table" aria-label="Act status outcomes">
            <div className="ns-cw-trow ns-cw-thead ns-cw-status-row" role="row">
              <span role="columnheader">Status</span>
              <span role="columnheader">Meaning</span>
            </div>
            <div className="ns-cw-trow ns-cw-status-row" role="row">
              <span role="cell"><code>attempted</code></span>
              <span role="cell">sealed at home; awaiting the foreign side.</span>
            </div>
            <div className="ns-cw-trow ns-cw-status-row" role="row">
              <span role="cell"><code>landed</code></span>
              <span role="cell">the foreign side confirmed the fact stamped.</span>
            </div>
            <div className="ns-cw-trow ns-cw-status-row" role="row">
              <span role="cell"><code>denied</code></span>
              <span role="cell">the foreign side refused (auth, permissions, policy).</span>
            </div>
            <div className="ns-cw-trow ns-cw-status-row" role="row">
              <span role="cell"><code>timeout</code></span>
              <span role="cell">no response in the configured window.</span>
            </div>
            <div className="ns-cw-trow ns-cw-status-row" role="row">
              <span role="cell"><code>unreachable</code></span>
              <span role="cell">canopy could not deliver at all.</span>
            </div>
            <div className="ns-cw-trow ns-cw-status-row" role="row">
              <span role="cell"><code>malformed</code></span>
              <span role="cell">received but could not be parsed (protocol mismatch).</span>
            </div>
          </div>
          <p className="ns-small">
            These are distinct outcomes with distinct meanings. <code>denied</code>{" "}
            means the other side decided; <code>timeout</code> means we do not
            know; <code>unreachable</code> means we could not even ask. The
            being's biography keeps them apart.
          </p>
        </section>

        <section>
          <h2>Pull-back safety</h2>
          <p>
            A being whose position is foreign must never be stuck there if its
            home restarts, the session times out, or the foreign world becomes
            unreachable.
          </p>
          <ol className="ns-list">
            <li>
              On home startup, scan beings whose position names a foreign
              reality or branch.
            </li>
            <li>
              Check whether that foreign world has confirmed liveness within a
              configured window.
            </li>
            <li>
              If not, stamp a position fact on the home reel that resets the
              being to its home space.
            </li>
            <li>
              If the foreign world is reachable, also stamp a departure there.
              Best-effort; if not, home pulls back unilaterally and the foreign
              side reconciles at its next sync.
            </li>
          </ol>
          <p className="ns-small">
            The guarantee: a being's identity is never hostage to a foreign world
            being available. Worst case, it comes home. Position in another world
            is a lease, not ownership, and home holds final authority over it.
          </p>
        </section>

        <section>
          <h2>Where this lives</h2>
          <p>
            Cross-world is the same act-and-fact machinery you meet at{" "}
            <Link to="/factory" className="ns-inline-link">/factory</Link>,
            carried over the same{" "}
            <Link to="/ibp" className="ns-inline-link">four verbs</Link>, across
            the branch substrate at{" "}
            <Link to="/factory/branches" className="ns-inline-link">
              /factory/branches
            </Link>
            . Cross-branch is the build target that lights up the whole
            architecture without federation; cross-reality is just the canopy
            transport added on top. Same shape, same doctrine, same enforcement,
            longer round trip.
          </p>
        </section>
      </article>

      <SiteFooter />
    </div>
  );
};

export default CrossWorldPage;
