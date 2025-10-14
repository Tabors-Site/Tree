const express = require('express');
const router = express.Router();
const {  getContributions } = require('../controllers/contributions');


// Route for getting contributions
router.post('/get-contributions', getContributions);

// Export the router
module.exports = router;
