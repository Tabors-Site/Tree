/* ─────────────────────────────────────────────── */
/* HTML renderer for setup / onboarding page       */
/* ─────────────────────────────────────────────── */

export function renderSetup({ userId, username, needsLlm, needsTree, apps = [] }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Setup - TreeOS</title>
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="theme-color" content="#667eea" />
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=DM+Sans:opsz,wght@9..40,400;9..40,500;9..40,600&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
  <style>
    :root {
      --glass-rgb: 115, 111, 230;
      --glass-alpha: 0.28;
      --glass-blur: 22px;
      --glass-border: rgba(255, 255, 255, 0.28);
      --glass-border-light: rgba(255, 255, 255, 0.15);
      --glass-highlight: rgba(255, 255, 255, 0.25);
      --text-primary: #ffffff;
      --text-secondary: rgba(255, 255, 255, 0.9);
      --text-muted: rgba(255, 255, 255, 0.6);
      --accent: #10b981;
      --accent-glow: rgba(16, 185, 129, 0.6);
      --error: #ef4444;
      --transition-fast: 150ms cubic-bezier(0.4, 0, 0.2, 1);
    }

    * { box-sizing: border-box; margin: 0; padding: 0; }
    html { background: #667eea; }
    body { min-height: 100vh; min-height: 100dvh; width: 100%; font-family: 'DM Sans', -apple-system, sans-serif; color: var(--text-primary); background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); background-attachment: fixed; position: relative; overflow-x: hidden; overflow-y: auto; }
    body::before, body::after {
      content: ''; position: fixed; border-radius: 50%; background: white;
      opacity: 0.08; animation: float 20s infinite ease-in-out; pointer-events: none;
    }
    body::before { width: 600px; height: 600px; top: -300px; right: -200px; animation-delay: -5s; }
    body::after { width: 400px; height: 400px; bottom: -200px; left: -100px; animation-delay: -10s; }
    @keyframes float { 0%, 100% { transform: translateY(0) rotate(0deg); } 50% { transform: translateY(-30px) rotate(5deg); } }

    .container {
      max-width: 620px; margin: 0 auto; padding: 40px 20px 60px;
      display: flex; flex-direction: column; gap: 24px;
      min-height: 100vh;
    }

    .header {
      text-align: center; padding: 20px 0 10px;
    }
    .header .tree-icon { font-size: 48px; display: block; margin-bottom: 12px; filter: drop-shadow(0 4px 12px rgba(0, 0, 0, 0.3)); }
    .header h1 { font-size: 24px; font-weight: 600; letter-spacing: -0.02em; margin-bottom: 6px; }
    .header p { font-size: 14px; color: var(--text-muted); line-height: 1.5; }

    .glass-card {
      background: rgba(var(--glass-rgb), var(--glass-alpha));
      backdrop-filter: blur(var(--glass-blur));
      -webkit-backdrop-filter: blur(var(--glass-blur));
      border: 1px solid var(--glass-border);
      border-radius: 16px;
      padding: 24px;
      animation: fadeUp 0.5s ease both;
    }
    @keyframes fadeUp {
      from { opacity: 0; transform: translateY(16px); }
      to { opacity: 1; transform: translateY(0); }
    }
    .glass-card h2 { font-size: 17px; font-weight: 600; margin-bottom: 12px; display: flex; align-items: center; gap: 8px; }
    .glass-card .sub { font-size: 13px; color: var(--text-muted); line-height: 1.5; margin-bottom: 16px; }

    .step-badge {
      display: inline-flex; align-items: center; justify-content: center;
      width: 24px; height: 24px; border-radius: 50%;
      background: rgba(255,255,255,0.15); font-size: 12px; font-weight: 600;
      flex-shrink: 0;
    }

    .field-row { margin-bottom: 16px; text-align: left; }
    .field-label {
      display: block; font-size: 14px; font-weight: 600; color: white;
      margin-bottom: 8px; text-shadow: 0 1px 3px rgba(0,0,0,0.2); letter-spacing: -0.2px;
    }
    .field-input {
      width: 100%; padding: 14px 18px;
      background: rgba(255,255,255,0.15); border: 2px solid rgba(255,255,255,0.3);
      border-radius: 12px; color: white; font-family: inherit; font-size: 16px; font-weight: 500;
      outline: none; transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
      backdrop-filter: blur(20px) saturate(150%); -webkit-backdrop-filter: blur(20px) saturate(150%);
      box-shadow: 0 4px 20px rgba(0,0,0,0.1), inset 0 1px 0 rgba(255,255,255,0.25);
    }
    .field-input:focus {
      border-color: rgba(255,255,255,0.6); background: rgba(255,255,255,0.25);
      backdrop-filter: blur(25px) saturate(160%); -webkit-backdrop-filter: blur(25px) saturate(160%);
      box-shadow: 0 0 0 4px rgba(255,255,255,0.15), 0 8px 30px rgba(0,0,0,0.15), inset 0 1px 0 rgba(255,255,255,0.4);
      transform: translateY(-2px);
    }
    .field-input::placeholder { color: rgba(255,255,255,0.5); font-weight: 400; }

    .btn-primary {
      width: 100%; padding: 16px; margin-top: 8px;
      border-radius: 980px; border: 1px solid rgba(255,255,255,0.3);
      background: rgba(255,255,255,0.25); backdrop-filter: blur(10px);
      color: white; font-family: inherit; font-size: 16px; font-weight: 600;
      cursor: pointer; transition: all 0.3s; letter-spacing: -0.2px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.12);
      position: relative; overflow: hidden;
    }
    .btn-primary::before {
      content: ''; position: absolute; inset: -40%;
      background: radial-gradient(120% 60% at 0% 0%, rgba(255,255,255,0.35), transparent 60%);
      opacity: 0; transform: translateX(-30%) translateY(-10%);
      transition: opacity 0.35s ease, transform 0.6s cubic-bezier(0.22, 1, 0.36, 1);
      pointer-events: none;
    }
    .btn-primary:hover::before { opacity: 1; transform: translateX(30%) translateY(10%); }
    .btn-primary:hover { background: rgba(255,255,255,0.35); transform: translateY(-2px); box-shadow: 0 6px 20px rgba(0,0,0,0.18); }
    .btn-primary:active { transform: translateY(0); }
    .btn-primary:disabled { opacity: 0.5; cursor: not-allowed; transform: none; }
    .btn-primary:disabled::before { display: none; }

    .btn-skip {
      display: block; width: 100%; text-align: center; padding: 12px;
      color: white; font-size: 15px; font-weight: 600; font-family: inherit;
      background: rgba(255,255,255,0.15); border: 1px solid rgba(255,255,255,0.3);
      border-radius: 980px; cursor: pointer; transition: all 0.3s;
      text-decoration: none; box-shadow: 0 2px 8px rgba(0,0,0,0.08);
    }
    .btn-skip:hover { background: rgba(255,255,255,0.25); color: white; }

    .status-msg {
      padding: 12px 16px; border-radius: 10px; font-size: 14px; font-weight: 600;
      margin-top: 8px; display: none; text-align: left;
    }
    .status-msg.error { display: block; background: rgba(239,68,68,0.3); backdrop-filter: blur(10px); border: 1px solid rgba(239,68,68,0.4); color: white; }
    .status-msg.success { display: block; background: rgba(16,185,129,0.3); backdrop-filter: blur(10px); border: 1px solid rgba(16,185,129,0.4); color: white; }

    .video-wrap {
      position: relative; width: 100%; padding-top: 56.25%;
      border-radius: 12px; overflow: hidden; margin-bottom: 16px;
      background: rgba(0,0,0,0.2);
    }
    .video-wrap iframe {
      position: absolute; inset: 0; width: 100%; height: 100%; border: none;
    }
    .video-placeholder {
      position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
      color: var(--text-muted); font-size: 14px;
    }

    .done-card { text-align: center; padding: 40px 24px; }
    .done-card .seed-anim {
      font-size: 48px; display: inline-block; margin-bottom: 12px;
    }
    .done-card .seed-anim.shake {
      animation: seedShake 0.4s ease-in-out 3;
    }
    .done-card .seed-anim.burst {
      animation: seedBurst 0.4s ease-out forwards;
    }
    .done-card .seed-anim.tree {
      animation: treeAppear 0.5s ease-out forwards;
    }
    @keyframes seedShake {
      0%, 100% { transform: rotate(0deg) scale(1); }
      25% { transform: rotate(-12deg) scale(1.05); }
      75% { transform: rotate(12deg) scale(1.05); }
    }
    @keyframes seedBurst {
      0% { transform: scale(1); opacity: 1; filter: brightness(1); }
      50% { transform: scale(1.6); opacity: 0.8; filter: brightness(2.5); }
      100% { transform: scale(0); opacity: 0; filter: brightness(3); }
    }
    @keyframes treeAppear {
      0% { transform: scale(0); opacity: 0; }
      60% { transform: scale(1.2); opacity: 1; }
      100% { transform: scale(1); opacity: 1; }
    }

    .screen-flash {
      position: fixed; inset: -50px; background: rgba(255,255,255,0.9); opacity: 0; z-index: 9999;
      pointer-events: none; animation: screenFlash 0.6s ease-out forwards;
    }
    @keyframes screenFlash {
      0% { opacity: 0; }
      15% { opacity: 0.85; }
      100% { opacity: 0; }
    }

    .skip-note { font-size: 12px; color: var(--text-muted); text-align: center; margin-top: 4px; line-height: 1.4; }

    .hidden { display: none !important; }
  </style>
</head>
<body>
  <div class="container">

    <div class="header">
      <span class="tree-icon">🌳</span>
      <h1>Welcome${username ? ", " + username : ""}!</h1>
      <p>Let's get you set up to start growing your Tree.</p>
    </div>

    <!-- Step 1: Connect LLM -->
    <div class="glass-card" id="stepLlm" ${needsLlm ? "" : 'style="display:none"'}>
      <h2>Connect Your LLM</h2>
      <div class="sub">
        TreeOS uses AI to help you build and organize your knowledge. You'll need to connect your own LLM provider
        using any OpenAI-compatible API endpoint. We recommend <strong>OpenRouter</strong> for the easiest setup.
        It gives you access to hundreds of models with one API key.
      </div>

      <div class="video-wrap">
        <iframe src="https://www.youtube-nocookie.com/embed/_cXGZXdiVgw" allowfullscreen></iframe>
      </div>

      <div class="field-row">
        <label class="field-label">Label</label>
        <input type="text" class="field-input" id="llmName" placeholder="e.g. OpenRouter, Groq" />
      </div>
      <div class="field-row">
        <label class="field-label">Endpoint URL</label>
        <input type="text" class="field-input" id="llmBaseUrl" placeholder="https://openrouter.ai/api/v1/chat/completions" />
      </div>
      <div class="field-row">
        <label class="field-label">API Key <span style="opacity:0.5;font-weight:400;">- encrypted in our database</span></label>
        <input type="password" class="field-input" id="llmApiKey" placeholder="sk-or-..." />
      </div>
      <div class="field-row">
        <label class="field-label">Model</label>
        <input type="text" class="field-input" id="llmModel" placeholder="e.g. openai/gpt-4o-mini" />
      </div>
      <div id="llmStatus" class="status-msg"></div>
      <button class="btn-primary" id="llmSubmit" onclick="submitLlm()">Connect</button>
    </div>

    <!-- Step 2: Choose an App -->
    <div class="glass-card" id="stepTree" style="display:${!needsTree || needsLlm ? "none" : ""}">
      <h2>Start Your First Tree</h2>
      <div class="sub">
        Pick an app to get started. Each one creates a tree with guided AI setup.
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px;">
        ${apps.map(a => `
        <a href="#" onclick="goToApps()" style="display:flex;flex-direction:column;align-items:center;padding:16px;background:rgba(255,255,255,0.1);border:1px solid rgba(255,255,255,0.2);border-radius:12px;text-decoration:none;transition:all 0.2s;">
          <span style="font-size:1.5rem;margin-bottom:4px;">${a.emoji}</span>
          <span style="color:white;font-weight:600;font-size:0.9rem;">${a.label}</span>
          <span style="color:rgba(255,255,255,0.5);font-size:0.75rem;">${a.sub}</span>
        </a>`).join("")}
      </div>
      <button class="btn-primary" onclick="goToApps()">Choose an App</button>
      <div style="margin-top:16px;padding-top:12px;border-top:1px solid rgba(255,255,255,0.15);">
        <p style="color:rgba(255,255,255,0.4);font-size:0.75rem;margin-bottom:8px;">Or create a custom tree (advanced)</p>
        <div style="display:flex;gap:8px;">
          <input type="text" class="field-input" id="treeName" placeholder="Tree name..." style="padding:10px 14px;font-size:14px;" />
          <button class="btn-primary" style="width:auto;padding:10px 18px;margin-top:0;font-size:14px;" onclick="submitTree()">+</button>
        </div>
      </div>
    </div>

    <!-- Done state -->
    <div class="glass-card done-card hidden" id="stepDone">
      <div class="seed-anim" id="seedEmoji">&#127793;</div>
      <h2 style="justify-content:center;" id="doneTitle" class="hidden">Your tree is being planted...</h2>
      <div class="sub" style="text-align:center;" id="doneSub" class="hidden"></div>
    </div>

    <!-- Skip -->
    <a class="btn-skip" href="#" id="skipBtn" onclick="skipSetup(); return false;">Skip for now</a>
    <div class="skip-note" id="skipNote">You can still browse trees others have invited you to if they have their own LLM connected, but you won't be able to talk to your own trees or process raw ideas.</div>

  </div>

  <script>
    var CONFIG = {
      userId: "${userId}",
      needsTree: ${needsTree},
    };

    function showStatus(id, msg, type) {
      var el = document.getElementById(id);
      el.textContent = msg;
      el.className = "status-msg " + type;
    }
    function clearStatus(id) {
      var el = document.getElementById(id);
      el.className = "status-msg";
      el.textContent = "";
    }

    async function submitLlm() {
      var name = document.getElementById("llmName").value.trim();
      var baseUrl = document.getElementById("llmBaseUrl").value.trim();
      var apiKey = document.getElementById("llmApiKey").value.trim();
      var model = document.getElementById("llmModel").value.trim();

      if (!name || !baseUrl || !apiKey || !model) {
        showStatus("llmStatus", "All fields are required.", "error");
        return;
      }

      var btn = document.getElementById("llmSubmit");
      btn.disabled = true;
      btn.textContent = "Connecting...";
      clearStatus("llmStatus");

      try {
        // Create connection
        var createRes = await fetch("/api/v1/user/" + CONFIG.userId + "/custom-llm", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ name: name, baseUrl: baseUrl, apiKey: apiKey, model: model }),
        });
        var createData = await createRes.json();

        if (!createRes.ok || createData.status === "error") {
          throw new Error((createData.error && createData.error.message) || createData.error || "Failed to create connection");
        }

        // Set as default
        var connId = (createData.data && createData.data.connection && createData.data.connection._id) || (createData.connection && createData.connection._id);
        var assignRes = await fetch("/api/v1/user/" + CONFIG.userId + "/llm-assign", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ slot: "main", connectionId: connId }),
        });
        var assignData = await assignRes.json();
        if (!assignRes.ok || assignData.status === "error") {
          throw new Error((assignData.error && assignData.error.message) || assignData.error || "Failed to set as default");
        }

        showStatus("llmStatus", "Connected!", "success");

        setTimeout(function() {
          document.getElementById("stepLlm").style.display = "none";
          if (CONFIG.needsTree) {
            document.getElementById("stepTree").style.display = "";
          } else {
            finish();
          }
        }, 600);

      } catch (err) {
        showStatus("llmStatus", err.message, "error");
        btn.disabled = false;
        btn.textContent = "Connect";
      }
    }

    async function submitTree() {
      var name = document.getElementById("treeName").value.trim();
      if (!name) {
        showStatus("treeStatus", "Give your tree a name.", "error");
        return;
      }

      var btn = document.getElementById("treeSubmit");
      btn.disabled = true;
      btn.textContent = "Planting...";
      clearStatus("treeStatus");

      try {
        var res = await fetch("/api/v1/user/" + CONFIG.userId + "/createRoot", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ name: name }),
        });
        var data = await res.json();

        if (!res.ok || data.status === "error") {
          throw new Error((data.error && data.error.message) || data.error || "Failed to create tree");
        }

        finish();
      } catch (err) {
        showStatus("treeStatus", err.message, "error");
        btn.disabled = false;
        btn.textContent = "Plant Tree";
      }
    }

    function goToApps() {
      window.location.href = "/api/v1/user/" + CONFIG.userId + "/apps?html";
    }

    function skipSetup() {
      document.cookie = "setupSkipped=1;path=/;max-age=" + (12 * 60 * 60) + ";secure;samesite=none";
      window.location.href = "/chat";
    }

    function finish() {
      document.getElementById("stepLlm").style.display = "none";
      document.getElementById("stepTree").style.display = "none";
      document.getElementById("stepDone").classList.remove("hidden");
      document.getElementById("skipBtn").style.display = "none";
      document.getElementById("skipNote").style.display = "none";

      var seed = document.getElementById("seedEmoji");
      var title = document.getElementById("doneTitle");
      var sub = document.getElementById("doneSub");
      // Show "being planted" right away
      title.classList.remove("hidden");
      // Phase 1: seed shakes (1.2s = 0.4s x 3 iterations)
      seed.classList.add("shake");
      setTimeout(function() {
        // Phase 2: burst flash
        seed.classList.remove("shake");
        seed.classList.add("burst");
        setTimeout(function() {
          // Phase 3: flash + swap to tree
          var flash = document.createElement("div");
          flash.className = "screen-flash";
          document.body.appendChild(flash);
          flash.addEventListener("animationend", function() { flash.remove(); });
          seed.innerHTML = "&#127795;";
          seed.classList.remove("burst");
          seed.classList.add("tree");
          // Swap to ready text
          title.textContent = "Your tree is ready.";
          sub.textContent = "Taking you there now...";
          sub.classList.remove("hidden");
          setTimeout(function() {
            window.location.href = "/chat";
          }, 1500);
        }, 400);
      }, 1200);
    }
  </script>
</body>
</html>`;
}
