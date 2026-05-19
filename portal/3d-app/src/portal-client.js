// TreeOS Portal client. Speaks IBP (Inter-Being Protocol).
//
// Wraps a Socket.IO connection and exposes typed methods for IBP's four
// verbs (see / do / summon / be). The client speaks only IBP, never raw HTTP
// routes (except the single /.well-known/treeos-portal bootstrap before
// a socket is open).
//
// See ../../docs/protocol.md for the conceptual model and
// ../../docs/server-protocol.md for the wire contract.

import { io } from "socket.io-client";

export class PortalClient {
  constructor({ landUrl, token, useProxy, onConnectionChange, onSummon, onDescriptorEvent }) {
    this.landUrl = landUrl;
    this.token = token;
    this.useProxy = !!useProxy; // dev: use Vite proxy (relative URLs, same-origin)
    this.socket = null;
    this.connected = false;
    this._reqCounter = 0;
    this._onConnectionChange = onConnectionChange || (() => {});
    this._onSummon = onSummon || (() => {});
    this._onDescriptorEvent = onDescriptorEvent || (() => {});
  }

  // Listener for async SUMMON responses. The server emits `ibp:summon`
  // with a response envelope when an async being completes summoning.
  setSummonHandler(handler) {
    this._onSummon = handler || (() => {});
  }

  // Listener for live SEE updates. The server emits `descriptor:patch`,
  // `descriptor:replace`, or `descriptor:invalidate` for any position
  // the socket has subscribed to via `see(address, { live: true })`.
  // The handler receives { kind: "patch"|"replace"|"invalidate", payload }.
  setDescriptorEventHandler(handler) {
    this._onDescriptorEvent = handler || (() => {});
  }

  // ────────────────────────────────────────────────────────────────
  // Bootstrap: the one HTTP call before WS opens.
  // GET /.well-known/treeos-portal returns { ws, protocolVersion, land }.
  // ────────────────────────────────────────────────────────────────

  static async bootstrap(landUrl, { useProxy } = {}) {
    const url = useProxy
      ? "/.well-known/treeos-portal"
      : `${landUrl.replace(/\/+$/, "")}/.well-known/treeos-portal`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    try {
      const res = await fetch(url, { signal: controller.signal });
      if (!res.ok) {
        throw new Error(`Portal bootstrap failed: HTTP ${res.status}`);
      }
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
      auth: { token: this.token, client: "portal", instance: "main" },
      transports: ["websocket"],
      withCredentials: false,
    });

    this.socket.on("connect", () => {
      this.connected = true;
      this._onConnectionChange("connected");
    });

    this.socket.on("disconnect", (reason) => {
      this.connected = false;
      this._onConnectionChange("disconnected", reason);
    });

    this.socket.on("connect_error", (err) => {
      this.connected = false;
      this._onConnectionChange("error", err?.message);
    });

    this.socket.on("ibp:summon", (entry) => {
      try { this._onSummon(entry); } catch (err) {
        console.warn("[3D] summon handler threw:", err);
      }
    });

    // Live SEE events. The server emits these for any position the
    // socket has subscribed to via see(addr, { live: true }).
    this.socket.on("descriptor:patch", (payload) => {
      try { this._onDescriptorEvent({ kind: "patch", payload }); }
      catch (err) { console.warn("[3D] descriptor:patch handler threw:", err); }
    });
    this.socket.on("descriptor:replace", (payload) => {
      try { this._onDescriptorEvent({ kind: "replace", payload }); }
      catch (err) { console.warn("[3D] descriptor:replace handler threw:", err); }
    });
    this.socket.on("descriptor:invalidate", (payload) => {
      try { this._onDescriptorEvent({ kind: "invalidate", payload }); }
      catch (err) { console.warn("[3D] descriptor:invalidate handler threw:", err); }
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
  // Verb methods (stubbed; wired in subsequent phases)
  //
  // Each verb's address field is named explicitly. See ../../docs/protocol.md.
  // ────────────────────────────────────────────────────────────────

  /**
   * SEE: observe a place. Returns a Position Description.
   *
   * Pass `address` as a string and the client decides whether to send it as
   * `position` or `stance` based on whether it contains an being
   * qualifier (`@<name>`). Use the explicit form to force one or the other.
   *
   * @param {string|object} address  position string, stance string, or { position }/{ stance }
   * @param {object} [options]  { live: boolean }
   * @returns {Promise<object>} Position Description (one-shot) or initial descriptor (live)
   */
  async see(address, options = {}) {
    const field = _toAddressField(address);
    return this._emitWithAck("ibp:see", { ...field, ...options });
  }

  /**
   * DO: mutate the world at a position.
   *
   * Accepts a position string. If a string with a trailing @being
   * qualifier is passed, the qualifier is stripped before sending; DO
   * always targets a position.
   *
   * @param {string} position  the position address (qualifier stripped if present)
   * @param {string} action    named action (create-child, rename, ...) or set-meta
   * @param {object} payload   action-specific
   */
  async do(position, action, payload = {}) {
    if (typeof position !== "string" || position.length === 0) {
      throw new Error("DO requires a position address (string)");
    }
    const stripped = position.replace(/@[a-z][a-z0-9-]*$/i, "");
    return this._emitWithAck("ibp:do", { position: stripped, action, payload });
  }

  /**
   * SUMMON: deliver a message to a being's inbox and wake them.
   *
   * Requires a stance (being qualifier mandatory).
   *
   * @param {string} stance   position@being
   * @param {object} message  { from, content, intent, correlation, inReplyTo?, attachments? }
   */
  async summon(stance, message) {
    // SUMMON can route through runChat() on the server (the bridge for
    // non-native beings), which means a full LLM round-trip. Give
    // it room — 90s — instead of the default 15s used by SEE/DO/BE.
    return this._emitWithAck("ibp:summon", { stance, message }, { timeoutMs: 90000 });
  }

  /**
   * BE: manage be-er identity.
   *
   * Accepts either a stance (full form, e.g. `<land>/@auth` or a held
   * stance like `<land>/@<username>`) or a bare land domain (shorthand
   * for register and credential-based claim). For release and switch,
   * use the held stance.
   *
   * @param {string} operation              register | claim | release | switch
   * @param {string|object} addressOrField  bare land like "treeos.ai",
   *                                        a stance like "treeos.ai/@auth",
   *                                        or { stance } / { land }
   * @param {object} [extra]                operation-specific fields (payload, from, ...)
   */
  async be(operation, addressOrField, extra = {}) {
    const addressField = _toBeAddressField(addressOrField);
    return this._emitWithAck("ibp:be", { operation, ...addressField, ...extra });
  }

  // ────────────────────────────────────────────────────────────────
  // Internals
  // ────────────────────────────────────────────────────────────────

  _nextId() {
    return `r-${++this._reqCounter}`;
  }

  _emitWithAck(op, payload, { timeoutMs = 15000 } = {}) {
    return new Promise((resolve, reject) => {
      if (!this.socket || !this.connected) {
        reject(new Error("Portal socket not connected"));
        return;
      }
      const id = this._nextId();
      const timeout = setTimeout(() => {
        const err = new Error(`${op} timed out (or not wired on this land)`);
        err.code = "VERB_NOT_WIRED";
        reject(err);
      }, timeoutMs);
      this.socket.emit(op, { id, ...payload }, (response) => {
        clearTimeout(timeout);
        if (!response) {
          const err = new Error(`${op} returned no response`);
          err.code = "VERB_NOT_WIRED";
          reject(err);
          return;
        }
        if (response.status === "error") {
          const err = new Error(response.error?.message || `${op} failed`);
          err.code = response.error?.code;
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
 * Route a string address to its protocol field name. A string ending in
 * `@<being>` becomes `{ stance }`; without it becomes `{ position }`.
 * Callers may pass an explicit object to force one or the other.
 */
function _toAddressField(address) {
  if (typeof address === "string") {
    const hasEmbodiment = /@[a-z][a-z0-9-]*$/i.test(address);
    return hasEmbodiment ? { stance: address } : { position: address };
  }
  if (address && typeof address === "object") {
    if ("position" in address) return { position: address.position };
    if ("stance" in address) return { stance: address.stance };
  }
  throw new Error("Portal verb requires a position or stance address");
}

/**
 * Route a BE address to its protocol field name. A bare domain (no
 * slash, no @) becomes `{ land }`; anything with `@` becomes `{ stance }`.
 * Callers may pass an explicit object to force one or the other.
 */
function _toBeAddressField(address) {
  if (typeof address === "string") {
    const hasEmbodiment = /@[a-z][a-z0-9-]*$/i.test(address);
    const looksLikeBareDomain = !address.includes("/") && !address.includes("@");
    if (hasEmbodiment) return { stance: address };
    if (looksLikeBareDomain) return { land: address };
    throw new Error(
      `BE requires either a bare land domain ("treeos.ai") or a stance with @being ("treeos.ai/@auth"). Got: ${address}`,
    );
  }
  if (address && typeof address === "object") {
    if ("stance" in address) return { stance: address.stance };
    if ("land" in address) return { land: address.land };
  }
  throw new Error("BE requires a stance or land address");
}
