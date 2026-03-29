/**
 * Chat Bar
 *
 * Embeddable chat widget for extension dashboard pages.
 * Floats at the bottom. Input bar, output area, minimize toggle.
 * Uses fetch POST to the extension's route. No WebSocket needed.
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
  `;
}

export function chatBarHtml({ placeholder = "Type a message..." } = {}) {
  return `
    <div class="chat-bar minimized" id="chatBar">
      <div class="chat-bar-toggle" onclick="toggleChatBar()">
        <span class="chat-bar-toggle-label">Chat</span>
        <span class="chat-bar-toggle-icon">▲</span>
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
    function toggleChatBar() {
      document.getElementById('chatBar').classList.toggle('minimized');
      const input = document.getElementById('chatInput');
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

      // Open chat bar if minimized
      document.getElementById('chatBar').classList.remove('minimized');

      appendMessage('user', message);
      var loadingEl = appendMessage('loading', 'Thinking...');

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
      input.focus();
    }
  `;
}
