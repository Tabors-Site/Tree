// HTTP dispatch helpers.
//
// The shared seam between any HTTP route and the IBP dispatcher. Every
// HTTP entry point in the place — the unified /ibp/:verb/<addr> adapter
// and the auth shims — uses these three helpers to fabricate the same
// envelope shape, await the same ack, and translate it into the same
// HTTP response.
//
//   makeHttpCarrier(req, extra?)   socket-shaped carrier for dispatchIbp
//   dispatchAndWait(carrier, msg)  await the ack as a Promise
//   sendAck(res, ack)              translate ack → HTTP response
//
// HTTP status derives from the IBP code via httpStatusFor() in
// seed/ibp/protocol.js. There is no local code-to-status map here, and
// must never be: one canonical mapping for the whole transport, so
// adding a new IBP code reflects on every door automatically.

import { dispatchIbp } from "../../protocols/ibp/protocol.js";
import { httpStatusFor, IBP_ERR } from "../../seed/ibp/protocol.js";

/**
 * Build the socket-shaped carrier the IBP verb handlers expect when a
 * request arrives from HTTP. WS gives handlers a real socket; HTTP
 * fabricates a minimal stub with the same surface.
 *
 * @param {object} req   Express request
 * @param {object} extra Optional per-caller extras to merge onto the carrier
 *                       (e.g. { jwt, canopyVerifiedSender, _req })
 */
export function makeHttpCarrier(req, extra = {}) {
  return {
    beingId:    req.beingId    || null,
    name:       req.name       || null,
    nameId:     req.nameId     || null,
    handshake:  { headers: req.headers, address: req.ip },
    connected:  false,
    emit:  () => {},
    join:  () => {},
    leave: () => {},
    to:    () => ({ emit: () => {} }),
    ...extra,
  };
}

/**
 * Dispatch an IBP envelope and resolve with the ack payload. Used by
 * Express handlers that need to post-process the ack (set a cookie,
 * transform the response shape) before sending.
 *
 * For pure pass-through callers, prefer `sendAck` after awaiting.
 */
export function dispatchAndWait(carrier, msg) {
  return new Promise((resolve) => {
    let settled = false;
    const ack = (payload) => {
      if (settled) return;
      settled = true;
      resolve(payload);
    };
    Promise.resolve()
      .then(() => dispatchIbp(carrier, msg, ack))
      .catch((err) => {
        if (settled) return;
        settled = true;
        resolve({
          id:     msg?.id || null,
          status: "error",
          error:  { code: IBP_ERR.INTERNAL, message: err.message || "Internal portal error" },
        });
      });
  });
}

/**
 * Dispatch an IBP envelope and resolve with the MOMENT'S RESULT, not
 * the wire ack. BE (and transport-act DO/SUMMON) acks `{ correlation,
 * status: "accepted" }` immediately and pushes the real result later
 * through the carrier's IBP event — which a real socket receives and
 * the HTTP stub used to drop (no-op emit). This helper captures that
 * push and resolves with it, so HTTP callers (the auth shims, the CLI
 * behind them) get the same result a WS caller does.
 *
 * Synchronous acks (errors, non-transport verbs) resolve directly.
 */
export function dispatchAndAwaitResult(carrier, msg, { timeoutMs = 30_000 } = {}) {
  return new Promise((resolve) => {
    let settled = false;
    let expecting = null;        // correlation we await, once acked
    const buffered = [];         // pushes that raced ahead of the ack
    const finish = (payload) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(payload);
    };
    const timer = setTimeout(() => finish({
      id:     msg?.id || null,
      status: "error",
      error:  { code: IBP_ERR.INTERNAL, message: "Timed out awaiting the moment's result" },
    }), timeoutMs);
    timer.unref?.();

    const tryConsume = (p) => {
      if (!p || !expecting || p.correlation !== expecting) return false;
      if (p.result && typeof p.result === "object" && p.result.error) {
        finish({
          id:     msg?.id || null,
          status: "error",
          error:  { code: p.result.error.code || IBP_ERR.INTERNAL, message: p.result.error.message || "Moment failed" },
        });
      } else {
        finish({ id: msg?.id || null, status: "ok", data: p.result });
      }
      return true;
    };

    // The push path checks carrier.connected before emitting.
    carrier.connected = true;
    carrier.emit = (event, envelope) => {
      const p = envelope?.payload;
      if (!p) return;
      if (!tryConsume(p)) buffered.push(p);
    };

    Promise.resolve()
      .then(() => dispatchIbp(carrier, msg, (ackPayload) => {
        if (settled) return;
        if (ackPayload?.status !== "ok" || ackPayload?.data?.status !== "accepted") {
          // Synchronous result or refusal — nothing more is coming.
          return finish(ackPayload);
        }
        expecting = ackPayload.data.correlation || null;
        if (!expecting) return finish(ackPayload);
        for (const p of buffered.splice(0)) if (tryConsume(p)) return;
      }))
      .catch((err) => finish({
        id:     msg?.id || null,
        status: "error",
        error:  { code: IBP_ERR.INTERNAL, message: err.message || "Internal portal error" },
      }));
  });
}

/**
 * Translate an IBP ack payload into an HTTP response. Status derives
 * from the IBP code via httpStatusFor(); body is the ack as-is.
 */
export function sendAck(res, ack) {
  if (res.headersSent) return;
  if (ack?.status === "ok") {
    return res.status(200).json(ack);
  }
  const code = ack?.error?.code || IBP_ERR.INTERNAL;
  return res.status(httpStatusFor(code)).json(ack);
}
