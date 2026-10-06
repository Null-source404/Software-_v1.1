# ShortLink — URL Shortener, QR Generator & Link Protection Service

A complete, production-ready URL shortener web application and REST API built with **Node.js**, **Express**, **QRCode**, and **MySQL** (with an automatic zero-config local JSON persistence fallback so the project runs out of the box immediately after cloning).

---

## Key Features

### 1. Flexible URL Shortening & Protocol Normalization
- **Full & Bare Domain Support**: Accepts full URLs (`https://example.com/docs`, `http://example.org`) as well as `www.` and bare domains (`www.example.co.org`, `www.facebook.com`, `example.com/path`), automatically normalizing them to `https://` for external redirection.
- **Custom Aliases (Optional)**: Choose your own readable slug (`3–24` letters, numbers, hyphens, or underscores, e.g., `/release-v1`) or leave blank to auto-generate an 8-character short code. Includes duplicate (`409 Conflict`) and reserved-route protection.

### 2. Automatic QR Code Generation (`qrcode`)
- Generates a scannable PNG QR code (`qrCodeDataUrl`) for every shortened link and displays it in:
  - The **Create Short Link** result banner (with a one-click **Download QR** button).
  - The **Shortened Links Directory** table (click any QR thumbnail to download `qr-<shortCode>.png`).
  - The **Link Telemetry Inspector** and **Destination Preview (`+`)** page.
- **Mobile-Ready QR Encoding**: Encodes the verified destination URL directly into `qrCodeDataUrl` so scanning the QR code with any phone camera opens the destination on any cellular or Wi-Fi network—even when running the server locally on `localhost:3000` or inside a private cloud preview container (while also returning `shortUrlQrDataUrl` for the short link).

### 3. Phishing & Broken-Link Guard (`src/utils/urlSafety.js`)
- **Phishing Detection**: Blocks deceptive links before creation (`HTTP 422`) and redirection (`HTTP 403`), detecting:
  - Brand impersonation / typosquatting outside official domains (e.g., `paypal-secure-login-verify.com`).
  - Embedded `@` authority credential spoofing.
  - Punycode / IDN homograph attacks (`xn--`).
  - Raw IP login/credential lures and excessive authentication subdomain nesting.
  - Direct executable payload links (`.exe`, `.scr`, `.bat`, `.cmd`, `.vbs`, `.msi`, `.ps1`).
- **Broken-Link Verification**: Performs DNS resolution and HTTP `HEAD` status checks to block non-existent domains (`ENOTFOUND`) and dead endpoints (`404 Not Found` / `410 Gone`), while allowing valid domains with anti-bot firewalls (such as `facebook.com`, `linkedin.com`, `x.com`, and `github.com`).
- **On-Demand Pre-Check**: Click **Check Safety** in the UI (or call `POST /api/verify-url`) to audit any URL prior to shortening.

### 4. Maximum Click Limit to Prevent Misuse (`maxClicks`)
- Set an optional **Max Clicks** quota when creating a short link (`1` to `1,000,000` clicks).
- Once `click_count` reaches `max_clicks`, further attempts to visit or trigger the link are automatically disallowed (`HTTP 410 Gone — Maximum click limit reached`).

### 5. Safe Destination Preview Interstitial (`/:shortCode+` & `/preview/:shortCode`)
- Adding a `+` to the end of any short link (e.g., `http://localhost:3000/gh-repo+`) or clicking **Preview (+)** in the dashboard opens an interstitial preview page.
- Shows the full destination URL, safety status, QR code, and remaining click quota (`click_count / max_clicks`).
- Clicking **Proceed to Destination** opens the target site in a new top-level browser tab (`target="_blank"`, avoiding `X-Frame-Options: DENY` iframe restrictions on sites like Facebook or GitHub) while recording the click via `POST /api/click/:shortCode`.

### 6. Click Telemetry & Analytics Breakdown
- Tracks visitor `User-Agent` and `Referer` headers on every redirect to compute:
  - **Device Breakdown**: `Desktop`, `Mobile`, `Tablet`, `CLI / API`
  - **Browser Breakdown**: `Chrome`, `Safari`, `Firefox`, `Edge`, `Opera`, `CLI / API`
  - **Top Referrers**: `Direct`, `Dashboard`, or referring external hostnames
  - **Daily Click Activity**: Date-bucketed click timeline bar chart and recent events log
- Export the entire directory and click metrics at any time via **Export CSV**.

### 7. Dual Storage Engine (MySQL + Zero-Config Local JSON Store)
- **Zero-Config Local Mode**: When `DB_HOST` is left empty or MySQL is unreachable, all links, quotas, and analytics are persisted to `data/urls.json` (ignored by Git) so the project works immediately after `npm install && npm run dev`.
- **MySQL Mode**: When `DB_HOST` is configured in `.env`, connects via `mysql2/promise` connection pooling and automatically runs `CREATE TABLE IF NOT EXISTS urls (...)` on startup.

---

## Project Structure

```text
url-shortener/
├── db/
│   └── init.sql                 # MySQL database & table schema
├── public/
│   ├── index.html               # Dashboard UI (Composer, Directory, Telemetry, API Docs)
│   └── styles.css               # Dashboard & Preview page stylesheet
├── src/
│   ├── config/
│   │   └── db.js                # MySQL connection pool + persistent local JSON fallback
│   ├── controllers/
│   │   └── urlController.js     # Shorten, verify, list, preview (+), redirect, click, stats, QR, delete
│   ├── middleware/
│   │   └── errorHandler.js      # Centralized Express error handling middleware
│   ├── routes/
│   │   └── url.js               # Express API router (/api/*)
│   ├── utils/
│   │   └── urlSafety.js         # Phishing indicator detector & DNS/HTTP broken-link verifier
│   └── app.js                   # Express application entry point
├── tests/
│   └── url.test.js              # Jest integration test suite (13 end-to-end tests)
├── .env.example                 # Environment variable template
├── .gitignore
├── LICENSE
├── package.json
└── README.md
```

---

## Getting Started (Clone & Run)

1. **Clone the repository**
   ```bash
   git clone https://github.com/Null-source404/Software-_v1.1.git
   cd Software-_v1.1
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Configure environment variables (Optional)**
   ```bash
   cp .env.example .env
   ```
   - **Local JSON Mode (Default)**: Leave `DB_HOST=` blank in `.env`. Links are saved automatically to `data/urls.json`.
   - **MySQL Mode**: Set `DB_HOST`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`, and `DB_PORT` in `.env` (you can also run `db/init.sql` manually).

4. **Start the server**
   ```bash
   npm run dev
   ```
   Open `http://localhost:3000` in your browser.

5. **Run automated tests**
   ```bash
   npm test
   ```

---

## REST API Reference

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `POST` | `/api/shorten` | Validate safety/reachability and create a short link (`{ "originalUrl": "www.example.co.org", "customCode": "my-link", "maxClicks": 50 }`). Returns `201 Created` with `shortUrl`, `previewUrl`, and `qrCodeDataUrl`, or `422` if phishing/broken. |
| `POST` | `/api/verify-url` | Pre-scan a URL (`{ "originalUrl": "https://..." }`) for phishing indicators and broken-link status. |
| `GET` | `/api/urls` | List all shortened links with QR codes, click quotas, and analytics breakdowns. |
| `GET` | `/api/stats/:shortCode` | Retrieve click count, quota status, timestamps, QR code, and device/browser/referrer/timeline analytics. |
| `GET` | `/api/qr/:shortCode` | Retrieve the generated QR code PNG Data URLs (`qrCodeDataUrl` and `shortUrlQrDataUrl`). |
| `GET` | `/:shortCode+` or `/preview/:shortCode` | Render the Safe Destination Preview interstitial page (pass `?format=json` for JSON output). |
| `GET` | `/:shortCode` | Verify click quota & safety, record visitor telemetry, and issue an `HTTP 302` redirect to the destination URL (returns `410 Gone` if `maxClicks` is reached). |
| `POST` | `/api/click/:shortCode` | Record a click and enforce `maxClicks` quota asynchronously (used by the Preview page's new-tab navigation). |
| `DELETE` | `/api/urls/:shortCode` | Delete a shortened URL by its short code. |
| `GET` | `/health` | Server health check (`{ "status": "OK" }`). |

---

## License

MIT
