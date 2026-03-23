import { getExtension } from "../extensions/loader.js";

export function errorHtml(status, title, message) {
  const htmlExt = getExtension("html-rendering");
  const render = htmlExt?.exports?.errorHtml;
  if (render) return render(status, title, message);
  return `<h1>${status} ${title}</h1><p>${message}</p>`;
}

export function notFoundPage(
  req,
  res,
  message = "This page doesn't exist or may have been moved.",
) {
  if (process.env.ENABLE_FRONTEND_HTML !== "true") {
    return res.status(404).json({ error: message });
  }
  return res.status(404).send(errorHtml(404, "Page Not Found", message));
}
