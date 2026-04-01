const $ = id => document.getElementById(id);

const statusDot = $('statusDot');
const statusBar = $('statusBar');
const serverUrl = $('serverUrl');
const apiKey = $('apiKey');
const confirmActions = $('confirmActions');
const autoCapture = $('autoCapture');
const connectBtn = $('connectBtn');
const disconnectBtn = $('disconnectBtn');
const connectedActions = $('connectedActions');
const confirmations = $('confirmations');

function updateUI(state) {
  const { connectionState, config } = state;

  statusDot.className = `status-dot ${connectionState}`;
  statusBar.textContent = connectionState === 'connected'
    ? `Connected to ${config.serverUrl}`
    : connectionState === 'connecting'
    ? 'Connecting...'
    : 'Not connected';

  connectBtn.style.display = connectionState === 'connected' ? 'none' : '';
  disconnectBtn.style.display = connectionState === 'connected' ? '' : 'none';
  connectedActions.style.display = connectionState === 'connected' ? '' : 'none';

  if (config.serverUrl && !serverUrl.value) serverUrl.value = config.serverUrl;
  confirmActions.checked = config.confirmActions !== false;
  autoCapture.checked = !!config.autoCapture;
}

// Load initial state
chrome.runtime.sendMessage({ type: 'getState' }, (response) => {
  if (response) updateUI(response);
});

// Load saved config
chrome.storage.local.get(['treeos_config'], (result) => {
  if (result.treeos_config) {
    serverUrl.value = result.treeos_config.serverUrl || '';
    apiKey.value = result.treeos_config.apiKey || '';
    confirmActions.checked = result.treeos_config.confirmActions !== false;
    autoCapture.checked = !!result.treeos_config.autoCapture;
  }
});

// Save config
$('saveBtn').addEventListener('click', () => {
  chrome.runtime.sendMessage({
    type: 'saveConfig',
    config: {
      serverUrl: serverUrl.value.replace(/\/+$/, ''),
      apiKey: apiKey.value,
      confirmActions: confirmActions.checked,
      autoCapture: autoCapture.checked,
    },
  }, (resp) => {
    statusBar.textContent = 'Settings saved';
    setTimeout(() => chrome.runtime.sendMessage({ type: 'getState' }, updateUI), 1000);
  });
});

// Connect
connectBtn.addEventListener('click', () => {
  // Save first, then connect
  chrome.runtime.sendMessage({
    type: 'saveConfig',
    config: {
      serverUrl: serverUrl.value.replace(/\/+$/, ''),
      apiKey: apiKey.value,
      confirmActions: confirmActions.checked,
      autoCapture: autoCapture.checked,
    },
  }, () => {
    chrome.runtime.sendMessage({ type: 'connect' });
  });
});

// Disconnect
disconnectBtn.addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'disconnect' });
});

// Manual capture
$('captureBtn').addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'manualCapture' }, (resp) => {
    statusBar.textContent = resp?.sent ? 'Page state sent' : 'Captured (not connected)';
  });
});

// Screenshot
$('screenshotBtn').addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'manualScreenshot' }, (resp) => {
    statusBar.textContent = resp?.sent ? 'Screenshot sent' : 'Captured (not connected)';
  });
});

// Open side panel
$('openPanelBtn').addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab) {
    chrome.sidePanel.open({ tabId: tab.id });
    window.close();
  }
});

// Listen for state updates
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'stateUpdate') {
    updateUI(msg);
  }

  if (msg.type === 'confirmAction') {
    const card = document.createElement('div');
    card.className = 'confirm-card';
    card.innerHTML = `
      <p>${msg.description}</p>
      <div class="confirm-buttons">
        <button class="btn-primary allow-btn">Allow</button>
        <button class="btn-danger deny-btn">Deny</button>
      </div>
    `;
    card.querySelector('.allow-btn').onclick = () => {
      chrome.runtime.sendMessage({ type: 'confirmActionResponse', confirmId: msg.confirmId, allowed: true });
      card.remove();
    };
    card.querySelector('.deny-btn').onclick = () => {
      chrome.runtime.sendMessage({ type: 'confirmActionResponse', confirmId: msg.confirmId, allowed: false });
      card.remove();
    };
    confirmations.appendChild(card);
  }
});
