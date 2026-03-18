
import "./CLIAbout.css";

const CmdRow = ({ cmd, desc }) => (
  <div className="cli-cmd-row">
    <span className="cli-cmd-name">{cmd}</span>
    <span className="cli-cmd-desc">{desc}</span>
  </div>
);

const CLIAbout = () => {
  return (
    <div className="about-cli">
      <div className="cli-card">

        {/* ── BACK ── */}
        <div className="al-page-back">
          <a className="al-back-link" href="/about">←</a>
        </div>

        {/* ── HEADER ── */}
        <div className="cli-header">
          <h2 className="cli-title">💻 CLI</h2>
          <p className="cli-subtitle">
            Navigate and manage your trees from the terminal. treef-cli maps
            familiar filesystem commands to the Tree API so you can work with
            your trees the way you work with directories.
          </p>
          <p className="cli-subtitle" style={{ marginTop: 8 }}>
            The CLI is not as built out as the web app and API, but the main
            features are there and it will be continuously expanded. If you
            prefer working from a terminal, this is for you.
          </p>
        </div>

        {/* ── INSTALL ── */}
        <div className="cli-section">
          <div className="cli-section-title">
            <span className="cli-section-icon">📦</span> Install
          </div>
          <div className="cli-section-text">
            Install globally with npm:
          </div>
          <div className="cli-code-block">npm install -g treef-cli</div>
        </div>

        {/* ── LOGIN ── */}
        <div className="cli-section">
          <div className="cli-section-title">
            <span className="cli-section-icon">🔑</span> Login
          </div>
          <div className="cli-section-text">
            Create an API key from your profile page, then authenticate:
          </div>
          <div className="cli-code-block">treef login --key YOUR_API_KEY</div>
          <div className="cli-note">
            Credentials are stored locally in ~/.tree-cli/config.json. You only
            need to do this once.
          </div>
        </div>

        {/* ── SESSION ── */}
        <div className="cli-section">
          <div className="cli-section-title">
            <span className="cli-section-icon">🖥️</span> Session
          </div>
          <CmdRow cmd="treef start" desc="Launch interactive shell mode" />
          <CmdRow cmd="treef stop" desc="Exit the shell" />
          <CmdRow cmd="treef login --key KEY" desc="Authenticate with an API key" />
          <CmdRow cmd="treef logout" desc="Remove stored credentials" />
        </div>

        {/* ── HOME ── */}
        <div className="cli-section">
          <div className="cli-section-title">
            <span className="cli-section-icon">🏠</span> Home
          </div>
          <div className="cli-section-text" style={{ marginBottom: 14 }}>
            Your user home. View your roots, manage raw ideas, and switch
            between trees.
          </div>
          <CmdRow cmd="treef whoami" desc="Show current user and active tree" />
          <CmdRow cmd="roots" desc="List all your root trees" />
          <CmdRow cmd="use <name>" desc="Switch the active tree" />
          <CmdRow cmd="mkroot <name>" desc="Create a new root tree" />
          <CmdRow cmd="home" desc="Return to user home from any tree" />
          <CmdRow cmd="ideas" desc="List your raw ideas" />
          <CmdRow cmd="idea <content>" desc="Create a new raw idea" />
          <CmdRow cmd="rm-idea <id> -f" desc="Delete an idea" />
          <CmdRow cmd="idea-place <id>" desc="AI places the idea in the best tree" />
          <CmdRow cmd="idea-transfer <id> <nodeId>" desc="Move an idea to a specific node" />
        </div>

        {/* ── NAVIGATION ── */}
        <div className="cli-section">
          <div className="cli-section-title">
            <span className="cli-section-icon">🧭</span> Navigation
          </div>
          <CmdRow cmd="pwd" desc="Show current path in the tree" />
          <CmdRow cmd="ls" desc="List children of the current node" />
          <CmdRow cmd="ls -l" desc="Long format with IDs and status" />
          <CmdRow cmd="cd <name>" desc="Enter a child node (supports .. and /)" />
          <CmdRow cmd="tree" desc="Visualize the subtree from current location" />
        </div>

        {/* ── NODE MANAGEMENT ── */}
        <div className="cli-section">
          <div className="cli-section-title">
            <span className="cli-section-icon">🔷</span> Node Management
          </div>
          <CmdRow cmd="mkdir <name>" desc="Create a child node" />
          <CmdRow cmd="rm <name> -f" desc="Soft-delete a node" />
          <CmdRow cmd="rename <name> <new>" desc="Rename a node" />
          <CmdRow cmd="mv <name> <destId>" desc="Move a node to a new parent" />
          <CmdRow cmd="status <name> <status>" desc="Set status (active, completed, trimmed)" />
        </div>

        {/* ── NOTES & VALUES ── */}
        <div className="cli-section">
          <div className="cli-section-title">
            <span className="cli-section-icon">📝</span> Notes & Values
          </div>
          <CmdRow cmd="notes" desc="View notes on the current node" />
          <CmdRow cmd="note <content>" desc="Add a note" />
          <CmdRow cmd="rm-note <id> -f" desc="Delete a note" />
          <CmdRow cmd="values" desc="Display key-value pairs" />
          <CmdRow cmd="set <key> <value>" desc="Create or update a value" />
        </div>

        {/* ── AI ── */}
        <div className="cli-section">
          <div className="cli-section-title">
            <span className="cli-section-icon">🧠</span> AI
          </div>
          <CmdRow cmd="chat <message>" desc="Talk to the AI about the current branch" />
          <CmdRow cmd="place <message>" desc="AI organizes content into the current branch" />
        </div>

        {/* ── UNDERSTANDING ── */}
        <div className="cli-section">
          <div className="cli-section-title">
            <span className="cli-section-icon">🔬</span> Understanding
          </div>
          <CmdRow cmd="understand [perspective]" desc="Start an understanding run" />
          <CmdRow cmd="understandings" desc="List all runs" />
          <CmdRow cmd="understand-status <runId>" desc="Check run progress" />
          <CmdRow cmd="understand-stop <runId>" desc="Stop a running analysis" />
          <div className="cli-note">
            Commands use fuzzy name matching. Multi-word names need no quotes.
            If ambiguous, you will be prompted to pick by ID.
          </div>
        </div>

      </div>
    </div>
  );
};

export default CLIAbout;
