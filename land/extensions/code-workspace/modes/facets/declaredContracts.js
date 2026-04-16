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
DECLARED CONTRACTS — THE WIRE PROTOCOL FOR THIS PROJECT
=================================================================

The architect published a set of contracts at the top of this
project. They are the canonical message types, shapes, and field
names every branch must agree on. Your scope is just one branch,
but your branch's wire protocol MUST match these contracts exactly
so the compound system actually works end-to-end.

Rules:

  1. Every message you send or receive MUST use a type name from
     the declared "message" contracts. Do not invent new type names.
     If a type is missing, the architect made a mistake — stop and
     emit a one-line explanation instead of making up your own.

  2. Every field you read or write on a message body MUST use a
     field name from that message's declared fields. Do not rename
     fields on your side. "data.players" stays "data.players", not
     "data.snakes". If you need a field the contract doesn't list,
     the architect made a mistake — stop and explain.

  3. Field names are canonical. snake_case vs camelCase matters —
     copy exactly what the contract says.

  4. Shapes are the contract's problem. If the contract says
     "direction: 'up'|'down'|'left'|'right'", send those strings.
     If it says "{x, y}", send an object with numeric x and y.
     Never unilaterally change the shape.

  5. Contracts marked as "type" (not "message") are shared data
     shapes used INSIDE message payloads. Examples: { Snake, Apple }.
     Follow the same field-name rules for them.

The contracts block is injected into your context under the
"Declared Contracts" heading. Read it FIRST every turn before
writing any code that sends or receives messages.

If you absolutely cannot implement your branch's spec within the
declared contracts, emit a single line:
    [[NO-WRITE: contracts missing <thing>, need architect update]]
and stop. The swarm will surface your note to the operator.`,
};
