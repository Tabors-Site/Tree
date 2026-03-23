import User from "../../db/models/user.js";
import Node from "../../db/models/node.js";

// setHtmlShareToken moved to extensions/html-rendering/routes.js

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
