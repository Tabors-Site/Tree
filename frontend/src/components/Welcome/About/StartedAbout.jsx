import { Link } from "react-router-dom";
import "./StartedAbout.css";

const StartedAbout = () => {
  return (
    <div className="about-started">
      <div className="sta-card">

        {/* ── BACK ── */}
        <div className="al-page-back">
          <Link className="al-back-link" to="/about">←</Link>
        </div>

        {/* ── HEADER ── */}
        <div className="sta-header">
          <h2 className="sta-title">🌱 Getting Started</h2>
          <p className="sta-subtitle">
            Up and running in two minutes. Create your first tree, start talking
            to it, and watch it grow.
          </p>
        </div>

        {/* ── BRING YOUR OWN LLM ── */}
        <div className="sta-section">
          <div className="sta-section-title">
            <span className="sta-section-icon">🧠</span> Bring Your Own LLM
          </div>
          <div className="sta-section-text" style={{ marginBottom: 12 }}>
            <strong>Tree does not include an AI model.</strong> You need to connect
            your own LLM provider to use any AI features: chat, dreams,
            understanding, raw idea placement, and more. You bring the API key
            and pay your provider directly.
          </div>
          <div className="sta-section-text">
            We recommend <strong>OpenRouter</strong> for the easiest setup. It
            gives you access to hundreds of models with a single API key. Any
            OpenAI-compatible endpoint works. OpenRouter, Groq, Together,
            OpenAI, or even a local server.
          </div>
          <div className="sta-section-text" style={{ marginTop: 12 }}>
            When you sign up, the setup page will walk you through connecting
            your first model before creating your first tree. Your API key is
            encrypted in our database and only used to route your requests.
          </div>
          <div className="sta-section-text drm-note" style={{ marginTop: 12 }}>
            Don't have your own LLM? You can still join someone else's tree
            if they've invited you and have their own model connected. You
            just won't be able to create or chat with your own trees.
          </div>
        </div>

        {/* ── CREATE YOUR FIRST TREE ── */}
        <div className="sta-section">
          <div className="sta-section-title">
            <span className="sta-section-icon">✨</span> Create Your First Tree
          </div>
          <div className="sta-section-text">
            After connecting your LLM, the setup page will ask you to name your
            first tree. You can also create trees later -- in Chat hit
            the <strong>+</strong> button at the bottom of the tree list, or in
            Dashboard find it on your profile home in My Roots.
          </div>
          <div className="sta-section-text" style={{ marginTop: 14 }}>
            Pick a root name that describes the big picture. It's the top of
            your hierarchy, so keep it broad enough to branch out from.
            Something like "Work Projects", "Learning Plan", or "Trip to Japan"
            works well. Once the tree exists, you can start talking to it
            and the AI will build it out from there.
          </div>
          <div className="sta-chat-examples">
            <div className="sta-chat-bubble user">"I want to plan a home renovation"</div>
            <div className="sta-chat-bubble ai">
              Nice, what kind of work are you thinking? Full remodel, cosmetic
              updates, or specific rooms? I can help you map it out.
            </div>
          </div>
          <div className="sta-section-text drm-note" style={{ marginTop: 12 }}>
            Behind the scenes, the AI is already organizing your input into
            the tree. You won't see it building structure directly. It
            translates your intent through internal operators and responds
            to you in plain conversation.
          </div>
        </div>

        {/* ── ADDING NODES ── */}
        <div className="sta-section">
          <div className="sta-section-title">
            <span className="sta-section-icon">🔷</span> Adding Nodes
          </div>
          <div className="sta-section-text">
            Nodes give your tree its shape. They're the structural context,
            the categories and groupings that organize everything. Inside each
            node lives the detail: notes, values, schedules, goals, members,
            and more. You don't need to worry about all of that up front. Just
            know that nodes are the big picture and everything inside them is
            the depth.
            <br /><br />
            You can grow them two ways, and most people use both depending on
            the moment:
          </div>
          <div className="sta-ways-grid">
            <div className="sta-way-card">
              <div className="sta-way-label">Just talk</div>
              <div className="sta-way-desc">
                Describe what you need and the AI handles the rest. It picks
                the right spot, creates the node, and adds notes if needed.
                You don't have to think about structure.
              </div>
              <div className="sta-chat-bubble user small">"Add a budget section under Home Renovation"</div>
            </div>
            <div className="sta-way-card">
              <div className="sta-way-label">Manual control</div>
              <div className="sta-way-desc">
                Open the dashboard to see the full tree visualization. Click any
                node to add children, edit content, or reorganize branches
                directly. Full control when you want it.
              </div>
            </div>
          </div>
          <div className="sta-section-text" style={{ marginTop: 14 }}>
            The context
            you and the AI work with is always the same. When you edit something
            in the dashboard, the AI reads the updated version next time it pulls
            context. When the AI makes changes, the dashboard updates in real time
            to reflect them. One shared workspace, always in sync.
            <br /><br />
            The AI adapts to whatever you add. It restructures, expands, and
            consolidates over time so the tree stays clean as it grows.
          </div>
        </div>

        {/* ── NOTES ── */}
        <div className="sta-section">
          <div className="sta-section-title">
            <span className="sta-section-icon">📝</span> Notes
          </div>
          <div className="sta-section-text">
            Notes are where the actual content lives. Every node can have
            multiple notes, and each one is tied to the node's current version.
            Write them yourself, or just mention something in chat and the AI
            will attach it to the right node.
            <br /><br />
            The more you put in, the smarter the tree gets. Notes are what the
            AI reads when it builds understanding of your tree, so every detail
            you add gives it more to work with.
          </div>
        </div>

        {/* ── TALKING TO THE AI ── */}
        <div className="sta-section">
          <div className="sta-section-title">
            <span className="sta-section-icon">💬</span> Talking to the AI
          </div>
          <div className="sta-section-text">
            You don't need to learn commands or remember how things are organized.
            The AI holds the full tree in context, so you can just say what you
            want in plain language:
          </div>
          <div className="sta-examples-list">
            <div className="sta-example">"What do I have going on for the renovation?"</div>
            <div className="sta-example">"I think budget stuff should live under planning"</div>
            <div className="sta-example">"The first draft is done"</div>
            <div className="sta-example">"We had a meeting today, here's what came out of it"</div>
            <div className="sta-example">"Break the launch into a few smaller pieces"</div>
          </div>
          <div className="sta-section-text" style={{ marginTop: 14 }}>
            You never have to think about structure. The AI figures out what
            you mean, handles the tree operations behind the scenes, and
            responds like a normal conversation. Things get created, updated,
            and moved around while you're just talking. You talk, the tree grows.
          </div>
        </div>

        {/* ── IT LIVES ON ITS OWN ── */}
        <div className="sta-section">
          <div className="sta-section-title">
            <span className="sta-section-icon">🌿</span> It Grows On Its Own
          </div>
          <div className="sta-section-text">
            This is what makes Tree different. Once you set a dream time, your
            tree maintains itself daily. The AI cleans up messy branches,
            drains thoughts you mentioned in passing, and builds a compressed
            understanding of the whole structure.
            <br /><br />
            You can go days without touching it and come back to a tree that's
            more organized than when you left. Or you can be hands-on and shape
            every branch yourself in the dashboard. Both work, and most people
            end up doing a mix of both.
            <br /><br />
            The tree is an adaptable AI memory. The more you feed it, the more
            it knows, and the better it gets at helping you.
          </div>
        </div>

        {/* ── WHAT NEXT ── */}
        <div className="sta-section">
          <div className="sta-section-title">
            <span className="sta-section-icon">🚀</span> What Next?
          </div>
          <div className="sta-section-text">
            Once you're comfortable with the basics, there's a lot more to explore:
          </div>
          <div className="sta-next-grid">
            <Link className="sta-next-card" to="/about/raw-ideas">
              <span className="sta-next-emoji">💡</span>
              <div>
                <div className="sta-next-label">Raw Ideas</div>
                <div className="sta-next-desc">Drop in unstructured thoughts and let the AI sort them into your trees.</div>
              </div>
            </Link>
            <Link className="sta-next-card" to="/about/dreams">
              <span className="sta-next-emoji">💤</span>
              <div>
                <div className="sta-next-label">Tree Dreams</div>
                <div className="sta-next-desc">Set a daily schedule for automatic cleanup, organization, and understanding.</div>
              </div>
            </Link>
            <Link className="sta-next-card" to="/about/energy">
              <span className="sta-next-emoji">⚡</span>
              <div>
                <div className="sta-next-label">Energy System</div>
                <div className="sta-next-desc">How usage works, what things cost, and LLM connection details.</div>
              </div>
            </Link>
            <Link className="sta-next-card" to="/about/api">
              <span className="sta-next-emoji">🔌</span>
              <div>
                <div className="sta-next-label">API Reference</div>
                <div className="sta-next-desc">Build bots, scripts, and integrations on top of your trees.</div>
              </div>
            </Link>
          </div>
        </div>

        {/* ── BACK LINK ── */}
        <div className="sta-back-links">
          <Link className="sta-back-link" to="/about">← Back to About</Link>
        </div>

      </div>
    </div>
  );
};

export default StartedAbout;
