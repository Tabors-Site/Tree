// TreeOS Portal client. Speaks IBP (Inter-Being Protocol).
//
// Wraps a Socket.IO connection and exposes typed methods for the four
// IBP verbs (see / do / summon / be). Speaks only IBP, never raw HTTP
// (except the single /.well-known/treeos-portal bootstrap before a
// socket is open).
//
// Wire shape per [[project_ibp_wire_shape]] +
// [[project_protocol_transport_separation]]:
//
//   socket.emit("ibp", { id, verb, address, payload, identity? }, ack)
//
// Async updates the server pushes back:
//   "ibp:update"           SUMMON replies, keyed by correlation id
//   "descriptor:patch"     live SEE patches  ─┐
//   "descriptor:replace"   full re-render    ├ (will fold into ibp:update
//   "descriptor:invalidate" tear down        ─┘  when live.js unifies)

import { io } from "socket.io-client";

export class PortalClient {
  constructor({ landUrl, token, useProxy, onConnectionChange, onSummon, onDescriptorEvent }) {
    this.landUrl              = landUrl;
    this.token                = token;
    this.useProxy             = !!useProxy;
    this.socket               = null;
    this.connected            = false;
    this._reqCounter          = 0;
    this._onConnectionChange  = onConnectionChange  || (() => {});
    this._onSummon            = onSummon            || (() => {});
    this._onDescriptorEvent   = onDescriptorEvent   || (() => {});
  }

  /** Async SUMMON updates (server emits `ibp:update`). */
  setSummonHandler(handler) { this._onSummon = handler || (() => {}); }

  /**
   * Live SEE updates. Handler receives `{ kind, payload }` where kind is
   * "patch" | "replace" | "invalidate".
   */
  setDescriptorEventHandler(handler) { this._onDescriptorEvent = handler || (() => {}); }

  // ────────────────────────────────────────────────────────────────
  // Bootstrap (one HTTP call before WS opens).
  // GET /.well-known/treeos-portal → { ws, protocolVersion, land }
  // ────────────────────────────────────────────────────────────────

  static async bootstrap(landUrl, { useProxy } = {}) {
    const url = useProxy
      ? "/.well-known/treeos-portal"
      : `${landUrl.replace(/\/+$/, "")}/.well-known/treeos-portal`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    try {
      const res = await fetch(url, { signal: controller.signal });
      if (!res.ok) throw new Error(`Portal bootstrap failed: HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      if (err.name === "AbortError") {
        throw new Error("Portal bootstrap timed out (10s). Is the Land server reachable?");
      }
      throw err;
    } finally {
      clearTimeout(timeout);
    }
  }

  // ────────────────────────────────────────────────────────────────
  // Connection
  // ────────────────────────────────────────────────────────────────

  connect() {
    if (this.socket) return;
    const target = this.useProxy ? undefined : this.landUrl;
    this.socket = io(target, {
      auth:            { token: this.token, client: "portal", instance: "main" },
      transports:      ["websocket"],
      withCredentials: false,
    });

    this.socket.on("connect",       () => { this.connected = true;  this._onConnectionChange("connected"); });
    this.socket.on("disconnect",    (reason) => { this.connected = false; this._onConnectionChange("disconnected", reason); });
    this.socket.on("connect_error", (err)    => { this.connected = false; this._onConnectionChange("error", err?.message); });

    // Async SUMMON updates. Payload shape: { correlation, content, ... }.
    this.socket.on("ibp:update", (update) => {
      try { this._onSummon(update); }
      catch (err) { console.warn("[portal] ibp:update handler threw:", err); }
    });

    // Live SEE updates. Still on the per-event names until live.js
    // unifies into ibp:update.
    this.socket.on("descriptor:patch",      (payload) => safeCall(this._onDescriptorEvent, { kind: "patch",      payload }));
    this.socket.on("descriptor:replace",    (payload) => safeCall(this._onDescriptorEvent, { kind: "replace",    payload }));
    this.socket.on("descriptor:invalidate", (payload) => safeCall(this._onDescriptorEvent, { kind: "invalidate", payload }));
  }

  disconnect() {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
      this.connected = false;
    }
  }

  // ────────────────────────────────────────────────────────────────
  // Verbs — every one ships through the unified `ibp` event.
  // ────────────────────────────────────────────────────────────────

  /**
   * SEE: observe a place. Returns a Position Descriptor (or the
   * discovery payload for `<land>/.discovery`).
   *
   * @param {string} address  position or stance ("<land>/<path>", "<land>/<path>@<being>", "<land>")
   * @param {object} [options] { live?: boolean }
   */
  async see(address, { live = false } = {}) {
    return this._call("see", normalize(address), live ? { live: true } : {});
  }

  /**
   * DO: mutate at a position. Stance addresses are accepted; the server
   * strips the @being qualifier internally.
   *
   * @param {string} address  position (or stance; @being is stripped server-side)
   * @param {string} action   registered op name ("create-child", "set-meta", "food:log-meal", ...)
   * @param {object} [args]   op-specific arguments
   */
  async do(address, action, args = {}) {
    if (typeof action !== "string" || !action) {
      throw new Error("DO requires an action (string)");
    }
    return this._call("do", normalize(address), { action, args });
  }

  /**
   * SUMMON: deliver a message to a being's inbox and wake them.
   *
   * @param {string} stance   "<land>/<path>@<being>" — being qualifier mandatory
   * @param {object} message  { from, content, intent?, correlation?, inReplyTo?, attachments? }
   * @param {object} [threading]  optional { rootCorrelation?, priority?, activeRole? }
   */
  async summon(stance, message, threading = {}) {
    if (!message || typeof message !== "object") {
      throw new Error("SUMMON requires a message object");
    }
    const payload = { message, ...threading };
    // SUMMON can route through runChat() (LLM round-trip); give it 90s.
    return this._call("summon", normalize(stance), payload, { timeoutMs: 90000 });
  }

  /**
   * BE: identity operations on a stance / land.
   *
   * @param {string} op           "register" | "claim" | "release" | "switch"
   * @param {string} address      stance ("<land>/@auth", "<land>/@<name>") or bare land ("<land>")
   * @param {object} [credentials] op-specific fields ({ name, password, ... })
   */
  async be(op, address, credentials = {}) {
    if (typeof op !== "string" || !op) {
      throw new Error("BE requires an op (string)");
    }
    return this._call("be", normalize(address), { op, ...credentials });
  }

  // ────────────────────────────────────────────────────────────────
  // Internals
  // ────────────────────────────────────────────────────────────────

  _nextId() { return `r-${++this._reqCounter}`; }

  /**
   * The single emit path. Every verb composes the unified envelope and
   * waits for the socket.io ack. The server's ack shape is uniform:
   *
   *   { id, status: "ok", data }            on success
   *   { id, status: "error", error: {...} } on failure
   */
  _call(verb, address, payload, { timeoutMs = 15000 } = {}) {
    return new Promise((resolve, reject) => {
      if (!this.socket || !this.connected) {
        reject(new Error("Portal socket not connected"));
        return;
      }
      const id = this._nextId();
      const timer = setTimeout(() => {
        const err = new Error(`ibp:${verb} timed out`);
        err.code = "TIMEOUT";
        reject(err);
      }, timeoutMs);

      const envelope = { id, verb, address, payload };
      this.socket.emit("ibp", envelope, (response) => {
        clearTimeout(timer);
        if (!response) {
          const err = new Error(`ibp:${verb} returned no response`);
          err.code = "NO_RESPONSE";
          reject(err);
          return;
        }
        if (response.status === "error") {
          const err = new Error(response.error?.message || `ibp:${verb} failed`);
          err.code   = response.error?.code;
          err.detail = response.error?.detail;
          reject(err);
          return;
        }
        resolve(response.data);
      });
    });
  }
}

// ────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────

/**
 * Coerce an address into a string. Accepts a string directly, or an
 * object with a `.position`, `.stance`, `.land`, or `.value` field
 * (legacy callers).
 */
function normalize(address) {
  if (typeof address === "string") return address;
  if (address && typeof address === "object") {
    return address.position || address.stance || address.land || address.value || null;
  }
  return null;
}

function safeCall(fn, arg) {
  try { fn(arg); }
  catch (err) { console.warn("[portal] handler threw:", err); }
}
