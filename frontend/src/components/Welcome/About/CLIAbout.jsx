
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
            Credentials are stored locally in ~/.treef-cli/config.json. You only
            need to do this once.
          </div>
        </div>

        {/* ── SESSION ── */}
        <div className="cli-section">
          <div className="cli-section-title">
            <span className="cli-section-icon">🖥️</span> Session
          </div>
          <CmdRow cmd="treef start" desc="Launch interactive shell mode" />
          <CmdRow cmd="treef stop / exit" desc="Exit the shell" />
          <CmdRow cmd="treef login --key KEY" desc="Authenticate with an API key" />
          <CmdRow cmd="treef logout" desc="Remove stored credentials" />
          <CmdRow cmd="whoami" desc="Show current user and active tree" />
        </div>

        {/* ── HOME ── */}
        <div className="cli-section">
          <div className="cli-section-title">
            <span className="cli-section-icon">🏠</span> User Home
          </div>
          <div className="cli-section-text" style={{ marginBottom: 14 }}>
            Commands available without entering a tree.
          </div>
          <CmdRow cmd="roots" desc="List all your root trees" />
          <CmdRow cmd="use <name>" desc="Switch the active tree" />
          <CmdRow cmd="root <name>" desc="Switch the active tree (alias for use)" />
          <CmdRow cmd="mkroot <name>" desc="Create a new root tree" />
          <CmdRow cmd="home" desc="Return to user home from any tree" />
          <CmdRow cmd="ideas" desc="List pending/stuck/processing ideas. Flags: --pending --processing --stuck --done --all. Stack to combine" />
          <CmdRow cmd="idea <message>" desc="Send an idea, get an AI response, and auto-navigate to where it was placed" />
          <CmdRow cmd="idea-store <content>" desc="Save a raw idea for later without processing" />
          <CmdRow cmd="rm-idea <id> -f" desc="Delete an idea" />
          <CmdRow cmd="idea-place <id or message>" desc="AI-place an idea (fire-and-forget). Pass a raw idea ID or type content directly" />
          <CmdRow cmd="idea-auto [on|off]" desc="Toggle automatic placement of pending raw ideas every 15 min (Standard plan+). No arg = show current status" />
          <CmdRow cmd="idea-transfer <id> <nodeId>" desc="Manually transfer an idea to a specific node" />
          <CmdRow cmd="notes" desc="List your user-level notes" />
          <CmdRow cmd="chats" desc="In home: all your AI chats across every tree. In tree: current node's chats" />
          <CmdRow cmd="contributions" desc="List your recent contributions" />
        </div>

        {/* ── NAVIGATION ── */}
        <div className="cli-section">
          <div className="cli-section-title">
            <span className="cli-section-icon">🧭</span> Tree Navigation
          </div>
          <div className="cli-section-text" style={{ marginBottom: 14 }}>
            Commands available once you are inside a tree.
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
          <CmdRow cmd="mkdir <name>" desc="Create a child node. Comma-separate for multiple: mkdir foo, bar, baz" />
          <CmdRow cmd="rm <name> -f" desc="Soft-delete a node" />
          <CmdRow cmd="rename <name> <new>" desc="Rename a node" />
          <CmdRow cmd="mv <name> <destId>" desc="Move a node to a new parent" />
          <CmdRow cmd="status <name> <status>" desc="Set status (active, completed, trimmed)" />
          <CmdRow cmd="prestige" desc="Prestige the current node (create a new version)" />
        </div>

        {/* ── SCHEDULING ── */}
        <div className="cli-section">
          <div className="cli-section-title">
            <span className="cli-section-icon">📅</span> Scheduling
          </div>
          <div className="cli-note" style={{ marginBottom: 10 }}>
            Date is MM/DD/YYYY, time is HH:MM or HH:MMam/pm, reeffect is hours (default 0).
            Omit time for midnight. Omit date for today. Use &quot;clear&quot; to remove.
          </div>
          <CmdRow cmd="schedule <datetime> [reeffect]" desc="Set schedule (e.g. 1/11/2025 3, 1/11/2025 11:45pm 5, or 'clear')" />
          <CmdRow cmd="calendar" desc="Show scheduled dates across the tree" />
          <CmdRow cmd="dream-time <HH:MM>" desc="Set nightly dream time (or 'clear')" />
        </div>

        {/* ── NOTES & VALUES ── */}
        <div className="cli-section">
          <div className="cli-section-title">
            <span className="cli-section-icon">📝</span> Notes & Values
          </div>
          <CmdRow cmd="notes" desc="View notes on the current node" />
          <CmdRow cmd="note <content>" desc="Add a note" />
          <CmdRow cmd="rm-note <id> -f" desc="Delete a note" />
          <CmdRow cmd="book" desc="Print the full book of notes from current node down" />
          <CmdRow cmd="contributions" desc="List contributions for the current node" />
          <CmdRow cmd="values" desc="Display key-value pairs" />
          <CmdRow cmd="value <key> <value>" desc="Set a value" />
          <CmdRow cmd="goal <key> <goal>" desc="Set a goal" />
        </div>

        {/* ── AI ── */}
        <div className="cli-section">
          <div className="cli-section-title">
            <span className="cli-section-icon">🧠</span> AI
          </div>
          <CmdRow cmd="chat <message>" desc="Full conversation -- reads tree, makes edits, responds" />
          <CmdRow cmd="place <message>" desc="Places content onto the tree without responding" />
          <CmdRow cmd="query <message>" desc="Ask about the tree without making any changes" />
          <CmdRow cmd="chats" desc="View past AI chat history for the current node" />
          <CmdRow cmd="chats tree" desc="View all AI chat history across the whole tree" />
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
        </div>

        {/* ── BLOG ── */}
        <div className="cli-section">
          <div className="cli-section-title">
            <span className="cli-section-icon">📰</span> Blog
          </div>
          <div className="cli-section-text" style={{ marginBottom: 14 }}>
            Posts from the Tree creator -- updates, ideas, and what&apos;s coming next. No login required.
          </div>
          <CmdRow cmd="blogs" desc="List all published blog posts with summaries" />
          <CmdRow cmd="blog <slug or number>" desc="Read a post by slug (blog why-i-built-tree) or list number (blog 1)" />
        </div>

        {/* ── NAME MATCHING ── */}
        <div className="cli-note" style={{ marginTop: 8 }}>
          <strong>Name matching:</strong> All commands accept names or IDs. No quotes needed for multi-word names.
          Matching is fuzzy -- exact ID prefix, exact name, starts with, or contains. If ambiguous, you will be prompted to pick by ID.
        </div>

      </div>
    </div>
  );
};

export default CLIAbout;
