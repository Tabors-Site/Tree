// TreeOS Browser Bridge — Content Script
// Runs in every page. Captures accessibility tree, executes agent actions.

(() => {
  const INTERACTIVE_ROLES = new Set([
    'button', 'link', 'textbox', 'searchbox', 'checkbox', 'radio',
    'combobox', 'listbox', 'option', 'menuitem', 'tab', 'switch',
    'slider', 'spinbutton', 'scrollbar', 'menu', 'menubar',
    'tree', 'treeitem', 'gridcell', 'row', 'columnheader', 'rowheader'
  ]);

  const INTERACTIVE_TAGS = new Set([
    'A', 'BUTTON', 'INPUT', 'SELECT', 'TEXTAREA', 'DETAILS', 'SUMMARY'
  ]);

  const SKIP_TAGS = new Set([
    'SCRIPT', 'STYLE', 'NOSCRIPT', 'SVG', 'PATH', 'META', 'LINK', 'BR', 'HR'
  ]);

  // Element registry — maps short IDs to DOM elements for action execution
  let elementRegistry = new Map();
  let nextId = 1;

  function resetRegistry() {
    elementRegistry.clear();
    nextId = 1;
  }

  function registerId(el) {
    const id = `e${nextId++}`;
    elementRegistry.set(id, el);
    return id;
  }

  // ── Accessibility Tree Builder ──────────────────────────────────

  function getRole(el) {
    // Explicit ARIA role
    const ariaRole = el.getAttribute('role');
    if (ariaRole) return ariaRole;

    // Implicit role from tag
    const tag = el.tagName;
    const type = el.getAttribute('type');

    const implicitRoles = {
      'A': el.hasAttribute('href') ? 'link' : null,
      'BUTTON': 'button',
      'INPUT': {
        'checkbox': 'checkbox', 'radio': 'radio', 'range': 'slider',
        'search': 'searchbox', 'submit': 'button', 'reset': 'button',
        'text': 'textbox', 'email': 'textbox', 'password': 'textbox',
        'tel': 'textbox', 'url': 'textbox', 'number': 'spinbutton',
      }[type] || 'textbox',
      'SELECT': 'combobox',
      'TEXTAREA': 'textbox',
      'H1': 'heading', 'H2': 'heading', 'H3': 'heading',
      'H4': 'heading', 'H5': 'heading', 'H6': 'heading',
      'NAV': 'navigation',
      'MAIN': 'main',
      'HEADER': 'banner',
      'FOOTER': 'contentinfo',
      'ASIDE': 'complementary',
      'FORM': 'form',
      'TABLE': 'table',
      'UL': 'list', 'OL': 'list',
      'LI': 'listitem',
      'IMG': 'img',
      'DETAILS': 'group',
      'SUMMARY': 'button',
      'DIALOG': 'dialog',
    };

    const role = implicitRoles[tag];
    if (typeof role === 'string') return role;
    return null;
  }

  function getAccessibleName(el) {
    // aria-label takes priority
    const ariaLabel = el.getAttribute('aria-label');
    if (ariaLabel) return ariaLabel.trim();

    // aria-labelledby
    const labelledBy = el.getAttribute('aria-labelledby');
    if (labelledBy) {
      const names = labelledBy.split(/\s+/).map(id => {
        const ref = document.getElementById(id);
        return ref ? ref.textContent.trim() : '';
      }).filter(Boolean);
      if (names.length) return names.join(' ');
    }

    // Associated label (for inputs)
    if (el.id) {
      const label = document.querySelector(`label[for="${el.id}"]`);
      if (label) return label.textContent.trim();
    }

    // Closest wrapping label
    const parentLabel = el.closest('label');
    if (parentLabel && parentLabel !== el) {
      // Get label text excluding the input's own text
      const clone = parentLabel.cloneNode(true);
      clone.querySelectorAll('input,select,textarea').forEach(c => c.remove());
      const text = clone.textContent.trim();
      if (text) return text;
    }

    // Title attribute
    const title = el.getAttribute('title');
    if (title) return title.trim();

    // Alt text for images
    if (el.tagName === 'IMG') return el.getAttribute('alt')?.trim() || '';

    // Placeholder for inputs
    const placeholder = el.getAttribute('placeholder');
    if (placeholder) return placeholder.trim();

    // Value for inputs
    if (el.tagName === 'INPUT' && el.value) return el.value.trim();

    // Direct text content (only for leaf-ish elements)
    const directText = getDirectText(el);
    if (directText) return directText;

    return '';
  }

  function getDirectText(el) {
    // Get just this element's direct text, not deeply nested text
    let text = '';
    for (const child of el.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) {
        text += child.textContent;
      }
    }
    return text.trim().slice(0, 200);
  }

  function isVisible(el) {
    if (!el.offsetParent && el.tagName !== 'BODY' && el.tagName !== 'HTML') {
      // Could be position:fixed or visibility trick
      const style = getComputedStyle(el);
      if (style.display === 'none') return false;
      if (style.visibility === 'hidden') return false;
      if (style.position !== 'fixed' && style.position !== 'sticky') return false;
    }
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return false;
    return true;
  }

  function isInteractive(el) {
    if (INTERACTIVE_TAGS.has(el.tagName)) return true;
    if (el.getAttribute('role') && INTERACTIVE_ROLES.has(el.getAttribute('role'))) return true;
    if (el.getAttribute('onclick') || el.getAttribute('tabindex')) return true;
    if (el.contentEditable === 'true') return true;

    // Check for click listeners heuristic — elements with cursor:pointer
    const style = getComputedStyle(el);
    if (style.cursor === 'pointer') return true;

    return false;
  }

  function getElementState(el) {
    const state = {};
    if (el.disabled) state.disabled = true;
    if (el.checked) state.checked = true;
    if (el.getAttribute('aria-expanded')) state.expanded = el.getAttribute('aria-expanded') === 'true';
    if (el.getAttribute('aria-selected')) state.selected = el.getAttribute('aria-selected') === 'true';
    if (el.getAttribute('aria-pressed')) state.pressed = el.getAttribute('aria-pressed') === 'true';
    if (el.getAttribute('aria-hidden') === 'true') state.hidden = true;
    if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
      state.value = el.value || '';
    }
    if (el.tagName === 'SELECT') {
      state.value = el.value || '';
      state.options = Array.from(el.options).map(o => ({ value: o.value, text: o.text, selected: o.selected }));
    }
    return Object.keys(state).length ? state : null;
  }

  function buildTree(root, depth = 0, maxDepth = 25) {
    if (depth > maxDepth) return null;

    const nodes = [];

    for (const child of root.children || []) {
      if (!child.tagName) continue;
      if (SKIP_TAGS.has(child.tagName)) continue;
      if (!isVisible(child)) continue;

      const role = getRole(child);
      const interactive = isInteractive(child);
      const name = getAccessibleName(child);

      let node = null;

      if (interactive || role) {
        node = { role: role || child.tagName.toLowerCase() };
        if (name) node.name = name;
        if (interactive) node.id = registerId(child);

        const state = getElementState(child);
        if (state) node.state = state;

        // Get link href
        if (child.tagName === 'A' && child.href) {
          node.href = child.href;
        }
      }

      // Recurse into children
      const childNodes = buildTree(child, depth + 1, maxDepth);

      if (node) {
        if (childNodes.length) node.children = childNodes;
        nodes.push(node);
      } else if (childNodes.length) {
        // Flatten — skip this container, promote children
        nodes.push(...childNodes);
      } else if (name && (!child.children || child.children.length === 0)) {
        // Leaf text node worth including
        const textContent = child.textContent.trim();
        if (textContent.length > 1 && textContent.length < 500) {
          nodes.push({ role: 'text', name: textContent.slice(0, 200) });
        }
      }
    }

    return nodes;
  }

  function capturePageState() {
    resetRegistry();

    const tree = buildTree(document.body);

    // Gather some metadata
    const state = {
      url: location.href,
      title: document.title,
      tree: tree,
      viewport: {
        width: window.innerWidth,
        height: window.innerHeight,
        scrollY: window.scrollY,
        scrollHeight: document.documentElement.scrollHeight,
      },
      timestamp: Date.now(),
    };

    return state;
  }

  // ── Action Executor ─────────────────────────────────────────────

  function simulateClick(el) {
    el.scrollIntoView({ behavior: 'instant', block: 'center' });
    el.focus();
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
  }

  function simulateType(el, text, clear = true) {
    el.scrollIntoView({ behavior: 'instant', block: 'center' });
    el.focus();

    if (clear) {
      el.value = '';
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }

    // Set value directly and dispatch events
    el.value = text;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function simulateKeyPress(el, key) {
    el.focus();
    const opts = { key, bubbles: true, cancelable: true };
    el.dispatchEvent(new KeyboardEvent('keydown', opts));
    el.dispatchEvent(new KeyboardEvent('keypress', opts));
    el.dispatchEvent(new KeyboardEvent('keyup', opts));
  }

  async function executeAction(action) {
    try {
      switch (action.type) {
        case 'click': {
          const el = elementRegistry.get(action.elementId);
          if (!el) return { success: false, error: `Element ${action.elementId} not found` };
          simulateClick(el);
          return { success: true, action: 'clicked', elementId: action.elementId };
        }

        case 'type': {
          const el = elementRegistry.get(action.elementId);
          if (!el) return { success: false, error: `Element ${action.elementId} not found` };
          simulateType(el, action.text, action.clear !== false);
          return { success: true, action: 'typed', elementId: action.elementId };
        }

        case 'keypress': {
          const el = action.elementId
            ? elementRegistry.get(action.elementId)
            : document.activeElement;
          if (!el) return { success: false, error: 'No target element' };
          simulateKeyPress(el, action.key);
          return { success: true, action: 'keypress', key: action.key };
        }

        case 'select': {
          const el = elementRegistry.get(action.elementId);
          if (!el) return { success: false, error: `Element ${action.elementId} not found` };
          el.value = action.value;
          el.dispatchEvent(new Event('change', { bubbles: true }));
          return { success: true, action: 'selected', value: action.value };
        }

        case 'scroll': {
          const amount = action.amount || 500;
          const direction = action.direction || 'down';
          const y = direction === 'up' ? -amount : amount;
          window.scrollBy({ top: y, behavior: 'smooth' });
          return { success: true, action: 'scrolled', direction, amount };
        }

        case 'navigate': {
          window.location.href = action.url;
          return { success: true, action: 'navigated', url: action.url };
        }

        case 'back': {
          history.back();
          return { success: true, action: 'back' };
        }

        case 'forward': {
          history.forward();
          return { success: true, action: 'forward' };
        }

        case 'wait': {
          await new Promise(r => setTimeout(r, action.ms || 1000));
          return { success: true, action: 'waited', ms: action.ms || 1000 };
        }

        case 'extract': {
          // Extract text content from the page or a specific element
          if (action.elementId) {
            const el = elementRegistry.get(action.elementId);
            if (!el) return { success: false, error: `Element ${action.elementId} not found` };
            return { success: true, text: el.textContent.trim() };
          }
          // Extract all visible text
          const text = document.body.innerText.slice(0, 10000);
          return { success: true, text };
        }

        case 'screenshot': {
          // Content scripts can't take screenshots — delegate to background
          return { success: false, error: 'screenshot must be handled by background script' };
        }

        default:
          return { success: false, error: `Unknown action type: ${action.type}` };
      }
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  // ── Network Interception (optional) ─────────────────────────────

  const interceptedRequests = [];
  const MAX_INTERCEPTED = 50;

  function installNetworkInterceptor() {
    // Intercept fetch
    const originalFetch = window.fetch;
    window.fetch = async function (...args) {
      const req = args[0];
      const url = typeof req === 'string' ? req : req?.url;
      const method = args[1]?.method || (typeof req === 'object' ? req.method : 'GET');

      const entry = {
        type: 'fetch',
        url, method,
        timestamp: Date.now(),
      };

      try {
        const response = await originalFetch.apply(this, args);
        entry.status = response.status;
        interceptedRequests.push(entry);
        if (interceptedRequests.length > MAX_INTERCEPTED) interceptedRequests.shift();
        return response;
      } catch (err) {
        entry.error = err.message;
        interceptedRequests.push(entry);
        if (interceptedRequests.length > MAX_INTERCEPTED) interceptedRequests.shift();
        throw err;
      }
    };

    // Intercept XMLHttpRequest
    const originalOpen = XMLHttpRequest.prototype.open;
    const originalSend = XMLHttpRequest.prototype.send;

    XMLHttpRequest.prototype.open = function (method, url) {
      this._intercepted = { method, url, timestamp: Date.now(), type: 'xhr' };
      return originalOpen.apply(this, arguments);
    };

    XMLHttpRequest.prototype.send = function () {
      if (this._intercepted) {
        this.addEventListener('load', () => {
          this._intercepted.status = this.status;
          interceptedRequests.push(this._intercepted);
          if (interceptedRequests.length > MAX_INTERCEPTED) interceptedRequests.shift();
        });
      }
      return originalSend.apply(this, arguments);
    };
  }

  // ── Message Handler ─────────────────────────────────────────────

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    (async () => {
      switch (msg.type) {
        case 'getPageState': {
          const state = capturePageState();
          // Include intercepted network calls if requested
          if (msg.includeNetwork) {
            state.networkRequests = [...interceptedRequests];
          }
          sendResponse(state);
          break;
        }

        case 'executeAction': {
          // If page state is stale, recapture before executing
          if (msg.recapture) capturePageState();
          const result = await executeAction(msg.action);
          sendResponse(result);
          break;
        }

        case 'getNetworkLog': {
          sendResponse({ requests: [...interceptedRequests] });
          break;
        }

        case 'installInterceptor': {
          installNetworkInterceptor();
          sendResponse({ success: true });
          break;
        }

        case 'ping': {
          sendResponse({ alive: true, url: location.href });
          break;
        }

        default:
          sendResponse({ error: 'Unknown message type' });
      }
    })();
    return true; // Keep channel open for async response
  });

  // Auto-install network interceptor
  installNetworkInterceptor();
})();
