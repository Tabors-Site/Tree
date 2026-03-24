/* ------------------------------------------------- */
/* Public query page renderer                        */
/* Lightweight chat UI for querying public trees      */
/* ------------------------------------------------- */
/* NOTE: baseStyles not imported here. The query page */
/* uses a dark theme (gradient #0f0c29 -> #16213e)   */
/* that diverges entirely from the purple base. Only  */
/* the * reset overlaps, which is not worth the       */
/* import + override cost.                            */

import { escapeHtml } from "./utils.js";

export function renderQueryPage({ treeName, ownerUsername, rootId, queryAvailable, isAuthenticated }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(treeName)} - Query</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      font-family: "DM Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: linear-gradient(135deg, #0f0c29 0%, #1a1a2e 40%, #16213e 100%);
      color: #e0e0e0;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
    }

    .header {
      padding: 24px 32px;
      border-bottom: 1px solid rgba(255,255,255,0.08);
      display: flex;
      align-items: center;
      gap: 16px;
    }

    .header h1 {
      font-size: 1.3rem;
      font-weight: 700;
      color: #fff;
    }

    .header .meta {
      font-size: 0.85rem;
      color: rgba(255,255,255,0.5);
    }

    .header .badge {
      font-size: 0.7rem;
      padding: 3px 10px;
      border-radius: 12px;
      background: rgba(72,187,120,0.15);
      color: rgba(72,187,120,0.9);
      border: 1px solid rgba(72,187,120,0.25);
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    .chat-area {
      flex: 1;
      overflow-y: auto;
      padding: 24px 32px;
      display: flex;
      flex-direction: column;
      gap: 16px;
    }

    .message {
      max-width: 720px;
      width: 100%;
      margin: 0 auto;
      padding: 16px 20px;
      border-radius: 16px;
      line-height: 1.6;
      font-size: 0.95rem;
    }

    .message.user {
      background: rgba(88,86,214,0.15);
      border: 1px solid rgba(88,86,214,0.25);
      align-self: flex-end;
    }

    .message.assistant {
      background: rgba(255,255,255,0.05);
      border: 1px solid rgba(255,255,255,0.1);
    }

    .message.error {
      background: rgba(255,59,48,0.1);
      border: 1px solid rgba(255,59,48,0.25);
      color: rgba(255,107,107,0.9);
    }

    .message p { margin: 0 0 8px; }
    .message p:last-child { margin-bottom: 0; }
    .message code {
      background: rgba(255,255,255,0.1);
      padding: 2px 6px;
      border-radius: 4px;
      font-size: 0.9em;
    }
    .message pre {
      background: rgba(0,0,0,0.3);
      padding: 12px 16px;
      border-radius: 8px;
      overflow-x: auto;
      margin: 8px 0;
    }
    .message pre code {
      background: none;
      padding: 0;
    }

    .empty-state {
      text-align: center;
      color: rgba(255,255,255,0.4);
      padding: 48px 24px;
      font-size: 0.95rem;
      max-width: 480px;
      margin: auto;
    }

    .empty-state .icon {
      font-size: 2rem;
      margin-bottom: 12px;
      opacity: 0.6;
    }

    .input-area {
      padding: 16px 32px 24px;
      border-top: 1px solid rgba(255,255,255,0.08);
      max-width: 784px;
      width: 100%;
      margin: 0 auto;
    }

    .input-row {
      display: flex;
      gap: 12px;
      align-items: flex-end;
    }

    .input-row textarea {
      flex: 1;
      resize: none;
      padding: 12px 16px;
      border-radius: 16px;
      border: 1px solid rgba(255,255,255,0.15);
      background: rgba(255,255,255,0.06);
      color: #fff;
      font-size: 0.95rem;
      font-family: inherit;
      line-height: 1.5;
      min-height: 48px;
      max-height: 200px;
      outline: none;
      transition: border-color 0.2s;
    }

    .input-row textarea:focus {
      border-color: rgba(88,86,214,0.5);
    }

    .input-row textarea::placeholder {
      color: rgba(255,255,255,0.3);
    }

    .input-row button {
      padding: 12px 20px;
      border-radius: 16px;
      border: 1px solid rgba(72,187,120,0.4);
      background: rgba(72,187,120,0.15);
      color: rgba(72,187,120,0.9);
      font-weight: 600;
      font-size: 0.9rem;
      cursor: pointer;
      transition: background 0.2s;
      white-space: nowrap;
    }

    .input-row button:hover {
      background: rgba(72,187,120,0.25);
    }

    .input-row button:disabled {
      opacity: 0.4;
      cursor: not-allowed;
    }

    .footer {
      text-align: center;
      padding: 12px;
      font-size: 0.75rem;
      color: rgba(255,255,255,0.3);
    }

    .footer a {
      color: rgba(88,86,214,0.7);
      text-decoration: none;
    }

    .spinner {
      display: inline-block;
      width: 16px;
      height: 16px;
      border: 2px solid rgba(255,255,255,0.2);
      border-top-color: rgba(72,187,120,0.8);
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
      margin-right: 8px;
      vertical-align: middle;
    }

    @keyframes spin { to { transform: rotate(360deg); } }

    .unavailable {
      text-align: center;
      padding: 48px 24px;
      color: rgba(255,255,255,0.5);
    }

    .unavailable h2 {
      font-size: 1.1rem;
      margin-bottom: 8px;
      color: rgba(255,255,255,0.7);
    }
  </style>
</head>
<body>

  <div class="header">
    <div>
      <h1>${escapeHtml(treeName)}</h1>
      <div class="meta">by ${escapeHtml(ownerUsername)}</div>
      <a href="https://dir.treeos.ai" target="_blank" rel="noopener"
        style="font-size:0.75rem;color:rgba(255,255,255,0.35);text-decoration:none;margin-top:4px;display:inline-block;transition:color 0.2s;"
        onmouseover="this.style.color='rgba(255,255,255,0.7)'"
        onmouseout="this.style.color='rgba(255,255,255,0.35)'"
      >Canopy Directory</a>
    </div>
    <span class="badge">Public</span>
  </div>

  ${queryAvailable ? `
  <div class="chat-area" id="chatArea">
    <div class="empty-state" id="emptyState">
      Ask the tree anything to find knowledge. Responses are read only and will not modify the tree.
    </div>
  </div>

  <div class="input-area">
    <div class="input-row">
      <textarea
        id="queryInput"
        placeholder="Ask a question about this tree..."
        rows="1"
        onkeydown="if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();sendQuery();}"
        oninput="autoResize(this)"
      ></textarea>
      <button id="sendBtn" onclick="sendQuery()">Ask</button>
    </div>
  </div>
  ` : `
  <div class="unavailable">
    <h2>Query not available</h2>
    <p>This tree does not have AI configured for public queries.${isAuthenticated ? "" : " If you have an account on another land, you can query through the CLI or API using your own AI connection."}</p>
  </div>
  `}

  <div class="footer">
    Powered by <a href="https://treeos.ai" target="_blank">TreeOS</a>
  </div>

  <script>
  var ROOT_ID = "${rootId}";
  var sending = false;

  function autoResize(el) {
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 200) + "px";
  }

  function addMessage(role, html) {
    var empty = document.getElementById("emptyState");
    if (empty) empty.remove();

    var area = document.getElementById("chatArea");
    var div = document.createElement("div");
    div.className = "message " + role;
    div.innerHTML = html;
    area.appendChild(div);
    area.scrollTop = area.scrollHeight;
    return div;
  }

  function markdownToHtml(text) {
    if (!text) return "";
    var BT = String.fromCharCode(96);
    var html = text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");

    // Code blocks (triple backtick fenced)
    var codeBlockRe = new RegExp(BT + BT + BT + "(\\\\w*)?\\\\n([\\\\s\\\\S]*?)" + BT + BT + BT, "g");
    html = html.replace(codeBlockRe, function(m, lang, code) {
      return "<pre><code>" + code.trim() + "</code></pre>";
    });

    // Inline code
    var inlineCodeRe = new RegExp(BT + "([^" + BT + "]+)" + BT, "g");
    html = html.replace(inlineCodeRe, "<code>$1</code>");

    // Bold
    html = html.replace(/[*][*](.+?)[*][*]/g, "<strong>$1</strong>");

    // Italic
    html = html.replace(/[*](.+?)[*]/g, "<em>$1</em>");

    // Paragraphs
    html = html.split(new RegExp("\\\\n\\\\n+")).map(function(p) {
      p = p.trim();
      if (!p) return "";
      if (p.startsWith("<pre>")) return p;
      return "<p>" + p.replace(new RegExp("\\\\n", "g"), "<br>") + "</p>";
    }).join("");

    return html;
  }

  async function sendQuery() {
    if (sending) return;
    var input = document.getElementById("queryInput");
    var btn = document.getElementById("sendBtn");
    var msg = input.value.trim();
    if (!msg) return;

    sending = true;
    btn.disabled = true;
    btn.textContent = "...";
    input.value = "";
    input.style.height = "auto";

    addMessage("user", "<p>" + msg.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/\\n/g,"<br>") + "</p>");

    var loadingDiv = addMessage("assistant", '<span class="spinner"></span> Thinking...');

    try {
      var res = await fetch("/api/v1/root/" + ROOT_ID + "/query", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: msg }),
      });

      var text = await res.text();
      var data;
      try { data = JSON.parse(text); } catch (_) { data = {}; }

      if (res.status === 429) {
        loadingDiv.className = "message error";
        loadingDiv.innerHTML = "<p>Rate limit reached. Please wait a few minutes before trying again.</p>";
      } else if (!res.ok || !data.success) {
        var errMsg = data.answer || data.error || data.message || "Error (HTTP " + res.status + ")";
        loadingDiv.className = "message error";
        loadingDiv.innerHTML = "<p>" + errMsg + "</p>";
      } else {
        loadingDiv.innerHTML = markdownToHtml(data.answer);
      }
    } catch (err) {
      loadingDiv.className = "message error";
      loadingDiv.innerHTML = "<p>Network error: " + err.message + "</p>";
    }

    sending = false;
    btn.disabled = false;
    btn.textContent = "Ask";
    input.focus();
  }
  </script>

</body>
</html>`;
}
