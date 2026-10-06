const http = require('http');
const app = require('../src/app');
const pool = require('../src/config/db');

let server;
let baseUrl;

const request = (method, path, body = null) => {
  return new Promise((resolve, reject) => {
    const url = new URL(path, baseUrl);
    const payload = body ? JSON.stringify(body) : null;

    const req = http.request(
      url,
      {
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
        },
      },
      (res) => {
        let raw = '';
        res.on('data', (chunk) => {
          raw += chunk;
        });
        res.on('end', () => {
          let json = null;
          try {
            json = raw ? JSON.parse(raw) : null;
          } catch {
            json = null;
          }
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: json,
            text: raw,
          });
        });
      }
    );

    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
};

beforeAll((done) => {
  server = app.listen(0, '127.0.0.1', () => {
    const { port } = server.address();
    baseUrl = `http://127.0.0.1:${port}`;
    done();
  });
});

afterAll((done) => {
  if (server) {
    server.close(done);
  } else {
    done();
  }
});

beforeEach(() => {
  if (typeof pool.__resetForTests === 'function') {
    pool.__resetForTests();
  }
});

describe('URL Shortener Service API', () => {
  test('GET /health returns 200 OK', async () => {
    const res = await request('GET', '/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('OK');
  });

  test('POST /api/shorten creates a short URL with generated code', async () => {
    const res = await request('POST', '/api/shorten', {
      originalUrl: 'https://example.com/articles/node-express',
    });

    expect(res.status).toBe(201);
    expect(res.body.shortCode).toBeDefined();
    expect(res.body.shortCode.length).toBe(8);
    expect(res.body.originalUrl).toBe('https://example.com/articles/node-express');
    expect(res.body.clickCount).toBe(0);
  });

  test('POST /api/shorten supports custom alias and prevents duplicates', async () => {
    const first = await request('POST', '/api/shorten', {
      originalUrl: 'https://developer.mozilla.org',
      customCode: 'mdn-docs',
    });
    expect(first.status).toBe(201);
    expect(first.body.shortCode).toBe('mdn-docs');

    const duplicate = await request('POST', '/api/shorten', {
      originalUrl: 'https://example.org',
      customCode: 'mdn-docs',
    });
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.error).toMatch(/already in use/i);
  });

  test('POST /api/shorten accepts www.example.co.org format and normalizes with https://', async () => {
    const res = await request('POST', '/api/shorten', {
      originalUrl: 'www.example.co.org/resources',
    });

    expect(res.status).toBe(201);
    expect(res.body.originalUrl).toBe('https://www.example.co.org/resources');

    const redirectRes = await request('GET', `/${res.body.shortCode}`);
    expect(redirectRes.status).toBe(302);
    expect(redirectRes.headers.location).toBe('https://www.example.co.org/resources');
  });

  test('POST /api/shorten generates a QR code Data URL and GET /api/urls includes QR codes', async () => {
    const res = await request('POST', '/api/shorten', {
      originalUrl: 'https://example.com/qr-test',
      customCode: 'qr-demo',
    });

    expect(res.status).toBe(201);
    expect(res.body.qrCodeDataUrl).toMatch(/^data:image\/png;base64,/);

    const listRes = await request('GET', '/api/urls');
    expect(listRes.status).toBe(200);
    expect(listRes.body.urls[0].qrCodeDataUrl).toMatch(/^data:image\/png;base64,/);

    const qrRes = await request('GET', '/api/qr/qr-demo');
    expect(qrRes.status).toBe(200);
    expect(qrRes.body.qrCodeDataUrl).toMatch(/^data:image\/png;base64,/);
  });

  test('POST /api/shorten warns and disallows phishing links (brand impersonation / deceptive URLs)', async () => {
    const res = await request('POST', '/api/shorten', {
      originalUrl: 'https://paypal-secure-login-verify.com/signin',
    });

    expect(res.status).toBe(422);
    expect(res.body.safetyStatus).toBe('phishing');
    expect(res.body.error).toMatch(/Phishing/i);
    expect(Array.isArray(res.body.reasons)).toBe(true);
    expect(res.body.reasons.length).toBeGreaterThan(0);
  });

  test('POST /api/shorten warns and disallows broken links (.invalid or dead endpoints)', async () => {
    const res = await request('POST', '/api/shorten', {
      originalUrl: 'https://unreachable-site.invalid/page',
    });

    expect(res.status).toBe(422);
    expect(res.body.safetyStatus).toBe('broken');
    expect(res.body.error).toMatch(/Broken/i);
  });

  test('POST /api/shorten rejects invalid URLs', async () => {
    const res = await request('POST', '/api/shorten', {
      originalUrl: 'not-a-valid-url',
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Invalid URL format/i);
  });

  test('GET /:shortCode redirects (302) and increments click_count', async () => {
    const created = await request('POST', '/api/shorten', {
      originalUrl: 'https://example.com/target',
      customCode: 'go-target',
    });
    expect(created.status).toBe(201);

    const redirectRes = await request('GET', '/go-target');
    expect(redirectRes.status).toBe(302);
    expect(redirectRes.headers.location).toBe('https://example.com/target');

    const statsRes = await request('GET', '/api/stats/go-target');
    expect(statsRes.status).toBe(200);
    expect(statsRes.body.click_count).toBe(1);
    expect(statsRes.body.last_accessed_at).toBeTruthy();
  });

  test('GET /api/urls lists all shortened links and DELETE /api/urls/:shortCode removes a link', async () => {
    await request('POST', '/api/shorten', {
      originalUrl: 'https://example.com/one',
      customCode: 'link-one',
    });
    await request('POST', '/api/shorten', {
      originalUrl: 'https://example.com/two',
      customCode: 'link-two',
    });

    const listRes = await request('GET', '/api/urls');
    expect(listRes.status).toBe(200);
    expect(listRes.body.count).toBe(2);

    const delRes = await request('DELETE', '/api/urls/link-one');
    expect(delRes.status).toBe(200);

    const afterList = await request('GET', '/api/urls');
    expect(afterList.body.count).toBe(1);
  });
});
