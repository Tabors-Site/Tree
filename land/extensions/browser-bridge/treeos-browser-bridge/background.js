// TreeOS Browser Bridge — Background Service Worker
// Manages Socket.IO connection to TreeOS and bridges content script <-> server

try {
  importScripts('lib/socket.io.min.js');
} catch (e) {
  console.error('[TreeOS Bridge] Failed to load Socket.IO:', e);
}

let socket = null;
let config = { serverUrl: '', apiKey: '', username: '', password: '', autoCapture: false, confirmActions: true };
let connectionState = 'disconnected'; // disconnected | connecting | connected
let reconnectTimer = null;
let pendingConfirmations = new Map();

// ── Config ────────────────────────────────────────────────────────

async function loadConfig() {
  const stored = await chrome.storage.local.get(['treeos_config']);
  if (stored.treeos_config) {
    config = { ...config, ...stored.treeos_config };
  }
  return config;
}

async function saveConfig(newConfig) {
  config = { ...config, ...newConfig };
  await chrome.storage.local.set({ treeos_config: config });
  broadcastState();
  return config;
}

// ── Socket.IO Connection ─────────────────────────────────────────

function connect() {
  if (!config.serverUrl) {
    updateState('disconnected');
    return;
  }

  if (socket?.connected) return;

  updateState('connecting');

  try {
    // Ensure full URL with protocol for service worker context
    let serverUrl = config.serverUrl;
    if (!serverUrl.startsWith('http://') && !serverUrl.startsWith('https://')) {
      serverUrl = 'http://' + serverUrl;
    }

    socket = io(serverUrl, {
      path: '/socket.io',
      transports: ['websocket'],
      reconnection: true,
      reconnectionDelay: 5000,
      reconnectionAttempts: Infinity,
      forceNew: true,
    });

    socket.on('connect', () => {
      updateState('connected');
      clearReconnectTimer();

      // Authenticate with API key or username/password
      socket.emit('browserAuth', {
        apiKey: config.apiKey || null,
        username: config.username || null,
        password: config.password || null,
        capabilities: ['page_state', 'execute_action', 'screenshot', 'network_log'],
      });
    });

    socket.on('browserAuthResult', (data) => {
      if (data.success) {
        console.log('[TreeOS Bridge] Authenticated');
      } else {
        console.error('[TreeOS Bridge] Auth failed:', data.error);
        disconnect();
      }
    });

    // ── Server requests ──────────────────────────────────────────

    socket.on('getPageState', async (msg) => {
      const state = await getPageStateFromTab(msg.tabId);
      socket.emit('pageState', { requestId: msg.requestId, data: state });
      broadcastActivity('getPageState', { url: state?.url || 'current page' });
    });

    socket.on('executeAction', async (msg) => {
      // If confirmation required, hold and ask user
      if (config.confirmActions && !msg.confirmed) {
        const confirmId = crypto.randomUUID();
        pendingConfirmations.set(confirmId, msg);

        chrome.runtime.sendMessage({
          type: 'confirmAction',
          confirmId,
          action: msg.action,
          description: describeAction(msg.action),
        }).catch(() => {});

        chrome.notifications?.create(confirmId, {
          type: 'basic',
          iconUrl: 'icons/icon128.png',
          title: 'TreeOS Agent Action',
          message: describeAction(msg.action),
          buttons: [{ title: 'Allow' }, { title: 'Deny' }],
          requireInteraction: true,
        }).catch(() => {});

        return;
      }

      const result = await executeActionInTab(msg.action, msg.tabId);
      socket.emit('actionResult', { requestId: msg.requestId, data: result });
      broadcastActivity('action', { type: msg.action.type, target: msg.action.elementId || msg.action.url || '', success: result.success });

      // Auto-capture new state after action
      if (result.success && config.autoCapture) {
        await new Promise(r => setTimeout(r, 500));
        const newState = await getPageStateFromTab(msg.tabId);
        socket.emit('pageState', { requestId: msg.requestId + '_post', data: newState });
      }
    });

    socket.on('screenshot', async (msg) => {
      const dataUrl = await captureScreenshot(msg.tabId);
      socket.emit('screenshot', { requestId: msg.requestId, data: dataUrl });
      broadcastActivity('screenshot', {});
    });

    socket.on('getNetworkLog', async (msg) => {
      const log = await getNetworkLogFromTab(msg.tabId);
      socket.emit('networkLog', { requestId: msg.requestId, data: log });
    });

    socket.on('getTabs', async (msg) => {
      const tabs = await chrome.tabs.query({ currentWindow: true });
      const tabData = tabs.map(t => ({
        id: t.id, url: t.url, title: t.title, active: t.active,
      }));
      socket.emit('tabsList', { requestId: msg.requestId, data: tabData });
    });

    socket.on('activateTab', async (msg) => {
      await chrome.tabs.update(msg.tabId, { active: true });
      socket.emit('tabActivated', { requestId: msg.requestId, tabId: msg.tabId });
    });

    socket.on('newTab', async (msg) => {
      const tab = await chrome.tabs.create({ url: msg.url || 'about:blank' });
      socket.emit('tabCreated', { requestId: msg.requestId, tabId: tab.id });
    });

    socket.on('ping', (msg) => {
      socket.emit('pong', { requestId: msg.requestId });
    });

    // ── Connection lifecycle ─────────────────────────────────────

    socket.on('disconnect', (reason) => {
      updateState('disconnected');
      if (reason !== 'io client disconnect') {
        // Auto-reconnect handled by Socket.IO
      }
    });

    socket.on('connect_error', (err) => {
      console.error('[TreeOS Bridge] Connection error:', err.message);
      updateState('disconnected');
    });

    socket.on('browserDisconnected', (data) => {
      console.log('[TreeOS Bridge] Disconnected by server:', data?.reason);
    });

  } catch (err) {
    console.error('[TreeOS Bridge] Connection failed:', err);
    updateState('disconnected');
    scheduleReconnect();
  }
}

function disconnect() {
  clearReconnectTimer();
  if (socket) {
    socket.disconnect();
    socket = null;
  }
  updateState('disconnected');
}

function scheduleReconnect() {
  clearReconnectTimer();
  reconnectTimer = setTimeout(() => connect(), 5000);
}

function clearReconnectTimer() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
}

// ── Content Script Communication ──────────────────────────────────

async function getActiveTabId(preferredTabId) {
  if (preferredTabId) return preferredTabId;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab?.id;
}

/**
 * Ensure content script is injected in the tab.
 * SPAs (x.com, reddit) destroy the content script context on navigation.
 * Re-inject before every message to handle this.
 */
async function ensureContentScript(tabId) {
  try {
    await chrome.tabs.sendMessage(tabId, { type: 'ping' });
  } catch {
    // Content script not responding. Re-inject.
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ['scripts/content.js'],
      });
      // Give it a moment to initialize
      await new Promise(r => setTimeout(r, 200));
    } catch (err) {
      console.warn('[TreeOS Bridge] Cannot inject content script:', err.message);
    }
  }
}

async function getPageStateFromTab(tabId) {
  const id = await getActiveTabId(tabId);
  if (!id) return { error: 'No active tab' };

  await ensureContentScript(id);

  try {
    const response = await chrome.tabs.sendMessage(id, {
      type: 'getPageState',
      includeNetwork: true,
    });
    return response;
  } catch (err) {
    // Content script failed (hostile site like x.com). Fall back to
    // chrome.scripting.executeScript which runs in the isolated world.
    try {
      const [result] = await chrome.scripting.executeScript({
        target: { tabId: id },
        world: 'ISOLATED',
        func: () => {
          // Minimal page state capture without full tree builder
          const getText = (el, max) => (el?.textContent || '').trim().slice(0, max);
          const links = [...document.querySelectorAll('a[href]')].slice(0, 50).map((a, i) => ({
            role: 'link', name: getText(a, 100), id: 'e' + (i + 1), href: a.href,
          }));
          const buttons = [...document.querySelectorAll('button')].slice(0, 30).map((b, i) => ({
            role: 'button', name: getText(b, 100), id: 'b' + (i + 1),
          }));
          const inputs = [...document.querySelectorAll('input, textarea, [contenteditable="true"]')].slice(0, 20).map((el, i) => ({
            role: el.tagName === 'TEXTAREA' ? 'textbox' : (el.type || 'input'),
            name: el.placeholder || el.name || '',
            id: 'i' + (i + 1),
          }));
          const bodyText = document.body?.innerText?.slice(0, 8000) || '';
          return {
            url: location.href,
            title: document.title,
            tree: [...links, ...buttons, ...inputs],
            text: bodyText,
            viewport: {
              width: window.innerWidth,
              height: window.innerHeight,
              scrollY: window.scrollY,
              scrollHeight: document.documentElement.scrollHeight,
            },
            timestamp: Date.now(),
            fallback: true,
          };
        },
      });
      return result?.result || { error: 'Fallback capture failed' };
    } catch (err2) {
      return { error: `Page state failed: ${err2.message}` };
    }
  }
}

async function executeActionInTab(action, tabId) {
  const id = await getActiveTabId(tabId);
  if (!id) return { success: false, error: 'No active tab' };

  // Navigate uses Chrome tab API directly. Bypasses hostile SPA routers (x.com, etc.)
  // that intercept window.location changes inside the content script.
  if (action.type === 'navigate' && action.url) {
    try {
      await chrome.tabs.update(id, { url: action.url });
      // Wait for page to load
      await new Promise(resolve => {
        const listener = (tabId2, changeInfo) => {
          if (tabId2 === id && changeInfo.status === 'complete') {
            chrome.tabs.onUpdated.removeListener(listener);
            resolve();
          }
        };
        chrome.tabs.onUpdated.addListener(listener);
        // Timeout after 10s
        setTimeout(() => {
          chrome.tabs.onUpdated.removeListener(listener);
          resolve();
        }, 10000);
      });
      return { success: true, action: 'navigated', url: action.url };
    } catch (err) {
      return { success: false, error: `Navigate failed: ${err.message}` };
    }
  }

  await ensureContentScript(id);

  try {
    const response = await chrome.tabs.sendMessage(id, {
      type: 'executeAction',
      action,
      recapture: true,
    });
    return response;
  } catch (err) {
    // Content script failed. Fall back to chrome.scripting for hostile sites.
    try {
      const [result] = await chrome.scripting.executeScript({
        target: { tabId: id },
        world: 'ISOLATED',
        args: [action],
        func: (action) => {
          function findEl(id) {
            if (!id) return null;
            // Try by our assigned IDs from the fallback page state
            const prefix = id.charAt(0);
            const idx = parseInt(id.slice(1)) - 1;
            if (prefix === 'e') return document.querySelectorAll('a[href]')[idx];
            if (prefix === 'b') return document.querySelectorAll('button')[idx];
            if (prefix === 'i') return document.querySelectorAll('input, textarea, [contenteditable="true"]')[idx];
            return null;
          }

          switch (action.type) {
            case 'click': {
              const el = findEl(action.elementId);
              if (!el) return { success: false, error: 'Element not found: ' + action.elementId };
              el.scrollIntoView({ behavior: 'instant', block: 'center' });
              el.focus();
              el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
              return { success: true, action: 'clicked', elementId: action.elementId };
            }

            case 'type': {
              // Find contenteditable or textarea
              let el = findEl(action.elementId);
              if (!el) {
                // Try to find any visible contenteditable or textarea
                const all = document.querySelectorAll('[contenteditable="true"], textarea, [role="textbox"]');
                for (const candidate of all) {
                  const r = candidate.getBoundingClientRect();
                  if (r.height > 20 && r.width > 50) { el = candidate; break; }
                }
              }
              if (!el) return { success: false, error: 'No text input found' };

              el.scrollIntoView({ behavior: 'instant', block: 'center' });
              el.focus();

              // Clear and type
              if (el.contentEditable === 'true' || el.getAttribute('role') === 'textbox') {
                el.textContent = '';
                // Use DataTransfer for paste simulation (bypasses React interception)
                const dt = new DataTransfer();
                dt.setData('text/plain', action.text);
                const pasteEvent = new ClipboardEvent('paste', {
                  bubbles: true, cancelable: true, clipboardData: dt,
                });
                el.dispatchEvent(pasteEvent);
                // Fallback: direct insert
                if (!el.textContent.includes(action.text)) {
                  el.textContent = action.text;
                  el.dispatchEvent(new Event('input', { bubbles: true }));
                }
              } else {
                el.value = action.text;
                el.dispatchEvent(new Event('input', { bubbles: true }));
                el.dispatchEvent(new Event('change', { bubbles: true }));
              }
              return { success: true, action: 'typed', text: action.text };
            }

            case 'comment': {
              const text = action.text;
              if (!text) return { success: false, error: 'text required' };

              // Find compose box
              const all = document.querySelectorAll('[contenteditable="true"], textarea, [role="textbox"]');
              let textbox = null;
              for (const el of all) {
                const r = el.getBoundingClientRect();
                if (r.height > 20 && r.width > 50) { textbox = el; break; }
              }
              if (!textbox) return { success: false, error: 'No compose box found' };

              textbox.focus();
              // Paste simulation
              const dt = new DataTransfer();
              dt.setData('text/plain', text);
              textbox.dispatchEvent(new ClipboardEvent('paste', {
                bubbles: true, cancelable: true, clipboardData: dt,
              }));
              if (!textbox.textContent?.includes(text)) {
                textbox.textContent = text;
                textbox.dispatchEvent(new Event('input', { bubbles: true }));
              }

              // Find and click post/submit button
              const buttons = document.querySelectorAll('button');
              const submitWords = ['post', 'tweet', 'reply', 'send', 'submit', 'comment', 'save'];
              let submitBtn = null;
              for (const btn of buttons) {
                const t = (btn.textContent || btn.ariaLabel || '').trim().toLowerCase();
                if (submitWords.some(w => t.includes(w))) {
                  if (btn.offsetParent !== null) { submitBtn = btn; break; }
                }
              }

              if (submitBtn) {
                // Wait for React to process the input
                return new Promise(resolve => {
                  setTimeout(() => {
                    submitBtn.click();
                    resolve({ success: true, action: 'commented', submitted: true, text });
                  }, 500);
                });
              }

              return { success: true, action: 'typed', submitted: false, text, error: 'Typed but could not find submit button' };
            }

            case 'extract': {
              const el = action.elementId ? findEl(action.elementId) : document.body;
              return { success: true, text: (el?.innerText || '').slice(0, 8000) };
            }

            default:
              return { success: false, error: 'Unsupported fallback action: ' + action.type };
          }
        },
      });
      return result?.result || { success: false, error: 'Fallback action failed' };
    } catch (err2) {
      return { success: false, error: `Action failed: ${err2.message}` };
    }
  }
}

async function captureScreenshot(tabId) {
  const id = await getActiveTabId(tabId);
  if (id) await chrome.tabs.update(id, { active: true });

  try {
    const dataUrl = await chrome.tabs.captureVisibleTab(null, {
      format: 'png',
      quality: 80,
    });
    return dataUrl;
  } catch (err) {
    return { error: err.message };
  }
}

async function getNetworkLogFromTab(tabId) {
  const id = await getActiveTabId(tabId);
  if (!id) return { error: 'No active tab' };

  try {
    return await chrome.tabs.sendMessage(id, { type: 'getNetworkLog' });
  } catch (err) {
    return { error: err.message };
  }
}

// ── Action Descriptions (for confirmation UI) ─────────────────────

function describeAction(action) {
  switch (action.type) {
    case 'click': return `Click element ${action.elementId}`;
    case 'type': return `Type "${action.text}" into ${action.elementId}`;
    case 'navigate': return `Navigate to ${action.url}`;
    case 'select': return `Select "${action.value}" in ${action.elementId}`;
    case 'scroll': return `Scroll ${action.direction || 'down'}`;
    case 'keypress': return `Press ${action.key}`;
    case 'back': return 'Go back';
    case 'forward': return 'Go forward';
    case 'extract': return 'Extract page text';
    default: return `${action.type} action`;
  }
}

// ── Activity Log ──────────────────────────────────────────────

let activityLog = [];
const MAX_ACTIVITY = 50;

function broadcastActivity(action, details) {
  const entry = { action, details, time: new Date().toISOString() };
  activityLog.push(entry);
  if (activityLog.length > MAX_ACTIVITY) activityLog.shift();
  chrome.runtime.sendMessage({ type: 'activity', entry, log: activityLog }).catch(() => {});
}

// ── State Broadcasting ────────────────────────────────────────────

function updateState(state) {
  connectionState = state;
  broadcastState();
}

function broadcastState() {
  chrome.runtime.sendMessage({
    type: 'stateUpdate',
    connectionState,
    config: { ...config, apiKey: config.apiKey ? '••••' : '' },
  }).catch(() => {});
}

// ── Internal Message Handler (from popup / side panel) ────────────

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    switch (msg.type) {
      case 'getState': {
        sendResponse({
          connectionState,
          config: { ...config, apiKey: config.apiKey ? '••••' : '' },
        });
        break;
      }

      case 'getActivityLog': {
        sendResponse({ log: activityLog });
        break;
      }

      case 'saveConfig': {
        const updated = await saveConfig(msg.config);
        sendResponse({ success: true, config: updated });
        break;
      }

      case 'connect': {
        await loadConfig();
        connect();
        sendResponse({ success: true });
        break;
      }

      case 'disconnect': {
        disconnect();
        sendResponse({ success: true });
        break;
      }

      case 'confirmActionResponse': {
        const pending = pendingConfirmations.get(msg.confirmId);
        if (pending) {
          pendingConfirmations.delete(msg.confirmId);
          if (msg.allowed) {
            // Re-dispatch with confirmed flag
            const result = await executeActionInTab(pending.action, pending.tabId);
            socket?.emit('actionResult', { requestId: pending.requestId, data: result });
          } else {
            socket?.emit('actionResult', {
              requestId: pending.requestId,
              data: { success: false, error: 'User denied action' },
            });
          }
        }
        sendResponse({ success: true });
        break;
      }

      case 'manualCapture': {
        console.log('[TreeOS Bridge] manualCapture requested');
        try {
          const state = await getPageStateFromTab();
          console.log('[TreeOS Bridge] manualCapture result:', state?.error || `tree: ${!!state?.tree}, url: ${state?.url}`);
          if (socket?.connected) {
            socket.emit('pageState', { requestId: 'manual', data: state });
          }
          sendResponse({ success: true, sent: !!socket?.connected, state });
        } catch (err) {
          console.error('[TreeOS Bridge] manualCapture error:', err);
          sendResponse({ success: false, state: { error: err.message } });
        }
        break;
      }

      case 'manualScreenshot': {
        const dataUrl = await captureScreenshot();
        if (socket?.connected) {
          socket.emit('screenshot', { requestId: 'manual', data: dataUrl });
          sendResponse({ success: true, sent: true });
        } else {
          sendResponse({ success: true, sent: false });
        }
        break;
      }

      default:
        sendResponse({ error: 'Unknown message type' });
    }
  })();
  return true;
});

// ── Notification Button Handler ───────────────────────────────────

chrome.notifications?.onButtonClicked?.addListener((notifId, buttonIndex) => {
  chrome.runtime.sendMessage({
    type: 'confirmActionResponse',
    confirmId: notifId,
    allowed: buttonIndex === 0,
  }).catch(() => {});
  chrome.notifications.clear(notifId);
});

// ── Tab Navigation Listener (auto-report URL changes) ─────────────

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === 'complete' && connectionState === 'connected') {
    chrome.tabs.get(tabId).then(tab => {
      if (tab.active) {
        socket?.emit('pageNavigated', {
          tabId,
          url: tab.url,
          title: tab.title,
        });
      }
    }).catch(() => {});
  }
});

// ── Side Panel Behavior ───────────────────────────────────────────

chrome.sidePanel?.setPanelBehavior?.({ openPanelOnActionClick: false }).catch(() => {});

// ── Boot ──────────────────────────────────────────────────────────

loadConfig().then(() => {
  if (config.serverUrl && config.apiKey) {
    connect();
  }
});
