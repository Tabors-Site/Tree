// hello-world/seeds/greeter — the greeter seed piece.
//
// Plants one greeter being at a position. Operator runs:
//   do <space> plant-template-by-name { name: "hello-world:greeter" }

export default {
  kind:    "seed",
  name:    "greeter",
  version: "1.0.0",
  description:
    "Plants one greeter being at the target position. The greeter's able is hello-world:greeter (scripted).",
  requires: [
    { type: "able", ref: "hello-world:greeter" },
  ],
};
