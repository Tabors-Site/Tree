import User from "../../db/models/user.js";
import Node from "../../db/models/node.js";
import { getUserMeta, setUserMeta } from "./userMetadata.js";

const URL_SAFE_REGEX = /^[A-Za-z0-9\-_.~]+$/;

export async function setHtmlShareToken({ userId, htmlShareToken }) {
  if (!userId) throw new Error("Not authenticated");
  if (typeof htmlShareToken !== "string") throw new Error("htmlShareToken must be a string");

  const token = htmlShareToken.trim();
  if (token.length < 1 || token.length > 128) throw new Error("htmlShareToken must be 1 to 128 characters");
  if (!URL_SAFE_REGEX.test(token)) throw new Error("htmlShareToken may only contain URL-safe characters");

  const user = await User.findById(userId);
  if (!user) throw new Error("User not found");

  setUserMeta(user, "html", { shareToken: token });
  await user.save();

  return { htmlShareToken: token };
}

export async function updateRecentRoots(userId, rootId) {
  if (!userId || !rootId) return;

  const node = await Node.findById(rootId).select("name");
  if (!node) return;

  await User.updateOne({ _id: userId }, { $pull: { recentRoots: { rootId } } });

  await User.updateOne(
    { _id: userId },
    {
      $push: {
        recentRoots: {
          $each: [
            {
              rootId,
              rootName: node.name,
              lastVisitedAt: new Date(),
            },
          ],
          $position: 0,
          $slice: 5,
        },
      },
    },
  );
}

export async function getRecentRootsByUserId(userId) {
  if (!userId) return [];

  const user = await User.findById(userId).select("recentRoots").lean();

  return user?.recentRoots ?? [];
}
