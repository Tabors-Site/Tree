import SiteHeader from "./SiteHeader.jsx";
import SiteFooter from "./SiteFooter.jsx";
// Reuse the shared prose look (.ns-doc-*, .ns-list, .ns-small, .ns-code).
import "./IbpPage.css";
import "./LicensePage.css";

const SEED_LICENSE_URL =
  "https://github.com/Tabors-Site/Tree/blob/main/reality/seed/LICENSE";
const CONTACT_EMAIL = "taborgreat@gmail.com";

/**
 * LicensePage. The /license page. Explains the dual license on the site
 * itself instead of bouncing straight to GitHub, then links out to the
 * full AGPL text. Scope is the seed only; extensions, roleFlows, and
 * Horizon-posted work are not governed here.
 */
const LicensePage = () => {
  return (
    <div className="ns-page">
      <SiteHeader />

      <div className="ns-license-banner">
        <p className="ns-license-banner-head">
          This is built for the people, and it is meant to be free.
        </p>
        <p className="ns-license-banner-sub">
          TreeOS is open source. You can run it, study it, change it, and
          share it at no cost. The terms below exist to keep it that way:
          to make sure the seed stays open for everyone, even when others
          build on it. The commercial license is only for those who want
          to close the seed's source and take it in a private direction
          others cannot see. For everyone else, it is free, and it stays
          free.
        </p>
      </div>

      <article className="ns-doc">
        <header className="ns-doc-header">
          <p className="ns-doc-eyebrow">License</p>
          <h1 className="ns-doc-title">Licensing</h1>
          <p className="ns-doc-lede">
            The TreeOS seed is dual licensed. Free and open under the
            AGPL-3.0 by default, with a separate commercial license for
            those who cannot meet its terms.
          </p>
        </header>

        <section>
          <h2>What this covers</h2>
          <p>
            The license below applies to the <strong>seed</strong>: the
            code under <code>reality/seed/</code> that defines what TreeOS
            is. It does not cover the rest of the project. Extensions,
            roleFlows, clones, portals (browsers), and work you replicate
            or post to Horizon are your own, under your own terms. The
            seed is the sovereign core, and the licensing here is about
            the seed and nothing more.
          </p>
        </section>

        <section>
          <h2>AGPL-3.0, the free and open default</h2>
          <p>
            You are free to use, modify, fork, and distribute the seed at
            no cost. One obligation comes with it: if you run a modified
            seed over a network (a hosted reality, a SaaS, an API, anything
            network accessible), you must make your modified seed source
            available to its users under the same license.
          </p>
          <p>
            For most people, the AGPL is all they ever need. It keeps the
            seed open and ensures hosted forks stay open too.
          </p>
        </section>

        <section>
          <h2>The commercial license</h2>
          <p>
            There is only one reason to need this license: you want to
            close the seed's source and take it in a private direction
            others cannot see. The AGPL keeps every hosted or distributed
            fork of the seed open; the commercial license is the way to
            step outside that and keep your changes private. Concretely,
            you would choose it to:
          </p>
          <ul className="ns-list">
            <li>
              Host TreeOS realities as a service for your customers without
              the obligation to publish your modified seed source.
            </li>
            <li>
              Build closed-source products or internal tools on top of the
              seed.
            </li>
            <li>Keep your seed modifications private.</li>
            <li>
              Get priority support, security patches, or custom
              development.
            </li>
          </ul>
          <p>
            The commercial license does not withhold any code. You receive
            the same seed source as the public repository, plus a separate
            agreement that supersedes the AGPL for your usage. The
            difference is the legal permissions, not the code.
          </p>
        </section>

        <section>
          <h2>Read the full text</h2>
          <p>
            The complete AGPL-3.0 text, with the seed preamble, lives in
            the repository:
          </p>
          <p>
            <a
              href={SEED_LICENSE_URL}
              className="ns-inline-link"
              target="_blank"
              rel="noreferrer"
            >
              seed/LICENSE on GitHub
            </a>
          </p>
        </section>

        <section>
          <h2>Get a commercial license</h2>
          <p>
            Interested in a commercial license, or unsure which one applies
            to you? Terms and pricing are quoted per engagement. Write to{" "}
            <a
              href={`mailto:${CONTACT_EMAIL}?subject=TreeOS%20commercial%20license`}
              className="ns-inline-link"
            >
              {CONTACT_EMAIL}
            </a>
            .
          </p>
        </section>
      </article>

      <SiteFooter />
    </div>
  );
};

export default LicensePage;
