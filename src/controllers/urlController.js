const pool = require('../config/db');
const { v4: uuidv4 } = require('uuid');
const validator = require('validator');
const QRCode = require('qrcode');
const { evaluateUrlSafety } = require('../utils/urlSafety');

const RESERVED_CODES = new Set([
  'api',
  'health',
  'stats',
  'shorten',
  'urls',
  'verify-url',
  'qr',
  'public',
  'favicon.ico',
]);
const CUSTOM_CODE_REGEX = /^[a-zA-Z0-9_-]{3,24}$/;

// Generate a random 8-character short code
const generateShortCode = () => {
  return uuidv4().replace(/-/g, '').slice(0, 8);
};

// Build public base URL from env or request headers
const resolveBaseUrl = (req) => {
  if (process.env.BASE_URL) {
    return process.env.BASE_URL.replace(/\/+$/, '');
  }
  const proto = req.get('x-forwarded-proto') || req.protocol || 'http';
  const host = req.get('host') || 'localhost:3000';
  return `${proto}://${host}`;
};

// Generate a Data URL PNG QR code for a given link
const generateQrCodeDataUrl = async (urlText) => {
  return QRCode.toDataURL(urlText, {
    width: 180,
    margin: 1,
    errorCorrectionLevel: 'M',
    color: {
      dark: '#0f172a',
      light: '#ffffff',
    },
  });
};

// Normalize URL (prepend https:// if user enters www.example.co.org or example.com without protocol)
const normalizeInputUrl = (input) => {
  const trimmed = typeof input === 'string' ? input.trim() : '';
  if (!trimmed) return '';
  if (/^[a-zA-Z][a-zA-Z\d+\-.]*:\/\//.test(trimmed)) {
    return trimmed;
  }
  // Prepend https:// if it looks like a domain (e.g. www.example.co.org or example.com/path)
  if (/^(www\.|[a-zA-Z0-9-]+\.[a-zA-Z]{2,})/i.test(trimmed)) {
    return `https://${trimmed}`;
  }
  return trimmed;
};

// Pre-verify a URL for phishing or broken status
const verifyUrl = async (req, res, next) => {
  try {
    const rawInput = typeof req.body.originalUrl === 'string' ? req.body.originalUrl.trim() : '';
    if (!rawInput) {
      const error = new Error('URL is required for safety verification');
      error.statusCode = 400;
      throw error;
    }

    const normalizedUrl = normalizeInputUrl(rawInput);

    // Check if the raw input had "@" authority spoofing even before validator.isURL
    if (rawInput.includes('@')) {
      const safety = await evaluateUrlSafety(normalizedUrl);
      if (!safety.allowed) {
        return res.status(200).json({
          normalizedUrl,
          ...safety,
        });
      }
    }

    if (
      !validator.isURL(normalizedUrl, {
        protocols: ['http', 'https'],
        require_protocol: true,
        require_tld: true,
      })
    ) {
      return res.status(200).json({
        normalizedUrl,
        allowed: false,
        status: 'broken',
        category: 'Invalid URL Format',
        reasons: ['URL format is invalid. Example: https://example.com or www.example.co.org'],
      });
    }

    const safety = await evaluateUrlSafety(normalizedUrl);
    return res.status(200).json({
      normalizedUrl,
      ...safety,
    });
  } catch (error) {
    next(error);
  }
};

// Shorten URL
const shortenUrl = async (req, res, next) => {
  try {
    const rawInput = typeof req.body.originalUrl === 'string' ? req.body.originalUrl.trim() : '';
    const rawCustomCode = typeof req.body.customCode === 'string' ? req.body.customCode.trim() : '';

    if (!rawInput) {
      const error = new Error('Original URL is required');
      error.statusCode = 400;
      throw error;
    }

    const rawUrl = normalizeInputUrl(rawInput);

    // Evaluate phishing indicators first in case URL contains deceptive @ syntax
    if (rawInput.includes('@')) {
      const earlySafety = await evaluateUrlSafety(rawUrl);
      if (!earlySafety.allowed) {
        const error = new Error(
          `${earlySafety.category}: ${earlySafety.reasons.join(' ')}`
        );
        error.statusCode = 422;
        error.safetyStatus = earlySafety.status;
        error.safetyCategory = earlySafety.category;
        error.reasons = earlySafety.reasons;
        throw error;
      }
    }

    if (
      !validator.isURL(rawUrl, {
        protocols: ['http', 'https'],
        require_protocol: true,
        require_tld: true,
      })
    ) {
      const error = new Error('Invalid URL format. Example: https://example.com or www.example.co.org');
      error.statusCode = 400;
      throw error;
    }

    // Security & Broken-Link Verification: disallow broken and phishing links
    const safety = await evaluateUrlSafety(rawUrl);
    if (!safety.allowed) {
      const error = new Error(
        `${safety.category}: ${safety.reasons.join(' ')}`
      );
      error.statusCode = 422;
      error.safetyStatus = safety.status;
      error.safetyCategory = safety.category;
      error.reasons = safety.reasons;
      throw error;
    }

    let shortCode = generateShortCode();

    if (rawCustomCode) {
      if (!CUSTOM_CODE_REGEX.test(rawCustomCode)) {
        const error = new Error(
          'Custom alias must be 3–24 characters using letters, numbers, hyphens, or underscores'
        );
        error.statusCode = 400;
        throw error;
      }

      if (RESERVED_CODES.has(rawCustomCode.toLowerCase())) {
        const error = new Error('This custom alias is reserved and cannot be used');
        error.statusCode = 400;
        throw error;
      }

      const [existing] = await pool.execute(
        'SELECT id FROM urls WHERE short_code = ?',
        [rawCustomCode]
      );
      if (existing && existing.length > 0) {
        const error = new Error(`Short code "${rawCustomCode}" is already in use`);
        error.statusCode = 409;
        throw error;
      }

      shortCode = rawCustomCode;
    }

    const createdAt = new Date();

    const [result] = await pool.execute(
      'INSERT INTO urls (short_code, original_url, created_at, click_count) VALUES (?, ?, ?, 0)',
      [shortCode, rawUrl, createdAt]
    );

    const shortUrl = `${resolveBaseUrl(req)}/${shortCode}`;
    const qrCodeDataUrl = await generateQrCodeDataUrl(shortUrl);

    res.status(201).json({
      id: result.insertId,
      shortCode,
      short_code: shortCode,
      shortUrl,
      qrCodeDataUrl,
      originalUrl: rawUrl,
      original_url: rawUrl,
      safetyStatus: safety.status,
      safetyCategory: safety.category,
      createdAt,
      created_at: createdAt,
      last_accessed_at: null,
      clickCount: 0,
      click_count: 0,
    });
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') {
      error.statusCode = 409;
      error.message = 'Short code is already in use';
    }
    next(error);
  }
};

// List all shortened URLs with QR codes
const listUrls = async (req, res, next) => {
  try {
    const [rows] = await pool.execute(
      'SELECT id, short_code, original_url, created_at, last_accessed_at, click_count FROM urls ORDER BY created_at DESC'
    );

    const baseUrl = resolveBaseUrl(req);
    const urls = await Promise.all(
      (rows || []).map(async (row) => {
        const shortUrl = `${baseUrl}/${row.short_code}`;
        const qrCodeDataUrl = await generateQrCodeDataUrl(shortUrl);
        return {
          id: row.id,
          shortCode: row.short_code,
          short_code: row.short_code,
          shortUrl,
          qrCodeDataUrl,
          originalUrl: row.original_url,
          original_url: row.original_url,
          safetyStatus: 'verified',
          createdAt: row.created_at,
          created_at: row.created_at,
          lastAccessedAt: row.last_accessed_at || null,
          last_accessed_at: row.last_accessed_at || null,
          clickCount: Number(row.click_count) || 0,
          click_count: Number(row.click_count) || 0,
        };
      })
    );

    res.status(200).json({
      count: urls.length,
      totalClicks: urls.reduce((sum, item) => sum + item.click_count, 0),
      urls,
    });
  } catch (error) {
    next(error);
  }
};

// Redirect to original URL (blocks access if URL fails phishing or broken-link checks)
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

    // Re-verify safety before redirecting to protect visitors from compromised or broken targets
    const safety = await evaluateUrlSafety(original_url);
    if (!safety.allowed) {
      const error = new Error(
        `Access blocked — ${safety.category}: ${safety.reasons.join(' ')}`
      );
      error.statusCode = 403;
      error.safetyStatus = safety.status;
      error.safetyCategory = safety.category;
      error.reasons = safety.reasons;
      throw error;
    }

    const now = new Date();

    await pool.execute(
      'UPDATE urls SET click_count = ?, last_accessed_at = ? WHERE id = ?',
      [Number(click_count) + 1, now, id]
    );

    return res.redirect(original_url);
  } catch (error) {
    next(error);
  }
};

// Get statistics for a specific short code (including QR code)
const getStats = async (req, res, next) => {
  try {
    const { shortCode } = req.params;

    const [rows] = await pool.execute(
      'SELECT id, short_code, original_url, created_at, last_accessed_at, click_count FROM urls WHERE short_code = ?',
      [shortCode]
    );

    if (!rows || rows.length === 0) {
      const error = new Error('Short URL not found');
      error.statusCode = 404;
      throw error;
    }

    const stats = rows[0];
    const baseUrl = resolveBaseUrl(req);
    const shortUrl = `${baseUrl}/${stats.short_code}`;
    const qrCodeDataUrl = await generateQrCodeDataUrl(shortUrl);

    res.status(200).json({
      ...stats,
      shortCode: stats.short_code,
      shortUrl,
      qrCodeDataUrl,
      originalUrl: stats.original_url,
      createdAt: stats.created_at,
      lastAccessedAt: stats.last_accessed_at || null,
      clickCount: Number(stats.click_count) || 0,
    });
  } catch (error) {
    next(error);
  }
};

// Get standalone QR code for a short code
const getQrCode = async (req, res, next) => {
  try {
    const { shortCode } = req.params;
    const [rows] = await pool.execute(
      'SELECT short_code, original_url FROM urls WHERE short_code = ?',
      [shortCode]
    );

    if (!rows || rows.length === 0) {
      const error = new Error('Short URL not found');
      error.statusCode = 404;
      throw error;
    }

    const shortUrl = `${resolveBaseUrl(req)}/${rows[0].short_code}`;
    const qrCodeDataUrl = await generateQrCodeDataUrl(shortUrl);

    res.status(200).json({
      shortCode: rows[0].short_code,
      shortUrl,
      qrCodeDataUrl,
    });
  } catch (error) {
    next(error);
  }
};

// Delete a shortened URL
const deleteUrl = async (req, res, next) => {
  try {
    const { shortCode } = req.params;

    const [result] = await pool.execute(
      'DELETE FROM urls WHERE short_code = ?',
      [shortCode]
    );

    if (!result || result.affectedRows === 0) {
      const error = new Error('Short URL not found');
      error.statusCode = 404;
      throw error;
    }

    res.status(200).json({
      message: 'Short URL deleted successfully',
      shortCode,
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  verifyUrl,
  shortenUrl,
  listUrls,
  redirectUrl,
  getStats,
  getQrCode,
  deleteUrl,
};
