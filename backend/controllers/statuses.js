import {
  editStatus as coreEditStatus,
  addPrestige as coreAddPrestige,
} from '../core/statuses.js';

async function editStatus(req, res) {
  try {
    const result = await coreEditStatus({
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
    const result = await coreAddPrestige({
      nodeId: req.body.nodeId,
      userId: req.userId,
    });
    res.status(200).json({ success: true, ...result });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
}

export {
  editStatus,
  addPrestige,
};
