import SectionNav from "./SectionNav";

const ApiAccessSection = () => {
    return (
        <>
            <h1>API Access</h1>

            <p>
                Use the API to read from and write to your trees.
                This enables integrations, scripts, automations, bots, and external systems
                to interact with the same backend that powers the Tree apps.
            </p>

            <p>
                All endpoints return JSON by default. Adding <code>?html</code> enables browser-rendered views
                and requires a URL token. If the HTML query is appended, you may be redirected on POST requests.
            </p>

            {/* ================================================================ */}
            <h2>About API Keys</h2>

            <ul>
                <li>Created from your user profile</li>
                <li>Each key can be individually revoked</li>
                <li>Usage is tracked per key</li>
                <li>Maximum of 10 active (unrevoked) keys per user</li>
                <li>Sent via <code>x-api-key</code> request header</li>
                <li>Work with all endpoints, including read and write operations</li>
            </ul>

            <pre>
                <code>{`x-api-key: YOUR_API_KEY`}</code>
            </pre>

            <p>
                JWT-based authentication also exists for browser sessions, but is not
                recommended for external services as they expire rapidly.
            </p>

            {/* ================================================================ */}
            <h2>Endpoint Structure</h2>

            <p>Tree endpoints are organized by four scopes:</p>

            <ul>
                <li><strong>User</strong> — Profile, roots, API keys, contributions, notes, mail, raw ideas</li>
                <li><strong>Root</strong> — Full tree traversal, contributors, full scope views (calendar, global values, etc)</li>
                <li><strong>Node</strong> — Structure and hierarchy management</li>
                <li><strong>Node Version</strong> — Values, goals, notes, contributions, wallets</li>
            </ul>

            {/* ================================================================ */}
            <h3>User Endpoints</h3>


            <ul>
                <li><code>GET /api/user/:userId</code> — User profile and root nodes</li>
                <li><code>POST /api/user/:userId/api-keys</code> — Create API key (body: <code>{`{"name": "optional descriptive name"}`}</code>)</li>

                <li><code>GET /api/user/:userId/api-keys</code> — List API keys</li>
                <li><code>DELETE /api/user/:userId/api-keys/:keyId</code> — Revoke API key</li>
            </ul>

            <h4>Contributions</h4>

            <ul>
                <li>
                    <code>GET /api/user/:userId/contributions</code> — All contributions
                    made by the user across all trees
                </li>
            </ul>

            <h4>Query Parameters</h4>
            <ul>
                <li><code>?limit=NUMBER</code></li>
                <li><code>?startDate=YYYY-MM-DD</code></li>
                <li><code>?endDate=YYYY-MM-DD</code></li>
            </ul>

            <h4>Notes</h4>

            <ul>
                <li><code>GET /api/user/:userId/notes</code> — List or search all notes posted by user</li>
            </ul>

            <h4>Query Parameters</h4>
            <ul>
                <li><code>?q=SEARCH</code> — Full-text search</li>
                <li><code>?limit=NUMBER</code></li>
                <li><code>?startDate=YYYY-MM-DD</code></li>
                <li><code>?endDate=YYYY-MM-DD</code></li>
            </ul>

            <h4>Tagged Notes (Inbox)</h4>



            <ul>
                <li><code>GET /api/user/:userId/tags</code> — Notes where the user is tagged</li>
            </ul>


            <h4>Raw Ideas</h4>



            <ul>
                <li><code>POST /api/user/:userId/raw-ideas</code> — Create raw idea (accepts multipart form data: <code>content</code> string, optional <code>file</code>)</li>
                <li><code>GET /api/user/:userId/raw-ideas</code> — List or search raw ideas</li>
                <li><code>GET /api/user/:userId/raw-ideas/:rawIdeaId</code> — View raw idea</li>
                <li><code>POST /api/user/:userId/raw-ideas/:rawIdeaId/transfer</code> — Convert to note (body: <code>{`{"nodeId": "targetNodeId"}`}</code>)</li>
                <li><code>DELETE /api/user/:userId/raw-ideas/:rawIdeaId</code> — Delete raw idea</li>
            </ul>
            <p>
                Raw ideas are unstructured inputs (text or files) that can later be
                converted into notes and placed into a tree.
            </p>

            <h4>Deleted Branches</h4>



            <ul>
                <li><code>GET /api/user/:userId/deleted</code> — List deleted branches</li>
                <li><code>POST /api/user/:userId/deleted/:nodeId/revive</code> — Restore to parent (body: <code>{`{"targetParentId": "nodeId"}`}</code>)</li>
                <li><code>POST /api/user/:userId/deleted/:nodeId/reviveAsRoot</code> — Restore as new root</li>
            </ul>
            <p>
                Deleted branches are soft-deleted and can be restored later.
            </p>

            <h4>Invites & Collaboration</h4>


            <ul>
                <li><code>GET /api/user/:userId/invites</code> — List pending invites</li>
                <li><code>POST /api/user/:userId/invites/:inviteId</code> — Accept or decline (body: <code>{`{"accept": true | false}`}</code>)</li>
            </ul>

            <p>
                Users can receive invitations to collaborate on roots owned by others.
            </p>

            {/* ================================================================ */}
            <h3>Root Endpoints</h3>

            <p>
                Roots represent the top-level entry point of a tree. Most tree-wide
                operations happen here.
            </p>

            <h4>Tree Data</h4>

            <ul>
                <li><code>GET /api/root/:rootId</code> — Full tree including ancestors, children, metadata, notes, and contributions</li>
            </ul>

            <h4>Query Parameters</h4>
            <ul>
                <li><code>?active=true|false</code></li>
                <li><code>?completed=true|false</code></li>
                <li><code>?trimmed=true|false</code></li>
            </ul>

            <h4>Contributors & Ownership</h4>

            <ul>
                <li><code>POST /api/root/:rootId/invite</code> — Invite collaborator (body: <code>{`{"userReceiving": "username-or-userId"}`}</code>)</li>
                <li><code>POST /api/root/:rootId/transfer-owner</code> — Transfer ownership (body: <code>{`{"userReceiving": "username-or-userId"}`}</code>)</li>
                <li><code>POST /api/root/:rootId/remove-user</code> — Remove contributor (body: <code>{`{"userReceiving": "username-or-userId"}`}</code>)</li>
                <li><code>POST /api/root/:rootId/retire</code> — Archive root (soft delete tree). Only owner can do this with no other contributors on Tree.</li>
            </ul>

            <h4>Calendar</h4>

            <ul>
                <li><code>GET /api/root/:rootId/calendar</code> — All schedules for the tree</li>
            </ul>

            <h4>Query Parameters</h4>
            <ul>
                <li><code>?month=0–11</code></li>
                <li><code>?year=YYYY</code></li>
                <li><code>?day=YYYY-MM-DD</code> (HTML only)</li>
            </ul>

            {/* ================================================================ */}
            <h3>Node Endpoints</h3>

            <h4>Node Management</h4>

            <ul>
                <li><code>GET /api/:nodeId</code> — Node metadata (all versions)</li>
                <li><code>GET /api/:nodeId/:version</code> — Specific version</li>
                <li>
                    <code>POST /api/:nodeId/:version/editName</code> — Rename node
                    (body: <code>{`{"name": "string"}`}</code>)
                </li>

                <li><code>POST /api/:nodeId/createChild</code> — Add child node (body: <code>{`{"name": "string"}`}</code>)</li>
                <li><code>POST /api/:nodeId/updateParent</code> — Move node (body: <code>{`{"newParentId": "nodeId"}`}</code>)</li>
                <li><code>POST /api/:nodeId/delete</code> — Soft delete node</li>
            </ul>

            <h4>Scripts</h4>



            <ul>
                <li>
                    <code>POST /api/:nodeId/:version/editScript</code> — Create or update a script
                </li>
                <li>
                    <code>POST /api/:nodeId/:version/executeScript</code> — Execute a stored script
                </li>
            </ul>

            <h5>Edit Script — Request Body</h5>

            <pre>
                <code>{`{
  "name": "scriptName",
  "script": "javascript source code (max 2000 characters)"
}`}</code>
            </pre>

            <ul>
                <li>Both <code>name</code> and <code>script</code> are required</li>
                <li>Scripts are node-scoped and stored on the node (not by version)</li>
                <li>Updating a script does not execute it</li>
            </ul>

            <h5>Execute Script — Request Body</h5>

            <pre>
                <code>{`{
  "scriptName": "scriptName"
}`}</code>
            </pre>

            <p>
                Executes the named script attached to the node.
                Execution runs in a sandboxed environment and is recorded as an
                <code>executeScript</code> contribution.
            </p>

            <h5>JSON Response</h5>

            <pre>
                <code>{`{
  "message": "Script executed successfully",
  "logs": [
    "console output from script execution"
  ],
  "node": { "...updated node data" }
}`}</code>
            </pre>

            <p>
                Script execution environment:
            </p>

            <ul>
                <li>Scripts run inside a sandboxed VM</li>
                <li><code>console.log</code> output is captured (up to 200 lines)</li>
                <li>Execution timeout: 3 seconds</li>
            </ul>

            <p>
                Available safe functions inside scripts:
            </p>

            <ul>
                <li><code>getApi()</code></li>
                <li><code>setValueForNode(key, value)</code></li>
                <li><code>setGoalForNode(key, goal)</code></li>
                <li><code>editStatusForNode(status)</code></li>
                <li><code>addPrestigeForNode()</code></li>
                <li><code>updateScheduleForNode(datetime | null)</code></li>
            </ul>



            <ul>
                <li>If the script does not exist, execution fails</li>
                <li>Script execution may mutate values, goals, status, schedule, or prestige</li>
                <li>Execution runs under the permissions of the calling user or API key</li>
                <li>Failures are logged with captured output and error messages</li>
            </ul>


            {/* ================================================================ */}
            <h3>Node Version Endpoints</h3>

            <ul>
                <li><code>POST /api/:nodeId/:version/editStatus</code> — Change the status for this node and all children (body: <code>{`{ "status": "active | completed | trimmed"}`}</code>)</li>
                <li><code>POST /api/:nodeId/:version/editSchedule</code> — Edit the schedule (body: <code>{` "schedule": "ISO-8601 datetime string | null"`}</code>)</li>
                <li><code>POST /api/:nodeId/:version/prestige</code> — Add a new version</li>

            </ul>

            <h4>Notes</h4>

            <ul>
                <li><code>GET /api/:nodeId/:version/notes</code> — List notes</li>
                <li><code>POST /api/:nodeId/:version/notes</code> — Create note (body: <code>{`{"content": "string"} or   "content": file,
`}</code>)</li>
                <li><code>GET /api/:nodeId/:version/notes/:noteId</code> — View note</li>
                <li><code>DELETE /api/:nodeId/:version/notes/:noteId</code> — Delete note</li>
                <li><code>GET /api/:nodeId/:version/notes/book</code> — Book view of the notes (all notes in hierarchical format with children included)</li>

            </ul>

            <h4>Contributions</h4>

            <ul>
                <li><code>GET /api/:nodeId/:version/contributions</code> — List contributions</li>
            </ul>

            <h4>Query Parameters</h4>
            <ul>
                <li><code>?limit=NUMBER</code></li>
                <li><code>?startDate=YYYY-MM-DD</code></li>
                <li><code>?endDate=YYYY-MM-DD</code></li>
            </ul>

            <h4>Values & Goals</h4>

            <p>
                Version-scoped key–value pairs used for metrics, automation, and computed state.
                Auto-generated keys (<code>_auto__*</code>) are read-only.
            </p>

            <ul>
                <li><code>GET /api/:nodeId/:version/values</code> — List all values and goals</li>
                <li><code>POST /api/:nodeId/:version/value</code> — Set value (body: <code>{`{"key": "string", "value": number}`}</code>)</li>
                <li><code>POST /api/:nodeId/:version/goal</code> — Set goal (body: <code>{`{"key": "string", "goal": number}`}</code>)</li>
            </ul>

            <h4>Solana Wallet</h4>

            <p>
                Each node version can have an associated Solana wallet. Balances are stored
                in lamports. Auto values such as <code>_auto__sol</code> update automatically
                on read.
            </p>

            <ul>
                <li><code>GET /api/:nodeId/:version/values/solana</code> — Get wallet info</li>
                <li><code>POST /api/:nodeId/:version/values/solana</code> — Create/configure wallet</li>
                <li><code>POST /api/:nodeId/:version/values/solana/send</code> — Send SOL (body: <code>{`{"destination": "address", "amount": number}`}</code>)</li>
                <li><code>POST /api/:nodeId/:version/values/solana/transaction</code> — Token swap (body: <code>{`{"fromType": "sol|token", "toType": "sol|token", "amount": number, "inputMint": "optional", "outputMint": "optional", "slippageBps": number}`}</code>)</li>
                <li>If the type is SOL, then use lamports. If the type is token, then use the token amount (UI amount)</li>
            </ul>



            <SectionNav currentId="api" />
        </>
    );
};

export default ApiAccessSection;