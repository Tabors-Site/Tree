// Portal Protocol client.
//
// Wraps a Socket.IO connection and exposes typed methods for the portal:*
// ops the Land server speaks. The Portal client speaks ONLY this protocol
// — never raw HTTP routes (except the single /.well-known/treeos-portal
// bootstrap before a socket is open).
//
// See ../../docs/server-protocol.md for the wire contract.

import { io } from "socket.io-client";

export class PortalClient {
  constructor({ landUrl, token, useProxy, onConnectionChange }) {
    this.landUrl = landUrl;
    this.token = token;
    this.useProxy = !!useProxy; // dev: use Vite proxy (relative URLs, same-origin)
    this.socket = null;
    this.connected = false;
    this._reqCounter = 0;
    this._onConnectionChange = onConnectionChange || (() => {});
  }

  // ────────────────────────────────────────────────────────────────
  // Bootstrap — the ONE HTTP call before WS opens.
  // GET /.well-known/treeos-portal → discovery info.
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
    // Socket.IO understands the http(s):// URL; it upgrades to websocket.
    // In dev (proxy mode), pass undefined to use the current origin so
    // Vite's /socket.io proxy forwards the connection.
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
  }

  disconnect() {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
      this.connected = false;
    }
  }

  // ────────────────────────────────────────────────────────────────
  // portal:* ops
  // ────────────────────────────────────────────────────────────────

  _nextId() {
    return `r-${++this._reqCounter}`;
  }

  _emitWithAck(op, payload) {
    return new Promise((resolve, reject) => {
      if (!this.socket || !this.connected) {
        reject(new Error("Portal socket not connected"));
        return;
      }
      const timeout = setTimeout(() => {
        reject(new Error(`${op} timed out`));
      }, 15000);
      this.socket.emit(op, payload, (response) => {
        clearTimeout(timeout);
        if (!response) {
          reject(new Error(`${op} returned no response`));
          return;
        }
        if (response.ok === false) {
          const err = new Error(response.error?.message || `${op} failed`);
          err.code = response.error?.code;
          err.detail = response.error?.detail;
          reject(err);
          return;
        }
        resolve(response);
      });
    });
  }

  // Fetch a Position Descriptor for a Portal Address.
  // Resolves to the parsed { descriptor } object.
  async fetch(address, ctx) {
    const id = this._nextId();
    const resp = await this._emitWithAck("portal:fetch", { id, address, ctx });
    return resp.descriptor;
  }

  // Light resolution — canonical PA + chain, no full descriptor.
  async resolve(address, ctx) {
    const id = this._nextId();
    const resp = await this._emitWithAck("portal:resolve", { id, address, ctx });
    return {
      canonical: resp.canonical,
      left: resp.left,
      right: resp.right,
      rightResolved: resp.rightResolved,
    };
  }

  // Discovery — what the land supports.
  async discover() {
    const resp = await this._emitWithAck("portal:discover", {});
    return resp.discovery;
  }
}
