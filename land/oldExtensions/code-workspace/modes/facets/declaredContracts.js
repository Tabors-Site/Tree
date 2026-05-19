/**
 * Declared contracts facet.
 *
 * Fires whenever a Ruler above (or at) this scope has ratified
 * contracts and this session is running inside that domain. Renders
 * the active contracts as a top-of-prompt "YOU MUST IMPLEMENT THESE"
 * block so the Worker sees the exact wire protocol it must build
 * against, not an independently invented one.
 *
 * This is the consumer-side of the contract trio:
 *
 *   1. Contractor emits via governing-emit-contracts → contracts node
 *   2. Ruler appends contractApprovals (the active ledger)
 *   3. Every Worker's enrichContext walks the Ruler chain via
 *      governing.readScopedContracts (code-workspace/index.js)
 *   4. This facet injects the resolved contracts into the system prompt
 *   5. Post-swarm validator cross-checks actual code against them
 *
 * Without step 4 the contracts would sit on metadata nobody reads.
 */
export default {
  name: "declared-contracts",

  shouldInject(ctx) {
    const contracts = ctx?.enrichedContext?.declaredContracts;
    return Array.isArray(contracts) && contracts.length > 0;
  },

  text: `Contracts table above is filtered to your scope (global + shared
with you + local). Use canonical values exactly — copy the value
verbatim, including field names (snake_case vs camelCase matters).

If you need a shared identifier NOT in your table, surface — don't
invent. Emit [[NO-WRITE: contracts missing <namespace>:<name>]] and
the architect resolves. Same if you think you need a contract scoped
to other branches: stop and surface, don't widen scope unilaterally.`,
};
