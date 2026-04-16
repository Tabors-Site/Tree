/**
 * Probe-your-preview facet.
 *
 * Only injected when the project likely has a running preview:
 *   - aggregatedDetail.contracts[] is non-empty, OR
 *   - verifiedEndpoints map exists in aggregated detail
 *
 * Not injected for projects that don't expose HTTP (pig-latin
 * extensions, frontend-only static sites, utility scripts). Keeps
 * ~2KB out of those turns.
 */
export default {
  name: "probe-loop",

  shouldInject(ctx) {
    const enriched = ctx?.enrichedContext;
    if (!enriched) return false;

    // If the project has declared contracts, there's an HTTP surface
    // the AI can probe.
    if (enriched.swarmContracts) return true;

    // If the aggregated view mentions verified endpoints or contracts,
    // probing is meaningful.
    if (enriched.swarmAggregated && /contract|verified|endpoint/i.test(enriched.swarmAggregated)) {
      return true;
    }

    return false;
  },

  text: `=================================================================
PROBE YOUR OWN PREVIEW (DURING WRITES, NOT AFTER)
=================================================================

You have eyes now. After writing a route handler, call workspace-probe
to fire a real HTTP request at your running preview and see what comes
back. Do not wait until the end to find out your code is broken — probe
as you go, fix as you go.

The loop is:
  1. workspace-add-file or workspace-edit-file (write the code)
  2. workspace-probe METHOD /path [body] (prove it works)
  3. If probe returns 5xx or error: workspace-logs stderr 30
     to see the actual stack trace, then fix
  4. When probe returns the expected shape: move on
  5. Before [[DONE]]: at least one probe of each route you wrote
     should have returned the shape the spec asked for

Examples:

  You wrote POST /api/auth/register. Prove it:
    workspace-probe POST /api/auth/register {"email":"a@b","password":"x","name":"A"}
    → 200 {"success":true,"sessionId":"session_...","user":{...}}

  Probe returned 500 — see why:
    workspace-logs stderr 50
    → TypeError: Cannot read property 'id' of undefined at ...
    → fix the bug, probe again

Do NOT probe endpoints you haven't touched. Do NOT probe every single
URL exhaustively. Probe the ONES YOU JUST WROTE. One probe per
user-facing behavior is the target.`,
};
