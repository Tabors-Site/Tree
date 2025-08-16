const {
  editStatusHelper,
  addPrestigeHelper,
} = require("./helpers/statusesHelper");

async function editStatus(req, res) {
  try {
    const result = await editStatusHelper({
      nodeId: req.body.nodeId,
      status: req.body.status,
      version: req.body.version,
      isInherited: req.body.isInherited,
      userId: req.userId,
    });
    res.status(200).json({ success: true, ...result });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
}

async function addPrestige(req, res) {
  try {
    const result = await addPrestigeHelper({
      nodeId: req.body.nodeId,
      userId: req.userId,
    });
    res.status(200).json({ success: true, ...result });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
}

module.exports = {
  editStatus,
  addPrestige,
};
