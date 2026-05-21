# TreeOS Browser Bridge

A Chrome extension that gives your TreeOS AI eyes and hands in the browser. The AI can read pages, click elements, type text, navigate URLs, and post comments. All through the same chat interface.

## Setup

### 1. Install the Chrome Extension

1. Open `chrome://extensions` in Chrome
2. Enable **Developer mode** (top right toggle)
3. Click **Load unpacked**
4. Select this folder (`treeos-browser-bridge/`)
5. The TreeOS Bridge icon appears in your toolbar

### 2. Connect to Your Land

1. Click the TreeOS Bridge icon in Chrome
2. Enter your **Server URL** (e.g. `http://localhost:3000` or `https://your-land.com`)
3. Enter your **Username** and **Password** (or API key if you have one)
4. Click **Connect**
5. The status dot turns green when connected

### 3. Enable Browser Bridge on a Tree Branch

Browser bridge is **confined**. It's inactive everywhere by default. You must explicitly allow it at the tree positions where you want the AI to use the browser.

**CLI:**
```
treeos cd MyTree
treeos ext-allow browser-bridge
```

**Or at a specific branch:**
```
treeos cd MyTree/Web
treeos ext-allow browser-bridge
```

The AI can only use browser tools at positions where you've allowed it. Everywhere else, the browser tools don't exist.

### 4. Set the Browser Agent Mode (Optional)

For best results, set the browser-agent mode on the node where you allowed browser-bridge:

```
treeos mode-set respond tree:browser-agent
```

This makes the AI act on browser requests instead of just describing them.

## Usage

Once connected and allowed, chat at that branch:

```
what's on this page
```
The AI reads the current page via the accessibility tree.

```
click the login button
```
The AI finds the element and clicks it.

```
reply to this post saying "interesting, thanks for sharing"
```
The AI uses the comment tool to find the reply button, type text, and submit.

```
navigate to docs.react.dev
```
The AI opens the URL in your browser.

## Tools Available to the AI

| Tool | Type | Description |
|------|------|-------------|
| `browser-read` | Read | See page URL, title, text content, and interactive elements |
| `browser-click` | Write | Click an element by ID from browser-read |
| `browser-type` | Write | Type text into an input field |
| `browser-navigate` | Write | Go to a URL |
| `browser-comment` | Write | Post a comment/reply (handles full flow automatically) |

## Site Scoping (Optional)

Control which websites the AI can interact with per tree position. Set in node metadata:

```json
{
  "browserBridge": {
    "autoApprove": ["docs.react.dev", "developer.mozilla.org"],
    "alwaysAsk": ["*.bank.com"],
    "blocked": ["facebook.com"]
  }
}
```

- **autoApprove**: Write actions skip approval on these domains
- **alwaysAsk**: Always require approval (even if confirm is off)
- **blocked**: AI cannot see or act on these domains

## Safety Layers

All active by default. Cannot be turned off.

1. **Confined scope**: Off everywhere until `ext-allow`
2. **Site scoping**: Per-node domain allow/block lists
3. **Confirm actions**: Chrome extension toggle. When on, every write action shows a notification asking permission
4. **Read-only in query mode**: `query` mode strips write tools automatically
5. **Activity logging**: Every browser action is logged as a note on the node

## Chrome Extension UI

- **Popup**: Settings, connect/disconnect, status
- **Side Panel**: Activity log (real-time), Page Tree viewer (accessibility tree visualization)
- **Notifications**: Action confirmations when "Confirm actions" is enabled

## Troubleshooting

**"No browser connected"**: The Chrome extension isn't connected. Click the icon and check the status dot. Make sure server URL is correct.

**AI says it can't interact with websites**: Make sure you ran `ext-allow browser-bridge` at the current node AND set `mode-set respond tree:browser-agent`.

**Actions succeed but nothing happens visually**: The AI clicks via JavaScript DOM events, not mouse simulation. The page reacts but you won't see a cursor move.

**Page Tree tab is blank**: Refresh the web page you're viewing, then click Page Tree again. The content script only injects on page load.
