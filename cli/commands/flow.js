const chalk = require("chalk");
const { requireAuth } = require("../config");
const { getApi } = require("../helpers");

module.exports = (program) => {
  program
    .command("flow [signalId]")
    .description("View cascade flow results. No args: recent results. With signalId: specific signal.")
    .option("-l, --limit <n>", "Max results (default 20)", "20")
    .action(async (signalId, opts) => {
      try {
        const api = getApi(requireAuth());

        if (signalId) {
          const data = await api.get(`/flow/${encodeURIComponent(signalId)}`);
          const results = data.results || [];

          if (results.length === 0) {
            console.log(chalk.dim("No results for signal " + signalId));
            return;
          }

          console.log(chalk.bold(`Signal ${signalId}`) + chalk.dim(` (${results.length} result(s))`));
          for (const r of results) {
            const status = r.status === "succeeded" ? chalk.green(r.status)
              : r.status === "failed" ? chalk.red(r.status)
              : r.status === "rejected" ? chalk.yellow(r.status)
              : chalk.dim(r.status);
            const time = r.timestamp ? new Date(r.timestamp).toLocaleString() : "";
            const source = r.source ? chalk.dim(` source:${r.source.slice(0, 8)}`) : "";
            const ext = r.extName ? chalk.dim(` [${r.extName}]`) : "";
            console.log(`  ${status}${source}${ext} ${chalk.dim(time)}`);
            if (r.payload?.reason) {
              console.log(`    ${chalk.dim(r.payload.reason)}`);
            }
          }
        } else {
          const limit = parseInt(opts.limit) || 20;
          const data = await api.get(`/flow?limit=${limit}`);
          const results = data.results || data;

          const entries = typeof results === "object" && !Array.isArray(results)
            ? Object.entries(results)
            : [];

          if (entries.length === 0) {
            console.log(chalk.dim("No cascade results in .flow"));
            return;
          }

          console.log(chalk.bold("Recent cascade signals") + chalk.dim(` (${entries.length})`));
          for (const [sid, arr] of entries) {
            const list = Array.isArray(arr) ? arr : [arr];
            const latest = list[list.length - 1];
            const status = latest?.status === "succeeded" ? chalk.green("ok")
              : latest?.status === "failed" ? chalk.red("fail")
              : latest?.status === "rejected" ? chalk.yellow("rej")
              : chalk.dim(latest?.status || "?");
            const time = latest?.timestamp ? new Date(latest.timestamp).toLocaleString() : "";
            const count = list.length > 1 ? chalk.dim(` (${list.length} results)`) : "";
            console.log(`  ${chalk.cyan(sid.slice(0, 8))} ${status}${count} ${chalk.dim(time)}`);
          }
        }
      } catch (err) {
        console.error(chalk.red("Error:"), err.message);
      }
    });
};
