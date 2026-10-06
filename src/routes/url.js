const express = require('express');
const router = express.Router();
const urlController = require('../controllers/urlController');

// Routes
router.get('/urls', urlController.listUrls);
router.post('/verify-url', urlController.verifyUrl);
router.post('/shorten', urlController.shortenUrl);
router.post('/click/:shortCode', urlController.recordClickApi);
router.get('/stats/:shortCode', urlController.getStats);
router.get('/qr/:shortCode', urlController.getQrCode);
router.get('/preview/:shortCode', urlController.previewUrl);
router.delete('/urls/:shortCode', urlController.deleteUrl);
router.get('/:shortCode', urlController.redirectUrl);

module.exports = router;
