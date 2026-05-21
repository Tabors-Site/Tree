import createRouter from "./routes.js";
import { getExtension } from "../loader.js";

export async function init(core) {
  // Register quick links on the user profile page
  const treeos = getExtension("treeos-base");
  if (treeos?.exports?.registerSlot) {
    const { registerSlot } = treeos.exports;
    registerSlot("user-quick-links", "user-queries", ({ beingId, queryString }) =>
      `<li><a href="/api/v1/user/${beingId}/notes${queryString}">Notes</a></li>
       <li><a href="/api/v1/user/${beingId}/chats${queryString}">AI Chats</a></li>
       <li><a href="/api/v1/user/${beingId}/contributions${queryString}">Contributions</a></li>
       <li><a href="/api/v1/user/${beingId}/tags${queryString}">Mail</a></li>`,
      { priority: 20 }
    );
    registerSlot("tree-quick-links", "user-queries", ({ rootId, queryString }) =>
      `<a href="/api/v1/root/${rootId}/chats${queryString}" class="back-link">AI Chats</a>`,
      { priority: 40 }
    );
  }

  return {
    router: createRouter(core),
  };
}
