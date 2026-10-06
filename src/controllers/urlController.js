const pool = require('../config/db');
const { v4: uuidv4 } = require('uuid');
const validator = require('validator');
const QRCode = require('qrcode');
const { evaluateUrlSafety, checkPhishingIndicators } = require('../utils/urlSafety');

const RESERVED_CODES = new Set([
  'api',
  'health',
  'stats',
  'shorten',
  'urls',
  'verify-url',
  'qr',
  'preview',
  'click',
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

// Normalize URL (prepend https:// if user enters www.example.co.org or facebook.com without protocol)
const normalizeInputUrl = (input) => {
  const trimmed = typeof input === 'string' ? input.trim() : '';
  if (!trimmed) return '';
  if (/^[a-zA-Z][a-zA-Z\d+\-.]*:\/\//.test(trimmed)) {
    return trimmed;
  }
  if (/^(www\.|[a-zA-Z0-9-]+\.[a-zA-Z]{2,})/i.test(trimmed)) {
    return `https://${trimmed}`;
  }
  return trimmed;
};

// Parse stored analytics JSON safely
const parseAnalytics = (rawJson) => {
  const fallback = {
    devices: {},
    browsers: {},
    referrers: {},
    timeline: {},
    recentEvents: [],
  };
  if (!rawJson) return fallback;
  try {
    const parsed = typeof rawJson === 'string' ? JSON.parse(rawJson) : rawJson;
    return {
      devices: parsed.devices || {},
      browsers: parsed.browsers || {},
      referrers: parsed.referrers || {},
      timeline: parsed.timeline || {},
      recentEvents: Array.isArray(parsed.recentEvents) ? parsed.recentEvents : [],
    };
  } catch {
    return fallback;
  }
};

// Extract visitor device, browser, OS, and referrer from request headers
const extractRequestTelemetry = (req) => {
  const ua = String(req.get('user-agent') || '');
  const refHeader = String(req.get('referer') || req.get('referrer') || '').trim();

  let device = 'Desktop';
  if (/ipad|tablet|kindle|playbook|silk/i.test(ua)) {
    device = 'Tablet';
  } else if (/mobile|iphone|ipod|android.*mobile|windows phone/i.test(ua)) {
    device = 'Mobile';
  } else if (/curl|wget|postman|insomnia|bot|spider|crawler/i.test(ua) || !ua) {
    device = 'CLI / API';
  }

  let browser = 'Other';
  if (/edg\//i.test(ua)) {
    browser = 'Edge';
  } else if (/opr\/|opera/i.test(ua)) {
    browser = 'Opera';
  } else if (/chrome\/|crios\//i.test(ua)) {
    browser = 'Chrome';
  } else if (/firefox\/|fxios\//i.test(ua)) {
    browser = 'Firefox';
  } else if (/safari\//i.test(ua) && !/chrome|crios|edg/i.test(ua)) {
    browser = 'Safari';
  } else if (/curl|wget|postman|insomnia/i.test(ua) || !ua) {
    browser = 'CLI / API';
  }

  let os = 'Other';
  if (/iphone|ipad|ipod/i.test(ua)) {
    os = 'iOS';
  } else if (/android/i.test(ua)) {
    os = 'Android';
  } else if (/macintosh|mac os x/i.test(ua)) {
    os = 'macOS';
  } else if (/windows/i.test(ua)) {
    os = 'Windows';
  } else if (/linux/i.test(ua)) {
    os = 'Linux';
  }

  let referrer = 'Direct';
  if (refHeader) {
    try {
      const refUrl = new URL(refHeader);
      const reqHost = (req.get('host') || '').split(':')[0];
      if (refUrl.hostname && refUrl.hostname !== reqHost) {
        referrer = refUrl.hostname;
      } else if (refUrl.hostname === reqHost) {
        referrer = 'Dashboard';
      }
    } catch {
      referrer = 'Direct';
    }
  }

  return { device, browser, os, referrer };
};

// Update analytics object with a new click event
const recordClickEvent = (existingJson, req, timestampDate) => {
  const analytics = parseAnalytics(existingJson);
  const { device, browser, os, referrer } = extractRequestTelemetry(req);
  const dayKey = timestampDate.toISOString().slice(0, 10);

  analytics.devices[device] = (analytics.devices[device] || 0) + 1;
  analytics.browsers[browser] = (analytics.browsers[browser] || 0) + 1;
  analytics.referrers[referrer] = (analytics.referrers[referrer] || 0) + 1;
  analytics.timeline[dayKey] = (analytics.timeline[dayKey] || 0) + 1;

  analytics.recentEvents.unshift({
    timestamp: timestampDate.toISOString(),
    device,
    browser,
    os,
    referrer,
  });
  analytics.recentEvents = analytics.recentEvents.slice(0, 15);

  return analytics;
};

// Escape HTML entities for safe server-rendered preview page
const escapeHtml = (str) =>
  String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

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
    const rawMaxClicks = req.body.maxClicks;

    if (!rawInput) {
      const error = new Error('Original URL is required');
      error.statusCode = 400;
      throw error;
    }

    let maxClicks = null;
    if (rawMaxClicks !== undefined && rawMaxClicks !== null && String(rawMaxClicks).trim() !== '') {
      const parsedMax = Number(rawMaxClicks);
      if (!Number.isInteger(parsedMax) || parsedMax < 1 || parsedMax > 1000000) {
        const error = new Error('Max clicks limit must be a whole number between 1 and 1,000,000');
        error.statusCode = 400;
        throw error;
      }
      maxClicks = parsedMax;
    }

    const rawUrl = normalizeInputUrl(rawInput);

    if (rawInput.includes('@')) {
      const earlySafety = await evaluateUrlSafety(rawUrl);
      if (!earlySafety.allowed) {
        const error = new Error(`${earlySafety.category}: ${earlySafety.reasons.join(' ')}`);
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
      const error = new Error(`${safety.category}: ${safety.reasons.join(' ')}`);
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

      const [existing] = await pool.execute('SELECT id FROM urls WHERE short_code = ?', [rawCustomCode]);
      if (existing && existing.length > 0) {
        const error = new Error(`Short code "${rawCustomCode}" is already in use`);
        error.statusCode = 409;
        throw error;
      }

      shortCode = rawCustomCode;
    }

    const createdAt = new Date();
    const initialAnalytics = parseAnalytics(null);

    const [result] = await pool.execute(
      'INSERT INTO urls (short_code, original_url, created_at, click_count, max_clicks, analytics_json) VALUES (?, ?, ?, 0, ?, ?)',
      [shortCode, rawUrl, createdAt, maxClicks, JSON.stringify(initialAnalytics)]
    );

    const baseUrl = resolveBaseUrl(req);
    const shortUrl = `${baseUrl}/${shortCode}`;
    const previewUrl = `${baseUrl}/${shortCode}+`;
    // Encode the verified destination URL so phone cameras can open the link on any network (even when server runs on localhost or private dev container)
    const qrCodeDataUrl = await generateQrCodeDataUrl(rawUrl);
    const shortUrlQrDataUrl = await generateQrCodeDataUrl(shortUrl);

    res.status(201).json({
      id: result.insertId,
      shortCode,
      short_code: shortCode,
      shortUrl,
      previewUrl,
      qrCodeDataUrl,
      shortUrlQrDataUrl,
      originalUrl: rawUrl,
      original_url: rawUrl,
      safetyStatus: safety.status,
      safetyCategory: safety.category,
      createdAt,
      created_at: createdAt,
      last_accessed_at: null,
      clickCount: 0,
      click_count: 0,
      maxClicks,
      max_clicks: maxClicks,
      limitReached: false,
      analytics: initialAnalytics,
    });
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') {
      error.statusCode = 409;
      error.message = 'Short code is already in use';
    }
    next(error);
  }
};

// List all shortened URLs with QR codes, quotas, and analytics
const listUrls = async (req, res, next) => {
  try {
    const [rows] = await pool.execute(
      'SELECT id, short_code, original_url, created_at, last_accessed_at, click_count, max_clicks, analytics_json FROM urls ORDER BY created_at DESC'
    );

    const baseUrl = resolveBaseUrl(req);
    const urls = await Promise.all(
      (rows || []).map(async (row) => {
        const shortUrl = `${baseUrl}/${row.short_code}`;
        const previewUrl = `${baseUrl}/${row.short_code}+`;
        const qrCodeDataUrl = await generateQrCodeDataUrl(row.original_url);
        const shortUrlQrDataUrl = await generateQrCodeDataUrl(shortUrl);
        const clickCount = Number(row.click_count) || 0;
        const maxClicks = row.max_clicks !== null && row.max_clicks !== undefined ? Number(row.max_clicks) : null;
        return {
          id: row.id,
          shortCode: row.short_code,
          short_code: row.short_code,
          shortUrl,
          previewUrl,
          qrCodeDataUrl,
          shortUrlQrDataUrl,
          originalUrl: row.original_url,
          original_url: row.original_url,
          safetyStatus: 'verified',
          createdAt: row.created_at,
          created_at: row.created_at,
          lastAccessedAt: row.last_accessed_at || null,
          last_accessed_at: row.last_accessed_at || null,
          clickCount,
          click_count: clickCount,
          maxClicks,
          max_clicks: maxClicks,
          limitReached: maxClicks !== null && clickCount >= maxClicks,
          analytics: parseAnalytics(row.analytics_json),
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

// Record a click via AJAX (used by the Preview page "Proceed to Destination" button so it can open external sites in a new tab without iframe X-Frame-Options blocking)
const recordClickApi = async (req, res, next) => {
  try {
    const cleanCode = String(req.params.shortCode || '').replace(/\+$/, '');

    const [rows] = await pool.execute(
      'SELECT id, short_code, original_url, click_count, max_clicks, analytics_json FROM urls WHERE short_code = ?',
      [cleanCode]
    );

    if (!rows || rows.length === 0) {
      const error = new Error('Short URL not found');
      error.statusCode = 404;
      throw error;
    }

    const { id, original_url, click_count, max_clicks, analytics_json } = rows[0];
    const currentClicks = Number(click_count) || 0;
    const maxAllowed = max_clicks !== null && max_clicks !== undefined ? Number(max_clicks) : null;

    if (maxAllowed !== null && currentClicks >= maxAllowed) {
      const error = new Error(
        `Maximum click limit reached (${currentClicks}/${maxAllowed}) — link access is disabled to prevent misuse.`
      );
      error.statusCode = 410;
      error.safetyStatus = 'limit_reached';
      throw error;
    }

    const phishing = checkPhishingIndicators(original_url);
    if (phishing.isPhishing) {
      const error = new Error(`Access blocked — Phishing link detected: ${phishing.reasons.join(' ')}`);
      error.statusCode = 403;
      throw error;
    }

    const now = new Date();
    const updatedAnalytics = recordClickEvent(analytics_json, req, now);
    const newClickCount = currentClicks + 1;

    await pool.execute(
      'UPDATE urls SET click_count = ?, last_accessed_at = ?, analytics_json = ? WHERE id = ?',
      [newClickCount, now, JSON.stringify(updatedAnalytics), id]
    );

    return res.status(200).json({
      shortCode: cleanCode,
      originalUrl: original_url,
      clickCount: newClickCount,
      maxClicks: maxAllowed,
      limitReached: maxAllowed !== null && newClickCount >= maxAllowed,
    });
  } catch (error) {
    next(error);
  }
};

// Destination Preview / Safe Interstitial Page (GET /:shortCode+ or GET /preview/:shortCode)
const previewUrl = async (req, res, next) => {
  try {
    const cleanCode = String(req.params.shortCode || '').replace(/\+$/, '');

    const [rows] = await pool.execute(
      'SELECT id, short_code, original_url, created_at, last_accessed_at, click_count, max_clicks, analytics_json FROM urls WHERE short_code = ?',
      [cleanCode]
    );

    if (!rows || rows.length === 0) {
      const error = new Error('Short URL not found');
      error.statusCode = 404;
      throw error;
    }

    const row = rows[0];
    const baseUrl = resolveBaseUrl(req);
    const shortUrl = `${baseUrl}/${row.short_code}`;
    const qrCodeDataUrl = await generateQrCodeDataUrl(row.original_url);
    const safety = await evaluateUrlSafety(row.original_url);
    const clickCount = Number(row.click_count) || 0;
    const maxClicks = row.max_clicks !== null && row.max_clicks !== undefined ? Number(row.max_clicks) : null;
    const limitReached = maxClicks !== null && clickCount >= maxClicks;
    const canProceed = safety.allowed && !limitReached;

    if (req.query.format === 'json') {
      return res.status(200).json({
        shortCode: row.short_code,
        shortUrl,
        originalUrl: row.original_url,
        qrCodeDataUrl,
        clickCount,
        maxClicks,
        limitReached,
        safety,
        canProceed,
      });
    }

    const statusLabel = !safety.allowed
      ? `Blocked: ${safety.category}`
      : limitReached
      ? `Disabled: Maximum Click Limit Reached (${clickCount}/${maxClicks})`
      : 'Verified Safe & Active';

    const statusColor = canProceed ? '#4ade80' : '#f87171';
    const quotaText = maxClicks !== null ? `${clickCount} / ${maxClicks} clicks used` : `${clickCount} clicks (Unlimited quota)`;

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Link Preview · /${escapeHtml(row.short_code)}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;600&family=Plus+Jakarta+Sans:wght@400;500;600&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="/styles.css">
</head>
<body>
  <div class="topbar-wrap">
    <header class="topbar">
      <a href="/" class="brand-mark">ShortLink</a>
      <div class="topbar-actions">
        <a href="/" class="ghost" style="text-decoration:none;display:inline-flex;align-items:center;padding:8px 14px;border:1px solid rgba(148,163,184,0.2);border-radius:8px;color:#cbd5e1;font-size:0.84rem;">&larr; Back to Dashboard</a>
      </div>
    </header>
  </div>
  <main class="workspace" style="max-width:760px;">
    <section class="panel">
      <div class="panel-header">
        <h1 class="panel-title" style="font-size:1.35rem;">Destination Link Preview</h1>
        <span class="panel-meta" id="previewStatusBadge" style="color:${statusColor};font-weight:600;">${escapeHtml(statusLabel)}</span>
      </div>
      <p style="color:#94a3b8;margin:0 0 24px;font-size:0.92rem;">
        Inspect where this short link leads before proceeding. Scan the QR code with your phone camera to open the destination directly on mobile.
      </p>

      <div class="stats-inspector-layout" style="margin-bottom:24px;">
        <div class="qr-preview-box" style="width:104px;height:104px;">
          <img src="${qrCodeDataUrl}" alt="QR code for ${escapeHtml(row.short_code)}" referrerpolicy="no-referrer">
        </div>
        <div class="stats-grid">
          <div class="stat-field full-width">
            <span class="stat-key">Destination URL</span>
            <span class="stat-val mono" style="font-size:1rem;color:#60a5fa;">${escapeHtml(row.original_url)}</span>
          </div>
          <div class="stat-field">
            <span class="stat-key">Short Link</span>
            <span class="stat-val mono">/${escapeHtml(row.short_code)}</span>
          </div>
          <div class="stat-field">
            <span class="stat-key">Click Quota</span>
            <span class="stat-val mono" id="previewQuotaVal">${escapeHtml(quotaText)}</span>
          </div>
        </div>
      </div>

      <div id="previewFeedback" style="font-size:0.86rem;color:#94a3b8;margin-bottom:14px;" hidden></div>

      <div style="display:flex;align-items:center;justify-content:flex-end;gap:12px;padding-top:20px;border-top:1px solid rgba(148,163,184,0.14);">
        <a href="/" class="secondary" style="text-decoration:none;display:inline-flex;align-items:center;justify-content:center;min-height:44px;padding:10px 20px;border-radius:8px;border:1px solid rgba(148,163,184,0.26);color:#f8fafc;font-weight:600;font-size:0.88rem;">Back to Dashboard</a>
        ${
          canProceed
            ? `<a id="proceedBtn" href="${escapeHtml(row.original_url)}" target="_blank" rel="noopener noreferrer" style="text-decoration:none;display:inline-flex;align-items:center;justify-content:center;min-height:44px;padding:10px 22px;border-radius:8px;background-color:#3b82f6;color:#ffffff;font-weight:600;font-size:0.88rem;">Proceed to Destination &rarr;</a>`
            : `<button type="button" disabled style="opacity:0.5;cursor:not-allowed;background-color:#dc2626;color:#fff;">Access Disallowed</button>`
        }
      </div>
    </section>
  </main>
  <script>
    const proceedBtn = document.getElementById('proceedBtn');
    const quotaVal = document.getElementById('previewQuotaVal');
    const statusBadge = document.getElementById('previewStatusBadge');
    const feedbackEl = document.getElementById('previewFeedback');
    const shortCode = ${JSON.stringify(row.short_code)};

    if (proceedBtn) {
      proceedBtn.addEventListener('click', async (e) => {
        try {
          const res = await fetch('/api/click/' + encodeURIComponent(shortCode), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            keepalive: true,
          });
          const data = await res.json();
          if (!res.ok) {
            e.preventDefault();
            feedbackEl.hidden = false;
            feedbackEl.style.color = '#f87171';
            feedbackEl.textContent = data.error || 'Access disallowed.';
            proceedBtn.style.pointerEvents = 'none';
            proceedBtn.style.opacity = '0.5';
            proceedBtn.style.backgroundColor = '#dc2626';
            proceedBtn.textContent = 'Access Disallowed';
            return;
          }
          quotaVal.textContent = data.maxClicks !== null
            ? data.clickCount + ' / ' + data.maxClicks + ' clicks used'
            : data.clickCount + ' clicks (Unlimited quota)';
          if (data.limitReached) {
            statusBadge.textContent = 'Disabled: Maximum Click Limit Reached (' + data.clickCount + '/' + data.maxClicks + ')';
            statusBadge.style.color = '#f87171';
            proceedBtn.style.pointerEvents = 'none';
            proceedBtn.style.opacity = '0.5';
            proceedBtn.style.backgroundColor = '#dc2626';
            proceedBtn.textContent = 'Click Limit Reached';
          }
        } catch (err) {
          // Allow new tab navigation to proceed
        }
      });
    }
  </script>
</body>
</html>`;

    res.status(200).send(html);
  } catch (error) {
    next(error);
  }
};

// Redirect to original URL (blocks access if URL fails safety or exceeds max_clicks limit)
const redirectUrl = async (req, res, next) => {
  try {
    const rawCode = String(req.params.shortCode || '');

    // Support trailing '+' preview convention (e.g. /:shortCode+)
    if (rawCode.endsWith('+')) {
      return previewUrl(req, res, next);
    }

    const [rows] = await pool.execute(
      'SELECT id, short_code, original_url, click_count, max_clicks, analytics_json FROM urls WHERE short_code = ?',
      [rawCode]
    );

    if (!rows || rows.length === 0) {
      const error = new Error('Short URL not found');
      error.statusCode = 404;
      throw error;
    }

    const { id, original_url, click_count, max_clicks, analytics_json } = rows[0];
    const currentClicks = Number(click_count) || 0;
    const maxAllowed = max_clicks !== null && max_clicks !== undefined ? Number(max_clicks) : null;

    // Enforce Maximum Click Limit to disallow misuse
    if (maxAllowed !== null && currentClicks >= maxAllowed) {
      const error = new Error(
        `Maximum click limit reached (${currentClicks}/${maxAllowed}) — link access is disabled to prevent misuse.`
      );
      error.statusCode = 410;
      error.safetyStatus = 'limit_reached';
      error.safetyCategory = 'Maximum Click Limit Reached';
      throw error;
    }

    // Fast synchronous phishing check on redirect (avoids slow network probes blocking redirects to sites like Facebook)
    const phishing = checkPhishingIndicators(original_url);
    if (phishing.isPhishing) {
      const error = new Error(`Access blocked — Phishing link detected: ${phishing.reasons.join(' ')}`);
      error.statusCode = 403;
      error.safetyStatus = 'phishing';
      error.safetyCategory = 'Phishing / Deceptive Link Detected';
      error.reasons = phishing.reasons;
      throw error;
    }

    const now = new Date();
    const updatedAnalytics = recordClickEvent(analytics_json, req, now);

    await pool.execute(
      'UPDATE urls SET click_count = ?, last_accessed_at = ?, analytics_json = ? WHERE id = ?',
      [currentClicks + 1, now, JSON.stringify(updatedAnalytics), id]
    );

    return res.redirect(original_url);
  } catch (error) {
    next(error);
  }
};

// Get statistics for a specific short code (including QR code, click quota, and analytics breakdown)
const getStats = async (req, res, next) => {
  try {
    const { shortCode } = req.params;

    const [rows] = await pool.execute(
      'SELECT id, short_code, original_url, created_at, last_accessed_at, click_count, max_clicks, analytics_json FROM urls WHERE short_code = ?',
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
    const previewUrl = `${baseUrl}/${stats.short_code}+`;
    const qrCodeDataUrl = await generateQrCodeDataUrl(stats.original_url);
    const shortUrlQrDataUrl = await generateQrCodeDataUrl(shortUrl);
    const clickCount = Number(stats.click_count) || 0;
    const maxClicks = stats.max_clicks !== null && stats.max_clicks !== undefined ? Number(stats.max_clicks) : null;

    res.status(200).json({
      ...stats,
      shortCode: stats.short_code,
      shortUrl,
      previewUrl,
      qrCodeDataUrl,
      shortUrlQrDataUrl,
      originalUrl: stats.original_url,
      createdAt: stats.created_at,
      lastAccessedAt: stats.last_accessed_at || null,
      clickCount,
      click_count: clickCount,
      maxClicks,
      max_clicks: maxClicks,
      limitReached: maxClicks !== null && clickCount >= maxClicks,
      analytics: parseAnalytics(stats.analytics_json),
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
    const qrCodeDataUrl = await generateQrCodeDataUrl(rows[0].original_url);
    const shortUrlQrDataUrl = await generateQrCodeDataUrl(shortUrl);

    res.status(200).json({
      shortCode: rows[0].short_code,
      shortUrl,
      originalUrl: rows[0].original_url,
      qrCodeDataUrl,
      shortUrlQrDataUrl,
    });
  } catch (error) {
    next(error);
  }
};

// Delete a shortened URL
const deleteUrl = async (req, res, next) => {
  try {
    const { shortCode } = req.params;

    const [result] = await pool.execute('DELETE FROM urls WHERE short_code = ?', [shortCode]);

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
  recordClickApi,
  previewUrl,
  redirectUrl,
  getStats,
  getQrCode,
  deleteUrl,
};
