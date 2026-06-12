import { Link } from "react-router-dom";
import "./IbpPage.css";

/**
 * FactoryIdentity. How TreeOS names agents (beings and realities) and
 * how they prove they are themselves.
 *
 * Companion to FactoryIntegrity. Integrity covers naming for immutable
 * content (hashes). Identity covers naming for living agents (public
 * keys). Same principle: every TreeOS identifier is a cryptographic
 * value of what it is. A public key is itself the content address of
 * a secret, so this is one idea, not two.
 *
 * Sources.
 *   /reality/philosophy/OS/IDENTITY.md     doctrine
 *   /reality/seed/past/fact/chainRoots.js  Merkle roots
 *   /reality/seed/realityIdentity.js       reality keypair
 *   /reality/seed/present/beats/4-stamped.js  sealAct (signing chokepoint)
 */
const FactoryIdentity = () => {
  return (
    <article className="ns-doc">

      {/* ────────────────────────────────────────────────────────── */}
      {/* SECTION 1 . THE QUESTION                                    */}
      {/* ────────────────────────────────────────────────────────── */}
      <header className="ns-doc-header">
        <p className="ns-doc-eyebrow">Identity</p>
        <h1 className="ns-doc-title">Beings and Realities as Wallets</h1>
        <p className="ns-doc-lede">
          A hash names content. It tells you that two pieces of data are
          the same. It does not tell you who made them. For agents,
          beings and the realities they live in, TreeOS uses a
          different cryptographic primitive: a public key. The principle
          is the same. The address IS the identity.
        </p>
        <p className="ns-small">
          Status: being keypairs and the signing primitives just landed
          (<code>seed/materials/being/identity/beingKeys.js</code>).
          Custodial signing (the home reality holds your encrypted key)
          is the current ceiling, mitigated by a secondary unlock and
          full audit trail. Non-custodial edge signing is a future move
          named honestly in Section 9.
        </p>
      </header>

      {/* ────────────────────────────────────────────────────────── */}
      {/* SECTION 1 . THE QUESTION                                    */}
      {/* ────────────────────────────────────────────────────────── */}
      <section>
        <p>
          The companion page,{" "}
          <Link to="/factory/integrity" className="ns-inline-link">
            Integrity
          </Link>
          , covers how TreeOS names immutable content. Every fact, act,
          and file has an address derived from its bytes. Same bytes,
          same address. The substrate gains verifiable replay, automatic
          dedup, and tamper evidence from this one move.
        </p>
        <p>
          For agents the question is different. A being acts. A reality
          hosts other realities and signs for what happens inside it.
          Hashes answer "is this the same content?" Agents need an
          answer to "is this the same actor?" The substrate's answer is
          a public key.
        </p>
        <p>
          The principle stays unified. A public key IS the content
          address of a secret. So content addressing and agent
          addressing are the same idea: every TreeOS identifier is a
          cryptographic value of what it is.
        </p>

        <aside className="ns-doc-aside">
          <p>
            <strong>Immutable things are named by their content. Living
            agents are named by their key.</strong>
          </p>
        </aside>
      </section>

      {/* ────────────────────────────────────────────────────────── */}
      {/* WHY THIS MATTERS . FOR NON-TECHNICAL READERS                */}
      {/* ────────────────────────────────────────────────────────── */}
      <section>
        <h2>Why this matters</h2>
        <p>
          Your being works wherever you go. The same identity you have
          on your home reality works in any other TreeOS reality, with
          no central directory to ask permission and no certificate
          authority that could revoke you. If your home reality goes
          offline, your identity does not go with it. A paper backup
          restores you in any reality you control.
        </p>
        <p>
          Nobody can pretend to be you, in any reality, because
          checking your signature against your public key is local
          arithmetic. No one needs to trust anyone else's directory.
          The math gives you portable, verifiable, recoverable
          identity, owned by you, valid everywhere TreeOS runs.
        </p>
      </section>

      {/* ────────────────────────────────────────────────────────── */}
      {/* SECTION 2 . BEINGS ARE WALLETS                              */}
      {/* ────────────────────────────────────────────────────────── */}
      <section>
        <h2>Beings are wallets</h2>
        <p>
          The shape will be familiar to anyone who has used a
          cryptocurrency wallet. Creating a being is creating a wallet.
          You get a public key (your permanent global address) and a
          private key (your signing power). The two pieces do the same
          jobs they do everywhere else, but with TreeOS semantics
          instead of money semantics.
        </p>

        <pre className="ns-code">{`                 crypto wallet              TreeOS being
                 ---------------             ----------------
public key       wallet address              global being id
private key      controls money              signs acts, proves identity
cross-system     works on any chain          works in any reality
recovery         seed phrase                 private key (+ home reality help)
lost key         usually gone forever        same risk, reality can assist rotate
`}</pre>

        <p>
          Your public key is your <code>beingId</code>. It is your
          permanent global address. Every other being references it for
          stances, mates, vessels, summons. It works in every reality.
          Your display NAME can change across branches or across
          realities, because names fold from facts and beings rename
          themselves through their own acts. The underlying identity
          never moves.
        </p>
        <p>
          Your private key signs your acts and proves you are you. The
          home reality holds it encrypted and signs on your behalf
          (custodial signing, raised to a higher bar by a secondary
          unlock that the reality never stores in plaintext). You can
          also export it: an encrypted private key plus a BIP39 seed
          phrase you can write on paper. The exported key is recovery,
          and it is your exit. Take it to any reality you control and
          you are the same being there.
        </p>
      </section>

      {/* ────────────────────────────────────────────────────────── */}
      {/* SECTION 3 . THE BEING-ID ENCODING                          */}
      {/* ────────────────────────────────────────────────────────── */}
      <section>
        <h2>The being-id encoding</h2>
        <p>
          A <code>beingId</code> is the public key, encoded as a
          self-describing string:
        </p>

        <pre className="ns-code">{`z<base58btc(0xed01 || raw 32-byte ed25519 public key)>

example:
z6MkpTHR8VNsBxYAAWHut2Geo2LMavjfXHbpRZ8FYxN8q8xL
`}</pre>

        <p>
          The leading <code>z</code> is multibase base58btc (path safe
          and URL safe, so the id flows through IBP addresses,
          WebSocket routes, and query strings). The next two bytes
          (<code>0xed01</code>) are the multicodec varint for
          <code>ed25519-pub</code>, which makes the format
          algorithm-agile: TreeOS can adopt a different curve later
          without renaming every id. The rest is the raw 32-byte
          public key.
        </p>
        <p>
          For external display, the id renders as{" "}
          <code>did:key:z...</code>, the standard W3C decentralized
          identifier form for an ed25519 key. Internally the bare{" "}
          <code>z...</code> is what ships, because TreeOS's projection,
          reel, and act keys are colon delimited
          (<code>{`<branch>:<type>:<id>`}</code>). A <code>did:</code>
          prefix with its own colons would corrupt key parsing. The
          two forms are mechanically identical; only the wrapper
          differs.
        </p>
        <p>
          Realities use the same encoding for their <code>realityId</code>.
          One naming scheme, two kinds of agent.
        </p>
      </section>

      {/* ────────────────────────────────────────────────────────── */}
      {/* SECTION 4 . SIGNING AN ACT                                 */}
      {/* ────────────────────────────────────────────────────────── */}
      <section>
        <h2>Signing an act commits to its facts</h2>
        <p>
          When a being acts, the substrate hashes the opening of the
          act, hashes every fact the act produces, and signs the whole
          bundle in one shot. The signature commits to both the act
          and exactly its facts, so neither can be swapped after the
          fact.
        </p>

        <pre className="ns-code">{`signingPayload = {
  beingId,
  realityId,
  branch,
  actId,                 // already the hash of the act's opening
  factIds: [hash, hash, hash, ...],  // sorted
  timestamp
}

sig = sign(privateKey, hash(canonical(signingPayload)))
`}</pre>

        <p>
          The signature rides on the act row as a closure field. It
          does not change the act's hash (so replay protection still
          dedups), but anyone verifying the chain can recompute the
          payload and check the signature against the
          <code>beingId</code>. No third party, no certificate authority,
          no DNS lookup. The verification is local arithmetic.
        </p>
        <p>
          One chokepoint signs every act: the seal step. There is no
          other place in the substrate that can produce a valid
          signature. If a fact appears on a reel with a signature that
          verifies, the substrate's seal step authored it.
        </p>
      </section>

      {/* ────────────────────────────────────────────────────────── */}
      {/* SECTION 5 . REALITIES ARE WALLETS TOO                       */}
      {/* ────────────────────────────────────────────────────────── */}
      <section>
        <h2>Realities are wallets too</h2>
        <p>
          A reality is an agent. It hosts beings, holds the chain,
          publishes signed Merkle roots, and answers to peers. It needs
          a way to prove "this is me, and this is what I am vouching
          for." So a reality is a wallet.
        </p>
        <p>
          One keypair, generated once at first boot, settles every
          identity question about the world. It belongs to{" "}
          <strong>I_AM</strong>, the being who IS the reality. The
          public key is the reality's global address. The private key
          signs the genesis fact and every Merkle root the world ever
          publishes. From t=0 the world has one key, named once.
        </p>

        <pre className="ns-code">{`genesis: generate the I_AM keypair (one ed25519 pair)
                  ↓
I_AM.pub   →   realityId   (same z... value, two views)
I_AM.priv  →   the reality's signing key
                  ↓
genesis fact commits I_AM.pub; I_AM signs the genesis fact
                  ↓
I_AM signs every Merkle root from genesis onward
`}</pre>

        <p>
          A foreign reality, given only this reality's public key, can
          walk the chain to its origin: verify the current signed
          Merkle root, follow the chain of signed roots back to genesis,
          fetch the genesis fact, and confirm I_AM committed and signed
          it. Every step is self-certifying. The visitor concludes
          "this entire world is the chain that this key has been
          signing since t=0," with no third party in the verification.
        </p>
        <p>
          The human operator comes later. The first human registers as
          a normal being, gets their own independent keypair at birth,
          and can be granted high privileges via roles and grants
          stamped as ordinary facts on the chain. They are first among
          equals on the being-tree, not part of the reality's
          cryptographic identity. The world has its key (I_AM's). The
          operator has theirs (a personal being key). Neither depends
          on the other for verification.
        </p>
        <p>
          The old random <code>realityId</code> uuid retires with this
          move. A reality's identity is I_AM's public key. Its
          provenance is the signed chain. The one-time onboarding token
          that used to identify a reality at creation is now just a
          local operator convenience, not an identity.
        </p>
      </section>

      {/* ────────────────────────────────────────────────────────── */}
      {/* SECTION 6 . I_AM, THE REALITY FROM ABOVE                    */}
      {/* ────────────────────────────────────────────────────────── */}
      <section>
        <h2>I_AM, the reality from above</h2>
        <p>
          I_AM is not an exception to the rule. I_AM is how realities
          satisfy the rule. Every being is named by a key; the reality
          itself is a being too, the one born at genesis, and its name
          is I_AM. From inside the world, beings address the reality as
          I_AM. From outside the world, peers verify against the same
          public key under the label <code>realityId</code>. Two views,
          one key, one identity.
        </p>
        <p>
          Every other being has its own independent keypair. The first
          human, the seed delegates, every human that registers, every
          vessel-child birthed through <code>summon:mate</code>: each
          one gets its own key at birth, and that key signs its acts
          from then on. None of them shares I_AM's key, because none
          of them IS the reality. I_AM is the only one that is.
        </p>
        <p>
          A small implementation detail follows from this. I_AM's
          <code>_id</code> stays the literal string <code>I_AM</code>
          for ergonomic reasons (it shows up everywhere in seed-code
          paths, root-fact attributions, drift-correction loops), but
          its cryptographic identity, the one that signs and verifies,
          is the public key. The string is the local handle. The key
          is the truth.
        </p>

        <aside className="ns-doc-aside">
          <p>
            <strong>One reality, one keypair, two views.</strong> From
            outside (peers verifying envelopes): the public key
            labelled <code>realityId</code>. From inside (beings
            addressing the reality itself): I_AM. The key is the same;
            only the framing differs. The human operator is a separate
            being with its own keypair, granted privileges via roles,
            and not part of the reality's cryptographic identity.
          </p>
        </aside>
      </section>

      {/* ────────────────────────────────────────────────────────── */}
      {/* SECTION 7 . ONE ROOT                                        */}
      {/* ────────────────────────────────────────────────────────── */}
      <section>
        <h2>One root</h2>
        <p>
          There's a single moment that everything in the reality traces
          back to. At first boot, I_AM is created. A keypair is
          generated. The first fact (the genesis fact) commits I_AM's
          public key. I_AM signs the fact. That signature is the first
          thing in the world.
        </p>
        <p>
          Everything that comes after descends from it. Every other
          being is born from I_AM's lineage on the being-tree. Every
          fact chains back through previous hashes to the genesis fact.
          Every Merkle root rolls up over everything that has happened
          since.
        </p>
        <p>
          The being-tree has one root: I_AM. The fact-chain has one
          root: the genesis hash. The signature chain has one root:
          I_AM's first signature. Three views of the same first
          moment.
        </p>

        <aside className="ns-doc-aside">
          <p>
            <strong>The reality is what I_AM has been signing since
            t=0.</strong>
          </p>
        </aside>

        <p>
          Nothing in the world exists that doesn't trace back to I_AM.
          Every identity, every act, every branch, every history any
          other reality can observe: all of it descends from that one
          genesis moment. The whole substrate has exactly one
          cryptographic anchor, and the anchor is the first being.
        </p>
      </section>

      {/* ────────────────────────────────────────────────────────── */}
      {/* SECTION 8 . SELF CERTIFYING ACROSS REALITIES                */}
      {/* ────────────────────────────────────────────────────────── */}
      <section>
        <h2>Self certifying across realities</h2>
        <p>
          When you act in a foreign reality, you present your
          <code>beingId</code> (your public key) and a signature. The
          foreign reality verifies the signature against the id
          directly. No directory, no PKI, no DNS lookup. The id IS the
          verification key.
        </p>
        <p>
          Two layers of proof stack cleanly on a cross-reality
          envelope:
        </p>

        <ul className="ns-list">
          <li>
            <strong>The canopy domain key</strong> (the sending
            reality's key) proves "this reality sent this envelope."
            Required: every envelope crossing the boundary is signed by
            the sending reality's key, verified by the receiving
            reality against the sender's published <code>did:tree:</code>
            identity.
          </li>
          <li>
            <strong>The being key</strong> (your individual key) proves
            "this specific being authored this act." Carried inside the
            envelope as the act's signature.
          </li>
        </ul>

        <p>
          Both checks are local arithmetic. A foreign reality cannot
          forge acts attributed to its own users without their private
          keys, because the forgery would fail the second check. A
          rogue actor cannot forge envelopes from a reality they do not
          run, because the forgery would fail the first check.
        </p>
      </section>

      {/* ────────────────────────────────────────────────────────── */}
      {/* SECTION 8 . WHAT THIS ENABLES                               */}
      {/* ────────────────────────────────────────────────────────── */}
      <section>
        <h2>What this enables</h2>

        <h3>Portable identity</h3>
        <p>
          Your being works in any reality. The same key signs everywhere,
          and any reality can verify against your public key directly.
          Federation does not require trusting a central directory or a
          shared certificate authority. The math runs locally.
        </p>

        <h3>Recovery without a custodian</h3>
        <p>
          Export your private key (encrypted, plus a BIP39 paper
          backup). Import it into any reality you control. You are the
          same being there. If your home reality goes offline, your
          identity does not go with it.
        </p>

        <h3>Verifiable provenance to genesis</h3>
        <p>
          Any reality's chain can be walked back to its genesis fact,
          verified at every step, and confirmed to be the world I_AM
          has been signing since t=0. The reality's current Merkle
          root, the chain of signed roots leading up to it, I_AM's
          signature on the genesis: all checkable from the reality's
          public key alone.
        </p>

        <h3>Self certifying federation</h3>
        <p>
          Two realities exchanging acts verify each other without a
          third party. No central registry of realities, no global
          certificate hierarchy. Every reality is its own trust anchor;
          every being is their own.
        </p>
      </section>

      {/* ────────────────────────────────────────────────────────── */}
      {/* SECTION 9 . ONE OPEN QUESTION                               */}
      {/* ────────────────────────────────────────────────────────── */}
      <section>
        <h2>One open question, named honestly</h2>
        <p>
          The home reality holds every hosted being's private key
          (every being, that is, whose user has not exported it and
          moved offline). That means the reality CAN technically forge
          any act by any of those beings. The signature proves "this
          reality vouches for this being's act," not "this being
          personally pressed the button." Custodial signing is the
          inherent ceiling of "let the reality sign on your behalf."
        </p>
        <p>
          Two mitigations are in play. The secondary unlock (a user
          secret the reality never stores in plaintext) gates when the
          reality is willing to sign at all, so the bar for silent
          forgery is much higher than just having the encrypted key.
          The full Merkle audit trail makes any forgery permanently
          attributable. Together they make custodial signing acceptable
          for most usage: users run their own reality, or join
          realities they trust.
        </p>
        <p>
          The full closure is non custodial edge signing: the private
          key lives only in your client, and signs before the act
          reaches the reality at all. That is a future move. The
          current model is honest about what it does and does not
          guarantee, which is the prerequisite for the move when it
          comes.
        </p>
      </section>

      {/* ────────────────────────────────────────────────────────── */}
      {/* SECTION 10 . THE UNIFIED PRINCIPLE                          */}
      {/* ────────────────────────────────────────────────────────── */}
      <section>
        <h2>The unified principle</h2>
        <p>
          Two naming systems, one rule. Content is named by its hash.
          Agents are named by their public key. Both are cryptographic
          values of what they identify. A hash is the cryptographic
          value of bytes. A public key is the cryptographic value of a
          secret. So a public key is itself a kind of content address,
          where the content is the private key that nobody else holds.
        </p>

        <pre className="ns-code">{`content  →  hash       →  address that anyone can verify
secret   →  pubkey     →  address only the keyholder can sign for

both are cryptographic values of what they are
`}</pre>

        <p>
          This is why content addressing and key addressing feel like
          the same idea expressed in two ways: they are. TreeOS uses
          one for things that do not act (files, facts, acts as
          records) and the other for things that do act (beings,
          realities). The principle stays unified at the bottom.
        </p>

        <aside className="ns-doc-aside">
          <p>
            <strong>Every TreeOS identifier is a cryptographic value
            of what it identifies.</strong> Same content, same hash.
            Same secret, same key. Both immutable. Both verifiable
            locally. No directory, no operator trust, no global
            certificate authority. Just the math.
          </p>
        </aside>
      </section>

      {/* ────────────────────────────────────────────────────────── */}
      {/* CLOSING NAV                                                 */}
      {/* ────────────────────────────────────────────────────────── */}
      <nav className="ns-doc-aside">
        <p>
          Previous.{" "}
          <Link to="/factory/integrity" className="ns-inline-link">
            Integrity
          </Link>
          . Content as identity, the hash side of the same principle.
          <br />
          Next.{" "}
          <Link to="/factory/intake" className="ns-inline-link">
            1. Intake
          </Link>
          . A summon arrives in the being's inbox and the cycle begins.
        </p>
      </nav>
    </article>
  );
};

export default FactoryIdentity;
