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

    .chat-bar-drag {
      width: 40px;
      height: 4px;
      background: rgba(255,255,255,0.15);
      border-radius: 2px;
      margin: 0 auto;
      cursor: ns-resize;
      position: absolute;
      top: -8px;
      left: 50%;
      transform: translateX(-50%);
    }
    .chat-bar-drag:hover { background: rgba(255,255,255,0.3); }

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
      height: 300px;
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
      <div class="chat-bar-drag" id="chatDragHandle"></div>
      <div class="chat-bar-toggle" onclick="toggleChatBar()">
        <span class="chat-bar-toggle-label">Chat</span>
        <span style="display:flex;align-items:center;gap:10px;" onclick="event.stopPropagation()">
          <span id="chatClearBtn" class="chat-bar-toggle-icon" onclick="clearChatBar()" title="Clear chat" style="cursor:pointer;font-size:0.75rem;color:rgba(255,255,255,0.3);">clear</span>
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

export function chatBarJs({ endpoint }) {
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

    var _activeAbort = null;

    function stopChatMessage() {
      if (_activeAbort) {
        _activeAbort.abort();
        _activeAbort = null;
      }
    }

    async function sendChatMessage() {
      var input = document.getElementById('chatInput');
      var message = input.value.trim();
      if (!message) return;

      input.value = '';
      var sendBtn = document.getElementById('chatSend');
      sendBtn.textContent = 'Stop';
      sendBtn.onclick = stopChatMessage;
      input.disabled = true;
      document.getElementById('chatClearBtn').style.opacity = '0.15';
      document.getElementById('chatClearBtn').style.pointerEvents = 'none';

      // Open chat bar if minimized
      document.getElementById('chatBar').classList.remove('minimized');

      appendMessage('user', message);
      saveChatHistory();

      var loadingEl = document.createElement('div');
      loadingEl.className = 'chat-msg loading';
      loadingEl.innerHTML = '<span class="loading-dots">Thinking<span>.</span><span>.</span><span>.</span></span> <span style="font-size:0.8rem;opacity:0.5">may take a moment</span>';
      document.getElementById('chatMessages').appendChild(loadingEl);
      document.getElementById('chatMessages').scrollTop = document.getElementById('chatMessages').scrollHeight;

      _activeAbort = new AbortController();

      try {
        var res = await fetch('${endpoint}', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ message: message }),
          signal: _activeAbort.signal,
        });

        var data = await res.json();
        loadingEl.remove();

        if (data.status === 'ok' && data.data) {
          var answer = data.data.answer || data.data.synthesis || JSON.stringify(data.data);
          appendMessage('ai', answer);
          saveChatHistory();
          // Refresh dashboard data without full page reload
          refreshDashboardData();
        } else if (data.error) {
          appendMessage('error', data.error.message || 'Something went wrong.');
        } else {
          appendMessage('ai', JSON.stringify(data));
        }
      } catch (err) {
        loadingEl.remove();
        if (err.name === 'AbortError') {
          appendMessage('error', 'Cancelled.');
        } else {
          appendMessage('error', 'Connection failed.');
        }
      }

      _activeAbort = null;
      var sendBtn = document.getElementById('chatSend');
      sendBtn.textContent = 'Send';
      sendBtn.onclick = sendChatMessage;
      sendBtn.disabled = false;
      input.disabled = false;
      document.getElementById('chatClearBtn').style.opacity = '';
      document.getElementById('chatClearBtn').style.pointerEvents = '';
      input.focus();
      saveChatHistory();
    }

    // Refresh dashboard content without full page reload
    async function refreshDashboardData() {
      try {
        var res = await fetch(window.location.href, { credentials: 'include' });
        if (!res.ok) { window.location.reload(); return; }
        var html = await res.text();
        var parser = new DOMParser();
        var doc = parser.parseFromString(html, 'text/html');
        var newContent = doc.querySelector('.container, .rec-layout, .kb-layout, [class*="-layout"]');
        var oldContent = document.querySelector('.container, .rec-layout, .kb-layout, [class*="-layout"]');
        if (newContent && oldContent) {
          oldContent.innerHTML = newContent.innerHTML;
        } else {
          window.location.reload();
        }
      } catch {
        window.location.reload();
      }
    }

    // Drag to resize chat bar
    (function() {
      var handle = document.getElementById('chatDragHandle');
      var chatBar = document.getElementById('chatBar');
      var messages = document.getElementById('chatMessages');
      var dragging = false;
      var startY = 0;
      var startHeight = 0;
      var DEFAULT_HEIGHT = 300;
      var MIN_HEIGHT = 120;
      var MAX_HEIGHT = window.innerHeight * 0.7;

      handle.addEventListener('mousedown', function(e) {
        e.preventDefault();
        dragging = true;
        startY = e.clientY;
        startHeight = messages.offsetHeight;
        chatBar.style.transition = 'none';
        document.body.style.userSelect = 'none';
      });

      handle.addEventListener('touchstart', function(e) {
        dragging = true;
        startY = e.touches[0].clientY;
        startHeight = messages.offsetHeight;
        chatBar.style.transition = 'none';
      }, { passive: true });

      document.addEventListener('mousemove', function(e) {
        if (!dragging) return;
        var delta = startY - e.clientY;
        var newHeight = Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, startHeight + delta));
        messages.style.height = newHeight + 'px';
      });

      document.addEventListener('touchmove', function(e) {
        if (!dragging) return;
        var delta = startY - e.touches[0].clientY;
        var newHeight = Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, startHeight + delta));
        messages.style.height = newHeight + 'px';
      }, { passive: true });

      document.addEventListener('mouseup', function() {
        if (!dragging) return;
        dragging = false;
        chatBar.style.transition = '';
        document.body.style.userSelect = '';
      });

      document.addEventListener('touchend', function() {
        if (!dragging) return;
        dragging = false;
        chatBar.style.transition = '';
      });
    })();

    // Kill entry animations after they play so they don't replay on DOM updates
    setTimeout(function() {
      var cards = document.querySelectorAll('.glass-card, [style*="animation"]');
      for (var i = 0; i < cards.length; i++) {
        cards[i].style.animation = 'none';
      }
    }, 1500);

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
