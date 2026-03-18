
import "./GatewayAbout.css";

const GatewayAbout = () => {
  return (
    <div className="about-gateway">
      <div className="gtw-card">

        {/* ── BACK ── */}
        <div className="al-page-back">
          <a className="al-back-link" href="/about">←</a>
        </div>

        {/* ── HEADER ── */}
        <div className="gtw-header">
          <h2 className="gtw-title">📡 Gateway</h2>
          <p className="gtw-subtitle">
            Connect your trees to external services. Gateway channels link your tree
            to platforms like Telegram, Discord, and browser push notifications.
            Send content in, chat with your tree, or receive updates, all from
            outside the web app. The gateway is a powerful way to extend
            your tree into your daily routines.
          </p>
        </div>

        {/* ── HOW IT WORKS ── */}
        <div className="gtw-section">
          <div className="gtw-section-title">
            <span className="gtw-section-icon">🔧</span> How It Works
          </div>
          <div className="gtw-section-text">
            Each root node has a gateway. The gateway holds up to 10 channels,
            each connected to an external service. Depending on the channel
            direction, you can send content into your tree, have full
            conversations with it, or receive notifications like dream
            summaries, or all of the above.
            <br /><br />
            Channels are configured per-root from the gateway management page.
            All secrets (bot tokens, webhook URLs, push subscriptions) are
            encrypted at rest.
          </div>
        </div>

        {/* ── CHANNEL TYPES ── */}
        <div className="gtw-section">
          <div className="gtw-section-title">
            <span className="gtw-section-icon">📱</span> Channel Types
          </div>
          <div className="gtw-section-text">
            Three channel types are available today. More can be added as
            integrations are built for them.
          </div>
          <div className="gtw-type-grid">
            <div className="gtw-type-card">
              <div className="gtw-type-icon">💬</div>
              <div className="gtw-type-name">Telegram</div>
              <div className="gtw-type-desc">
                Connects via a bot token and chat ID. Send messages to your
                tree, chat with it, or receive notifications, all through
                your Telegram chat or group.
              </div>
            </div>
            <div className="gtw-type-card">
              <div className="gtw-type-icon">🎮</div>
              <div className="gtw-type-name">Discord</div>
              <div className="gtw-type-desc">
                Connects via a webhook URL or bot. Interact with your tree
                from a Discord channel or receive updates there.
              </div>
            </div>
            <div className="gtw-type-card">
              <div className="gtw-type-icon">🔔</div>
              <div className="gtw-type-name">Web Push</div>
              <div className="gtw-type-desc">
                Browser push notifications. Works even when the tab is closed.
                Your browser will ask for permission when you add one.
                May need to be saved as a WEB APP to your phone's homescreen.
              </div>
            </div>
          </div>
        </div>

        {/* ── DIRECTION ── */}
        <div className="gtw-section">
          <div className="gtw-section-title">
            <span className="gtw-section-icon">↔️</span> Direction
          </div>
          <div className="gtw-section-text">
            Each channel has a direction that controls which way data flows.
          </div>
          <div className="gtw-badge-row">
            <div className="gtw-badge input">
              <div className="gtw-badge-label">Input</div>
              <div className="gtw-badge-desc">
                Brings data into the tree from external sources. Send content
                from Telegram, Discord, or other services and it gets placed
                onto your tree automatically. One-way inbound. The tree
                receives but doesn{"'"}t respond back through the channel.
              </div>
            </div>
            <div className="gtw-badge io">
              <div className="gtw-badge-label">Input / Output</div>
              <div className="gtw-badge-desc">
                Full bidirectional connection. Talk to your tree, place data,
                or query it from external platforms like Discord and Telegram
                chatrooms. The tree responds back through the same channel.
                More platforms can and will be added, starting with the most
                important ones.
              </div>
            </div>
            <div className="gtw-badge output">
              <div className="gtw-badge-label">Output</div>
              <div className="gtw-badge-desc">
                The tree reaches out to you or external services with updates.
                Notifications like dream summaries and dream thoughts get
                pushed out. Used for alerts and keeping you informed without
                you having to check in. Web push channels are always
                output-only.
              </div>
            </div>
          </div>
        </div>

        {/* ── MODES ── */}
        <div className="gtw-section">
          <div className="gtw-section-title">
            <span className="gtw-section-icon">🎛️</span> Channel Modes
          </div>
          <div className="gtw-section-text">
            For channels with input capability, the mode controls what the AI
            can do when it receives a message. This maps to the same three
            interaction styles available in the web chat.
          </div>
          <div className="gtw-badge-row">
            <div className="gtw-badge">
              <div className="gtw-badge-label">Place</div>
              <div className="gtw-badge-desc">
                The AI scans the tree for context, creates or edits nodes, but
                does not generate a response back. Use this for silent ingestion
. Send content in and let the tree organize it.
              </div>
            </div>
            <div className="gtw-badge">
              <div className="gtw-badge-label">Query</div>
              <div className="gtw-badge-desc">
                The AI reads the tree and generates a response, but cannot make
                any changes. Use this for safe read-only access. Ask questions
                without risk of modification.
              </div>
            </div>
            <div className="gtw-badge">
              <div className="gtw-badge-label">Chat</div>
              <div className="gtw-badge-desc">
                Full tree chat. The AI reads the tree, can create or edit nodes,
                and generates a response. The same experience as the web chat
                interface.
              </div>
            </div>
          </div>
          <div className="gtw-note">
            Output-only channels don{"'"}t use modes since they only push
            notifications outward. Modes become relevant when input channels
            are enabled.
          </div>
        </div>

        {/* ── NOTIFICATION TYPES ── */}
        <div className="gtw-section">
          <div className="gtw-section-title">
            <span className="gtw-section-icon">🔔</span> Notification Types
          </div>
          <div className="gtw-section-text">
            Channels with output capability can subscribe to specific
            notification types. Only matching notifications are dispatched,
            so you can fine-tune what each channel receives. For example,
            one Discord channel for dream summaries only and another for
            everything.
          </div>
          <div className="gtw-notif-row">
            <div className="gtw-notif-chip">dream-summary</div>
            <div className="gtw-notif-chip">dream-thought</div>
          </div>
          <div className="gtw-note">
            More notification types will be added as new features are built,
            including contribution alerts, raw idea placements, and more.
          </div>
        </div>

        {/* ── QUEUE PROTECTION ── */}
        <div className="gtw-section">
          <div className="gtw-section-title">
            <span className="gtw-section-icon">🛡️</span> Queue Protection
          </div>
          <div className="gtw-section-text">
            Each input channel can process up to 2 messages at the same time.
            If a third message arrives while those are still running, the channel
            either responds with a busy message or stays silent, depending on the
            channel{"'"}s queue behavior setting.
            <br /><br />
            <strong>Respond</strong> (default) -- replies with "I{"'"}m already
            processing your last 2 messages. Please send again later."
            <br /><br />
            <strong>Silent</strong> -- drops the overflow message without
            responding. Good for high-traffic channels where you don{"'"}t want
            noise.
          </div>
        </div>

        {/* ── CANCEL COMMAND ── */}
        <div className="gtw-section">
          <div className="gtw-section-title">
            <span className="gtw-section-icon">🚫</span> Cancel Command
          </div>
          <div className="gtw-section-text">
            Send <strong>cancel</strong> to any input channel to immediately
            abort all active processing on that channel. The tree stops whatever
            it was doing and replies "All active tasks cancelled." This is useful
            if you sent something by mistake or the AI is taking too long.
          </div>
        </div>

        {/* ── DISCORD TIER REQUIREMENT ── */}
        <div className="gtw-section">
          <div className="gtw-section-title">
            <span className="gtw-section-icon">🎮</span> Discord Input
          </div>
          <div className="gtw-section-text">
            Discord output channels use a simple webhook URL (free for all tiers).
            Discord input channels require a Discord bot that maintains a
            persistent connection, so they are gated to Standard, Premium, and
            God tier subscribers. Telegram input channels are available to all
            tiers since they use lightweight HTTP webhooks.
          </div>
        </div>

        {/* ── MANAGING CHANNELS ── */}
        <div className="gtw-section">
          <div className="gtw-section-title">
            <span className="gtw-section-icon">⚙️</span> Managing Channels
          </div>
          <div className="gtw-section-text">
            Channels are managed from the gateway page on each root. You can:
            <br /><br />
            <strong>Add</strong> a channel by choosing a type and direction,
            pasting in the connection details (bot token, webhook URL, or
            allowing browser notifications), and configuring its mode and
            notification subscriptions.
            <br /><br />
            <strong>Test</strong> any channel with a single click to verify the
            connection works before relying on it.
            <br /><br />
            <strong>Enable / Disable</strong> channels without deleting them.
            Disabled channels are skipped during dispatch.
            <br /><br />
            <strong>Delete</strong> channels you no longer need. Only the user
            who created a channel can delete it.
          </div>
          <div className="gtw-note">
            Maximum 10 channels per root. All secrets are encrypted with
            AES-256-CBC using the same encryption key as custom LLM connections.
            The gateway API is also available programmatically. See the API
            Reference page for endpoints.
          </div>
        </div>

        {/* ── BACK ── */}
        <div className="gtw-back-links">
          <a className="gtw-back-link" href="/about">← Back to About</a>
        </div>

      </div>
    </div>
  );
};

export default GatewayAbout;
