import { updateScheduleHelper } from './helpers/schedulesHelper.js';

const updateSchedule = async (req, res) => {
  try {
    const result = await updateScheduleHelper({
      nodeId: req.body.nodeId,
      versionIndex: req.body.versionIndex,
      newSchedule: req.body.newSchedule,
      reeffectTime: req.body.reeffectTime,
      userId: req.userId,
    });
    res.status(200).json(result);
  } catch (err) {
    res.status(err.status || 500).json({ message: err.message });
  }
};

export { updateSchedule };
