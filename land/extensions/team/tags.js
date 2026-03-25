import { NoteTag } from "./model.js";

/**
 * Extract @mentions from text and rewrite to canonical usernames.
 * Returns { tagged: [userId, ...], rewrittenContent }.
 */
export async function extractTaggedUsersAndRewrite(content, User) {
  const mentionRegex = /@([\w-]+)/g;
  const matches = [...content.matchAll(mentionRegex)];

  if (matches.length === 0) {
    return { tagged: [], rewrittenContent: content };
  }

  // normalize mentions to lowercase
  const identifiers = matches.map((m) => m[1].toLowerCase());

  // fetch all users once
  const users = await User.find({
    username: { $in: identifiers },
  }).collation({ locale: "en", strength: 2 }); // case-insensitive

  // build lookup maps
  const usernameToUser = {};
  users.forEach((u) => {
    usernameToUser[u.username.toLowerCase()] = u;
  });

  const taggedUserIds = [...new Set(users.map((u) => u._id.toString()))];

  // rewrite mentions using canonical username
  const rewrittenContent = content.replace(mentionRegex, (full, raw) => {
    const user = usernameToUser[raw.toLowerCase()];
    if (!user) return full;
    return `@${user.username}`;
  });

  return {
    tagged: taggedUserIds,
    rewrittenContent,
  };
}

/**
 * Sync NoteTag records for a note. Called from the afterNote hook.
 * Replaces any existing tags for this note with the current set.
 */
export async function syncTagsForNote({ noteId, content, nodeId, taggedBy, User }) {
  if (!content) {
    await NoteTag.deleteMany({ noteId });
    return;
  }

  const mentionRegex = /@([\w-]+)/g;
  const matches = [...content.matchAll(mentionRegex)];

  if (matches.length === 0) {
    await NoteTag.deleteMany({ noteId });
    return;
  }

  const usernames = matches.map((m) => m[1].toLowerCase());
  const users = await User.find({
    username: { $in: usernames },
  }).collation({ locale: "en", strength: 2 });

  const taggedUserIds = [...new Set(users.map((u) => u._id.toString()))];

  // Replace all tags for this note
  await NoteTag.deleteMany({ noteId });
  if (taggedUserIds.length > 0) {
    await NoteTag.insertMany(
      taggedUserIds.map((userId) => ({
        noteId,
        userId,
        nodeId,
        taggedBy,
      })),
    );
  }
}

/**
 * Remove all tags for a note. Called from afterNote on delete.
 */
export async function clearTagsForNote(noteId) {
  await NoteTag.deleteMany({ noteId });
}

/**
 * Get all notes where a user was tagged (mentioned).
 */
export async function getAllTagsForUser(userId, limit, startDate, endDate, Note) {
  if (!userId) {
    throw new Error("Missing required parameter: userId");
  }

  if (limit !== undefined && (typeof limit !== "number" || limit <= 0)) {
    throw new Error("Invalid limit: must be a positive number");
  }

  const queryObj = { userId };

  if (startDate || endDate) {
    queryObj.createdAt = {};
    if (startDate) queryObj.createdAt.$gte = new Date(startDate);
    if (endDate) queryObj.createdAt.$lte = new Date(endDate);
  }

  let query = NoteTag.find(queryObj).sort({ createdAt: -1 }).lean();
  if (typeof limit === "number") query = query.limit(limit);
  const tags = await query;

  if (tags.length === 0) return { notes: [] };

  // Fetch the actual notes
  const noteIds = [...new Set(tags.map((t) => t.noteId))];
  const notes = await Note.find({ _id: { $in: noteIds } })
    .populate("userId", "username")
    .sort({ createdAt: -1 })
    .lean();

  const noteMap = {};
  notes.forEach((n) => {
    noteMap[n._id] = n;
  });

  const notesWithTaggedBy = tags
    .map((t) => {
      const note = noteMap[t.noteId];
      if (!note) return null;
      return {
        ...note,
        authorId: note.userId?._id?.toString(),
        authorUsername: note.userId?.username,
        taggedBy: note.userId?._id?.toString(),
      };
    })
    .filter(Boolean);

  return { notes: notesWithTaggedBy };
}
