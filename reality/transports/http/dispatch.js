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
