/**
 * Declared contracts facet.
 *
 * Fires whenever the architect emitted a [[CONTRACTS]] block for the
 * current project and this session is running inside that project.
 * Renders the contracts as a top-of-prompt "YOU MUST IMPLEMENT THESE"
 * block so branch sessions see the exact wire protocol they must
 * build against, not an independently invented one.
 *
 * This is the other half of the contract-first architect pattern:
 *
 *   1. Architect declares contracts in [[CONTRACTS]]
 *   2. Swarm runner stores them on the project root
 *   3. Every branch's enrichContext reads them (code-workspace/index.js)
 *   4. This facet injects them into the branch's system prompt
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
