
import "./AboutLayout.css";

const Guide = () => {
  return (
    <div className="about-layout">
      <div className="al-page-card" style={{ maxWidth: 900 }}>

        {/* ── BACK ── */}
        <div className="al-page-back">
          <a className="al-back-link" href="/">←</a>
        </div>

        <h1 style={{ fontSize: "2.4rem", marginBottom: 8 }}>TreeOS Guide</h1>
        <p style={{ color: "rgba(255,255,255,0.5)", marginBottom: 48, fontSize: "1.1rem" }}>
          Everything you need to know. Simple to advanced.
        </p>

        {/* ══════════════════════════════════════════════════════════════ */}
        {/* 1. WHAT IS TREEOS */}
        {/* ══════════════════════════════════════════════════════════════ */}
        <Section title="What is TreeOS?">
          <P>
            TreeOS is an open source operating system for AI agents. You run a server (called a land),
            and AI lives there permanently. It builds and navigates tree-structured knowledge. It
            remembers. It grows. It connects to other lands through a federated network.
          </P>
          <P>
            The core is minimal: nodes, notes, types, status, and an AI conversation loop.
            Everything else (values, schedules, scripts, wallets, versioning) is an extension
            you install from the registry. The system adapts to what you need.
          </P>
        </Section>

        {/* ══════════════════════════════════════════════════════════════ */}
        {/* 2. THE KERNEL */}
        {/* ══════════════════════════════════════════════════════════════ */}
        <Section title="The Kernel">
          <P>
            A <strong>node</strong> has a name, a type, a status, children, and a metadata map.
            That is it. Notes (text or files) attach to nodes. Types (goal, plan, task, knowledge,
            resource, identity) tell agents what they are looking at. Status (active, completed,
            trimmed) tracks lifecycle. Custom types are valid.
          </P>
          <P>
            A <strong>tree</strong> is a root node with children. A <strong>land</strong> hosts
            trees, runs AI, and serves the API. A <strong>user</strong> has a username, password,
            one default LLM connection, and a metadata map for extension data.
          </P>
          <P>
            Three layers. The <strong>kernel</strong> is the data contract: Node/User schemas,
            the API protocol (chat/place/query), hooks, mode registry, orchestrator registry,
            extension loader, federation. Cannot change without forking.
            The <strong>core</strong> ships with every land: the AI conversation loop,
            WebSocket server, MCP bridge, OrchestratorRuntime, built-in tree modes,
            parseJsonSafe. Replaceable by extensions.
            <strong>Extensions</strong> are everything else: values, schedules, scripts,
            dreams, orchestrators. Install what you need. If you strip every extension,
            the kernel still boots.
          </P>
        </Section>

        {/* ══════════════════════════════════════════════════════════════ */}
        {/* 3. AI MODES */}
        {/* ══════════════════════════════════════════════════════════════ */}
        <Section title="Three Zones">
          <P>
            Where you are determines what the AI can do. There is no mode switching
            menu. Navigation is mode switching. <code>cd /</code> puts you in land management.
            <code>cd ~</code> puts you in personal home. <code>cd MyTree</code> puts you in
            tree mode. The AI's tools, context, and behavior change automatically.
          </P>
          <P>
            <strong>Land</strong> (<code>/</code>): The root. The land-manager extension gives the AI
            system-level tools: read config, list users, check peers, view extension status.
            Add the shell extension for server command execution.
            The AI becomes a land operator. Manage extensions, run diagnostics, all
            through chat. Requires god-tier access.
          </P>
          <P>
            <strong>Home</strong> (<code>~</code>): Your personal space. Raw ideas, notes across
            all trees, chat history, contributions. The AI helps you organize and reflect.
          </P>
          <P>
            <strong>Tree</strong> (<code>/MyTree</code>): Inside a tree. Three strict behavioral
            contracts apply:
          </P>
          <ul style={{ color: "rgba(255,255,255,0.7)", lineHeight: 2, paddingLeft: 20 }}>
            <li><strong>Chat</strong> reads and writes. Full conversation. Create, edit, delete, navigate.</li>
            <li><strong>Place</strong> writes only. Content placed silently. No conversational response.</li>
            <li><strong>Query</strong> reads only. Answers questions. Changes nothing.</li>
          </ul>
          <P>
            Each node controls what extensions are active at that position in the tree.
            Block an extension on a branch and it disappears for that entire subtree.
            Restrict it to read-only and it can observe but not modify. This is how
            a Health tree has a Fitness branch and a Food branch where each extension
            sees the other's data but can't write to it.
          </P>
          <Code>{`treeos cd Health/Fitness
treeos ext-restrict food read       # food can see but not write here

treeos cd Health/Food
treeos ext-restrict fitness read    # fitness can see but not write here

treeos ext-block solana             # no wallets anywhere on this branch`}</Code>
          <P>
            Three levels: <strong>active</strong> (full access),
            <strong> restricted</strong> (read-only),
            <strong> blocked</strong> (nothing). Inherits from parent to child.
          </P>
          <P>
            For developers building extensions, there are deeper customization layers:
            per-node tool configs, per-node AI behavior overrides, and replaceable
            conversation orchestrators. See the <a href="/about/extensions" style={{ color: "rgba(255,255,255,0.8)" }}>extension docs</a>.
          </P>
        </Section>

        {/* ══════════════════════════════════════════════════════════════ */}
        {/* 4. EXTENSIONS */}
        {/* ══════════════════════════════════════════════════════════════ */}
        <Section title="Extensions">
          <P>
            An extension is a folder with a <code>manifest.js</code> and an <code>index.js</code>.
            The manifest declares what it needs and what it provides. The index exports an
            <code> init(core)</code> function that receives the core services bundle.
            Dependencies support semver constraints (<code>needs.extensions: ["other@^1.0.0"]</code>).
          </P>
          <P>
            An extension can provide: HTTP routes, MCP tools, AI conversation modes, a custom
            orchestrator, background jobs, lifecycle hooks, CLI commands, Mongoose models,
            energy metering, session types, LLM assignment slots, environment variable
            declarations, and exported functions for other extensions to call.
          </P>
          <P>
            Extension data lives in <code>metadata</code> (a Map on every node and user).
            Each extension gets a namespace key matching its name. Extensions communicate
            through <code>getExtension()</code> and declared exports, never through direct
            file imports. Uninstalling one gracefully degrades everything that depends on it.
          </P>
          <P>
            Install from the registry: <code>treeos ext install understanding</code>.
            Dependencies are resolved automatically. Installs are verified with SHA256
            checksums. Extensions can also be installed from git repositories.
            Publish your own: <code>treeos ext publish my-extension</code>.
          </P>
          <P>
            Extensions that write to metadata should declare a <code>schemaVersion</code> and
            provide a <code>migrations.js</code> file. When the extension updates its data shape,
            the loader runs pending migrations at boot. This is what protects user data over
            years of updates. Never ship a metadata format change without a migration.
          </P>
          <P>
            <a href="/about/extensions" style={{ color: "rgba(255,255,255,0.8)" }}>Full extension docs</a>
          </P>
        </Section>

        {/* ══════════════════════════════════════════════════════════════ */}
        {/* 5. HOOKS */}
        {/* ══════════════════════════════════════════════════════════════ */}
        <Section title="Hooks">
          <P>
            Eight lifecycle hooks let extensions modify or react to core operations without
            touching core code. Register during <code>init(core)</code>.
          </P>
          <ul style={{ color: "rgba(255,255,255,0.7)", lineHeight: 2, paddingLeft: 20 }}>
            <li><code>beforeNote</code> / <code>afterNote</code> . tag version, flag dirty</li>
            <li><code>beforeContribution</code> . tag nodeVersion in audit log</li>
            <li><code>afterNodeCreate</code> . initialize extension data</li>
            <li><code>beforeStatusChange</code> / <code>afterStatusChange</code> . validate, react</li>
            <li><code>beforeNodeDelete</code> . cleanup</li>
            <li><code>enrichContext</code> . inject extension data into AI context</li>
          </ul>
          <P>
            Before hooks can cancel operations. After hooks run in parallel. enrichContext
            runs sequentially. All handlers have a 5 second timeout.
          </P>
        </Section>

        {/* ══════════════════════════════════════════════════════════════ */}
        {/* 5.5 AI ENTRY POINTS */}
        {/* ══════════════════════════════════════════════════════════════ */}
        <Section title="Building with AI">
          <P>
            Two core functions handle all AI interaction. Extensions never manage MCP
            connections, sessions, or AIChat records manually.
          </P>
          <P>
            <strong>runChat</strong>: single message, persistent session. Use for user-facing
            chat in any mode. Sessions persist per zone. Same tree keeps the same conversation.
            Switch trees and the conversation starts fresh.
          </P>
          <Code>{`const { answer } = await core.llm.runChat({
  userId, username,
  message: "show me land status",
  mode: "land:manager",
});`}</Code>
          <P>
            <strong>runPipeline</strong>: multi-step chain with managed lifecycle. Use for
            background jobs like dream cycles, understanding runs, cleanup passes. Each step
            switches mode, calls the LLM, and tracks the chain. Locks prevent concurrent runs.
          </P>
          <Code>{`const result = await core.llm.runPipeline({
  userId, username, rootId,
  description: "Dream cycle",
  lockNamespace: "dream",
  steps: async (pipeline) => {
    const { parsed } = await pipeline.step("tree:analyze", {
      prompt: "Find cleanup opportunities",
    });
    await pipeline.step("tree:structure", {
      prompt: "Execute plan",
    });
    return { summary: "Done" };
  },
});`}</Code>
          <P>
            Both handle automatically: MCP connection, mode switching, AIChat creation and
            finalization, abort/cancellation, session persistence, chain tracking, per-node
            tool restrictions, error cleanup. The internal LLM metadata never leaks to clients.
          </P>
        </Section>

        {/* ══════════════════════════════════════════════════════════════ */}
        {/* 6. LLM SYSTEM */}
        {/* ══════════════════════════════════════════════════════════════ */}
        <Section title="LLM System">
          <P>
            Every user has one default LLM connection (<code>llmDefault</code>). Set during
            registration or via <code>treeos llm add</code>. This is the model that powers
            all AI modes for that user across all trees.
          </P>
          <P>
            Tree owners can set a tree-level default (<code>llmDefault</code> on the root node)
            that overrides the user default for anyone working in that tree.
          </P>
          <P>
            Extensions register additional LLM slots in metadata. The resolution chain:
            extension slot on tree, then tree default, then extension slot on user, then user default.
          </P>
          <P>
            TreeOS is model-agnostic. Any OpenAI-compatible endpoint works (Ollama, vLLM,
            OpenRouter, Anthropic, OpenAI, local models).
          </P>
        </Section>

        {/* ══════════════════════════════════════════════════════════════ */}
        {/* 6.5 KERNEL CONFIG */}
        {/* ══════════════════════════════════════════════════════════════ */}
        <Section title="Kernel Config">
          <P>
            Every kernel tunable is configurable from the land's .config node. No code editing.
            Set a value with the CLI and it applies on next boot.
          </P>
          <Code>{`treeos config set maxToolIterations 25
treeos config set llmTimeout 900        # seconds
treeos config set noteMaxChars 10000
treeos config set carryMessages 6`}</Code>
          <P>Available kernel config keys:</P>
          <ul style={{ color: "rgba(255,255,255,0.7)", lineHeight: 2, paddingLeft: 20 }}>
            <li><code>llmTimeout</code> . seconds per LLM API call (default: 900)</li>
            <li><code>llmMaxRetries</code> . retry count on 429/500 errors (default: 3)</li>
            <li><code>maxToolIterations</code> . max tool calls per message (default: 15)</li>
            <li><code>maxConversationMessages</code> . context window size (default: 30)</li>
            <li><code>noteMaxChars</code> . max characters per note (default: 5000)</li>
            <li><code>treeSummaryMaxDepth</code> . how deep the AI sees the tree (default: 4)</li>
            <li><code>treeSummaryMaxNodes</code> . how many nodes the AI sees (default: 60)</li>
            <li><code>carryMessages</code> . messages carried across mode switches (default: 4)</li>
            <li><code>sessionTTL</code> . scoped session idle timeout in seconds (default: 900)</li>
            <li><code>staleSessionTimeout</code> . stale session cleanup in seconds (default: 1800)</li>
          </ul>
          <P>
            Extensions read their own config keys via <code>core.config.get("myExtension.timeout")</code>.
            Any key can be stored in the .config node. The kernel only processes the keys above.
            Everything else is available for extensions to read.
          </P>
          <P>
            With the land-manager extension installed, the AI can read and write these config
            values through chat. A land that manages itself: adjust timeouts, tune context
            windows, configure extensions, all through natural language at the land root.
          </P>
        </Section>

        {/* ══════════════════════════════════════════════════════════════ */}
        {/* 7. CLI */}
        {/* ══════════════════════════════════════════════════════════════ */}
        <Section title="CLI">
          <P>
            The CLI works like a regular terminal. <code>cd</code>, <code>ls</code>,
            <code> mkdir</code>, <code>rm</code>, <code>mv</code>. Navigate trees like
            a filesystem. Add notes with <code>note</code>. Chat with <code>chat</code>.
          </P>
          <P>
            Extension commands appear automatically. If the connected land has the solana
            extension, <code>wallet</code> shows up in help. If it does not, the command
            does not exist.
          </P>
          <Code>{`npm install -g treeos
treeos connect https://treeos.ai
treeos register
treeos start`}</Code>
          <P>
            <a href="/about/cli" style={{ color: "rgba(255,255,255,0.8)" }}>Full CLI reference</a>
          </P>
        </Section>

        {/* ══════════════════════════════════════════════════════════════ */}
        {/* 8. FEDERATION */}
        {/* ══════════════════════════════════════════════════════════════ */}
        <Section title="Federation (Canopy)">
          <P>
            Lands connect through the Canopy protocol. Each land is sovereign. No central
            authority. Peer with other lands, browse their public trees, invite their users
            to collaborate on yours.
          </P>
          <P>
            The directory service at <a href="https://dir.treeos.ai" style={{ color: "rgba(255,255,255,0.8)" }}>dir.treeos.ai</a> indexes
            lands, public trees, and the extension registry. It is optional. Lands can peer
            directly without it.
          </P>
          <P>
            Lands advertise their loaded extensions. The foundation for capability-aware
            federation where agents can navigate between lands, carrying context and
            discovering what tools exist at each destination.
          </P>
        </Section>

        {/* ══════════════════════════════════════════════════════════════ */}
        {/* 9. RUNNING A LAND */}
        {/* ══════════════════════════════════════════════════════════════ */}
        <Section title="Running a Land">
          <P>
            A land is a Node.js server with MongoDB. First boot walks you through setup:
            domain, name, extension selection from the registry.
          </P>
          <Code>{`git clone https://github.com/Tabors-Site/Tree && cd Tree
npm run install:all
npm land`}</Code>
          <P>
            Or connect to an existing land as a user:
          </P>
          <Code>{`treeos connect https://treeos.ai
treeos register`}</Code>
          <P>
            <a href="/about/land" style={{ color: "rgba(255,255,255,0.8)" }}>Land setup guide</a>
          </P>
        </Section>

        {/* ══════════════════════════════════════════════════════════════ */}
        {/* 10. BUILDING EXTENSIONS */}
        {/* ══════════════════════════════════════════════════════════════ */}
        <Section title="Building Extensions">
          <P>
            Create a folder in <code>extensions/</code>. Add <code>manifest.js</code> and
            <code> index.js</code>. Restart. Your extension loads.
          </P>
          <P>
            The manifest declares dependencies (models, services, other extensions with
            semver constraints) and what you provide (routes, tools, modes, orchestrator,
            hooks, jobs, CLI commands, exported functions).
            The <code>init(core)</code> function receives only the services you declared.
          </P>
          <P>
            Store data in <code>node.metadata</code> or <code>user.metadata</code> under
            your extension name. Communicate with other extensions
            through <code>getExtension()</code> and declared exports. Use hooks to inject
            into AI context. Use <code>html-rendering</code>'s <code>registerPage()</code> to
            add your own HTML pages. Publish to the registry for others.
          </P>
          <P>
            Example: the fitness extension registers two AI modes (coach and log),
            one HTTP route, and one CLI command. It uses existing kernel tools
            (create-new-node-branch, edit-node-version-value, add-node-prestige,
            get-active-leaf-execution-frontier) with fitness-specific system prompts.
            No custom tools needed. The intelligence is in the prompts, the structure
            is in the tree, the tracking is in values and prestige. Five files, zero
            kernel changes.
          </P>
          <P>
            <a href="/about/extensions" style={{ color: "rgba(255,255,255,0.8)" }}>Full extension developer docs</a>
          </P>
        </Section>

        {/* ══════════════════════════════════════════════════════════════ */}
        {/* 11. API */}
        {/* ══════════════════════════════════════════════════════════════ */}
        <Section title="API">
          <P>
            REST API at <code>/api/v1/</code>. Bearer token or API key auth.
            Every tree operation, note, value, and AI mode is accessible via HTTP.
            The <code>/api/v1/protocol</code> endpoint returns the land's capabilities,
            loaded extensions, and available CLI commands.
          </P>
          <P>
            <a href="/about/api" style={{ color: "rgba(255,255,255,0.8)" }}>Full API reference</a>
          </P>
        </Section>

        {/* ── LINKS ── */}
        <div style={{ marginTop: 48, paddingTop: 24, borderTop: "1px solid rgba(255,255,255,0.1)", textAlign: "center" }}>
          <a href="/" style={{ color: "rgba(255,255,255,0.6)", marginRight: 16 }}>Home</a>
          <a href="/about" style={{ color: "rgba(255,255,255,0.6)", marginRight: 16 }}>Docs</a>
          <a href="/about/extensions" style={{ color: "rgba(255,255,255,0.6)", marginRight: 16 }}>Extensions</a>
          <a href="/about/api" style={{ color: "rgba(255,255,255,0.6)", marginRight: 16 }}>API</a>
          <a href="/about/cli" style={{ color: "rgba(255,255,255,0.6)", marginRight: 16 }}>CLI</a>
          <a href="https://github.com/Tabors-Site/Tree" style={{ color: "rgba(255,255,255,0.6)" }}>GitHub</a>
        </div>

      </div>
    </div>
  );
};

const Section = ({ title, children }) => (
  <div style={{ marginBottom: 48 }}>
    <h2 style={{ fontSize: "1.6rem", marginBottom: 16, color: "rgba(255,255,255,0.9)" }}>{title}</h2>
    {children}
  </div>
);

const P = ({ children }) => (
  <p style={{ color: "rgba(255,255,255,0.65)", lineHeight: 1.8, marginBottom: 16, fontSize: "1.05rem" }}>
    {children}
  </p>
);

const Code = ({ children }) => (
  <pre style={{
    background: "rgba(0,0,0,0.4)",
    border: "1px solid rgba(255,255,255,0.1)",
    borderRadius: 8,
    padding: "16px 20px",
    color: "rgba(255,255,255,0.7)",
    fontSize: "0.9rem",
    lineHeight: 1.6,
    overflowX: "auto",
    marginBottom: 16,
  }}>{children}</pre>
);

export default Guide;
