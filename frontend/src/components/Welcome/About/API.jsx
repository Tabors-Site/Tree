import { Link } from "react-router-dom";
import "./API.css";

const ApiAccessSection = () => {
  return (
    <div className="api-docs">
      <div className="api-docs-card">

        {/* ═══════════════════════════════════════════════════════════════ */}
        {/* HEADER                                                        */}
        {/* ═══════════════════════════════════════════════════════════════ */}
        <div className="api-docs-header">
          <h2 className="api-docs-title">🔌 API Reference</h2>
          <p className="api-docs-subtitle">
            Read and write to your trees programmatically. Build integrations,
            automations, bots, and external tools on the same backend that
            powers the Tree apps.
          </p>
        </div>

        {/* ═══════════════════════════════════════════════════════════════ */}
        {/* TABLE OF CONTENTS                                             */}
        {/* ═══════════════════════════════════════════════════════════════ */}
        <div className="toc">
          <div className="toc-title">Contents</div>

          <div className="toc-group">
            <div className="toc-group-label">Getting Started</div>
            <a href="#overview">🔑 Overview &amp; Authentication</a>
            <a href="#url-modes">🌐 URL Modes — ?html &amp; ?token</a>
          </div>

          <div className="toc-group">
            <div className="toc-group-label">User</div>
            <a href="#user">👤 User Endpoints</a>
          </div>

          <div className="toc-group">
            <div className="toc-group-label">Tree</div>
            <a href="#root">🌳 Root Endpoints</a>
            <a href="#book">📖 Book &amp; Sharing</a>
            <a href="#understandings">🧠 Understandings</a>
          </div>

          <div className="toc-group">
            <div className="toc-group-label">Node</div>
            <a href="#node">🔷 Node Endpoints</a>
            <a href="#scripts">⚙️ Scripts</a>
            <a href="#version">📋 Node Version Endpoints</a>
            <a href="#transactions">🤝 Transactions</a>
            <a href="#solana">💎 Solana Wallet</a>
          </div>
        </div>

        {/* ═══════════════════════════════════════════════════════════════ */}
        {/*  1. OVERVIEW & AUTH                                           */}
        {/* ═══════════════════════════════════════════════════════════════ */}
        <div className="section" id="overview">
          <div className="section-title">
            <span className="section-icon">🔑</span> Overview &amp; Authentication
          </div>
          <div className="section-text">
            The Tree API lives at <code>https://tree.tabors.site/api/v1</code>.
            All endpoints return JSON by default. Every write operation and most
            read operations require authentication.
            <br /><br />
            <strong>API Keys</strong> are the recommended way to authenticate
            for programmatic access. Create and manage keys from your user
            profile page. Keys are sent as a request header:
          </div>

          <div className="ep-code" style={{ marginTop: "12px" }}>x-api-key: YOUR_API_KEY</div>

          <div className="section-text" style={{ marginTop: "14px" }}>
            <strong>Key details:</strong>
            <br />• Created and managed from your profile page
            <br />• Each key can be individually revoked
            <br />• Usage is tracked per key
            <br />• Maximum of 10 active keys per user
            <br />• Works with all endpoints (read and write)
          </div>

          <div className="highlight-box">
            <div className="section-text">
              <strong>Browser sessions</strong> also use JWT-based authentication
              via cookies, but JWTs expire quickly and are not recommended for
              external integrations or scripts.
            </div>
          </div>
        </div>

        {/* ═══════════════════════════════════════════════════════════════ */}
        {/*  2. URL MODES                                                 */}
        {/* ═══════════════════════════════════════════════════════════════ */}
        <div className="section" id="url-modes">
          <div className="section-title">
            <span className="section-icon">🌐</span> URL Modes — ?html &amp; ?token
          </div>
          <div className="section-text">
            Every GET endpoint supports two query parameters that change how the
            response is delivered:
          </div>

          <div className="sub-title">?token=YOUR_TOKEN</div>
          <div className="section-text">
            A URL access token that authenticates the request. Required for GET
            routes when you don't have a cookie session or API key header.
            Tokens are tied to your account and can be found or refreshed on
            your profile page.
            <br /><br />
            Example: <code>/api/v1/node/:nodeId/5/notes?token=abc123</code>
          </div>

          <div className="sub-title">?html</div>
          <div className="section-text">
            When present, the server returns a fully rendered HTML page instead
            of raw JSON. This is what the browser app uses. Without{" "}
            <code>?html</code>, you always get JSON.
            <br /><br />
            Example: <code>/api/v1/node/:nodeId/5/notes?token=abc123&amp;html</code>
          </div>

          <div className="highlight-box">
            <div className="section-text">
              <strong>For API integrations</strong>, use the <code>x-api-key</code>{" "}
              header and omit both <code>?html</code> and <code>?token</code>.
              The token/html pattern is designed for shareable browser links.
            </div>
          </div>
        </div>

        {/* ═══════════════════════════════════════════════════════════════ */}
        {/*  3. USER ENDPOINTS                                            */}
        {/* ═══════════════════════════════════════════════════════════════ */}
        <div className="section" id="user">
          <div className="section-title">
            <span className="section-icon">👤</span> User Endpoints
          </div>
          <div className="section-text">
            Profile, roots, API keys, contributions, notes, tags, raw ideas,
            invites, chat history, and custom LLM configuration.
          </div>

          {/* ── Profile ──────────── */}
          <div className="sub-title">Profile</div>

          <div className="endpoint">
            <div className="ep-method-url">
              <span className="ep-method get">GET</span>
              <span className="ep-url">/api/v1/user/:userId</span>
            </div>
            <div className="ep-desc">Returns user profile, root nodes, and account metadata.</div>
          </div>

          {/* ── Create Root ──────── */}
          <div className="sub-title">Create Root</div>

          <div className="endpoint">
            <div className="ep-method-url">
              <span className="ep-method post">POST</span>
              <span className="ep-url">/api/v1/user/:userId/createRoot</span>
            </div>
            <div className="ep-desc">Create a new root tree for the user.</div>
            <div className="ep-label">Request Body</div>
            <div className="ep-code">{'{ "name": "My New Tree" }'}</div>
          </div>

          {/* ── API Keys ─────────── */}
          <div className="sub-title">API Keys</div>

          <div className="endpoint">
            <div className="ep-method-url">
              <span className="ep-method post">POST</span>
              <span className="ep-url">/api/v1/user/:userId/api-keys</span>
            </div>
            <div className="ep-desc">Create a new API key.</div>
            <div className="ep-label">Request Body</div>
            <div className="ep-code">{'{ "name": "optional descriptive name" }'}</div>
            <div className="ep-label">Response</div>
            <div className="ep-code">{'{ "apiKey": "fcd8a7c7...", "message": "Store this key securely. You will not see it again." }'}</div>
            <div className="ep-note">The full key is only shown once at creation time.</div>
          </div>

          <div className="endpoint">
            <div className="ep-method-url">
              <span className="ep-method get">GET</span>
              <span className="ep-url">/api/v1/user/:userId/api-keys</span>
            </div>
            <div className="ep-desc">List all API keys (active and revoked) for the user.</div>
          </div>

          <div className="endpoint">
            <div className="ep-method-url">
              <span className="ep-method delete">DELETE</span>
              <span className="ep-url">/api/v1/user/:userId/api-keys/:keyId</span>
            </div>
            <div className="ep-desc">Revoke an API key. It will no longer authenticate requests.</div>
          </div>

          {/* ── Share Token ──────── */}
          <div className="sub-title">Share Token</div>
          <div className="desc-muted">
            The URL token used for <code>?token=</code> authentication on GET routes.
          </div>

          <div className="endpoint">
            <div className="ep-method-url">
              <span className="ep-method post">POST</span>
              <span className="ep-url">/api/v1/user/:userId/shareToken</span>
            </div>
            <div className="ep-desc">Create or refresh the URL share token. Invalidates the previous token.</div>
          </div>

          <div className="section-spacer"></div>

          {/* ── Contributions ────── */}
          <div className="sub-title">Contributions</div>

          <div className="endpoint">
            <div className="ep-method-url">
              <span className="ep-method get">GET</span>
              <span className="ep-url">/api/v1/user/:userId/contributions</span>
            </div>
            <div className="ep-desc">All contributions made by the user across all trees.</div>
            <div className="ep-label">Query Parameters</div>
            <div className="param-row">
              <span className="param-key">?limit=NUMBER</span>
              <span className="param-desc">Max results to return</span>
            </div>
            <div className="param-row">
              <span className="param-key">?startDate=YYYY-MM-DD</span>
              <span className="param-desc">Filter from date</span>
            </div>
            <div className="param-row">
              <span className="param-key">?endDate=YYYY-MM-DD</span>
              <span className="param-desc">Filter to date</span>
            </div>
          </div>

          {/* ── Notes ────────────── */}
          <div className="sub-title">Notes</div>

          <div className="endpoint">
            <div className="ep-method-url">
              <span className="ep-method get">GET</span>
              <span className="ep-url">/api/v1/user/:userId/notes</span>
            </div>
            <div className="ep-desc">List or search all notes posted by the user.</div>
            <div className="ep-label">Query Parameters</div>
            <div className="param-row">
              <span className="param-key">?q=SEARCH</span>
              <span className="param-desc">Full-text search query</span>
            </div>
            <div className="param-row">
              <span className="param-key">?limit=NUMBER</span>
              <span className="param-desc">Max results to return</span>
            </div>
            <div className="param-row">
              <span className="param-key">?startDate=YYYY-MM-DD</span>
              <span className="param-desc">Filter from date</span>
            </div>
            <div className="param-row">
              <span className="param-key">?endDate=YYYY-MM-DD</span>
              <span className="param-desc">Filter to date</span>
            </div>
          </div>

          {/* ── Tagged ───────────── */}
          <div className="sub-title">Tagged Notes (Inbox)</div>

          <div className="endpoint">
            <div className="ep-method-url">
              <span className="ep-method get">GET</span>
              <span className="ep-url">/api/v1/user/:userId/tags</span>
            </div>
            <div className="ep-desc">Notes where the user has been @tagged by another user.</div>
          </div>

          <div className="section-spacer"></div>

          {/* ── Raw Ideas ────────── */}
          <div className="sub-title">Raw Ideas</div>
          <div className="desc-muted">
            Unstructured inputs (text or files) that can later be converted into
            notes and placed into a tree.
          </div>

          <div className="endpoint">
            <div className="ep-method-url">
              <span className="ep-method post">POST</span>
              <span className="ep-url">/api/v1/user/:userId/raw-ideas</span>
            </div>
            <div className="ep-desc">Create a new raw idea. Accepts multipart form data.</div>
            <div className="ep-label">Form Fields</div>
            <div className="ep-code">{"content: \"text string\"\nfile: (optional file upload)"}</div>
          </div>

          <div className="endpoint">
            <div className="ep-method-url">
              <span className="ep-method get">GET</span>
              <span className="ep-url">/api/v1/user/:userId/raw-ideas</span>
            </div>
            <div className="ep-desc">List or search all raw ideas.</div>
          </div>

          <div className="endpoint">
            <div className="ep-method-url">
              <span className="ep-method get">GET</span>
              <span className="ep-url">/api/v1/user/:userId/raw-ideas/:rawIdeaId</span>
            </div>
            <div className="ep-desc">View a single raw idea.</div>
          </div>

          <div className="endpoint">
            <div className="ep-method-url">
              <span className="ep-method post">POST</span>
              <span className="ep-url">/api/v1/user/:userId/raw-ideas/:rawIdeaId/transfer</span>
            </div>
            <div className="ep-desc">Convert a raw idea into a note on a target node.</div>
            <div className="ep-label">Request Body</div>
            <div className="ep-code">{'{ "nodeId": "targetNodeId" }'}</div>
          </div>

          <div className="endpoint">
            <div className="ep-method-url">
              <span className="ep-method delete">DELETE</span>
              <span className="ep-url">/api/v1/user/:userId/raw-ideas/:rawIdeaId</span>
            </div>
            <div className="ep-desc">Permanently delete a raw idea.</div>
          </div>

          <div className="section-spacer"></div>

          {/* ── Deleted Branches ─── */}
          <div className="sub-title">Deleted Branches</div>
          <div className="desc-muted">Deleted branches are soft-deleted and can be restored.</div>

          <div className="endpoint">
            <div className="ep-method-url">
              <span className="ep-method get">GET</span>
              <span className="ep-url">/api/v1/user/:userId/deleted</span>
            </div>
            <div className="ep-desc">List all soft-deleted branches for the user.</div>
          </div>

          <div className="endpoint">
            <div className="ep-method-url">
              <span className="ep-method post">POST</span>
              <span className="ep-url">/api/v1/user/:userId/deleted/:nodeId/revive</span>
            </div>
            <div className="ep-desc">Restore a deleted branch under a parent node.</div>
            <div className="ep-label">Request Body</div>
            <div className="ep-code">{'{ "targetParentId": "nodeId" }'}</div>
          </div>

          <div className="endpoint">
            <div className="ep-method-url">
              <span className="ep-method post">POST</span>
              <span className="ep-url">/api/v1/user/:userId/deleted/:nodeId/reviveAsRoot</span>
            </div>
            <div className="ep-desc">Restore a deleted branch as a new root tree.</div>
          </div>

          {/* ── Invites ──────────── */}
          <div className="sub-title">Invites &amp; Collaboration</div>

          <div className="endpoint">
            <div className="ep-method-url">
              <span className="ep-method get">GET</span>
              <span className="ep-url">/api/v1/user/:userId/invites</span>
            </div>
            <div className="ep-desc">List pending invitations to collaborate on other users' trees.</div>
          </div>

          <div className="endpoint">
            <div className="ep-method-url">
              <span className="ep-method post">POST</span>
              <span className="ep-url">/api/v1/user/:userId/invites/:inviteId</span>
            </div>
            <div className="ep-desc">Accept or decline a collaboration invite.</div>
            <div className="ep-label">Request Body</div>
            <div className="ep-code">{'{ "accept": true }   // true to accept, false to decline'}</div>
          </div>

          <div className="section-spacer"></div>

          {/* ── Energy ───────────── */}
          <div className="sub-title">Energy</div>

          <div className="endpoint">
            <div className="ep-method-url">
              <span className="ep-method get">GET</span>
              <span className="ep-url">/api/v1/user/:userId/energy</span>
            </div>
            <div className="ep-desc">View current energy balance, plan tier, profile type, and custom LLM connection status.</div>
          </div>

          {/* ── Custom LLM ──────── */}
          <div className="sub-title">Custom LLM</div>
          <div className="desc-muted">
            Connect your own LLM provider for AI features. Requires a base URL,
            API key, and model name.
          </div>

          <div className="endpoint">
            <div className="ep-method-url">
              <span className="ep-method post">POST</span>
              <span className="ep-url">/api/v1/user/:userId/custom-llm</span>
            </div>
            <div className="ep-desc">Set or update the custom LLM connection.</div>
            <div className="ep-label">Request Body</div>
            <div className="ep-code">{`{
  "baseUrl": "https://api.openai.com/v1",
  "apiKey": "sk-...",
  "model": "gpt-4o"
}`}</div>
          </div>

          <div className="endpoint">
            <div className="ep-method-url">
              <span className="ep-method post">POST</span>
              <span className="ep-url">/api/v1/user/:userId/custom-llm/revoke</span>
            </div>
            <div className="ep-desc">Enable or disable the custom LLM without deleting it.</div>
            <div className="ep-label">Request Body</div>
            <div className="ep-code">{'{ "revoked": true }'}</div>
            <div className="ep-note">Set <code>revoked: false</code> to re-enable.</div>
          </div>

          <div className="endpoint">
            <div className="ep-method-url">
              <span className="ep-method delete">DELETE</span>
              <span className="ep-url">/api/v1/user/:userId/custom-llm</span>
            </div>
            <div className="ep-desc">Permanently remove the custom LLM connection.</div>
          </div>

          {/* ── Chat History ─────── */}
          <div className="sub-title">AI Chat History</div>

          <div className="endpoint">
            <div className="ep-method-url">
              <span className="ep-method get">GET</span>
              <span className="ep-url">/api/v1/user/:userId/chats</span>
            </div>
            <div className="ep-desc">View AI chat history grouped by session.</div>
          </div>
        </div>

        {/* ═══════════════════════════════════════════════════════════════ */}
        {/*  4. ROOT ENDPOINTS                                            */}
        {/* ═══════════════════════════════════════════════════════════════ */}
        <div className="section" id="root">
          <div className="section-title">
            <span className="section-icon">🌳</span> Root Endpoints
          </div>
          <div className="section-text">
            Roots are the top-level entry point of a tree. Most tree-wide
            operations happen at this scope.
          </div>

          {/* ── Tree Data ────────── */}
          <div className="sub-title">Tree Data</div>

          <div className="endpoint">
            <div className="ep-method-url">
              <span className="ep-method get">GET</span>
              <span className="ep-url">/api/v1/root/:rootId</span>
            </div>
            <div className="ep-desc">Full tree including all children, metadata, notes, and contributions.</div>
            <div className="ep-label">Query Parameters</div>
            <div className="param-row">
              <span className="param-key">?active=true|false</span>
              <span className="param-desc">Filter by active status</span>
            </div>
            <div className="param-row">
              <span className="param-key">?completed=true|false</span>
              <span className="param-desc">Filter by completed status</span>
            </div>
            <div className="param-row">
              <span className="param-key">?trimmed=true|false</span>
              <span className="param-desc">Filter by trimmed status</span>
            </div>
          </div>

          {/* ── Global Values ────── */}
          <div className="sub-title">Global Values</div>

          <div className="endpoint">
            <div className="ep-method-url">
              <span className="ep-method get">GET</span>
              <span className="ep-url">/api/v1/root/:rootId/values</span>
            </div>
            <div className="ep-desc">All values aggregated across every child node in the tree.</div>
          </div>

          <div className="section-spacer"></div>

          {/* ── Contributors ─────── */}
          <div className="sub-title">Contributors &amp; Ownership</div>

          <div className="endpoint">
            <div className="ep-method-url">
              <span className="ep-method post">POST</span>
              <span className="ep-url">/api/v1/root/:rootId/invite</span>
            </div>
            <div className="ep-desc">Invite a collaborator to the tree.</div>
            <div className="ep-label">Request Body</div>
            <div className="ep-code">{'{ "userReceiving": "username-or-userId" }'}</div>
          </div>

          <div className="endpoint">
            <div className="ep-method-url">
              <span className="ep-method post">POST</span>
              <span className="ep-url">/api/v1/root/:rootId/transfer-owner</span>
            </div>
            <div className="ep-desc">Transfer tree ownership to another contributor.</div>
            <div className="ep-label">Request Body</div>
            <div className="ep-code">{'{ "userReceiving": "username-or-userId" }'}</div>
          </div>

          <div className="endpoint">
            <div className="ep-method-url">
              <span className="ep-method post">POST</span>
              <span className="ep-url">/api/v1/root/:rootId/remove-user</span>
            </div>
            <div className="ep-desc">Remove a contributor from the tree.</div>
            <div className="ep-label">Request Body</div>
            <div className="ep-code">{'{ "userReceiving": "username-or-userId" }'}</div>
          </div>

          <div className="endpoint">
            <div className="ep-method-url">
              <span className="ep-method post">POST</span>
              <span className="ep-url">/api/v1/root/:rootId/retire</span>
            </div>
            <div className="ep-desc">Archive the root (soft delete entire tree). Only the owner can do this when there are no other contributors.</div>
          </div>

          <div className="section-spacer"></div>

          {/* ── Transaction Policy ── */}
          <div className="sub-title">Transaction Policy</div>

          <div className="endpoint">
            <div className="ep-method-url">
              <span className="ep-method post">POST</span>
              <span className="ep-url">/api/v1/root/:rootId/transaction-policy</span>
            </div>
            <div className="ep-desc">Set the approval policy for transactions on this tree.</div>
            <div className="ep-label">Request Body</div>
            <div className="ep-code">{'{ "policy": "OWNER_ONLY" }'}</div>
            <div className="ep-label">Allowed Values</div>
            <div className="ep-code">{`OWNER_ONLY  — Only the tree owner can approve
ANYONE      — Any contributor can approve
MAJORITY    — Majority of contributors must approve
ALL         — All contributors must approve`}</div>
          </div>

          <div className="section-spacer"></div>

          {/* ── Calendar ─────────── */}
          <div className="sub-title">Calendar</div>

          <div className="endpoint">
            <div className="ep-method-url">
              <span className="ep-method get">GET</span>
              <span className="ep-url">/api/v1/root/:rootId/calendar</span>
            </div>
            <div className="ep-desc">All scheduled dates across every node in the tree.</div>
            <div className="ep-label">Query Parameters</div>
            <div className="param-row">
              <span className="param-key">?month=0–11</span>
              <span className="param-desc">Filter by month (0 = Jan)</span>
            </div>
            <div className="param-row">
              <span className="param-key">?year=YYYY</span>
              <span className="param-desc">Filter by year</span>
            </div>
            <div className="param-row">
              <span className="param-key">?day=YYYY-MM-DD</span>
              <span className="param-desc">Filter by day (HTML mode)</span>
            </div>
          </div>
        </div>

        {/* ═══════════════════════════════════════════════════════════════ */}
        {/*  5. BOOK & SHARING                                            */}
        {/* ═══════════════════════════════════════════════════════════════ */}
        <div className="section" id="book">
          <div className="section-title">
            <span className="section-icon">📖</span> Book &amp; Sharing
          </div>
          <div className="section-text">
            The book view compiles all notes from a root and its children into a
            single hierarchical document. Books can be shared via public links.
          </div>

          <div className="endpoint">
            <div className="ep-method-url">
              <span className="ep-method get">GET</span>
              <span className="ep-url">/api/v1/root/:rootId/book</span>
            </div>
            <div className="ep-desc">Book view — all notes from every child node compiled into a hierarchical format.</div>
          </div>

          <div className="endpoint">
            <div className="ep-method-url">
              <span className="ep-method post">POST</span>
              <span className="ep-url">/api/v1/root/:rootId/book/generate</span>
            </div>
            <div className="ep-desc">Generate a shareable link for the book. Returns a share ID for the public URL.</div>
            <div className="ep-label">Response</div>
            <div className="ep-code">{'{ "shareId": "abc123..." }'}</div>
          </div>

          <div className="endpoint">
            <div className="ep-method-url">
              <span className="ep-method get">GET</span>
              <span className="ep-url">/api/v1/root/:rootId/book/share/:shareId</span>
            </div>
            <div className="ep-desc">Public book link. Always renders HTML. No authentication required — anyone with the link can view.</div>
            <div className="ep-note">This is the URL you share with others.</div>
          </div>
        </div>

        {/* ═══════════════════════════════════════════════════════════════ */}
        {/*  6. UNDERSTANDINGS                                            */}
        {/* ═══════════════════════════════════════════════════════════════ */}
        <div className="section" id="understandings">
          <div className="section-title">
            <span className="section-icon">🧠</span> Understandings
          </div>
          <div className="section-text">
            Understandings are AI-powered analysis runs across a tree. Each run
            produces encodings for individual nodes, capturing the AI's
            interpretation of the node's state and content.
          </div>

          <div className="endpoint">
            <div className="ep-method-url">
              <span className="ep-method post">POST</span>
              <span className="ep-url">/api/v1/root/:rootId/understandings</span>
            </div>
            <div className="ep-desc">Create and start a new understanding run for the tree.</div>
          </div>

          <div className="endpoint">
            <div className="ep-method-url">
              <span className="ep-method get">GET</span>
              <span className="ep-url">/api/v1/root/:rootId/understandings</span>
            </div>
            <div className="ep-desc">List all understanding runs for this tree.</div>
          </div>

          <div className="endpoint">
            <div className="ep-method-url">
              <span className="ep-method get">GET</span>
              <span className="ep-url">/api/v1/root/:rootId/understandings/:understandingNodeId</span>
            </div>
            <div className="ep-desc">View a single understanding node and all of its run encodings across every run.</div>
          </div>

          <div className="endpoint">
            <div className="ep-method-url">
              <span className="ep-method get">GET</span>
              <span className="ep-url">/api/v1/root/:rootId/understandings/run/:runId</span>
            </div>
            <div className="ep-desc">View a specific understanding run and its results.</div>
          </div>

          <div className="endpoint">
            <div className="ep-method-url">
              <span className="ep-method get">GET</span>
              <span className="ep-url">/api/v1/root/:rootId/understandings/run/:runId/:understandingNodeId</span>
            </div>
            <div className="ep-desc">View a node's encoding state from the perspective of a specific understanding run.</div>
          </div>
        </div>

        {/* ═══════════════════════════════════════════════════════════════ */}
        {/*  7. NODE ENDPOINTS                                            */}
        {/* ═══════════════════════════════════════════════════════════════ */}
        <div className="section" id="node">
          <div className="section-title">
            <span className="section-icon">🔷</span> Node Endpoints
          </div>
          <div className="section-text">
            Structure and hierarchy management. Nodes are the building blocks of
            every tree.
          </div>

          <div className="sub-title">Node Management</div>

          <div className="endpoint">
            <div className="ep-method-url">
              <span className="ep-method get">GET</span>
              <span className="ep-url">/api/v1/node/:nodeId</span>
            </div>
            <div className="ep-desc">Node metadata including all versions.</div>
          </div>

          <div className="endpoint">
            <div className="ep-method-url">
              <span className="ep-method get">GET</span>
              <span className="ep-url">/api/v1/node/:nodeId/:version</span>
            </div>
            <div className="ep-desc">A specific version with its values, goals, notes, and contributions.</div>
          </div>

          <div className="endpoint">
            <div className="ep-method-url">
              <span className="ep-method post">POST</span>
              <span className="ep-url">/api/v1/node/:nodeId/:version/editName</span>
            </div>
            <div className="ep-desc">Rename the node.</div>
            <div className="ep-label">Request Body</div>
            <div className="ep-code">{'{ "name": "New Node Name" }'}</div>
          </div>

          <div className="endpoint">
            <div className="ep-method-url">
              <span className="ep-method post">POST</span>
              <span className="ep-url">/api/v1/node/:nodeId/createChild</span>
            </div>
            <div className="ep-desc">Create a new child node under this node.</div>
            <div className="ep-label">Request Body</div>
            <div className="ep-code">{'{ "name": "Child Name" }'}</div>
          </div>

          <div className="endpoint">
            <div className="ep-method-url">
              <span className="ep-method post">POST</span>
              <span className="ep-url">/api/v1/node/:nodeId/updateParent</span>
            </div>
            <div className="ep-desc">Move this node under a different parent.</div>
            <div className="ep-label">Request Body</div>
            <div className="ep-code">{'{ "newParentId": "nodeId" }'}</div>
          </div>

          <div className="endpoint">
            <div className="ep-method-url">
              <span className="ep-method post">POST</span>
              <span className="ep-url">/api/v1/node/:nodeId/delete</span>
            </div>
            <div className="ep-desc">Soft delete this node and its entire branch. Can be restored from deleted branches.</div>
          </div>
        </div>

        {/* ═══════════════════════════════════════════════════════════════ */}
        {/*  8. SCRIPTS                                                   */}
        {/* ═══════════════════════════════════════════════════════════════ */}
        <div className="section" id="scripts">
          <div className="section-title">
            <span className="section-icon">⚙️</span> Scripts
          </div>
          <div className="section-text">
            Nodes can have attached scripts — small JavaScript programs that run
            in a sandboxed VM. Scripts can read and mutate node values, goals,
            status, schedule, and prestige.
          </div>

          <div className="endpoint">
            <div className="ep-method-url">
              <span className="ep-method post">POST</span>
              <span className="ep-url">/api/v1/node/:nodeId/script/create</span>
            </div>
            <div className="ep-desc">Create or update a script on this node.</div>
            <div className="ep-label">Request Body</div>
            <div className="ep-code">{`{
  "name": "dailyReset",
  "script": "setValueForNode('streak', 0);"
}`}</div>
            <div className="ep-note">Max 2000 characters. Scripts are node-scoped (not version-scoped).</div>
          </div>

          <div className="endpoint">
            <div className="ep-method-url">
              <span className="ep-method get">GET</span>
              <span className="ep-url">/api/v1/node/:nodeId/script/:scriptId</span>
            </div>
            <div className="ep-desc">View a script's source code and metadata.</div>
          </div>

          <div className="endpoint">
            <div className="ep-method-url">
              <span className="ep-method post">POST</span>
              <span className="ep-url">/api/v1/node/:nodeId/script/:scriptId/execute</span>
            </div>
            <div className="ep-desc">Execute a script on this node.</div>
            <div className="ep-label">Response</div>
            <div className="ep-code">{`{
  "message": "Script executed successfully",
  "logs": ["console output line 1", "..."],
  "node": { "...updated node data" }
}`}</div>
          </div>

          <div className="highlight-box">
            <div className="section-text">
              <strong>Script environment:</strong> Sandboxed VM, 3-second timeout,
              up to 200 console.log lines captured.
            </div>
          </div>

          <div className="sub-title">Available Functions Inside Scripts</div>
          <div className="ep-code">{`getApi()
setValueForNode(key, value)
setGoalForNode(key, goal)
editStatusForNode(status)
addPrestigeForNode()
updateScheduleForNode(datetime | null)`}</div>
          <div className="ep-note">Scripts run under the permissions of the calling user or API key. Failures are logged with captured output and error messages.</div>
        </div>

        {/* ═══════════════════════════════════════════════════════════════ */}
        {/*  9. NODE VERSION ENDPOINTS                                    */}
        {/* ═══════════════════════════════════════════════════════════════ */}
        <div className="section" id="version">
          <div className="section-title">
            <span className="section-icon">📋</span> Node Version Endpoints
          </div>
          <div className="section-text">
            Version-scoped operations for status, schedule, prestige, notes,
            values, goals, and contributions.
          </div>

          {/* ── Status & Schedule ── */}
          <div className="sub-title">Status &amp; Schedule</div>

          <div className="endpoint">
            <div className="ep-method-url">
              <span className="ep-method post">POST</span>
              <span className="ep-url">/api/v1/node/:nodeId/:version/editStatus</span>
            </div>
            <div className="ep-desc">Change status for this node. Optionally apply to all children.</div>
            <div className="ep-label">Request Body</div>
            <div className="ep-code">{`{
  "status": "active | completed | trimmed",
  "isInherited": true
}`}</div>
            <div className="ep-note"><code>isInherited</code> (optional, default false) — when true, the status change cascades to all children.</div>
          </div>

          <div className="endpoint">
            <div className="ep-method-url">
              <span className="ep-method post">POST</span>
              <span className="ep-url">/api/v1/node/:nodeId/:version/editSchedule</span>
            </div>
            <div className="ep-desc">Set or clear the scheduled date for this node.</div>
            <div className="ep-label">Request Body</div>
            <div className="ep-code">{`{
  "newSchedule": "2026-03-15T09:00:00Z",
  "reeffectTime": 24
}
// clear schedule:
{ "newSchedule": null }`}</div>
            <div className="ep-note"><code>reeffectTime</code> is optional — hours until the schedule repeats after prestige (recurring interval).</div>
          </div>

          <div className="endpoint">
            <div className="ep-method-url">
              <span className="ep-method post">POST</span>
              <span className="ep-url">/api/v1/node/:nodeId/:version/prestige</span>
            </div>
            <div className="ep-desc">Add a new version (prestige) to this node. Creates version N+1.</div>
          </div>

          <div className="section-spacer"></div>

          {/* ── Notes ────────────── */}
          <div className="sub-title">Notes</div>

          <div className="endpoint">
            <div className="ep-method-url">
              <span className="ep-method get">GET</span>
              <span className="ep-url">/api/v1/node/:nodeId/:version/notes</span>
            </div>
            <div className="ep-desc">List all notes on this version.</div>
            <div className="ep-label">Query Parameters</div>
            <div className="param-row">
              <span className="param-key">?limit=NUMBER</span>
              <span className="param-desc">Max results</span>
            </div>
            <div className="param-row">
              <span className="param-key">?startDate=YYYY-MM-DD</span>
              <span className="param-desc">Filter from date</span>
            </div>
            <div className="param-row">
              <span className="param-key">?endDate=YYYY-MM-DD</span>
              <span className="param-desc">Filter to date</span>
            </div>
          </div>

          <div className="endpoint">
            <div className="ep-method-url">
              <span className="ep-method post">POST</span>
              <span className="ep-url">/api/v1/node/:nodeId/:version/notes</span>
            </div>
            <div className="ep-desc">Create a new note. Supports text or file upload via multipart form data.</div>
            <div className="ep-label">Text Note — JSON Body</div>
            <div className="ep-code">{'{ "content": "Your note text here" }'}</div>
            <div className="ep-label">File Note — Multipart Form</div>
            <div className="ep-code">{"content: (file)\nContent-Type: multipart/form-data"}</div>
          </div>

          <div className="endpoint">
            <div className="ep-method-url">
              <span className="ep-method get">GET</span>
              <span className="ep-url">/api/v1/node/:nodeId/:version/notes/:noteId</span>
            </div>
            <div className="ep-desc">View a single note. Text notes return content; file notes return the file.</div>
          </div>

          <div className="endpoint">
            <div className="ep-method-url">
              <span className="ep-method put">PUT</span>
              <span className="ep-url">/api/v1/node/:nodeId/:version/notes/:noteId</span>
            </div>
            <div className="ep-desc">Edit an existing text note. File notes cannot be edited.</div>
            <div className="ep-label">Request Body</div>
            <div className="ep-code">{'{ "content": "Updated note text" }'}</div>
            <div className="ep-label">Response</div>
            <div className="ep-code">{'{ "success": true, "_id": "...", "message": "Note updated successfully" }'}</div>
          </div>

          <div className="endpoint">
            <div className="ep-method-url">
              <span className="ep-method delete">DELETE</span>
              <span className="ep-url">/api/v1/node/:nodeId/:version/notes/:noteId</span>
            </div>
            <div className="ep-desc">Permanently delete a note.</div>
          </div>

          <div className="endpoint">
            <div className="ep-method-url">
              <span className="ep-method get">GET</span>
              <span className="ep-url">/api/v1/node/:nodeId/:version/notes/book</span>
            </div>
            <div className="ep-desc">Book view — all notes in hierarchical format including children nodes.</div>
          </div>

          <div className="endpoint">
            <div className="ep-method-url">
              <span className="ep-method get">GET</span>
              <span className="ep-url">/api/v1/node/:nodeId/:version/notes/editor</span>
            </div>
            <div className="ep-desc">Open the full-page note editor for creating a new note.</div>
            <div className="ep-note">HTML only. Add <code>?token=...&amp;html</code> to access.</div>
          </div>

          <div className="endpoint">
            <div className="ep-method-url">
              <span className="ep-method get">GET</span>
              <span className="ep-url">/api/v1/node/:nodeId/:version/notes/:noteId/editor</span>
            </div>
            <div className="ep-desc">Open the full-page editor for an existing note.</div>
            <div className="ep-note">HTML only. File notes redirect to the view page.</div>
          </div>

          <div className="section-spacer"></div>

          {/* ── Contributions ────── */}
          <div className="sub-title">Contributions</div>

          <div className="endpoint">
            <div className="ep-method-url">
              <span className="ep-method get">GET</span>
              <span className="ep-url">/api/v1/node/:nodeId/:version/contributions</span>
            </div>
            <div className="ep-desc">List all contributions on this node version.</div>
            <div className="ep-label">Query Parameters</div>
            <div className="param-row">
              <span className="param-key">?limit=NUMBER</span>
              <span className="param-desc">Max results</span>
            </div>
            <div className="param-row">
              <span className="param-key">?startDate=YYYY-MM-DD</span>
              <span className="param-desc">Filter from date</span>
            </div>
            <div className="param-row">
              <span className="param-key">?endDate=YYYY-MM-DD</span>
              <span className="param-desc">Filter to date</span>
            </div>
          </div>

          <div className="section-spacer"></div>

          {/* ── Values & Goals ───── */}
          <div className="sub-title">Values &amp; Goals</div>
          <div className="desc-muted">
            Version-scoped key–value pairs for metrics, automation, and computed
            state. Keys prefixed with <code>_auto__</code> are read-only and
            system-generated.
          </div>

          <div className="endpoint">
            <div className="ep-method-url">
              <span className="ep-method get">GET</span>
              <span className="ep-url">/api/v1/node/:nodeId/:version/values</span>
            </div>
            <div className="ep-desc">List all values and goals on this version.</div>
          </div>

          <div className="endpoint">
            <div className="ep-method-url">
              <span className="ep-method post">POST</span>
              <span className="ep-url">/api/v1/node/:nodeId/:version/value</span>
            </div>
            <div className="ep-desc">Set a value on this version.</div>
            <div className="ep-label">Request Body</div>
            <div className="ep-code">{'{ "key": "revenue", "value": 42000 }'}</div>
          </div>

          <div className="endpoint">
            <div className="ep-method-url">
              <span className="ep-method post">POST</span>
              <span className="ep-url">/api/v1/node/:nodeId/:version/goal</span>
            </div>
            <div className="ep-desc">Set a goal on this version.</div>
            <div className="ep-label">Request Body</div>
            <div className="ep-code">{'{ "key": "revenue", "goal": 100000 }'}</div>
          </div>
        </div>

        {/* ═══════════════════════════════════════════════════════════════ */}
        {/* 10. TRANSACTIONS                                              */}
        {/* ═══════════════════════════════════════════════════════════════ */}
        <div className="section" id="transactions">
          <div className="section-title">
            <span className="section-icon">🤝</span> Transactions
          </div>
          <div className="section-text">
            Transactions are value trades between two sides. Each side is either
            a <strong>NODE</strong> (an internal tree node with key–value pairs)
            or <strong>OUTSIDE</strong> (an external source like a Solana wallet).
            Approval follows the tree's transaction policy.
          </div>

          <div className="highlight-box">
            <div className="section-text">
              <strong>How sides work:</strong><br />
              • <strong>NODE</strong> — trades node values (key–value pairs). Requires <code>nodeId</code> and <code>versionIndex</code>.<br />
              • <strong>OUTSIDE</strong> — represents an external source (e.g. a Solana wallet). Uses <code>sourceType</code> and <code>sourceId</code>. Cannot carry values — only the NODE side sends/receives.<br /><br />
              <strong>Values:</strong> <code>valuesA</code> and <code>valuesB</code> are objects mapping value keys to amounts (e.g. <code>{"{ \"gold\": 100 }"}</code>). Each side's values represent what that side <em>gives</em>. At least one side must include values. An OUTSIDE side cannot have values.
            </div>
          </div>

          <div className="sub-title">List &amp; View</div>

          <div className="endpoint">
            <div className="ep-method-url">
              <span className="ep-method get">GET</span>
              <span className="ep-url">/api/v1/node/:nodeId/:version/transactions</span>
            </div>
            <div className="ep-desc">List all transactions (pending, accepted, and rejected) for this node version.</div>
          </div>

          <div className="endpoint">
            <div className="ep-method-url">
              <span className="ep-method get">GET</span>
              <span className="ep-url">/api/v1/node/:nodeId/:version/transactions/:transactionId</span>
            </div>
            <div className="ep-desc">View a single transaction including both sides, traded values, approval groups, and status.</div>
          </div>

          <div className="sub-title">Create</div>

          <div className="endpoint">
            <div className="ep-method-url">
              <span className="ep-method post">POST</span>
              <span className="ep-url">/api/v1/node/:nodeId/:version/transactions</span>
            </div>
            <div className="ep-desc">Create a new transaction proposal between two sides.</div>
            <div className="ep-label">Node ↔ Node Example</div>
            <div className="ep-code">{`{
  "sideA.kind": "NODE",
  "sideA.nodeId": "node-id-A",
  "versionAIndex": 1,
  "valuesA": { "gold": 100 },

  "sideB.kind": "NODE",
  "sideB.nodeId": "node-id-B",
  "versionBIndex": 2,
  "valuesB": { "wood": 50 }
}`}</div>
            <div className="ep-label">Node ↔ Outside (Solana) Example</div>
            <div className="ep-code">{`{
  "sideA.kind": "NODE",
  "sideA.nodeId": "node-id-A",
  "versionAIndex": 1,
  "valuesA": { "gold": 100 },

  "sideB.kind": "OUTSIDE",
  "sideB.sourceType": "SOLANA",
  "sideB.sourceId": "So1anaWa11etAddr3ss..."
}`}</div>
            <div className="ep-label">Field Reference</div>
            <div className="param-row">
              <span className="param-key">sideX.kind</span>
              <span className="param-desc"><code>NODE</code> or <code>OUTSIDE</code> — only one side may be OUTSIDE</span>
            </div>
            <div className="param-row">
              <span className="param-key">sideX.nodeId</span>
              <span className="param-desc">Required when kind is <code>NODE</code></span>
            </div>
            <div className="param-row">
              <span className="param-key">sideX.sourceType</span>
              <span className="param-desc">External source type (currently <code>SOLANA</code>). Used when kind is <code>OUTSIDE</code></span>
            </div>
            <div className="param-row">
              <span className="param-key">sideX.sourceId</span>
              <span className="param-desc">External identifier (e.g. Solana wallet address). Used when kind is <code>OUTSIDE</code></span>
            </div>
            <div className="param-row">
              <span className="param-key">versionXIndex</span>
              <span className="param-desc">Required for <code>NODE</code> sides. Side B defaults to latest version if omitted</span>
            </div>
            <div className="param-row">
              <span className="param-key">valuesX</span>
              <span className="param-desc">Object of <code>{"{ key: amount }"}</code> that this side gives. OUTSIDE sides cannot have values</span>
            </div>
            <div className="ep-note">
              Self-trades (same node + same version on both sides) are not allowed.
              If all approval groups resolve immediately, the transaction executes on creation.
            </div>
          </div>

          <div className="sub-title">Approve &amp; Deny</div>
          <div className="desc-muted">
            Approval follows the tree's transaction policy (set via{" "}
            <code>POST /api/v1/root/:rootId/transaction-policy</code>).
            Depending on the policy, one or more approvals may be needed.
            Status transitions: <code>pending</code> → <code>accepted</code> or <code>rejected</code>.
          </div>

          <div className="endpoint">
            <div className="ep-method-url">
              <span className="ep-method post">POST</span>
              <span className="ep-url">/api/v1/node/:nodeId/:version/transactions/:transactionId/approve</span>
            </div>
            <div className="ep-desc">Approve a pending transaction. When enough approvals are collected (per policy), the transaction executes and values are exchanged.</div>
          </div>

          <div className="endpoint">
            <div className="ep-method-url">
              <span className="ep-method post">POST</span>
              <span className="ep-url">/api/v1/node/:nodeId/:version/transactions/:transactionId/deny</span>
            </div>
            <div className="ep-desc">Deny a pending transaction. Sets the transaction status to rejected.</div>
          </div>
        </div>

        {/* ═══════════════════════════════════════════════════════════════ */}
        {/* 11. SOLANA WALLET                                             */}
        {/* ═══════════════════════════════════════════════════════════════ */}
        <div className="section" id="solana">
          <div className="section-title">
            <span className="section-icon">💎</span> Solana Wallet
          </div>
          <div className="section-text">
            Each node version can have an associated Solana wallet. Balances are
            stored in lamports. Auto values like <code>_auto__sol</code> update
            automatically on read.
          </div>

          <div className="endpoint">
            <div className="ep-method-url">
              <span className="ep-method get">GET</span>
              <span className="ep-url">/api/v1/node/:nodeId/:version/values/solana</span>
            </div>
            <div className="ep-desc">Get wallet address, SOL balance, and token balances.</div>
          </div>

          <div className="endpoint">
            <div className="ep-method-url">
              <span className="ep-method post">POST</span>
              <span className="ep-url">/api/v1/node/:nodeId/:version/values/solana</span>
            </div>
            <div className="ep-desc">Create or configure the wallet for this version.</div>
          </div>

          <div className="endpoint">
            <div className="ep-method-url">
              <span className="ep-method post">POST</span>
              <span className="ep-url">/api/v1/node/:nodeId/:version/values/solana/send</span>
            </div>
            <div className="ep-desc">Send SOL to another address.</div>
            <div className="ep-label">Request Body</div>
            <div className="ep-code">{`{
  "destination": "So1anaAddr3ss...",
  "amount": 1000000
}`}</div>
            <div className="ep-note">Amount is in lamports (1 SOL = 1,000,000,000 lamports).</div>
          </div>

          <div className="endpoint">
            <div className="ep-method-url">
              <span className="ep-method post">POST</span>
              <span className="ep-url">/api/v1/node/:nodeId/:version/values/solana/transaction</span>
            </div>
            <div className="ep-desc">Execute a token swap via Jupiter aggregator.</div>
            <div className="ep-label">Request Body</div>
            <div className="ep-code">{`{
  "fromType": "sol | token",
  "toType": "sol | token",
  "amount": 500000000,
  "inputMint": "optional-mint-address",
  "outputMint": "optional-mint-address",
  "slippageBps": 50
}`}</div>
            <div className="ep-note">If type is SOL, amount is in lamports. If type is token, amount is the UI amount (human-readable).</div>
          </div>
        </div>

        {/* ═══════════════════════════════════════════════════════════════ */}
        {/* BACK LINK                                                     */}
        {/* ═══════════════════════════════════════════════════════════════ */}
        <div className="back-links">
          <Link className="back-link" to="/about">← Back to About</Link>
        </div>

      </div>
    </div>
  );
};

export default ApiAccessSection;