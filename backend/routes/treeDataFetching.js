import express from 'express';

import {
  getRootDetails,
  getTree,
  getParents,
  getRootNodes,
  getTreeForAi,
  getAllData,
} from '../controllers/treeDataFetching.js';

import authenticate from '../middleware/authenticate.js';

const router = express.Router();

// Endpoint to fetch root node IDs for user
router.get("/get-root-nodes", authenticate, getRootNodes);

// Endpoint to fetch root node details
router.post("/get-root-details", getRootDetails);

// Endpoint to fetch the full tree object
router.post("/get-tree", getTree);

router.post("/get-tree-ai", getTreeForAi);

router.post("/get-parents", getParents);

router.post("/get-all-data", authenticate, getAllData);

export default router;
