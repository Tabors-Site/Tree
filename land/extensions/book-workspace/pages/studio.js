// Book Studio page. Server-rendered HTML with embedded vanilla JS.
// The page has two halves: a contract form (left) and a live tree
// view (right) that shows chapters + note content as they're written.
//
// Flow:
//   1. User fills the contract form (title, characters, setting, voice,
//      theme, optional seed chapters, depth preference).
//   2. Save Contracts → POSTs form → server writes swarm contracts +
//      book-workspace.plannedDepth hint on the project root.
//   3. Start Book → POSTs → server dispatches tree:book-plan on the
//      root. Architect reads the pre-declared contracts, extends if
//      needed, emits [[BRANCHES]], swarm dispatches.
//   4. Live tree updates via SSE. Each chapter branch shows up with a
//      growing note content preview as its write session runs.
//   5. Link to /api/v1/root/{rootId}/book?html for the compiled view.

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function renderStudioPage({ nodeId, projectId, title, scope, user, token }) {
  const rootTitle = title ? escapeHtml(title) : "New Book";
  const nodeIdEsc = nodeId ? escapeHtml(nodeId) : "";
  const projectIdEsc = projectId ? escapeHtml(projectId) : "";
  const tokenEsc = escapeHtml(token || "");
  const authHeader = token ? `Bearer ${token}` : "";
  const compiledLink = projectId ? `/api/v1/root/${projectIdEsc}/book?html` : null;
  const scopeLabel = scope === "project" ? "whole book"
    : scope === "chapter" ? "chapter"
    : scope === "part" ? "part"
    : scope === "scene" ? "scene"
    : "new book";

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Book Studio — ${rootTitle}</title>
<style>
  :root {
    --bg: #0f0f10;
    --panel: #17181b;
    --panel2: #1d1f23;
    --border: #2a2d32;
    --fg: #e7e9ec;
    --muted: #8a8f98;
    --accent: #7aa2ff;
    --green: #61d095;
    --red: #e87676;
    --yellow: #e8c876;
    --mono: ui-monospace, "SF Mono", "Monaco", "Consolas", monospace;
  }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
    background: var(--bg);
    color: var(--fg);
    line-height: 1.5;
  }
  header {
    padding: 14px 22px;
    border-bottom: 1px solid var(--border);
    background: var(--panel);
    display: flex;
    align-items: center;
    gap: 16px;
  }
  header h1 { margin: 0; font-size: 18px; font-weight: 600; }
  header .links { margin-left: auto; display: flex; gap: 12px; font-size: 14px; }
  header a {
    color: var(--accent);
    text-decoration: none;
    padding: 6px 12px;
    border: 1px solid var(--border);
    border-radius: 6px;
  }
  header a:hover { background: var(--panel2); }
  main {
    display: grid;
    grid-template-columns: 420px 1fr;
    gap: 1px;
    background: var(--border);
    height: calc(100vh - 54px);
  }
  .panel {
    background: var(--bg);
    overflow-y: auto;
    padding: 20px;
  }
  .panel h2 {
    font-size: 14px;
    font-weight: 600;
    color: var(--muted);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    margin: 0 0 14px 0;
  }
  .field { margin-bottom: 14px; }
  .field label {
    display: block;
    font-size: 12px;
    color: var(--muted);
    margin-bottom: 4px;
  }
  .field input, .field textarea, .field select {
    width: 100%;
    padding: 8px 10px;
    font-family: inherit;
    font-size: 14px;
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 4px;
    color: var(--fg);
  }
  .field textarea { resize: vertical; min-height: 60px; font-family: var(--mono); }
  .repeatable { border: 1px solid var(--border); border-radius: 4px; padding: 10px; margin-bottom: 10px; background: var(--panel); }
  .repeatable .row { display: grid; grid-template-columns: 1fr 2fr auto; gap: 6px; margin-bottom: 6px; }
  .repeatable .row input { padding: 6px 8px; font-size: 13px; }
  .repeatable .row button.remove {
    background: transparent;
    border: 1px solid var(--border);
    color: var(--red);
    border-radius: 3px;
    cursor: pointer;
    padding: 0 8px;
  }
  .repeatable button.add {
    background: var(--panel2);
    border: 1px solid var(--border);
    color: var(--fg);
    border-radius: 3px;
    cursor: pointer;
    padding: 6px 10px;
    font-size: 12px;
  }
  .actions { display: flex; gap: 10px; margin-top: 20px; }
  .btn {
    flex: 1;
    padding: 10px 14px;
    font-size: 14px;
    font-weight: 600;
    border-radius: 6px;
    border: 1px solid var(--border);
    background: var(--panel);
    color: var(--fg);
    cursor: pointer;
  }
  .btn.primary { background: var(--accent); color: #0a0a0b; border-color: var(--accent); }
  .btn:hover { opacity: 0.9; }
  .tree {
    font-family: var(--mono);
    font-size: 13px;
  }
  .chapter {
    margin-bottom: 12px;
    padding: 10px 12px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--panel);
  }
  .chapter.running { border-color: var(--yellow); }
  .chapter.done { border-color: var(--green); }
  .chapter.failed { border-color: var(--red); }
  .chapter-head {
    display: flex;
    align-items: center;
    gap: 10px;
    font-weight: 600;
  }
  .chapter-head .status {
    font-family: var(--mono);
    font-size: 11px;
    padding: 2px 8px;
    border-radius: 10px;
    background: var(--panel2);
  }
  .chapter-head .status.running { color: var(--yellow); }
  .chapter-head .status.done { color: var(--green); }
  .chapter-head .status.failed { color: var(--red); }
  .chapter .spec { font-size: 12px; color: var(--muted); margin-top: 4px; }
  .chapter .prose {
    margin-top: 8px;
    padding: 10px;
    background: var(--bg);
    border-radius: 4px;
    white-space: pre-wrap;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    font-size: 13px;
    max-height: 260px;
    overflow-y: auto;
    color: #d0d3d7;
  }
  .chapter .prose.empty { color: var(--muted); font-style: italic; }
  .chat {
    margin-bottom: 10px;
    padding: 10px 12px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--panel);
    font-size: 12px;
  }
  .chat .meta {
    color: var(--muted);
    font-family: var(--mono);
    font-size: 11px;
    margin-bottom: 6px;
  }
  .chat .io {
    white-space: pre-wrap;
    font-size: 12px;
    max-height: 200px;
    overflow-y: auto;
    color: #d0d3d7;
  }
  .chat .io-in { color: var(--muted); margin-bottom: 4px; }
  .chat .io-out { color: var(--fg); }
  .chat.expanded .io { max-height: none; }
  .chat .expand { background: none; border: none; color: var(--accent); cursor: pointer; font-size: 11px; padding: 2px 0; }
  .log {
    margin-top: 20px;
    padding-top: 12px;
    border-top: 1px solid var(--border);
    font-family: var(--mono);
    font-size: 11px;
    color: var(--muted);
    max-height: 160px;
    overflow-y: auto;
  }
  .log-line { margin: 2px 0; }
  .empty-state { color: var(--muted); font-style: italic; padding: 40px; text-align: center; }
  .contracts-preview {
    margin-top: 16px;
    padding: 10px;
    background: var(--panel);
    border-radius: 4px;
    font-family: var(--mono);
    font-size: 11px;
    color: var(--muted);
    max-height: 200px;
    overflow-y: auto;
  }
</style>
</head>
<body>
<header>
  <h1>📖 Book Studio: <span id="book-title">${rootTitle}</span> <span style="color:var(--muted);font-weight:400;font-size:13px;">· scope: ${scopeLabel}</span></h1>
  <div class="links">
    ${compiledLink ? `<a href="${compiledLink}" target="_blank">Read Compiled Book →</a>` : ""}
    ${(projectId || nodeId) ? `<a href="/api/v1/root/${escapeHtml(projectId || nodeId)}?html">Back to Tree</a>` : `<a href="/">Home</a>`}
  </div>
</header>
<main>
  <section class="panel" id="form-panel">
    <h2>Contracts</h2>
    <form id="contract-form" onsubmit="return false">
      <div class="field">
        <label>Title</label>
        <input type="text" id="f-title" placeholder="e.g. The Stale Kitchen" />
      </div>
      <div class="field">
        <label>Premise / Prompt <span style="color:var(--muted);font-weight:400;">(short story seed — optional if you're pasting sources below)</span></label>
        <textarea id="f-premise" placeholder="e.g. A time-traveling chef learns kindness through loss..."></textarea>
      </div>
      <div class="field">
        <label>Sources / Raw Input <span style="color:var(--muted);font-weight:400;">(URLs, pasted text, blog posts, docs, transcripts — intake drone fetches &amp; distills)</span></label>
        <textarea id="f-sources" placeholder="Paste a URL like https://example.com/article, or paste raw text, transcript, outline, brain dump, etc. Leave blank if your premise above is already self-contained." style="min-height:140px;"></textarea>
      </div>
      <div class="field">
        <label>Characters (name, pronouns, and traits/role/arc are ALL required — pronouns prevent gender drift across chapters)</label>
        <div class="repeatable" id="characters">
          <div class="row" style="grid-template-columns: 1fr 1fr 2fr auto;"><input placeholder="Name" /><input placeholder="Pronouns (he/him, she/her, they/them)" /><input placeholder="Role / traits / arc" /><button class="remove" onclick="removeRow(this)">×</button></div>
        </div>
        <button class="add" onclick="addRow('characters')">+ Character</button>
      </div>
      <div class="field">
        <label>Setting</label>
        <input type="text" id="f-setting" placeholder="e.g. Modern restaurant + medieval inn, ~1400 AD" />
      </div>
      <div class="field">
        <label>Voice</label>
        <input type="text" id="f-voice" placeholder="e.g. third-limited, past tense, warm register" />
      </div>
      <div class="field">
        <label>Theme</label>
        <input type="text" id="f-theme" placeholder="e.g. kindness learned through loss" />
      </div>
      <div class="field">
        <label>Depth</label>
        <select id="f-depth">
          <option value="auto">Auto — let architect decide</option>
          <option value="short">Short story (5-10 chapters, flat)</option>
          <option value="novella">Novella (10-25 chapters, flat)</option>
          <option value="novel">Novel (3-5 parts × chapters)</option>
          <option value="epic">Epic (volumes × parts × chapters)</option>
        </select>
      </div>
      <div class="field">
        <label>Seed Chapters (optional)</label>
        <div class="repeatable" id="chapters">
          <div class="row"><input placeholder="Slug (01-opening)" /><input placeholder="Premise — what this chapter covers" /><button class="remove" onclick="removeRow(this)">×</button></div>
        </div>
        <button class="add" onclick="addRow('chapters')">+ Chapter</button>
      </div>

      <div class="actions">
        <button class="btn" id="save-btn" onclick="saveContracts()">Save Contracts</button>
        <button class="btn primary" id="start-btn" onclick="startBook()">Start Writing</button>
        <button class="btn" id="stop-btn" onclick="stopBook()" style="display:none;background:var(--red);color:#fff;border-color:var(--red);">Stop</button>
      </div>
      <div id="run-status" style="margin-top:8px;font-size:12px;color:var(--muted);"></div>

      <div class="contracts-preview" id="contracts-preview"></div>
    </form>
  </section>

  <section class="panel" id="tree-panel">
    <h2>Live Tree</h2>
    <div id="tree" class="tree"></div>
    <h2 style="margin-top:24px;">AI Chats <span id="chat-count" style="color:var(--muted);font-weight:400;font-size:12px;"></span></h2>
    <div id="chats"></div>
    <div class="log" id="log"></div>
  </section>
</main>

<script>
const NODE_ID = ${nodeId ? `"${nodeIdEsc}"` : "null"};
const PROJECT_ID = ${projectId ? `"${projectIdEsc}"` : "null"};
const SCOPE = "${scope || "new"}";
const SHARE_TOKEN = ${token ? `"${tokenEsc}"` : '""'};
const API_BASE = NODE_ID ? \`/api/v1/\${NODE_ID}/bookstudio\` : null;
// GETs (reads) accept the share token via ?token= for htmlAuth.
// POSTs (writes) require a JWT; we rely on the browser's auth cookie
// that the authenticate middleware reads from req.cookies.token.
const READ_QS = SHARE_TOKEN ? \`?token=\${encodeURIComponent(SHARE_TOKEN)}\` : "";
let es = null;
let snapshot = { root: null, chapters: [] };
let lastContractsKey = null;

function log(line) {
  const el = document.getElementById("log");
  const div = document.createElement("div");
  div.className = "log-line";
  div.textContent = \`[\${new Date().toLocaleTimeString()}] \${line}\`;
  el.appendChild(div);
  el.scrollTop = el.scrollHeight;
}

function addRow(containerId) {
  const container = document.getElementById(containerId);
  const proto = container.firstElementChild.cloneNode(true);
  proto.querySelectorAll("input").forEach(i => { i.value = ""; });
  container.appendChild(proto);
}

function removeRow(btn) {
  const row = btn.closest(".row");
  const container = row.parentElement;
  if (container.children.length <= 1) {
    row.querySelectorAll("input").forEach(i => { i.value = ""; });
    return;
  }
  row.remove();
}

function collectForm() {
  const title = document.getElementById("f-title").value.trim();
  const premise = document.getElementById("f-premise").value.trim();
  const sources = document.getElementById("f-sources").value.trim();
  const setting = document.getElementById("f-setting").value.trim();
  const voice = document.getElementById("f-voice").value.trim();
  const theme = document.getElementById("f-theme").value.trim();
  const depth = document.getElementById("f-depth").value;

  const characters = [];
  document.querySelectorAll("#characters .row").forEach(row => {
    const inputs = row.querySelectorAll("input");
    const name = inputs[0]?.value?.trim();
    const pronouns = inputs[1]?.value?.trim() || "";
    const traits = inputs[2]?.value?.trim() || "";
    if (name) {
      characters.push({ name, pronouns, traits });
    }
  });

  const chapters = [];
  document.querySelectorAll("#chapters .row").forEach(row => {
    const [slug, premise] = row.querySelectorAll("input");
    if (slug.value.trim()) {
      chapters.push({ slug: slug.value.trim(), premise: premise.value.trim() });
    }
  });

  return { title, premise, sources, setting, voice, theme, depth, characters, chapters };
}

function renderContractsPreview(form) {
  const lines = ["// Contracts that will flow to every chapter:", ""];
  if (form.title) lines.push(\`title: \${form.title}\`);
  if (form.premise) lines.push(\`premise: \${form.premise.slice(0, 200)}\${form.premise.length > 200 ? "…" : ""}\`);
  if (form.sources) lines.push(\`sources: \${form.sources.length} chars (will be distilled by intake)\`);
  for (const c of form.characters) lines.push(\`character \${c.name}: pronouns=\${c.pronouns || "(unspecified)"}, \${c.traits || "(unspecified)"}\`);
  if (form.setting) lines.push(\`setting: \${form.setting}\`);
  if (form.voice) lines.push(\`voice: \${form.voice}\`);
  if (form.theme) lines.push(\`theme: \${form.theme}\`);
  if (form.depth !== "auto") lines.push(\`depth: \${form.depth}\`);
  if (form.chapters.length > 0) {
    lines.push("");
    lines.push("// Seed chapters (architect may extend):");
    for (const c of form.chapters) lines.push(\`  \${c.slug} — \${c.premise}\`);
  }
  document.getElementById("contracts-preview").textContent = lines.join("\\n");
}

async function saveContracts() {
  if (!NODE_ID) {
    log("No rootId. Create a tree root first.");
    return;
  }
  const form = collectForm();
  renderContractsPreview(form);
  const res = await fetch(\`\${API_BASE}/contracts\`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(form),
  });
  const data = await res.json().catch(() => ({}));
  if (res.ok) {
    log(\`✓ Contracts saved (\${form.characters.length} chars, \${form.chapters.length} seed chapters)\`);
  } else {
    log(\`✗ Save failed: \${data.error?.message || res.statusText}\`);
  }
}

async function startBook() {
  if (!NODE_ID) { log("No rootId."); return; }
  await saveContracts();
  log(\`→ Dispatching architect (tree:book-plan)...\`);
  const res = await fetch(\`\${API_BASE}/start\`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({}),
  });
  const data = await res.json().catch(() => ({}));
  if (res.ok) {
    log(\`✓ Architect started. You can close this tab; it keeps running.\`);
    setRunning(true);
  } else {
    log(\`✗ Start failed: \${data.error?.message || res.statusText}\`);
  }
}

async function stopBook() {
  if (!NODE_ID) return;
  log(\`→ Stopping run...\`);
  const res = await fetch(\`\${API_BASE}/stop\`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
  });
  const data = await res.json().catch(() => ({}));
  if (res.ok) {
    if (data?.data?.stopped) log(\`✓ Stop signal sent. In-flight branch finishes its current turn, then bails.\`);
    else log(\`(no active run to stop)\`);
    setRunning(false);
  } else {
    log(\`✗ Stop failed: \${data.error?.message || res.statusText}\`);
  }
}

function contractsKey(contracts) {
  // Cheap fingerprint to detect when contracts change across refreshes.
  // Same contracts → same key → skip rebuilding repeatable lists.
  return (contracts || []).map((c) => \`\${c.kind}|\${c.name}|\${(c.fields || []).join(",")}\`).join(";");
}

function populateFormFromContracts(contracts, opts = {}) {
  const { rebuildLists = true } = opts;
  const get = (kind, name) => {
    if (name) return contracts.find(c => c.kind === kind && c.name === name);
    return contracts.find(c => c.kind === kind);
  };
  const getAll = (kind) => contracts.filter(c => c.kind === kind);
  const firstField = (c) => (c?.fields && c.fields[0]) || "";

  const titleEl = document.getElementById("f-title");
  if (titleEl && !titleEl.value) titleEl.value = firstField(get("title"));
  const premiseEl = document.getElementById("f-premise");
  if (premiseEl && !premiseEl.value) premiseEl.value = firstField(get("premise"));
  const sourcesEl = document.getElementById("f-sources");
  if (sourcesEl && !sourcesEl.value) sourcesEl.value = firstField(get("source", "input"));
  const settingEl = document.getElementById("f-setting");
  if (settingEl && !settingEl.value) settingEl.value = firstField(get("setting", "world"));
  const voiceEl = document.getElementById("f-voice");
  if (voiceEl && !voiceEl.value) voiceEl.value = firstField(get("voice", "narration"));
  const themeEl = document.getElementById("f-theme");
  if (themeEl && !themeEl.value) themeEl.value = firstField(get("theme", "central"));
  const depthEl = document.getElementById("f-depth");
  const depthValue = firstField(get("depth", "preference"));
  if (depthEl && depthValue) depthEl.value = depthValue;

  const chars = getAll("character");
  if (rebuildLists && chars.length > 0) {
    const container = document.getElementById("characters");
    if (!isFocusedInside(container)) {
      container.innerHTML = "";
      for (const c of chars) {
        const row = document.createElement("div");
        row.className = "row";
        row.style.gridTemplateColumns = "1fr 1fr 2fr auto";
        const pronouns = (c.fields || []).find((f) => /\\b(he|she|they|ze|xe)\\b/i.test(String(f))) || "";
        const traits = (c.fields || []).find((f) => f !== pronouns) || "";
        row.innerHTML = \`<input value="\${escapeHtml(c.name)}" placeholder="Name" /><input value="\${escapeHtml(pronouns)}" placeholder="Pronouns" /><input value="\${escapeHtml(traits)}" placeholder="Role / traits / arc" /><button class="remove" onclick="removeRow(this)">×</button>\`;
        container.appendChild(row);
      }
      if (container.children.length === 0) addRow("characters");
    }
  }

  const chapters = getAll("seedChapter");
  if (rebuildLists && chapters.length > 0) {
    const container = document.getElementById("chapters");
    if (!isFocusedInside(container)) {
      container.innerHTML = "";
      for (const c of chapters) {
        const row = document.createElement("div");
        row.className = "row";
        row.innerHTML = \`<input value="\${escapeHtml(c.name)}" placeholder="Slug (01-opening)" /><input value="\${escapeHtml(firstField(c))}" placeholder="Premise — what this chapter covers" /><button class="remove" onclick="removeRow(this)">×</button>\`;
        container.appendChild(row);
      }
      if (container.children.length === 0) addRow("chapters");
    }
  }

  renderContractsPreview(collectForm());
}

function isFocusedInside(container) {
  if (!container) return false;
  const active = document.activeElement;
  return !!active && container.contains(active);
}

function setRunning(running, startedAt) {
  const startBtn = document.getElementById("start-btn");
  const stopBtn = document.getElementById("stop-btn");
  const status = document.getElementById("run-status");
  if (running) {
    startBtn.textContent = "Restart";
    stopBtn.style.display = "";
    status.textContent = startedAt
      ? \`● running since \${new Date(startedAt).toLocaleTimeString()}\`
      : \`● running\`;
    status.style.color = "var(--yellow)";
  } else {
    startBtn.textContent = "Start Writing";
    stopBtn.style.display = "none";
    status.textContent = "";
  }
}

async function refresh() {
  if (!NODE_ID) return;
  try {
    const [stateRes, chatsRes] = await Promise.all([
      fetch(\`\${API_BASE}/state\${READ_QS}\`, { credentials: "include" }),
      fetch(\`\${API_BASE}/chats\${READ_QS}\`, { credentials: "include" }),
    ]);
    if (stateRes.ok) {
      const data = await stateRes.json();
      if (data?.data) {
        snapshot = data.data;
        renderTree();
        setRunning(!!data.data.running, data.data.runStartedAt);
        if (Array.isArray(data.data.contracts) && data.data.contracts.length > 0) {
          // Re-populate on every refresh so the form reflects what
          // intake + architect distilled. Scalar fields only fill when
          // empty (won't overwrite user edits); repeatable lists
          // rebuild only when the contracts actually changed, and
          // skip the rebuild if the user is focused inside them.
          const key = contractsKey(data.data.contracts);
          const changed = key !== lastContractsKey;
          populateFormFromContracts(data.data.contracts, { rebuildLists: changed });
          if (changed) {
            lastContractsKey = key;
            if (lastContractsKey !== null) log(\`· contracts updated (\${data.data.contracts.length} entries)\`);
          }
        }
      }
    }
    if (chatsRes.ok) {
      const data = await chatsRes.json();
      if (Array.isArray(data?.data?.chats)) renderChats(data.data.chats);
    }
  } catch (e) {}
}

function renderChats(chats) {
  const el = document.getElementById("chats");
  const countEl = document.getElementById("chat-count");
  if (!el) return;
  if (chats.length === 0) {
    el.innerHTML = '<div style="color:var(--muted);font-style:italic;font-size:12px;">(no chats yet)</div>';
    if (countEl) countEl.textContent = "";
    return;
  }
  chats = chats.slice().reverse();
  if (countEl) countEl.textContent = \`· \${chats.length} turns\`;
  el.innerHTML = "";
  for (const c of chats) {
    const div = document.createElement("div");
    div.className = "chat";
    const when = c.startedAt ? new Date(c.startedAt).toLocaleTimeString() : "?";
    const origin = c.dispatchOrigin ? \` · \${c.dispatchOrigin}\` : "";
    const stopped = c.stopped ? " · stopped" : "";
    const mode = c.mode || "?";
    div.innerHTML = \`
      <div class="meta">#\${c.chainIndex || 0} · \${escapeHtml(mode)} · \${when}\${escapeHtml(origin)}\${escapeHtml(stopped)}</div>
      <div class="io io-in"><b>in:</b> \${escapeHtml(c.input || "(empty)")}</div>
      \${c.output ? \`<div class="io io-out"><b>out:</b> \${escapeHtml(c.output)}</div>\` : '<div class="io io-out" style="color:var(--muted);font-style:italic;">(no response yet)</div>'}
      <button class="expand" onclick="this.parentElement.classList.toggle('expanded');">expand ↕</button>
    \`;
    el.appendChild(div);
  }
}

function renderTree() {
  const el = document.getElementById("tree");
  const chapters = snapshot.chapters || [];
  if (chapters.length === 0) {
    el.innerHTML = '<div class="empty-state">No chapters yet. Fill contracts and click Start Writing.</div>';
    return;
  }
  el.innerHTML = "";
  for (const ch of chapters) {
    const div = document.createElement("div");
    div.className = \`chapter \${ch.status || "pending"}\`;
    const status = ch.status || "pending";
    const statusIcon = status === "done" ? "✓" : status === "failed" ? "✗" : status === "running" ? "🟡" : "⏳";
    const prose = (ch.notes || []).map(n => n.content || "").join("\\n\\n");
    div.innerHTML = \`
      <div class="chapter-head">
        <span class="status \${status}">\${statusIcon} \${status}</span>
        <span>\${escapeHtml(ch.name || "(unnamed)")}</span>
      </div>
      \${ch.spec ? \`<div class="spec">\${escapeHtml(ch.spec)}</div>\` : ""}
      <div class="prose \${prose ? "" : "empty"}">\${prose ? escapeHtml(prose) : "(no prose yet)"}</div>
    \`;
    el.appendChild(div);
  }
}

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function connectSSE() {
  if (!NODE_ID) return;
  const url = \`\${API_BASE}/events\${READ_QS}\`;
  es = new EventSource(url, { withCredentials: true });
  es.addEventListener("update", (e) => {
    log(\`· \${e.data}\`);
    refresh();
  });
  es.addEventListener("error", () => {
    log("SSE disconnected; retrying in 5s");
    es?.close();
    setTimeout(connectSSE, 5000);
  });
}

// Initial
if (NODE_ID) {
  refresh();
  connectSSE();
  setInterval(refresh, 10000); // belt-and-suspenders poll
}
</script>
</body>
</html>`;
}
