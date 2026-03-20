import express from "express";

import {
  getTree,
  getParents,
  getTreeForAi,
  getAllData,
} from "../core/tree/treeDataFetching.js";

import authenticate from "../middleware/authenticate.js";

const router = express.Router();
//legcay need to be reordered
router.post("/get-tree", getTree);

router.post("/get-tree-ai", getTreeForAi);

router.post("/get-parents", getParents);

router.post("/get-all-data", authenticate, getAllData);

export default router;
