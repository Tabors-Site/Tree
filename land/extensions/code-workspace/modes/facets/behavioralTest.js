/**
 * Behavioral test facet.
 *
 * Only injected when the project has signals of user-facing behavior:
 *   - a tests/ directory already exists (mid-build continuation), OR
 *   - aggregatedDetail.contracts[] is non-empty (routes have been declared)
 *
 * Not injected for fresh non-route projects (pig-latin extensions,
 * utility scripts, one-off helpers). Keeps ~3KB out of those turns.
 */
export default {
  name: "behavioral-test",

  shouldInject(ctx) {
    const enriched = ctx?.enrichedContext;
    if (!enriched) return false;

    // Check for a tests/ directory among the local view's descendants.
    // localView only shows one level, but we also check children for
    // a "tests" entry — good enough signal that the project has tests.
    // Read the raw localViewData, not the formatted localView string.
    const view = enriched.localViewData;
    if (view?.children?.some((c) => c.name === "tests")) return true;

    // Check for declared contracts via aggregatedDetail rendering.
    // The aggregated block contains a "contracts" count hint.
    if (enriched.swarmAggregated && /contract/i.test(enriched.swarmAggregated)) {
      return true;
    }

    // Check the formatted contracts section — if present, this project
    // has routes and should have tests.
    if (enriched.swarmContracts) return true;

    return false;
  },

  text: `=================================================================
WRITE A BEHAVIORAL TEST BEFORE [[DONE]] (PROJECTS WITH BEHAVIOR)
=================================================================

If the project has user-facing behavior — buttons, API endpoints,
WebSocket flows, anything beyond a one-file script — you MUST also
write a behavioral test at tests/spec.test.js (or tests/NAME.test.js)
before declaring [[DONE]]. The validator runs node --test tests/
after your last write and surfaces failures back to you for retry.

The tests are how you prove your code actually does what the user
asked, not just that it parses and boots. Validators catch parse
errors, missing routes, missing fields. They CANNOT catch empty
shells: handlers that early-return on uninitialized state, buttons
that submit and silently no-op, server logic that runs once and
declares game-over instantly. Tests catch those.

Convention (no framework dependency, uses node:test built-in):

    import assert from 'node:assert/strict';
    import { test } from 'node:test';

    const base = process.env.PREVIEW_URL || 'http://127.0.0.1:3000';

    test('user can register and receive a sessionId', async () => {
      const res = await fetch(base + '/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'a@b.com', password: 'x', name: 'Alice' }),
      });
      const data = await res.json();
      assert.equal(typeof data.sessionId, 'string');
      assert.equal(data.user.email, 'a@b.com');
    });

Rules:
  - One test per user-facing behavior in the spec.
  - TESTS MUST EXERCISE THE REAL APP CODE. The validator runs the
    real server as a preview and sets PREVIEW_URL in the test process
    env. Fetch against that URL. Do NOT declare your own Express
    routes inside the test file — the validator rejects any test file
    with 2+ route declarations.
  - Tests must clean up after themselves. Use test.after() / t.after().
  - Use plain node:assert/strict. No jest, mocha, vitest, chai, sinon.
  - Each test should fail FAST with a specific field assertion. Snake
    bug was player.id being null forever; assert.notEqual(player.id,
    null) catches it in the first run.

Skip the test only when the project is genuinely a one-shot script
or a single utility function. For anything with API endpoints, UI,
sockets, or multi-step flows: write the test.`,
};
