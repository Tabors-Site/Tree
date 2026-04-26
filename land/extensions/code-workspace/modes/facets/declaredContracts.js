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

  text: `=================================================================
YOUR CONTRACTS — SCOPED TO YOU
=================================================================

The architect declared shared vocabulary for this project. Each
contract is tagged with a SCOPE: which branches must comply. You
see ONLY the contracts scoped to your branch (global + shared with
you + local to you). Contracts that don't involve your branch are
filtered out before you read this — by design, your attention
should stay on what you actually have to implement.

The contracts block is injected into your context under the
"Declared Contracts" heading. Read it FIRST every turn before
writing any code that uses a shared identifier.

Rules:

  1. Every shared identifier you reference MUST use the canonical
     value from the declared contracts. localStorage key, character
     ID, DOM id, event name, exported global, message type — copy
     the contract's value exactly. Field names are canonical
     (snake_case vs camelCase matters).

  2. If you need a shared identifier that isn't in your scoped
     contracts, that's a SIGNAL, not an invitation to invent one.
     Two possibilities:
       (a) The architect missed it → stop and emit:
           [[NO-WRITE: contracts missing <namespace>:<name>, need architect update]]
       (b) The identifier exists but is scoped to other branches and
           filtered out from your view → you're trying to reach
           outside your scope. Same response: stop and surface.
     Either way, surface rather than guess. Inventing your own value
     is what produces the cross-branch mismatches the contracts
     exist to prevent.

  3. Don't widen scope unilaterally. If a contract is scoped
     "shared:[backend,frontend]" and you're a third branch that
     thinks you also need it, you don't write code that uses it
     anyway — you stop and surface. The architect (or court, in
     Pass 2+) decides whether to widen the scope.

  4. Shapes are the contract's job. If a storage-key declares
     shape '{ totalXP, unlockedChars, highScore }', read and write
     those exact fields. Don't add or rename without architect
     approval.`,
};
