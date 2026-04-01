const statusDot = document.getElementById('statusDot');
const logView = document.getElementById('logView');
const treeView = document.getElementById('treeView');
const tabLog = document.getElementById('tabLog');
const tabTree = document.getElementById('tabTree');
let currentView = 'log';
let logStarted = false;

// Tab switching
tabLog.addEventListener('click', () => {
  currentView = 'log';
  logView.style.display = '';
  treeView.style.display = 'none';
  tabLog.classList.add('active');
  tabTree.classList.remove('active');
});

tabTree.addEventListener('click', async () => {
  currentView = 'tree';
  logView.style.display = 'none';
  treeView.style.display = '';
  tabLog.classList.remove('active');
  tabTree.classList.add('active');
  treeView.innerHTML = '<div class="empty-state"><div>Loading...</div></div>';
  chrome.runtime.sendMessage({ type: 'manualCapture' }, (resp) => {
    const state = resp?.state;
    if (state?.error) {
      treeView.innerHTML = `<div class="empty-state"><div>Error</div><div style="font-size:11px">${escHtml(state.error)}</div></div>`;
      return;
    }
    const tree = state?.tree;
    if (tree) {
      treeView.innerHTML = '';
      if (state.url) {
        const header = document.createElement('div');
        header.style.cssText = 'padding:4px 0 8px;font-size:11px;color:#888;border-bottom:1px solid #ffffff10;margin-bottom:8px;';
        header.textContent = state.url;
        treeView.appendChild(header);
      }
      renderTree(Array.isArray(tree) ? tree : [tree]);
    } else {
      treeView.innerHTML = '<div class="empty-state"><div>Could not load page tree</div><div style="font-size:11px">Try refreshing the tab, then click Page Tree again</div></div>';
    }
  });
});

// Manual actions
document.getElementById('sendState').addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'manualCapture' }, () => {
    addLog('state', 'Page state sent');
  });
});

document.getElementById('sendScreenshot').addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'manualScreenshot' }, () => {
    addLog('state', 'Screenshot sent');
  });
});

// Logging
function addLog(type, content) {
  if (!logStarted) {
    logView.innerHTML = '';
    logStarted = true;
  }
  const entry = document.createElement('div');
  entry.className = `log-entry ${type}`;
  const now = new Date().toLocaleTimeString();
  entry.innerHTML = `<div class="log-time">${now}</div><div class="log-content">${content}</div>`;
  logView.appendChild(entry);
  logView.scrollTop = logView.scrollHeight;
}

function addConfirmation(confirmId, description) {
  if (!logStarted) { logView.innerHTML = ''; logStarted = true; }
  const entry = document.createElement('div');
  entry.className = 'log-entry confirm';
  entry.id = `confirm-${confirmId}`;
  const now = new Date().toLocaleTimeString();
  entry.innerHTML = `
    <div class="log-time">${now}</div>
    <div class="log-content">Agent wants to: <code>${description}</code></div>
    <div class="confirm-inline">
      <button class="allow">Allow</button>
      <button class="deny">Deny</button>
    </div>
  `;
  entry.querySelector('.allow').onclick = () => {
    chrome.runtime.sendMessage({ type: 'confirmActionResponse', confirmId, allowed: true });
    entry.querySelector('.confirm-inline').innerHTML = '<span style="color:#40c060">Allowed</span>';
  };
  entry.querySelector('.deny').onclick = () => {
    chrome.runtime.sendMessage({ type: 'confirmActionResponse', confirmId, allowed: false });
    entry.querySelector('.confirm-inline').innerHTML = '<span style="color:#c04040">Denied</span>';
  };
  logView.appendChild(entry);
  logView.scrollTop = logView.scrollHeight;
}

// Tree rendering
function renderTree(nodes, depth) {
  if (depth === undefined) { depth = 0; treeView.innerHTML = ''; }
  for (const node of nodes) {
    const div = document.createElement('div');
    div.className = `tree-node${node.id ? ' interactive' : ''}`;
    div.style.paddingLeft = `${depth * 16}px`;
    let html = `<span class="role">${node.role}</span>`;
    if (node.name) html += ` <span class="name">"${escHtml(node.name.slice(0, 60))}"</span>`;
    if (node.id) html += ` <span class="id">[${node.id}]</span>`;
    div.innerHTML = html;
    treeView.appendChild(div);
    if (node.children) renderTree(node.children, depth + 1);
  }
}

function escHtml(s) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// Clear activity
document.getElementById('clearLog').addEventListener('click', () => {
  logView.innerHTML = '';
  logStarted = false;
});

// Listen for updates
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'stateUpdate') {
    statusDot.className = `status-dot ${msg.connectionState}`;
    if (msg.connectionState === 'connected') {
      addLog('state', `Connected to <code>${msg.config.serverUrl}</code>`);
    } else if (msg.connectionState === 'disconnected') {
      addLog('error', 'Disconnected');
    }
  }

  if (msg.type === 'confirmAction') {
    addConfirmation(msg.confirmId, msg.description);
  }

  if (msg.type === 'activity') {
    const e = msg.entry;
    const type = e.action === 'action' ? 'action' : 'state';
    let desc = '';
    if (e.action === 'getPageState') desc = 'Read page state';
    else if (e.action === 'screenshot') desc = 'Took screenshot';
    else if (e.action === 'action') desc = `<code>${e.details.type}</code> ${e.details.target ? 'on <code>' + escHtml(String(e.details.target)) + '</code>' : ''} ${e.details.success ? '\u2713' : '\u2717'}`;
    else desc = e.action;
    addLog(type, desc);
  }
});

// Initial state + replay activity log
chrome.runtime.sendMessage({ type: 'getState' }, (resp) => {
  if (resp) {
    statusDot.className = `status-dot ${resp.connectionState}`;
    if (resp.connectionState === 'connected') {
      addLog('state', `Connected to <code>${resp.config?.serverUrl || 'server'}</code>`);
    }
  }
});

chrome.runtime.sendMessage({ type: 'getActivityLog' }, (resp) => {
  if (resp?.log?.length) {
    resp.log.forEach(e => {
      const type = e.action === 'action' ? 'action' : 'state';
      let desc = '';
      if (e.action === 'getPageState') desc = 'Read page state';
      else if (e.action === 'screenshot') desc = 'Took screenshot';
      else if (e.action === 'action') desc = `<code>${e.details.type}</code> ${e.details.target ? 'on <code>' + escHtml(String(e.details.target)) + '</code>' : ''} ${e.details.success ? '\u2713' : '\u2717'}`;
      else desc = e.action;
      addLog(type, desc);
    });
  }
});
