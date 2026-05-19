import log from "../../seed/log.js";
import { renderTermsPage, renderPrivacyPage } from "./pages.js";

export async function init(core) {
  try {
    const { getExtension } = await import("../loader.js");
    const htmlExt = getExtension("html-rendering");
    if (htmlExt?.pageRouter) {
      htmlExt.pageRouter.get("/terms", (req, res) => {
        res.setHeader("Content-Type", "text/html");
        res.send(renderTermsPage());
      });
      htmlExt.pageRouter.get("/privacy", (req, res) => {
        res.setHeader("Content-Type", "text/html");
        res.send(renderPrivacyPage());
      });
    }

  } catch {}

  log.info("Legal", "Terms and Privacy pages loaded");
  return {};
}
