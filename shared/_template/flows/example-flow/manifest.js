// _template/flows/example-flow — flow piece manifest template.
//
// A flow composes able pieces per moment from world state. The
// flow lists ordered { when, able, stack? } clauses; at moment-assign
// the substrate evaluates each `when` against the open context
// (asker, verb, place, being, time, world signals) and stacks the
// matching ables. The flow registry stores the flow keyed by name;
// beings attach to a flow by setting qualities.flow.
//
// Flow's registry + install semantics are still pending a substrate
// design pass — this template documents the eventual shape so authors
// can prototype.

export default {
  kind:    "flow",
  name:    "example-flow",
  version: "1.0.0",
  description: "One sentence describing what this flow composes.",

  // Every able this flow can reference. The able-kind handler must
  // have registered them BEFORE the flow installs.
  requires: [
    { type: "able", ref: "my-pack:example-able" },
  ],
};
