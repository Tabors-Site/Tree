import note from "./notes.js";
import node from "./node.js";
import root from "./root.js";
import user from "./user.js";
import contributions from "./contributions.js";
import transactions from "./transactions.js";
import values from "./values.js";
import appe from "./app.js";

export default function registerURLRoutes(app) {
  app.use("/", user);
  app.use("/", root);
  app.use("/", appe);

  app.use("/", note);
  app.use("/", contributions);
  app.use("/", transactions);
  app.use("/", values);
  app.use("/", node);
}
