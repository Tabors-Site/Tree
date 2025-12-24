import {
  createInvite,
  respondToInvite,
  getPendingInvitesForUser,
} from "../core/invites.js";

export async function invite(req, res) {
  try {
    const result = await createInvite({
      userInvitingId: req.userId,
      ...req.body,
    });

    res.json({ success: true, ...result });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
}

export async function inviteAccept(req, res) {
  try {
    const result = await respondToInvite({
      userId: req.userId,
      ...req.body,
    });

    res.json({ success: true, ...result });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
}

export async function getPendingInvites(req, res) {
  try {
    const invites = await getPendingInvitesForUser(req.userId);
    res.json({ invites });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
