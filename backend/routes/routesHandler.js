import mcpRoute from "./mcp.js";

import treeDataFetchingRoutes from "./treeDataFetching.js";
import usersRoutes from "./users.js";

export default function registerRoutes(app) {
  app.use("/", mcpRoute);
  app.use("/", treeDataFetchingRoutes);
  app.use("/", usersRoutes);
}
