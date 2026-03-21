import mongoose from "mongoose";
import { v4 as uuidv4 } from "uuid";

const InviteSchema = new mongoose.Schema({
  _id: { type: String, required: true, default: uuidv4 },
  userInviting: { type: String, ref: "User", required: true },
  userReceiving: { type: String, ref: "User", required: true },
  isToBeOwner: { type: Boolean, default: false },
  isUninviting: { type: Boolean, default: false },
  status: {
    type: String,
    enum: ["pending", "accepted", "declined"],
    default: "pending",
  },
  rootId: { type: String, ref: "Node", required: true },

  // Set when this invite is from a remote land (cross-land invitation)
  remoteLandDomain: { type: String, default: null },
  remoteRootName: { type: String, default: null },
  remoteInviteId: { type: String, default: null },
  remoteInvitingUsername: { type: String, default: null },
});

const Invite = mongoose.model("Invite", InviteSchema);

export default Invite;
