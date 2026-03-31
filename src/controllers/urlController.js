const pool = require('../config/db');
const { v4: uuidv4 } = require('uuid');
const validator = require('validator');

// Generate a short code
const generateShortCode = () => {
  return uuidv4().slice(0, 8);
};

// Shorten URL
const shortenUrl = async (req, res, next) => {
  try {
    const { originalUrl } = req.body;

    if (!originalUrl) {
      const error = new Error('Original URL is required');
      error.statusCode = 400;
      throw error;
    }

    if (!validator.isURL(originalUrl, { protocols: ['http', 'https'], require_protocol: true })) {
      const error = new Error('Invalid URL format. Include http:// or https://');
      error.statusCode = 400;
      throw error;
    }

    const shortCode = generateShortCode();
    const createdAt = new Date();

    const [result] = await pool.execute(
      'INSERT INTO urls (short_code, original_url, created_at, click_count) VALUES (?, ?, ?, 0)',
      [shortCode, originalUrl, createdAt]
    );

    const shortUrl = `${process.env.BASE_URL || 'http://localhost:3000'}/${shortCode}`;

    res.status(201).json({
      id: result.insertId,
      shortCode,
      shortUrl,
      originalUrl,
      createdAt,
      clickCount: 0,
    });
  } catch (error) {
    next(error);
  }
};

// Redirect to original URL
const redirectUrl = async (req, res, next) => {
  try {
    const { shortCode } = req.params;

    const [rows] = await pool.execute(
      'SELECT id, original_url, click_count FROM urls WHERE short_code = ?',
      [shortCode]
    );

    if (!rows || rows.length === 0) {
      const error = new Error('Short URL not found');
      error.statusCode = 404;
      throw error;
    }

    const { id, original_url, click_count } = rows[0];

    await pool.execute('UPDATE urls SET click_count = ? WHERE id = ?', [click_count + 1, id]);

    return res.redirect(original_url);
  } catch (error) {
    next(error);
  }
};

// Get statistics
const getStats = async (req, res, next) => {
  try {
    const { shortCode } = req.params;

    const [rows] = await pool.execute(
      'SELECT short_code, original_url, created_at, click_count FROM urls WHERE short_code = ?',
      [shortCode]
    );

    if (!rows || rows.length === 0) {
      const error = new Error('Short URL not found');
      error.statusCode = 404;
      throw error;
    }

    const stats = rows[0];

    res.status(200).json(stats);
  } catch (error) {
    next(error);
  }
};

module.exports = {
  shortenUrl,
  redirectUrl,
  getStats,
};
