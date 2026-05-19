/**
 * Tree-root slot for code-serve.
 *
 * Registered against `tree-owner-sections` in treeOverview.js. The slot
 * render call at resolveSlots() is synchronous (see treeos-base/slots.js)
 * so this handler cannot await a DB lookup. Instead it always emits a
 * placeholder + a small client script that fetches /serve-status on
 * load and fills the placeholder in with the correct state.
 *
 * Shape of the rendered HTML:
 *
 *   <section class="code-serve-slot">
 *     <div id="code-serve-root-<rootId>"></div>
 *     <script>... fetches /api/v1/workspace/<rootId>/serve-status and
 *              replaces innerHTML with either the "Run" button, the
 *              running iframe + controls, or nothing for non-projects.
 *     </script>
 *   </section>
 *
 * The status route does the actual role=project check, so the slot
 * handler stays stateless and sync.
 */

function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function registerCodeServeSlot(/* opts */) {
  // Sync slot handler — resolveSlots rejects anything that isn't a plain
  // string, so we CANNOT be async here. DB lookups happen on the /serve-status
  // route which the inline script hits on page load.
  return (ctx) => {
    try {
      const { rootId, token, queryString } = ctx || {};
      if (!rootId) return "";

      const safeRoot = esc(rootId);
      const tokenQS = token ? `?token=${encodeURIComponent(token)}` : (queryString || "");

      return `
<section class="code-serve-slot" style="padding:20px;background:#f8f8fc;border-radius:12px;margin:16px 0;border:1px solid rgba(0,0,0,0.08);">
  <div id="code-serve-root-${safeRoot}"></div>
</section>
<script>
(function () {
  var rootId = ${JSON.stringify(String(rootId))};
  var tokenQS = ${JSON.stringify(tokenQS)};
  var host = document.getElementById("code-serve-root-" + rootId);
  if (!host) return;

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  function previewSrc(slug) {
    // Relative path — served by the main land through /api/v1/preview/<slug>/
    return "/api/v1/preview/" + slug + "/";
  }

  function renderIdle(data) {
    host.innerHTML =
      '<h2 style="margin:0 0 10px 0;">▶ Run ' + esc(data.projectName || "project") + '</h2>' +
      '<p style="color:#666;margin:0 0 16px 0;">Spawn this workspace\\'s server (or serve its static index.html) and embed it live below. Idle shuts down after 10 minutes.</p>' +
      '<button id="code-serve-run-btn-' + esc(rootId) + '" class="primary-button" ' +
      '  style="padding:10px 24px;background:#4caf50;color:#fff;border:none;border-radius:8px;font-size:16px;cursor:pointer;">Run project</button>' +
      '<div id="code-serve-msg-' + esc(rootId) + '" style="margin-top:12px;color:#666;font-size:13px;"></div>';
    var btn = document.getElementById("code-serve-run-btn-" + rootId);
    if (btn) btn.addEventListener("click", function () { start(); });
  }

  function renderRunning(data) {
    var src = previewSrc(data.slug);
    var stdoutTail = (data.stdoutTail || []).slice(-12).join("\\n");
    var stderrTail = (data.stderrTail || []).slice(-12).join("\\n");
    var html =
      '<h2 style="margin:0 0 10px 0;display:flex;align-items:center;gap:10px;">' +
      '  <span style="display:inline-block;width:10px;height:10px;background:#4caf50;border-radius:50%;box-shadow:0 0 8px #4caf50;"></span>' +
      '  Running: ' + esc(data.projectName || data.slug) +
      '  <span style="font-size:13px;color:#888;font-weight:normal;">' + esc(data.kind) + (data.port ? " · :" + data.port : "") + '</span>' +
      '</h2>' +
      '<div style="display:flex;gap:10px;margin-bottom:12px;">' +
      '  <button id="code-serve-open-' + esc(rootId) + '" style="padding:8px 16px;background:#2196f3;color:#fff;border:none;border-radius:6px;cursor:pointer;">Open in new tab</button>' +
      '  <button id="code-serve-stop-' + esc(rootId) + '" style="padding:8px 16px;background:#e54245;color:#fff;border:none;border-radius:6px;cursor:pointer;">■ Stop</button>' +
      '  <button id="code-serve-reload-' + esc(rootId) + '" style="padding:8px 16px;background:#fff;border:1px solid #ccc;border-radius:6px;cursor:pointer;">↻ Reload</button>' +
      '</div>' +
      '<iframe id="code-serve-iframe-' + esc(rootId) + '" src="' + esc(src) + '" style="width:100%;height:700px;border:1px solid #ddd;border-radius:8px;background:#fff;"></iframe>';
    if (stdoutTail) {
      html += '<details style="margin-top:12px;"><summary style="cursor:pointer;color:#666;">stdout</summary>' +
              '<pre style="background:#111;color:#0f0;padding:12px;border-radius:6px;font-size:12px;overflow-x:auto;max-height:200px;">' + esc(stdoutTail) + '</pre></details>';
    }
    if (stderrTail) {
      html += '<details style="margin-top:8px;"><summary style="cursor:pointer;color:#c00;">stderr</summary>' +
              '<pre style="background:#111;color:#f55;padding:12px;border-radius:6px;font-size:12px;overflow-x:auto;max-height:200px;">' + esc(stderrTail) + '</pre></details>';
    }
    host.innerHTML = html;

    var openBtn = document.getElementById("code-serve-open-" + rootId);
    if (openBtn) openBtn.addEventListener("click", function () { window.open(src, "_blank"); });
    var stopBtn = document.getElementById("code-serve-stop-" + rootId);
    if (stopBtn) stopBtn.addEventListener("click", function () { stop(); });
    var reloadBtn = document.getElementById("code-serve-reload-" + rootId);
    if (reloadBtn) reloadBtn.addEventListener("click", function () {
      var f = document.getElementById("code-serve-iframe-" + rootId);
      if (f) f.src = f.src;
    });
  }

  function fetchStatus() {
    fetch("/api/v1/workspace/" + rootId + "/serve-status" + tokenQS, { credentials: "include" })
      .then(function (r) { return r.json(); })
      .then(function (res) {
        if (!res || res.status !== "ok" || !res.data) { host.innerHTML = ""; return; }
        var data = res.data;
        if (data.reason === "not-a-project") { host.innerHTML = ""; return; }
        if (data.running) { renderRunning(data); }
        else { renderIdle(data); }
      })
      .catch(function () { host.innerHTML = ""; });
  }

  function start() {
    var msg = document.getElementById("code-serve-msg-" + rootId);
    if (msg) msg.textContent = "Starting...";
    fetch("/api/v1/workspace/" + rootId + "/serve" + tokenQS, { method: "POST", credentials: "include" })
      .then(function (r) { return r.json(); })
      .then(function (res) {
        if (res && res.status === "ok") { fetchStatus(); }
        else if (msg) { msg.textContent = "Error: " + (res && res.error && res.error.message || "unknown"); }
      })
      .catch(function (err) { if (msg) msg.textContent = "Error: " + err.message; });
  }

  function stop() {
    fetch("/api/v1/workspace/" + rootId + "/stop" + tokenQS, { method: "POST", credentials: "include" })
      .then(function () { fetchStatus(); })
      .catch(function () { fetchStatus(); });
  }

  fetchStatus();
})();
</script>`;
    } catch (err) {
      // Sync handler — can't log through log.js cleanly without re-import noise.
      // Swallow and render nothing so a slot bug never breaks the whole page.
      return "";
    }
  };
}
