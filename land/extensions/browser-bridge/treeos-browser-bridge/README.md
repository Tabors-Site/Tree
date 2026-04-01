# TreeOS Browser Bridge

A Chrome extension that gives your TreeOS AI agent eyes and hands in the browser. It captures the accessibility tree of any page, sends it to your TreeOS land over WebSocket, and executes actions the AI sends back.

## Architecture

```
┌─────────────────────────────────────────┐
│  Chrome Browser                         │
│                                         │
│  ┌──────────────┐   ┌───────────────┐   │
│  │ Content Script│   │  Side Panel   │   │
│  │ (per tab)     │   │  (activity    │   │
│  │               │   │   log, tree   │   │
│  │ • Build a11y  │   │   viewer,     │   │
│  │   tree        │   │   confirm     │   │
│  │ • Execute     │   │   actions)    │   │
│  │   actions     │   └───────┬───────┘   │
│  │ • Intercept   │           │           │
│  │   network     │           │           │
│  └───────┬───────┘           │           │
│          │    chrome.runtime │           │
│          └──────┬────────────┘           │
│                 │                        │
│  ┌──────────────┴──────────────┐         │
│  │     Background Worker       │         │
│  │                             │         │
│  │  • WebSocket to TreeOS      │         │
│  │  • Route messages           │         │
│  │  • Capture screenshots      │         │
│  │  • Tab management           │         │
│  └──────────────┬──────────────┘         │
└─────────────────┼───────────────────────┘
                  │ WebSocket
                  │
┌─────────────────┴───────────────────────┐
│         TreeOS Land                      │
│                                          │
│  /ws/browser-bridge endpoint             │
│  AI conversation loop sees browser       │
│  as MCP tools                            │
└──────────────────────────────────────────┘
```

## Install

1. Open `chrome://extensions`
2. Enable "Developer mode"
3. Click "Load unpacked" and select this folder
4. Click the extension icon, enter your TreeOS server URL and API key
5. Hit Connect

## WebSocket Protocol

The extension connects to `ws(s)://your-land/ws/browser-bridge`.

### Auth (extension → server)

Sent immediately on connection:

```json
{
  "type": "auth",
  "apiKey": "your-api-key",
  "capabilities": ["page_state", "execute_action", "screenshot", "network_log"]
}
```

### Messages the server can send

#### Get page state (accessibility tree)

```json
{
  "type": "getPageState",
  "requestId": "unique-id",
  "tabId": null
}
```

Response:

```json
{
  "type": "pageState",
  "requestId": "unique-id",
  "data": {
    "url": "https://example.com/inbox",
    "title": "Inbox - Email",
    "viewport": { "width": 1440, "height": 900, "scrollY": 0, "scrollHeight": 3200 },
    "timestamp": 1711900000000,
    "tree": [
      {
        "role": "navigation",
        "name": "Main menu",
        "children": [
          { "role": "link", "name": "Inbox", "id": "e1", "href": "/inbox" },
          { "role": "link", "name": "Sent", "id": "e2", "href": "/sent" }
        ]
      },
      {
        "role": "button",
        "name": "Compose",
        "id": "e3"
      },
      {
        "role": "list",
        "name": "Messages",
        "children": [
          { "role": "listitem", "name": "Meeting tomorrow - John", "id": "e4" },
          { "role": "listitem", "name": "Invoice #442 - Acme Corp", "id": "e5" }
        ]
      }
    ],
    "networkRequests": [
      { "type": "fetch", "url": "/api/messages?page=1", "method": "GET", "status": 200, "timestamp": 1711900000000 }
    ]
  }
}
```

The `id` fields (e1, e2, ...) are handles you use to target elements in actions. Only interactive elements get IDs.

#### Execute an action

```json
{
  "type": "executeAction",
  "requestId": "unique-id",
  "tabId": null,
  "action": { "type": "click", "elementId": "e3" }
}
```

Response:

```json
{
  "type": "actionResult",
  "requestId": "unique-id",
  "data": { "success": true, "action": "clicked", "elementId": "e3" }
}
```

#### Available actions

| Action | Fields | Notes |
|--------|--------|-------|
| `click` | `elementId` | Click an interactive element |
| `type` | `elementId`, `text`, `clear?` | Type into an input. `clear` defaults true |
| `keypress` | `key`, `elementId?` | Press a key. Uses active element if no ID |
| `select` | `elementId`, `value` | Select dropdown option by value |
| `scroll` | `direction?`, `amount?` | "up" or "down" (default), amount in px (default 500) |
| `navigate` | `url` | Navigate to a URL |
| `back` | — | Browser back |
| `forward` | — | Browser forward |
| `wait` | `ms?` | Wait N milliseconds (default 1000) |
| `extract` | `elementId?` | Get text content of element or full page |

#### Screenshot

```json
{ "type": "screenshot", "requestId": "unique-id", "tabId": null }
```

Returns a `data:image/png;base64,...` string.

#### Tab management

```json
{ "type": "getTabs", "requestId": "unique-id" }
{ "type": "activateTab", "requestId": "unique-id", "tabId": 123 }
{ "type": "newTab", "requestId": "unique-id", "url": "https://example.com" }
```

### Messages the extension sends unprompted

#### Page navigation

When the active tab finishes loading:

```json
{
  "type": "pageNavigated",
  "tabId": 123,
  "url": "https://example.com/new-page",
  "title": "New Page"
}
```

## TreeOS Integration

On the TreeOS side, you'd implement this as an extension that:

1. Opens a WebSocket endpoint at `/ws/browser-bridge`
2. Registers MCP tools that the AI can call:
   - `browser_getState` → sends `getPageState` to the extension
   - `browser_click` → sends `executeAction` with type `click`
   - `browser_type` → sends `executeAction` with type `type`
   - `browser_navigate` → sends `executeAction` with type `navigate`
   - `browser_screenshot` → sends `screenshot` to the extension
   - `browser_extract` → sends `executeAction` with type `extract`
3. The AI conversation loop sees these as normal tools

Example TreeOS extension skeleton:

```javascript
// extensions/browser-bridge/manifest.js
module.exports = {
  name: 'browser-bridge',
  version: '0.1.0',
  description: 'Bridge to Chrome browser extension',
};
```

```javascript
// extensions/browser-bridge/index.js
module.exports = function init(core) {
  const connections = new Map();
  let requestId = 0;
  const pending = new Map();

  function nextId() { return `br-${++requestId}`; }

  function sendAndWait(ws, msg, timeout = 15000) {
    return new Promise((resolve, reject) => {
      const id = nextId();
      msg.requestId = id;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify(msg));
      setTimeout(() => {
        if (pending.has(id)) {
          pending.delete(id);
          reject(new Error('Browser bridge timeout'));
        }
      }, timeout);
    });
  }

  // Get the active browser connection
  function getConnection() {
    const [first] = connections.values();
    return first || null;
  }

  return {
    socketHandlers: {
      'browser-bridge': {
        onConnection(ws, req) {
          ws.on('message', (raw) => {
            const msg = JSON.parse(raw);

            if (msg.type === 'auth') {
              // Validate API key against core auth
              connections.set(ws, { capabilities: msg.capabilities });
              return;
            }

            // Route responses to pending promises
            if (msg.requestId && pending.has(msg.requestId)) {
              pending.get(msg.requestId).resolve(msg);
              pending.delete(msg.requestId);
            }
          });

          ws.on('close', () => connections.delete(ws));
        }
      }
    },

    tools: [
      {
        name: 'browser_getState',
        description: 'Get the accessibility tree of the current browser page. Returns interactive elements with IDs you can target with other browser tools.',
        parameters: {},
        async execute() {
          const ws = getConnection();
          if (!ws) return { error: 'No browser connected' };
          const resp = await sendAndWait(ws, { type: 'getPageState' });
          return resp.data;
        }
      },
      {
        name: 'browser_click',
        description: 'Click an interactive element by its ID from browser_getState.',
        parameters: {
          elementId: { type: 'string', description: 'Element ID like e1, e2, etc.', required: true }
        },
        async execute({ elementId }) {
          const ws = getConnection();
          if (!ws) return { error: 'No browser connected' };
          const resp = await sendAndWait(ws, {
            type: 'executeAction',
            action: { type: 'click', elementId }
          });
          return resp.data;
        }
      },
      {
        name: 'browser_type',
        description: 'Type text into an input element.',
        parameters: {
          elementId: { type: 'string', required: true },
          text: { type: 'string', required: true },
          clear: { type: 'boolean', description: 'Clear existing content first. Default true.' }
        },
        async execute({ elementId, text, clear }) {
          const ws = getConnection();
          if (!ws) return { error: 'No browser connected' };
          const resp = await sendAndWait(ws, {
            type: 'executeAction',
            action: { type: 'type', elementId, text, clear }
          });
          return resp.data;
        }
      },
      {
        name: 'browser_navigate',
        description: 'Navigate the browser to a URL.',
        parameters: {
          url: { type: 'string', required: true }
        },
        async execute({ url }) {
          const ws = getConnection();
          if (!ws) return { error: 'No browser connected' };
          const resp = await sendAndWait(ws, {
            type: 'executeAction',
            action: { type: 'navigate', url }
          });
          return resp.data;
        }
      },
      {
        name: 'browser_scroll',
        description: 'Scroll the page up or down.',
        parameters: {
          direction: { type: 'string', enum: ['up', 'down'], default: 'down' },
          amount: { type: 'number', description: 'Pixels to scroll. Default 500.' }
        },
        async execute({ direction, amount }) {
          const ws = getConnection();
          if (!ws) return { error: 'No browser connected' };
          const resp = await sendAndWait(ws, {
            type: 'executeAction',
            action: { type: 'scroll', direction, amount }
          });
          return resp.data;
        }
      },
      {
        name: 'browser_extract',
        description: 'Extract text content from the page or a specific element.',
        parameters: {
          elementId: { type: 'string', description: 'Optional element ID. Omit for full page text.' }
        },
        async execute({ elementId }) {
          const ws = getConnection();
          if (!ws) return { error: 'No browser connected' };
          const resp = await sendAndWait(ws, {
            type: 'executeAction',
            action: { type: 'extract', elementId }
          });
          return resp.data;
        }
      },
      {
        name: 'browser_screenshot',
        description: 'Capture a screenshot of the current browser tab.',
        parameters: {},
        async execute() {
          const ws = getConnection();
          if (!ws) return { error: 'No browser connected' };
          const resp = await sendAndWait(ws, { type: 'screenshot' });
          return resp.data;
        }
      },
    ],
  };
};
```

## How the AI Uses It

A typical conversation flow:

```
User: "Book me a table at Nostrana for Friday at 7pm"

AI thinks: I need to navigate to a restaurant booking site.
AI calls: browser_navigate({ url: "https://www.opentable.com" })
AI calls: browser_getState()
AI sees:  [searchbox "Find a restaurant" id=e3] [combobox "Guests" id=e5] [button "Search" id=e8]
AI calls: browser_type({ elementId: "e3", text: "Nostrana Portland" })
AI calls: browser_click({ elementId: "e8" })
AI calls: browser_getState()
AI sees:  [link "Nostrana" id=e12] ...
AI calls: browser_click({ elementId: "e12" })
...continues until booking is confirmed...
AI responds: "Done — table for 2 at Nostrana, Friday 7pm. Confirmation #4821."
```

## Security Notes

- The extension only connects to the server URL you configure
- Action confirmation mode (on by default) requires you to approve each action
- Your existing browser sessions/cookies are used — the AI never sees your passwords
- Network interception only logs URLs and status codes, not request/response bodies
- All communication over WebSocket — use WSS (TLS) in production

## Files

```
treeos-browser-bridge/
├── manifest.json          Chrome extension manifest v3
├── background.js          Service worker — WebSocket bridge
├── popup.html/js          Popup UI — settings, connect/disconnect
├── sidepanel.html         Side panel — activity log, tree viewer, confirmations
├── scripts/
│   └── content.js         Content script — a11y tree builder, action executor
├── icons/
│   └── icon{16,48,128}.png
└── README.md
```
