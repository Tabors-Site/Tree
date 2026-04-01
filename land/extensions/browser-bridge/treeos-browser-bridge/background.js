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
    socket = io(config.serverUrl, {
      transports: ['websocket'],
      reconnection: true,
      reconnectionDelay: 5000,
      reconnectionAttempts: Infinity,
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

async function getPageStateFromTab(tabId) {
  const id = await getActiveTabId(tabId);
  if (!id) return { error: 'No active tab' };

  try {
    const response = await chrome.tabs.sendMessage(id, {
      type: 'getPageState',
      includeNetwork: true,
    });
    return response;
  } catch (err) {
    return { error: `Failed to get page state: ${err.message}` };
  }
}

async function executeActionInTab(action, tabId) {
  const id = await getActiveTabId(tabId);
  if (!id) return { success: false, error: 'No active tab' };

  try {
    const response = await chrome.tabs.sendMessage(id, {
      type: 'executeAction',
      action,
      recapture: true,
    });
    return response;
  } catch (err) {
    return { success: false, error: `Failed to execute action: ${err.message}` };
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
        const state = await getPageStateFromTab();
        if (socket?.connected) {
          socket.emit('pageState', { requestId: 'manual', data: state });
          sendResponse({ success: true, sent: true });
        } else {
          sendResponse({ success: true, sent: false, state });
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
