const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

const DATA_DIR = path.join(__dirname, '../../data');
const DATA_FILE = path.join(DATA_DIR, 'urls.json');

const defaultAnalytics = (clicks = 0) => {
  if (!clicks) {
    return {
      devices: {},
      browsers: {},
      referrers: {},
      timeline: {},
      recentEvents: [],
    };
  }
  const today = new Date().toISOString().slice(0, 10);
  return {
    devices: { Desktop: Math.ceil(clicks * 0.7), Mobile: Math.floor(clicks * 0.3) },
    browsers: { Chrome: Math.ceil(clicks * 0.6), Safari: Math.floor(clicks * 0.4) },
    referrers: { Direct: clicks },
    timeline: { [today]: clicks },
    recentEvents: [
      {
        timestamp: new Date(Date.now() - 1800000).toISOString(),
        device: 'Desktop',
        browser: 'Chrome',
        os: 'macOS',
        referrer: 'Direct',
      },
    ],
  };
};

const loadInitialStore = () => {
  if (process.env.NODE_ENV === 'test') {
    return [];
  }
  try {
    if (fs.existsSync(DATA_FILE)) {
      const raw = fs.readFileSync(DATA_FILE, 'utf-8');
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed.map((item) => ({
          ...item,
          max_clicks: item.max_clicks ?? null,
          analytics_json:
            item.analytics_json || JSON.stringify(defaultAnalytics(Number(item.click_count) || 0)),
        }));
      }
    }
  } catch (err) {
    console.warn('Could not read local store file, starting fresh:', err.message);
  }
  return [
    {
      id: 1,
      short_code: 'gh-repo',
      original_url: 'https://github.com/Null-source404/Software-_v1.1',
      created_at: new Date(Date.now() - 86400000 * 2).toISOString(),
      last_accessed_at: new Date(Date.now() - 3600000).toISOString(),
      click_count: 14,
      max_clicks: 50,
      analytics_json: JSON.stringify(defaultAnalytics(14)),
    },
    {
      id: 2,
      short_code: 'mdn-http',
      original_url: 'https://developer.mozilla.org/en-US/docs/Web/HTTP/Redirections',
      created_at: new Date(Date.now() - 86400000).toISOString(),
      last_accessed_at: new Date(Date.now() - 1800000).toISOString(),
      click_count: 7,
      max_clicks: null,
      analytics_json: JSON.stringify(defaultAnalytics(7)),
    },
  ];
};

let memoryStore = loadInitialStore();
let nextId = memoryStore.reduce((max, item) => Math.max(max, Number(item.id) || 0), 0) + 1;

const persistStore = () => {
  if (process.env.NODE_ENV === 'test') return;
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    fs.writeFileSync(DATA_FILE, JSON.stringify(memoryStore, null, 2), 'utf-8');
  } catch (err) {
    // Ignore write errors in read-only environments
  }
};

const createLocalPool = () => ({
  execute: async (sql, params = []) => {
    const normalized = sql.trim().replace(/\s+/g, ' ').toUpperCase();

    if (normalized.startsWith('INSERT INTO URLS')) {
      const [short_code, original_url, created_at, max_clicks, analytics_json] = params;
      const existing = memoryStore.find(
        (item) => item.short_code.toLowerCase() === String(short_code).toLowerCase()
      );
      if (existing) {
        const dupError = new Error('Duplicate short code');
        dupError.code = 'ER_DUP_ENTRY';
        dupError.statusCode = 409;
        throw dupError;
      }

      const record = {
        id: nextId++,
        short_code,
        original_url,
        created_at:
          (created_at instanceof Date ? created_at.toISOString() : created_at) ||
          new Date().toISOString(),
        last_accessed_at: null,
        click_count: 0,
        max_clicks: max_clicks !== undefined && max_clicks !== null ? Number(max_clicks) : null,
        analytics_json: analytics_json || JSON.stringify(defaultAnalytics(0)),
      };
      memoryStore.push(record);
      persistStore();
      return [{ insertId: record.id, affectedRows: 1 }, []];
    }

    if (normalized.startsWith('SELECT') && normalized.includes('WHERE SHORT_CODE = ?')) {
      const [short_code] = params;
      const matches = memoryStore.filter((item) => item.short_code === short_code);
      return [matches, []];
    }

    if (normalized.startsWith('SELECT') && normalized.includes('FROM URLS')) {
      const sorted = [...memoryStore].sort(
        (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      );
      return [sorted, []];
    }

    if (normalized.startsWith('UPDATE URLS SET CLICK_COUNT')) {
      const [click_count, last_accessed_at, analytics_json, id] =
        params.length === 4
          ? params
          : [params[0], params[1], null, params[2]];
      const record = memoryStore.find((item) => item.id === id);
      if (record) {
        record.click_count = click_count;
        record.last_accessed_at =
          last_accessed_at instanceof Date ? last_accessed_at.toISOString() : last_accessed_at;
        if (analytics_json) {
          record.analytics_json = analytics_json;
        }
        persistStore();
      }
      return [{ affectedRows: record ? 1 : 0 }, []];
    }

    if (normalized.startsWith('DELETE FROM URLS WHERE SHORT_CODE = ?')) {
      const [short_code] = params;
      const before = memoryStore.length;
      memoryStore = memoryStore.filter((item) => item.short_code !== short_code);
      const deleted = before - memoryStore.length;
      if (deleted > 0) persistStore();
      return [{ affectedRows: deleted }, []];
    }

    return [[], []];
  },
  query: async function (sql, params) {
    return this.execute(sql, params);
  },
  getConnection: async () => ({
    release: () => {},
  }),
  __resetForTests: () => {
    memoryStore = [];
    nextId = 1;
  },
});

const localPool = createLocalPool();
let activePool = localPool;

if (process.env.DB_HOST && process.env.NODE_ENV !== 'test') {
  try {
    const realPool = mysql.createPool({
      host: process.env.DB_HOST,
      user: process.env.DB_USER || 'root',
      password: process.env.DB_PASSWORD || '',
      database: process.env.DB_NAME || 'url_shortener',
      port: Number(process.env.DB_PORT) || 3306,
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0,
    });

    realPool
      .getConnection()
      .then(async (connection) => {
        await connection.execute(`
          CREATE TABLE IF NOT EXISTS urls (
            id INT PRIMARY KEY AUTO_INCREMENT,
            short_code VARCHAR(32) NOT NULL UNIQUE,
            original_url TEXT NOT NULL,
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            last_accessed_at DATETIME NULL,
            click_count INT NOT NULL DEFAULT 0,
            max_clicks INT NULL DEFAULT NULL,
            analytics_json LONGTEXT NULL
          )
        `);
        console.log('MySQL database connected and schema verified');
        connection.release();
        activePool = realPool;
      })
      .catch((error) => {
        console.warn('MySQL unavailable — using persistent local storage fallback:', error.message);
      });
  } catch (error) {
    console.warn('MySQL initialization failed — using persistent local storage fallback');
  }
}

const poolProxy = {
  execute: (...args) => activePool.execute(...args),
  query: (...args) => activePool.query(...args),
  getConnection: (...args) => activePool.getConnection(...args),
  __resetForTests: () => localPool.__resetForTests(),
};

module.exports = poolProxy;
