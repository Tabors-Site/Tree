/* ------------------------------------------------- */
/* Gateway page (extracted from root.js)             */
/* ------------------------------------------------- */

import { page } from "../../html-rendering/html/layout.js";
import { escapeHtml } from "../../html-rendering/html/utils.js";

export function renderGateway({ rootId, rootName, queryString, channels }) {
  const channelRows = channels.length === 0
    ? '<p style="color:rgba(255,255,255,0.5);font-size:0.9rem;">No channels configured yet. Add one below.</p>'
    : channels.map(function(ch) {
        var typeBadge = ch.type === "telegram" ? "TG"
          : ch.type === "discord" ? "DC"
          : "WEB";
        var typeColor = ch.type === "telegram" ? "rgba(0,136,204,0.8)"
          : ch.type === "discord" ? "rgba(88,101,242,0.8)"
          : "rgba(72,187,120,0.8)";
        var statusDot = ch.enabled
          ? '<span style="color:rgba(72,187,120,0.9);">&#9679;</span>'
          : '<span style="color:rgba(255,107,107,0.9);">&#9679;</span>';
        var notifList = (ch.notificationTypes || []).join(", ");
        var lastDispatch = ch.lastDispatchAt
          ? new Date(ch.lastDispatchAt).toLocaleString()
          : "Never";
        var lastErr = ch.lastError
          ? '<span style="color:rgba(255,107,107,0.8);font-size:0.75rem;">' + escapeHtml(ch.lastError) + '</span>'
          : '';

        var dirLabel = ch.direction === "input-output" ? "I/O"
          : ch.direction === "input" ? "IN"
          : "OUT";
        var modeLabel = ch.mode === "read-write" ? "CHAT"
          : ch.mode === "read" ? "QUERY"
          : "PLACE";

        return `
<div class="channel-row" data-id="${ch._id}" style="
  background:rgba(255,255,255,0.06);border-radius:12px;padding:16px;margin-bottom:12px;
  border:1px solid rgba(255,255,255,0.1);position:relative;">
  <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;">
    <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
      ${statusDot}
      <span style="font-weight:600;color:#fff;">${escapeHtml(ch.name)}</span>
      <span style="background:${typeColor};color:#fff;font-size:0.7rem;padding:2px 8px;border-radius:4px;font-weight:600;">${typeBadge}</span>
      <span style="background:rgba(255,255,255,0.12);color:rgba(255,255,255,0.7);font-size:0.65rem;padding:2px 6px;border-radius:4px;">${dirLabel}</span>
      <span style="background:rgba(255,255,255,0.08);color:rgba(255,255,255,0.5);font-size:0.65rem;padding:2px 6px;border-radius:4px;">${modeLabel}</span>
    </div>
    <div style="display:flex;gap:8px;">
      <button onclick="testChannel('${ch._id}')" style="
        padding:4px 12px;border-radius:6px;border:1px solid rgba(115,111,230,0.4);
        background:rgba(115,111,230,0.15);color:rgba(200,200,255,0.9);font-size:0.8rem;cursor:pointer;">
        Test</button>
      <button onclick="toggleChannel('${ch._id}', ${!ch.enabled})" style="
        padding:4px 12px;border-radius:6px;border:1px solid rgba(255,179,71,0.4);
        background:rgba(255,179,71,0.1);color:rgba(255,179,71,0.9);font-size:0.8rem;cursor:pointer;">
        ${ch.enabled ? "Disable" : "Enable"}</button>
      <button onclick="deleteChannel('${ch._id}')" style="
        padding:4px 12px;border-radius:6px;border:1px solid rgba(255,107,107,0.4);
        background:rgba(255,107,107,0.1);color:rgba(255,107,107,0.8);font-size:0.8rem;cursor:pointer;">
        Delete</button>
    </div>
  </div>
  <div style="margin-top:8px;font-size:0.8rem;color:rgba(255,255,255,0.5);">
    ${ch.config?.displayIdentifier ? escapeHtml(ch.config.displayIdentifier) + ' &middot; ' : ''}
    ${notifList} &middot; Last sent: ${lastDispatch}
  </div>
  ${lastErr ? '<div style="margin-top:4px;">' + lastErr + '</div>' : ''}
</div>`;
      }).join('\n');

  const css = `
    body { color: #fff; }
    .content-card {
      background: rgba(var(--glass-water-rgb), var(--glass-alpha));
      backdrop-filter: blur(22px) saturate(140%);
      border-radius: 16px; padding: 28px;
      box-shadow: 0 8px 32px rgba(0,0,0,0.12), inset 0 1px 0 rgba(255,255,255,0.25);
      border: 1px solid rgba(255,255,255,0.28);
      margin-bottom: 24px; animation: fadeInUp 0.6s ease-out both;
    }
    .section-header h2 { color: #fff; font-size: 1.3rem; font-weight: 700; margin-bottom: 16px; }
    .back-nav {
      display: flex; gap: 12px; margin-bottom: 20px; animation: fadeInUp 0.5s ease-out;
    }
    .back-nav a {
      background: rgba(var(--glass-water-rgb), 0.25);
      backdrop-filter: blur(12px); border-radius: 10px; padding: 8px 16px;
      color: rgba(255,255,255,0.9); text-decoration: none; font-size: 0.85rem;
      border: 1px solid rgba(255,255,255,0.15); font-weight: 500;
    }
    .back-nav a:hover { background: rgba(var(--glass-water-rgb), 0.35); }
    label { display: block; font-size: 0.85rem; color: rgba(255,255,255,0.7); margin-bottom: 4px; margin-top: 12px; }
    input, select {
      width: 100%; padding: 10px 14px; border-radius: 8px;
      border: 1px solid rgba(255,255,255,0.15); background: rgba(255,255,255,0.08);
      color: #fff; font-size: 0.9rem; outline: none;
    }
    input::placeholder { color: rgba(255,255,255,0.7); }
    input:focus, select:focus { border-color: rgba(115,111,230,0.6); }
    select option { background: #3a3a6e; color: #fff; }
    .btn-primary {
      padding: 10px 20px; border-radius: 8px; border: 1px solid rgba(72,187,120,0.4);
      background: rgba(72,187,120,0.15); color: rgba(72,187,120,0.95);
      font-weight: 600; cursor: pointer; font-size: 0.9rem; margin-top: 16px;
    }
    .btn-primary:hover { background: rgba(72,187,120,0.25); }
    .checkbox-row {
      display: flex; align-items: center; gap: 8px; margin-top: 6px;
    }
    .checkbox-row input[type="checkbox"] { width: auto; }
    #gatewayStatus {
      display: none; font-size: 0.85rem; margin-top: 12px; padding: 8px 12px;
      border-radius: 8px;
    }
`;

  const body = `
<div class="container">

  <div class="back-nav">
    <a href="/api/v1/root/${rootId}${queryString}">Back to Tree</a>
  </div>

  <div class="content-card">
    <div class="section-header">
      <h2>Gateway Channels</h2>
    </div>
    <p style="color:rgba(255,255,255,0.6);font-size:0.85rem;margin-bottom:16px;">
      Output channels push notifications from this tree to external services.
    </p>
    <div id="channelList">
      ${channelRows}
    </div>
  </div>

  <div class="content-card" style="animation-delay:0.1s;">
    <div class="section-header">
      <h2>Add Channel</h2>
    </div>

    <label for="channelName">Channel Name</label>
    <input type="text" id="channelName" placeholder="e.g. My Discord Updates" maxlength="100" />

    <label for="channelType">Type</label>
    <select id="channelType" onchange="updateFormFields()">
      <option value="telegram">Telegram</option>
      <option value="discord">Discord</option>
      <option value="webapp">Web Push (this browser)</option>
    </select>

    <label for="channelDirection">Direction</label>
    <select id="channelDirection" onchange="updateFormFields()">
      <option value="output">Output (send notifications out)</option>
      <option value="input">Input (receive messages in)</option>
      <option value="input-output">Input/Output (bidirectional chat)</option>
    </select>

    <label for="channelMode">Mode</label>
    <select id="channelMode">
      <option value="write">Place (scans tree, makes edits, no response)</option>
      <option value="read">Query (reads tree, responds, no edits)</option>
      <option value="read-write">Chat (reads tree, makes edits, responds)</option>
    </select>

    <div id="telegramFields" style="margin-top:8px;">
      <label for="tgBotToken">Bot Token</label>
      <input type="password" id="tgBotToken" placeholder="123456:ABC-DEF..." />
      <label for="tgChatId">Chat ID</label>
      <input type="text" id="tgChatId" placeholder="-1001234567890" />
    </div>

    <div id="discordOutputFields" style="display:none;">
      <label for="dcWebhookUrl">Webhook URL</label>
      <input type="password" id="dcWebhookUrl" placeholder="https://discord.com/api/webhooks/..." />
    </div>

    <div id="discordInputFields" style="display:none;">
      <div style="background:rgba(255,255,255,0.05);border-radius:8px;padding:12px;margin-top:8px;margin-bottom:12px;border:1px solid rgba(255,255,255,0.1);">
        <div style="color:rgba(255,255,255,0.8);font-size:0.82rem;font-weight:600;margin-bottom:8px;">How to get your Discord bot details:</div>
        <ol style="color:rgba(255,255,255,0.6);font-size:0.8rem;margin:0;padding-left:18px;line-height:1.6;">
          <li>Go to <a href="https://discord.com/developers/applications" target="_blank" style="color:#1a1a1a;">Discord Developer Portal</a></li>
          <li>Create a New Application, then go to the <strong>Bot</strong> tab</li>
          <li>Click "Reset Token" to get your bot token and copy it</li>
          <li>Enable <strong>Message Content Intent</strong> under Privileged Gateway Intents</li>
          <li>Go to <strong>Installation</strong> tab, set integration type to <strong>Guild Install</strong></li>
          <li>Go to <strong>OAuth2</strong> tab, check <em>bot</em> scope, then under Bot Permissions check <strong>Read Message History</strong> and <strong>Send Messages</strong></li>
          <li>Copy the generated URL and open it to invite the bot to your server</li>
          <li>In Discord, right-click the channel you want, click "Copy Channel ID"<br/>(Enable Developer Mode in Discord Settings > Advanced if you don't see it)</li>
        </ol>
      </div>
      <label for="dcBotToken">Bot Token</label>
      <input type="password" id="dcBotToken" placeholder="Discord bot token..." />
      <label for="dcChannelId">Discord Channel ID</label>
      <input type="text" id="dcChannelId" placeholder="1234567890123456789" />
      <p style="color:rgba(255,179,71,0.7);font-size:0.8rem;margin-top:6px;">
        Discord input requires Standard, Premium, or God tier.
      </p>
    </div>

    <div id="webappFields" style="display:none;">
      <p style="color:rgba(255,255,255,0.6);font-size:0.85rem;margin-top:12px;">
        Your browser will ask for notification permission when you add this channel.
      </p>
    </div>

    <div id="outputNotifSection" style="display:none;">
      <label style="margin-top:16px;">Notification Types</label>
      <div class="checkbox-row">
        <input type="checkbox" id="notifSummary" checked /> <label for="notifSummary" style="margin:0;">Dream Summary</label>
      </div>
      <div class="checkbox-row">
        <input type="checkbox" id="notifThought" checked /> <label for="notifThought" style="margin:0;">Dream Thought</label>
      </div>
    </div>

    <div id="inputConfigSection" style="display:none;">
      <label for="queueBehavior" style="margin-top:16px;">When Busy (2+ messages processing)</label>
      <select id="queueBehavior">
        <option value="respond">Respond with busy message</option>
        <option value="silent">Stay silent</option>
      </select>
    </div>

    <button class="btn-primary" onclick="addChannel()">Add Channel</button>
    <div id="gatewayStatus"></div>
  </div>

</div>
`;

  const js = `
var ROOT_ID = "${rootId}";

function updateFormFields() {
  var type = document.getElementById("channelType").value;
  var direction = document.getElementById("channelDirection").value;
  var hasOutput = direction === "output" || direction === "input-output";

  // Webapp can only be output
  var dirSelect = document.getElementById("channelDirection");
  var modeSelect = document.getElementById("channelMode");
  var modeLabel = document.querySelector('label[for="channelMode"]');
  if (type === "webapp") {
    dirSelect.value = "output";
    dirSelect.disabled = true;
    hasOutput = true;
  } else {
    dirSelect.disabled = false;
  }

  // Mode only relevant for channels with input capability
  var hasInput = direction === "input" || direction === "input-output";
  modeSelect.style.display = hasInput ? "block" : "none";
  modeLabel.style.display = hasInput ? "block" : "none";

  // Smart defaults per direction
  if (direction === "input") {
    modeSelect.value = "write";
  } else if (direction === "input-output") {
    modeSelect.value = "read-write";
  }

  // Telegram: always show (same bot token + chat ID for input and output)
  document.getElementById("telegramFields").style.display = type === "telegram" ? "block" : "none";

  // Discord: show different fields based on direction
  document.getElementById("discordOutputFields").style.display = (type === "discord" && !hasInput) ? "block" : "none";
  document.getElementById("discordInputFields").style.display = (type === "discord" && hasInput) ? "block" : "none";

  // Webapp: only on output
  document.getElementById("webappFields").style.display = (type === "webapp" && hasOutput) ? "block" : "none";

  // Notification types: only for output channels
  document.getElementById("outputNotifSection").style.display = hasOutput ? "block" : "none";

  // Queue behavior: only for input channels
  document.getElementById("inputConfigSection").style.display = hasInput ? "block" : "none";
}

function showStatus(msg, isError) {
  var el = document.getElementById("gatewayStatus");
  el.style.display = "block";
  el.style.background = isError ? "rgba(255,107,107,0.15)" : "rgba(72,187,120,0.15)";
  el.style.color = isError ? "rgba(255,107,107,0.95)" : "rgba(72,187,120,0.95)";
  el.textContent = msg;
  if (!isError) setTimeout(function() { el.style.display = "none"; }, 4000);
}

async function getWebPushSubscription() {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
    throw new Error("Push notifications are not supported in this browser");
  }

  var permission = await Notification.requestPermission();
  if (permission !== "granted") {
    throw new Error("Notification permission denied");
  }

  var reg = await navigator.serviceWorker.register("/sw.js");
  await navigator.serviceWorker.ready;

  var vapidRes = await fetch("/api/v1/root/" + ROOT_ID + "/gateway/vapid-key")
    .then(function(r) { return r.json(); });
  var vapidKey = vapidRes.data || vapidRes;

  if (!vapidKey.key) throw new Error("VAPID key not configured on server");

  var sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(vapidKey.key),
  });

  return sub.toJSON();
}

function urlBase64ToUint8Array(base64String) {
  var padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  var base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  var rawData = atob(base64);
  var outputArray = new Uint8Array(rawData.length);
  for (var i = 0; i < rawData.length; i++) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

async function addChannel() {
  var name = document.getElementById("channelName").value.trim();
  var type = document.getElementById("channelType").value;
  var direction = document.getElementById("channelDirection").value;
  var mode = document.getElementById("channelMode").value;
  var hasOutput = direction === "output" || direction === "input-output";
  var hasInput = direction === "input" || direction === "input-output";

  if (!name) { showStatus("Please enter a channel name", true); return; }

  var config = {};

  try {
    if (type === "telegram") {
      // Telegram always needs bot token + chat ID
      var botToken = document.getElementById("tgBotToken").value.trim();
      var chatId = document.getElementById("tgChatId").value.trim();
      if (!botToken || !chatId) { showStatus("Bot token and chat ID are required", true); return; }
      config = { botToken: botToken, chatId: chatId };
    } else if (type === "discord") {
      if (hasInput) {
        // Discord input: bot token + channel ID
        var dcBotToken = document.getElementById("dcBotToken").value.trim();
        var dcChannelId = document.getElementById("dcChannelId").value.trim();
        if (!dcBotToken || !dcChannelId) { showStatus("Bot token and channel ID are required for Discord input", true); return; }
        config = { botToken: dcBotToken, discordChannelId: dcChannelId };
        // For input-output, optionally add webhook URL for output side
        if (hasOutput) {
          var webhookUrl = document.getElementById("dcWebhookUrl").value.trim();
          if (webhookUrl) config.webhookUrl = webhookUrl;
        }
      } else {
        // Discord output-only: webhook URL
        var webhookUrl = document.getElementById("dcWebhookUrl").value.trim();
        if (!webhookUrl) { showStatus("Webhook URL is required", true); return; }
        config = { webhookUrl: webhookUrl };
      }
    } else if (type === "webapp") {
      var subscription = await getWebPushSubscription();
      config = { subscription: subscription, displayIdentifier: navigator.userAgent.split(" ").pop() || "Browser" };
    }
  } catch (err) {
    showStatus(err.message, true);
    return;
  }

  var notificationTypes = [];
  if (hasOutput) {
    if (document.getElementById("notifSummary").checked) notificationTypes.push("dream-summary");
    if (document.getElementById("notifThought").checked) notificationTypes.push("dream-thought");
    if (notificationTypes.length === 0 && direction === "output") { showStatus("Select at least one notification type", true); return; }
  }

  var queueBehavior = hasInput ? document.getElementById("queueBehavior").value : "respond";

  try {
    var res = await fetch("/api/v1/root/" + ROOT_ID + "/gateway/channels", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: name, type: type, direction: direction, mode: mode, config: config, notificationTypes: notificationTypes, queueBehavior: queueBehavior }),
    });
    var data = await res.json();
    if (!res.ok) { showStatus((data.error && data.error.message) || data.error || "Failed to add channel", true); return; }
    showStatus("Channel added successfully");
    setTimeout(function() { location.reload(); }, 1000);
  } catch (err) {
    showStatus("Network error: " + err.message, true);
  }
}

async function testChannel(channelId) {
  try {
    var res = await fetch("/api/v1/root/" + ROOT_ID + "/gateway/channels/" + channelId + "/test", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
    });
    var data = await res.json();
    if (!res.ok) { alert((data.error && data.error.message) || data.error || "Test failed"); return; }
    alert("Test notification sent!");
  } catch (err) { alert("Network error"); }
}

async function toggleChannel(channelId, enabled) {
  try {
    var res = await fetch("/api/v1/root/" + ROOT_ID + "/gateway/channels/" + channelId, {
      method: "PUT",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: enabled }),
    });
    if (res.ok) location.reload();
    else { var data = await res.json(); alert((data.error && data.error.message) || data.error || "Failed"); }
  } catch (err) { alert("Network error"); }
}

async function deleteChannel(channelId) {
  if (!confirm("Delete this channel?")) return;
  try {
    var res = await fetch("/api/v1/root/" + ROOT_ID + "/gateway/channels/" + channelId, {
      method: "DELETE",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
    });
    if (res.ok) location.reload();
    else { var data = await res.json(); alert((data.error && data.error.message) || data.error || "Failed"); }
  } catch (err) { alert("Network error"); }
}
`;

  return page({
    title: `Gateway -- ${escapeHtml(rootName)}`,
    css,
    body,
    js,
  });
}
