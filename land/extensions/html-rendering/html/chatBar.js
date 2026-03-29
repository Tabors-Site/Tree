/**
 * Chat Bar
 *
 * Embeddable chat widget for extension dashboard pages.
 * Floats at the bottom. Input bar, output area, minimize toggle.
 * Uses fetch POST to the extension's route. No WebSocket needed.
 * Messages persist in sessionStorage across page navigations.
 *
 * Usage in a dashboard page:
 *   import { chatBarCss, chatBarHtml, chatBarJs } from "../../html-rendering/html/chatBar.js";
 *   return page({
 *     css: myStyles + chatBarCss(),
 *     body: myBody + chatBarHtml({ placeholder: "Ask about your studies..." }),
 *     js: chatBarJs({ endpoint: `/api/v1/root/${rootId}/study`, token }),
 *   });
 */

export function chatBarCss() {
  return `
    .chat-bar {
      position: fixed;
      bottom: 0;
      left: 0;
      right: 0;
      z-index: 1000;
      transition: transform 0.3s ease;
    }
    .chat-bar.minimized { transform: translateY(calc(100% - 44px)); }

    .chat-bar-toggle {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 10px 20px;
      background: rgba(20, 20, 20, 0.95);
      backdrop-filter: blur(20px);
      border-top: 1px solid rgba(255,255,255,0.08);
      cursor: pointer;
      user-select: none;
    }
    .chat-bar-toggle-label {
      font-size: 0.8rem;
      color: rgba(255,255,255,0.5);
      letter-spacing: 0.05em;
    }
    .chat-bar-toggle-icon {
      font-size: 0.9rem;
      color: rgba(255,255,255,0.4);
      transition: transform 0.3s;
    }
    .chat-bar.minimized .chat-bar-toggle-icon { transform: rotate(180deg); }

    .chat-bar-messages {
      max-height: 300px;
      overflow-y: auto;
      padding: 16px 20px;
      background: rgba(10, 10, 10, 0.97);
      backdrop-filter: blur(20px);
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    .chat-msg {
      font-size: 0.9rem;
      line-height: 1.6;
      padding: 8px 12px;
      border-radius: 8px;
      max-width: 85%;
      white-space: pre-wrap;
      word-wrap: break-word;
    }
    .chat-msg.user {
      align-self: flex-end;
      background: rgba(102, 126, 234, 0.15);
      color: rgba(255,255,255,0.85);
    }
    .chat-msg.ai {
      align-self: flex-start;
      background: rgba(255,255,255,0.06);
      color: rgba(255,255,255,0.75);
    }
    .chat-msg.error {
      align-self: center;
      background: rgba(239, 68, 68, 0.1);
      color: rgba(239, 68, 68, 0.8);
      font-size: 0.8rem;
    }
    .chat-msg.loading {
      align-self: flex-start;
      color: rgba(255,255,255,0.3);
      font-style: italic;
    }

    .chat-bar-input-row {
      display: flex;
      gap: 8px;
      padding: 12px 20px 16px;
      background: rgba(10, 10, 10, 0.97);
      border-top: 1px solid rgba(255,255,255,0.06);
    }
    .chat-bar-input {
      flex: 1;
      background: rgba(255,255,255,0.06);
      border: 1px solid rgba(255,255,255,0.1);
      border-radius: 8px;
      padding: 10px 14px;
      color: #fff;
      font-size: 0.9rem;
      outline: none;
      font-family: inherit;
    }
    .chat-bar-input:focus { border-color: rgba(102, 126, 234, 0.4); }
    .chat-bar-input::placeholder { color: rgba(255,255,255,0.25); }

    .chat-bar-send {
      background: rgba(102, 126, 234, 0.2);
      border: 1px solid rgba(102, 126, 234, 0.3);
      border-radius: 8px;
      padding: 10px 18px;
      color: rgba(255,255,255,0.8);
      font-size: 0.85rem;
      cursor: pointer;
      white-space: nowrap;
    }
    .chat-bar-send:hover { background: rgba(102, 126, 234, 0.3); }
    .chat-bar-send:disabled { opacity: 0.4; cursor: not-allowed; }

    .cmd-ref {
      margin-top: 24px;
      margin-bottom: 80px;
      border-top: 1px solid rgba(255,255,255,0.06);
      padding-top: 12px;
    }
    .cmd-ref summary {
      font-size: 0.75rem;
      text-transform: uppercase;
      letter-spacing: 0.1em;
      color: rgba(255,255,255,0.3);
      cursor: pointer;
      user-select: none;
      list-style: none;
    }
    .cmd-ref summary::-webkit-details-marker { display: none; }
    .cmd-ref summary::before { content: "▸ "; }
    .cmd-ref[open] summary::before { content: "▾ "; }
    .cmd-ref-list {
      margin-top: 8px;
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .cmd-ref-item {
      display: flex;
      gap: 12px;
      font-size: 0.8rem;
      padding: 3px 0;
    }
    .cmd-ref-cmd {
      font-family: monospace;
      color: rgba(255,255,255,0.5);
      min-width: 140px;
      flex-shrink: 0;
    }
    .cmd-ref-desc { color: rgba(255,255,255,0.3); }

    @keyframes dotPulse {
      0%, 80%, 100% { opacity: 0.3; }
      40% { opacity: 1; }
    }
    .loading-dots span {
      animation: dotPulse 1.4s infinite;
    }
    .loading-dots span:nth-child(2) { animation-delay: 0.2s; }
    .loading-dots span:nth-child(3) { animation-delay: 0.4s; }
  `;
}

/**
 * Render a collapsible commands reference section.
 * @param {Array<{cmd: string, desc: string}>} commands
 */
export function commandsRefHtml(commands) {
  if (!commands || commands.length === 0) return "";
  const items = commands.map(c =>
    `<div class="cmd-ref-item"><span class="cmd-ref-cmd">${c.cmd}</span><span class="cmd-ref-desc">${c.desc}</span></div>`
  ).join("");
  return `<details class="cmd-ref"><summary>Commands</summary><div class="cmd-ref-list">${items}</div></details>`;
}

export function chatBarHtml({ placeholder = "Type a message..." } = {}) {
  return `
    <div class="chat-bar minimized" id="chatBar">
      <div class="chat-bar-toggle">
        <span class="chat-bar-toggle-label" onclick="toggleChatBar()">Chat</span>
        <span style="display:flex;align-items:center;gap:10px;">
          <span class="chat-bar-toggle-icon" onclick="clearChatBar()" title="Clear chat" style="cursor:pointer;font-size:0.75rem;color:rgba(255,255,255,0.3);">clear</span>
          <span class="chat-bar-toggle-icon" onclick="toggleChatBar()" style="cursor:pointer;">▲</span>
        </span>
      </div>
      <div class="chat-bar-messages" id="chatMessages"></div>
      <div class="chat-bar-input-row">
        <input class="chat-bar-input" id="chatInput" placeholder="${placeholder}"
               onkeydown="if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();sendChatMessage()}" />
        <button class="chat-bar-send" id="chatSend" onclick="sendChatMessage()">Send</button>
      </div>
    </div>
  `;
}

export function chatBarJs({ endpoint, token }) {
  const tokenParam = token ? `&token=${encodeURIComponent(token)}` : "";
  return `
    function clearChatBar() {
      document.getElementById('chatMessages').innerHTML = '';
      try { sessionStorage.removeItem('chatbar:' + window.location.pathname); } catch {}
    }

    var _chatStorageKey = 'chatbar:' + window.location.pathname;

    function saveChatHistory() {
      var msgs = [];
      var container = document.getElementById('chatMessages');
      if (!container) return;
      for (var el of container.children) {
        if (el.classList.contains('loading')) continue;
        var role = el.classList.contains('user') ? 'user' : el.classList.contains('error') ? 'error' : 'ai';
        msgs.push({ role: role, text: el.textContent });
      }
      try { sessionStorage.setItem(_chatStorageKey, JSON.stringify(msgs.slice(-30))); } catch {}
    }

    function restoreChatHistory() {
      try {
        var saved = sessionStorage.getItem(_chatStorageKey);
        if (!saved) return;
        var msgs = JSON.parse(saved);
        if (!Array.isArray(msgs) || msgs.length === 0) return;
        for (var m of msgs) {
          appendMessage(m.role, m.text);
        }
        // Open chat bar if there's history
        document.getElementById('chatBar').classList.remove('minimized');
      } catch {}
    }

    function toggleChatBar() {
      document.getElementById('chatBar').classList.toggle('minimized');
      var input = document.getElementById('chatInput');
      if (!document.getElementById('chatBar').classList.contains('minimized')) {
        setTimeout(function() { input.focus(); }, 100);
      }
    }

    function appendMessage(role, text) {
      var el = document.createElement('div');
      el.className = 'chat-msg ' + role;
      el.textContent = text;
      var container = document.getElementById('chatMessages');
      container.appendChild(el);
      container.scrollTop = container.scrollHeight;
      return el;
    }

    async function sendChatMessage() {
      var input = document.getElementById('chatInput');
      var message = input.value.trim();
      if (!message) return;

      input.value = '';
      document.getElementById('chatSend').disabled = true;
      input.disabled = true;

      // Open chat bar if minimized
      document.getElementById('chatBar').classList.remove('minimized');

      appendMessage('user', message);
      saveChatHistory();

      var loadingEl = document.createElement('div');
      loadingEl.className = 'chat-msg loading';
      loadingEl.innerHTML = '<span class="loading-dots">Thinking<span>.</span><span>.</span><span>.</span></span> <span style="font-size:0.8rem;opacity:0.5">may take a moment</span>';
      document.getElementById('chatMessages').appendChild(loadingEl);
      document.getElementById('chatMessages').scrollTop = document.getElementById('chatMessages').scrollHeight;

      try {
        var res = await fetch('${endpoint}', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ message: message }),
        });

        var data = await res.json();
        loadingEl.remove();

        if (data.status === 'ok' && data.data) {
          var answer = data.data.answer || data.data.synthesis || JSON.stringify(data.data);
          appendMessage('ai', answer);
          saveChatHistory();
          // Reload after delay to show updated dashboard data. Fade out to avoid CSS flash.
          setTimeout(function() {
            document.body.style.transition = 'opacity 0.2s';
            document.body.style.opacity = '0';
            setTimeout(function() { window.location.reload(); }, 200);
          }, 1200);
        } else if (data.error) {
          appendMessage('error', data.error.message || 'Something went wrong.');
        } else {
          appendMessage('ai', JSON.stringify(data));
        }
      } catch (err) {
        loadingEl.remove();
        appendMessage('error', 'Connection failed.');
      }

      document.getElementById('chatSend').disabled = false;
      input.disabled = false;
      input.focus();
      saveChatHistory();
    }

    // Restore chat history on page load
    restoreChatHistory();

    // Auto-send startMsg from URL (used by apps/create redirect)
    (function() {
      var params = new URLSearchParams(window.location.search);
      var startMsg = params.get('startMsg');
      if (startMsg && startMsg.trim()) {
        // Clean the URL so refresh doesn't re-send
        var clean = new URL(window.location);
        clean.searchParams.delete('startMsg');
        history.replaceState(null, '', clean.toString());
        // Send after a short delay to let the page render
        setTimeout(function() {
          document.getElementById('chatInput').value = startMsg;
          sendChatMessage();
        }, 500);
      }
    })();
  `;
}
