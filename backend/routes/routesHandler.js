import aiRoutes from "./ai.js";
import contributionsRoutes from "./contributions.js";
import invitesRoutes from "./invites.js";
import treeManagementRoutes from "./treeManagement.js";
import notesRoutes from "./notes.js";
import schedulesRoutes from "./schedules.js";
import transactionsRoutes from "./transactions.js";
import treeDataFetchingRoutes from "./treeDataFetching.js";
import usersRoutes from "./users.js";
import valuesRoutes from "./values.js";
import statusesRoutes from "./statuses.js";
import scriptsRoutes from "./scripts.js";

export default function registerRoutes(app) {
    app.use("/", aiRoutes);
    app.use("/", contributionsRoutes);
    app.use("/", invitesRoutes);
    app.use("/", treeManagementRoutes);
    app.use("/", notesRoutes);
    app.use("/", schedulesRoutes);
    app.use("/", transactionsRoutes);
    app.use("/", treeDataFetchingRoutes);
    app.use("/", usersRoutes);
    app.use("/", valuesRoutes);
    app.use("/", statusesRoutes);
    app.use("/", scriptsRoutes);
}
