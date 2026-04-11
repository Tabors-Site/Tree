/* ─────────────────────────────────────────────── */
/* HTML renderer for setup / onboarding page       */
/* LLM connection only. Sprout handles the rest.   */
/* ─────────────────────────────────────────────── */

export function renderSetup({ userId, username }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Setup - TreeOS</title>
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="theme-color" content="#0d1117" />
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=DM+Sans:opsz,wght@9..40,400;9..40,500;9..40,600&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
  <style>
    :root {
      /* Nightfall theme */
      --bg:           #0d1117;
      --bg-elevated:  #161b24;
      --bg-hover:     #1c222e;
      --border:       #232a38;
      --border-strong:#2f3849;

      --text-primary:   #e6e8eb;
      --text-secondary: #c4c8d0;
      --text-muted:     #9ba1ad;

      --accent:      #7dd385;
      --accent-glow: rgba(125, 211, 133, 0.5);
      --error:       #c97e6a;

      /* Legacy aliases */
      --glass-rgb:          22, 27, 36;
      --glass-alpha:        1;
      --glass-blur:         0px;
      --glass-border:       #232a38;
      --glass-border-light: #232a38;
      --glass-highlight:    #2f3849;

      --transition-fast: 150ms cubic-bezier(0.4, 0, 0.2, 1);
    }

    * { box-sizing: border-box; margin: 0; padding: 0; }
    html { background: var(--bg); }
    body { min-height: 100vh; min-height: 100dvh; width: 100%; font-family: 'DM Sans', -apple-system, sans-serif; color: var(--text-primary); background: var(--bg); position: relative; overflow-x: hidden; overflow-y: auto; }

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
      <p>Connect your LLM and start talking. Your tree will grow from the conversation.</p>
    </div>

    <!-- Step 1: Connect LLM -->
    <div class="glass-card" id="stepLlm">
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
        <label class="field-label">API Key <span style="opacity:0.5;font-weight:400;">- not required for Ollama/local models</span></label>
        <input type="password" class="field-input" id="llmApiKey" placeholder="sk-or-... (leave blank for local)" />
      </div>
      <div class="field-row">
        <label class="field-label">Model</label>
        <input type="text" class="field-input" id="llmModel" placeholder="e.g. openai/gpt-4o-mini" />
      </div>
      <div id="llmStatus" class="status-msg"></div>
      <button class="btn-primary" id="llmSubmit" onclick="submitLlm()">Connect</button>
    </div>

    <!-- Done state -->
    <div class="glass-card done-card hidden" id="stepDone">
      <div class="seed-anim" id="seedEmoji">&#127793;</div>
      <h2 style="justify-content:center;" id="doneTitle" class="hidden">Planting your seed...</h2>
      <div class="sub" style="text-align:center;" id="doneSub" class="hidden"></div>
    </div>

    <!-- Skip -->
    <a class="btn-skip" href="#" id="skipBtn" onclick="skipSetup(); return false;">Skip for now</a>
    <div class="skip-note" id="skipNote">You can still browse trees others have invited you to if they have their own LLM connected, but you won't be able to talk to your own trees.</div>

  </div>

  <script>
    var CONFIG = {
      userId: "${userId}",
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

      if (!name || !baseUrl || !model) {
        showStatus("llmStatus", "Name, URL, and model are required.", "error");
        return;
      }
      if (!apiKey) apiKey = "none";

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
        setTimeout(function() { finish(); }, 600);

      } catch (err) {
        showStatus("llmStatus", err.message, "error");
        btn.disabled = false;
        btn.textContent = "Connect";
      }
    }

    function skipSetup() {
      document.cookie = "setupSkipped=1;path=/;max-age=" + (12 * 60 * 60) + ";secure;samesite=none";
      window.location.href = "/chat";
    }

    function finish() {
      document.getElementById("stepLlm").style.display = "none";
      document.getElementById("stepDone").classList.remove("hidden");
      document.getElementById("skipBtn").style.display = "none";
      document.getElementById("skipNote").style.display = "none";

      var seed = document.getElementById("seedEmoji");
      var title = document.getElementById("doneTitle");
      var sub = document.getElementById("doneSub");
      title.classList.remove("hidden");
      // Phase 1: seed shakes
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
          title.textContent = "You're ready.";
          sub.textContent = "Just start talking. Your tree will grow.";
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
