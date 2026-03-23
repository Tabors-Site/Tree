const chalk = require("chalk");
const fetch = require("node-fetch");
const TreeAPI = require("../api");
const { requireAuth, load, save } = require("../config");

function getApi() {
  const cfg = requireAuth();
  return new TreeAPI(cfg.apiKey);
}

async function refreshProtocolCache() {
  try {
    const cfg = load();
    if (!cfg.landUrl) return;
    let url = cfg.landUrl;
    if (!/^https?:\/\//i.test(url)) url = "https://" + url;
    const res = await fetch(`${url}/api/v1/protocol`);
    if (res.ok) {
      cfg.landProtocol = await res.json();
      save(cfg);
    }
  } catch {}
}

function printSearchResults(data, query) {
  if (!data.extensions || data.extensions.length === 0) {
    console.log(chalk.dim(query ? `No extensions found for "${query}"` : "Registry is empty."));
    return;
  }
  console.log(chalk.bold(`Registry (${data.total} extensions)\n`));
  for (const ext of data.extensions) {
    const tags = ext.tags?.length ? chalk.dim(` [${ext.tags.join(", ")}]`) : "";
    const dl = ext.downloads ? chalk.dim(` ${ext.downloads} downloads`) : "";
    console.log(`  ${chalk.cyan(ext.name)} ${chalk.dim("v" + ext.version)}${tags}${dl}`);
    console.log(`  ${chalk.dim(ext.description || "")}`);
    if (ext.authorDomain) console.log(`  ${chalk.dim("by " + ext.authorDomain)}`);
    console.log();
  }
}

module.exports = (program) => {
  const ext = program
    .command("ext")
    .description("Manage land extensions")
    .action(() => {
      ext.outputHelp();
    });

  ext
    .command("list")
    .alias("ls")
    .description("List all loaded extensions")
    .action(async () => {
      try {
        const api = getApi();
        const data = await api.getExtensions();

        if (!data.loaded || data.loaded.length === 0) {
          console.log(chalk.dim("No extensions loaded."));
          return;
        }

        console.log(chalk.bold(`Extensions (${data.count} loaded)\n`));

        for (const ext of data.loaded) {
          const parts = [];
          if (ext.provides.routes) parts.push("routes");
          if (ext.provides.tools) parts.push("tools");
          if (ext.provides.jobs) parts.push("jobs");
          if (ext.provides.models.length) parts.push(`${ext.provides.models.length} models`);

          const badges = parts.length ? chalk.dim(` [${parts.join(", ")}]`) : "";
          console.log(`  ${chalk.cyan(ext.name)} ${chalk.dim("v" + ext.version)}${badges}`);
          console.log(`  ${chalk.dim(ext.description)}`);

          if (ext.needs.extensions?.length) {
            console.log(`  ${chalk.dim("depends on:")} ${ext.needs.extensions.join(", ")}`);
          }
          console.log();
        }

        if (data.disabled && data.disabled.length > 0) {
          console.log(chalk.bold("Disabled:\n"));
          for (const d of data.disabled) {
            const name = typeof d === "string" ? d : d.name;
            console.log(`  ${chalk.dim(name)} ${chalk.red("(disabled)")}`);
          }
          console.log();
        }
      } catch (err) {
        console.error(chalk.red("Error:"), err.message);
      }
    });

  ext
    .command("info [name...]")
    .description("Show details for an extension")
    .action(async (parts) => {
      if (!parts || !parts.length) return console.log(chalk.yellow("Usage: ext info <name>. Run 'ext list' to see loaded extensions."));
      const name = parts.join("-");
      try {
        const api = getApi();
        const data = await api.getExtension(name);

        if (!data.manifest) {
          console.log(chalk.red(`Extension "${name}" not found. Run 'ext list' to see available extensions.`));
          return;
        }

        const m = data.manifest;
        const statusLabel = data.status === "disabled" ? chalk.red(" (disabled)") : chalk.green(" (active)");
        console.log(chalk.bold(m.name), chalk.dim("v" + m.version) + statusLabel);
        if (m.description) console.log(m.description);
        console.log();

        if (m.needs) {
          console.log(chalk.bold("Requires:"));
          if (m.needs.services?.length) console.log(`  services: ${m.needs.services.join(", ")}`);
          if (m.needs.models?.length) console.log(`  models: ${m.needs.models.join(", ")}`);
          if (m.needs.extensions?.length) console.log(`  extensions: ${m.needs.extensions.join(", ")}`);
          console.log();
        }

        if (m.optional?.services?.length || m.optional?.extensions?.length) {
          console.log(chalk.bold("Optional:"));
          if (m.optional.services?.length) console.log(`  services: ${m.optional.services.join(", ")}`);
          if (m.optional.extensions?.length) console.log(`  extensions: ${m.optional.extensions.join(", ")}`);
          console.log();
        }

        if (m.provides) {
          console.log(chalk.bold("Provides:"));
          if (m.provides.routes) console.log("  routes");
          if (m.provides.models && Object.keys(m.provides.models).length) {
            console.log(`  models: ${Object.keys(m.provides.models).join(", ")}`);
          }
          if (m.provides.energyActions && Object.keys(m.provides.energyActions).length) {
            console.log(`  energy actions: ${Object.keys(m.provides.energyActions).join(", ")}`);
          }
          if (m.provides.sessionTypes && Object.keys(m.provides.sessionTypes).length) {
            console.log(`  session types: ${Object.keys(m.provides.sessionTypes).join(", ")}`);
          }
        }
      } catch (err) {
        console.error(chalk.red("Error:"), err.message);
      }
    });

  ext
    .command("search [query...]")
    .description("Search the extension registry (no login required)")
    .action(async (parts) => {
      const query = parts ? parts.join(" ") : "";
      try {
        // Search doesn't require auth, hits directory directly
        const cfg = load();
        let dirUrl;
        if (cfg.apiKey) {
          try {
            const api = getApi();
            const data = await api.searchRegistry(query);
            return printSearchResults(data, query);
          } catch {}
        }
        // Fallback: hit directory directly
        dirUrl = "https://dir.treeos.ai";
        const qs = query ? `?q=${encodeURIComponent(query)}` : "";
        const res = await fetch(`${dirUrl}/extensions${qs}`, {
          headers: { "Content-Type": "application/json" },
        });
        if (!res.ok) throw new Error(`Registry unavailable (${res.status})`);
        const data = await res.json();
        printSearchResults(data, query);
      } catch (err) {
        console.error(chalk.red("Error:"), err.message);
      }
    });

  ext
    .command("install [name...]")
    .description("Install an extension from the registry")
    .action(async (parts) => {
      if (!parts || !parts.length) return console.log(chalk.yellow("Usage: ext install <name> [version]. Run 'ext search' to find extensions."));
      const name = parts[0];
      const version = parts[1] || null;
      try {
        const api = getApi();
        console.log(chalk.dim(`Fetching ${name}${version ? "@" + version : ""} from registry...`));
        const data = await api.installExtension(name, version);
        console.log(chalk.green(`Installed: ${name} v${data.version || "?"}`));
        console.log(chalk.dim(`${data.filesWritten} files written.`));

        // Check if this extension needs other extensions
        if (data.needs?.extensions?.length > 0) {
          const protocol = await api.get("/protocol");
          const loaded = new Set(protocol?.extensions || []);
          const missing = data.needs.extensions.filter(dep => !loaded.has(dep));
          if (missing.length > 0) {
            console.log(chalk.yellow(`\nRequires: ${missing.join(", ")}`));
            for (const dep of missing) {
              console.log(chalk.dim(`  Installing ${dep}...`));
              try {
                const depData = await api.installExtension(dep);
                console.log(chalk.green(`  Installed: ${dep} v${depData.version || "?"}`));
              } catch (depErr) {
                console.log(chalk.red(`  Failed to install ${dep}: ${depErr.message}`));
              }
            }
          }
        }

        console.log(chalk.dim("Restart the land to load it."));
        await refreshProtocolCache();
      } catch (err) {
        console.error(chalk.red("Error:"), err.message);
      }
    });

  ext
    .command("publish [name...]")
    .description("Publish a local extension to the registry")
    .action(async (parts) => {
      if (!parts || !parts.length) return console.log(chalk.yellow("Usage: ext publish <name>. Run 'ext list' to see local extensions."));
      const name = parts.join("-");
      try {
        const api = getApi();
        console.log(chalk.dim(`Publishing ${name} to registry...`));
        const data = await api.publishExtension(name);
        console.log(chalk.green(`Published: ${data.name} v${data.version}`));
      } catch (err) {
        console.error(chalk.red("Error:"), err.message);
      }
    });

  ext
    .command("disable [name...]")
    .description("Disable an extension (takes effect on restart)")
    .action(async (parts) => {
      if (!parts || !parts.length) return console.log(chalk.yellow("Usage: ext disable <name>. Run 'ext list' to see loaded extensions."));
      const name = parts.join("-");
      try {
        const api = getApi();
        const data = await api.disableExtension(name);
        console.log(chalk.yellow(`Disabled: ${name}`));
        console.log(chalk.dim("Restart the land for this to take effect."));
        if (data.disabledExtensions?.length) {
          console.log(chalk.dim("Currently disabled:"), data.disabledExtensions.join(", "));
        }
        await refreshProtocolCache();
      } catch (err) {
        console.error(chalk.red("Error:"), err.message);
      }
    });

  ext
    .command("enable [name...]")
    .description("Re-enable a disabled extension (takes effect on restart)")
    .action(async (parts) => {
      if (!parts || !parts.length) return console.log(chalk.yellow("Usage: ext enable <name>. Run 'ext list' to see disabled extensions."));
      const name = parts.join("-");
      try {
        const api = getApi();
        const data = await api.enableExtension(name);
        console.log(chalk.green(`Enabled: ${name}`));
        console.log(chalk.dim("Restart the land for this to take effect."));
        await refreshProtocolCache();
      } catch (err) {
        console.error(chalk.red("Error:"), err.message);
      }
    });

  ext
    .command("uninstall [name...]")
    .description("Remove an extension (data in database is kept)")
    .action(async (parts) => {
      if (!parts || !parts.length) return console.log(chalk.yellow("Usage: ext uninstall <name>. This removes code but keeps database data."));
      const name = parts.join("-");
      const readline = require("readline");
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

      rl.question(chalk.yellow(`Remove extension "${name}"? This deletes the code but keeps your data. (y/N) `), async (answer) => {
        rl.close();
        if (answer.toLowerCase() !== "y") {
          console.log(chalk.dim("Cancelled."));
          return;
        }

        try {
          const api = getApi();
          const data = await api.uninstallExtension(name);
          console.log(chalk.green(`Uninstalled: ${name}`));
          console.log(chalk.dim("Extension directory removed. Database data is untouched."));
          console.log(chalk.dim("Restart the land to apply."));
          await refreshProtocolCache();
        } catch (err) {
          console.error(chalk.red("Error:"), err.message);
        }
      });
    });
};
