
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
          <h2 className="cli-title">💻 TreeOS CLI</h2>
          <p className="cli-subtitle">
            Navigate and manage your trees like a filesystem from the terminal.
            All commands map to the <a href="/about/api" style={{ color: "rgba(255,255,255,0.85)" }}>TreeOS REST API</a>.
            Config stored in <code>~/.treeos/config.json</code>.
          </p>
        </div>

        {/* ── INSTALL ── */}
        <div className="cli-section">
          <div className="cli-section-title">
            <span className="cli-section-icon">📦</span> Install
          </div>
          <div className="cli-code-block">npm install -g TreeOS</div>
        </div>

        {/* ── SESSION ── */}
        <div className="cli-section">
          <div className="cli-section-title">
            <span className="cli-section-icon">🖥️</span> Session
          </div>
          <CmdRow cmd="start / shell" desc="Launch interactive shell" />
          <CmdRow cmd="stop / exit" desc="Exit the shell" />
          <CmdRow cmd="login --key <key>" desc="Authenticate with your API key" />
          <CmdRow cmd="logout" desc="Clear stored credentials" />
          <CmdRow cmd="whoami" desc="Show login, plan, energy, and active tree" />
        </div>

        {/* ── HOME ── */}
        <div className="cli-section">
          <div className="cli-section-title">
            <span className="cli-section-icon">🏠</span> User Home
          </div>
          <div className="cli-section-text" style={{ marginBottom: 14 }}>
            Commands available without entering a tree. <code>ls</code> and <code>cd</code> also work from home to list/enter trees.
          </div>
          <CmdRow cmd="roots" desc="List all your trees" />
          <CmdRow cmd="use <name> / root <name>" desc="Enter a tree by name or ID" />
          <CmdRow cmd="mkroot <name>" desc="Create a new tree" />
          <CmdRow cmd="retire/leave [name] -f" desc="Leave a shared tree or delete if sole owner" />
          <CmdRow cmd="home" desc="Leave current tree, return home" />
          <CmdRow cmd="invites" desc="List pending invites from other users" />
          <CmdRow cmd="tags / mail" desc="Notes where you've been @tagged" />
          <CmdRow cmd="notes" desc="Your user-level notes. -l limit, -q search" />
          <CmdRow cmd="chats" desc="All AI chats across your trees. -l limit" />
          <CmdRow cmd="contributions" desc="Your recent contributions" />
          <CmdRow cmd="share-token [token]" desc="Show or set your share token" />
          <CmdRow cmd="share idea <id>" desc="Public link to a raw idea" />
        </div>

        {/* ── RAW IDEAS ── */}
        <div className="cli-section">
          <div className="cli-section-title">
            <span className="cli-section-icon">💡</span> Raw Ideas
          </div>
          <div className="cli-section-text" style={{ marginBottom: 14 }}>
            Capture ideas from anywhere. AI figures out where they belong.
          </div>
          <CmdRow cmd="ideas" desc="List ideas. -p pending, -r processing, -s stuck, -d done, -a all, -q search, -l limit" />
          <CmdRow cmd="cat idea <id or #>" desc="View full content of a raw idea" />
          <CmdRow cmd="idea <message>" desc="AI places your idea in the right tree and navigates you there" />
          <CmdRow cmd="idea-store <message>" desc="Save an idea for later without processing" />
          <CmdRow cmd="idea-place <id or message>" desc="AI-place an idea (fire-and-forget)" />
          <CmdRow cmd="idea-auto [on/off]" desc="Toggle auto-placement every 15 min (Standard plan+)" />
          <CmdRow cmd="idea-transfer <id> <nodeId>" desc="Manually move an idea to a specific node" />
          <CmdRow cmd="rm-idea <id> -f" desc="Delete a raw idea" />
        </div>

        {/* ── NAVIGATION ── */}
        <div className="cli-section">
          <div className="cli-section-title">
            <span className="cli-section-icon">🧭</span> Navigation
          </div>
          <div className="cli-section-text" style={{ marginBottom: 14 }}>
            Inside a tree. <code>ls</code> and <code>cd</code> also work from home (listing/entering trees).
          </div>
          <CmdRow cmd="pwd" desc="Print current path" />
          <CmdRow cmd="ls / ls -l" desc="List children. Long format shows IDs and status" />
          <CmdRow cmd="cd <name>" desc="Navigate into a child. Supports .., /, -r (search whole tree), path chaining (A/B/C)" />
          <CmdRow cmd="tree" desc="Render subtree. -a active, -c completed, -t trimmed" />
          <div className="cli-note" style={{ marginTop: 8 }}>
            Nodes have three statuses: <strong>active</strong> (green), <strong>completed</strong> (gray), <strong>trimmed</strong> (dim).
          </div>
        </div>

        {/* ── NODE MANAGEMENT ── */}
        <div className="cli-section">
          <div className="cli-section-title">
            <span className="cli-section-icon">🔷</span> Node Management
          </div>
          <CmdRow cmd="mkdir <name>" desc="Create child node(s). Comma-separate for multiple: mkdir foo, bar" />
          <CmdRow cmd="rm <name> -f" desc="Delete a node (soft delete)" />
          <CmdRow cmd="rename <name> <new>" desc="Rename a child node" />
          <CmdRow cmd="mv <name> <destId>" desc="Move a node to a new parent" />
          <CmdRow cmd="complete" desc="Set current node and all children to completed" />
          <CmdRow cmd="activate" desc="Set current node and all children to active" />
          <CmdRow cmd="trim" desc="Set current node and all children to trimmed" />
          <CmdRow cmd="prestige" desc="Create a new version of the current node" />
        </div>

        {/* ── NOTES & VALUES ── */}
        <div className="cli-section">
          <div className="cli-section-title">
            <span className="cli-section-icon">📝</span> Notes &amp; Values
          </div>
          <CmdRow cmd="note <content>" desc="Post a note on the current node" />
          <CmdRow cmd="notes" desc="List notes on the current node. -l limit, -q search" />
          <CmdRow cmd="cat note <id or #>" desc="View full content of a note" />
          <CmdRow cmd="rm-note <id> -f" desc="Delete a note" />
          <CmdRow cmd="book" desc="Print the full book of notes from current node down" />
          <CmdRow cmd="contributions" desc="List contributions on the current node" />
          <CmdRow cmd="values" desc="List values on the current node. -g global totals, -t per-node tree breakdown" />
          <CmdRow cmd="value <key> <val>" desc="Set a value" />
          <CmdRow cmd="goal <key> <goal>" desc="Set a goal" />
        </div>

        {/* ── SCHEDULING ── */}
        <div className="cli-section">
          <div className="cli-section-title">
            <span className="cli-section-icon">📅</span> Scheduling
          </div>
          <div className="cli-note" style={{ marginBottom: 10 }}>
            Date: <code>MM/DD/YYYY</code>. Time: <code>HH:MM</code> or <code>HH:MMam/pm</code>. Reeffect: hours. Use <code>clear</code> to remove.
          </div>
          <CmdRow cmd="schedule <date> [time] [reeffect]" desc="Set schedule (e.g. 1/11/2025 3, 1/11/2025 11:45pm 5, clear)" />
          <CmdRow cmd="calendar" desc="Show scheduled dates. -m month (1-12 or name), -y year" />
          <CmdRow cmd="dream-time <HH:MM>" desc="Set nightly dream time (or clear)" />
        </div>

        {/* ── COLLABORATION ── */}
        <div className="cli-section">
          <div className="cli-section-title">
            <span className="cli-section-icon">🤝</span> Collaboration
          </div>
          <CmdRow cmd="team" desc="Show owner and contributors" />
          <CmdRow cmd="invite <username>" desc="Invite a user to the current tree" />
          <CmdRow cmd="invite accept <id>" desc="Accept a pending invite" />
          <CmdRow cmd="invite deny <id>" desc="Decline a pending invite" />
          <CmdRow cmd="kick <username>" desc="Remove a contributor" />
          <CmdRow cmd="owner <username>" desc="Transfer tree ownership" />
        </div>

        {/* ── LINKS & SHARING ── */}
        <div className="cli-section">
          <div className="cli-section-title">
            <span className="cli-section-icon">🔗</span> Links &amp; Sharing
          </div>
          <div className="cli-section-text" style={{ marginBottom: 14 }}>
            Clickable terminal hyperlinks. <code>link</code> uses your share token; <code>share</code> generates public links.
          </div>
          <div className="cli-note" style={{ marginBottom: 10 }}>In a tree:</div>
          <CmdRow cmd="link" desc="Link to current node" />
          <CmdRow cmd="link root" desc="Link to tree root" />
          <CmdRow cmd="link book" desc="Link to book view" />
          <CmdRow cmd="link gateway" desc="Link to gateway channels" />
          <CmdRow cmd="link note <id>" desc="Link to a specific note" />
          <CmdRow cmd="share note <id>" desc="Public link to a note" />
          <CmdRow cmd="share book" desc="Public book share link (TOC included)" />
          <div className="cli-note" style={{ marginBottom: 10, marginTop: 14 }}>From home:</div>
          <CmdRow cmd="link" desc="Link to your profile" />
          <CmdRow cmd="link ideas" desc="Link to your raw ideas" />
          <CmdRow cmd="link idea <id>" desc="Link to a specific raw idea" />
        </div>

        {/* ── AI ── */}
        <div className="cli-section">
          <div className="cli-section-title">
            <span className="cli-section-icon">🧠</span> AI
          </div>
          <CmdRow cmd="chat <message>" desc="Chat with AI about the current branch" />
          <CmdRow cmd="place <message>" desc="AI writes content into the branch" />
          <CmdRow cmd="query <message>" desc="Ask AI about the branch (read-only, no writes)" />
          <CmdRow cmd="chats" desc="Chat history for current node. -l limit" />
          <CmdRow cmd="chats tree" desc="All chat history across the whole tree" />
        </div>

        {/* ── UNDERSTANDING ── */}
        <div className="cli-section">
          <div className="cli-section-title">
            <span className="cli-section-icon">🔬</span> Understanding Runs
          </div>
          <CmdRow cmd="understand [perspective]" desc="Start an understanding run. Returns final encoding" />
          <CmdRow cmd="understandings" desc="List runs" />
          <CmdRow cmd="understand-status <runId>" desc="Check progress" />
          <CmdRow cmd="understand-stop <runId>" desc="Stop a run" />
        </div>

        {/* ── BLOG ── */}
        <div className="cli-section">
          <div className="cli-section-title">
            <span className="cli-section-icon">📰</span> Blog
          </div>
          <div className="cli-section-text" style={{ marginBottom: 14 }}>
            No login required.
          </div>
          <CmdRow cmd="blogs" desc="List published posts" />
          <CmdRow cmd="blog <slug or number>" desc="Read a post by slug or list number" />
        </div>

        {/* ── NAME MATCHING ── */}
        <div className="cli-section">
          <div className="cli-section-title">
            <span className="cli-section-icon">🔍</span> Name Matching
          </div>
          <div className="cli-section-text">
            All commands accept names or IDs. No quotes needed for multi-word names. Matching order:
          </div>
          <div className="cli-note" style={{ marginTop: 8 }}>
            1. Exact ID or ID prefix<br />
            2. Exact name (case-insensitive)<br />
            3. Name starts with query<br />
            4. Name contains query
          </div>
          <div className="cli-note" style={{ marginTop: 8 }}>
            Multiple matches prompt you to disambiguate by ID.
          </div>
        </div>

        {/* ── LINKS ── */}
        <div className="cli-section">
          <div className="cli-section-title">
            <span className="cli-section-icon">📎</span> Links
          </div>
          <div className="cli-section-text">
            <a href={import.meta.env.VITE_LAND_URL} style={{ color: "rgba(255,255,255,0.85)" }}>TreeOS</a>
            {" | "}
            <a href="/about/gettingstarted" style={{ color: "rgba(255,255,255,0.85)" }}>Getting Started</a>
            {" | "}
            <a href="/about/raw-ideas" style={{ color: "rgba(255,255,255,0.85)" }}>Raw Ideas</a>
            {" | "}
            <a href="/about/energy" style={{ color: "rgba(255,255,255,0.85)" }}>Energy</a>
            {" | "}
            <a href="/about/dreams" style={{ color: "rgba(255,255,255,0.85)" }}>Dreams</a>
            {" | "}
            <a href="/about/gateway" style={{ color: "rgba(255,255,255,0.85)" }}>Gateway</a>
            {" | "}
            <a href="/about/api" style={{ color: "rgba(255,255,255,0.85)" }}>API</a>
            {" | "}
            <a href="/about/cli" style={{ color: "rgba(255,255,255,0.85)" }}>CLI Guide</a>
            {" | "}
            <a href="/blog" style={{ color: "rgba(255,255,255,0.85)" }}>Blog</a>
          </div>
        </div>

      </div>
    </div>
  );
};

export default CLIAbout;
