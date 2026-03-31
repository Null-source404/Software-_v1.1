const express = require('express');
const router = express.Router();
const urlController = require('../controllers/urlController');

// Routes
router.post('/shorten', urlController.shortenUrl);
router.get('/stats/:shortCode', urlController.getStats);
router.get('/:shortCode', urlController.redirectUrl);

module.exports = router;
