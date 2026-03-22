
import "./NodeTypesAbout.css";

const NodeTypesAbout = () => {
  return (
    <div className="node-types-docs">
      <div className="node-types-docs-card">

        {/* ── BACK ── */}
        <div className="al-page-back">
          <a className="al-back-link" href="/about">←</a>
        </div>

        {/* ── HEADER ── */}
        <div className="nt-header">
          <h2 className="nt-title">Node Types</h2>
          <p className="nt-subtitle">
            Types are semantic labels that describe what a node represents.
            They tell agents and UIs what kind of thing they're looking at
            without changing the node's shape. Every node keeps all its
            fields regardless of type.
          </p>
        </div>

        {/* ── CORE TYPES ── */}
        <div className="nt-section">
          <div className="nt-section-title">
            <span className="nt-section-icon">🏷️</span> Core Types
          </div>
          <div className="nt-section-text">
            Six standard types provide a shared vocabulary across all lands.
            These are conventions, not constraints. Custom types are valid too.
          </div>

          <div className="nt-type-grid">
            <div className="nt-type-card">
              <div className="nt-type-name">goal</div>
              <div className="nt-type-desc">
                A desired outcome. What you're working toward.
              </div>
            </div>
            <div className="nt-type-card">
              <div className="nt-type-name">plan</div>
              <div className="nt-type-desc">
                A strategy or sequence of steps toward a goal.
              </div>
            </div>
            <div className="nt-type-card">
              <div className="nt-type-name">task</div>
              <div className="nt-type-desc">
                A discrete piece of completable work.
              </div>
            </div>
            <div className="nt-type-card">
              <div className="nt-type-name">knowledge</div>
              <div className="nt-type-desc">
                Stored information or understanding.
              </div>
            </div>
            <div className="nt-type-card">
              <div className="nt-type-name">resource</div>
              <div className="nt-type-desc">
                A tool, skill, capability, or reference.
              </div>
            </div>
            <div className="nt-type-card">
              <div className="nt-type-name">identity</div>
              <div className="nt-type-desc">
                Who or what this tree represents, its values, its constraints.
              </div>
            </div>
          </div>

          <div className="nt-highlight">
            <div className="nt-section-text">
              <strong>null</strong> is always valid. Untyped nodes work exactly
              as they always have. No node is required to have a type.
            </div>
          </div>
        </div>

        {/* ── TYPES AS FILE EXTENSIONS ── */}
        <div className="nt-section">
          <div className="nt-section-title">
            <span className="nt-section-icon">💻</span> Types Are File Extensions
          </div>
          <div className="nt-section-text">
            In a traditional OS, a file extension tells programs what to do
            with a file. <strong>.js</strong> means "run this with Node."
            {" "}<strong>.md</strong> means "render this as markdown."
            The extension is a semantic label. The file contents are the payload.
            Programs read the extension to decide how to interact.
            <br /><br />
            TreeOS works the same way. The <strong>type</strong> is the
            extension. The <strong>node itself</strong> is the file: its
            notes, values, schedules, scripts, children, all of it.
            <strong> Agents</strong> are the programs.
          </div>

          <div className="nt-path-example">
            Traditional OS:<br />
            <span className="nt-path-good">skills.js</span>
            &nbsp;&nbsp;→ extension tells Node.js to execute it<br />
            <span className="nt-path-good">readme.md</span>
            &nbsp;&nbsp;→ extension tells a viewer to render markdown<br />
            <br />
            TreeOS:<br />
            <span className="nt-path-good">API Integration (resource)</span>
            &nbsp;&nbsp;→ type tells agents to load notes as capabilities<br />
            <span className="nt-path-good">Core Values (identity)</span>
            &nbsp;&nbsp;→ type tells agents to read notes as constraints
          </div>

          <div className="nt-section-text" style={{ marginTop: "14px" }}>
            Just like you can create custom file extensions in a traditional
            OS and register handlers for them, you can create custom node
            types in TreeOS and teach agents what they mean through
            instruction nodes in the tree itself.
          </div>
        </div>

        {/* ── HOW TYPES WORK ── */}
        <div className="nt-section">
          <div className="nt-section-title">
            <span className="nt-section-icon">🔧</span> Instructions Live in Nodes
          </div>
          <div className="nt-section-text">
            The system does not hardcode behavior per type. Your tree does.
            <br /><br />
            A resource node might carry skill descriptions in its notes,
            configuration in its values, and dependencies as children.
            An identity node might hold constraints in its notes and
            priorities in its values. A task node carries schedules,
            tracked values, and completion status. The whole node is
            the payload, not just the notes.
            <br /><br />
            This is what makes TreeOS an operating system, not a database
            with labels. The tree programs its own agents through its own
            content. Types are the signal. Notes are the payload. Agents
            are the runtime.
          </div>
        </div>

        {/* ── CUSTOM TYPES ── */}
        <div className="nt-section">
          <div className="nt-section-title">
            <span className="nt-section-icon">🎨</span> Custom Types
          </div>
          <div className="nt-section-text">
            The type field is a free-form string. The six core types are a
            shared vocabulary for interop and UI hints, but nothing stops
            you from using your own.
            <br /><br />
            <strong>ritual</strong>, <strong>protocol</strong>,{" "}
            <strong>checkpoint</strong>, <strong>persona</strong> ... whatever
            fits your domain. Agents treat unrecognized types like null unless
            the tree itself contains instructions for them.
            <br /><br />
            In federation, nodes with unrecognized types are accepted as-is.
            The core six are universally understood. Custom types degrade
            gracefully on foreign lands.
          </div>
        </div>

        {/* ── NAMING ── */}
        <div className="nt-section">
          <div className="nt-section-title">
            <span className="nt-section-icon">✂️</span> Naming with Types
          </div>
          <div className="nt-section-text">
            Types carry semantic context, so node names should not repeat it.
            The hierarchy already provides context. Names should compress.
          </div>

          <div className="nt-path-example">
            <div className="nt-path-bad">
              My Workout Plan / Chest Workouts / Morning Chest Routine
            </div>
            <div className="nt-path-good">
              Workouts (plan) / Chest (task) / Morning (task)
            </div>
          </div>

          <div className="nt-section-text" style={{ marginTop: "12px" }}>
            Drop filler words. Don't echo the type in the name. A node typed
            "plan" named "Workouts" already says "workout plan." Each node
            only needs the part its parent doesn't already say.
          </div>
        </div>

        {/* ── API ── */}
        <div className="nt-section">
          <div className="nt-section-title">
            <span className="nt-section-icon">📡</span> API
          </div>
          <div className="nt-section-text">
            Set type on creation or change it later.
          </div>

          <div className="nt-path-example">
            POST /api/v1/node/:nodeId/editType<br />
            {"{"} "type": "goal" {"}"}<br /><br />
            POST /api/v1/node/:nodeId/editType<br />
            {"{"} "type": null {"}"}&nbsp;&nbsp;// clear type
          </div>

          <div className="nt-section-text" style={{ marginTop: "12px" }}>
            Type is also accepted on node creation endpoints and in the
            MCP tool interface. Agents can read and set types through
            <strong> edit-node-type</strong>, and types appear in tree
            overviews and node context automatically.
          </div>
        </div>

        {/* ── BACK LINK ── */}
        <div className="nt-back-links">
          <a className="nt-back-link" href="/about">← Back to About</a>
        </div>

      </div>
    </div>
  );
};

export default NodeTypesAbout;
