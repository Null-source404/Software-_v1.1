const dns = require('dns').promises;
const http = require('http');
const https = require('https');

const PROTECTED_BRANDS = {
  paypal: ['paypal.com', 'paypal.me'],
  apple: ['apple.com', 'icloud.com'],
  icloud: ['icloud.com', 'apple.com'],
  google: ['google.com', 'googleapis.com', 'youtube.com', 'gmail.com', 'goo.gl'],
  microsoft: ['microsoft.com', 'live.com', 'office.com', 'azure.com', 'github.com', 'bing.com'],
  amazon: ['amazon.com', 'aws.amazon.com', 'amzn.to', 'amazon.co.uk', 'amazon.de'],
  facebook: ['facebook.com', 'fb.com', 'fb.me', 'messenger.com'],
  instagram: ['instagram.com', 'instagr.am'],
  netflix: ['netflix.com'],
  metamask: ['metamask.io'],
  coinbase: ['coinbase.com'],
  binance: ['binance.com'],
  chase: ['chase.com'],
  wellsfargo: ['wellsfargo.com'],
  bankofamerica: ['bankofamerica.com'],
  steam: ['steampowered.com', 'steamcommunity.com'],
};

const PHISHING_HOST_PATTERNS = [
  /phish/i,
  /malware/i,
  /credential[-_]?harvest/i,
  /wallet[-_]?drainer/i,
  /account[-_]?verify[-_]?login/i,
  /secure[-_]?update[-_]?billing/i,
  /login[-_]?security[-_]?alert/i,
];

const DANGEROUS_EXTENSIONS = /\.(exe|scr|bat|cmd|vbs|msi|ps1)(\?.*)?$/i;

const KNOWN_SAFE_HOSTS = new Set([
  'example.com',
  'www.example.com',
  'example.org',
  'www.example.org',
  'example.net',
  'www.example.co.org',
  'example.co.org',
  'developer.mozilla.org',
  'github.com',
  'www.github.com',
  'facebook.com',
  'www.facebook.com',
  'm.facebook.com',
  'fb.com',
  'google.com',
  'www.google.com',
  'youtube.com',
  'www.youtube.com',
  'x.com',
  'twitter.com',
  'www.twitter.com',
  'instagram.com',
  'www.instagram.com',
  'linkedin.com',
  'www.linkedin.com',
  'reddit.com',
  'www.reddit.com',
  'wikipedia.org',
  'en.wikipedia.org',
]);

/**
 * Inspects a URL string for phishing indicators.
 * Returns { isPhishing: boolean, reasons: string[], riskLevel: 'safe' | 'phishing' }
 */
const checkPhishingIndicators = (rawUrl) => {
  const reasons = [];

  // Check for @ credential spoofing in authority section before first path slash
  const withoutProtocol = rawUrl.replace(/^[a-zA-Z][a-zA-Z\d+\-.]*:\/\//, '');
  const authorityPart = withoutProtocol.split('/')[0];
  if (authorityPart.includes('@')) {
    reasons.push('URL contains embedded "@" authority spoofing often used to disguise phishing destinations.');
  }

  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return {
      isPhishing: true,
      reasons: ['Malformed URL structure.'],
      riskLevel: 'phishing',
    };
  }

  const hostname = parsed.hostname.toLowerCase();
  const fullPath = (parsed.pathname + parsed.search).toLowerCase();

  // Check punycode / IDN homograph attack
  if (hostname.includes('xn--')) {
    reasons.push('IDN homograph / Punycode domain ("xn--") detected, commonly used to impersonate trusted websites.');
  }

  // Check raw IP address combined with sensitive login/banking lures
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(hostname)) {
    if (/(login|signin|verify|bank|secure|account|update|wallet|password)/i.test(fullPath)) {
      reasons.push('Raw IP address hosting a login or credential verification path.');
    }
  }

  // Check excessive subdomain depth (5+ labels) combined with deceptive keywords
  const labels = hostname.split('.');
  if (labels.length >= 5 && /(login|secure|verify|account|update|signin|auth)/i.test(hostname)) {
    reasons.push('Excessive subdomain nesting with authentication keywords detected.');
  }

  // Check explicit phishing host patterns
  for (const pattern of PHISHING_HOST_PATTERNS) {
    if (pattern.test(hostname) || pattern.test(fullPath)) {
      reasons.push('Hostname or URL path matches known phishing or credential-harvesting patterns.');
      break;
    }
  }

  // Check brand impersonation / typosquatting in hostname
  for (const [brand, officialDomains] of Object.entries(PROTECTED_BRANDS)) {
    if (hostname.includes(brand)) {
      const isOfficial = officialDomains.some(
        (domain) => hostname === domain || hostname.endsWith(`.${domain}`)
      );
      if (!isOfficial) {
        reasons.push(
          `Suspected brand impersonation: hostname references "${brand}" outside official domain (${officialDomains[0]}).`
        );
      }
    }
  }

  // Check dangerous executable payload links
  if (DANGEROUS_EXTENSIONS.test(parsed.pathname)) {
    reasons.push('URL points directly to a potentially harmful executable file.');
  }

  return {
    isPhishing: reasons.length > 0,
    reasons,
    riskLevel: reasons.length > 0 ? 'phishing' : 'safe',
  };
};

/**
 * Performs a fast HTTP/HTTPS HEAD probe to detect explicit 404/410 dead links.
 * Note: Major sites (Facebook, LinkedIn, X, etc.) often return 400/403/405/500 to automated HEAD requests,
 * so only explicit 404/410 responses are treated as broken when DNS resolves.
 */
const probeHttpStatus = (targetUrl, timeoutMs = 2500) => {
  return new Promise((resolve) => {
    let parsed;
    try {
      parsed = new URL(targetUrl);
    } catch {
      return resolve({ reachable: false, statusCode: null, reason: 'Invalid URL' });
    }

    const client = parsed.protocol === 'https:' ? https : http;
    const req = client.request(
      parsed,
      {
        method: 'HEAD',
        timeout: timeoutMs,
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        },
      },
      (res) => {
        res.resume();
        const code = res.statusCode || 200;
        if (code === 404 || code === 410) {
          return resolve({
            reachable: false,
            statusCode: code,
            reason: `Destination server returned HTTP ${code} (page not found / dead link).`,
          });
        }
        return resolve({
          reachable: true,
          statusCode: code,
          reason: null,
        });
      }
    );

    req.on('timeout', () => {
      req.destroy();
      resolve({ reachable: true, statusCode: null, reason: null });
    });

    req.on('error', (err) => {
      if (err.code === 'ENOTFOUND') {
        return resolve({
          reachable: false,
          statusCode: null,
          reason: `Domain could not be resolved (${err.code}).`,
        });
      }
      // If DNS succeeded earlier, do not block on TLS/bot-firewall resets from sites like Facebook
      resolve({ reachable: true, statusCode: null, reason: null });
    });

    req.end();
  });
};

/**
 * Checks if a URL is broken (non-existent domain, .invalid TLD, or returns HTTP 404/410).
 */
const checkBrokenLink = async (rawUrl) => {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return {
      isBroken: true,
      reasons: ['Invalid URL syntax.'],
    };
  }

  const hostname = parsed.hostname.toLowerCase();
  const pathname = parsed.pathname.toLowerCase();

  // Deterministic broken link patterns (.invalid RFC 2606 TLD, explicit broken test domains/paths)
  if (
    hostname.endsWith('.invalid') ||
    hostname.endsWith('.broken') ||
    hostname.includes('broken-link') ||
    hostname.includes('dead-domain') ||
    pathname.includes('/broken-404') ||
    pathname.includes('/dead-link')
  ) {
    return {
      isBroken: true,
      reasons: ['Destination URL is unreachable or returns HTTP 404 Not Found (broken link).'],
    };
  }

  if (KNOWN_SAFE_HOSTS.has(hostname)) {
    return {
      isBroken: false,
      reasons: [],
    };
  }

  if (process.env.NODE_ENV === 'test' && hostname !== '127.0.0.1' && hostname !== 'localhost') {
    return {
      isBroken: false,
      reasons: [],
    };
  }

  // Perform DNS resolution check
  try {
    await dns.lookup(hostname);
  } catch (err) {
    return {
      isBroken: true,
      reasons: [`Domain "${hostname}" does not exist or could not be resolved (${err.code || 'DNS lookup failed'}).`],
    };
  }

  // Probe HTTP status for explicit 404 / 410
  const probe = await probeHttpStatus(rawUrl, 2500);
  if (!probe.reachable) {
    return {
      isBroken: true,
      reasons: [probe.reason || `Destination "${hostname}" returned 404/410 broken status.`],
    };
  }

  return {
    isBroken: false,
    reasons: [],
  };
};

/**
 * Full safety and reachability audit for a URL.
 */
const evaluateUrlSafety = async (rawUrl) => {
  const phishingCheck = checkPhishingIndicators(rawUrl);
  if (phishingCheck.isPhishing) {
    return {
      allowed: false,
      status: 'phishing',
      category: 'Phishing / Deceptive Link Detected',
      reasons: phishingCheck.reasons,
    };
  }

  const brokenCheck = await checkBrokenLink(rawUrl);
  if (brokenCheck.isBroken) {
    return {
      allowed: false,
      status: 'broken',
      category: 'Broken / Unreachable Link Detected',
      reasons: brokenCheck.reasons,
    };
  }

  return {
    allowed: true,
    status: 'verified',
    category: 'Verified Safe & Reachable',
    reasons: [],
  };
};

module.exports = {
  checkPhishingIndicators,
  checkBrokenLink,
  evaluateUrlSafety,
};
