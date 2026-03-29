import { pageShell } from "./shared.js";

export function renderAboutPage() {
  const body = `
    <div style="animation:fadeInUp 0.5s ease-out both;margin-bottom:24px;">
      <h1 style="font-size:28px;font-weight:800;letter-spacing:-0.5px;margin-bottom:6px;">About Horizon</h1>
      <p style="font-size:15px;color:var(--text-secondary);">The directory for the TreeOS network.</p>
    </div>

    <div class="glass-card" style="animation-delay:0.05s;">
      <h2>What this is</h2>
      <p style="color:var(--text-secondary);line-height:1.8;font-size:14px;">
        Horizon is where lands find extensions, publish their own, and discover each other.
        It is a directory, not a platform. It does not host your land. It does not run your code.
        It stores manifests, files, and metadata so that <code>treeos ext install</code> knows where to look.
      </p>
      <p style="color:var(--text-secondary);line-height:1.8;font-size:14px;margin-top:12px;">
        When a land registers, it sends its public key, domain, and a list of public trees.
        When a land publishes, it sends the extension files signed by that key.
        When a land installs, it downloads files and verifies the checksum.
        That is the entire relationship.
      </p>
    </div>

    <div class="glass-card" style="animation-delay:0.1s;">
      <h2>Why it exists</h2>
      <p style="color:var(--text-secondary);line-height:1.8;font-size:14px;">
        TreeOS is an open source operating system for AI agents. The kernel is free. The extensions are free.
        The goal is to spread the technology and the ideas behind it so anyone can build on them.
        Horizon exists to make that practical. A shared directory where packages accumulate,
        where operators can browse what exists, and where the ecosystem grows together.
      </p>
    </div>

    <div class="glass-card" style="animation-delay:0.15s;">
      <h2>Anyone can run a Horizon</h2>
      <p style="color:var(--text-secondary);line-height:1.8;font-size:14px;">
        Horizon is open source. The same code running this directory can run yours.
        Clone the repo, point it at a MongoDB instance, and you have your own directory
        with the same API, the same publishing pipeline, the same browsing interface.
      </p>
      <p style="color:var(--text-secondary);line-height:1.8;font-size:14px;margin-top:12px;">
        Ideally, in the early days, we coordinate around one or a few directories so packages build
        together well. Extension A depends on extension B. If they are published to different directories
        that never sync, an operator installing A cannot find B. Coordination early means the ecosystem
        grows as one thing instead of fragmenting before it has mass.
      </p>
      <p style="color:var(--text-secondary);line-height:1.8;font-size:14px;margin-top:12px;">
        As the network matures and the package base is stable, branching makes more sense.
        Specialized directories for specific domains. Regional directories for latency.
        Private directories for enterprise use. The protocol is the same everywhere.
      </p>
    </div>

    <div class="glass-card" style="animation-delay:0.2s;">
      <h2>Multiple directories</h2>
      <p style="color:var(--text-secondary);line-height:1.8;font-size:14px;">
        A land can connect to multiple directories at the same time. Set <code>HORIZON_URL</code>
        to a comma-separated list and the land registers with all of them, re-registers every hour,
        and publishes to all of them. Each directory gets the same packages.
      </p>
      <p style="color:var(--text-secondary);line-height:1.8;font-size:14px;margin-top:12px;">
        The CLI resolves extensions from the first configured directory.
        If you run your own Horizon alongside this one, your land's packages appear in both.
        Other operators pointing at either directory can install them.
      </p>
    </div>

    <div class="glass-card" style="animation-delay:0.25s;">
      <h2>Security model</h2>
      <p style="color:var(--text-secondary);line-height:1.8;font-size:14px;">
        Every publish request is signed with the land's Ed25519 private key.
        Horizon verifies the signature against the stored public key.
        Unregistered lands cannot publish. Name ownership belongs to the first publisher.
        Versions are immutable once published. Unpublished version numbers are burned forever.
      </p>
      <p style="color:var(--text-secondary);line-height:1.8;font-size:14px;margin-top:12px;">
        Extensions run in the same process as the kernel. Review every extension before installing.
        The directory does not audit code. The operator always decides.
      </p>
    </div>

    <div class="glass-card" style="animation-delay:0.3s;">
      <h2>Contributing to extensions</h2>
      <p style="color:var(--text-secondary);line-height:1.8;font-size:14px;">
        Code lives on your land. You build extensions locally and publish to Horizon.
        If you want others to contribute, push the code to a git host and include a
        <code>repoUrl</code> in your manifest. Horizon displays it on the extension page
        so others can find the source, fork it, and submit pull requests.
      </p>
      <p style="color:var(--text-secondary);line-height:1.8;font-size:14px;margin-top:12px;">
        If you want to improve someone else's extension, clone their repo, make changes,
        and submit a PR. The author publishes the next version to Horizon. If the author
        is inactive, fork the repo and publish under a new name. Horizon tracks name
        ownership, not code ownership. The ecosystem grows through open contribution.
      </p>
    </div>

    <div class="glass-card" style="animation-delay:0.35s;">
      <h2>Get involved</h2>
      <p style="color:var(--text-secondary);line-height:1.8;font-size:14px;">
        <a href="https://github.com/taborgreat/TreeOS" style="color:var(--accent);">Source code on GitHub</a>.
        Start a land. Build an extension. Publish it here. If something is broken, file an issue.
        If something is missing, build it.
      </p>
      <p style="color:var(--text-secondary);line-height:1.8;font-size:14px;margin-top:12px;">
        <a href="https://treeos.ai" style="color:var(--accent);">treeos.ai</a> for documentation.
        <code>npm install -g treeos</code> for the CLI.
        <code>npx create-treeos my-land</code> to start a land.
      </p>
    </div>
  `;

  return pageShell({
    title: "About | Canopy Horizon",
    activePage: "about",
  }, body);
}
