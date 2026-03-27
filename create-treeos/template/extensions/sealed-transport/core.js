/**
 * Sealed Transport Core
 *
 * One function. One check. Propagation calls isSealed() before each hop.
 * If sealed, intermediary nodes get a redacted payload. They see a
 * pass-through record in .flow but cannot see the content. The destination
 * (leaf node with no cascade-enabled children) gets the full payload.
 */

/**
 * Determine if a signal should be delivered in sealed mode.
 *
 * Sealed if:
 *   - The originating node's cascadeConfig.mode === "sealed"
 *   - OR the payload itself carries _sealed: true
 *
 * @param {object} cascadeConfig - the source node's metadata.cascade
 * @param {object} payload - the signal payload
 * @returns {boolean}
 */
export function isSealed(cascadeConfig, payload) {
  if (cascadeConfig?.mode === "sealed") return true;
  if (payload?._sealed === true) return true;
  return false;
}

/**
 * Redact a payload for intermediary hops.
 * Preserves routing metadata (tags, signalId, source) but strips content.
 * The intermediary sees that a sealed signal passed through. Nothing more.
 *
 * @param {object} payload - the full payload
 * @returns {object} redacted payload for intermediary delivery
 */
export function sealPayload(payload) {
  return {
    _sealed: true,
    _passthrough: true,
    tags: payload?.tags || [],
  };
}
