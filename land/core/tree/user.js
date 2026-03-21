import User from "../../db/models/user.js";
import Node from "../../db/models/node.js";

const URL_SAFE_REGEX = /^[A-Za-z0-9\-_.~]+$/;

export async function setHtmlShareToken({ userId, htmlShareToken }) {
  if (!userId) {
    const err = new Error("Not authenticated");
    throw err;
  }

  if (typeof htmlShareToken !== "string") {
    const err = new Error("htmlShareToken must be a string");
    throw err;
  }

  const token = htmlShareToken.trim();

  if (token.length < 1 || token.length > 128) {
    const err = new Error("htmlShareToken must be 1–128 characters");
    throw err;
  }

  if (!URL_SAFE_REGEX.test(token)) {
    const err = new Error(
      "htmlShareToken may only contain URL-safe characters (A–Z a–z 0–9 - _ . ~)",
    );
    throw err;
  }

  const user = await User.findById(userId);
  if (!user) {
    const err = new Error("User not found");
    err.code = "USER_NOT_FOUND";
    throw err;
  }

  user.htmlShareToken = token;
  await user.save();

  return {
    htmlShareToken: user.htmlShareToken,
  };
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
