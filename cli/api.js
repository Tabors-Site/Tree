const fetch = require("node-fetch");
const { load } = require("./config");

function getBase() {
  const cfg = load();
  const site = cfg.landUrl || "https://treeOS.ai";
  return site.replace(/\/+$/, "") + "/api/v1";
}

class TreeAPI {
  constructor(apiKey) {
    this.apiKey = apiKey;
  }

  async _req(method, path, body) {
    const opts = {
      method,
      headers: {
        "x-api-key": this.apiKey,
        "Content-Type": "application/json",
      },
    };
    if (body) opts.body = JSON.stringify(body);

    const res = await fetch(getBase() + path, opts);
    const json = await res.json();

    if (!res.ok) {
      const msg = json.error || json.message || `HTTP ${res.status}`;
      throw new Error(msg);
    }
    return json;
  }

  get(path) {
    return this._req("GET", path);
  }
  post(path, body) {
    return this._req("POST", path, body);
  }
  put(path, body) {
    return this._req("PUT", path, body);
  }
  del(path) {
    return this._req("DELETE", path);
  }

  // ── Land Config ─────────────────────────────────────────────────────────
  getLandConfig() {
    return this.get("/land/config");
  }
  getLandConfigValue(key) {
    return this.get(`/land/config/${encodeURIComponent(key)}`);
  }
  setLandConfig(key, value) {
    return this.put(`/land/config/${encodeURIComponent(key)}`, { value });
  }

  // ── User ─────────────────────────────────────────────────────────────────
  me() {
    return this.get("/me");
  }
  getUser(userId) {
    return this.get(`/user/${userId}`);
  }
  setShareToken(userId, token) {
    return this.post(`/user/${userId}/shareToken`, { htmlShareToken: token });
  }
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
  listUserTags(userId) {
    return this.get(`/user/${userId}/tags`);
  }
  listUserChats(userId) {
    return this.get(`/user/${userId}/chats`);
  }
  listNodeChats(nodeId) {
    return this.get(`/node/${nodeId}/chats`);
  }
  listRootChats(rootId) {
    return this.get(`/root/${rootId}/chats`);
  }

  // ── Root ─────────────────────────────────────────────────────────────────
  getRoot(rootId, opts = {}) {
    const params = new URLSearchParams();
    if (opts.active !== undefined) params.set("active", opts.active);
    if (opts.completed !== undefined) params.set("completed", opts.completed);
    if (opts.trimmed !== undefined) params.set("trimmed", opts.trimmed);
    const qs = params.toString();
    return this.get(`/root/${rootId}${qs ? "?" + qs : ""}`);
  }
  createRoot(userId, name) {
    return this.post(`/user/${userId}/createRoot`, { name });
  }
  getCalendar(rootId, opts = {}) {
    const params = new URLSearchParams();
    if (opts.month != null) params.set("month", opts.month);
    if (opts.year) params.set("year", opts.year);
    const qs = params.toString();
    return this.get(`/root/${rootId}/calendar${qs ? "?" + qs : ""}`);
  }
  setDreamTime(rootId, dreamTime) {
    return this.post(`/root/${rootId}/dream-time`, { dreamTime });
  }
  retireRoot(rootId) {
    return this.post(`/root/${rootId}/retire`, {});
  }
  invite(rootId, userReceiving) {
    return this.post(`/root/${rootId}/invite`, { userReceiving });
  }
  listInvites(userId) {
    return this.get(`/user/${userId}/invites`);
  }
  respondInvite(userId, inviteId, accept) {
    return this.post(`/user/${userId}/invites/${inviteId}`, { accept: String(accept) });
  }
  transferOwner(rootId, userReceiving) {
    return this.post(`/root/${rootId}/transfer-owner`, { userReceiving });
  }
  removeUser(rootId, userReceiving) {
    return this.post(`/root/${rootId}/remove-user`, { userReceiving });
  }

  // ── Node ─────────────────────────────────────────────────────────────────
  getNode(nodeId) {
    return this.get(`/node/${nodeId}`);
  }
  getNodeVersion(nodeId, ver = "latest") {
    return this.get(`/node/${nodeId}/${ver}`);
  }
  createChild(nodeId, name) {
    return this.post(`/node/${nodeId}/createChild`, { name });
  }
  renameNode(nodeId, ver, name) {
    return this.post(`/node/${nodeId}/${ver}/editName`, { name });
  }
  moveNode(nodeId, newParentId) {
    return this.post(`/node/${nodeId}/updateParent`, { newParentId });
  }
  deleteNode(nodeId) {
    return this.post(`/node/${nodeId}/delete`, {});
  }
  setStatus(nodeId, ver, status) {
    return this.post(`/node/${nodeId}/${ver}/editStatus`, {
      status,
      isInherited: true,
    });
  }
  prestige(nodeId, ver = "latest") {
    return this.post(`/node/${nodeId}/${ver}/prestige`, {});
  }
  setSchedule(nodeId, ver, newSchedule, reeffectTime) {
    const body = { newSchedule };
    if (reeffectTime != null) body.reeffectTime = reeffectTime;
    return this.post(`/node/${nodeId}/${ver}/editSchedule`, body);
  }

  // ── Notes ─────────────────────────────────────────────────────────────────
  listNotes(nodeId, ver = "latest", opts = {}) {
    const params = new URLSearchParams();
    if (opts.limit) params.set("limit", opts.limit);
    if (opts.q) params.set("q", opts.q);
    const qs = params.toString();
    return this.get(`/node/${nodeId}/${ver}/notes${qs ? "?" + qs : ""}`);
  }
  // ── Contributions ───────────────────────────────────────────────────────
  listNodeContributions(nodeId, ver = "latest", opts = {}) {
    const params = new URLSearchParams();
    if (opts.limit) params.set("limit", opts.limit);
    const qs = params.toString();
    return this.get(
      `/node/${nodeId}/${ver}/contributions${qs ? "?" + qs : ""}`,
    );
  }
  createNote(nodeId, ver, content) {
    return this.post(`/node/${nodeId}/${ver}/notes`, { content });
  }
  editNote(nodeId, ver, noteId, content) {
    return this.put(`/node/${nodeId}/${ver}/notes/${noteId}`, { content });
  }
  deleteNote(nodeId, ver, noteId) {
    return this.del(`/node/${nodeId}/${ver}/notes/${noteId}`);
  }
  getBook(rootId) {
    return this.get(`/root/${rootId}/book`);
  }
  generateBookShare(nodeId, settings = {}) {
    return this.post(`/root/${nodeId}/book/generate`, settings);
  }

  // ── Values ────────────────────────────────────────────────────────────────
  getValues(nodeId, ver = "latest") {
    return this.get(`/node/${nodeId}/${ver}/values`);
  }
  getRootValues(rootId) {
    return this.get(`/root/${rootId}/values`);
  }
  setValue(nodeId, ver, key, value) {
    return this.post(`/node/${nodeId}/${ver}/value`, { key, value });
  }
  setGoal(nodeId, ver, key, goal) {
    return this.post(`/node/${nodeId}/${ver}/goal`, { key, goal });
  }

  // ── AI ────────────────────────────────────────────────────────────────────
  chat(rootId, message) {
    return this.post(`/root/${rootId}/chat`, { message });
  }
  place(rootId, message) {
    return this.post(`/root/${rootId}/place`, { message });
  }
  query(rootId, message) {
    return this.post(`/root/${rootId}/query`, { message });
  }

  // ── Raw Ideas ───────────────────────────────────────────────────────────────
  listRawIdeas(userId, opts = {}) {
    const params = new URLSearchParams();
    if (opts.status) params.set("status", opts.status);
    if (opts.q) params.set("q", opts.q);
    if (opts.limit) params.set("limit", opts.limit);
    const qs = params.toString();
    return this.get(`/user/${userId}/raw-ideas${qs ? "?" + qs : ""}`);
  }
  getRawIdea(userId, rawIdeaId) {
    return this.get(`/user/${userId}/raw-ideas/${rawIdeaId}`);
  }
  createRawIdea(userId, content) {
    return this.post(`/user/${userId}/raw-ideas`, { content });
  }
  deleteRawIdea(userId, rawIdeaId) {
    return this.del(`/user/${userId}/raw-ideas/${rawIdeaId}`);
  }
  rawIdeaPlace(userId, rawIdeaId) {
    return this.post(`/user/${userId}/raw-ideas/${rawIdeaId}/place`, {});
  }
  rawIdeaPlaceContent(userId, content) {
    return this.post(`/user/${userId}/raw-ideas/place`, { content });
  }
  rawIdeaChat(userId, rawIdeaId) {
    return this.post(`/user/${userId}/raw-ideas/${rawIdeaId}/chat`, {});
  }
  rawIdeaChatContent(userId, content) {
    return this.post(`/user/${userId}/raw-ideas/chat`, { content });
  }
  rawIdeaAutoPlace(userId, enabled) {
    return this.post(`/user/${userId}/raw-ideas/auto-place`, { enabled });
  }
  transferRawIdea(userId, rawIdeaId, nodeId) {
    return this.post(`/user/${userId}/raw-ideas/${rawIdeaId}/transfer`, {
      nodeId,
    });
  }

  // ── Understandings ──────────────────────────────────────────────────────────
  listUnderstandings(rootId) {
    return this.get(`/root/${rootId}/understandings`);
  }
  createUnderstanding(rootId, perspective, incremental = false) {
    return this.post(`/root/${rootId}/understandings`, {
      perspective,
      incremental,
    });
  }
  getUnderstandingRun(rootId, runId) {
    return this.get(`/root/${rootId}/understandings/run/${runId}`);
  }
  orchestrateUnderstanding(rootId, runId) {
    return this.post(
      `/root/${rootId}/understandings/run/${runId}/orchestrate`,
      {},
    );
  }
  stopUnderstanding(rootId, runId) {
    return this.post(`/root/${rootId}/understandings/run/${runId}/stop`, {});
  }

  // ── Blog ─────────────────────────────────────────────────────────────────
  async listBlogPosts() {
    const res = await fetch(BASE + "/blog/posts", {
      headers: { "Content-Type": "application/json" },
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
    return json;
  }
  async getBlogPost(slug) {
    const res = await fetch(BASE + `/blog/posts/${slug}`, {
      headers: { "Content-Type": "application/json" },
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
    return json;
  }
}

module.exports = TreeAPI;
module.exports.BASE_SITE = BASE_SITE;
