import { Link } from "react-router-dom";
import "./IbpPage.css";

/**
 * FactoryIntegrity. How TreeOS knows what it knows.
 *
 * Content addressing as the substrate's storage and verification layer.
 * Eight sections, conceptual hook first, technical payoff last: the
 * question, the primitive (hashing), the basic move (content vs
 * location addressing), the working example (matter), the extension
 * (fact chains), the roll-up (reels to branches to realities), the
 * implications (replay, federation, dedup, tamper-evidence, trust),
 * the architectural map (three layers: IBP semantic, chains historical,
 * CAS storage).
 *
 * Sources.
 *   /reality/seed/materials/matter/contentStore.js  content-addressed storage
 *   /reality/seed/past/fact/fact.js                 p, h fields on every fact
 *   /reality/seed/past/fact/hash.js                 hash computation
 *   /reality/seed/past/reel/reelHeads.js            per-reel seq counter
 */
const FactoryIntegrity = () => {
  return (
    <article className="ns-doc">

      {/* ────────────────────────────────────────────────────────── */}
      {/* SECTION 1 . THE QUESTION                                    */}
      {/* ────────────────────────────────────────────────────────── */}
      <header className="ns-doc-header">
        <p className="ns-doc-eyebrow">Integrity</p>
        <h1 className="ns-doc-title">Content as Identity</h1>
        <p className="ns-doc-lede">
          Every computer needs to know what it knows. Most systems do
          this by location. TreeOS does it by content. The address of a
          thing is derived from the thing itself, and that changes what
          the substrate can do.
        </p>
        <p className="ns-small">
          Status: matter content addressing and per-fact hash chains
          ship today. Per-reel, per-branch, and per-reality Merkle
          roots are in the substrate; the operator-facing federation
          flows around root-hash exchange are still landing.
        </p>
      </header>

      {/* ────────────────────────────────────────────────────────── */}
      {/* SECTION 1 . THE QUESTION                                    */}
      {/* ────────────────────────────────────────────────────────── */}
      <section>
        <p>
          Conventional storage uses locations. The file at{" "}
          <code>/home/user/notes.txt</code>. The row with{" "}
          <code>id=47</code>. The process with{" "}
          <code>PID 3892</code>. Locations are convenient. They tell you
          where to look. They tell you nothing about what's actually
          there.
        </p>
        <p>
          Content addressing flips this. Every piece of content in the
          substrate gets its address from a cryptographic fingerprint of
          its bytes. Same content, same address. Different content,
          different address. The address IS the identity.
        </p>
        <p>
          This sounds like a storage detail. It isn't. It's how TreeOS
          remembers, verifies, deduplicates, and transports everything
          it holds, from a being's avatar texture to the chain of every
          act every being ever took.
        </p>
      </section>

      {/* ────────────────────────────────────────────────────────── */}
      {/* WHY THIS MATTERS . FOR NON-TECHNICAL READERS                */}
      {/* ────────────────────────────────────────────────────────── */}
      <section>
        <h2>Why this matters</h2>
        <p>
          You don't have to trust an administrator to know the system
          is being honest with you. You don't have to trust a backup
          tool to know your backup is intact. If two parties have the
          same fingerprint, they have the same thing. If they don't,
          the math tells them exactly where they disagree.
        </p>
        <p>
          That is the difference between "we believe this is intact"
          and "we can prove it is intact." Conventional systems offer
          the first. TreeOS offers the second, structurally, for every
          matter, every act, and every history it holds.
        </p>
      </section>

      {/* ────────────────────────────────────────────────────────── */}
      {/* SECTION 2 . HOW HASHING WORKS                               */}
      {/* ────────────────────────────────────────────────────────── */}
      <section>
        <h2>How hashing works</h2>
        <p>
          The mechanism is a cryptographic hash function. Give it any
          input, one byte or a gigabyte, and it produces a fixed-size
          fingerprint, usually 32 bytes for SHA-256. Three properties
          matter:
        </p>

        <ul className="ns-list">
          <li>
            <strong>Deterministic.</strong> The same input always
            produces the same fingerprint. Forever. On any machine.
          </li>
          <li>
            <strong>Sensitive.</strong> Change one byte of the input
            and the fingerprint changes completely. There's no partial
            overlap, no "close to" the original. The smallest
            modification produces a completely different hash.
          </li>
          <li>
            <strong>One-way.</strong> You can compute the fingerprint
            from the content, but you can't reverse a fingerprint back
            into content. The fingerprint identifies. It doesn't store.
          </li>
        </ul>

        <pre className="ns-code">{`SHA-256("the cat sat on the mat")
  9c3f4e2a8d7b1e6f5a4d3c2b1a0f9e8d7c6b5a4d3c2b1a0f9e8d7c6b5a4d3c2b

SHA-256("the cat sat on the bat")            // one byte changed
  1a8b9c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b
`}</pre>

        <aside className="ns-doc-aside">
          <p>
            <strong>The fingerprint identifies the content. It does
            not contain it.</strong> Knowing a hash tells you whether
            two things are the same. It does not let you reconstruct
            them.
          </p>
        </aside>
      </section>

      {/* ────────────────────────────────────────────────────────── */}
      {/* SECTION 3 . CONTENT ADDRESSING                              */}
      {/* ────────────────────────────────────────────────────────── */}
      <section>
        <h2>Content addressing</h2>
        <p>
          Conventional storage uses locations. Two identical files at
          different paths are different addresses, even though they
          hold the same bytes.
        </p>
        <p>
          Content addressing flips this. The address is the
          fingerprint. Same content, same address. Two identical
          files have the same address, and therefore are the same
          stored object.
        </p>

        <pre className="ns-code">{`conventional                       content-addressed

/home/alice/cat.jpg  (4 MB)        /cas/a3/a3f7c9...  (4 MB)
/home/bob/cat.jpg    (4 MB)             ↑
/home/cara/cat.jpg   (4 MB)             alice references it
                                        bob references it
total storage: 12 MB                    cara references it

                                   total storage: 4 MB
`}</pre>

        <p>
          The store doesn't know who owns the content. It doesn't know
          what it's called. It just holds bytes addressed by
          fingerprint. Anyone wanting to retrieve content asks for it
          by hash. Anyone wanting to verify what they got hashes it
          and checks.
        </p>

        <aside className="ns-doc-aside">
          <p>
            <strong>Two properties fall out structurally.</strong>{" "}
            Storage dedups automatically (same content cannot be
            stored twice; the fingerprint identifies it as the same
            thing). Integrity is built in (tampered content has a
            different fingerprint than expected; the mismatch is the
            tamper signal).
          </p>
        </aside>
      </section>

      {/* ────────────────────────────────────────────────────────── */}
      {/* SECTION 4 . MATTER, TODAY                                   */}
      {/* ────────────────────────────────────────────────────────── */}
      <section>
        <h2>Matter, today</h2>
        <p>
          TreeOS already uses content addressing for matter, the
          files, documents, images, and bytes that beings act on. When
          a being creates matter, its content is hashed and stored at
          the path derived from that hash. The matter row in the
          substrate holds the hash as a reference. The actual bytes
          live in the content store.
        </p>

        <pre className="ns-code">{`being creates matter
   ↓
content is hashed  →  a3f7c9...
   ↓
bytes stored at /cas/a3/a3f7c9...
   ↓
matter row holds the hash as a reference
`}</pre>

        <p>
          If a hundred beings upload the same image, the hash is
          computed a hundred times, but the bytes are stored once.
          Every matter row that references the image points at the
          same content. Delete any one matter and the bytes stay
          (other matter still references them). Delete the last
          reference and the bytes can be cleaned up.
        </p>
        <p>
          This is how TreeOS handles photographs, documents, code,
          datasets, and any other content beings need to share. The
          substrate's storage footprint is proportional to unique
          content, not to total activity.
        </p>
      </section>

      {/* ────────────────────────────────────────────────────────── */}
      {/* SECTION 5 . FACTS AS A HASH CHAIN                          */}
      {/* ────────────────────────────────────────────────────────── */}
      <section>
        <h2>Facts as a hash chain</h2>
        <p>
          Beyond content, TreeOS stores history. Every act a being
          takes produces a fact, a small immutable record of what
          happened. Every space created, every matter modified, every
          summon between beings, all stamped as facts in the
          substrate's chain.
        </p>
        <p>
          Facts are content addressed too. Each fact has a hash that
          includes both the fact's content AND the hash of the
          previous fact in its chain. This creates a Merkle chain, a
          sequence where every link is cryptographically tied to its
          predecessor.
        </p>

        <pre className="ns-code">{`Fact 1: content + prev=GENESIS  →  hash A
Fact 2: content + prev=A        →  hash B
Fact 3: content + prev=B        →  hash C
Fact 4: content + prev=C        →  hash D
`}</pre>

        <p>
          Each fact's identity is computed from its content plus its
          predecessor. Change any fact in the middle, the hash
          changes. Every subsequent fact's hash also changes, because
          each one incorporated the previous hash. The chain becomes
          structurally tamper evident: you cannot modify history
          without breaking every hash that came after.
        </p>
        <p>
          This is the substrate's memory. Not stored in logs that
          rotate or databases that overwrite, but in cryptographically
          linked chains that preserve what happened with mathematical
          integrity.
        </p>
      </section>

      {/* ────────────────────────────────────────────────────────── */}
      {/* SECTION 6 . ROLLING UP TO ONE ROOT                          */}
      {/* ────────────────────────────────────────────────────────── */}
      <section>
        <h2>Rolling up to one root</h2>
        <p>
          Individual facts compose into larger structures, each with
          its own identity.
        </p>
        <p>
          <strong>Reels</strong> are the per-aggregate chains of
          activity. Every being's reel, every space's reel, every
          matter's reel has a head hash, the hash of its latest fact,
          which by the chain property fingerprints the entire history
          of that aggregate.
        </p>
        <p>
          <strong>Branches</strong> are timelines within a reality. A
          branch's root hash is computed from all its reel head
          hashes, plus its divergence point from its parent branch.
        </p>
        <p>
          <strong>Realities</strong> are sovereign substrates
          containing branches. A reality's root hash is computed from
          all its branch root hashes.
        </p>

        <pre className="ns-code">{`               reality root hash
              /                  \\
        branch root           branch root
        /     |     \\         /         \\
     reel   reel   reel    reel        reel
      |      |      |       |           |
     fact   fact   fact    fact        fact
      ↓      ↓      ↓       ↓           ↓
   each fact's hash incorporates the previous
`}</pre>

        <aside className="ns-doc-aside">
          <p>
            <strong>One 32-byte fingerprint identifies the entire
            substrate's state.</strong> If two realities have the
            same root hash, they're bit identical. If they differ,
            you walk down the tree to find exactly where. Nothing is
            hidden. Nothing is approximated. The hash is the truth.
          </p>
        </aside>
      </section>

      {/* ────────────────────────────────────────────────────────── */}
      {/* SECTION 7 . WHAT THIS ENABLES                               */}
      {/* ────────────────────────────────────────────────────────── */}
      <section>
        <h2>What this enables</h2>

        <h3>Verifiable replay</h3>
        <p>
          Take a reality's facts. Replay them on a fresh substrate.
          Recompute the root hash. If it matches the original, the
          replay is provably correct, bit for bit identical to the
          source. If it doesn't match, you can walk the tree and find
          exactly where determinism broke. No conventional operating
          system can offer this. TreeOS makes it structural.
        </p>

        <h3>Efficient federation</h3>
        <p>
          When two TreeOS realities federate, they don't need to
          transfer their entire state. They exchange root hashes. If
          the hashes match, no transfer needed. If they differ, they
          walk the hash tree to find the divergence point and
          transfer only what's missing. This is how Git syncs huge
          codebases instantly; the same property applies at the
          substrate level for everything TreeOS holds.
        </p>

        <h3>Automatic deduplication</h3>
        <p>
          The same content stored twice produces the same hash, which
          means it's the same storage object. The substrate naturally
          collapses redundancy. For a system that preserves complete
          history, this is the difference between linear growth (logs
          accumulating forever) and growth proportional to unique
          activity (the same daily patterns compress structurally).
        </p>

        <h3>Tamper evident history</h3>
        <p>
          Modify any fact, anywhere in the substrate. Every hash
          above it breaks. The reel's head hash changes. The branch's
          root hash changes. The reality's root hash changes. The
          substrate becomes structurally tamper evident at every
          scale. You don't need a separate audit log. The structure
          IS the audit log.
        </p>

        <h3>Trust through math</h3>
        <p>
          Conventional trust depends on operator honesty: do I trust
          your system administrator? TreeOS replaces operator trust
          with mathematical verification. Two parties exchange
          hashes. They verify by recomputing. Trust comes from the
          math working, not from trusting each other. This is what
          makes TreeOS federation possible across boundaries that
          conventional systems can't cross.
        </p>
      </section>

      {/* ────────────────────────────────────────────────────────── */}
      {/* SECTION 8 . THREE LAYERS, ONE SYSTEM                        */}
      {/* ────────────────────────────────────────────────────────── */}
      <section>
        <h2>Three layers, one system</h2>
        <p>
          TreeOS has three layered identity systems that work
          together.
        </p>

        <pre className="ns-code">{`semantic identity (IBP)       where things are, what they mean
historical identity (chain)   what happened, in what order, by whom
storage identity (CAS)        what content exactly, by fingerprint
`}</pre>

        <p>
          <strong>Semantic identity</strong> is how beings and people
          navigate the substrate, by meaning, by relationship, by
          purpose. Beings, spaces, realities, addresses. See{" "}
          <Link to="/factory/roles" className="ns-inline-link">
            /factory/roles
          </Link>{" "}
          for how this surface gets composed per moment.
        </p>
        <p>
          <strong>Historical identity</strong> is how the substrate
          remembers, in what order, by whom. The fact chain preserves
          causation and biography.{" "}
          <Link to="/factory/branches" className="ns-inline-link">
            /factory/branches
          </Link>{" "}
          shows how the chain forks and how identity persists across
          divergent worlds.
        </p>
        <p>
          <strong>Storage identity</strong> is how the substrate
          verifies, dedupes, and transports. Hashes identify by
          fingerprint. The chain holds facts about bytes; the bytes
          themselves live in a content addressable store, separate
          from the chain, addressed by what they are.
        </p>
        <p>
          These three layers compose. A single act flows through all
          of them: it has semantic meaning (this being acted at this
          position), historical place (this fact came after that
          one), and storage identity (this exact content has this
          hash). The substrate uses all three together.
        </p>
        <p>
          The semantic layer is for humans and beings. The historical
          layer is for memory. The storage layer is for verification
          and efficiency. None of them does the others' job. Each
          one does its job well, and together they give TreeOS
          something most operating systems don't have: complete,
          verifiable, efficient memory.
        </p>

        <aside className="ns-doc-aside">
          <p>
            <strong>The substrate doesn't just remember what
            happened. It can prove it.</strong>
          </p>
        </aside>
      </section>

      {/* ────────────────────────────────────────────────────────── */}
      {/* SECTION 9 . CONTENT IS NOT THE WHOLE PICTURE                */}
      {/* ────────────────────────────────────────────────────────── */}
      <section>
        <h2>One thing hashes do not name</h2>
        <p>
          A hash answers "is this the same content?" It does not answer
          "is this the same actor?" Two beings can hash the same bytes
          and produce the same fingerprint, but they are still two
          different beings. For content the question is identity by
          equality, and a hash is the right primitive. For agents,
          beings and the realities they live in, the question is
          identity by authorship, and TreeOS uses a different primitive
          to answer it: a public key.
        </p>
        <p>
          The principle stays the same. A public key is itself the
          content address of a secret, so content and agents share one
          rule: every TreeOS identifier is a cryptographic value of
          what it is. The mechanics of how that plays out for beings
          and realities (wallets, signing, the encoding, and I_AM as
          the reality's own keypair) are the next page.
        </p>

        <aside className="ns-doc-aside">
          <p>
            Continue at{" "}
            <Link to="/factory/identity" className="ns-inline-link">
              /factory/identity
            </Link>
            . Beings and realities as wallets.
          </p>
        </aside>
      </section>

      {/* ────────────────────────────────────────────────────────── */}
      {/* CLOSING NAV                                                 */}
      {/* ────────────────────────────────────────────────────────── */}
      <nav className="ns-doc-aside">
        <p>
          Previous.{" "}
          <Link to="/factory/branches" className="ns-inline-link">
            Branches
          </Link>
          . How TreeOS treats time and possibility from the bottom up.
          <br />
          Next.{" "}
          <Link to="/factory/identity" className="ns-inline-link">
            Identity
          </Link>
          . Beings and realities named by public key, the other half of
          the same principle.
        </p>
      </nav>
    </article>
  );
};

export default FactoryIntegrity;
