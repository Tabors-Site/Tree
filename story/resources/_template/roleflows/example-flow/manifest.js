// _template/roleflows/example-flow — roleflow piece manifest template.
//
// A roleflow composes role pieces per moment from world state. The
// flow lists ordered { when, role, stack? } clauses; at moment-assign
// the substrate evaluates each `when` against the open context
// (asker, verb, place, being, time, world signals) and stacks the
// matching roles. The roleflow registry stores the flow keyed by name;
// beings attach to a flow by setting qualities.roleFlow.
//
// Roleflow's registry + install semantics are still pending a substrate
// design pass — this template documents the eventual shape so authors
// can prototype.

export default {
  kind:    "roleflow",
  name:    "example-flow",
  version: "1.0.0",
  description: "One sentence describing what this flow composes.",

  // Every role this flow can reference. The role-kind handler must
  // have registered them BEFORE the flow installs.
  requires: [
    { type: "role", ref: "my-pack:example-role" },
  ],
};
