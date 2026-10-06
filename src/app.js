const path = require('path');
const express = require('express');
const dotenv = require('dotenv');
const errorHandler = require('./middleware/errorHandler');
const urlRoutes = require('./routes/url');
const urlController = require('./controllers/urlController');

dotenv.config();

const app = express();

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve frontend static files
app.use(express.static(path.join(__dirname, '../public')));

// API routes
app.use('/api', urlRoutes);

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'OK', message: 'Server is running' });
});

// Destination preview route (/preview/:shortCode and /:shortCode+)
app.get('/preview/:shortCode', urlController.previewUrl);

// Redirect route (root short code support, plus trailing '+' preview support)
app.get('/:shortCode', urlController.redirectUrl);

// 404 for non-routes when not found
app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// Error handling middleware
app.use(errorHandler);

// Start server when run directly
const PORT = Number(process.env.PORT) || 3000;
if (require.main === module) {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
}

module.exports = app;
