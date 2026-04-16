const fetch = require("node-fetch");
const { load } = require("./config");

// ─────────────────────────────────────────────────────────────────────────
// BASE URL + SHARED FETCH
// ─────────────────────────────────────────────────────────────────────────

let _baseCache = null;

function getBase() {
  if (_baseCache) return _baseCache;
  const cfg = load();
  let site = cfg.landUrl || "https://treeOS.ai";
  if (!/^https?:\/\//i.test(site)) {
    const isLocal = site.startsWith("localhost") || site.startsWith("127.") || site.startsWith("192.168.") || site.startsWith("10.");
    site = (isLocal ? "http://" : "https://") + site;
  }
  _baseCache = site.replace(/\/+$/, "") + "/api/v1";
  return _baseCache;
}

function getBaseSite() {
  const cfg = load();
  const site = cfg.landUrl || "https://treeOS.ai";
  return site.replace(/\/+$/, "");
}

// Clear base cache (for tests or after config change)
function clearBaseCache() { _baseCache = null; }

// Matches the land's apiOrchestrationTimeout (19 min default). Long
// builds through the continuation loop or the branch swarm can legitimately
// take 10-15 minutes on a 27B local model — the old 8-min wall was killing
// work that the server was perfectly happy to complete.
const REQUEST_TIMEOUT_MS = 45 * 60 * 1000;
const RETRYABLE_STATUSES = new Set([502, 503, 504]);
const MAX_RETRIES = 1;

/**
 * Core fetch with timeout, retry, JSON parsing, and structured error handling.
 * Single implementation. Every request in the CLI flows through this.
 */
async function coreFetch(url, opts = {}) {
  let lastErr;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      // Jittered backoff before retry
      const delay = 1000 + Math.random() * 1000;
      await new Promise(r => setTimeout(r, delay));
    }

    // Timeout via AbortController
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    // Merge caller's signal with our timeout
    if (opts.signal) {
      opts.signal.addEventListener("abort", () => controller.abort(), { once: true });
    }

    try {
      const res = await fetch(url, { ...opts, signal: controller.signal });
      clearTimeout(timer);

      const text = await res.text();
      let json;
      try {
        json = JSON.parse(text);
      } catch {
        if (res.status === 404) {
          throw Object.assign(
            new Error("Not found (HTTP 404). This feature may require an extension that is not installed."),
            { status: 404 }
          );
        }
        throw Object.assign(
          new Error(`Server returned non-JSON (HTTP ${res.status}). Is the land running?`),
          { status: res.status }
        );
      }

      if (!res.ok) {
        const msg = json.error?.message || json.error?.code || json.message || `HTTP ${res.status}`;
        const err = Object.assign(new Error(msg), {
          status: res.status,
          code: json.error?.code || null,
          detail: json.error?.detail || null,
        });

        // Retry on transient server errors
        if (RETRYABLE_STATUSES.has(res.status) && attempt < MAX_RETRIES) {
          lastErr = err;
          continue;
        }
        throw err;
      }

      return json.data !== undefined ? json.data : json;
    } catch (err) {
      clearTimeout(timer);
      if (err.name === "AbortError") {
        throw new Error(`Request timed out after ${REQUEST_TIMEOUT_MS / 1000}s: ${url}`);
      }
      // Retry on network errors (ECONNREFUSED, ECONNRESET, etc.)
      if (!err.status && attempt < MAX_RETRIES) {
        lastErr = err;
        continue;
      }
      throw err;
    }
  }

  throw lastErr || new Error("Request failed after retries");
}

// ─────────────────────────────────────────────────────────────────────────
// API CLIENT
// ─────────────────────────────────────────────────────────────────────────

class TreeAPI {
  constructor(apiKey, jwtToken) {
    if (!jwtToken) {
      try {
        const cfg = load();
        this.apiKey = apiKey || cfg.apiKey || null;
        this.jwtToken = cfg.jwtToken || null;
        return;
      } catch (err) {
        // Config load failed. Proceed without credentials.
        // Methods that require auth will fail with a clear error.
      }
    }
    this.apiKey = apiKey || null;
    this.jwtToken = jwtToken || null;
  }

  _authHeaders() {
    if (this.apiKey) return { "x-api-key": this.apiKey };
    if (this.jwtToken) return { Authorization: "Bearer " + this.jwtToken };
    return {};
  }

  _req(method, path, body, { signal } = {}) {
    const opts = {
      method,
      headers: { ...this._authHeaders(), "Content-Type": "application/json" },
    };
    if (body) opts.body = JSON.stringify(body);
    if (signal) opts.signal = signal;
    return coreFetch(getBase() + path, opts);
  }

  _canopyReq(method, path, body) {
    const site = getBaseSite();
    const opts = {
      method,
      headers: { ...this._authHeaders(), "Content-Type": "application/json" },
    };
    if (body) opts.body = JSON.stringify(body);
    return coreFetch(site + path, opts);
  }

  get(path, opts) { return this._req("GET", path, null, opts); }
  post(path, body, opts) { return this._req("POST", path, body, opts); }
  put(path, body, opts) { return this._req("PUT", path, body, opts); }
  del(path, opts) { return this._req("DELETE", path, null, opts); }

  // ── Land Config ───────────────────────────────────────────────────────
  getLandRoot() { return this.get("/land/root"); }
  getLandConfig() { return this.get("/land/config"); }
  getLandConfigValue(key) { return this.get(`/land/config/${encodeURIComponent(key)}`); }
  setLandConfig(key, value) { return this.put(`/land/config/${encodeURIComponent(key)}`, { value }); }

  // ── Extensions ────────────────────────────────────────────────────────
  getExtensions() { return this.get("/land/extensions"); }
  getExtension(name) { return this.get(`/land/extensions/${encodeURIComponent(name)}`); }
  disableExtension(name) { return this.post(`/land/extensions/${encodeURIComponent(name)}/disable`); }
  enableExtension(name) { return this.post(`/land/extensions/${encodeURIComponent(name)}/enable`); }
  uninstallExtension(name) { return this.post(`/land/extensions/${encodeURIComponent(name)}/uninstall`); }
  publishExtension(name, opts = {}) { return this.post(`/land/extensions/${encodeURIComponent(name)}/publish`, opts); }

  async getHorizonVersions(name) {
    const horizonUrl = await this._getHorizonUrl();
    try {
      const data = await coreFetch(
        `${horizonUrl}/extensions/${encodeURIComponent(name)}`,
        { headers: { "Content-Type": "application/json" } },
      );
      return (data.versions || []).map((v) => v.version);
    } catch {
      return [];
    }
  }

  async installExtension(name, version) {
    const horizonUrl = await this._getHorizonUrl();
    const data = await coreFetch(
      `${horizonUrl}/extensions/${encodeURIComponent(name)}${version ? `/${version}` : ""}`,
      { headers: { "Content-Type": "application/json" } },
    );

    const ext = version ? data : data.latest;
    if (!ext) throw new Error("Extension not found");

    // Fetch full version with files if needed
    if (!ext.files) {
      const fullData = await coreFetch(
        `${horizonUrl}/extensions/${encodeURIComponent(name)}/${ext.version}`,
        { headers: { "Content-Type": "application/json" } },
      );
      ext.files = fullData.files;
      ext.manifest = fullData.manifest;
    }

    // Validate before sending to land
    if (!ext.files || !Array.isArray(ext.files) || ext.files.length === 0) {
      throw new Error("Extension has no files. Registry may be corrupted.");
    }
    if (!ext.manifest || !ext.manifest.name) {
      throw new Error("Extension has no manifest. Registry may be corrupted.");
    }

    return this.post("/land/extensions/install", {
      name: ext.name || name,
      version: ext.version,
      manifest: ext.manifest,
      files: ext.files,
    });
  }

  async searchRegistry(query) {
    const horizonUrl = await this._getHorizonUrl();
    const qs = query ? `?q=${encodeURIComponent(query)}` : "";
    return coreFetch(`${horizonUrl}/extensions${qs}`, {
      headers: { "Content-Type": "application/json" },
    });
  }

  async _getHorizonUrl() {
    const config = await this.get("/land/config/HORIZON_URL").catch(() => null);
    if (config?.value) {
      let url = config.value;
      if (!/^https?:\/\//i.test(url)) url = "https://" + url;
      return url.replace(/\/+$/, "");
    }
    return "https://horizon.treeos.ai";
  }

  // ── API Keys ──────────────────────────────────────────────────────────
  listApiKeys(userId) { return this.get(`/user/${userId}/api-keys`); }
  createApiKey(userId, name) { return this.post(`/user/${userId}/api-keys`, { name }); }
  deleteApiKey(userId, keyId) { return this.del(`/user/${userId}/api-keys/${keyId}`); }

  // ── Custom LLM ────────────────────────────────────────────────────────
  listLlmConnections(userId) { return this.get(`/user/${userId}/custom-llm`); }
  addLlmConnection(userId, { name, baseUrl, apiKey, model }) {
    return this.post(`/user/${userId}/custom-llm`, { name, baseUrl, apiKey, model });
  }
  updateLlmConnection(userId, connectionId, fields) {
    return this.put(`/user/${userId}/custom-llm/${connectionId}`, fields);
  }
  deleteLlmConnection(userId, connectionId) {
    return this.del(`/user/${userId}/custom-llm/${connectionId}`);
  }
  assignLlm(userId, slot, connectionId) {
    return this.post(`/user/${userId}/llm-assign`, { slot, connectionId });
  }
  assignTreeLlm(rootId, slot, connectionId) {
    return this.post(`/root/${rootId}/llm-assign`, { slot, connectionId });
  }

  // ── User ──────────────────────────────────────────────────────────────
  me() { return this.get("/me"); }
  getUser(userId) { return this.get(`/user/${userId}`); }
  setShareToken(userId, token) { return this.post(`/user/${userId}/shareToken`, { htmlShareToken: token }); }

  listUserNotes(userId, opts = {}) {
    const params = new URLSearchParams();
    if (opts.limit) params.set("limit", opts.limit);
    if (opts.q) params.set("q", opts.q);
    const qs = params.toString();
    return this.get(`/user/${userId}/notes${qs ? "?" + qs : ""}`);
  }
  listUserContributions(userId, opts = {}) {
    const params = new URLSearchParams();
    if (opts.limit) params.set("limit", opts.limit);
    const qs = params.toString();
    return this.get(`/user/${userId}/contributions${qs ? "?" + qs : ""}`);
  }
  listUserTags(userId) { return this.get(`/user/${userId}/tags`); }
  listUserChats(userId) { return this.get(`/user/${userId}/chats`); }
  listNodeChats(nodeId) { return this.get(`/node/${nodeId}/chats`); }
  listRootChats(rootId) { return this.get(`/root/${rootId}/chats`); }

  // ── Root ──────────────────────────────────────────────────────────────
  getRoot(rootId, opts = {}) {
    const params = new URLSearchParams();
    if (opts.active !== undefined) params.set("active", opts.active);
    if (opts.completed !== undefined) params.set("completed", opts.completed);
    if (opts.trimmed !== undefined) params.set("trimmed", opts.trimmed);
    const qs = params.toString();
    return this.get(`/root/${rootId}${qs ? "?" + qs : ""}`);
  }
  createRoot(userId, name, type) {
    const body = { name };
    if (type) body.type = type;
    return this.post(`/user/${userId}/createRoot`, body);
  }
  getCalendar(rootId, opts = {}) {
    const params = new URLSearchParams();
    if (opts.month != null) params.set("month", opts.month);
    if (opts.year) params.set("year", opts.year);
    const qs = params.toString();
    return this.get(`/root/${rootId}/calendar${qs ? "?" + qs : ""}`);
  }
  setDreamTime(rootId, dreamTime) { return this.post(`/root/${rootId}/dream-time`, { dreamTime }); }
  retireRoot(rootId) { return this.post(`/root/${rootId}/retire`, {}); }
  setVisibility(rootId, visibility) { return this.post(`/root/${rootId}/visibility`, { visibility }); }
  invite(rootId, userReceiving) { return this.post(`/root/${rootId}/invite`, { userReceiving }); }
  listInvites(userId) { return this.get(`/user/${userId}/invites`); }
  respondInvite(userId, inviteId, accept) {
    return this.post(`/user/${userId}/invites/${inviteId}`, { accept: String(accept) });
  }
  transferOwner(rootId, userReceiving) { return this.post(`/root/${rootId}/transfer-owner`, { userReceiving }); }
  removeUser(rootId, userReceiving) { return this.post(`/root/${rootId}/remove-user`, { userReceiving }); }

  // ── Node ──────────────────────────────────────────────────────────────
  getNode(nodeId) { return this.get(`/node/${nodeId}`); }
  getNodeVersion(nodeId, ver = "latest") { return this.get(`/node/${nodeId}/${ver}`); }
  createChild(nodeId, name, type) {
    const body = { name };
    if (type) body.type = type;
    return this.post(`/node/${nodeId}/createChild`, body);
  }
  renameNode(nodeId, name) { return this.post(`/node/${nodeId}/editName`, { name }); }
  moveNode(nodeId, newParentId) { return this.post(`/node/${nodeId}/updateParent`, { newParentId }); }
  deleteNode(nodeId) { return this.post(`/node/${nodeId}/delete`, {}); }
  getDeleted(userId) { return this.get(`/user/${userId}/deleted`); }
  revive(userId, nodeId, targetParentId) {
    return this.post(`/user/${userId}/deleted/${nodeId}/revive`, { targetParentId });
  }
  reviveAsRoot(userId, nodeId) { return this.post(`/user/${userId}/deleted/${nodeId}/reviveAsRoot`); }
  setStatus(nodeId, status) {
    return this.post(`/node/${nodeId}/editStatus`, { status, isInherited: true });
  }
  prestige(nodeId) { return this.post(`/node/${nodeId}/prestige`, {}); }
  setSchedule(nodeId, newSchedule, reeffectTime) {
    const body = { newSchedule };
    if (reeffectTime != null) body.reeffectTime = reeffectTime;
    return this.post(`/node/${nodeId}/editSchedule`, body);
  }

  // ── Notes ─────────────────────────────────────────────────────────────
  listNotes(nodeId, opts = {}) {
    const params = new URLSearchParams();
    if (opts.limit) params.set("limit", opts.limit);
    if (opts.q) params.set("q", opts.q);
    const qs = params.toString();
    const base = opts.version != null ? `/node/${nodeId}/${opts.version}/notes` : `/node/${nodeId}/notes`;
    return this.get(`${base}${qs ? "?" + qs : ""}`);
  }
  listNodeContributions(nodeId, opts = {}) {
    const params = new URLSearchParams();
    if (opts.limit) params.set("limit", opts.limit);
    const qs = params.toString();
    const base = opts.version != null ? `/node/${nodeId}/${opts.version}/contributions` : `/node/${nodeId}/contributions`;
    return this.get(`${base}${qs ? "?" + qs : ""}`);
  }
  createNote(nodeId, content) { return this.post(`/node/${nodeId}/notes`, { content }); }
  async uploadNote(nodeId, filePath) {
    const FormData = require("form-data");
    const fs = require("fs");
    const path = require("path");
    const form = new FormData();
    form.append("file", fs.createReadStream(filePath), path.basename(filePath));
    return coreFetch(getBase() + `/node/${nodeId}/0/notes`, {
      method: "POST",
      headers: { ...this._authHeaders(), ...form.getHeaders() },
      body: form,
    });
  }
  editNote(nodeId, noteId, content) { return this.put(`/node/${nodeId}/notes/${noteId}`, { content }); }
  deleteNote(nodeId, noteId) { return this.del(`/node/${nodeId}/notes/${noteId}`); }
  getBook(rootId) { return this.get(`/root/${rootId}/book`); }
  generateBookShare(nodeId, settings = {}) { return this.post(`/root/${nodeId}/book/generate`, settings); }

  // ── Values ────────────────────────────────────────────────────────────
  getValues(nodeId, version) {
    const base = version != null ? `/node/${nodeId}/${version}/values` : `/node/${nodeId}/values`;
    return this.get(base);
  }
  getRootValues(rootId) { return this.get(`/root/${rootId}/values`); }
  setValue(nodeId, key, value) { return this.post(`/node/${nodeId}/value`, { key, value }); }
  setGoal(nodeId, key, goal) { return this.post(`/node/${nodeId}/goal`, { key, goal }); }

  // ── AI ────────────────────────────────────────────────────────────────
  chat(rootId, message, opts) {
    const body = { message };
    if (opts?.sessionHandle) body.sessionHandle = opts.sessionHandle;
    if (opts?.currentNodeId) body.currentNodeId = opts.currentNodeId;
    return this.post(`/root/${rootId}/chat`, body, opts);
  }
  place(rootId, message, opts) { return this.post(`/root/${rootId}/place`, { message }, opts); }
  query(rootId, message, opts) { return this.post(`/root/${rootId}/query`, { message }, opts); }
  be(rootId, message, opts) {
    const body = { message };
    if (opts?.currentNodeId) body.currentNodeId = opts.currentNodeId;
    return this.post(`/root/${rootId}/be`, body, opts);
  }

  // ── Raw Ideas ─────────────────────────────────────────────────────────
  listRawIdeas(userId, opts = {}) {
    const params = new URLSearchParams();
    if (opts.status) params.set("status", opts.status);
    if (opts.q) params.set("q", opts.q);
    if (opts.limit) params.set("limit", opts.limit);
    const qs = params.toString();
    return this.get(`/user/${userId}/raw-ideas${qs ? "?" + qs : ""}`);
  }
  getRawIdea(userId, rawIdeaId) { return this.get(`/user/${userId}/raw-ideas/${rawIdeaId}`); }
  createRawIdea(userId, content) { return this.post(`/user/${userId}/raw-ideas`, { content }); }
  deleteRawIdea(userId, rawIdeaId) { return this.del(`/user/${userId}/raw-ideas/${rawIdeaId}`); }
  rawIdeaPlace(userId, rawIdeaId) { return this.post(`/user/${userId}/raw-ideas/${rawIdeaId}/place`, {}); }
  rawIdeaPlaceContent(userId, content) { return this.post(`/user/${userId}/raw-ideas/place`, { content }); }
  rawIdeaChat(userId, rawIdeaId) { return this.post(`/user/${userId}/raw-ideas/${rawIdeaId}/chat`, {}); }
  rawIdeaChatContent(userId, content) { return this.post(`/user/${userId}/raw-ideas/chat`, { content }); }
  rawIdeaAutoPlace(userId, enabled) { return this.post(`/user/${userId}/raw-ideas/auto-place`, { enabled }); }
  transferRawIdea(userId, rawIdeaId, nodeId) {
    return this.post(`/user/${userId}/raw-ideas/${rawIdeaId}/transfer`, { nodeId });
  }

  // ── Understandings ────────────────────────────────────────────────────
  listUnderstandings(rootId) { return this.get(`/root/${rootId}/understandings`); }
  createUnderstanding(rootId, perspective, incremental = false) {
    return this.post(`/root/${rootId}/understandings`, { perspective, incremental });
  }
  getUnderstandingRun(rootId, runId) { return this.get(`/root/${rootId}/understandings/run/${runId}`); }
  orchestrateUnderstanding(rootId, runId) {
    return this.post(`/root/${rootId}/understandings/run/${runId}/orchestrate`, {});
  }
  stopUnderstanding(rootId, runId) { return this.post(`/root/${rootId}/understandings/run/${runId}/stop`, {}); }

  // ── Blog ──────────────────────────────────────────────────────────────
  listBlogPosts() { return this.get("/blog/posts"); }
  getBlogPost(slug) { return this.get(`/blog/posts/${slug}`); }

  // ── Canopy (federation) ───────────────────────────────────────────────
  listPeers() { return this._canopyReq("GET", "/canopy/admin/peers"); }
  addPeer(url) { return this._canopyReq("POST", "/canopy/admin/peer/add", { url }); }
  removePeer(domain) { return this._canopyReq("DELETE", `/canopy/admin/peer/${encodeURIComponent(domain)}`); }
  blockPeer(domain) { return this._canopyReq("POST", `/canopy/admin/peer/${encodeURIComponent(domain)}/block`); }
  unblockPeer(domain) { return this._canopyReq("POST", `/canopy/admin/peer/${encodeURIComponent(domain)}/unblock`); }
  discoverPeer(domain) { return this._canopyReq("POST", "/canopy/admin/peer/discover", { domain }); }
  heartbeat() { return this._canopyReq("POST", "/canopy/admin/heartbeat"); }
  searchLands(q) {
    const qs = q ? `?q=${encodeURIComponent(q)}` : "";
    return this._canopyReq("GET", `/canopy/admin/horizon/lands${qs}`);
  }
  searchTrees(q) {
    const qs = q ? `?q=${encodeURIComponent(q)}` : "";
    return this._canopyReq("GET", `/canopy/admin/horizon/trees${qs}`);
  }
  getRemotePublicTrees(domain, q) {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    const qs = params.toString();
    return this._canopyReq("GET", `/canopy/proxy/${encodeURIComponent(domain)}/canopy/public-trees${qs ? "?" + qs : ""}`);
  }
  proxyGet(domain, path) {
    return this._canopyReq("GET", `/canopy/proxy/${encodeURIComponent(domain)}${path}`);
  }
  proxyPost(domain, path, body) {
    return this._canopyReq("POST", `/canopy/proxy/${encodeURIComponent(domain)}${path}`, body);
  }
}

// ─────────────────────────────────────────────────────────────────────────
// STANDALONE HELPERS (register/login, before API key exists)
// ─────────────────────────────────────────────────────────────────────────

function unauthPost(path, body) {
  return coreFetch(getBase() + path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function jwtPost(token, path, body) {
  return coreFetch(getBase() + path, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
    body: body ? JSON.stringify(body) : undefined,
  });
}

function jwtGet(token, path) {
  return coreFetch(getBase() + path, {
    method: "GET",
    headers: { Authorization: "Bearer " + token },
  });
}

/**
 * Create a proxy-aware API wrapper. When remoteDomain is set,
 * all /api/v1 requests route through /canopy/proxy/:domain/api/v1/...
 */
function createProxyApi(apiKey, remoteDomain) {
  if (!remoteDomain) return new TreeAPI(apiKey);
  const api = new TreeAPI(apiKey);
  api._req = function (method, path, body) {
    return api._canopyReq(method, `/canopy/proxy/${encodeURIComponent(remoteDomain)}/api/v1${path}`, body);
  };
  api._isProxy = true;
  api._remoteDomain = remoteDomain;
  return api;
}

module.exports = TreeAPI;
module.exports.getBaseSite = getBaseSite;
module.exports.clearBaseCache = clearBaseCache;
module.exports.createProxyApi = createProxyApi;
module.exports.unauthPost = unauthPost;
module.exports.jwtPost = jwtPost;
module.exports.jwtGet = jwtGet;
