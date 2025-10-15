import express from 'express';
import { addNode, addNodesTree, deleteNode, editNodeName, updateNodeParent } from '../controllers/treeManagement.js';
import authenticate from '../middleware/authenticate.js';

const router = express.Router();

router.post("/add-node", authenticate, addNode);
router.post("/add-nodes-tree", authenticate, addNodesTree);
router.post("/delete-node", authenticate, deleteNode);
router.post("/edit-name", authenticate, editNodeName);
router.post("/update-parent", authenticate, updateNodeParent);

export default router;
