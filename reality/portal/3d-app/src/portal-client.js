// TreeOS Portal client. Speaks IBP (Inter-Being Protocol).
//
// Wraps a Socket.IO connection and exposes typed methods for the four
// IBP verbs (see / do / summon / be). Speaks only IBP, never raw HTTP
// (except the single /.well-known/treeos-portal bootstrap before a
// socket is open).
//
// Wire shape:
//
//   socket.emit("ibp", { id, verb, address, payload, identity? }, ack)
//
// Server pushes ride the SAME `ibp` event:
//
//   { verb: "summon", payload: <inbox entry> }
//   { verb: "see",    payload: { kind: "patch"|"replace"|"invalidate",
//                                spaceId, data } }
//
// DO is asynchronous on the wire. A DO request acks with
// `{ correlation, status: "accepted" }`; the result arrives later as
// a SUMMON push whose `payload.correlation` matches the one acked.
// `.do(...)` awaits that matching push and resolves with
// `payload.result`. Idempotency: the correlation is the dedupe key
// server-side, so retries collapse to one moment.
//
// SUMMON-replies and out-of-band SUMMONs use the same `verb:"summon"`
// envelope. The portal first checks pending DO awaiters by
// correlation; non-matching summons fall through to the inbox
// handler.

import { io } from "socket.io-client";

export class PortalClient {
  constructor({ placeUrl, token, useProxy, onConnectionChange, onSummon, onDescriptorEvent }) {
    this.placeUrl              = placeUrl;
    this.token                = token;
    this.useProxy             = !!useProxy;
    this.socket               = null;
    this.connected            = false;
    this._reqCounter          = 0;
    this._onConnectionChange  = onConnectionChange  || (() => {});
    this._onSummon            = onSummon            || (() => {});
    this._onDescriptorEvent   = onDescriptorEvent   || (() => {});
    // correlation → { resolve, reject, timer } for awaiting moment pushes (DO/BE)
    this._pendingMoments      = new Map();
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
  // GET /.well-known/treeos-portal → { ws, protocolVersion, place }
  // ────────────────────────────────────────────────────────────────

  static async bootstrap(placeUrl, { useProxy } = {}) {
    const url = useProxy
      ? "/.well-known/treeos-portal"
      : `${placeUrl.replace(/\/+$/, "")}/.well-known/treeos-portal`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    try {
      const res = await fetch(url, { signal: controller.signal });
      if (!res.ok) throw new Error(`Portal bootstrap failed: HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      if (err.name === "AbortError") {
        throw new Error("Portal bootstrap timed out (10s). Is the Place server reachable?");
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
    const target = this.useProxy ? undefined : this.placeUrl;
    this.socket = io(target, {
      auth:            { token: this.token, client: "portal", instance: "main" },
      transports:      ["websocket"],
      withCredentials: false,
    });

    this.socket.on("connect",       () => { this.connected = true;  this._onConnectionChange("connected"); });
    this.socket.on("disconnect",    (reason) => { this.connected = false; this._onConnectionChange("disconnected", reason); });
    this.socket.on("connect_error", (err)    => { this.connected = false; this._onConnectionChange("error", err?.message); });

    // Single IBP wire event — one listener, route by envelope.verb.
    // Server-push envelopes:
    //   { verb: "summon", payload: <inbox entry, optionally w/ result> }
    //   { verb: "see",    payload: { kind, spaceId, data } }
    this.socket.on("ibp", (envelope) => {
      if (!envelope || typeof envelope !== "object") return;
      if (envelope.verb === "summon") {
        const p = envelope.payload || {};
        // First: match against pending DO awaiters by correlation.
        // Transport-act results ride the SUMMON push shape — the
        // server fills `result` and the matching correlation.
        const pending = p.correlation ? this._pendingMoments.get(p.correlation) : null;
        if (pending) {
          this._pendingMoments.delete(p.correlation);
          if (pending.timer) clearTimeout(pending.timer);
          const result = p.result;
          if (result && typeof result === "object" && result.error) {
            const err = new Error(result.error.message || "transport-act failed");
            err.code = result.error.code || "TRANSPORT_ACT_FAILED";
            pending.reject(err);
          } else {
            pending.resolve(result);
          }
          return;
        }
        // Otherwise fall through: an unsolicited SUMMON or a reply
        // the caller isn't tracking with .do() — fire the inbox
        // handler.
        safeCall(this._onSummon, p);
        return;
      }
      if (envelope.verb === "see") {
        const p = envelope.payload || {};
        safeCall(this._onDescriptorEvent, { kind: p.kind, payload: p.data, spaceId: p.spaceId });
        return;
      }
    });
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
   * discovery payload for `<place>/.discovery`).
   *
   * @param {string} address  position or stance ("<place>/<path>", "<place>/<path>@<being>", "<place>")
   * @param {object} [options] { live?: boolean, at?: { atSeq?: number, atTimestamp?: string } }
   */
  async see(address, { live = false, at = null, limit = null } = {}) {
    const payload = {};
    if (live) payload.live = true;
    // Historical SEE qualifier. Returns the substrate's state as of a
    // past point (seq or wall-clock). The descriptor builder threads
    // `until` through every internal fold call so the whole world is
    // returned at that moment, not just the leaf row. Live cannot be
    // combined with at — the wire layer rejects.
    if (at && typeof at === "object") {
      if (Number.isInteger(at.atSeq)) payload.at = { atSeq: at.atSeq };
      else if (typeof at.atTimestamp === "string") payload.at = { atTimestamp: at.atTimestamp };
    }
    // Optional limit for synthetic catalog SEEs (.acts/.beings/...). The
    // wire-layer reads payload.limit and threads to describeActChain /
    // describeBeingsCatalog. Ignored on regular position SEEs.
    if (Number.isInteger(limit) && limit > 0) payload.limit = limit;
    return this._call("see", normalize(address), payload);
  }

  /**
   * DO: mutate at a position. Asynchronous on the wire — the server
   * acks `{ correlation, status: "accepted" }` immediately and pushes
   * the actual result later as a `moment` envelope. This method awaits
   * the matching push and resolves with the verb's return value.
   *
   * The correlation is a client-generated idempotency key. Re-sending
   * the same correlation collapses to one moment on the server; the
   * second call will receive the same result.
   *
   * @param {string} address  position (or stance; @being is stripped server-side)
   * @param {string} action   registered op name ("create-space", "set-being", "end-matter", "plant", "<ext>:<action>", ...)
   * @param {object} [args]   op-specific arguments
   * @param {object} [opts]   { correlation?: string, timeoutMs?: number }
   */
  async do(address, action, args = {}, opts = {}) {
    if (typeof action !== "string" || !action) {
      throw new Error("DO requires an action (string)");
    }
    const correlation = opts.correlation || cryptoRandomId();
    const timeoutMs   = opts.timeoutMs   || 90000;

    // Register the awaiter before emitting so a fast server push
    // doesn't arrive before we're listening.
    const momentPromise = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this._pendingMoments.delete(correlation);
        const err = new Error(`ibp DO result push timed out (correlation=${correlation.slice(0, 8)})`);
        err.code = "TIMEOUT";
        reject(err);
      }, timeoutMs);
      this._pendingMoments.set(correlation, { resolve, reject, timer });
    });

    try {
      const ack = await this._call("do", normalize(address), { action, args, correlation });
      if (!ack || ack.status !== "accepted") {
        this._pendingMoments.delete(correlation);
        throw new Error(`ibp DO not accepted: ${JSON.stringify(ack)}`);
      }
    } catch (err) {
      this._pendingMoments.delete(correlation);
      throw err;
    }

    return momentPromise;
  }

  /**
   * SUMMON: deliver a message to a being's inbox and wake them.
   *
   * @param {string} stance   "<place>/<path>@<being>" — being qualifier mandatory
   * @param {object} message  { from, content, correlation?, inReplyTo?, attachments? }
   * @param {object} [threading]  optional { rootCorrelation?, priority?, activeRole? }
   */
  async summon(stance, message, threading = {}) {
    if (!message || typeof message !== "object") {
      throw new Error("SUMMON requires a message object");
    }
    const payload = { message, ...threading };
    // SUMMON can route through runTurn() (LLM round-trip); give it 90s.
    return this._call("summon", normalize(stance), payload, { timeoutMs: 90000 });
  }

  /**
   * BE: identity operations on a stance / place.
   *
   * @param {string} op           "birth" | "connect" | "release"
   * @param {string} address      stance ("<place>/@cherub", "<place>/@<name>") or bare place ("<place>")
   * @param {object} [credentials] op-specific fields ({ name, password, ... })
   */
  async be(op, address, credentials = {}) {
    if (typeof op !== "string" || !op) {
      throw new Error("BE requires an op (string)");
    }
    const correlation = credentials.correlation || cryptoRandomId();
    const timeoutMs   = credentials.timeoutMs   || 30000;

    // Register the awaiter before emitting so a fast server push
    // doesn't arrive before we're listening. BE rides the same
    // transport-act async path as DO: server acks "accepted" with
    // the correlation, then pushes the moment's result (or error)
    // later as a `summon` envelope matched by correlation.
    const momentPromise = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this._pendingMoments.delete(correlation);
        const err = new Error(`ibp BE result push timed out (correlation=${correlation.slice(0, 8)})`);
        err.code = "TIMEOUT";
        reject(err);
      }, timeoutMs);
      this._pendingMoments.set(correlation, { resolve, reject, timer });
    });

    try {
      const { correlation: _c, timeoutMs: _t, ...payload } = credentials;
      const ack = await this._call("be", normalize(address), { op, correlation, ...payload });
      if (!ack || ack.status !== "accepted") {
        this._pendingMoments.delete(correlation);
        throw new Error(`ibp BE not accepted: ${JSON.stringify(ack)}`);
      }
    } catch (err) {
      this._pendingMoments.delete(correlation);
      throw err;
    }

    return momentPromise;
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
 * object with a `.position`, `.stance`, `.place`, or `.value` field
 * (legacy callers).
 */
function normalize(address) {
  if (typeof address === "string") return address;
  if (address && typeof address === "object") {
    return address.position || address.stance || address.place || address.value || null;
  }
  return null;
}

function safeCall(fn, arg) {
  try { fn(arg); }
  catch (err) { console.warn("[portal] handler threw:", err); }
}

/**
 * Generate a UUID-shaped string in the browser without depending on
 * crypto.randomUUID (still missing on older Safari). Used as the DO
 * correlation when the caller doesn't supply one.
 */
function cryptoRandomId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    try { return crypto.randomUUID(); } catch {}
  }
  // Fallback: 16 random bytes formatted as a UUID v4.
  const bytes = new Uint8Array(16);
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}
